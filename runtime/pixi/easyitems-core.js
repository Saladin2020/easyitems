/**
 * Easy Items runtime core (no dependencies; browser or Node). Same rules as the Easy Items TypeScript engine
 * and the Godot autoload: inventory stacks, equipment, shops (buy/sell/restock), loot tables (mulberry32) and crafting.
 *
 *   import { Inventory } from "./easyitems-core.js";
 *   const inv = new Inventory(db);  inv.buy("market", "thai_tea");  inv.state  // plain JSON, save it anywhere
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rint = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const clone = (v) => JSON.parse(JSON.stringify(v));
const fail = (reason) => ({ ok: false, reason });

export const isConsumable = (it) => it.consumable ?? (!!(it.effects && it.effects.length) && !it.equip);
export const isSellable = (it) => it.sellable ?? it.price > 0;

export function rollLoot(db, tableId, seed) {
  const t = db.loot.find((x) => x.id === tableId);
  if (!t) throw new Error(`Unknown loot table "${tableId}"`);
  const rnd = mulberry32(seed);
  const rolls = Array.isArray(t.rolls) ? rint(rnd, t.rolls[0], t.rolls[1]) : t.rolls;
  const total = t.entries.reduce((s, e) => s + e.weight, 0);
  const out = [];
  const push = (item, n) => {
    const s = out.find((o) => o.item === item);
    if (s) s.n += n;
    else out.push({ item, n });
  };
  for (let i = 0; i < rolls; i++) {
    let r = rnd() * total;
    let pick = t.entries[t.entries.length - 1];
    for (const e of t.entries) {
      if (r < e.weight) {
        pick = e;
        break;
      }
      r -= e.weight;
    }
    const mn = pick.min ?? 1;
    const n = rint(rnd, mn, pick.max ?? mn);
    if (pick.item) push(pick.item, n);
  }
  for (const g of t.guaranteed ?? []) push(g.item, g.n);
  return out;
}

export class Inventory {
  constructor(db, state) {
    this.db = db;
    this.items = new Map(db.items.map((i) => [i.id, i]));
    this.shops = new Map(db.shops.map((s) => [s.id, s]));
    this.listeners = new Set();
    this.state = state ? clone(state) : this.fresh();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this.state);
  }
  fresh() {
    const db = this.db;
    this.state = {
      coins: db.rules.startingCoins,
      slots: Array.from({ length: db.rules.slots }, () => null),
      equipped: Object.fromEntries(db.rules.equipSlots.map((s) => [s, null])),
      stock: Object.fromEntries(db.shops.map((s) => [s.id, Object.fromEntries(s.stock.map((e) => [e.item, e.qty]))])),
      restocked: Object.fromEntries(db.shops.map((s) => [s.id, Object.fromEntries(s.stock.map((e) => [e.item, 0]))])),
      day: 0,
    };
    for (const s of db.rules.startingItems ?? []) this.add(s.item, s.n);
    return this.state;
  }
  item(id) {
    const it = this.items.get(id);
    if (!it) throw new Error(`Unknown item "${id}"`);
    return it;
  }
  name(id, lang = "th") {
    const n = this.item(id).name;
    return n[lang] || n.th;
  }
  count(id) {
    return this.state.slots.reduce((n, s) => n + (s && s.item === id ? s.n : 0), 0);
  }
  has(id, n = 1) {
    return this.count(id) >= n;
  }
  space(id) {
    const stack = this.item(id).stack;
    return this.state.slots.reduce((n, s) => n + (s === null ? stack : s.item === id ? stack - s.n : 0), 0);
  }
  add(id, n = 1) {
    const stack = this.item(id).stack;
    let left = n;
    for (const s of this.state.slots) {
      if (left <= 0) break;
      if (s && s.item === id && s.n < stack) {
        const k = Math.min(stack - s.n, left);
        s.n += k;
        left -= k;
      }
    }
    for (let i = 0; i < this.state.slots.length && left > 0; i++) {
      if (this.state.slots[i] === null) {
        const k = Math.min(stack, left);
        this.state.slots[i] = { item: id, n: k };
        left -= k;
      }
    }
    this.emit();
    return left;
  }
  remove(id, n = 1) {
    if (this.count(id) < n) return false;
    let left = n;
    for (let i = this.state.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.state.slots[i];
      if (!s || s.item !== id) continue;
      const k = Math.min(s.n, left);
      s.n -= k;
      left -= k;
      if (s.n === 0) this.state.slots[i] = null;
    }
    this.emit();
    return true;
  }
  compact() {
    const order = [];
    const totals = new Map();
    for (const s of this.state.slots) {
      if (!s) continue;
      if (!totals.has(s.item)) order.push(s.item);
      totals.set(s.item, (totals.get(s.item) ?? 0) + s.n);
    }
    this.state.slots = this.state.slots.map(() => null);
    for (const id of order) this.add(id, totals.get(id));
  }
  use(id) {
    const it = this.item(id);
    if (!this.has(id)) return fail("not_owned");
    if (!isConsumable(it)) return fail("not_usable");
    this.remove(id, 1);
    return { ok: true, effects: it.effects ?? [] };
  }
  equip(id) {
    const it = this.item(id);
    if (!it.equip) return fail("not_equipment");
    if (!this.has(id)) return fail("not_owned");
    const slot = it.equip.slot;
    if (!(slot in this.state.equipped)) return fail("no_slot");
    const prev = this.state.equipped[slot];
    this.remove(id, 1);
    if (prev) {
      if (this.space(prev) < 1) {
        this.add(id, 1);
        return fail("inventory_full");
      }
      this.add(prev, 1);
    }
    this.state.equipped[slot] = id;
    this.emit();
    return { ok: true };
  }
  unequip(slot) {
    const id = this.state.equipped[slot];
    if (!id) return fail("empty_slot");
    if (this.space(id) < 1) return fail("inventory_full");
    this.add(id, 1);
    this.state.equipped[slot] = null;
    this.emit();
    return { ok: true };
  }
  stats() {
    const out = {};
    for (const id of Object.values(this.state.equipped)) {
      if (!id) continue;
      for (const [k, v] of Object.entries(this.item(id).equip?.stats ?? {})) out[k] = Math.round(((out[k] ?? 0) + v) * 1000) / 1000;
    }
    return out;
  }
  shop(id) {
    const s = this.shops.get(id);
    if (!s) throw new Error(`Unknown shop "${id}"`);
    return s;
  }
  stock(shopId, id) {
    return this.state.stock[shopId]?.[id] ?? 0;
  }
  buyPrice(shopId, id) {
    const sh = this.shop(shopId);
    const e = sh.stock.find((s) => s.item === id);
    if (!e) return null;
    if (e.price !== undefined) return e.price;
    const it = this.item(id);
    if (it.price === 0) return 0;
    let mult = sh.buyMod;
    for (const t of it.tags ?? []) if (sh.tagMods?.[t] !== undefined) mult *= sh.tagMods[t];
    return Math.max(1, Math.floor(it.price * mult + 0.5));
  }
  sellPrice(shopId, id) {
    const sh = this.shop(shopId);
    const it = this.item(id);
    if (sh.sellMod <= 0 || !isSellable(it)) return null;
    if (sh.buys && !sh.buys.includes(it.category)) return null;
    return Math.max(1, Math.floor(it.price * sh.sellMod));
  }
  buy(shopId, id, n = 1) {
    const price = this.buyPrice(shopId, id);
    if (price === null) return fail("not_sold_here");
    const q = this.stock(shopId, id);
    if (q !== -1 && q < n) return fail("out_of_stock");
    const cost = price * n;
    if (this.state.coins < cost) return fail("not_enough_coins");
    if (this.space(id) < n) return fail("inventory_full");
    this.state.coins -= cost;
    if (q !== -1) this.state.stock[shopId][id] = q - n;
    this.add(id, n);
    return { ok: true, coins: -cost, items: [{ item: id, n }] };
  }
  sell(shopId, id, n = 1) {
    const price = this.sellPrice(shopId, id);
    if (price === null) return fail("shop_wont_buy");
    if (!this.has(id, n)) return fail("not_owned");
    this.remove(id, n);
    this.state.coins += price * n;
    const st = this.state.stock[shopId];
    if (id in st && st[id] !== -1) st[id] += n;
    this.emit();
    return { ok: true, coins: price * n, items: [{ item: id, n: -n }] };
  }
  advanceDays(days = 1) {
    this.state.day += days;
    for (const sh of this.db.shops)
      for (const e of sh.stock) {
        if (!e.restock || e.qty === -1) continue;
        const last = this.state.restocked[sh.id][e.item] ?? 0;
        if (this.state.day - last >= e.restock) {
          this.state.stock[sh.id][e.item] = Math.max(this.state.stock[sh.id][e.item] ?? 0, e.qty);
          this.state.restocked[sh.id][e.item] = this.state.day;
        }
      }
    this.emit();
  }
  canCraft(recipeId, times = 1) {
    const r = this.db.recipes.find((x) => x.id === recipeId);
    if (!r) return fail("unknown_recipe");
    for (const e of r.inputs) if (!this.has(e.item, e.n * times)) return fail(`missing:${e.item}`);
    const sim = new Inventory(this.db, this.state);
    for (const e of r.inputs) sim.remove(e.item, e.n * times);
    for (const e of r.outputs) if (sim.add(e.item, e.n * times) > 0) return fail("inventory_full");
    return { ok: true, items: r.outputs.map((e) => ({ item: e.item, n: e.n * times })) };
  }
  craft(recipeId, times = 1) {
    const check = this.canCraft(recipeId, times);
    if (!check.ok) return check;
    const r = this.db.recipes.find((x) => x.id === recipeId);
    for (const e of r.inputs) this.remove(e.item, e.n * times);
    for (const e of r.outputs) this.add(e.item, e.n * times);
    return check;
  }
  loot(tableId, seed) {
    const items = rollLoot(this.db, tableId, seed);
    const lost = [];
    for (const s of items) if (this.add(s.item, s.n) > 0) lost.push(s.item);
    return lost.length ? fail(`inventory_full:${lost.join(",")}`) : { ok: true, items };
  }
}

/** Replay an op script (used by the parity checks). */
export function runScript(db, script) {
  const inv = new Inventory(db);
  const results = [];
  for (const [op, ...a] of script) {
    let r;
    if (op === "buy") r = inv.buy(a[0], a[1], a[2]);
    else if (op === "sell") r = inv.sell(a[0], a[1], a[2]);
    else if (op === "craft") r = inv.craft(a[0], a[1]);
    else if (op === "equip") r = inv.equip(a[0]);
    else if (op === "unequip") r = inv.unequip(a[0]);
    else if (op === "use") r = inv.use(a[0]);
    else if (op === "loot") r = inv.loot(a[0], a[1]);
    else if (op === "coins") inv.state.coins += a[0];
    else if (op === "day") inv.advanceDays(a[0]);
    else if (op === "compact") inv.compact();
    results.push(r ? (r.ok ? "ok" : r.reason) : "ok");
  }
  return { results, state: inv.state, stats: inv.stats() };
}

// ---------- life skills (same rules as src/shared/skills.ts and easyitems.gd life_*) ----------
export const xpForLevel = (sk, level) => ((sk?.xpBase ?? 20) * (level - 1) * level) / 2;
export function levelFor(sk, xp) {
  const max = sk?.maxLevel ?? 10;
  let l = 1;
  while (l < max && xp >= xpForLevel(sk, l + 1)) l++;
  return l;
}

/** Farming, fishing and cooking XP / levels over an Inventory. `life.state` is plain JSON: save it next to inv.state. */
export class LifeSkills {
  constructor(db, inv, state) {
    this.db = db;
    this.inv = inv;
    this.state = state ? clone(state) : { xp: {}, plots: {} };
    this.listeners = new Set();
  }
  onLevel(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  skill(id) { return (this.db.skills ?? []).find((s) => s.id === id); }
  xp(id) { return this.state.xp[id] ?? 0; }
  level(id) { return levelFor(this.skill(id), this.xp(id)); }
  progress(id) {
    const sk = this.skill(id), xp = this.xp(id), level = levelFor(sk, xp), lo = xpForLevel(sk, level);
    return { level, xp, into: xp - lo, need: level >= (sk?.maxLevel ?? 10) ? 0 : xpForLevel(sk, level + 1) - lo };
  }
  gain(id, n) {
    const before = this.level(id);
    this.state.xp[id] = this.xp(id) + n;
    const level = this.level(id);
    if (level > before) for (const f of this.listeners) f(id, level);
    return { skill: id, xp: n, level, levelUp: level > before };
  }
  crop(id) { return (this.db.crops ?? []).find((x) => x.id === id); }
  plant(plot, cropId, day, season) {
    const c = this.crop(cropId);
    if (!c) return fail("unknown_crop");
    if (this.state.plots[plot]) return fail("plot_busy");
    if (season !== undefined && c.seasons && !c.seasons.includes(season)) return fail("wrong_season");
    if (!this.inv.has(c.seed, 1)) return fail(`missing:${c.seed}`);
    this.inv.remove(c.seed, 1);
    this.state.plots[plot] = { crop: c.id, planted: day, water: 0, last: -1 };
    return { ok: true, ...this.gain("farming", 1) };
  }
  water(plot, day) {
    const p = this.state.plots[plot];
    if (!p) return fail("empty_plot");
    if (p.last === day) return fail("already_watered");
    p.last = day;
    p.water++;
    return { ok: true };
  }
  newDay(day, rained) {
    let n = 0;
    if (rained) for (const id of Object.keys(this.state.plots).sort()) if (this.water(id, day).ok) n++;
    return n;
  }
  growth(plot) {
    const p = this.state.plots[plot], c = p && this.crop(p.crop);
    return !p || !c ? 0 : Math.min(1, p.water / c.days);
  }
  harvest(plot, seed) {
    const p = this.state.plots[plot];
    if (!p) return fail("empty_plot");
    const c = this.crop(p.crop);
    if (p.water < c.days) return fail("not_ready");
    const [mn, mx] = c.yield ?? [1, 2];
    const n = rint(mulberry32(seed), mn, mx) + Math.floor((this.level("farming") - 1) / 3);
    if (this.inv.add(c.produce, n) > 0) return fail("inventory_full");
    delete this.state.plots[plot];
    return { ok: true, items: [{ item: c.produce, n }], ...this.gain("farming", c.xp ?? 5) };
  }
  spot(id) { return (this.db.fishing ?? []).find((x) => x.id === id); }
  biteChance(spotId, weatherMult = 1) {
    const s = this.spot(spotId);
    return s ? Math.min(0.95, (s.bite ?? 0.6) * (1 + 0.05 * (this.level("fishing") - 1)) * weatherMult) : 0;
  }
  fish(spotId, seed, weatherMult = 1) {
    const s = this.spot(spotId);
    if (!s) return fail("unknown_spot");
    if (this.level("fishing") < (s.minLevel ?? 1)) return fail(`level_low:${s.minLevel}`);
    if (s.tool && !this.inv.has(s.tool, 1)) return fail(`missing:${s.tool}`);
    if (mulberry32(seed)() >= this.biteChance(spotId, weatherMult)) return { ok: false, reason: "no_bite", ...this.gain("fishing", 1) };
    const items = rollLoot(this.db, s.loot, seed + 1);
    for (const it of items) if (this.inv.add(it.item, it.n) > 0) return fail("inventory_full");
    return { ok: true, bite: true, items, ...this.gain("fishing", s.xp ?? 5) };
  }
  canCook(recipeId) {
    const r = this.db.recipes.find((x) => x.id === recipeId);
    if (!r) return fail("unknown_recipe");
    if (r.skill && this.level(r.skill) < (r.level ?? 1)) return fail(`level_low:${r.level}`);
    return this.inv.canCraft(recipeId, 1);
  }
  cook(recipeId, times = 1) {
    const r = this.db.recipes.find((x) => x.id === recipeId);
    if (!r) return fail("unknown_recipe");
    if (r.skill && this.level(r.skill) < (r.level ?? 1)) return fail(`level_low:${r.level}`);
    const c = this.inv.craft(recipeId, times);
    if (!c.ok) return c;
    return r.skill ? { ok: true, items: c.items, ...this.gain(r.skill, (r.xp ?? 5) * times) } : { ok: true, items: c.items };
  }
}

/** Replay a life-skills script (parity checks): start items, then plant / water / newday / harvest / fish / cook / xp. */
export function runSkillsScript(db, start, script) {
  const inv = new Inventory(db);
  for (const [item, n] of start) inv.add(item, n);
  const life = new LifeSkills(db, inv);
  const results = [];
  for (const [op, ...a] of script) {
    let r;
    if (op === "plant") r = life.plant(a[0], a[1], a[2], a[3]);
    else if (op === "water") r = life.water(a[0], a[1]);
    else if (op === "newday") { results.push(`watered:${life.newDay(a[0], a[1])}`); continue; }
    else if (op === "harvest") r = life.harvest(a[0], a[1]);
    else if (op === "fish") r = life.fish(a[0], a[1], a[2]);
    else if (op === "cook") r = life.cook(a[0], 1);
    else if (op === "xp") life.gain(a[0], a[1]);
    if (!r) results.push("ok");
    else results.push(`${r.ok ? "ok" : r.reason}${r.levelUp ? "+lv" : ""}${r.ok && r.items ? ":" + r.items.map((s) => `${s.item}x${s.n}`).join(",") : ""}`);
  }
  const counts = {};
  for (const s of inv.state.slots) if (s) counts[s.item] = (counts[s.item] ?? 0) + s.n;
  return { results, life: life.state, inv: Object.fromEntries(Object.entries(counts).sort()) };
}
