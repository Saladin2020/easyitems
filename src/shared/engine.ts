/**
 * Inventory / equipment / shop / loot / crafting rules, as pure functions over a JSON state. The Godot autoload
 * (`runtime/godot/easyitems.gd`) and the Pixi runtime (`runtime/pixi/easyitems-pixi.js`) implement the same rules;
 * tests replay one script through all three and compare the states.
 */
import { isConsumable, isSellable } from "./db.js";
import { mulberry32, rint } from "./rng.js";
import type { Item, ItemEffect, ItemsDb, Shop } from "./types.js";

export interface Slot {
  item: string;
  n: number;
}

export interface InvState {
  coins: number;
  slots: Array<Slot | null>;
  equipped: Record<string, string | null>;
  /** Current shop stock: shop → item → qty (-1 unlimited). */
  stock: Record<string, Record<string, number>>;
  /** Day each stock entry was last refilled. */
  restocked: Record<string, Record<string, number>>;
  day: number;
}

export type Result = { ok: true; coins?: number; items?: Slot[]; effects?: ItemEffect[] } | { ok: false; reason: string };

const fail = (reason: string): Result => ({ ok: false, reason });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class Inventory {
  readonly items: Map<string, Item>;
  readonly shops: Map<string, Shop>;
  state: InvState;

  constructor(readonly db: ItemsDb, state?: InvState) {
    this.items = new Map(db.items.map((i) => [i.id, i]));
    this.shops = new Map(db.shops.map((s) => [s.id, s]));
    this.state = state ? clone(state) : Inventory.fresh(db);
  }

  static fresh(db: ItemsDb): InvState {
    const st: InvState = {
      coins: db.rules.startingCoins,
      slots: Array.from({ length: db.rules.slots }, () => null),
      equipped: Object.fromEntries(db.rules.equipSlots.map((s) => [s, null])),
      stock: Object.fromEntries(db.shops.map((s) => [s.id, Object.fromEntries(s.stock.map((e) => [e.item, e.qty]))])),
      restocked: Object.fromEntries(db.shops.map((s) => [s.id, Object.fromEntries(s.stock.map((e) => [e.item, 0]))])),
      day: 0,
    };
    const inv = new Inventory(db, st);
    for (const s of db.rules.startingItems ?? []) inv.add(s.item, s.n);
    return inv.state;
  }

  item(id: string): Item {
    const it = this.items.get(id);
    if (!it) throw new Error(`Unknown item "${id}"`);
    return it;
  }

  count(id: string): number {
    return this.state.slots.reduce((n, s) => n + (s?.item === id ? s.n : 0), 0);
  }
  has(id: string, n = 1): boolean {
    return this.count(id) >= n;
  }

  /** How many of `id` fit right now. */
  space(id: string): number {
    const stack = this.item(id).stack;
    return this.state.slots.reduce((n, s) => n + (s === null ? stack : s.item === id ? stack - s.n : 0), 0);
  }

  /** Adds up to n; returns how many did NOT fit. */
  add(id: string, n = 1): number {
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
    return left;
  }

  /** Removes n (from the last slots first); false and no change when there are fewer. */
  remove(id: string, n = 1): boolean {
    if (this.count(id) < n) return false;
    let left = n;
    for (let i = this.state.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.state.slots[i];
      if (s?.item !== id) continue;
      const k = Math.min(s.n, left);
      s.n -= k;
      left -= k;
      if (s.n === 0) this.state.slots[i] = null;
    }
    return true;
  }

  /** Merge stacks and move everything to the front, keeping first-seen order. */
  compact(): void {
    const order: string[] = [];
    const totals = new Map<string, number>();
    for (const s of this.state.slots) {
      if (!s) continue;
      if (!totals.has(s.item)) order.push(s.item);
      totals.set(s.item, (totals.get(s.item) ?? 0) + s.n);
    }
    this.state.slots = this.state.slots.map(() => null);
    for (const id of order) this.add(id, totals.get(id)!);
  }

  use(id: string): Result {
    const it = this.item(id);
    if (!this.has(id)) return fail("not_owned");
    if (!isConsumable(it)) return fail("not_usable");
    this.remove(id, 1);
    return { ok: true, effects: it.effects ?? [] };
  }

  equip(id: string): Result {
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
    return { ok: true };
  }

  unequip(slot: string): Result {
    const id = this.state.equipped[slot];
    if (!id) return fail("empty_slot");
    if (this.space(id) < 1) return fail("inventory_full");
    this.add(id, 1);
    this.state.equipped[slot] = null;
    return { ok: true };
  }

  /** Sum of equipped stats. */
  stats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of Object.values(this.state.equipped)) {
      if (!id) continue;
      for (const [k, v] of Object.entries(this.item(id).equip?.stats ?? {})) out[k] = Math.round(((out[k] ?? 0) + v) * 1000) / 1000;
    }
    return out;
  }

  // ---------- shops ----------
  shop(id: string): Shop {
    const s = this.shops.get(id);
    if (!s) throw new Error(`Unknown shop "${id}"`);
    return s;
  }

  /** What the player pays for one, or null when the shop doesn't sell it. */
  buyPrice(shopId: string, id: string): number | null {
    const sh = this.shop(shopId);
    const e = sh.stock.find((s) => s.item === id);
    if (!e) return null;
    if (e.price !== undefined) return e.price;
    const it = this.item(id);
    if (it.price === 0) return 0;
    let mult = sh.buyMod;
    for (const t of it.tags ?? []) if (sh.tagMods?.[t] !== undefined) mult *= sh.tagMods[t]!;
    return Math.max(1, Math.floor(it.price * mult + 0.5));
  }

  /** What the shop pays for one, or null when it doesn't buy it. */
  sellPrice(shopId: string, id: string): number | null {
    const sh = this.shop(shopId);
    const it = this.item(id);
    if (sh.sellMod <= 0 || !isSellable(it)) return null;
    if (sh.buys && !sh.buys.includes(it.category)) return null;
    return Math.max(1, Math.floor(it.price * sh.sellMod));
  }

  buy(shopId: string, id: string, n = 1): Result {
    const price = this.buyPrice(shopId, id);
    if (price === null) return fail("not_sold_here");
    const q = this.state.stock[shopId]?.[id] ?? 0;
    if (q !== -1 && q < n) return fail("out_of_stock");
    const cost = price * n;
    if (this.state.coins < cost) return fail("not_enough_coins");
    if (this.space(id) < n) return fail("inventory_full");
    this.state.coins -= cost;
    if (q !== -1) this.state.stock[shopId]![id] = q - n;
    this.add(id, n);
    return { ok: true, coins: -cost, items: [{ item: id, n }] };
  }

  sell(shopId: string, id: string, n = 1): Result {
    const price = this.sellPrice(shopId, id);
    if (price === null) return fail("shop_wont_buy");
    if (!this.has(id, n)) return fail("not_owned");
    this.remove(id, n);
    this.state.coins += price * n;
    const st = this.state.stock[shopId]!;
    if (id in st && st[id] !== -1) st[id] = st[id]! + n;
    return { ok: true, coins: price * n, items: [{ item: id, n: -n }] };
  }

  /** Advance the calendar; refills stock whose restock interval has passed. */
  advanceDays(days = 1): void {
    this.state.day += days;
    for (const sh of this.db.shops)
      for (const e of sh.stock) {
        if (!e.restock || e.qty === -1) continue;
        const last = this.state.restocked[sh.id]![e.item] ?? 0;
        if (this.state.day - last >= e.restock) {
          this.state.stock[sh.id]![e.item] = Math.max(this.state.stock[sh.id]![e.item] ?? 0, e.qty);
          this.state.restocked[sh.id]![e.item] = this.state.day;
        }
      }
  }

  // ---------- crafting & loot ----------
  canCraft(recipeId: string, times = 1): Result {
    const r = this.db.recipes.find((x) => x.id === recipeId);
    if (!r) return fail("unknown_recipe");
    for (const e of r.inputs) if (!this.has(e.item, e.n * times)) return fail(`missing:${e.item}`);
    const sim = new Inventory(this.db, this.state);
    for (const e of r.inputs) sim.remove(e.item, e.n * times);
    for (const e of r.outputs) if (sim.add(e.item, e.n * times) > 0) return fail("inventory_full");
    return { ok: true, items: r.outputs.map((e) => ({ item: e.item, n: e.n * times })) };
  }

  craft(recipeId: string, times = 1): Result {
    const check = this.canCraft(recipeId, times);
    if (!check.ok) return check;
    const r = this.db.recipes.find((x) => x.id === recipeId)!;
    for (const e of r.inputs) this.remove(e.item, e.n * times);
    for (const e of r.outputs) this.add(e.item, e.n * times);
    return check;
  }

  /** Roll a loot table and add what fits; returns the rolled items (what did not fit is reported as reason). */
  loot(tableId: string, seed: number): Result {
    const items = rollLoot(this.db, tableId, seed);
    const lost: string[] = [];
    for (const s of items) if (this.add(s.item, s.n) > 0) lost.push(s.item);
    return lost.length ? { ok: false, reason: `inventory_full:${lost.join(",")}` } : { ok: true, items };
  }
}

/** Deterministic loot roll (same seed → same drop in TS, Godot and Pixi). */
export function rollLoot(db: ItemsDb, tableId: string, seed: number): Slot[] {
  const t = db.loot.find((x) => x.id === tableId);
  if (!t) throw new Error(`Unknown loot table "${tableId}"`);
  const rnd = mulberry32(seed);
  const rolls = Array.isArray(t.rolls) ? rint(rnd, t.rolls[0], t.rolls[1]) : t.rolls;
  const total = t.entries.reduce((s, e) => s + e.weight, 0);
  const out: Slot[] = [];
  const push = (item: string, n: number) => {
    const s = out.find((o) => o.item === item);
    if (s) s.n += n;
    else out.push({ item, n });
  };
  for (let i = 0; i < rolls; i++) {
    let r = rnd() * total;
    let pick = t.entries[t.entries.length - 1]!;
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

/** A fixed script of operations, replayed by the Godot test and the Pixi check to prove the runtimes agree. */
export const PARITY_SCRIPT: Array<[string, ...Array<string | number>]> = [
  ["buy", "general_store", "rice_bag", 1],
  ["buy", "market", "thai_tea", 3],
  ["buy", "market", "thai_tea", 1],
  ["buy", "market", "mango", 2],
  ["sell", "market", "mango", 1],
  ["buy", "general_store", "wheel", 3],
  ["coins", 2000],
  ["buy", "general_store", "rice_bag", 1],
  ["buy", "general_store", "wheel", 2],
  ["buy", "general_store", "chain", 1],
  ["buy", "general_store", "bike_bell", 1],
  ["craft", "bicycle", 1],
  ["equip", "bicycle"],
  ["buy", "raya_bazaar", "ketupat_shell", 4],
  ["craft", "ketupat", 1],
  ["use", "ketupat"],
  ["use", "bicycle"],
  ["sell", "raya_bazaar", "prayer_mat", 1],
  ["loot", "delivery_tip", 7],
  ["loot", "market_basket", 42],
  ["loot", "raya_visit", 1446],
  ["buy", "general_store", "umbrella", 1],
  ["buy", "general_store", "umbrella", 1],
  ["day", 7],
  ["buy", "general_store", "wheel", 1],
  ["equip", "umbrella"],
  ["unequip", "vehicle"],
  ["compact"],
];

/** Apply PARITY_SCRIPT (or any script) and return results + the final state. */
export function runScript(db: ItemsDb, script = PARITY_SCRIPT): { results: string[]; state: InvState; stats: Record<string, number> } {
  const inv = new Inventory(db);
  const results: string[] = [];
  for (const [op, ...a] of script) {
    let r: Result | undefined;
    if (op === "buy") r = inv.buy(a[0] as string, a[1] as string, a[2] as number);
    else if (op === "sell") r = inv.sell(a[0] as string, a[1] as string, a[2] as number);
    else if (op === "craft") r = inv.craft(a[0] as string, a[1] as number);
    else if (op === "equip") r = inv.equip(a[0] as string);
    else if (op === "unequip") r = inv.unequip(a[0] as string);
    else if (op === "use") r = inv.use(a[0] as string);
    else if (op === "loot") r = inv.loot(a[0] as string, a[1] as number);
    else if (op === "coins") inv.state.coins += a[0] as number;
    else if (op === "day") inv.advanceDays(a[0] as number);
    else if (op === "compact") inv.compact();
    results.push(r ? (r.ok ? "ok" : r.reason) : "ok");
  }
  return { results, state: inv.state, stats: inv.stats() };
}
