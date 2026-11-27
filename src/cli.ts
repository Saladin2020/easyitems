#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import open from "open";
import { createApp, defaultWebRoot } from "./server/app.js";
import { resolveToken } from "./shared/requestGuard.js";
import { itemSummary } from "./shared/db.js";
import { Inventory, rollLoot } from "./shared/engine.js";
import { xpForLevel } from "./shared/skills.js";
import { ICONS, ICON_NAMES } from "./shared/icons.js";
import { CATEGORIES, FORMAT, type Item, type ItemsDoc } from "./shared/types.js";
import { EXPORT_PRESETS, exportItems, type ExportPreset } from "./lib/export.js";
import { itemSheetPng } from "./lib/render.js";
import { assertSafeId, checkWorkspace, dirs, docPath, initWorkspace, loadConfig, loadDb, loadDbStrict, resolveWorkspace, saveDoc, workspaceSummary } from "./lib/workspace.js";

const program = new Command();

function workspaceOf(cli?: string): string {
  const v = cli?.trim() || process.env.EASYITEMS_HOME?.trim() || process.env.EASYITEMS_WORKSPACE?.trim() || process.cwd();
  return resolveWorkspace(v);
}

const fail = (e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};
const collect = (v: string, prev: string[]) => [...prev, v];
const fmtRolls = (r: number | [number, number]) => (Array.isArray(r) ? `${r[0]}-${r[1]}` : String(r));

program.name("easyitems").description("Items, shops and inventory for 2D games → Godot Resources + autoload + shop UI, PixiJS runtime").version("0.1.0");

program
  .command("init")
  .description("Create items/ quests/ exports/ with the starter catalog (village + raya) and two sample quests")
  .option("--force", "Overwrite samples and config")
  .option("--workspace <path>")
  .action(async (o: { force?: boolean; workspace?: string }) => {
    const root = await initWorkspace(workspaceOf(o.workspace), { force: o.force });
    const { db } = await loadDb(root);
    console.log(`Initialized Easy Items workspace at ${root}`);
    console.log(`  items/    *.easyitems.json — ${db.items.length} items, ${db.shops.length} shops, ${db.loot.length} loot tables, ${db.recipes.length} recipes`);
    console.log("  quests/   Easy Quest .ezq files cross-checked by `easyitems check`");
    console.log("  exports/  Godot / PixiJS / PNG / JSON");
  });

program
  .command("info")
  .description("Workspace summary")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { workspace?: string; json?: boolean }) => {
    const s = await workspaceSummary(workspaceOf(o.workspace));
    if (o.json) return console.log(JSON.stringify(s, null, 2));
    console.log(`Easy Items workspace ${s.root}`);
    console.log(`  docs: ${s.docs.join(", ") || "(none)"} · ${s.items.length} items · ${s.shops.length} shops · ${s.loot.length} loot tables · ${s.recipes.length} recipes`);
    console.log(`  rules: ${s.rules.slots} slots · start ${s.rules.startingCoins} ${s.rules.currency} · equip ${s.rules.equipSlots.join("/")} · icons ${s.rules.iconSize}px`);
    console.log(`  ${s.icons} built-in icons · export: ${EXPORT_PRESETS.join(", ")}${s.errors.length ? ` · ${s.errors.length} ERRORS (run check)` : ""}`);
  });

program
  .command("list")
  .description("List items")
  .option("--category <c>", CATEGORIES.join(" | "))
  .option("--tag <tag>")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { category?: string; tag?: string; workspace?: string; json?: boolean }) => {
    try {
      const { db } = await loadDb(workspaceOf(o.workspace));
      const sel = db.items.filter((i) => (!o.category || i.category === o.category) && (!o.tag || i.tags?.includes(o.tag))).map(itemSummary);
      if (o.json) return console.log(JSON.stringify({ items: sel }, null, 2));
      for (const s of sel) console.log(`${s.id.padEnd(18)} ${s.category.padEnd(10)} ฿${String(s.price).padStart(4)} ×${String(s.stack).padEnd(3)} ${s.equip ? `[${s.equip}] ` : ""}${s.th} · ${s.en}${s.ms ? ` · ${s.ms}` : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("show")
  .description("One item as JSON, with the shops that sell it and the recipes that use or make it")
  .argument("<id>")
  .option("--workspace <path>")
  .action(async (id: string, o: { workspace?: string }) => {
    try {
      const { db } = await loadDb(workspaceOf(o.workspace));
      const it = db.items.find((i) => i.id === id);
      if (!it) throw new Error(`Item "${id}" not found (try: easyitems list)`);
      const inv = new Inventory(db);
      const shops = db.shops.filter((s) => s.stock.some((e) => e.item === id)).map((s) => ({ shop: s.id, buy: inv.buyPrice(s.id, id), sell: inv.sellPrice(s.id, id) }));
      const recipes = db.recipes.filter((r) => [...r.inputs, ...r.outputs].some((e) => e.item === id)).map((r) => r.id);
      console.log(JSON.stringify({ ...it, shops, recipes, source: db.sources[`items:${id}`] }, null, 2));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("shops")
  .description("List shops, or one shop's stock with buy / sell prices")
  .argument("[id]")
  .option("--lang <lang>", "th | en | ms", "th")
  .option("--workspace <path>")
  .option("--json")
  .action(async (id: string | undefined, o: { lang: string; workspace?: string; json?: boolean }) => {
    try {
      const db = await loadDbStrict(workspaceOf(o.workspace));
      const inv = new Inventory(db);
      const lang = o.lang as "th" | "en" | "ms";
      const sel = id ? db.shops.filter((s) => s.id === id) : db.shops;
      if (id && !sel.length) throw new Error(`Shop "${id}" not found`);
      const out = sel.map((s) => ({ id: s.id, name: s.name, keeper: s.keeper, halal: !!s.halal, buyMod: s.buyMod, sellMod: s.sellMod, stock: s.stock.map((e) => ({ item: e.item, qty: e.qty, buy: inv.buyPrice(s.id, e.item), sell: inv.sellPrice(s.id, e.item), restock: e.restock ?? 0 })) }));
      if (o.json) return console.log(JSON.stringify({ shops: out }, null, 2));
      for (const s of out) {
        console.log(`${s.id} · ${s.name[lang] || s.name.th}${s.keeper ? ` (keeper ${s.keeper})` : ""}${s.halal ? " · halal" : ""} · buy ×${s.buyMod} sell ×${s.sellMod}`);
        if (id || out.length === 1) for (const e of s.stock) console.log(`  ${e.item.padEnd(18)} ฿${String(e.buy).padStart(4)}  sell ${e.sell === null ? "  -" : `฿${String(e.sell).padStart(3)}`}  qty ${e.qty === -1 ? "∞" : e.qty}${e.restock ? ` (+${e.restock}d)` : ""}  ${inv.item(e.item).name[lang] || inv.item(e.item).name.th}`);
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("icons")
  .description("Built-in icon names")
  .option("--json")
  .option("--workspace <path>", "Ignored (icons are built in)")
  .action((o: { json?: boolean }) => {
    if (o.json) return console.log(JSON.stringify(ICON_NAMES.map((n) => ({ name: n, th: ICONS[n]!.th, en: ICONS[n]!.en })), null, 2));
    for (const n of ICON_NAMES) console.log(`${n.padEnd(18)} ${ICONS[n]!.th} · ${ICONS[n]!.en}`);
  });

program
  .command("check")
  .description("Validate the item database and cross-check Easy Quest item ids. Exit code 1 on errors")
  .option("--quests <path>", "Extra .ezq file or folder (repeatable; config `quests` is always read)", collect, [])
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { quests: string[]; workspace?: string; json?: boolean }) => {
    try {
      const r = await checkWorkspace(workspaceOf(o.workspace), o.quests);
      if (o.json) console.log(JSON.stringify({ errors: r.errors, warnings: r.warnings, quests: { files: r.quests.files, matched: r.quests.matched, missing: r.quests.missing } }, null, 2));
      else {
        for (const d of [...r.errors, ...r.warnings]) console.error(`${d.severity}: ${d.path}: ${d.message}`);
        console.log(`${r.errors.length ? "FAIL" : "ok  "} ${r.db.items.length} items · ${r.errors.length} errors · ${r.warnings.length} warnings`);
        if (r.quests.files.length) console.log(`  quests: ${r.quests.files.length} files · ${r.quests.matched.length} item ids matched${r.quests.missing.length ? ` · missing: ${r.quests.missing.join(", ")}` : ""}`);
      }
      if (r.errors.length) process.exit(1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("render")
  .description("Icon sheet PNG of items (default: every item), or of the built-in icons with --icons")
  .argument("[ids...]")
  .requiredOption("--out <png>")
  .option("--icons", "All built-in icons instead of items")
  .option("--size <px>", "24 or 32")
  .option("--scale <n>", "Upscale (default 2)")
  .option("--cols <n>", "Icons per row (default 10)")
  .option("--workspace <path>")
  .action(async (ids: string[], o: { out: string; icons?: boolean; size?: string; scale?: string; cols?: string; workspace?: string }) => {
    try {
      const size = o.size ? Number(o.size) : undefined;
      if (size !== undefined && size !== 24 && size !== 32) throw new Error("--size must be 24 or 32");
      let names: string[];
      if (o.icons) names = ids.length ? ids : ICON_NAMES;
      else {
        const { db } = await loadDb(workspaceOf(o.workspace));
        const pick = ids.length ? ids.map((id) => db.items.find((i) => i.id === id) ?? (() => { throw new Error(`Item "${id}" not found`); })()) : db.items;
        names = pick.map((i: Item) => i.icon);
      }
      const r = itemSheetPng(names, { size: size ?? 24, scale: o.scale ? Number(o.scale) : 2, cols: o.cols ? Number(o.cols) : undefined });
      await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
      await writeFile(o.out, r.png);
      console.log(`wrote ${o.out}\n  ${r.count} icons · ${r.width}×${r.height}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("loot")
  .description("Roll a loot table (deterministic per seed)")
  .argument("<table>")
  .option("--seed <n>", "Seed", "1")
  .option("--times <n>", "Roll with seed, seed+1, …", "1")
  .option("--workspace <path>")
  .option("--json")
  .action(async (table: string, o: { seed: string; times: string; workspace?: string; json?: boolean }) => {
    try {
      const db = await loadDbStrict(workspaceOf(o.workspace));
      const t = db.loot.find((x) => x.id === table);
      if (!t) throw new Error(`Loot table "${table}" not found (${db.loot.map((x) => x.id).join(", ")})`);
      const out = Array.from({ length: Number(o.times) }, (_, i) => ({ seed: Number(o.seed) + i, items: rollLoot(db, table, Number(o.seed) + i) }));
      if (o.json) return console.log(JSON.stringify(out, null, 2));
      console.log(`${table} · rolls ${fmtRolls(t.rolls)} · ${t.entries.length} entries`);
      for (const r of out) console.log(`  seed ${String(r.seed).padEnd(6)} ${r.items.map((s) => `${s.item}×${s.n}`).join(", ") || "(nothing)"}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("skills")
  .description("Life skills (farming, fishing, cooking): XP per level, crops, fishing spots and skill recipes")
  .option("--lang <th|en|ms>", "Language", "th")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { lang: string; workspace?: string; json?: boolean }) => {
    try {
      const db = await loadDbStrict(workspaceOf(o.workspace));
      if (o.json) return console.log(JSON.stringify({ skills: db.skills, crops: db.crops, fishing: db.fishing, recipes: db.recipes.filter((r) => r.skill) }, null, 2));
      const nm = (t?: { th: string; en: string; ms?: string }) => (t ? ((t as Record<string, string>)[o.lang] || t.en) : "");
      for (const s of db.skills) console.log(`${s.id.padEnd(10)} ${nm(s.name).padEnd(12)} lv1..${s.maxLevel ?? 10}  XP: ${Array.from({ length: Math.min(5, (s.maxLevel ?? 10) - 1) }, (_, i) => `L${i + 2}=${xpForLevel(s, i + 2)}`).join(" ")} …`);
      for (const c of db.crops) console.log(`  crop  ${c.id.padEnd(16)} ${c.seed} → ${c.produce} ×${(c.yield ?? [1, 2]).join("-")}  ${c.days} watered days  ${c.seasons?.join("/") ?? "any season"}  +${c.xp ?? 5}xp`);
      for (const f of db.fishing) console.log(`  fish  ${f.id.padEnd(16)} loot ${f.loot}  bite ${f.bite ?? 0.6}  lv ${f.minLevel ?? 1}+  +${f.xp ?? 5}xp${f.tool ? `  needs ${f.tool}` : ""}`);
      for (const r of db.recipes.filter((x) => x.skill)) console.log(`  cook  ${r.id.padEnd(16)} ${r.skill} lv ${r.level ?? 1}+  +${r.xp ?? 5}xp  ${r.inputs.map((e) => `${e.item}×${e.n}`).join(" + ")} → ${r.outputs.map((e) => `${e.item}×${e.n}`).join(", ")}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("add-item")
  .description("Add or replace an item in items/<doc>.easyitems.json (created if missing)")
  .argument("<id>")
  .requiredOption("--th <name>")
  .requiredOption("--en <name>")
  .requiredOption("--icon <icon>", "Built-in icon (see: easyitems icons)")
  .option("--ms <name>")
  .option("--category <c>", CATEGORIES.join(" | "), "material")
  .option("--price <n>", "Coins", "10")
  .option("--stack <n>", "Max per slot", "20")
  .option("--tag <tag>", "Repeatable", collect, [])
  .option("--doc <id>", "Document id", "game")
  .option("--workspace <path>")
  .action(async (id: string, o: { th: string; en: string; ms?: string; icon: string; category: string; price: string; stack: string; tag: string[]; doc: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      assertSafeId(id, "item id");
      const file = docPath(root, o.doc);
      const doc: ItemsDoc = existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as ItemsDoc) : { format: FORMAT, id: o.doc, items: [] };
      const item: Item = { id, name: { th: o.th, en: o.en, ...(o.ms ? { ms: o.ms } : {}) }, category: o.category as Item["category"], price: Number(o.price), stack: Number(o.stack), icon: o.icon, ...(o.tag.length ? { tags: o.tag } : {}) };
      doc.items = [...(doc.items ?? []).filter((i) => i.id !== id), item];
      const r = await saveDoc(root, o.doc, doc);
      if (!r.saved) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
      console.log(`wrote ${r.file}`);
      r.warnings.forEach((w) => console.log(`  warning: ${w.path}: ${w.message}`));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("export")
  .description("Export: godot | pixi | png | json | all")
  .option("--preset <preset>", EXPORT_PRESETS.join(" | "), "all")
  .option("--out <dir>", "Output folder (single preset; default exports/easyitems-<preset>)")
  .option("--size <px>", "Icon size 24 or 32 (default: rules.iconSize)")
  .option("--scale <n>", "Also write upscaled icons in the png export")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { preset: string; out?: string; size?: string; scale?: string; workspace?: string; json?: boolean }) => {
    try {
      const size = o.size ? Number(o.size) : undefined;
      if (size !== undefined && size !== 24 && size !== 32) throw new Error("--size must be 24 or 32");
      const res = await exportItems(workspaceOf(o.workspace), { preset: o.preset as ExportPreset, out: o.out, iconSize: size as 24 | 32 | undefined, scale: o.scale ? Number(o.scale) : undefined, trustedPaths: true });
      if (o.json) return console.log(JSON.stringify(res, null, 2));
      for (const d of res.dirs) console.log(`exported ${d}`);
      console.log(`  ${res.items} items · ${res.shops} shops · ${res.files.length} files`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("serve")
  .description("Web editor + API (default http://127.0.0.1:8878)")
  .option("--port <port>", "Port", "8878")
  .option("--host <host>", "Interface (non-loopback requires the printed token)", "127.0.0.1")
  .option("--dev", "API only; use the Vite UI on :5185")
  .option("--open", "Open the browser")
  .option("--workspace <path>")
  .action(async (o: { port: string; host: string; dev?: boolean; open?: boolean; workspace?: string }) => {
    const root = workspaceOf(o.workspace);
    if (!existsSync(dirs(root).items)) await initWorkspace(root);
    await loadConfig(root);
    const token = resolveToken(o.host);
    const app = createApp({ workspaceRoot: root, webRoot: defaultWebRoot(), dev: o.dev, host: o.host, token });
    const port = Number(o.port);
    serve({ fetch: app.fetch, port, hostname: o.host }, () => {
      const url = `http://${o.host === "0.0.0.0" ? "127.0.0.1" : o.host}:${port}/`;
      console.log(`Easy Items ${o.dev ? "API (dev)" : "editor"} → ${url}`);
      console.log(`Workspace ${root}`);
      if (token) console.log(`Token (needed off-loopback): ${url}?token=${token}`);
      if (o.dev) console.log("Run the UI with: npx vite --config web/vite.config.ts");
      if (o.open) void open(o.dev ? "http://127.0.0.1:5185" : url);
    });
  });

program.parseAsync(process.argv).catch(fail);
