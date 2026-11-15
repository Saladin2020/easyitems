/**
 * Bake favicon / PWA icons: the Easy Items pouch (16×16, same art as the suite logo) on a teak tile.
 * Usage: npx tsx scripts/write-icons.mts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/lib/png.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "web", "public");

const PAL: Record<string, [number, number, number, number]> = {
  ".": [0, 0, 0, 0],
  s: [46, 32, 20, 255],
  k: [13, 9, 6, 255],
  a: [156, 197, 74, 255],
  l: [210, 236, 150, 255],
  d: [97, 122, 46, 255],
  c: [255, 210, 122, 255],
  y: [185, 116, 31, 255],
};
/** Same pouch as the brand logo (easy-suite-brand/items_v2.py), framed. */
export const ART = [
  "kkkkkkkkkkkkkkkk",
  "kssssksskssssssk",
  "ksssskcskcsssssk",
  "ksssssdkdssssssk",
  "kssssskddksssssk",
  "kssskaalaakssssk",
  "ksskaallaaakkssk",
  "ksskallaaakcckkk",
  "kskaalaaaakccyck",
  "kskaaaaaakcycyck",
  "kskaaaaaakccycck",
  "kskdaaaaaakccckk",
  "ksskddaadddkkksk",
  "ksssskkkkkkssssk",
  "kssssssssssssssk",
  "kkkkkkkkkkkkkkkk",
];

function render(size: number): Buffer {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) px.set(PAL[ART[Math.floor((y * 16) / size)]![Math.floor((x * 16) / size)]!] ?? PAL["."]!, (y * size + x) * 4);
  return encodePng(size, size, px);
}

if (ART.some((r) => r.length !== 16)) throw new Error(`icon rows must be 16 wide: ${ART.map((r) => r.length).join(",")}`);
await mkdir(outDir, { recursive: true });
await mkdir(path.join(root, "docs", "assets"), { recursive: true });
for (const [name, size] of [["favicon-32.png", 32], ["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]] as const) await writeFile(path.join(outDir, name), render(size));
await writeFile(path.join(root, "docs", "assets", "icon-512.png"), render(512));
const rects: string[] = [];
ART.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="rgba(${PAL[ch]!.slice(0, 3).join(",")},${PAL[ch]![3] / 255})"/>`)));
await writeFile(path.join(outDir, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join("")}</svg>\n`);
await writeFile(path.join(outDir, "site.webmanifest"), `${JSON.stringify({ name: "Easy Items", short_name: "Easy Items", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }], theme_color: "#f4ae3d", background_color: "#140e0a", display: "standalone" }, null, 2)}\n`);
console.log("icons written");
