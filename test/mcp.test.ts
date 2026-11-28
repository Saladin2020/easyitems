import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { access } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, createEasyItemsMcp } from "../src/mcp/server.js";
import { createApp } from "../src/server/app.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let client: Client;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  const server = createEasyItemsMcp(root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await cleanup();
});

const body = (res: unknown) => JSON.parse(((res as { content: Array<{ text: string }> }).content[0]!).text);

describe("MCP server", () => {
  it("lists the tools", async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  it("info → write (refused, then saved) → check → render → loot → simulate → export", async () => {
    const info = body(await client.callTool({ name: "workspace_info", arguments: {} }));
    expect(info.items.length).toBeGreaterThanOrEqual(40);
    expect(info.format).toMatch(/Content rules/);

    const bad = body(await client.callTool({ name: "write_items", arguments: { id: "game", doc: { format: "easyitems/1", items: [{ id: "x", name: { th: "เอ็กซ์", en: "X" }, category: "food", price: 5, stack: 0, icon: "mango" }] } } }));
    expect(bad.saved).toBe(false);
    expect(bad.errors[0].path).toBe("game.easyitems.json:items[0].stack");

    const good = body(await client.callTool({ name: "write_items", arguments: { id: "game", doc: { format: "easyitems/1", items: [{ id: "khanom_krok", name: { th: "ขนมครก", en: "Coconut pancakes", ms: "Kuih cara" }, category: "food", price: 15, stack: 10, icon: "roti", effects: [{ kind: "heal", amount: 10 }] }], shops: [{ id: "night_market", name: { th: "ตลาดนัดกลางคืน", en: "Night market" }, buyMod: 1, sellMod: 0.4, stock: [{ item: "khanom_krok", qty: 8 }, { item: "thai_tea", qty: -1 }] }] } } }));
    expect(good.saved).toBe(true);

    const got = body(await client.callTool({ name: "get_item", arguments: { id: "khanom_krok" } }));
    expect(got.shops).toEqual([{ shop: "night_market", buy: 15, sell: 6 }]);

    const check = body(await client.callTool({ name: "check_items", arguments: {} }));
    expect(check.ok).toBe(true);
    expect(check.quests.missing).toEqual([]);

    const r = await client.callTool({ name: "render_icons", arguments: { ids: ["khanom_krok", "kurma"], scale: 1 } });
    const content = r.content as Array<{ type: string; mimeType?: string; text?: string }>;
    expect(content.some((c) => c.type === "image" && c.mimeType === "image/png")).toBe(true);
    await access(JSON.parse(content[0]!.text!).file);

    const loot = body(await client.callTool({ name: "roll_loot", arguments: { table: "raya_visit", seed: 5, times: 3 } }));
    expect(loot.rolls.length).toBe(3);

    const sim = body(await client.callTool({ name: "simulate", arguments: { ops: [["buy", "night_market", "khanom_krok", 2], ["use", "khanom_krok"], ["buy", "general_store", "bicycle", 1]] } }));
    expect(sim.results).toEqual(["ok", "ok", "not_sold_here"]);
    expect(sim.coins).toBe(30);

    const exp = body(await client.callTool({ name: "export_items", arguments: { preset: "godot" } }));
    for (const d of exp.dirs) await access(d);
    const escape = await client.callTool({ name: "export_items", arguments: { preset: "json", out: "../../outside" } });
    expect((escape as { isError?: boolean }).isError).toBe(true);
  }, 60_000);
});

describe("HTTP API", () => {
  it("serves the db, icons and saves; blocks cross-origin writes and rebinding", async () => {
    const app = createApp({ workspaceRoot: root, webRoot: "/nonexistent" });
    const h = { host: "127.0.0.1:8878" };
    expect((await app.request("/api/health", { headers: h })).status).toBe(200);
    const ws = (await (await app.request("/api/workspace", { headers: h })).json()) as { iconNames: unknown[]; atlas: { frames: Record<string, unknown> } };
    expect(ws.iconNames.length).toBe(67);
    expect((await app.request("/api/atlas.png", { headers: h })).headers.get("content-type")).toBe("image/png");
    expect((await app.request("/api/icon/ketupat.png?scale=4", { headers: h })).status).toBe(200);
    const db = (await (await app.request("/api/db", { headers: h })).json()) as { db: { items: unknown[] }; errors: unknown[] };
    expect(db.errors).toEqual([]);
    const loot = await app.request("/api/loot", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ table: "delivery_tip", seed: 3, times: 2 }) });
    expect(((await loot.json()) as { rolls: unknown[] }).rolls.length).toBe(2);
    const dry = await app.request("/api/docs/village", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ doc: { format: "easyitems/1", items: [] }, dryRun: true }) });
    expect(((await dry.json()) as { ok: boolean; errors: unknown[] }).errors.length).toBeGreaterThan(0); // removing village breaks references
    expect((await app.request("/api/docs/..%2F..%2Fetc", { headers: h })).status).toBe(404);
    const cross = await app.request("/api/docs/x", { method: "POST", headers: { ...h, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(cross.status).toBe(403);
    expect((await app.request("/api/db", { headers: { host: "evil.example:8878" } })).status).toBe(403);
  });
});
