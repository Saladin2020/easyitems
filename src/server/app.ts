import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { DEV_UI_ORIGINS, checkRequest } from "../shared/requestGuard.js";
import { rollLoot } from "../shared/engine.js";
import { ICONS, ICON_NAMES } from "../shared/icons.js";
import { CATEGORIES, EFFECT_KINDS, RARITIES } from "../shared/types.js";
import { exportItems, type ExportPreset } from "../lib/export.js";
import { encodePng } from "../lib/png.js";
import { iconPng, packIcons } from "../lib/render.js";
import { assertSafeId, checkWorkspace, listDocs, loadDb, readDoc, saveDoc, workspaceSummary } from "../lib/workspace.js";

export interface CreateAppOptions {
  workspaceRoot: string;
  webRoot?: string;
  dev?: boolean;
  host?: string;
  token?: string;
}

const TOKEN_COOKIE = "easyitems_token";
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));
const bytes = (buf: Buffer) => new Uint8Array(buf);

function tokenPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Easy Items</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy Items token required</h1>
<p>Paste the token printed in the terminal that started Easy Items.</p>
<form method="get"><input name="token" autocomplete="off" style="width:22rem"> <button>Open</button></form>
</body>`;
}

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const { workspaceRoot: root, webRoot, dev, host = "127.0.0.1", token } = options;
  const guard = { bindHost: host, token, extraOrigins: dev ? DEV_UI_ORIGINS : [] };

  app.use("*", async (c, next) => {
    const queryToken = c.req.query("token");
    const provided = c.req.header("x-easyitems-token") ?? queryToken ?? getCookie(c, TOKEN_COOKIE);
    const denied = checkRequest(guard, { method: c.req.method, host: c.req.header("host"), origin: c.req.header("origin"), token: provided });
    if (denied) {
      if (denied.status === 401 && c.req.method === "GET" && !c.req.path.startsWith("/api/")) return c.html(tokenPage(), 401);
      return c.json({ error: denied.error }, denied.status);
    }
    if (token && queryToken) setCookie(c, TOKEN_COOKIE, queryToken, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, workspaceRoot: root }));
  app.get("/api/workspace", async (c) => {
    const a = packIcons(ICON_NAMES, 24);
    return c.json({ ...(await workspaceSummary(root)), categories: CATEGORIES, effectKinds: EFFECT_KINDS, rarities: RARITIES, iconNames: ICON_NAMES.map((n) => ({ name: n, th: ICONS[n]!.th, en: ICONS[n]!.en })), atlas: { image: "/api/atlas.png", size: 24, width: a.width, height: a.height, frames: a.frames } });
  });
  /** Every built-in icon in one atlas (rects in /api/workspace). */
  app.get("/api/atlas.png", (c) => {
    const size = c.req.query("size") === "32" ? 32 : 24;
    const a = packIcons(ICON_NAMES, size);
    return c.body(bytes(encodePng(a.width, a.height, a.data)), 200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
  });
  app.get("/api/icon/:name", (c) => {
    const name = c.req.param("name").replace(/\.png$/, "");
    if (!(name in ICONS)) return c.json({ error: `Unknown icon ${name}` }, 404);
    const scale = Math.max(1, Math.min(16, Number(c.req.query("scale") ?? 1) || 1));
    return c.body(bytes(iconPng(name, c.req.query("size") === "32" ? 32 : 24, scale)), 200, { "Content-Type": "image/png" });
  });
  app.get("/api/db", async (c) => c.json(await loadDb(root)));
  app.get("/api/check", async (c) => {
    const r = await checkWorkspace(root);
    return c.json({ errors: r.errors, warnings: r.warnings, quests: r.quests });
  });
  app.get("/api/docs", async (c) => c.json({ docs: (await listDocs(root)).map((d) => ({ id: d.id, parseError: d.parseError ?? null })) }));
  app.get("/api/docs/:id", async (c) => {
    try {
      const id = assertSafeId(c.req.param("id"), "document id");
      const doc = await readDoc(root, id);
      if (!doc) return c.json({ error: `No document ${id}` }, 404);
      return c.json({ id, doc });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });
  app.post("/api/docs/:id", async (c) => {
    try {
      const body = (await c.req.json()) as { doc: unknown; dryRun?: boolean };
      const res = await saveDoc(root, c.req.param("id"), body.doc, { dryRun: body.dryRun });
      return c.json({ ok: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  app.post("/api/loot", async (c) => {
    try {
      const body = (await c.req.json()) as { table: string; seed?: number; times?: number };
      const { db } = await loadDb(root);
      const seed = Math.floor(body.seed ?? 1);
      return c.json({ rolls: Array.from({ length: Math.max(1, Math.min(100, body.times ?? 1)) }, (_, i) => ({ seed: seed + i, items: rollLoot(db, body.table, seed + i) })) });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
  app.post("/api/export", async (c) => {
    try {
      const body = (await c.req.json()) as { preset?: ExportPreset; out?: string };
      const res = await exportItems(root, { preset: body.preset, out: body.out });
      return c.json({ ok: true, ...res, files: res.files.length });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  if (!dev && webRoot) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", async (c) => {
      try {
        return c.html((await readFile(path.join(webRoot, "index.html"))).toString("utf8"));
      } catch {
        return c.text("Web UI not built yet. Run npm run build:web or start with --dev.", 503);
      }
    });
  } else if (dev) {
    app.get("/", (c) =>
      c.html(`<!doctype html><meta charset="utf-8"><title>Easy Items (dev)</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy Items API is running</h1><p>Workspace: <code>${root}</code></p>
<p>Open the Vite UI at <a href="http://127.0.0.1:5185" style="color:#f0c36a">http://127.0.0.1:5185</a></p></body>`),
    );
  }
  return app;
}

export function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[1]!;
}
