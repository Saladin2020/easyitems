/**
 * Read item ids out of Easy Quest files without depending on Easy Quest: `.ezq` text (`@item id`, `give id n`,
 * `take id n`, `has(id)`, `count(id)`) and exported quest JSON (`items` map + `give` / `take` effects).
 */
import { suggest } from "./db.js";
import type { Diagnostic, ItemsDb } from "./types.js";

export interface QuestItemRef {
  id: string;
  file: string;
  line: number;
  how: "item" | "give" | "take" | "expr";
  name?: string;
}

export function questItemRefs(file: string, body: string): QuestItemRef[] {
  const out: QuestItemRef[] = [];
  if (file.endsWith(".json")) {
    let j: unknown;
    try {
      j = JSON.parse(body);
    } catch {
      return out;
    }
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (typeof v !== "object" || v === null) return;
      const o = v as Record<string, unknown>;
      for (const k of ["give", "take"] as const) if (typeof o[k] === "string") out.push({ id: o[k] as string, file, line: 0, how: k });
      for (const x of Object.values(o)) walk(x);
    };
    const items = (j as { items?: Record<string, { name?: string }> }).items;
    if (items && typeof items === "object") for (const [id, v] of Object.entries(items)) out.push({ id, file, line: 0, how: "item", name: v?.name });
    walk((j as { quests?: unknown }).quests);
    return out;
  }
  body.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "");
    let m = /^\s*@item\s+([a-z0-9_-]+)(?:\s+"([^"]*)")?/.exec(line);
    if (m) out.push({ id: m[1]!, file, line: i + 1, how: "item", name: m[2] });
    m = /^\s*(give|take)\s+([a-z0-9_-]+)/.exec(line);
    if (m) out.push({ id: m[2]!, file, line: i + 1, how: m[1] as "give" | "take" });
    for (const e of line.matchAll(/\b(?:has|count)\(\s*([a-z0-9_-]+)\s*\)/g)) out.push({ id: e[1]!, file, line: i + 1, how: "expr" });
  });
  return out;
}

export interface QuestCrossRef {
  files: string[];
  matched: string[];
  missing: string[];
  diagnostics: Diagnostic[];
}

/** Every quest item id should exist in the item database (warnings: quests may keep quest-only items). */
export function crossRefQuests(db: ItemsDb, files: Array<{ file: string; body: string }>): QuestCrossRef {
  const ids = new Set(db.items.map((i) => i.id));
  const refs = files.flatMap((f) => questItemRefs(f.file, f.body));
  const matched = new Set<string>();
  const missing = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const r of refs) {
    if (ids.has(r.id)) {
      matched.add(r.id);
      continue;
    }
    if (!missing.has(r.id))
      diagnostics.push({ path: `${r.file}${r.line ? `:${r.line}` : ""}`, message: `quest item "${r.id}"${r.name ? ` (${r.name})` : ""} has no Easy Items entry${suggest(r.id, [...ids])}`, severity: "warning" });
    missing.add(r.id);
  }
  return { files: files.map((f) => f.file), matched: [...matched].sort(), missing: [...missing].sort(), diagnostics };
}
