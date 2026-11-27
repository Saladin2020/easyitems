/** CLI smoke test: init a temp workspace and drive every command through the real CLI. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ws = mkdtempSync(path.join(os.tmpdir(), "easyitems-cli-"));
const cli = (...args) => execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args, "--workspace", ws], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let failed = false;
const ok = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed = true;
};
const png = (f) => existsSync(f) && readFileSync(f).toString("ascii", 1, 4) === "PNG";

cli("init");
ok(existsSync(path.join(ws, "items", "village.easyitems.json")) && existsSync(path.join(ws, "items", "raya.easyitems.json")), "init copies the starter catalog");
const listed = JSON.parse(cli("list", "--json"));
ok(listed.items.length >= 40, `list: ${listed.items.length} items`);
ok(/ketupat/.test(cli("list", "--tag", "raya")) && !/thai_tea/.test(cli("list", "--tag", "raya")), "list --tag raya");
ok(/rice_bag/.test(cli("list", "--category", "ingredient")), "list --category");
const shown = JSON.parse(cli("show", "kurma"));
ok(shown.shops.some((s) => s.shop === "raya_bazaar") && shown.recipes.length === 0, "show kurma: sold at the Raya bazaar");
ok(/ตลาดรายอ.*halal/.test(cli("shops")), "shops lists the halal Raya bazaar");
ok(/ketupat\s+฿\s+14/.test(cli("shops", "raya_bazaar")), "shops raya_bazaar shows the Raya discount");
ok(cli("icons", "--json").includes('"prayer_mat"'), "icons");
const chk = cli("check");
ok(/ok\s+\d+ items · 0 errors/.test(chk) && /11 item ids matched/.test(chk), "check: clean, quest items matched");
cli("render", "--out", path.join(ws, "all.png"), "--scale", "3");
ok(png(path.join(ws, "all.png")), "render all items");
cli("render", "--icons", "--size", "32", "--out", path.join(ws, "icons32.png"));
ok(png(path.join(ws, "icons32.png")) && readFileSync(path.join(ws, "icons32.png")).readUInt32BE(16) === 10 * (32 * 2 + 8), "render --icons --size 32");
const loot = JSON.parse(cli("loot", "market_basket", "--seed", "42", "--times", "3", "--json"));
ok(loot.length === 3 && loot.every((r) => r.items.some((i) => i.item === "sticky_rice")), "loot: guaranteed sticky rice");
ok(cli("loot", "market_basket", "--seed", "42") === cli("loot", "market_basket", "--seed", "42"), "loot is deterministic");
cli("add-item", "khanom_tom", "--th", "ขนมต้ม", "--en", "Coconut rice balls", "--ms", "Onde-onde", "--icon", "kanom_chan", "--category", "food", "--price", "12", "--tag", "dessert");
ok(JSON.parse(cli("show", "khanom_tom")).source === "game.easyitems.json", "add-item writes items/game.easyitems.json");
writeFileSync(path.join(ws, "items", "broken.easyitems.json"), JSON.stringify({ format: "easyitems/1", shops: [{ id: "bad_stall", name: { th: "ร้าน", en: "Stall" }, halal: true, buyMod: 1, sellMod: 0.5, stock: [{ item: "sato_jar", qty: 1 }] }], items: [{ id: "sato_jar", name: { th: "สาโท", en: "Rice wine" }, category: "drink", price: 40, stack: 5, icon: "fish_sauce" }] }));
let out = "";
try {
  cli("check");
} catch (e) {
  out = String(e.stdout) + String(e.stderr);
}
ok(/halal shop "bad_stall" may not stock "sato_jar"/.test(out) && /FAIL/.test(out), "check enforces the halal-shop rule and exits 1");
rmSync(path.join(ws, "items", "broken.easyitems.json"));
cli("export", "--preset", "all");
for (const f of ["exports/easyitems-godot/project.godot", "exports/easyitems-godot/easyitems/items/rendang.tres", "exports/easyitems-godot/easyitems/shop_ui.tscn", "exports/easyitems-godot/test_items.gd", "exports/easyitems-pixi/easyitems.json", "exports/easyitems-pixi/easyitems-pixi.js", "exports/easyitems-pixi/index.html", "exports/easyitems-png/icons/khanom_tom.png", "exports/easyitems-json/easyitems.db.json"]) ok(existsSync(path.join(ws, f)), `export → ${f}`);

rmSync(ws, { recursive: true, force: true });
console.log(failed ? "CLI smoke FAILED" : "CLI smoke OK");
process.exit(failed ? 1 : 0);
