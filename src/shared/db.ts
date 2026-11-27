import { CATEGORIES, DEFAULT_RULES, EFFECT_KINDS, FORMAT, ICON_SIZES, RARITIES, type Diagnostic, type Item, type ItemsDb, type ItemsDoc, type Rules } from "./types.js";
import { isIcon } from "./icons.js";

export const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;

/** Words that may not appear in a halal shop's stock (name, tags or category), checked in Thai, English and Malay. */
export const NOT_HALAL = ["pork", "bacon", "ham", "lard", "alcohol", "beer", "wine", "whisky", "liquor", "sato", "หมู", "เบคอน", "แฮม", "เหล้า", "เบียร์", "ไวน์", "สาโท", "babi", "arak", "bir"];

/** Banned in any item: scripture or calligraphy as an object, depictions of the Prophet or sacred figures. */
export const BANNED_CONTENT = ["quran", "qur'an", "koran", "อัลกุรอาน", "calligraphy", "อักษรวิจิตร", "khat", "prophet", "ศาสดา", "nabi"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export class Diags {
  list: Diagnostic[] = [];
  err(path: string, message: string) {
    this.list.push({ path, message, severity: "error" });
  }
  warn(path: string, message: string) {
    this.list.push({ path, message, severity: "warning" });
  }
  get errors() {
    return this.list.filter((d) => d.severity === "error");
  }
  get warnings() {
    return this.list.filter((d) => d.severity === "warning");
  }
}

function text(d: Diags, p: string, v: unknown, required = true) {
  if (v === undefined && !required) return;
  if (!isObj(v)) return d.err(p, "expected { th, en, ms? }");
  if (typeof v.th !== "string" || !v.th.trim()) d.err(`${p}.th`, "Thai text required");
  if (typeof v.en !== "string" || !v.en.trim()) d.err(`${p}.en`, "English text required");
  if (v.ms !== undefined && typeof v.ms !== "string") d.err(`${p}.ms`, "string");
}
const int = (v: unknown, min: number, max = Infinity) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const num = (v: unknown, min: number, max = Infinity) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

function itemWords(it: Item): string {
  return [it.id, it.name?.th, it.name?.en, it.name?.ms, it.desc?.th, it.desc?.en, ...(it.tags ?? []), it.category].join(" ").toLowerCase();
}
export function isNotHalal(it: Item): boolean {
  if (it.halal === false) return true;
  const w = itemWords(it);
  return NOT_HALAL.some((b) => new RegExp(`(^|[^a-z])${b}([^a-z]|$)`).test(w) || (!/^[a-z' ]+$/.test(b) && w.includes(b)));
}

/** Shape check of one document (no cross references). */
export function checkDoc(raw: unknown, d = new Diags(), file = ""): ItemsDoc | undefined {
  const at = (p: string) => (file ? `${file}:${p}` : p);
  if (!isObj(raw)) {
    d.err(at(""), "document must be an object");
    return undefined;
  }
  if (raw.format !== FORMAT) d.err(at("format"), `must be "${FORMAT}"`);
  if (raw.name !== undefined) text(d, at("name"), raw.name);
  if (raw.rules !== undefined) {
    if (!isObj(raw.rules)) d.err(at("rules"), "object");
    else {
      const r = raw.rules;
      if (r.slots !== undefined && !int(r.slots, 1, 200)) d.err(at("rules.slots"), "integer 1..200");
      if (r.startingCoins !== undefined && !int(r.startingCoins, 0)) d.err(at("rules.startingCoins"), "integer ≥ 0");
      if (r.iconSize !== undefined && !ICON_SIZES.includes(r.iconSize as 24)) d.err(at("rules.iconSize"), `one of ${ICON_SIZES.join(", ")}`);
      if (r.equipSlots !== undefined && (!Array.isArray(r.equipSlots) || r.equipSlots.some((s) => typeof s !== "string" || !SAFE_ID.test(s)))) d.err(at("rules.equipSlots"), "array of ids");
      if (r.startingItems !== undefined && !Array.isArray(r.startingItems)) d.err(at("rules.startingItems"), "array of { item, n }");
    }
  }
  for (const k of ["items", "shops", "loot", "recipes", "skills", "crops", "fishing"] as const) if (raw[k] !== undefined && !Array.isArray(raw[k])) d.err(at(k), "array");
  const arr = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]) : []);
  arr("items").forEach((v, i) => {
    const p = at(`items[${i}]`);
    if (!isObj(v)) return d.err(p, "object");
    if (typeof v.id !== "string" || !SAFE_ID.test(v.id)) d.err(`${p}.id`, "id: a-z, 0-9, _ or -");
    text(d, `${p}.name`, v.name);
    text(d, `${p}.desc`, v.desc, false);
    if (!CATEGORIES.includes(v.category as "food")) d.err(`${p}.category`, `one of ${CATEGORIES.join(", ")}`);
    if (!int(v.price, 0, 1_000_000)) d.err(`${p}.price`, "integer ≥ 0");
    if (!int(v.stack, 1, 999)) d.err(`${p}.stack`, "integer 1..999");
    if (typeof v.icon !== "string") d.err(`${p}.icon`, "icon name");
    else if (!isIcon(v.icon)) d.err(`${p}.icon`, `unknown icon "${v.icon}" (see: easyitems icons)`);
    if (v.rarity !== undefined && !RARITIES.includes(v.rarity as "common")) d.err(`${p}.rarity`, RARITIES.join(" | "));
    for (const k of ["halal", "sellable", "consumable"] as const) if (v[k] !== undefined && typeof v[k] !== "boolean") d.err(`${p}.${k}`, "true or false");
    if (v.tags !== undefined && (!Array.isArray(v.tags) || v.tags.some((t) => typeof t !== "string"))) d.err(`${p}.tags`, "string array");
    if (v.effects !== undefined) {
      if (!Array.isArray(v.effects)) d.err(`${p}.effects`, "array");
      else
        v.effects.forEach((e, j) => {
          if (!isObj(e) || !EFFECT_KINDS.includes(e.kind as "heal")) return d.err(`${p}.effects[${j}].kind`, EFFECT_KINDS.join(" | "));
          if (!num(e.amount, -10_000, 10_000)) d.err(`${p}.effects[${j}].amount`, "number");
          if (e.kind === "stat" && typeof e.stat !== "string") d.err(`${p}.effects[${j}].stat`, "stat name required for kind stat");
        });
    }
    if (v.equip !== undefined) {
      if (!isObj(v.equip) || typeof v.equip.slot !== "string") d.err(`${p}.equip`, "{ slot, stats? }");
      else if (v.equip.stats !== undefined && (!isObj(v.equip.stats) || Object.values(v.equip.stats).some((n) => !num(n, -1000, 1000)))) d.err(`${p}.equip.stats`, "{ name: number }");
      if (int(v.stack, 2)) d.warn(`${p}.stack`, "equipment usually has stack 1");
    }
    const words = JSON.stringify(v).toLowerCase();
    for (const b of BANNED_CONTENT) if (words.includes(b)) d.err(p, `content rule: no scripture, calligraphy or sacred figures as items ("${b}")`);
  });
  arr("shops").forEach((v, i) => {
    const p = at(`shops[${i}]`);
    if (!isObj(v)) return d.err(p, "object");
    if (typeof v.id !== "string" || !SAFE_ID.test(v.id)) d.err(`${p}.id`, "id: a-z, 0-9, _ or -");
    text(d, `${p}.name`, v.name);
    if (!num(v.buyMod, 0.01, 100)) d.err(`${p}.buyMod`, "number > 0 (1 = list price)");
    if (!num(v.sellMod, 0, 1)) d.err(`${p}.sellMod`, "number 0..1 (0 = does not buy)");
    if (v.tagMods !== undefined && (!isObj(v.tagMods) || Object.values(v.tagMods).some((n) => !num(n, 0.01, 100)))) d.err(`${p}.tagMods`, "{ tag: multiplier }");
    if (v.buys !== undefined && (!Array.isArray(v.buys) || v.buys.some((c) => !CATEGORIES.includes(c as "food")))) d.err(`${p}.buys`, "array of categories");
    if (!Array.isArray(v.stock)) d.err(`${p}.stock`, "array of { item, qty, price?, restock? }");
    else
      v.stock.forEach((s, j) => {
        if (!isObj(s) || typeof s.item !== "string") return d.err(`${p}.stock[${j}]`, "{ item, qty }");
        if (!int(s.qty, -1)) d.err(`${p}.stock[${j}].qty`, "integer ≥ 0, or -1 for unlimited");
        if (s.price !== undefined && !int(s.price, 0)) d.err(`${p}.stock[${j}].price`, "integer ≥ 0");
        if (s.restock !== undefined && !int(s.restock, 0)) d.err(`${p}.stock[${j}].restock`, "days, integer ≥ 0");
      });
  });
  arr("loot").forEach((v, i) => {
    const p = at(`loot[${i}]`);
    if (!isObj(v)) return d.err(p, "object");
    if (typeof v.id !== "string" || !SAFE_ID.test(v.id)) d.err(`${p}.id`, "id: a-z, 0-9, _ or -");
    const r = v.rolls;
    if (!(int(r, 0, 50) || (Array.isArray(r) && r.length === 2 && int(r[0], 0, 50) && int(r[1], r[0] as number, 50)))) d.err(`${p}.rolls`, "integer or [min, max]");
    if (!Array.isArray(v.entries) || !v.entries.length) d.err(`${p}.entries`, "non-empty array");
    else
      v.entries.forEach((e, j) => {
        if (!isObj(e) || !num(e.weight, 0.0001)) return d.err(`${p}.entries[${j}].weight`, "number > 0");
        if (e.item !== undefined && typeof e.item !== "string") d.err(`${p}.entries[${j}].item`, "item id (omit for nothing)");
        const mn = e.min ?? 1;
        const mx = e.max ?? mn;
        if (!int(mn, 1, 999) || !int(mx, mn as number, 999)) d.err(`${p}.entries[${j}]`, "min ≤ max, 1..999");
      });
  });
  arr("recipes").forEach((v, i) => {
    const p = at(`recipes[${i}]`);
    if (!isObj(v)) return d.err(p, "object");
    if (typeof v.id !== "string" || !SAFE_ID.test(v.id)) d.err(`${p}.id`, "id: a-z, 0-9, _ or -");
    text(d, `${p}.name`, v.name);
    for (const k of ["inputs", "outputs"] as const) {
      if (!Array.isArray(v[k]) || !(v[k] as unknown[]).length) d.err(`${p}.${k}`, "non-empty array of { item, n }");
      else (v[k] as unknown[]).forEach((e, j) => (!isObj(e) || typeof e.item !== "string" || !int(e.n, 1, 999)) && d.err(`${p}.${k}[${j}]`, "{ item, n ≥ 1 }"));
    }
    if (v.skill !== undefined && (typeof v.skill !== "string" || !SAFE_ID.test(v.skill))) d.err(`${p}.skill`, "life skill id");
    if (v.level !== undefined && !int(v.level, 1, 100)) d.err(`${p}.level`, "integer 1..100");
    if (v.xp !== undefined && !int(v.xp, 0, 10_000)) d.err(`${p}.xp`, "integer ≥ 0");
  });
  arr("skills").forEach((v, i) => {
    const p = at(`skills[${i}]`);
    if (!isObj(v)) return d.err(p, "object");
    if (typeof v.id !== "string" || !SAFE_ID.test(v.id)) d.err(`${p}.id`, "id: a-z, 0-9, _ or -");
    text(d, `${p}.name`, v.name);
    if (v.maxLevel !== undefined && !int(v.maxLevel, 1, 100)) d.err(`${p}.maxLevel`, "integer 1..100");
    if (v.xpBase !== undefined && !int(v.xpBase, 1, 10_000)) d.err(`${p}.xpBase`, "integer ≥ 1");
    if (v.icon !== undefined && (typeof v.icon !== "string" || !isIcon(v.icon))) d.err(`${p}.icon`, "built-in icon name");
  });
  arr("crops").forEach((v, i) => {
    const p = at(`crops[${i}]`);
    if (!isObj(v)) return d.err(p, "object");
    if (typeof v.id !== "string" || !SAFE_ID.test(v.id)) d.err(`${p}.id`, "id: a-z, 0-9, _ or -");
    text(d, `${p}.name`, v.name, false);
    for (const k of ["seed", "produce"] as const) if (typeof v[k] !== "string") d.err(`${p}.${k}`, "item id");
    if (!int(v.days, 1, 120)) d.err(`${p}.days`, "integer 1..120 (watered days to grow)");
    if (v.seasons !== undefined && (!Array.isArray(v.seasons) || v.seasons.some((x) => typeof x !== "string"))) d.err(`${p}.seasons`, "array of Easy NPC season ids");
    const y = v.yield;
    if (y !== undefined && !(Array.isArray(y) && y.length === 2 && int(y[0], 1, 99) && int(y[1], y[0] as number, 99))) d.err(`${p}.yield`, "[min, max]");
    if (v.xp !== undefined && !int(v.xp, 0, 10_000)) d.err(`${p}.xp`, "integer ≥ 0");
  });
  arr("fishing").forEach((v, i) => {
    const p = at(`fishing[${i}]`);
    if (!isObj(v)) return d.err(p, "object");
    if (typeof v.id !== "string" || !SAFE_ID.test(v.id)) d.err(`${p}.id`, "id: a-z, 0-9, _ or -");
    text(d, `${p}.name`, v.name, false);
    if (typeof v.loot !== "string") d.err(`${p}.loot`, "loot table id");
    if (v.bite !== undefined && !num(v.bite, 0.01, 1)) d.err(`${p}.bite`, "number 0.01..1");
    if (v.minLevel !== undefined && !int(v.minLevel, 1, 100)) d.err(`${p}.minLevel`, "integer ≥ 1");
    if (v.xp !== undefined && !int(v.xp, 0, 10_000)) d.err(`${p}.xp`, "integer ≥ 0");
    if (v.tool !== undefined && typeof v.tool !== "string") d.err(`${p}.tool`, "item id");
  });
  return raw as unknown as ItemsDoc;
}

/** Merge documents (in order) into one database, then cross-check references and content rules. */
export function buildDb(docs: Array<{ file: string; doc: unknown }>): { db: ItemsDb; errors: Diagnostic[]; warnings: Diagnostic[] } {
  const d = new Diags();
  const db: ItemsDb = { rules: { ...DEFAULT_RULES, equipSlots: [...DEFAULT_RULES.equipSlots] }, items: [], shops: [], loot: [], recipes: [], skills: [], crops: [], fishing: [], sources: {} };
  let rulesFrom = "";
  for (const { file, doc: raw } of docs) {
    const before = d.errors.length;
    const doc = checkDoc(raw, d, file);
    if (!doc || d.errors.length > before) continue;
    if (doc.rules) {
      if (rulesFrom) d.warn(`${file}:rules`, `rules also set in ${rulesFrom}; later file wins`);
      rulesFrom = file;
      db.rules = { ...db.rules, ...doc.rules } as Rules;
    }
    for (const k of ["items", "shops", "loot", "recipes", "skills", "crops", "fishing"] as const) {
      for (const [i, v] of (doc[k] ?? []).entries()) {
        const key = `${k}:${v.id}`;
        if (db.sources[key]) {
          d.err(`${file}:${k}[${i}].id`, `duplicate ${k.replace(/s$/, "")} id "${v.id}" (also in ${db.sources[key]})`);
          continue;
        }
        db.sources[key] = file;
        (db[k] as Array<typeof v>).push(v);
      }
    }
  }
  const items = new Map(db.items.map((it) => [it.id, it]));
  const where = (k: string, id: string) => db.sources[`${k}:${id}`] ?? "";
  const ref = (p: string, id: string) => {
    if (!items.has(id)) d.err(p, `unknown item "${id}"${suggest(id, [...items.keys()])}`);
  };
  for (const [i, s] of (db.rules.startingItems ?? []).entries()) ref(`rules.startingItems[${i}].item`, s.item);
  for (const it of db.items) {
    const p = `${where("items", it.id)}:items.${it.id}`;
    if (it.equip && !db.rules.equipSlots.includes(it.equip.slot)) d.err(`${p}.equip.slot`, `"${it.equip.slot}" is not in rules.equipSlots (${db.rules.equipSlots.join(", ")})`);
  }
  for (const sh of db.shops) {
    const p = `${where("shops", sh.id)}:shops.${sh.id}`;
    const seen = new Set<string>();
    sh.stock.forEach((s, j) => {
      ref(`${p}.stock[${j}].item`, s.item);
      if (seen.has(s.item)) d.warn(`${p}.stock[${j}].item`, `"${s.item}" listed twice`);
      seen.add(s.item);
      const it = items.get(s.item);
      if (it && it.price === 0 && s.price === undefined) d.warn(`${p}.stock[${j}]`, `"${s.item}" has price 0 (free)`);
      if (it && sh.halal && isNotHalal(it)) d.err(`${p}.stock[${j}].item`, `content rule: halal shop "${sh.id}" may not stock "${s.item}" (pork / alcohol / not halal)`);
    });
  }
  for (const lt of db.loot) {
    const p = `${where("loot", lt.id)}:loot.${lt.id}`;
    lt.entries.forEach((e, j) => e.item !== undefined && ref(`${p}.entries[${j}].item`, e.item));
    (lt.guaranteed ?? []).forEach((g, j) => ref(`${p}.guaranteed[${j}].item`, g.item));
  }
  for (const r of db.recipes) {
    const p = `${where("recipes", r.id)}:recipes.${r.id}`;
    r.inputs.forEach((e, j) => ref(`${p}.inputs[${j}].item`, e.item));
    r.outputs.forEach((e, j) => ref(`${p}.outputs[${j}].item`, e.item));
    if (r.skill && !db.skills.some((x) => x.id === r.skill)) d.err(`${p}.skill`, `unknown life skill "${r.skill}"`);
  }
  for (const c of db.crops) {
    const p = `${where("crops", c.id)}:crops.${c.id}`;
    ref(`${p}.seed`, c.seed);
    ref(`${p}.produce`, c.produce);
  }
  for (const f of db.fishing) {
    const p = `${where("fishing", f.id)}:fishing.${f.id}`;
    if (!db.loot.some((l) => l.id === f.loot)) d.err(`${p}.loot`, `unknown loot table "${f.loot}"`);
    if (f.tool) ref(`${p}.tool`, f.tool);
  }
  if ((db.crops.length && !db.skills.some((x) => x.id === "farming")) || (db.fishing.length && !db.skills.some((x) => x.id === "fishing")))
    d.warn("skills", 'crops / fishing spots give XP to the "farming" / "fishing" skills; add them to skills');
  return { db, errors: d.errors, warnings: d.warnings };
}

export function suggest(id: string, pool: string[]): string {
  let best = "";
  let bestD = 3;
  for (const c of pool) {
    const dd = lev(id, c);
    if (dd < bestD) [best, bestD] = [c, dd];
  }
  return best ? ` (did you mean "${best}"?)` : "";
}
function lev(a: string, b: string): number {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) m[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i]![j] = Math.min(m[i - 1]![j]! + 1, m[i]![j - 1]! + 1, m[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length]![b.length]!;
}

export const itemSummary = (it: Item) => ({ id: it.id, th: it.name.th, en: it.name.en, ms: it.name.ms ?? "", category: it.category, price: it.price, stack: it.stack, icon: it.icon, equip: it.equip?.slot ?? null, tags: it.tags ?? [] });

/** Effective consumable flag. */
export const isConsumable = (it: Item) => it.consumable ?? (!!it.effects?.length && !it.equip);
export const isSellable = (it: Item) => it.sellable ?? it.price > 0;
