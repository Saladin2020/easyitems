import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { canon } from "../src/shared/canon.js";
import { Inventory, PARITY_SCRIPT, rollLoot, runScript } from "../src/shared/engine.js";
import { mulberry32 } from "../src/shared/rng.js";
import type { ItemsDb } from "../src/shared/types.js";
import { loadDbStrict } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

let db: ItemsDb;
beforeAll(async () => {
  const { root, cleanup } = await tempWorkspace();
  db = await loadDbStrict(root);
  await cleanup();
});

describe("inventory", () => {
  it("starts with the rules' coins and items", () => {
    const inv = new Inventory(db);
    expect(inv.state.coins).toBe(60);
    expect(inv.state.slots.length).toBe(24);
    expect(inv.count("letter")).toBe(1);
    expect(Object.keys(inv.state.equipped)).toEqual(["head", "body", "hand", "accessory", "vehicle"]);
  });

  it("stacks, spills into new slots, removes from the back and reports leftovers", () => {
    const inv = new Inventory(db);
    expect(inv.add("mango", 45)).toBe(0); // stack 20 → 20 + 20 + 5
    expect(inv.state.slots.filter((s) => s?.item === "mango").map((s) => s!.n)).toEqual([20, 20, 5]);
    expect(inv.remove("mango", 7)).toBe(true);
    expect(inv.state.slots.filter((s) => s?.item === "mango").map((s) => s!.n)).toEqual([20, 18]);
    expect(inv.remove("mango", 99)).toBe(false);
    const big = new Inventory(db);
    expect(big.add("bicycle", 30)).toBe(30 - (24 - 2));
  });

  it("prices: buyMod, tag mods, fixed prices, sellMod and shops that won't buy", () => {
    const inv = new Inventory(db);
    expect(inv.buyPrice("market", "thai_tea")).toBe(25);
    expect(inv.buyPrice("general_store", "rice_bag")).toBe(132); // 120 × 1.1
    expect(inv.buyPrice("general_store", "wheel")).toBe(157); // 150 × 1.1 × 0.95 = 156.75
    expect(inv.buyPrice("raya_bazaar", "ketupat")).toBe(14); // 15 × 0.9 raya discount
    expect(inv.sellPrice("market", "mango")).toBe(7);
    expect(inv.sellPrice("market", "bicycle")).toBeNull(); // market only buys food / ingredient / drink
    expect(inv.sellPrice("raya_bazaar", "prayer_mat")).toBeNull(); // not sellable
    expect(inv.buyPrice("market", "bicycle")).toBeNull();
  });

  it("buy / sell move coins and stock; out of stock, no money and full bag fail cleanly", () => {
    const inv = new Inventory(db);
    expect(inv.buy("market", "rendang")).toEqual({ ok: false, reason: "not_sold_here" });
    expect(inv.buy("general_store", "rice_bag")).toEqual({ ok: false, reason: "not_enough_coins" });
    expect(inv.buy("market", "mango", 2).ok).toBe(true);
    expect(inv.state.coins).toBe(30);
    expect(inv.state.stock.market!.mango).toBe(10);
    expect(inv.sell("market", "mango", 1)).toMatchObject({ ok: true, coins: 7 });
    expect(inv.state.stock.market!.mango).toBe(11);
    inv.state.coins = 99999;
    expect(inv.buy("general_store", "umbrella").ok).toBe(true);
    expect(inv.buy("general_store", "umbrella")).toEqual({ ok: false, reason: "out_of_stock" });
    const full = new Inventory(db);
    full.state.coins = 99999;
    full.add("bicycle", 22);
    expect(full.buy("market", "banana")).toEqual({ ok: false, reason: "inventory_full" });
  });

  it("restocks after the configured days, never above the base quantity", () => {
    const inv = new Inventory(db);
    inv.state.coins = 99999;
    inv.buy("general_store", "wheel", 2);
    expect(inv.state.stock.general_store!.wheel).toBe(0);
    inv.advanceDays(6);
    expect(inv.state.stock.general_store!.wheel).toBe(0);
    inv.advanceDays(1);
    expect(inv.state.stock.general_store!.wheel).toBe(2);
    expect(inv.state.stock.general_store!.rice_bag).toBe(-1);
  });

  it("equipment swaps back into the bag and sums stats", () => {
    const inv = new Inventory(db);
    inv.add("straw_hat");
    inv.add("songkok");
    expect(inv.equip("straw_hat").ok).toBe(true);
    expect(inv.stats()).toEqual({ heat: 2 });
    expect(inv.equip("songkok").ok).toBe(true);
    expect(inv.count("straw_hat")).toBe(1);
    expect(inv.state.equipped.head).toBe("songkok");
    expect(inv.equip("mango")).toEqual({ ok: false, reason: "not_equipment" });
    expect(inv.unequip("head").ok).toBe(true);
    expect(inv.unequip("head")).toEqual({ ok: false, reason: "empty_slot" });
  });

  it("uses consumables, crafts recipes atomically", () => {
    const inv = new Inventory(db);
    inv.add("mango_sticky_rice");
    expect(inv.use("mango_sticky_rice")).toMatchObject({ ok: true, effects: [{ kind: "heal", amount: 30 }, { kind: "mood", amount: 5 }] });
    expect(inv.use("letter")).toEqual({ ok: false, reason: "not_usable" });
    expect(inv.craft("bicycle")).toEqual({ ok: false, reason: "missing:wheel" });
    inv.add("wheel", 2);
    inv.add("chain");
    inv.add("bike_bell");
    expect(inv.craft("bicycle")).toMatchObject({ ok: true, items: [{ item: "bicycle", n: 1 }] });
    expect(inv.count("wheel")).toBe(0);
    expect(inv.count("bicycle")).toBe(1);
  });
});

describe("loot", () => {
  it("mulberry32 matches reference values", () => {
    const r = mulberry32(1);
    expect([r(), r(), r()].map((v) => v.toFixed(8))).toEqual(["0.62707394", "0.00273572", "0.52744704"]);
  });

  it("same seed, same drop; guaranteed items always drop; distribution follows weights", () => {
    expect(rollLoot(db, "market_basket", 42)).toEqual(rollLoot(db, "market_basket", 42));
    for (let s = 0; s < 50; s++) expect(rollLoot(db, "raya_visit", s).some((x) => x.item === "coin_pouch_gift")).toBe(true);
    let nothing = 0;
    for (let s = 0; s < 2000; s++) if (!rollLoot(db, "delivery_tip", s).length) nothing++;
    expect(nothing / 2000).toBeGreaterThan(0.2); // weight 4 of 14
    expect(nothing / 2000).toBeLessThan(0.38);
  });
});

describe("runtime parity", () => {
  it("the Pixi/JS runtime core replays the parity script exactly like the TypeScript engine", async () => {
    const core = (await import(pathToFileURL(path.resolve("runtime/pixi/easyitems-core.js")).href)) as { runScript: (db: unknown, s: unknown) => { results: string[]; state: unknown; stats: unknown }; rollLoot: (db: unknown, t: string, s: number) => unknown };
    const ts = runScript(db);
    const js = core.runScript(db, PARITY_SCRIPT);
    expect(js.results).toEqual(ts.results);
    expect(canon(js.state)).toBe(canon(ts.state));
    expect(canon(js.stats)).toBe(canon(ts.stats));
    for (let s = 0; s < 100; s++) expect(core.rollLoot(db, "market_basket", s)).toEqual(rollLoot(db, "market_basket", s));
    expect(ts.results.filter((r) => r !== "ok").length).toBeGreaterThanOrEqual(4); // the script exercises failures too
  });
});
