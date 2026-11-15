import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SAFE_ID, buildDb, checkDoc, Diags, itemSummary } from "../shared/db.js";
import { crossRefQuests, type QuestCrossRef } from "../shared/quest.js";
import { EXPORT_PRESETS, type Diagnostic, type ItemsDb, type ItemsDoc } from "../shared/types.js";
import { ICON_NAMES } from "../shared/icons.js";
import { pkgRoot } from "./assets.js";

export const CONFIG_NAME = "easyitems.config.json";
export const DOC_EXT = ".easyitems.json";

export interface EasyItemsConfig {
  name: string;
  /** Preview upscale. */
  scale: number;
  /** Folders or files with Easy Quest `.ezq` / quest JSON, relative to the workspace (cross-checked by `check`). */
  quests: string[];
}

export const DEFAULT_CONFIG: EasyItemsConfig = { name: "Easy Items Workspace", scale: 4, quests: ["quests"] };

export function assertSafeId(id: unknown, label = "id"): string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error(`Invalid ${label} ${JSON.stringify(id)} (use a-z, 0-9, _ or -)`);
  return id;
}

export const resolveWorkspace = (dir = process.cwd()) => path.resolve(dir);

export const dirs = (root: string) => ({
  items: path.join(root, "items"),
  quests: path.join(root, "quests"),
  exports: path.join(root, "exports"),
});

export function allowedRoots(root: string): string[] {
  const extra = (process.env.EASYITEMS_ALLOWED_DIRS ?? "").split(path.delimiter).map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  return [path.resolve(root), ...extra];
}

export function resolveInside(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const ok = allowedRoots(root).some((r) => abs === r || abs.startsWith(r + path.sep));
  if (!ok) throw new Error(`Path ${p} is outside the workspace (allow it with EASYITEMS_ALLOWED_DIRS)`);
  return abs;
}

export async function initWorkspace(dir = process.cwd(), opts: { force?: boolean } = {}): Promise<string> {
  const root = resolveWorkspace(dir);
  const d = dirs(root);
  for (const p of Object.values(d)) await mkdir(p, { recursive: true });
  const cfg = path.join(root, CONFIG_NAME);
  if (!existsSync(cfg) || opts.force) await writeFile(cfg, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  for (const [sub, dest] of [["items", d.items], ["quests", d.quests]] as const) {
    const src = path.join(pkgRoot, "samples", sub);
    if (!existsSync(src)) continue;
    for (const f of await readdir(src)) {
      const to = path.join(dest, f);
      if (!existsSync(to) || opts.force) await copyFile(path.join(src, f), to);
    }
  }
  return root;
}

export async function loadConfig(root: string): Promise<EasyItemsConfig> {
  const f = path.join(root, CONFIG_NAME);
  if (!existsSync(f)) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...(JSON.parse(await readFile(f, "utf8")) as Partial<EasyItemsConfig>) };
}

export const docPath = (root: string, id: string) => path.join(dirs(root).items, `${assertSafeId(id, "document id")}${DOC_EXT}`);

export async function listDocs(root: string): Promise<Array<{ id: string; file: string; doc: unknown; parseError?: string }>> {
  const d = dirs(root).items;
  if (!existsSync(d)) return [];
  const out = [];
  for (const f of (await readdir(d)).sort()) {
    if (!f.endsWith(DOC_EXT)) continue;
    const id = f.slice(0, -DOC_EXT.length);
    const file = path.join(d, f);
    try {
      out.push({ id, file, doc: JSON.parse(await readFile(file, "utf8")) as unknown });
    } catch (e) {
      out.push({ id, file, doc: undefined, parseError: (e as Error).message });
    }
  }
  return out;
}

export interface LoadedDb {
  db: ItemsDb;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  docs: string[];
}

export async function loadDb(root: string): Promise<LoadedDb> {
  const docs = await listDocs(root);
  const parseErrors: Diagnostic[] = docs.filter((d) => d.parseError).map((d) => ({ path: `${d.id}${DOC_EXT}`, message: `invalid JSON: ${d.parseError}`, severity: "error" }));
  const r = buildDb(docs.filter((d) => !d.parseError).map((d) => ({ file: `${d.id}${DOC_EXT}`, doc: d.doc })));
  return { db: r.db, errors: [...parseErrors, ...r.errors], warnings: r.warnings, docs: docs.map((d) => d.id) };
}

/** Load, and throw when the database has errors (exports and runtimes need a clean db). */
export async function loadDbStrict(root: string): Promise<ItemsDb> {
  const r = await loadDb(root);
  if (r.errors.length) throw new Error(`Item database has ${r.errors.length} error(s):\n${r.errors.slice(0, 8).map((e) => `  ${e.path}: ${e.message}`).join("\n")}`);
  return r.db;
}

async function walk(p: string, out: string[]) {
  if (!existsSync(p)) return;
  const s = await stat(p);
  if (s.isFile()) {
    if (/\.ezq$|\.quest\.json$|\.easyquest\.json$/.test(p)) out.push(p);
    return;
  }
  for (const f of (await readdir(p)).sort()) await walk(path.join(p, f), out);
}

export async function questFiles(root: string, extra: string[] = []): Promise<Array<{ file: string; body: string }>> {
  const cfg = await loadConfig(root);
  const found: string[] = [];
  for (const q of [...cfg.quests.map((x) => path.resolve(root, x)), ...extra.map((x) => path.resolve(x))]) await walk(q, found);
  const uniq = [...new Set(found)];
  return Promise.all(uniq.map(async (f) => ({ file: path.relative(root, f) || f, body: await readFile(f, "utf8") })));
}

export async function checkWorkspace(root: string, extraQuests: string[] = []): Promise<LoadedDb & { quests: QuestCrossRef }> {
  const r = await loadDb(root);
  const quests = crossRefQuests(r.db, await questFiles(root, extraQuests));
  return { ...r, warnings: [...r.warnings, ...quests.diagnostics], quests };
}

export async function saveDoc(root: string, id: string, raw: unknown, opts: { dryRun?: boolean } = {}) {
  const file = docPath(root, id);
  const d = new Diags();
  checkDoc(raw, d, `${id}${DOC_EXT}`);
  // cross-check with the rest of the workspace (this doc replaces the file of the same id); report what it breaks
  if (!d.errors.length) {
    const all = (await listDocs(root)).filter((x) => !x.parseError);
    const others = all.filter((x) => x.id !== id);
    const key = (e: Diagnostic) => `${e.path}|${e.message}`;
    const before = new Set(buildDb(all.map((x) => ({ file: `${x.id}${DOC_EXT}`, doc: x.doc }))).errors.map(key));
    const r = buildDb([...others.map((x) => ({ file: `${x.id}${DOC_EXT}`, doc: x.doc })), { file: `${id}${DOC_EXT}`, doc: raw }]);
    d.list.push(...r.errors.filter((e) => !before.has(key(e))), ...r.warnings.filter((e) => e.path.startsWith(`${id}${DOC_EXT}`)));
  }
  if (opts.dryRun || d.errors.length) return { file, saved: false, errors: d.errors, warnings: d.warnings };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
  return { file, saved: true, errors: d.errors, warnings: d.warnings };
}

export async function readDoc(root: string, id: string): Promise<ItemsDoc | undefined> {
  const f = docPath(root, id);
  return existsSync(f) ? (JSON.parse(await readFile(f, "utf8")) as ItemsDoc) : undefined;
}

export async function workspaceSummary(root: string) {
  const r = await loadDb(root);
  return {
    root,
    config: await loadConfig(root),
    ...dirs(root),
    docs: r.docs,
    rules: r.db.rules,
    items: r.db.items.map(itemSummary),
    shops: r.db.shops.map((s) => ({ id: s.id, th: s.name.th, en: s.name.en, keeper: s.keeper ?? null, halal: !!s.halal, stock: s.stock.length })),
    loot: r.db.loot.map((l) => ({ id: l.id, rolls: l.rolls, entries: l.entries.length })),
    recipes: r.db.recipes.map((x) => ({ id: x.id, th: x.name.th, en: x.name.en, station: x.station ?? null })),
    icons: ICON_NAMES.length,
    errors: r.errors,
    warnings: r.warnings,
    exportPresets: EXPORT_PRESETS,
  };
}
