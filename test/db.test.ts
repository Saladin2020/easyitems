import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDb, isNotHalal } from "../src/shared/db.js";
import { crossRefQuests, questItemRefs } from "../src/shared/quest.js";
import type { Item } from "../src/shared/types.js";
import { checkWorkspace, loadDb, saveDoc } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => ({ root, cleanup } = await tempWorkspace()));
afterAll(() => cleanup());

const item = (o: Partial<Item> = {}): Item => ({ id: "x", name: { th: "เอ็กซ์", en: "X" }, category: "food", price: 10, stack: 10, icon: "mango", ...o });

describe("starter catalog", () => {
  it("loads clean: ~40 items, 3 shops, loot and recipes, Thai + English + Malay names", async () => {
    const r = await loadDb(root);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.db.items.length).toBeGreaterThanOrEqual(40);
    expect(r.db.shops.map((s) => s.id).sort()).toEqual(["general_store", "market", "raya_bazaar"]);
    expect(r.db.loot.length).toBeGreaterThanOrEqual(3);
    expect(r.db.recipes.length).toBeGreaterThanOrEqual(4);
    for (const it of r.db.items) expect(it.name.ms, it.id).toBeTruthy();
    const ids = r.db.items.map((i) => i.id);
    for (const id of ["mango_sticky_rice", "thai_tea", "rice_bag", "krathong", "garland", "fish_sauce", "wheel", "chain", "bicycle", "ketupat", "rendang", "kurma", "roti", "songkok", "prayer_mat"]) expect(ids).toContain(id);
  });

  it("is multicultural and the Raya bazaar is halal with nothing haram in stock", async () => {
    const { db } = await loadDb(root);
    const bazaar = db.shops.find((s) => s.id === "raya_bazaar")!;
    expect(bazaar.halal).toBe(true);
    for (const e of bazaar.stock) expect(isNotHalal(db.items.find((i) => i.id === e.item)!), e.item).toBe(false);
    expect(db.items.some((i) => i.tags?.includes("loy_krathong"))).toBe(true);
    expect(db.items.some((i) => i.tags?.includes("raya"))).toBe(true);
    expect(db.items.find((i) => i.id === "prayer_mat")!.category).toBe("textile");
    for (const i of db.items) expect(JSON.stringify(i).toLowerCase()).not.toMatch(/pork|alcohol|beer|wine|หมู|เหล้า|quran|calligraphy/);
  });

  it("every Easy Quest sample item id exists", async () => {
    const r = await checkWorkspace(root);
    expect(r.quests.files.length).toBe(2);
    expect(r.quests.missing).toEqual([]);
    expect(r.quests.matched).toEqual(expect.arrayContaining(["sticky_rice", "balm", "kanom_chan", "kurma", "bubur", "ketupat_shell", "pelita", "pomelo"]));
  });
});

describe("validation", () => {
  const doc = (o: Record<string, unknown>) => ({ format: "easyitems/1", ...o });

  it("reports shape errors with JSON paths", () => {
    const r = buildDb([{ file: "a", doc: doc({ items: [item({ price: -1, stack: 0, icon: "nope", category: "weird" as never })] }) }]);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["a:items[0].price", "a:items[0].stack", "a:items[0].icon", "a:items[0].category"]));
  });

  it("catches duplicates, unknown references with suggestions, and bad equip slots", () => {
    const r = buildDb([
      { file: "a", doc: doc({ items: [item({ id: "mango" }), item({ id: "hat", equip: { slot: "tail" }, stack: 1 })], recipes: [{ id: "r", name: { th: "ร", en: "R" }, inputs: [{ item: "mangoo", n: 1 }], outputs: [{ item: "mango", n: 1 }] }] }) },
      { file: "b", doc: doc({ items: [item({ id: "mango" })], shops: [{ id: "s", name: { th: "ร้าน", en: "S" }, buyMod: 1, sellMod: 0.5, stock: [{ item: "ghost", qty: 1 }] }] }) },
    ]);
    const msgs = r.errors.map((e) => `${e.path} ${e.message}`).join("\n");
    expect(msgs).toMatch(/duplicate item id "mango"/);
    expect(msgs).toMatch(/unknown item "mangoo" \(did you mean "mango"\?\)/);
    expect(msgs).toMatch(/unknown item "ghost"/);
    expect(msgs).toMatch(/"tail" is not in rules.equipSlots/);
  });

  it("content rules: halal shops refuse pork / alcohol; no scripture or sacred figures as items", () => {
    const r = buildDb([{ file: "a", doc: doc({ items: [item({ id: "pork_satay", name: { th: "หมูสะเต๊ะ", en: "Pork satay" } }), item({ id: "beer", category: "drink", name: { th: "เบียร์", en: "Beer" } }), item({ id: "satay" })], shops: [{ id: "halal_stall", name: { th: "ร้าน", en: "Stall" }, halal: true, buyMod: 1, sellMod: 0.5, stock: [{ item: "pork_satay", qty: 1 }, { item: "beer", qty: 1 }, { item: "satay", qty: 1 }] }] }) }]);
    expect(r.errors.filter((e) => /halal shop/.test(e.message)).length).toBe(2);
    const banned = buildDb([{ file: "a", doc: doc({ items: [item({ id: "book", name: { th: "คัมภีร์", en: "Quran stand" } })] }) }]);
    expect(banned.errors.some((e) => /content rule/.test(e.message))).toBe(true);
  });

  it("saveDoc refuses errors against the merged workspace and writes clean docs", async () => {
    const bad = await saveDoc(root, "game", doc({ items: [item({ id: "mango" })] }));
    expect(bad.saved).toBe(false);
    expect(bad.errors[0]!.message).toMatch(/duplicate/);
    const good = await saveDoc(root, "game", doc({ items: [item({ id: "satay", name: { th: "สะเต๊ะไก่", en: "Chicken satay", ms: "Sate ayam" }, tags: ["halal"] })] }));
    expect(good.saved).toBe(true);
    expect((await loadDb(root)).db.items.some((i) => i.id === "satay")).toBe(true);
  });
});

describe("Easy Quest cross-reference", () => {
  it("reads @item, give, take, has() and count() from .ezq and quest JSON", () => {
    const refs = questItemRefs("q.ezq", `@item lamp "ตะเกียง"\n=== a "A"\nstep s "x"\n    done when has(lamp) and count(rice_bag) > 1\n    give mango 2 // comment\n    take krathong`);
    expect(refs.map((r) => `${r.how}:${r.id}`)).toEqual(["item:lamp", "expr:lamp", "expr:rice_bag", "give:mango", "take:krathong"]);
    const json = questItemRefs("q.quest.json", JSON.stringify({ items: { kurma: { name: "อินทผลัม" } }, quests: [{ steps: [{ effects: [{ give: "ketupat", n: 1 }] }] }] }));
    expect(json.map((r) => r.id).sort()).toEqual(["ketupat", "kurma"]);
  });

  it("warns (with a suggestion) about quest items missing from the database", async () => {
    const { db } = await loadDb(root);
    const r = crossRefQuests(db, [{ file: "x.ezq", body: "give mangoo\ngive mango" }]);
    expect(r.missing).toEqual(["mangoo"]);
    expect(r.diagnostics[0]!.message).toMatch(/did you mean "mango"/);
  });

  it("check picks up extra quest paths", async () => {
    const f = path.join(root, "extra.ezq");
    await writeFile(f, "@item lantern_oil \"น้ำมันตะเกียง\"\n");
    const r = await checkWorkspace(root, [f]);
    expect(r.quests.missing).toEqual(["lantern_oil"]);
    expect(r.errors).toEqual([]);
    expect(await readFile(f, "utf8")).toMatch(/lantern_oil/);
  });
});
