import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canon } from "../shared/canon.js";
import { PARITY_SCRIPT, runScript } from "../shared/engine.js";
import { EXPORT_PRESETS, type ExportPreset, type Item, type ItemsDb, type Shop } from "../shared/types.js";
import { FONT_DIR, RUNTIME_DIR } from "./assets.js";
import { encodePng } from "./png.js";
import { iconPng, packIcons, type Atlas } from "./render.js";
import { dirs, loadDbStrict, resolveInside } from "./workspace.js";

export { EXPORT_PRESETS, type ExportPreset };
export const VERSION = "0.1.0";

export interface ExportOptions {
  preset?: ExportPreset;
  out?: string;
  /** Icon pixel size (default: rules.iconSize). */
  iconSize?: 24 | 32;
  /** Extra upscaled icon PNGs in the png export. */
  scale?: number;
  trustedPaths?: boolean;
}

export interface ExportResult {
  dirs: string[];
  files: string[];
  items: number;
  shops: number;
  warnings: string[];
}

class Writer {
  files: string[] = [];
  constructor(readonly dir: string) {}
  async write(rel: string, body: string | Buffer) {
    const f = path.join(this.dir, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
    this.files.push(f);
  }
  async copy(src: string, rel: string) {
    const f = path.join(this.dir, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await copyFile(src, f);
    this.files.push(f);
  }
}

/** Every icon the database uses, plus the coin for shop UIs. */
export function atlasFor(db: ItemsDb, size: number): Atlas {
  return packIcons([...db.items.map((i) => i.icon), "coin"], size);
}

const atlasJson = (a: Atlas, image: string) => ({ image, size: a.size, width: a.width, height: a.height, frames: a.frames });

export async function exportItems(root: string, opts: ExportOptions = {}): Promise<ExportResult> {
  const db = await loadDbStrict(root);
  const preset = opts.preset ?? "all";
  if (!EXPORT_PRESETS.includes(preset)) throw new Error(`Unknown preset ${preset} (${EXPORT_PRESETS.join(", ")})`);
  if (preset === "all" && opts.out) throw new Error("--out needs a single preset (godot, pixi, png or json)");
  const size = opts.iconSize ?? db.rules.iconSize;
  const presets: ExportPreset[] = preset === "all" ? ["godot", "pixi", "png", "json"] : [preset];
  const res: ExportResult = { dirs: [], files: [], items: db.items.length, shops: db.shops.length, warnings: [] };
  for (const p of presets) {
    const out = opts.out ? (opts.trustedPaths ? path.resolve(root, opts.out) : resolveInside(root, opts.out)) : path.join(dirs(root).exports, `easyitems-${p}`);
    const w = new Writer(out);
    if (p === "json") await w.write("easyitems.db.json", `${JSON.stringify(db, null, 2)}\n`);
    if (p === "png") await exportPng(w, db, size, opts.scale);
    if (p === "pixi") await exportPixi(w, db, size);
    if (p === "godot") await exportGodot(w, db, size);
    res.dirs.push(out);
    res.files.push(...w.files);
  }
  return res;
}

async function exportPng(w: Writer, db: ItemsDb, size: number, scale?: number) {
  const a = atlasFor(db, size);
  await w.write("icons.png", encodePng(a.width, a.height, a.data));
  for (const it of db.items) {
    await w.write(`icons/${it.id}.png`, iconPng(it.icon, size));
    if (scale && scale > 1) await w.write(`icons@${scale}x/${it.id}.png`, iconPng(it.icon, size, scale));
  }
  await w.write("easyitems.json", `${JSON.stringify({ format: "easyitems-export/1", version: VERSION, atlas: atlasJson(a, "icons.png"), items: db.items.map((i) => ({ id: i.id, icon: i.icon, png: `icons/${i.id}.png`, name: i.name })) }, null, 2)}\n`);
}

// ---------------- PixiJS ----------------
async function exportPixi(w: Writer, db: ItemsDb, size: number) {
  const a = atlasFor(db, size);
  await w.write("icons.png", encodePng(a.width, a.height, a.data));
  await w.write("easyitems.json", `${JSON.stringify({ format: "easyitems-export/1", version: VERSION, atlas: atlasJson(a, "icons.png"), db }, null, 2)}\n`);
  // PixiJS Spritesheet JSON (Assets.load("icons.atlas.json") → sheet.textures[iconName])
  const frames = Object.fromEntries(Object.entries(a.frames).map(([k, f]) => [k, { frame: f, sourceSize: { w: f.w, h: f.h }, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h } }]));
  await w.write("icons.atlas.json", `${JSON.stringify({ frames, meta: { image: "icons.png", size: { w: a.width, h: a.height }, scale: "1", app: "easyitems" } }, null, 2)}\n`);
  await w.copy(path.join(RUNTIME_DIR, "pixi", "easyitems-core.js"), "easyitems-core.js");
  await w.copy(path.join(RUNTIME_DIR, "pixi", "easyitems-pixi.js"), "easyitems-pixi.js");
  for (const f of ["Kanit-Regular.ttf", "OFL.txt"]) await w.copy(path.join(FONT_DIR, f), `fonts/${f}`);
  await w.write("index.html", pixiDemo(db));
  await w.write("README.txt", `Easy Items ${VERSION} — PixiJS v8 export
Serve this folder over HTTP (fetch needs it):  python3 -m http.server   then open index.html

  easyitems.json        item database (items, shops, loot, recipes, rules) + icon atlas rects
  icons.png             icon atlas (${size}px, nearest filter)
  icons.atlas.json      the same atlas as a PixiJS Spritesheet
  easyitems-core.js     Inventory / shop / loot / craft rules (no dependencies, also runs in Node)
  easyitems-pixi.js     loadItems(PIXI, "easyitems.json") → { inventory, icon(id), shopPanel(shopId, {lang}) }
  fonts/                Kanit (SIL OFL 1.1) for Thai text
`);
}

function pixiDemo(db: ItemsDb): string {
  const shops = db.shops.map((s) => `<button data-shop="${s.id}">${s.name.th} · ${s.name.en}</button>`).join("\n      ");
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>Easy Items · PixiJS demo</title>
  <style>
    html, body { margin: 0; min-height: 100vh; background: #140e0a; color: #f7ebd3; font-family: Kanit, system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
    @font-face { font-family: Kanit; src: url(fonts/Kanit-Regular.ttf); }
    button { background: #3a2819; color: #f7ebd3; border: 1px solid #523822; padding: 4px 10px; font: inherit; cursor: pointer; }
    button.on { background: #f4ae3d; color: #2a1606; }
    canvas { image-rendering: pixelated; }
  </style>
</head>
<body>
  <div id="bar">
      ${shops}
      <button data-lang="th">ไทย</button><button data-lang="en">EN</button><button data-lang="ms">BM</button>
  </div>
  <div id="stage"></div>
  <script type="module">
    async function pixi() {
      try { await import("./pixi.min.js"); if (globalThis.PIXI) return globalThis.PIXI; } catch {}
      return await import("https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.mjs");
    }
    const PIXI = await pixi();
    await document.fonts.load("16px Kanit").catch(() => {});
    const { loadItems } = await import("./easyitems-pixi.js");
    const app = new PIXI.Application();
    await app.init({ width: 900, height: 420, background: "#140e0a", antialias: false, resolution: 1 });
    document.getElementById("stage").appendChild(app.canvas);
    const items = await loadItems(PIXI, "easyitems.json");
    let shop = ${JSON.stringify(db.shops[0]?.id ?? "")}, lang = "th", panel = null;
    const show = () => {
      if (panel) panel.destroy({ children: true });
      panel = items.shopPanel(shop, { lang, width: 880, height: 400 });
      panel.position.set(10, 10);
      app.stage.addChild(panel);
      window.__items.panel = panel;
      document.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.shop === shop || b.dataset.lang === lang));
    };
    document.querySelectorAll("[data-shop]").forEach((b) => b.onclick = () => { shop = b.dataset.shop; show(); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.onclick = () => { lang = b.dataset.lang; show(); });
    window.__items = { items, app, panel: null, show, setShop: (s) => { shop = s; show(); } };
    show();
    window.__ready = true;
  </script>
</body>
</html>
`;
}

// ---------------- Godot ----------------
const gstr = (s: string) => JSON.stringify(s);
const gnum = (n: number) => (Number.isInteger(n) ? `${n}` : `${n}`);
function gvar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return gstr(v);
  if (typeof v === "number") return gnum(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map(gvar).join(", ")}]`;
  return `{\n${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${gstr(k)}: ${gvar(x)}`).join(",\n")}\n}`;
}
const col = (hex: string, a = 1) => {
  const n = parseInt(hex.slice(1), 16);
  return `Color(${((n >> 16) & 255) / 255}, ${((n >> 8) & 255) / 255}, ${(n & 255) / 255}, ${a})`.replace(/(\.\d{4})\d+/g, "$1");
};

function itemTres(it: Item, a: Atlas): string {
  const f = a.frames[it.icon]!;
  return `[gd_resource type="Resource" script_class="EasyItem" load_steps=4 format=3]

[ext_resource type="Script" path="res://easyitems/easyitem.gd" id="1_script"]
[ext_resource type="Texture2D" path="res://easyitems/icons.png" id="2_atlas"]

[sub_resource type="AtlasTexture" id="AtlasTexture_icon"]
atlas = ExtResource("2_atlas")
region = Rect2(${f.x}, ${f.y}, ${f.w}, ${f.h})

[resource]
script = ExtResource("1_script")
id = ${gstr(it.id)}
name_th = ${gstr(it.name.th)}
name_en = ${gstr(it.name.en)}
name_ms = ${gstr(it.name.ms ?? "")}
desc_th = ${gstr(it.desc?.th ?? "")}
desc_en = ${gstr(it.desc?.en ?? "")}
category = ${gstr(it.category)}
price = ${it.price}
stack = ${it.stack}
icon = SubResource("AtlasTexture_icon")
effects = ${gvar(it.effects ?? [])}
equip_slot = ${gstr(it.equip?.slot ?? "")}
equip_stats = ${gvar(it.equip?.stats ?? {})}
rarity = ${gstr(it.rarity ?? "common")}
tags = PackedStringArray(${(it.tags ?? []).map(gstr).join(", ")})
`;
}

function shopTres(s: Shop): string {
  return `[gd_resource type="Resource" script_class="EasyShop" load_steps=2 format=3]

[ext_resource type="Script" path="res://easyitems/easyshop.gd" id="1_script"]

[resource]
script = ExtResource("1_script")
id = ${gstr(s.id)}
name_th = ${gstr(s.name.th)}
name_en = ${gstr(s.name.en)}
keeper = ${gstr(s.keeper ?? "")}
buy_mod = ${s.buyMod}
sell_mod = ${s.sellMod}
halal = ${s.halal ? "true" : "false"}
stock = ${gvar(s.stock)}
`;
}

/** Teak theme close to Easy UI's (flat styleboxes; Easy UI's nine-slice teak theme is used instead when present). */
function themeTres(): string {
  const box = (id: string, bg: string, border: string, w: number, pad: number) => `[sub_resource type="StyleBoxFlat" id="${id}"]
content_margin_left = ${pad}.0
content_margin_top = ${pad}.0
content_margin_right = ${pad}.0
content_margin_bottom = ${pad}.0
bg_color = ${col(bg)}
border_width_left = ${w}
border_width_top = ${w}
border_width_right = ${w}
border_width_bottom = ${w + 1}
border_color = ${col(border)}
`;
  return `[gd_resource type="Theme" load_steps=9 format=3]

[ext_resource type="FontFile" path="res://easyitems/fonts/Kanit-Regular.ttf" id="1_font"]

${box("panel", "#3a2819", "#0d0906", 3, 8)}
${box("button", "#2a1d13", "#523822", 1, 3)}
${box("button_hover", "#523822", "#f4ae3d", 1, 3)}
${box("button_pressed", "#1e150e", "#f4ae3d", 1, 3)}
${box("tooltip", "#1e150e", "#f4ae3d", 1, 4)}
[sub_resource type="StyleBoxEmpty" id="empty"]

[resource]
default_font = ExtResource("1_font")
default_font_size = 11
PanelContainer/styles/panel = SubResource("panel")
Panel/styles/panel = SubResource("panel")
Button/colors/font_color = ${col("#f7ebd3")}
Button/colors/font_hover_color = ${col("#ffd27a")}
Button/colors/font_pressed_color = ${col("#f4ae3d")}
Button/colors/font_focus_color = ${col("#ffd27a")}
Button/font_sizes/font_size = 11
Button/styles/normal = SubResource("button")
Button/styles/hover = SubResource("button_hover")
Button/styles/pressed = SubResource("button_pressed")
Button/styles/focus = SubResource("empty")
Label/colors/font_color = ${col("#f7ebd3")}
TooltipPanel/styles/panel = SubResource("tooltip")
`;
}

const PROJECT = (title: string) => `; Engine configuration file — generated by Easy Items ${VERSION}
config_version=5

[application]

config/name=${gstr(title)}
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.3")

[autoload]

Items="*res://easyitems/easyitems.gd"

[display]

window/size/viewport_width=640
window/size/viewport_height=360
window/size/window_width_override=1280
window/size/window_height_override=720
window/stretch/mode="canvas_items"

[rendering]

textures/canvas_textures/default_texture_filter=0
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`;

const MAIN_TSCN = `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://easyitems/shop_ui.tscn" id="2_shop"]

[node name="Main" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1_main")

[node name="Backdrop" type="ColorRect" parent="."]
layout_mode = 1
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
color = Color(0.078, 0.055, 0.039, 1)

[node name="ShopUI" parent="." instance=ExtResource("2_shop")]
layout_mode = 1
`;

const SHOP_TSCN = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://easyitems/shop_ui.gd" id="1_ui"]

[node name="ShopUI" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
script = ExtResource("1_ui")
`;

const MAIN_GD = `extends Control
## Demo: the shop screen over a dark backdrop.
## User args (after --):  --shop=raya_bazaar  --lang=en  --shot=/tmp/shop.png (saves a screenshot, then quits)

var _shot := ""


func _ready() -> void:
	var ui := $ShopUI
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shop="):
			ui.shop_id = a.substr(7)
		elif a.begins_with("--lang="):
			ui.lang = a.substr(7)
		elif a.begins_with("--shot="):
			_shot = a.substr(7)
		elif a.begins_with("--select="):
			ui.call_deferred("_select", a.substr(9))
	ui.closed.connect(func(): get_tree().quit())
	if _shot != "":
		for i in 12:
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(_shot)
		print("shot ", _shot)
		get_tree().quit()
`;

function testGd(db: ItemsDb, a: Atlas): string {
  const parity = runScript(db);
  const expected = { results: parity.results, state: canon(parity.state), stats: canon(parity.stats) };
  return `extends SceneTree
## Headless check generated by Easy Items: every item / shop resource loads with its icon, the runtime replays
## the parity script and must match the TypeScript engine exactly, and the shop UI builds one tile per stock row.
## godot --headless --path . --script res://test_items.gd

const SCRIPT := ${JSON.stringify(PARITY_SCRIPT)}
const EXPECTED_RESULTS := ${JSON.stringify(expected.results)}
const EXPECTED_STATE := ${JSON.stringify(expected.state)}
const EXPECTED_STATS := ${JSON.stringify(expected.stats)}
const ICON := ${a.size}

var items: Node
var ui: Control
var frame := 0
var failed := false


func fail(msg: String) -> void:
	print("FAIL ", msg)
	failed = true


func canon(v) -> String:
	match typeof(v):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if v else "false"
		TYPE_INT:
			return str(v)
		TYPE_FLOAT:
			if v == floor(v) and abs(v) < 1e15:
				return str(int(v))
			return String.num(v, 3)
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(v))
		TYPE_ARRAY:
			var parts := PackedStringArray()
			for x in v:
				parts.append(canon(x))
			return "[" + ",".join(parts) + "]"
		TYPE_DICTIONARY:
			var keys: Array = v.keys()
			keys.sort()
			var parts := PackedStringArray()
			for k in keys:
				parts.append(JSON.stringify(str(k)) + ":" + canon(v[k]))
			return "{" + ",".join(parts) + "}"
	return str(v)


func _initialize() -> void:
	items = load("res://easyitems/easyitems.gd").new()
	items.name = "Items"
	root.add_child(items)
	items.load_db()
	var n := 0
	for id in items.items:
		var r: Resource = load("res://easyitems/items/%s.tres" % id)
		if r == null or r.id != id:
			fail("resource " + id)
			continue
		if not (r.icon is AtlasTexture) or r.icon.get_size() != Vector2(ICON, ICON) or r.icon.atlas == null:
			fail("icon " + id)
			continue
		if r.name_th != items.items[id]["name"]["th"]:
			fail("name " + id)
		n += 1
	print("R| items=%d resources_ok=%d" % [items.items.size(), n])
	for id in items.shops:
		var s: Resource = load("res://easyitems/shops/%s.tres" % id)
		if s == null or s.stock.size() != items.shops[id]["stock"].size():
			fail("shop " + id)
		else:
			print("S| %s stock=%d" % [id, s.stock.size()])
	if load("res://easyitems/theme.tres") == null:
		fail("theme")
	# parity with the TypeScript engine
	items.reset()
	var results: Array = []
	for step in SCRIPT:
		var op: String = step[0]
		var r = null
		match op:
			"buy": r = items.buy(step[1], step[2], int(step[3]))
			"sell": r = items.sell(step[1], step[2], int(step[3]))
			"craft": r = items.craft(step[1], int(step[2]))
			"equip": r = items.equip(step[1])
			"unequip": r = items.unequip(step[1])
			"use": r = items.use(step[1])
			"loot": r = items.loot(step[1], int(step[2]))
			"coins": items.state["coins"] = int(items.state["coins"]) + int(step[1])
			"day": items.advance_days(int(step[1]))
			"compact": items.compact()
		results.append("ok" if r == null or r["ok"] else str(r["reason"]))
	if results != EXPECTED_RESULTS:
		fail("results %s != %s" % [results, EXPECTED_RESULTS])
	elif canon(items.state) != EXPECTED_STATE:
		fail("state\\n  godot %s\\n  ts    %s" % [canon(items.state), EXPECTED_STATE])
	elif canon(items.stats()) != EXPECTED_STATS:
		fail("stats %s != %s" % [canon(items.stats()), EXPECTED_STATS])
	else:
		print("P| parity ok steps=%d coins=%d" % [results.size(), int(items.state["coins"])])
	var saved: Dictionary = JSON.parse_string(JSON.stringify(items.to_dict()))
	items.reset()
	items.from_dict(saved)
	if canon(items.state) != EXPECTED_STATE:
		fail("to_dict / from_dict round trip\n  %s" % canon(items.state))
	else:
		print("S| save round trip ok")
	items.reset()
	ui = load("res://easyitems/shop_ui.tscn").instantiate()
	ui.shop_id = ${gstr(db.shops[0]?.id ?? "")}
	root.add_child(ui)


func _process(_delta: float) -> bool:
	frame += 1
	if frame < 3:
		return false
	var grid: GridContainer = ui.get("_grid")
	var want: int = items.shops[ui.shop_id]["stock"].size()
	if grid == null or grid.get_child_count() != want:
		fail("shop ui tiles %s != %d" % [grid.get_child_count() if grid else -1, want])
	else:
		print("U| shop_ui %s tiles=%d" % [ui.shop_id, want])
	print("FAILED" if failed else "OK")
	return true
`;
}

async function exportGodot(w: Writer, db: ItemsDb, size: number) {
  const a = atlasFor(db, size);
  await w.write("project.godot", PROJECT("Easy Items demo"));
  await w.write("icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#3a2819"/><circle cx="8" cy="8" r="5" fill="#f4ae3d"/></svg>\n`);
  await w.write("easyitems/icons.png", encodePng(a.width, a.height, a.data));
  const coin = a.frames.coin!;
  await w.write("easyitems/coin.tres", `[gd_resource type="AtlasTexture" load_steps=2 format=3]\n\n[ext_resource type="Texture2D" path="res://easyitems/icons.png" id="1_atlas"]\n\n[resource]\natlas = ExtResource("1_atlas")\nregion = Rect2(${coin.x}, ${coin.y}, ${coin.w}, ${coin.h})\n`);
  await w.write("easyitems/db.json", `${JSON.stringify(db, null, 2)}\n`);
  for (const f of ["easyitems.gd", "easyitem.gd", "easyshop.gd", "shop_ui.gd"]) await w.copy(path.join(RUNTIME_DIR, "godot", f), `easyitems/${f}`);
  await w.write("easyitems/shop_ui.tscn", SHOP_TSCN);
  await w.write("easyitems/theme.tres", themeTres());
  for (const f of ["Kanit-Regular.ttf", "OFL.txt"]) await w.copy(path.join(FONT_DIR, f), `easyitems/fonts/${f}`);
  for (const it of db.items) await w.write(`easyitems/items/${it.id}.tres`, itemTres(it, a));
  for (const s of db.shops) await w.write(`easyitems/shops/${s.id}.tres`, shopTres(s));
  await w.write("main.tscn", MAIN_TSCN);
  await w.write("main.gd", MAIN_GD);
  await w.write("test_items.gd", testGd(db, a));
  await w.write("README.txt", `Easy Items ${VERSION} — Godot 4.3+ export

Open this folder as a project (or copy easyitems/ into yours) and add the autoload:
  Project Settings → Autoload → res://easyitems/easyitems.gd as "Items"

  easyitems/easyitems.gd     Items autoload: add/remove/count, equip/unequip/stats, buy/sell/advance_days,
                             roll_loot/loot (seeded), can_craft/craft; Items.state is plain JSON for saving
  easyitems/items/<id>.tres  EasyItem resources (names th/en/ms, price, stack, effects, equip, icon AtlasTexture)
  easyitems/shops/<id>.tres  EasyShop resources
  easyitems/shop_ui.tscn     shop screen (Easy UI's teak theme when res://easyui/themes/teak.tres exists)
  easyitems/theme.tres       fallback teak theme with Kanit (Thai glyphs)
  easyitems/db.json          the merged database the autoload reads
  test_items.gd              godot --headless --path . --script res://test_items.gd

Run the demo:  godot --path .   (user args: -- --shop=raya_bazaar --lang=en)
Nearest filtering is on (project setting); keep integer scales for crisp icons.
`);
}
