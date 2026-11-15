// Regenerate previews: labelled icon contact sheets at 24 and 32 px (needs python3 + Pillow).
//   node scripts/render-docs.mjs [out=docs/assets]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = process.argv[2] ?? "docs/assets";
mkdirSync(out, { recursive: true });
const ws = mkdtempSync(path.join(tmpdir(), "easyitems-docs-"));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
try {
  run("npx", ["tsx", "src/cli.ts", "init", "--workspace", ws]);
  for (const size of ["24", "32"]) {
    run("npx", ["tsx", "src/cli.ts", "export", "--preset", "png", "--size", size, "--out", `exports/png${size}`, "--workspace", ws]);
    run("python3", ["scripts/contact-sheet.py", path.join(ws, "exports", `png${size}`), path.join(out, size === "24" ? "contact-sheet.png" : "contact-sheet-32.png"), size === "24" ? "3" : "2"]);
  }
} finally {
  rmSync(ws, { recursive: true, force: true });
}
