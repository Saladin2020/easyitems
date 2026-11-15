/**
 * Optional Godot check: GODOT=/path/to/godot npx vitest run test/godot.test.ts
 * Exports the Godot project, imports it headless, then test_items.gd loads every EasyItem / EasyShop resource
 * (icon AtlasTextures included), replays the parity script against the TypeScript engine's expected state, and
 * builds the shop UI. The demo scene must run without script errors.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportItems } from "../src/lib/export.js";
import { loadDbStrict } from "../src/lib/workspace.js";
import { tempWorkspace } from "./helpers.js";

const GODOT = process.env.GODOT;
let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  if (GODOT) ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup?.());

describe.skipIf(!GODOT)("Godot export", () => {
  it("resources load, the runtime matches the TS engine, the shop UI builds", async () => {
    const out = path.join(root, "exports", "godot");
    await exportItems(root, { preset: "godot", out });
    const db = await loadDbStrict(root);
    for (let i = 0; i < 2; i++) spawnSync(GODOT!, ["--headless", "--editor", "--quit", "--path", out], { encoding: "utf8", timeout: 180_000 });
    const run = spawnSync(GODOT!, ["--headless", "--path", out, "--script", "res://test_items.gd"], { encoding: "utf8", timeout: 120_000 });
    expect(run.stdout).not.toMatch(/^FAIL/m);
    expect(run.stdout).toMatch(/^OK$/m);
    expect(run.stdout).toMatch(new RegExp(`^R\\| items=${db.items.length} resources_ok=${db.items.length}$`, "m"));
    expect(run.stdout).toMatch(/^P\| parity ok steps=\d+/m);
    expect(run.stdout).toMatch(/^S\| save round trip ok$/m);
    expect(run.stdout).toMatch(/^U\| shop_ui \w+ tiles=\d+$/m);
    const main = spawnSync(GODOT!, ["--headless", "--path", out, "--quit-after", "60"], { encoding: "utf8", timeout: 120_000 });
    expect(main.stderr + main.stdout).not.toMatch(/SCRIPT ERROR|Parse Error/);
  }, 600_000);
});
