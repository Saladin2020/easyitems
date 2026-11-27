#!/usr/bin/env node
/**
 * Easy Items MCP server (stdio by default; optional Streamable HTTP).
 *
 *   npx tsx src/mcp/server.ts
 *   npx tsx src/mcp/server.ts --http --port 8879
 *
 * Env: EASYITEMS_WORKSPACE  absolute path to the workspace (default: cwd)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { z } from "zod";
import { checkRequest, resolveToken } from "../shared/requestGuard.js";
import { itemSummary } from "../shared/db.js";
import { Inventory, rollLoot, runScript } from "../shared/engine.js";
import { levelFor, runSkillsScript, xpForLevel } from "../shared/skills.js";
import { ICON_NAMES } from "../shared/icons.js";
import { CATEGORIES, EFFECT_KINDS, FORMAT } from "../shared/types.js";
import { EXPORT_PRESETS, exportItems } from "../lib/export.js";
import { itemSheetPng } from "../lib/render.js";
import { checkWorkspace, dirs, loadDb, loadDbStrict, readDoc, resolveWorkspace, saveDoc, workspaceSummary } from "../lib/workspace.js";

export const MCP_TOOL_NAMES = ["workspace_info", "list_items", "get_item", "write_items", "check_items", "render_icons", "roll_loot", "simulate", "life_skills", "export_items"] as const;

const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "Use a-z, 0-9, _ or -");
const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const err = (message: string) => ({ isError: true as const, content: [{ type: "text" as const, text: message }] });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const FORMAT_CHEATSHEET = `Document items/<id>.easyitems.json: { format "${FORMAT}", id?, name? {th,en}, rules?, items?, shops?, loot?, recipes? } — all workspace documents merge into one database (ids unique across files).
  item:   { id, name {th, en, ms?}, desc? {th,en}, category ${CATEGORIES.join("|")}, price (coins, int), stack (1..999), icon (built-in name),
            effects? [{ kind ${EFFECT_KINDS.join("|")}, amount, stat?, duration? }], equip? { slot, stats? {name: n} }, consumable?, sellable?, rarity?, tags? }
  shop:   { id, name, keeper? (cast id), buyMod (×price when buying), sellMod (0..1 of price when selling; 0 = no buying), tagMods? {tag: ×}, buys? [categories], halal?, stock [{ item, qty (-1 = ∞), price?, restock? days }] }
  loot:   { id, rolls n | [min,max], entries [{ item? (omit = nothing), weight, min?, max? }], guaranteed? [{ item, n }] }
  recipe: { id, name, station?, inputs [{item,n}], outputs [{item,n}], time? }
  rules:  { slots, currency, startingCoins, startingItems?, equipSlots, iconSize 24|32 }
Prices: buy = stock.price ?? round(price × buyMod × tagMods); sell = floor(price × sellMod).
Content rules: halal shops may not stock pork / alcohol / halal:false items (checked); no Quran, Arabic calligraphy or sacred figures as items; keep the catalog multicultural (Thai village + Muslim community side by side).`;

function parseArgs(argv: string[]) {
  const out = { http: false, port: 8879, host: "127.0.0.1", workspace: process.env.EASYITEMS_WORKSPACE ?? process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--http") out.http = true;
    else if (a === "--port") out.port = Number(argv[++i] ?? out.port);
    else if (a === "--host") out.host = argv[++i] ?? out.host;
    else if (a === "--workspace") out.workspace = argv[++i] ?? out.workspace;
  }
  return out;
}

export function createEasyItemsMcp(workspaceRoot: string): McpServer {
  const root = resolveWorkspace(workspaceRoot);
  const server = new McpServer({ name: "easyitems", version: "0.1.0" });

  server.registerTool(
    "workspace_info",
    { title: "Workspace info", description: "Summarize the Easy Items workspace: documents, rules, items, shops, loot tables, recipes, icon names and the document format. Call this first.", inputSchema: {} },
    async () => {
      const s = await workspaceSummary(root);
      return text({ name: "easyitems", ...s, iconNames: ICON_NAMES, format: FORMAT_CHEATSHEET });
    },
  );

  server.registerTool(
    "list_items",
    { title: "List items", description: "Items with names (th/en/ms), category, price, stack, icon and equip slot; filter by category or tag.", inputSchema: { category: z.enum(CATEGORIES).optional(), tag: z.string().optional() } },
    async ({ category, tag }) => {
      const { db } = await loadDb(root);
      return text({ items: db.items.filter((i) => (!category || i.category === category) && (!tag || i.tags?.includes(tag))).map(itemSummary) });
    },
  );

  server.registerTool(
    "get_item",
    { title: "Get item", description: "One item in full, plus the shops that sell it (with buy/sell prices) and the recipes that use or make it.", inputSchema: { id: IdSchema } },
    async ({ id }) => {
      const { db } = await loadDb(root);
      const it = db.items.find((i) => i.id === id);
      if (!it) return err(`Item "${id}" not found`);
      const inv = new Inventory(db);
      return text({ ...it, source: db.sources[`items:${id}`], shops: db.shops.filter((s) => s.stock.some((e) => e.item === id)).map((s) => ({ shop: s.id, buy: inv.buyPrice(s.id, id), sell: inv.sellPrice(s.id, id) })), recipes: db.recipes.filter((r) => [...r.inputs, ...r.outputs].some((e) => e.item === id)).map((r) => r.id) });
    },
  );

  server.registerTool(
    "write_items",
    {
      title: "Write items document",
      description: `Create or replace items/<id>.easyitems.json (whole document). Validates against the merged workspace first: refuses on errors (path + message). dryRun only validates. Read the current file with mode "read".\n${FORMAT_CHEATSHEET}`,
      inputSchema: { id: IdSchema, doc: z.record(z.string(), z.unknown()).optional(), mode: z.enum(["write", "read"]).optional(), dryRun: z.boolean().optional() },
    },
    async ({ id, doc, mode, dryRun }) => {
      try {
        if (mode === "read") return text({ id, doc: (await readDoc(root, id)) ?? null });
        if (!doc) return err("doc is required for mode write");
        const res = await saveDoc(root, id, doc, { dryRun });
        return text({ saved: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "check_items",
    { title: "Check items", description: "Validate the merged database (references, prices, stacks, equip slots, halal-shop and content rules) and cross-check item ids used by Easy Quest .ezq files in the workspace (plus extra paths).", inputSchema: { quests: z.array(z.string()).optional() } },
    async ({ quests }) => {
      try {
        const r = await checkWorkspace(root, quests ?? []);
        return text({ ok: !r.errors.length, errors: r.errors, warnings: r.warnings, quests: { files: r.quests.files, matched: r.quests.matched, missing: r.quests.missing } });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "render_icons",
    { title: "Render icons", description: "Icon sheet of items (default all, or ids) to exports/renders/icons.png, returned as an image so you can look at it.", inputSchema: { ids: z.array(IdSchema).optional(), size: z.union([z.literal(24), z.literal(32)]).optional(), scale: z.number().int().min(1).max(6).optional() } },
    async ({ ids, size, scale }) => {
      try {
        const { db } = await loadDb(root);
        const pick = ids?.length ? ids.map((id) => db.items.find((i) => i.id === id) ?? (() => { throw new Error(`Item "${id}" not found`); })()) : db.items;
        const r = itemSheetPng(pick, { size: size ?? db.rules.iconSize, scale: scale ?? 2 });
        const out = path.join(dirs(root).exports, "renders", "icons.png");
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, r.png);
        return { content: [{ type: "text" as const, text: JSON.stringify({ file: out, count: r.count, width: r.width, height: r.height, order: pick.map((i) => i.id) }, null, 2) }, { type: "image" as const, data: r.png.toString("base64"), mimeType: "image/png" }] };
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "roll_loot",
    { title: "Roll loot", description: "Roll a loot table with seeds seed..seed+times-1 (deterministic; the Godot and Pixi runtimes give the same drops).", inputSchema: { table: IdSchema, seed: z.number().int().min(0).optional(), times: z.number().int().min(1).max(100).optional() } },
    async ({ table, seed, times }) => {
      try {
        const db = await loadDbStrict(root);
        const s = seed ?? 1;
        return text({ table, rolls: Array.from({ length: times ?? 1 }, (_, i) => ({ seed: s + i, items: rollLoot(db, table, s + i) })) });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "life_skills",
    {
      title: "Life skills",
      description:
        'Farming / fishing / cooking skills with XP and levels. Without ops: lists skills (XP per level), crops, fishing spots and skill recipes. With ops, replays them on a fresh inventory plus `start` items: ["plant", plot, crop, day, season?], ["water", plot, day], ["newday", day, rained], ["harvest", plot, seed], ["fish", spot, seed, weatherMult], ["cook", recipe], ["xp", skill, n]. Weather comes from Easy NPC (rain/storm water plots; WEATHER_INFO.fishing is the bite multiplier).',
      inputSchema: {
        ops: z.array(z.array(z.union([z.string(), z.number(), z.boolean()])).min(1)).max(500).optional(),
        start: z.array(z.tuple([z.string(), z.number().int().min(1)])).max(50).optional(),
      },
    },
    async ({ ops, start }) => {
      try {
        const db = await loadDbStrict(root);
        if (ops?.length) return text(runSkillsScript(db, ops as Array<[string, ...Array<string | number | boolean>]>, start ?? []));
        return text({
          skills: db.skills.map((s) => ({ ...s, xpTable: Array.from({ length: (s.maxLevel ?? 10) - 1 }, (_, i) => xpForLevel(s, i + 2)), levelAt100: levelFor(s, 100) })),
          crops: db.crops,
          fishing: db.fishing,
          recipes: db.recipes.filter((r) => r.skill).map((r) => ({ id: r.id, skill: r.skill, level: r.level ?? 1, xp: r.xp ?? 5, inputs: r.inputs, outputs: r.outputs })),
        });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "simulate",
    {
      title: "Simulate inventory",
      description: 'Replay operations on a fresh inventory to test balance: ["buy", shop, item, n], ["sell", shop, item, n], ["craft", recipe, times], ["equip", item], ["unequip", slot], ["use", item], ["loot", table, seed], ["coins", delta], ["day", n], ["compact"]. Returns each result ("ok" or a reason such as not_enough_coins), final coins, bag, equipment and stats.',
      inputSchema: { ops: z.array(z.array(z.union([z.string(), z.number()])).min(1)).min(1).max(500) },
    },
    async ({ ops }) => {
      try {
        const db = await loadDbStrict(root);
        const r = runScript(db, ops as Array<[string, ...Array<string | number>]>);
        return text({ results: r.results, coins: r.state.coins, bag: r.state.slots.filter(Boolean), equipped: r.state.equipped, stats: r.stats, day: r.state.day });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "export_items",
    { title: "Export items", description: "Export: godot (Godot 4.3+ project: EasyItem/EasyShop .tres resources with icon AtlasTextures, Items autoload, shop_ui.tscn, theme, test_items.gd), pixi (easyitems.json + icon atlas + easyitems-core.js / easyitems-pixi.js + shop demo), png (icon atlas + one PNG per item), json (merged db), or all.", inputSchema: { preset: z.enum(EXPORT_PRESETS).optional(), out: z.string().optional().describe("Workspace-relative output folder (single preset)"), size: z.union([z.literal(24), z.literal(32)]).optional() } },
    async ({ preset, out, size }) => {
      try {
        const res = await exportItems(root, { preset, out, iconSize: size });
        return text({ dirs: res.dirs, items: res.items, shops: res.shops, files: res.files.length });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  return server;
}

async function startMcp(opts: ReturnType<typeof parseArgs>) {
  const workspace = resolveWorkspace(opts.workspace);
  if (opts.http) return startHttp(workspace, opts.host, opts.port);
  await createEasyItemsMcp(workspace).connect(new StdioServerTransport());
}

async function startHttp(workspace: string, host: string, port: number) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
  const token = resolveToken(host);
  if (token) console.error(`Non-loopback host: send "Authorization: Bearer <token>" — token printed once: ${token}`);
  const httpServer = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    const denied = checkRequest({ bindHost: host, token }, { method: req.method ?? "GET", host: req.headers.host, origin: req.headers.origin, token: auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-easyitems-token"] as string | undefined) });
    if (denied) {
      res.writeHead(denied.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: denied.error }));
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "easyitems", transport: "streamable-http", endpoint: `http://${host}:${port}/mcp`, workspace }));
      return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (req.method === "POST") {
        let transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          const mcp = createEasyItemsMcp(workspace);
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id: string) => void sessions.set(id, transport!) });
          transport.onclose = () => {
            const id = transport!.sessionId;
            if (id) sessions.delete(id);
          };
          await mcp.connect(transport);
        }
        await transport.handleRequest(req, res);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing mcp-session-id" }));
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg(e) }));
      }
    }
  });
  httpServer.listen(port, host, () => {
    console.error(`Easy Items MCP (HTTP) http://${host}:${port}/mcp`);
    console.error(`Workspace ${workspace}`);
  });
}

function entryIndex(): number {
  return process.argv.findIndex((arg) => /(?:^|[/\\])mcp[/\\]server\.(?:ts|js|mjs)$/i.test(arg));
}

if (entryIndex() >= 0) {
  await startMcp(parseArgs(process.argv.slice(entryIndex() + 1)));
}
