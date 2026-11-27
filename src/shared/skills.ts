/**
 * Life skills: farming, fishing and cooking with XP and levels, over the same inventory as the item engine.
 * Pure and deterministic (mulberry32 seeds), mirrored by runtime/pixi/easyitems-core.js (LifeSkills) and
 * runtime/godot/easyitems.gd (life_*); tests replay SKILLS_SCRIPT through all three.
 *
 * Weather comes from Easy NPC: pass `rained` (rain / storm water every plot) and `fishing` (bite multiplier).
 */
import { Inventory, rollLoot, type Slot } from "./engine.js";
import { mulberry32, rint } from "./rng.js";
import type { ItemsDb, LifeSkill } from "./types.js";

export interface Plot {
  crop: string;
  planted: number;
  /** Days watered so far. */
  water: number;
  /** Last day watered (-1 never). */
  last: number;
}

export interface LifeState {
  xp: Record<string, number>;
  plots: Record<string, Plot>;
}

export type LifeResult =
  | { ok: true; items?: Slot[]; xp?: number; skill?: string; level?: number; levelUp?: boolean; bite?: boolean }
  | { ok: false; reason: string; xp?: number; skill?: string; level?: number; levelUp?: boolean };

const DEF_SKILL: Required<Omit<LifeSkill, "id" | "name" | "icon">> = { maxLevel: 10, xpBase: 20 };

/** Total XP needed to reach `level`. */
export function xpForLevel(sk: LifeSkill | undefined, level: number): number {
  const base = sk?.xpBase ?? DEF_SKILL.xpBase;
  return (base * (level - 1) * level) / 2;
}

export function levelFor(sk: LifeSkill | undefined, xp: number): number {
  const max = sk?.maxLevel ?? DEF_SKILL.maxLevel;
  let l = 1;
  while (l < max && xp >= xpForLevel(sk, l + 1)) l++;
  return l;
}

export class LifeSkills {
  state: LifeState;
  constructor(readonly db: ItemsDb, readonly inv: Inventory, state?: LifeState) {
    this.state = state ? (JSON.parse(JSON.stringify(state)) as LifeState) : { xp: {}, plots: {} };
  }

  skill(id: string): LifeSkill | undefined {
    return this.db.skills.find((s) => s.id === id);
  }
  xp(id: string): number {
    return this.state.xp[id] ?? 0;
  }
  level(id: string): number {
    return levelFor(this.skill(id), this.xp(id));
  }
  /** { level, xp, into, need } — `into` XP inside this level, `need` XP to the next (0 at max). */
  progress(id: string): { level: number; xp: number; into: number; need: number } {
    const sk = this.skill(id);
    const xp = this.xp(id);
    const level = levelFor(sk, xp);
    const max = sk?.maxLevel ?? DEF_SKILL.maxLevel;
    const lo = xpForLevel(sk, level);
    return { level, xp, into: xp - lo, need: level >= max ? 0 : xpForLevel(sk, level + 1) - lo };
  }
  gain(id: string, n: number): { skill: string; xp: number; level: number; levelUp: boolean } {
    const before = this.level(id);
    this.state.xp[id] = this.xp(id) + n;
    const level = this.level(id);
    return { skill: id, xp: n, level, levelUp: level > before };
  }

  // ---------- farming ----------
  plant(plot: string, cropId: string, day: number, season?: string): LifeResult {
    const c = this.db.crops.find((x) => x.id === cropId);
    if (!c) return { ok: false, reason: "unknown_crop" };
    if (this.state.plots[plot]) return { ok: false, reason: "plot_busy" };
    if (season !== undefined && c.seasons && !c.seasons.includes(season)) return { ok: false, reason: "wrong_season" };
    if (!this.inv.has(c.seed, 1)) return { ok: false, reason: `missing:${c.seed}` };
    this.inv.remove(c.seed, 1);
    this.state.plots[plot] = { crop: c.id, planted: day, water: 0, last: -1 };
    return { ok: true, ...this.gain("farming", 1) };
  }
  water(plot: string, day: number): LifeResult {
    const p = this.state.plots[plot];
    if (!p) return { ok: false, reason: "empty_plot" };
    if (p.last === day) return { ok: false, reason: "already_watered" };
    p.last = day;
    p.water++;
    return { ok: true };
  }
  /** Call at the start of each day with the day's weather: rain / storm water every plot. */
  newDay(day: number, rained: boolean): number {
    let n = 0;
    if (rained) for (const id of Object.keys(this.state.plots).sort()) if (this.water(id, day).ok) n++;
    return n;
  }
  /** 0..1 growth of a plot (watered days / crop days). */
  growth(plot: string): number {
    const p = this.state.plots[plot];
    const c = p && this.db.crops.find((x) => x.id === p.crop);
    return !p || !c ? 0 : Math.min(1, p.water / c.days);
  }
  harvest(plot: string, seed: number): LifeResult {
    const p = this.state.plots[plot];
    if (!p) return { ok: false, reason: "empty_plot" };
    const c = this.db.crops.find((x) => x.id === p.crop)!;
    if (p.water < c.days) return { ok: false, reason: "not_ready" };
    const [mn, mx] = c.yield ?? [1, 2];
    const n = rint(mulberry32(seed), mn, mx) + Math.floor((this.level("farming") - 1) / 3);
    if (this.inv.add(c.produce, n) > 0) return { ok: false, reason: "inventory_full" };
    delete this.state.plots[plot];
    return { ok: true, items: [{ item: c.produce, n }], ...this.gain("farming", c.xp ?? 5) };
  }

  // ---------- fishing ----------
  biteChance(spotId: string, weatherMult = 1): number {
    const s = this.db.fishing.find((x) => x.id === spotId);
    if (!s) return 0;
    return Math.min(0.95, (s.bite ?? 0.6) * (1 + 0.05 * (this.level("fishing") - 1)) * weatherMult);
  }
  fish(spotId: string, seed: number, weatherMult = 1): LifeResult {
    const s = this.db.fishing.find((x) => x.id === spotId);
    if (!s) return { ok: false, reason: "unknown_spot" };
    if (this.level("fishing") < (s.minLevel ?? 1)) return { ok: false, reason: `level_low:${s.minLevel}` };
    if (s.tool && !this.inv.has(s.tool, 1)) return { ok: false, reason: `missing:${s.tool}` };
    if (mulberry32(seed)() >= this.biteChance(spotId, weatherMult)) return { ok: false, reason: "no_bite", ...this.gain("fishing", 1) };
    const items = rollLoot(this.db, s.loot, seed + 1);
    for (const it of items) if (this.inv.add(it.item, it.n) > 0) return { ok: false, reason: "inventory_full" };
    return { ok: true, bite: true, items, ...this.gain("fishing", s.xp ?? 5) };
  }

  // ---------- cooking / skill crafting ----------
  canCook(recipeId: string): LifeResult {
    const r = this.db.recipes.find((x) => x.id === recipeId);
    if (!r) return { ok: false, reason: "unknown_recipe" };
    if (r.skill && this.level(r.skill) < (r.level ?? 1)) return { ok: false, reason: `level_low:${r.level}` };
    const c = this.inv.canCraft(recipeId, 1);
    return c.ok ? { ok: true, items: c.items } : { ok: false, reason: c.reason };
  }
  cook(recipeId: string, times = 1): LifeResult {
    const r = this.db.recipes.find((x) => x.id === recipeId);
    if (!r) return { ok: false, reason: "unknown_recipe" };
    if (r.skill && this.level(r.skill) < (r.level ?? 1)) return { ok: false, reason: `level_low:${r.level}` };
    const c = this.inv.craft(recipeId, times);
    if (!c.ok) return { ok: false, reason: c.reason };
    return r.skill ? { ok: true, items: c.items, ...this.gain(r.skill, (r.xp ?? 5) * times) } : { ok: true, items: c.items };
  }
}

/** Parity script for life skills (run after a fresh inventory with SKILLS_START items). */
export const SKILLS_START: Array<[string, number]> = [["chili_seeds", 3], ["morning_glory_seeds", 2], ["fishing_rod", 1], ["fish_sauce", 2], ["coconut", 2]];
export const SKILLS_SCRIPT: Array<[string, ...Array<string | number | boolean>]> = [
  ["plant", "a", "chili", 0, "hot"],
  ["plant", "a", "chili", 0, "hot"],
  ["plant", "b", "morning_glory", 0, "cool"],
  ["plant", "c", "chili", 0, "cool"],
  ["water", "a", 0],
  ["water", "a", 0],
  ["harvest", "a", 3],
  ["newday", 1, true],
  ["newday", 2, false],
  ["water", "a", 2],
  ["newday", 3, true],
  ["harvest", "a", 11],
  ["harvest", "b", 12],
  ["fish", "canal", 1, 1],
  ["fish", "canal", 2, 1],
  ["fish", "canal", 3, 1.2],
  ["fish", "canal", 4, 0.3],
  ["fish", "canal", 5, 1],
  ["fish", "sea", 6, 1],
  ["fish", "canal", 7, 1],
  ["fish", "canal", 8, 1],
  ["fish", "canal", 9, 1],
  ["fish", "canal", 10, 1],
  ["cook", "grilled_fish", 1],
  ["cook", "fried_morning_glory", 1],
  ["cook", "fried_morning_glory", 1],
  ["xp", "cooking", 200],
  ["cook", "fried_morning_glory", 1],
  ["fish", "canal", 3003, 1],
];

export function runSkillsScript(db: ItemsDb, script = SKILLS_SCRIPT, start: Array<[string, number]> = SKILLS_START): { results: string[]; life: LifeState; inv: Record<string, number> } {
  const inv = new Inventory(db);
  for (const [item, n] of start) inv.add(item, n);
  const life = new LifeSkills(db, inv);
  const results: string[] = [];
  for (const [op, ...a] of script) {
    let r: LifeResult | undefined;
    if (op === "plant") r = life.plant(a[0] as string, a[1] as string, a[2] as number, a[3] as string);
    else if (op === "water") r = life.water(a[0] as string, a[1] as number);
    else if (op === "newday") results.push(`watered:${life.newDay(a[0] as number, a[1] as boolean)}`);
    else if (op === "harvest") r = life.harvest(a[0] as string, a[1] as number);
    else if (op === "fish") r = life.fish(a[0] as string, a[1] as number, a[2] as number);
    else if (op === "cook") r = life.cook(a[0] as string, 1);
    else if (op === "xp") life.gain(a[0] as string, a[1] as number);
    if (op === "newday") continue;
    if (!r) results.push("ok");
    else results.push(`${r.ok ? "ok" : r.reason}${r.levelUp ? "+lv" : ""}${r.ok && r.items ? ":" + r.items.map((s) => `${s.item}x${s.n}`).join(",") : ""}`);
  }
  const counts: Record<string, number> = {};
  for (const s of inv.state.slots) if (s) counts[s.item] = (counts[s.item] ?? 0) + s.n;
  return { results, life: life.state, inv: Object.fromEntries(Object.entries(counts).sort()) };
}
