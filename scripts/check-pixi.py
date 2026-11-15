"""Headless Chrome check of a PixiJS export: the shop panel builds and real mouse clicks buy and sell.

  python3 scripts/check-pixi.py <pixi-export-dir> [screenshot.png]

Serves the folder on 127.0.0.1:8987, waits for window.__ready, then for each shop: checks one tile per stock
entry, clicks a tile (selects it), clicks btn:buy and checks coins drop by the shop's buy price and the bag
gains the item, clicks btn:sell where the shop buys it back. Switches language to Malay. Prints a JSON report;
exit 1 on any failure or console error.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

DIR = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
PORT = 8987
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

FIND = """(label) => { const p = window.__items.panel; const c = p.children.find((x) => x.label === label); if (!c) return null;
  const g = c.getGlobalPosition(); const b = c.getBounds(); return { x: g.x + 8, y: g.y + 8, w: b.width, h: b.height }; }"""
STATE = """(item) => { const inv = window.__items.items.inventory; return { coins: inv.state.coins, n: inv.count(item),
  tiles: window.__items.panel.children.filter((x) => (x.label || '').startsWith('stock:')).length }; }"""


async def main():
    data = json.load(open(os.path.join(DIR, "easyitems.json")))
    db = data["db"]
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        pg = await b.new_page(viewport={"width": 1000, "height": 560})
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("response", lambda r: errs.append(f"http {r.status}: {r.url}") if r.status >= 400 and not r.url.endswith("/pixi.min.js") else None)
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html")
        await pg.wait_for_function("window.__ready === true", timeout=40000)
        canvas = await pg.locator("canvas").bounding_box()

        async def click(label):
            pos = await pg.evaluate(FIND, label)
            if not pos:
                return False
            await pg.mouse.click(canvas["x"] + pos["x"], canvas["y"] + pos["y"])
            await pg.wait_for_timeout(80)
            return True

        problems, trades = [], []
        for shop in db["shops"]:
            await pg.evaluate("(s) => window.__items.setShop(s)", shop["id"])
            await pg.wait_for_timeout(150)
            inv_price = lambda item: pg.evaluate("([s, i]) => window.__items.items.inventory.buyPrice(s, i)", [shop["id"], item])
            # pick the cheapest stocked item so the starting coins cover it
            cands = [e["item"] for e in shop["stock"] if e["qty"] != 0]
            prices = {i: await inv_price(i) for i in cands}
            item = min(cands, key=lambda i: prices[i])
            st0 = await pg.evaluate(STATE, item)
            if st0["tiles"] != len(shop["stock"]):
                problems.append(f"{shop['id']}: {st0['tiles']} tiles for {len(shop['stock'])} stock entries")
            if not await click(f"stock:{item}"):
                problems.append(f"{shop['id']}: no tile for {item}")
                continue
            if not await click("btn:buy"):
                problems.append(f"{shop['id']}: no buy button")
                continue
            st1 = await pg.evaluate(STATE, item)
            if st1["coins"] != st0["coins"] - prices[item] or st1["n"] != st0["n"] + 1:
                problems.append(f"{shop['id']}: buy {item} coins {st0['coins']}→{st1['coins']} (price {prices[item]}) count {st0['n']}→{st1['n']}")
            sell = await pg.evaluate("([s, i]) => window.__items.items.inventory.sellPrice(s, i)", [shop["id"], item])
            trade = {"shop": shop["id"], "item": item, "buy": prices[item], "coins": [st0["coins"], st1["coins"]]}
            if sell is not None:
                await click("btn:sell")
                st2 = await pg.evaluate(STATE, item)
                if st2["coins"] != st1["coins"] + sell or st2["n"] != st1["n"] - 1:
                    problems.append(f"{shop['id']}: sell {item} coins {st1['coins']}→{st2['coins']} (price {sell})")
                trade["sell"] = sell
                trade["coins"].append(st2["coins"])
            trades.append(trade)
        await pg.click("[data-lang=ms]")
        await pg.wait_for_timeout(200)
        await pg.evaluate("(s) => window.__items.setShop(s)", db["shops"][-1]["id"])
        await pg.wait_for_timeout(300)
        if SHOT:
            await pg.locator("canvas").screenshot(path=SHOT)
        real = [e for e in errs if "GL Driver Message" not in e and "Failed to load resource" not in e]
        report = {"shops": len(db["shops"]), "items": len(db["items"]), "trades": trades, "problems": problems, "errors": real}
        print(json.dumps(report, ensure_ascii=False))
        await b.close()
        if problems or real:
            sys.exit(1)


try:
    asyncio.run(main())
finally:
    srv.terminate()
