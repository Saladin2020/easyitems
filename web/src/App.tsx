import { useCallback, useEffect, useMemo, useState } from "react";
import { Inventory, rollLoot } from "../../src/shared/engine";
import type { Diagnostic, Item, ItemsDb, ItemsDoc, Shop } from "../../src/shared/types";
import { exportItems, fetchCheck, fetchDb, fetchDoc, fetchWorkspace, saveDoc, type AtlasInfo, type CheckResponse, type WorkspaceInfo } from "./api";

type Tab = "items" | "shops" | "loot" | "check";
type Lang = "th" | "en" | "ms";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function Icon({ atlas, name, scale = 2, title }: { atlas: AtlasInfo; name: string; scale?: number; title?: string }) {
  const f = atlas.frames[name];
  const s = atlas.size * scale;
  if (!f) return <span className="icon missing" style={{ width: s, height: s }} title={`unknown icon ${name}`} />;
  return (
    <span
      className="icon"
      title={title ?? name}
      style={{ width: s, height: s, backgroundImage: `url(${atlas.image})`, backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`, backgroundPosition: `-${f.x * scale}px -${f.y * scale}px` }}
    />
  );
}

const nm = (t: { th: string; en: string; ms?: string } | undefined, lang: Lang) => (t ? (t[lang] || t.th) : "");

export function App() {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [db, setDb] = useState<ItemsDb | null>(null);
  const [dbErrors, setDbErrors] = useState<Diagnostic[]>([]);
  const [tab, setTab] = useState<Tab>("items");
  const [lang, setLang] = useState<Lang>("th");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<string>("mango_sticky_rice");
  const [draft, setDraft] = useState<Item | null>(null);
  const [filter, setFilter] = useState("");
  const [cat, setCat] = useState("");
  const [shopId, setShopId] = useState("market");
  const [inv, setInv] = useState<Inventory | null>(null);
  const [, bump] = useState(0);
  const [lootId, setLootId] = useState("delivery_tip");
  const [seed, setSeed] = useState(1);
  const [check, setCheck] = useState<CheckResponse | null>(null);
  const [diag, setDiag] = useState<Diagnostic[]>([]);

  const reload = useCallback(async () => {
    const r = await fetchDb();
    setDb(r.db);
    setDbErrors(r.errors);
    setInv(new Inventory(r.db));
    return r.db;
  }, []);

  useEffect(() => {
    fetchWorkspace().then(setWs).catch((e: Error) => setStatus(e.message));
    reload().catch((e: Error) => setStatus(e.message));
  }, [reload]);

  useEffect(() => {
    if (!db) return;
    const it = db.items.find((i) => i.id === sel) ?? db.items[0];
    if (it) {
      setDraft(clone(it));
      if (it.id !== sel) setSel(it.id);
    }
    if (!db.shops.some((s) => s.id === shopId) && db.shops[0]) setShopId(db.shops[0].id);
  }, [db, sel, shopId]);

  useEffect(() => {
    if (tab === "check") fetchCheck().then(setCheck).catch((e: Error) => setStatus(e.message));
  }, [tab]);

  const items = useMemo(() => {
    if (!db) return [];
    const q = filter.toLowerCase();
    return db.items.filter((i) => (!cat || i.category === cat) && (!q || `${i.id} ${i.name.th} ${i.name.en} ${i.name.ms ?? ""} ${(i.tags ?? []).join(" ")}`.toLowerCase().includes(q)));
  }, [db, filter, cat]);

  if (!ws || !db || !inv) return <div className="loading">Easy Items · กำลังโหลด… {status}</div>;
  const A = ws.atlas;
  const docOf = (kind: string, id: string) => db.sources[`${kind}:${id}`]?.replace(/\.easyitems\.json$/, "") ?? "game";

  async function saveItem() {
    if (!draft) return;
    const docId = docOf("items", sel) ?? "game";
    let doc: ItemsDoc;
    try {
      doc = (await fetchDoc(docId)).doc;
    } catch {
      doc = { format: "easyitems/1", id: docId, items: [] };
    }
    const list = doc.items ?? [];
    const idx = list.findIndex((i) => i.id === sel);
    if (idx >= 0) list[idx] = draft;
    else list.push(draft);
    doc.items = list;
    const r = await saveDoc(docId, doc);
    setDiag([...r.errors, ...r.warnings]);
    setStatus(r.ok ? `saved ${r.file}` : `not saved: ${r.errors.length} error(s)`);
    if (r.ok) {
      await reload();
      setSel(draft.id);
    }
  }

  const set = <K extends keyof Item>(k: K, v: Item[K]) => draft && setDraft({ ...draft, [k]: v });
  const shop: Shop | undefined = db.shops.find((s) => s.id === shopId);
  const trade = (kind: "buy" | "sell", id: string) => {
    const r = kind === "buy" ? inv.buy(shopId, id) : inv.sell(shopId, id);
    setStatus(r.ok ? `${kind} ${id} ✓ (${r.coins! > 0 ? "+" : ""}${r.coins})` : `${kind} ${id}: ${r.reason}`);
    bump((n) => n + 1);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" />
          <div>
            <h1 className="brand">
              Easy <span>Items</span>
            </h1>
            <p className="brand-th">ไอเทม ร้านค้า กระเป๋า · items, shops & inventory</p>
          </div>
        </div>
        <nav className="tabs">
          {(["items", "shops", "loot", "check"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {{ items: "ไอเทม Items", shops: "ร้านค้า Shops", loot: "ดรอป & สูตร Loot", check: `ตรวจ Check${dbErrors.length ? ` (${dbErrors.length})` : ""}` }[t]}
            </button>
          ))}
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} title="display language">
            <option value="th">ไทย</option>
            <option value="en">English</option>
            <option value="ms">Melayu</option>
          </select>
        </nav>
        <div className="status mono">{status || `${db.items.length} items · ${db.shops.length} shops · ${ws.root}`}</div>
      </header>

      {tab === "items" && draft && (
        <main className="layout">
          <aside className="panel list">
            <input className="search" placeholder="ค้นหา / search" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="chips">
              <button className={!cat ? "on" : ""} onClick={() => setCat("")}>all</button>
              {ws.categories.filter((c) => db.items.some((i) => i.category === c)).map((c) => (
                <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>
              ))}
            </div>
            {items.map((i) => (
              <button key={i.id} className={`item-btn${i.id === sel ? " on" : ""}`} onClick={() => setSel(i.id)}>
                <Icon atlas={A} name={i.icon} scale={1} />
                <span>
                  <b>{nm(i.name, lang)}</b>
                  <small>
                    {i.id} · ฿{i.price} · ×{i.stack}
                  </small>
                </span>
              </button>
            ))}
          </aside>

          <section className="panel form">
            <h2>
              {nm(draft.name, lang)} <small className="mono">{draft.id} · {docOf("items", sel)}.easyitems.json</small>
            </h2>
            <div className="grid2">
              <label>ไทย<input value={draft.name.th} onChange={(e) => set("name", { ...draft.name, th: e.target.value })} /></label>
              <label>English<input value={draft.name.en} onChange={(e) => set("name", { ...draft.name, en: e.target.value })} /></label>
              <label>Melayu<input value={draft.name.ms ?? ""} onChange={(e) => set("name", { ...draft.name, ms: e.target.value })} /></label>
              <label>category
                <select value={draft.category} onChange={(e) => set("category", e.target.value as Item["category"])}>
                  {ws.categories.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label>price ฿<input type="number" min={0} value={draft.price} onChange={(e) => set("price", Number(e.target.value))} /></label>
              <label>stack<input type="number" min={1} max={999} value={draft.stack} onChange={(e) => set("stack", Number(e.target.value))} /></label>
              <label>rarity
                <select value={draft.rarity ?? "common"} onChange={(e) => set("rarity", e.target.value as Item["rarity"])}>
                  {ws.rarities.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label>tags<input value={(draft.tags ?? []).join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} /></label>
              <label className="wide">คำอธิบาย (th)<input value={draft.desc?.th ?? ""} onChange={(e) => set("desc", { th: e.target.value, en: draft.desc?.en ?? "" })} /></label>
              <label className="wide">description (en)<input value={draft.desc?.en ?? ""} onChange={(e) => set("desc", { th: draft.desc?.th ?? "", en: e.target.value })} /></label>
            </div>
            <h4>effects</h4>
            {(draft.effects ?? []).map((ef, i) => (
              <div className="row" key={i}>
                <select value={ef.kind} onChange={(e) => set("effects", draft.effects!.map((x, j) => (j === i ? { ...x, kind: e.target.value as typeof ef.kind } : x)))}>
                  {ws.effectKinds.map((k) => <option key={k}>{k}</option>)}
                </select>
                <input type="number" value={ef.amount} onChange={(e) => set("effects", draft.effects!.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                <button onClick={() => set("effects", draft.effects!.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button className="link" onClick={() => set("effects", [...(draft.effects ?? []), { kind: "heal", amount: 10 }])}>+ effect</button>
            <h4>equip</h4>
            <div className="row">
              <select value={draft.equip?.slot ?? ""} onChange={(e) => set("equip", e.target.value ? { slot: e.target.value, stats: draft.equip?.stats ?? {} } : undefined)}>
                <option value="">— not equipment —</option>
                {db.rules.equipSlots.map((s) => <option key={s}>{s}</option>)}
              </select>
              {draft.equip && (
                <input className="mono" value={Object.entries(draft.equip.stats ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")} placeholder="speed=0.4, carry=4"
                  onChange={(e) => set("equip", { ...draft.equip!, stats: Object.fromEntries(e.target.value.split(",").map((p) => p.split("=").map((s) => s.trim())).filter((p) => p[0] && p[1] !== undefined).map(([k, v]) => [k!, Number(v)])) })} />
              )}
            </div>
            <h4>icon · {draft.icon}</h4>
            <div className="icon-grid">
              {ws.iconNames.map((ic) => (
                <button key={ic.name} className={draft.icon === ic.name ? "on" : ""} onClick={() => set("icon", ic.name)} title={`${ic.name} · ${ic.th}`}>
                  <Icon atlas={A} name={ic.name} scale={1} />
                </button>
              ))}
            </div>
            <div className="save">
              <button className="primary" onClick={() => void saveItem()}>บันทึก Save</button>
              <div className="diag">{diag.map((d, i) => <p key={i} className={d.severity === "error" ? "err" : "warn"}>{d.path}: {d.message}</p>)}</div>
            </div>
          </section>

          <aside className="panel side">
            <div className="hero">
              <Icon atlas={A} name={draft.icon} scale={6} />
              <div>
                <b>{draft.name.th}</b>
                <small>{draft.name.en}{draft.name.ms ? ` · ${draft.name.ms}` : ""}</small>
                <small className="mono">{draft.category} · ×{draft.stack}{draft.equip ? ` · ${draft.equip.slot}` : ""}</small>
              </div>
            </div>
            <h4>ขายที่ร้าน · Sold at</h4>
            <table className="tbl">
              <tbody>
                {db.shops.filter((s) => s.stock.some((e) => e.item === draft.id)).map((s) => (
                  <tr key={s.id}><td>{nm(s.name, lang)}</td><td className="mono">฿{inv.buyPrice(s.id, draft.id)}</td><td className="mono">{inv.sellPrice(s.id, draft.id) === null ? "—" : `sell ฿${inv.sellPrice(s.id, draft.id)}`}</td></tr>
                ))}
              </tbody>
            </table>
            <h4>สูตร · Recipes</h4>
            {db.recipes.filter((r) => [...r.inputs, ...r.outputs].some((e) => e.item === draft.id)).map((r) => (
              <div className="recipe" key={r.id}>
                {r.inputs.map((e) => <span key={e.item}><Icon atlas={A} name={db.items.find((i) => i.id === e.item)?.icon ?? ""} scale={1} />×{e.n}</span>)} →{" "}
                {r.outputs.map((e) => <span key={e.item}><Icon atlas={A} name={db.items.find((i) => i.id === e.item)?.icon ?? ""} scale={1} />×{e.n}</span>)}
                <small>{nm(r.name, lang)}</small>
              </div>
            ))}
            <h4>Export</h4>
            <div className="export-grid">
              {["godot", "pixi", "png", "all"].map((p) => (
                <button key={p} onClick={() => exportItems(p).then((r) => setStatus(`exported ${r.dirs.join(", ")} (${r.files} files)`)).catch((e: Error) => setStatus(e.message))}>{p}</button>
              ))}
            </div>
          </aside>
        </main>
      )}

      {tab === "shops" && shop && (
        <main className="layout shops">
          <aside className="panel list">
            {db.shops.map((s) => (
              <button key={s.id} className={`item-btn${s.id === shopId ? " on" : ""}`} onClick={() => setShopId(s.id)}>
                <span>
                  <b>{nm(s.name, lang)}{s.halal ? " · ฮาลาล" : ""}</b>
                  <small>{s.id} · buy ×{s.buyMod} · sell ×{s.sellMod} · {s.stock.length} items</small>
                </span>
              </button>
            ))}
            <div className="sim-actions">
              <button className="link" onClick={() => { setInv(new Inventory(db)); setStatus("inventory reset"); }}>↺ reset inventory</button>
              <button className="link" onClick={() => { inv.advanceDays(1); bump((n) => n + 1); setStatus(`day ${inv.state.day}: restocked`); }}>☀ next day</button>
            </div>
          </aside>
          <section className="panel shop-sim">
            <div className="shop-head">
              <h2>{nm(shop.name, lang)}</h2>
              <span className="coins"><Icon atlas={A} name="coin" scale={1} /> {inv.state.coins}</span>
            </div>
            <div className="stock-grid">
              {shop.stock.map((e) => {
                const it = db.items.find((i) => i.id === e.item)!;
                const q = inv.state.stock[shop.id]?.[e.item] ?? 0;
                return (
                  <div key={e.item} className={`stock${q === 0 ? " out" : ""}`}>
                    <Icon atlas={A} name={it.icon} scale={2} title={it.name.en} />
                    <b>{nm(it.name, lang)}</b>
                    <small className="mono">฿{inv.buyPrice(shop.id, e.item)} · {q === -1 ? "∞" : `เหลือ ${q}`}</small>
                    <div className="row">
                      <button onClick={() => trade("buy", e.item)}>ซื้อ</button>
                      <button disabled={inv.sellPrice(shop.id, e.item) === null || !inv.has(e.item)} onClick={() => trade("sell", e.item)}>ขาย</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <h4>กระเป๋า · Bag ({inv.state.slots.filter(Boolean).length}/{inv.state.slots.length})</h4>
            <div className="bag">
              {inv.state.slots.map((s, i) => (
                <div key={i} className="slot" title={s ? s.item : ""} onClick={() => s && inv.sellPrice(shop.id, s.item) !== null && trade("sell", s.item)}>
                  {s && <Icon atlas={A} name={db.items.find((x) => x.id === s.item)!.icon} scale={1} />}
                  {s && s.n > 1 && <i>{s.n}</i>}
                </div>
              ))}
            </div>
            <h4>ที่สวมใส่ · Equipped</h4>
            <div className="row">
              {Object.entries(inv.state.equipped).map(([slot, id]) => (
                <span key={slot} className="eq">{slot}: {id ? <Icon atlas={A} name={db.items.find((x) => x.id === id)!.icon} scale={1} /> : "—"}</span>
              ))}
            </div>
          </section>
          <aside className="panel side">
            <h4>shop</h4>
            <table className="tbl">
              <tbody>
                <tr><td>keeper</td><td className="mono">{shop.keeper ?? "—"}</td></tr>
                <tr><td>buyMod / sellMod</td><td className="mono">×{shop.buyMod} / ×{shop.sellMod}</td></tr>
                <tr><td>tagMods</td><td className="mono">{JSON.stringify(shop.tagMods ?? {})}</td></tr>
                <tr><td>buys</td><td className="mono">{(shop.buys ?? ["anything sellable"]).join(", ")}</td></tr>
                <tr><td>halal</td><td>{shop.halal ? "yes — pork / alcohol blocked by check" : "no"}</td></tr>
              </tbody>
            </table>
            <p className="hint">The simulator runs the same rules as the Godot autoload and the Pixi runtime. Edit shops in <code>{docOf("shops", shop.id)}.easyitems.json</code> (or via MCP <code>write_items</code>).</p>
          </aside>
        </main>
      )}

      {tab === "loot" && (
        <main className="layout loot">
          <aside className="panel list">
            {db.loot.map((l) => (
              <button key={l.id} className={`item-btn${l.id === lootId ? " on" : ""}`} onClick={() => setLootId(l.id)}>
                <span><b>{nm(l.name, lang) || l.id}</b><small>{l.id} · rolls {Array.isArray(l.rolls) ? l.rolls.join("–") : l.rolls}</small></span>
              </button>
            ))}
          </aside>
          <section className="panel">
            <div className="toolbar">
              <label>seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
              <button onClick={() => setSeed(Math.floor(Math.random() * 100000))}>🎲</button>
            </div>
            <table className="tbl">
              <tbody>
                {Array.from({ length: 12 }, (_, i) => seed + i).map((s) => (
                  <tr key={s}>
                    <td className="mono">seed {s}</td>
                    <td>{rollLoot(db, lootId, s).map((x) => <span key={x.item} className="drop"><Icon atlas={A} name={db.items.find((i) => i.id === x.item)!.icon} scale={1} />×{x.n}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <aside className="panel side">
            <h4>สูตรทั้งหมด · Recipes</h4>
            {db.recipes.map((r) => (
              <div className="recipe" key={r.id}>
                {r.inputs.map((e) => <span key={e.item}><Icon atlas={A} name={db.items.find((i) => i.id === e.item)?.icon ?? ""} scale={1} />×{e.n}</span>)} →{" "}
                {r.outputs.map((e) => <span key={e.item}><Icon atlas={A} name={db.items.find((i) => i.id === e.item)?.icon ?? ""} scale={1} />×{e.n}</span>)}
                <small>{nm(r.name, lang)} · {r.station ?? ""}</small>
              </div>
            ))}
          </aside>
        </main>
      )}

      {tab === "check" && (
        <main className="layout one">
          <section className="panel">
            {!check ? <p>checking…</p> : (
              <>
                <h2>{check.errors.length ? `✗ ${check.errors.length} errors` : "✓ no errors"} · {check.warnings.length} warnings</h2>
                <div className="diag">{[...check.errors, ...check.warnings].map((d, i) => <p key={i} className={d.severity === "error" ? "err" : "warn"}>{d.path}: {d.message}</p>)}</div>
                <h4>Easy Quest cross-reference</h4>
                <p>{check.quests.files.length} quest files · matched: {check.quests.matched.map((id) => <span key={id} className="drop"><Icon atlas={A} name={db.items.find((i) => i.id === id)?.icon ?? ""} scale={1} />{id}</span>)}</p>
                {check.quests.missing.length > 0 && <p className="warn">missing: {check.quests.missing.join(", ")}</p>}
              </>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
