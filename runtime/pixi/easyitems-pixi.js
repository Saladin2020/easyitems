/**
 * Easy Items for PixiJS v8: icons from the exported atlas, the inventory/shop runtime, and a simple shop panel.
 *
 *   import { loadItems } from "./easyitems-pixi.js";
 *   const items = await loadItems(PIXI, "easyitems.json");
 *   const panel = items.shopPanel("market", { lang: "th" }); app.stage.addChild(panel);
 *   items.inventory.buy("market", "thai_tea"); items.icon("mango") // PIXI.Sprite
 */
import { Inventory, rollLoot } from "./easyitems-core.js";

export { Inventory, rollLoot };

const TEAK = { bg: 0x2a1d13, panel: 0x3a2819, rim: 0x523822, ink: 0x0d0906, slot: 0x1e150e, gold: 0xf4ae3d, text: 0xf7ebd3, muted: 0xcdb492, bad: 0xe5806c };
const WORDS = {
  th: { buy: "ซื้อ", sell: "ขาย", bag: "กระเป๋า", left: "เหลือ", ok_buy: "ซื้อแล้ว", ok_sell: "ขายแล้ว", not_enough_coins: "เหรียญไม่พอ", out_of_stock: "ของหมด", inventory_full: "กระเป๋าเต็ม", shop_wont_buy: "ร้านนี้ไม่รับซื้อ", not_owned: "ไม่มีของชิ้นนี้" },
  en: { buy: "Buy", sell: "Sell", bag: "Bag", left: "left", ok_buy: "Bought", ok_sell: "Sold", not_enough_coins: "Not enough coins", out_of_stock: "Sold out", inventory_full: "Bag is full", shop_wont_buy: "This shop won't buy that", not_owned: "You don't have one" },
  ms: { buy: "Beli", sell: "Jual", bag: "Beg", left: "baki", ok_buy: "Dibeli", ok_sell: "Dijual", not_enough_coins: "Syiling tidak cukup", out_of_stock: "Habis dijual", inventory_full: "Beg penuh", shop_wont_buy: "Kedai ini tidak membeli itu", not_owned: "Tiada barang ini" },
};

export async function loadItems(PIXI, url = "easyitems.json", opts = {}) {
  const base = new URL(url, location.href);
  const data = await (await fetch(base)).json();
  const tex = await PIXI.Assets.load(new URL(data.atlas.image, base).href);
  tex.source.scaleMode = "nearest";
  const textures = {};
  for (const [name, f] of Object.entries(data.atlas.frames)) textures[name] = new PIXI.Texture({ source: tex.source, frame: new PIXI.Rectangle(f.x, f.y, f.w, f.h) });
  const inventory = new Inventory(data.db, opts.state);
  const font = opts.fontFamily ?? "Kanit, 'Noto Sans Thai', sans-serif";
  const iconSize = data.atlas.size;

  const texture = (iconName) => textures[iconName];
  const icon = (itemId, scale = 1) => {
    const s = new PIXI.Sprite(textures[inventory.item(itemId).icon]);
    s.scale.set(scale);
    return s;
  };
  const text = (t, size, fill = TEAK.text) => new PIXI.Text({ text: t, style: { fontFamily: font, fontSize: size, fill } });

  function shopPanel(shopId, o = {}) {
    const lang = o.lang ?? "th";
    const W = WORDS[lang] ?? WORDS.en;
    const sc = o.iconScale ?? 2;
    const cols = o.cols ?? 5;
    const cell = iconSize * sc + 16;
    const shop = inventory.shop(shopId);
    const width = o.width ?? cols * (cell + 4) + 300;
    const rowsN = Math.ceil(shop.stock.length / cols);
    const height = o.height ?? Math.max(rowsN * (cell + 22) + 70, 330);
    const root = new PIXI.Container();
    root.label = `shop:${shopId}`;
    let selected = shop.stock[0]?.item ?? null;
    let status = "";
    const redraw = () => {
      root.removeChildren().forEach((c) => c.destroy({ children: true }));
      const g = new PIXI.Graphics();
      g.rect(0, 0, width, height).fill(TEAK.ink);
      g.rect(3, 3, width - 6, height - 6).fill(TEAK.rim);
      g.rect(6, 6, width - 12, height - 12).fill(TEAK.panel);
      g.rect(6, 36, width - 12, 2).fill(TEAK.ink);
      root.addChild(g);
      const title = text(shop.name[lang] || shop.name.th, 18, TEAK.gold);
      title.position.set(16, 8);
      root.addChild(title);
      const coin = new PIXI.Sprite(textures.coin);
      coin.position.set(width - 120, 9);
      root.addChild(coin);
      const coins = text(String(inventory.state.coins), 16);
      coins.position.set(width - 90, 10);
      root.addChild(coins);
      shop.stock.forEach((e, i) => {
        const x = 14 + (i % cols) * (cell + 4);
        const y = 46 + Math.floor(i / cols) * (cell + 22);
        const tile = new PIXI.Container();
        tile.position.set(x, y);
        tile.eventMode = "static";
        tile.cursor = "pointer";
        tile.label = `stock:${e.item}`;
        const b = new PIXI.Graphics();
        b.rect(0, 0, cell, cell + 18).fill(TEAK.ink);
        b.rect(1, 1, cell - 2, cell + 16).fill(e.item === selected ? TEAK.rim : TEAK.slot);
        if (e.item === selected) b.rect(1, 1, cell - 2, 2).fill(TEAK.gold);
        tile.addChild(b);
        const s = icon(e.item, sc);
        s.position.set(8, 6);
        tile.addChild(s);
        const q = inventory.stock(shopId, e.item);
        const price = text(`฿${inventory.buyPrice(shopId, e.item)}`, 11, TEAK.gold);
        price.position.set(6, cell - 6);
        tile.addChild(price);
        const left = text(q === -1 ? "∞" : `${W.left} ${q}`, 9, q === 0 ? TEAK.bad : TEAK.muted);
        left.position.set(6, cell + 5);
        tile.addChild(left);
        tile.on("pointertap", () => {
          selected = e.item;
          redraw();
        });
        root.addChild(tile);
      });
      const sx = 14 + cols * (cell + 4) + 8;
      if (selected) {
        const it = inventory.item(selected);
        const big = icon(selected, 3);
        big.position.set(sx, 46);
        root.addChild(big);
        const nm = text(it.name[lang] || it.name.th, 16, TEAK.text);
        nm.position.set(sx + iconSize * 3 + 10, 48);
        root.addChild(nm);
        const sub = text(`${it.name.en}${it.name.ms && lang !== "ms" ? " · " + it.name.ms : ""}`, 11, TEAK.muted);
        sub.position.set(sx + iconSize * 3 + 10, 72);
        root.addChild(sub);
        const sp = inventory.sellPrice(shopId, selected);
        const prices = text(`${W.buy} ฿${inventory.buyPrice(shopId, selected) ?? "-"}  ·  ${W.sell} ฿${sp ?? "-"}`, 12, TEAK.gold);
        prices.position.set(sx + iconSize * 3 + 10, 92);
        root.addChild(prices);
        const desc = it.desc ? text(it.desc[lang] || it.desc.en, 11, TEAK.muted) : null;
        if (desc) {
          desc.style.wordWrap = true;
          desc.style.wordWrapWidth = width - sx - 20;
          desc.position.set(sx, 46 + iconSize * 3 + 8);
          root.addChild(desc);
        }
        [["buy", W.buy], ["sell", W.sell]].forEach(([kind, label], j) => {
          const btn = new PIXI.Container();
          btn.label = `btn:${kind}`;
          btn.eventMode = "static";
          btn.cursor = "pointer";
          btn.position.set(sx + j * 96, 46 + iconSize * 3 + 44);
          const bg = new PIXI.Graphics();
          bg.rect(0, 0, 88, 26).fill(TEAK.ink);
          bg.rect(1, 1, 86, 23).fill(kind === "buy" ? TEAK.gold : TEAK.rim);
          btn.addChild(bg);
          const t = text(label, 13, kind === "buy" ? 0x2a1606 : TEAK.text);
          t.anchor.set(0.5);
          t.position.set(44, 13);
          btn.addChild(t);
          btn.on("pointertap", () => {
            const r = kind === "buy" ? inventory.buy(shopId, selected) : inventory.sell(shopId, selected);
            status = r.ok ? W[`ok_${kind}`] : (W[r.reason] ?? r.reason);
            o.onTrade?.(kind, selected, r);
            redraw();
          });
          root.addChild(btn);
        });
      }
      const bagY = height - 26 - (iconSize + 6) - 18;
      const bl = text(W.bag, 12, TEAK.muted);
      bl.position.set(sx, bagY);
      root.addChild(bl);
      let k = 0;
      for (const s of inventory.state.slots) {
        if (!s) continue;
        const x = sx + (k % 8) * (iconSize + 6);
        if (x + iconSize > width - 10) break;
        const gg = new PIXI.Graphics();
        gg.rect(x - 2, bagY + 18, iconSize + 4, iconSize + 4).fill(TEAK.slot);
        root.addChild(gg);
        const sp = icon(s.item, 1);
        sp.position.set(x, bagY + 20);
        root.addChild(sp);
        if (s.n > 1) {
          const n = text(String(s.n), 9, TEAK.text);
          n.position.set(x + iconSize - 8, bagY + 20 + iconSize - 10);
          root.addChild(n);
        }
        k++;
      }
      const st = text(status, 12, status && /แล้ว|Bought|Sold|Dibeli|Dijual/.test(status) ? TEAK.gold : TEAK.bad);
      st.position.set(16, height - 26);
      root.addChild(st);
    };
    redraw();
    root.refresh = redraw;
    root.select = (id) => {
      selected = id;
      redraw();
    };
    return root;
  }

  return { db: data.db, atlas: data.atlas, inventory, textures, texture, icon, shopPanel, rollLoot: (id, seed) => rollLoot(data.db, id, seed) };
}
