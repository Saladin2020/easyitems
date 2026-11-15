import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportItems } from "../src/lib/export.js";
import { decodePng } from "../src/lib/png.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => ({ root, cleanup } = await tempWorkspace()));
afterAll(() => cleanup());

describe("export", () => {
  it("all presets write their folders", async () => {
    const r = await exportItems(root);
    expect(r.dirs.map((d) => path.basename(d))).toEqual(["easyitems-godot", "easyitems-pixi", "easyitems-png", "easyitems-json"]);
    expect(r.items).toBeGreaterThanOrEqual(40);
  });

  it("godot: project, autoload, resources with AtlasTexture icons, shop UI, theme with Kanit, test script", async () => {
    const g = path.join(root, "exports", "easyitems-godot");
    const project = await readFile(path.join(g, "project.godot"), "utf8");
    expect(project).toMatch(/Items="\*res:\/\/easyitems\/easyitems.gd"/);
    expect(project).toMatch(/default_texture_filter=0/);
    const tres = await readFile(path.join(g, "easyitems/items/mango_sticky_rice.tres"), "utf8");
    expect(tres).toMatch(/script_class="EasyItem"/);
    expect(tres).toMatch(/name_th = "ข้าวเหนียวมะม่วง"/);
    expect(tres).toMatch(/region = Rect2\(\d+, \d+, 24, 24\)/);
    expect(tres).toMatch(/"kind": "heal"/);
    expect(await readFile(path.join(g, "easyitems/shops/raya_bazaar.tres"), "utf8")).toMatch(/halal = true/);
    expect(await readFile(path.join(g, "easyitems/theme.tres"), "utf8")).toMatch(/Kanit-Regular.ttf/);
    const test = await readFile(path.join(g, "test_items.gd"), "utf8");
    expect(test).toMatch(/EXPECTED_STATE := "\{/);
    for (const f of ["easyitems/shop_ui.tscn", "easyitems/shop_ui.gd", "easyitems/coin.tres", "easyitems/db.json", "easyitems/fonts/Kanit-Regular.ttf", "main.tscn", "main.gd"]) await access(path.join(g, f));
  });

  it("pixi: db + atlas JSON, spritesheet, runtime files and demo", async () => {
    const p = path.join(root, "exports", "easyitems-pixi");
    const data = JSON.parse(await readFile(path.join(p, "easyitems.json"), "utf8"));
    expect(data.db.items.length).toBeGreaterThanOrEqual(40);
    expect(data.atlas.frames.coin).toBeTruthy();
    const png = decodePng(await readFile(path.join(p, "icons.png")));
    expect([png.width, png.height]).toEqual([data.atlas.width, data.atlas.height]);
    const sheet = JSON.parse(await readFile(path.join(p, "icons.atlas.json"), "utf8"));
    expect(Object.keys(sheet.frames).length).toBe(Object.keys(data.atlas.frames).length);
    expect(await readFile(path.join(p, "index.html"), "utf8")).toMatch(/shopPanel|loadItems/);
    for (const f of ["easyitems-core.js", "easyitems-pixi.js", "fonts/Kanit-Regular.ttf"]) await access(path.join(p, f));
  });

  it("png at 32 px with upscaled copies; --out stays inside the workspace", async () => {
    const r = await exportItems(root, { preset: "png", iconSize: 32, scale: 4, out: "exports/png32" });
    const one = decodePng(await readFile(path.join(r.dirs[0]!, "icons/kurma.png")));
    expect(one.width).toBe(32);
    expect(decodePng(await readFile(path.join(r.dirs[0]!, "icons@4x/kurma.png"))).width).toBe(128);
    await expect(exportItems(root, { preset: "json", out: "../../escape" })).rejects.toThrow(/outside the workspace/);
    await expect(exportItems(root, { preset: "all", out: "x" })).rejects.toThrow(/single preset/);
  });
});
