#!/usr/bin/env node
/**
 * Studio CLI wrapper around Easy Items (list / shops / check / render / loot / export without MCP).
 *
 * Usage:
 *   node /workspace/indie-studio/tools/easyitems-cli.mjs <command> [options]
 *
 * Install:  EASYITEMS_HOME, else this folder's easyitems/
 * The starter catalog lives in the install (init copies it). Game catalogs and exports may be written under
 * /workspace/indie-studio/projects/<Name> (pre-allowed).
 * export --out (single preset) writes into that folder without deleting stale files; use a dedicated folder.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.resolve(process.env.EASYITEMS_HOME?.trim() || path.join(here, "easyitems"));
const STUDIO_PROJECTS = path.resolve(here, "..", "projects");
const cli = path.join(HOME, "dist", "cli.js");

if (!existsSync(cli)) {
  console.error(`Easy Items CLI not found at ${cli}. Set EASYITEMS_HOME and run npm ci && npm run build there.`);
  process.exit(1);
}

const env = {
  ...process.env,
  EASYITEMS_HOME: HOME,
  EASYITEMS_WORKSPACE: process.env.EASYITEMS_WORKSPACE?.trim() || HOME,
};
const allowed = new Set(
  (env.EASYITEMS_ALLOWED_DIRS ?? "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean),
);
allowed.add(STUDIO_PROJECTS);
env.EASYITEMS_ALLOWED_DIRS = [...allowed].join(path.delimiter);

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: HOME,
  stdio: "inherit",
  env,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
