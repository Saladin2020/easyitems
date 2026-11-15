import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, iconPixels } from "../src/shared/icons.js";
import { decodePng } from "../src/lib/png.js";
import { itemSheetPng, packIcons } from "../src/lib/render.js";
import { fnv1a } from "./helpers.js";

describe("procedural icons", () => {
  it("draws 44 icons at 24 and 32 px, each outlined and centred enough", () => {
    expect(ICON_NAMES.length).toBe(44);
    for (const size of [24, 32]) {
      for (const n of ICON_NAMES) {
        const p = iconPixels(n, size);
        expect(p.width).toBe(size);
        let opaque = 0;
        let outline = 0;
        for (let i = 0; i < p.data.length; i += 4) {
          if (p.data[i + 3]) opaque++;
          if (p.data[i] === 0x1a && p.data[i + 1] === 0x10 && p.data[i + 2] === 0x08) outline++;
        }
        expect(opaque / (size * size), `${n}@${size}`).toBeGreaterThan(0.15);
        expect(outline, n).toBeGreaterThan(size);
      }
    }
  });

  it("is deterministic (golden pixel hashes; UPDATE_GOLDEN=1 after a deliberate change)", () => {
    const now = Object.fromEntries(ICON_NAMES.map((n) => [n, `${fnv1a(iconPixels(n, 24).data)}/${fnv1a(iconPixels(n, 32).data)}`]));
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden.json");
    if (process.env.UPDATE_GOLDEN || !existsSync(file)) writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    expect(now).toEqual(JSON.parse(readFileSync(file, "utf8")));
    expect(new Set(Object.values(now)).size).toBe(44);
  });

  it("packs an atlas and a sheet", () => {
    const a = packIcons(["mango", "coin", "mango"], 24);
    expect(Object.keys(a.frames)).toEqual(["mango", "coin"]);
    expect(a.frames.coin).toEqual({ x: 25, y: 0, w: 24, h: 24 });
    const s = itemSheetPng(ICON_NAMES, { size: 32, scale: 2, cols: 11 });
    const d = decodePng(s.png);
    expect([d.width, d.height]).toEqual([11 * 72, 4 * 72]);
  });
});
