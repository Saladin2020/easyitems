import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDb } from "../src/shared/db.js";
import { Inventory } from "../src/shared/engine.js";
import { LifeSkills, SKILLS_SCRIPT, SKILLS_START, levelFor, runSkillsScript, xpForLevel } from "../src/shared/skills.js";
import type { ItemsDb } from "../src/shared/types.js";
import { loadDbStrict } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

let db: ItemsDb;
beforeAll(async () => {
  const { root, cleanup } = await tempWorkspace();
  db = await loadDbStrict(root);
  await cleanup();
});

describe("life skills", () => {
  it("levels follow xpBase × (L−1) × L / 2 and stop at maxLevel", () => {
    const sk = { id: "cooking", name: { th: "ทำอาหาร", en: "Cooking" }, xpBase: 20, maxLevel: 5 };
    expect([1, 2, 3, 4].map((l) => xpForLevel(sk, l))).toEqual([0, 20, 60, 120]);
    expect([0, 19, 20, 59, 60, 10_000].map((x) => levelFor(sk, x))).toEqual([1, 1, 2, 2, 3, 5]);
  });

  it("farming: seasons, watering once a day, rain waters plots, harvest needs enough watered days", () => {
    const inv = new Inventory(db);
    inv.add("chili_seeds", 2);
    const life = new LifeSkills(db, inv);
    expect(life.plant("p", "chili", 0, "cool")).toMatchObject({ ok: false, reason: "wrong_season" });
    expect(life.plant("p", "chili", 0, "rainy").ok).toBe(true);
    expect(inv.count("chili_seeds")).toBe(1);
    expect(life.water("p", 0).ok).toBe(true);
    expect(life.water("p", 0)).toMatchObject({ ok: false, reason: "already_watered" });
    expect(life.newDay(1, true)).toBe(1);
    expect(life.harvest("p", 1)).toMatchObject({ ok: false, reason: "not_ready" });
    expect(life.growth("p")).toBeCloseTo(2 / 3);
    life.newDay(2, false);
    life.water("p", 2);
    const h = life.harvest("p", 1);
    expect(h.ok).toBe(true);
    expect(inv.count("chili")).toBeGreaterThanOrEqual(2);
    expect(life.state.plots.p).toBeUndefined();
  });

  it("fishing needs the rod and level; weather changes the bite chance; cooking is gated by level", () => {
    const inv = new Inventory(db);
    const life = new LifeSkills(db, inv);
    expect(life.fish("canal", 1)).toMatchObject({ ok: false, reason: "missing:fishing_rod" });
    inv.add("fishing_rod", 1);
    expect(life.fish("sea", 1)).toMatchObject({ ok: false, reason: "level_low:3" });
    expect(life.biteChance("canal", 0.3)).toBeLessThan(life.biteChance("canal", 1.2));
    let caught = 0;
    for (let s = 0; s < 60; s++) if (life.fish("canal", 1000 + s * 7919).ok) caught++;
    expect(caught).toBeGreaterThan(15);
    expect(life.level("fishing")).toBeGreaterThan(1);
    inv.add("morning_glory", 1);
    inv.add("chili", 2);
    inv.add("fish_sauce", 1);
    expect(life.canCook("fried_morning_glory")).toMatchObject({ ok: false, reason: "level_low:2" });
    life.gain("cooking", 20);
    expect(life.cook("fried_morning_glory")).toMatchObject({ ok: true, skill: "cooking", xp: 12 });
  });

  it("the Pixi runtime replays the script exactly like the TS engine", async () => {
    const core = await import(pathToFileURL(path.resolve("runtime/pixi/easyitems-core.js")).href);
    const ts = runSkillsScript(db);
    const js = core.runSkillsScript(db, SKILLS_START, SKILLS_SCRIPT);
    expect(js.results).toEqual(ts.results);
    expect(js.life).toEqual(ts.life);
    expect(js.inv).toEqual(ts.inv);
    expect(ts.results).toContain("wrong_season");
    expect(ts.results.some((r) => r.startsWith("ok:pla_"))).toBe(true);
  });

  it("validates crops, fishing spots and skill recipes", () => {
    const doc = {
      format: "easyitems/1",
      items: [{ id: "seed", name: { th: "เมล็ด", en: "Seed" }, category: "ingredient", price: 1, stack: 9, icon: "seeds" }],
      recipes: [{ id: "r", name: { th: "ร", en: "R" }, skill: "baking", inputs: [{ item: "seed", n: 1 }], outputs: [{ item: "seed", n: 1 }] }],
      crops: [{ id: "c", seed: "seed", produce: "nope", days: 0 }],
      fishing: [{ id: "f", loot: "missing_table", bite: 2 }],
    };
    const all = (d: unknown) => buildDb([{ file: "x.json", doc: d }]).errors.map((e) => `${e.path} ${e.message}`).join("\n");
    const shape = all(doc);
    expect(shape).toMatch(/days/);
    expect(shape).toMatch(/bite/);
    const refs = all({ ...doc, crops: [{ id: "c", seed: "seed", produce: "nope", days: 2 }], fishing: [{ id: "f", loot: "missing_table" }] });
    expect(refs).toMatch(/unknown life skill "baking"/);
    expect(refs).toMatch(/unknown item "nope"/);
    expect(refs).toMatch(/unknown loot table "missing_table"/);
  });
});
