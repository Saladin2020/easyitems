import { ICON_NAMES, iconPixels, type Pixels } from "../shared/icons.js";
import type { Item } from "../shared/types.js";
import { encodePng } from "./png.js";

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Atlas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  frames: Record<string, AtlasFrame>;
  size: number;
}

/** Icons packed in rows of 8 (1px gap), keyed by icon name, in the given order. */
export function packIcons(names: string[], size: number, cols = 8): Atlas {
  const uniq = [...new Set(names)];
  const gap = 1;
  const rows = Math.max(1, Math.ceil(uniq.length / cols));
  const width = cols * (size + gap) - gap;
  const height = rows * (size + gap) - gap;
  const data = new Uint8ClampedArray(width * height * 4);
  const frames: Record<string, AtlasFrame> = {};
  uniq.forEach((n, i) => {
    const p = iconPixels(n, size);
    const x = (i % cols) * (size + gap);
    const y = Math.floor(i / cols) * (size + gap);
    blit(data, width, p, x, y, 1);
    frames[n] = { x, y, w: size, h: size };
  });
  return { width, height, data, frames, size };
}

export function blit(dst: Uint8ClampedArray, dw: number, p: Pixels, ox: number, oy: number, scale: number) {
  for (let y = 0; y < p.height * scale; y++)
    for (let x = 0; x < p.width * scale; x++) {
      const s = (Math.floor(y / scale) * p.width + Math.floor(x / scale)) * 4;
      if (!p.data[s + 3]) continue;
      dst.set(p.data.subarray(s, s + 4), ((oy + y) * dw + ox + x) * 4);
    }
}

export function scalePixels(p: Pixels, scale: number): Pixels {
  const out = { width: p.width * scale, height: p.height * scale, data: new Uint8ClampedArray(p.width * scale * p.height * scale * 4) };
  blit(out.data, out.width, p, 0, 0, scale);
  return out;
}

export function iconPng(name: string, size = 24, scale = 1): Buffer {
  const p = scalePixels(iconPixels(name, size), scale);
  return encodePng(p.width, p.height, p.data);
}

/** Item icons on a teak tile grid (CLI `render`, MCP `render_icons`). */
export function itemSheetPng(items: Array<Pick<Item, "icon">> | string[], opts: { size?: number; scale?: number; cols?: number } = {}): { png: Buffer; width: number; height: number; count: number } {
  const size = opts.size ?? 24;
  const scale = opts.scale ?? 2;
  const names = items.map((i) => (typeof i === "string" ? i : i.icon));
  const cols = Math.min(opts.cols ?? 10, Math.max(1, names.length));
  const cell = size * scale + 4 * scale;
  const rows = Math.max(1, Math.ceil(names.length / cols));
  const width = cols * cell;
  const height = rows * cell;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inner = x % cell >= scale && x % cell < cell - scale && y % cell >= scale && y % cell < cell - scale;
      data.set(inner ? [58, 40, 25, 255] : [30, 21, 14, 255], (y * width + x) * 4);
    }
  names.forEach((n, i) => blit(data, width, iconPixels(n, size), (i % cols) * cell + 2 * scale, Math.floor(i / cols) * cell + 2 * scale, scale));
  return { png: encodePng(width, height, data), width, height, count: names.length };
}

export const ALL_ICONS = ICON_NAMES;
