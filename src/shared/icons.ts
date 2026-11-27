/**
 * 44 procedural item icons (CC0), drawn on a 24-unit grid in the Easy Suite palette and baked at 24 or 32 px.
 * Same recipe as Easy UI's 16px icons: a few flat shapes, then automatic light-top / dark-bottom shading and a
 * 1px dark outline, so hand-written shapes stay consistent. No script, scripture or sacred figures in any icon.
 */

export type RGBA = [number, number, number, number];
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function hx(hex: string, a = 255): RGBA {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

const OUTLINE = hx("#1a1008");
const U = 24;

class Ico {
  readonly S: number;
  readonly k: number;
  p: Pixels;
  keep = new Set<number>();
  constructor(size: number) {
    this.S = size;
    this.k = size / U;
    this.p = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  }
  private put(x: number, y: number, c: string, keep: boolean) {
    const S = this.S;
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    this.p.data.set(c === "clear" ? [0, 0, 0, 0] : hx(c), (y * S + x) * 4);
    if (keep) this.keep.add(y * S + x);
    else this.keep.delete(y * S + x);
  }
  /** One grid unit (k×k target pixels at 32 px). */
  px(x: number, y: number, c: string, keep = false) {
    this.rect(Math.round(x), Math.round(y), 1, 1, c, keep);
  }
  rect(x: number, y: number, w: number, h: number, c: string, keep = false) {
    const k = this.k;
    const x0 = Math.round(x * k);
    const y0 = Math.round(y * k);
    const x1 = Math.max(x0 + 1, Math.round((x + w) * k));
    const y1 = Math.max(y0 + 1, Math.round((y + h) * k));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.put(xx, yy, c, keep);
  }
  /** Fill every target pixel whose centre (in grid units) passes `inside`. */
  fill(inside: (X: number, Y: number) => boolean, c: string, keep = false) {
    for (let y = 0; y < this.S; y++)
      for (let x = 0; x < this.S; x++) {
        const X = (x + 0.5) / this.k;
        const Y = (y + 0.5) / this.k;
        if (inside(X, Y)) this.put(x, y, c, keep);
      }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string, keep = false) {
    this.fill((X, Y) => ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 <= 1, c, keep);
  }
  circle(cx: number, cy: number, r: number, c: string, keep = false) {
    this.ellipse(cx, cy, r, r, c, keep);
  }
  ring(cx: number, cy: number, r: number, w: number, c: string) {
    this.fill((X, Y) => {
      const d = Math.hypot(X - cx, Y - cy);
      return d <= r && d >= r - w;
    }, c);
  }
  poly(pts: Array<[number, number]>, c: string, keep = false) {
    this.fill((X, Y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]!;
        const [xj, yj] = pts[j]!;
        if (yi > Y !== yj > Y && X < ((xj - xi) * (Y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }, c, keep);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string, keep = false) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, keep);
  }
  /** Shade + outline (same rule as Easy UI). */
  done(): Pixels {
    const S = this.S;
    const d = this.p.data;
    const src = new Uint8ClampedArray(d);
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : src[(y * S + x) * 4 + 3]!);
    const same = (x: number, y: number, x2: number, y2: number) => {
      if (a(x2, y2) === 0) return false;
      const i = (y * S + x) * 4;
      const j = (y2 * S + x2) * 4;
      return src[i] === src[j] && src[i + 1] === src[j + 1] && src[i + 2] === src[j + 2];
    };
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        if (!src[i + 3] || this.keep.has(y * S + x)) continue;
        const k = !same(x, y, x, y - 1) && !same(x, y, x - 1, y) ? 1.22 : !same(x, y, x, y + 1) || !same(x, y, x + 1, y) ? 0.74 : 1;
        if (k !== 1) for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.round(src[i + c]! * k + (k > 1 ? 12 : 0)));
      }
    const shaded = new Uint8ClampedArray(d);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (shaded[(y * S + x) * 4 + 3]) continue;
        const n = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= S || yy >= S ? 0 : shaded[(yy * S + xx) * 4 + 3]!);
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) d.set(OUTLINE, (y * S + x) * 4);
      }
    return this.p;
  }
}

type Draw = (g: Ico) => void;

// palette (Easy Suite teak / lantern / leaf)
const C = {
  rice: "#f7f2e4", sticky: "#f3e6c4", mango: "#f4c13d", mangoDeep: "#f08a2a", leaf: "#5fbf4a", leafDark: "#3f7d52",
  wood: "#9a6d43", woodDark: "#5e3a1c", teak: "#7a4a1e", straw: "#d9a95f", strawLight: "#e8c27a", cream: "#fbf7ee",
  gold: "#f4ae3d", goldLight: "#ffd27a", red: "#d8402e", rose: "#e5779c", pink: "#f29ab8", blue: "#4f86b0",
  sky: "#8fc7e8", steel: "#8a97a3", steelLight: "#c9d3db", ink: "#2a1606", green: "#1f8a5a", greenLight: "#2aa36c",
  brown: "#8a5a2e", coconut: "#6b4423", tea: "#e07a2a", milk: "#fff3e4", black: "#2c2a33", plum: "#7a2f3a",
};

export const ICONS: Record<string, { th: string; en: string; draw: Draw }> = {
  // ---------- Thai village food & drink ----------
  mango_sticky_rice: { th: "ข้าวเหนียวมะม่วง", en: "Mango sticky rice", draw: (g) => {
    g.ellipse(12, 16, 10, 5, "#e8d2a6");                 // banana-leaf plate
    g.ellipse(12, 15.5, 8.5, 3.8, C.leaf);
    g.ellipse(8.5, 13, 4.5, 3.4, C.sticky);              // sticky rice mound
    g.ellipse(15.5, 12.5, 5.5, 3, C.mango);              // mango slices
    g.ellipse(15.5, 11.8, 4.5, 1.6, C.goldLight);
    g.line(7, 11, 10, 11, "#c48a3c", true);              // coconut cream drizzle
    g.px(7, 12, C.cream, true); g.px(9, 12, C.cream, true);
    g.px(6, 13, "#3a2a1a", true); g.px(9, 14, "#3a2a1a", true); // mung beans
  } },
  thai_tea: { th: "ชาเย็น", en: "Thai iced tea", draw: (g) => {
    g.poly([[6, 5], [18, 5], [16.5, 21], [7.5, 21]], C.tea);
    g.rect(6, 5, 12, 3, C.milk);
    g.rect(7, 13, 10, 1, "#ffb36a");
    g.rect(7, 4, 10, 1, "#c9d3db");
    g.line(15, 0, 13, 8, "#e5806c", true);
    g.line(16, 0, 14, 8, "#e5806c", true);
    g.px(9, 10, "#ffe0c0", true); g.px(10, 16, "#ffe0c0", true);
  } },
  rice_bag: { th: "ข้าวสาร", en: "Rice bag", draw: (g) => {
    g.poly([[5, 7], [19, 7], [20, 21], [4, 21]], "#e8d9b4");
    g.poly([[6, 3], [18, 3], [19, 7], [5, 7]], "#d9c69a");
    g.rect(5, 7, 14, 1, "#b7a072");
    g.rect(8, 11, 8, 6, C.green);
    g.ellipse(12, 14, 2.5, 2, C.goldLight);
    g.line(11, 13, 13, 15, C.gold, true);
    g.px(7, 2, C.rice); g.px(10, 2, C.rice); g.px(15, 2, C.rice);
  } },
  fish_sauce: { th: "น้ำปลา", en: "Fish sauce", draw: (g) => {
    g.rect(10, 2, 4, 3, C.red);
    g.rect(10.5, 5, 3, 3, "#a86a2a");
    g.poly([[10, 8], [14, 8], [17, 11], [17, 21], [7, 21], [7, 11]], "#b8742a");
    g.rect(8, 12, 8, 6, C.cream);
    g.ellipse(12, 15, 2.6, 1.4, C.sky);
    g.px(14, 14, "#2a1606", true);
    g.line(9, 9, 9, 19, "#e0a050", true);
  } },
  mango: { th: "มะม่วง", en: "Mango", draw: (g) => {
    g.ellipse(12.5, 13.5, 7.5, 8, C.mango);
    g.ellipse(15.5, 16.5, 4.5, 4.5, C.mangoDeep);
    g.line(12, 4, 13, 6, C.woodDark);
    g.poly([[13, 5], [20, 2], [18, 6]], C.leaf);
    g.px(9, 9, "#fff1b8", true); g.px(9, 10, "#fff1b8", true);
  } },
  sticky_rice: { th: "กระติบข้าวเหนียว", en: "Sticky rice basket", draw: (g) => {
    g.rect(6, 5, 12, 4, C.straw);
    g.ellipse(12, 15, 7.5, 6.5, "#c48a3c");
    for (let y = 10; y < 21; y += 2) g.rect(6, y, 12, 1, C.strawLight);
    g.rect(11, 2, 2, 3, C.teak);
    g.rect(5, 21, 4, 1.5, C.teak);
    g.rect(15, 21, 4, 1.5, C.teak);
  } },
  coconut: { th: "มะพร้าว", en: "Coconut", draw: (g) => {
    g.circle(12, 14, 8.5, C.coconut);
    g.ellipse(12, 10, 4, 3, "#8a6040");
    g.px(10, 10, C.ink, true); g.px(13, 10, C.ink, true); g.px(11.5, 12, C.ink, true);
    g.poly([[12, 6], [7, 1], [17, 1]], C.leaf);
    g.line(8, 17, 10, 19, "#8a6040");
  } },
  banana: { th: "กล้วย", en: "Bananas", draw: (g) => {
    g.ellipse(12, 11, 9.5, 8, "#f7d84a");
    g.ellipse(12, 6.5, 9, 6.8, "clear");
    g.ellipse(12, 15, 7.5, 5.5, "#f2c83a");
    g.ellipse(12, 11.5, 7, 5, "clear");
    g.line(7, 15, 17, 15, "#fff1a8", true);
    g.rect(2, 9, 3, 3, C.woodDark);
    g.px(21, 10, C.woodDark);
  } },
  egg: { th: "ไข่ไก่", en: "Eggs", draw: (g) => {
    g.ellipse(12, 19, 10, 3.5, "#c48a3c");
    g.ellipse(12, 18, 8.5, 2.2, "#8a5a2e");
    g.ellipse(7.5, 13, 3.6, 4.8, "#f0d2a8");
    g.ellipse(16.5, 13, 3.6, 4.8, "#f0d2a8");
    g.ellipse(12, 11.5, 3.8, 5, "#fbf2e0");
    g.px(11, 9, "#ffffff", true); g.px(6, 11, "#fff6e8", true); g.px(15, 11, "#fff6e8", true);
  } },
  chili: { th: "พริก", en: "Chili", draw: (g) => {
    g.poly([[6, 7], [10, 6], [15, 10], [20, 20], [17, 20], [9, 12]], "#e0402e");
    g.poly([[9, 9], [12, 9], [16, 13], [14, 14]], "#f05a3e");
    g.rect(6, 3, 3, 4, C.leafDark);
    g.rect(4, 6, 6, 1.5, C.leaf);
    g.px(11, 8, "#ff9a8a", true);
  } },
  morning_glory: { th: "ผักบุ้ง", en: "Morning glory", draw: (g) => {
    for (const [x, c] of [[8, C.leaf], [12, "#4aa63a"], [16, C.leaf]] as const) {
      g.line(x, 21, x + 1, 9, "#9fd47a");
      g.poly([[x + 1, 3], [x + 4, 8], [x + 1, 12], [x - 2, 8]], c);
    }
    g.rect(6, 17, 13, 2, C.straw);
  } },
  kanom_chan: { th: "ขนมชั้น", en: "Layer cake", draw: (g) => {
    const layers = ["#3f9e5a", "#e8f0d8", "#3f9e5a", "#e8f0d8", "#3f9e5a"];
    layers.forEach((c, i) => g.poly([[4, 16 - i * 2], [14, 20 - i * 2], [20, 16 - i * 2], [10, 12 - i * 2]], c));
    g.poly([[4, 16], [14, 20], [14, 22], [4, 18]], "#2f7a44");
    g.poly([[14, 20], [20, 16], [20, 18], [14, 22]], "#256638");
    g.ellipse(12, 7.5, 3, 1.3, C.pink);
  } },
  nam_pan: { th: "น้ำปั่น", en: "Fruit smoothie", draw: (g) => {
    g.poly([[6, 7], [18, 7], [16, 21], [8, 21]], "#f07fa0");
    g.ellipse(12, 6.5, 6.5, 2.6, "#ffd0dc");
    g.rect(8, 14, 8, 1, "#ff9fbb");
    g.line(14, 0, 12, 7, C.sky, true);
    g.line(15, 0, 13, 7, C.sky, true);
    g.circle(17, 5, 2, C.mango);
  } },
  balm: { th: "ยาหม่อง", en: "Herbal balm", draw: (g) => {
    g.ellipse(12, 15, 8, 5, "#3a8a6a");
    g.rect(4, 11, 16, 4, "#3a8a6a");
    g.ellipse(12, 11, 8, 4, "#5ac08a");
    g.ellipse(12, 11, 5, 2.4, C.goldLight);
    g.px(11, 11, "#fff6dc", true);
  } },
  pla_tu: { th: "ปลาทู", en: "Mackerel", draw: (g) => {
    g.ellipse(12, 15, 9, 6, "#c9b28a");                 // bamboo basket
    g.ellipse(12, 13, 8, 4, "#8a6a44");
    g.ellipse(10, 11, 6, 2.6, "#8fb7c8");
    g.poly([[15, 11], [20, 8], [20, 14]], "#6f97a8");
    g.ellipse(10, 12, 5, 1, "#dbe8ee");
    g.px(6, 10, C.ink, true);
    g.line(8, 9, 12, 9, "#4f7788");
  } },
  pomelo: { th: "ส้มโอ", en: "Pomelo", draw: (g) => {
    g.circle(12, 13.5, 8.5, "#b8d65a");
    g.circle(13.5, 15, 5, "#a6c84a");
    g.rect(11, 3, 2, 3, C.woodDark);
    g.poly([[12, 4], [5, 2], [8, 6]], C.leaf);
    g.px(8, 9, "#e8f5b0", true); g.px(9, 9, "#e8f5b0", true);
  } },
  // ---------- life skills ----------
  seeds: { th: "ซองเมล็ดพันธุ์", en: "Seed pouch", draw: (g) => {
    g.poly([[6, 6], [18, 6], [19, 21], [5, 21]], "#d9b98a");
    g.rect(6, 6, 12, 3, "#b8925e");
    g.line(8, 4, 16, 4, "#8a6a44");
    for (const [x, y] of [[9, 13], [13, 12], [11, 16], [15, 16], [8, 18]] as const) g.rect(x, y, 2, 1.5, "#6b4423");
    g.poly([[12, 10], [15, 13], [12, 14]], C.leaf);
  } },
  fishing_rod: { th: "เบ็ดตกปลา", en: "Fishing rod", draw: (g) => {
    g.line(4, 21, 19, 3, C.teak);
    g.line(5, 21, 20, 3, C.woodDark);
    g.circle(8, 17, 2.2, C.steel);
    g.px(8, 17, C.steelLight, true);
    g.line(20, 3, 21, 14, "#e4f6fb", true);
    g.rect(20, 14, 2, 2, C.red);
    g.px(21, 16, C.steelLight, true);
  } },
  watering_can: { th: "บัวรดน้ำ", en: "Watering can", draw: (g) => {
    g.poly([[5, 9], [15, 9], [16, 20], [4, 20]], "#4f9a6a");
    g.poly([[15, 13], [21, 7], [22, 8], [16, 16]], "#3f7d52");
    g.rect(20, 5, 3, 3, "#3f7d52");
    g.ring(10, 8, 4, 1.4, "#3f7d52");
    g.rect(5, 12, 10, 1, "#7cc08a", true);
    g.px(22, 9, "#7cc8e8", true); g.px(23, 11, "#7cc8e8", true);
  } },
  pla_nin: { th: "ปลานิล", en: "Tilapia", draw: (g) => {
    g.ellipse(11, 12, 8, 5, "#7d8a9a");
    g.poly([[17, 12], [22, 7], [22, 17]], "#5e6a78");
    g.poly([[7, 7], [14, 6], [12, 9]], "#5e6a78");
    g.ellipse(11, 14, 6, 2, "#c9d3db");
    for (const x of [9, 12, 15]) g.line(x, 9, x - 1, 15, "#4a5562", true);
    g.px(5, 11, C.ink, true);
  } },
  grilled_fish: { th: "ปลาเผา", en: "Grilled fish", draw: (g) => {
    g.ellipse(12, 16, 11, 5, C.cream);
    g.ellipse(12, 16, 9, 3.5, "#e8e0cf");
    g.ellipse(11, 13, 8, 3.6, "#c9a070");
    g.poly([[17, 13], [22, 9], [22, 17]], "#a57a4a");
    for (const x of [8, 11, 14]) g.line(x, 11, x - 1, 15, "#6b4423", true);
    g.px(5, 12, C.ink, true);
    g.rect(15, 18, 3, 1.5, C.leaf);
  } },
  fried_morning_glory: { th: "ผัดผักบุ้ง", en: "Stir-fried morning glory", draw: (g) => {
    g.ellipse(12, 16, 11, 5, C.cream);
    g.ellipse(12, 15.5, 8.5, 3.5, "#4aa63a");
    for (const [x, y] of [[7, 14], [11, 13], [15, 14], [9, 16], [14, 17]] as const) g.line(x, y, x + 3, y - 1, "#2f7a44");
    g.rect(10, 13, 2, 1, "#e0402e"); g.rect(15, 15, 2, 1, "#e0402e");
    g.px(12, 15, "#f4d06a", true);
  } },
  // ---------- festival & gifts ----------
  krathong: { th: "กระทง", en: "Krathong", draw: (g) => {
    g.ellipse(12, 18, 10, 3.5, "#3f9e4a");                 // banana-trunk base
    g.poly([[3, 17], [6, 12], [9, 15], [12, 11], [15, 15], [18, 12], [21, 17]], "#5fbf4a");
    g.circle(8, 13, 2, C.pink); g.circle(16, 13, 2, C.pink); g.circle(12, 12, 2.2, "#ffffff");
    g.rect(11.5, 5, 1.5, 6, "#fff6dc");
    g.ellipse(12, 3.5, 1.4, 2.2, C.gold);
    g.px(12, 3, "#fff3c4", true);
    g.line(6, 21, 18, 21, "#6fb0d8");
  } },
  garland: { th: "พวงมาลัย", en: "Jasmine garland", draw: (g) => {
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      g.circle(12 + Math.cos(t) * 6.5, 10 + Math.sin(t) * 6.5, 1.9, C.cream);
    }
    g.circle(12, 17.5, 2.6, C.red);
    g.circle(12, 17.5, 1.2, C.gold);
    g.rect(10.5, 20, 1, 3, C.leaf);
    g.rect(12.5, 20, 1, 3, C.leaf);
  } },
  khom_loi: { th: "โคมลอย", en: "Sky lantern", draw: (g) => {
    g.poly([[6, 3], [18, 3], [20, 17], [4, 17]], "#f6e3b0");
    g.poly([[7, 4], [17, 4], [18.5, 16], [5.5, 16]], "#f7d27a");
    g.rect(4, 17, 16, 1.5, C.wood);
    g.ellipse(12, 20, 2, 2.5, C.gold);
    g.px(12, 20, "#fff3c4", true);
    g.line(9, 5, 8.5, 15, "#ffe9a8", true);
  } },
  candle: { th: "เทียน", en: "Candle", draw: (g) => {
    g.rect(9, 10, 6, 10, "#fff6dc");
    g.rect(6, 19, 12, 3, "#d9a33d");
    g.ellipse(12, 6, 2.6, 4, C.gold);
    g.rect(11.5, 5, 1, 4, "#fff3c4", true);
    g.px(9, 12, "#ffffff", true);
  } },
  lotus: { th: "ดอกบัว", en: "Lotus", draw: (g) => {
    g.poly([[12, 3], [16, 11], [12, 17], [8, 11]], C.pink);
    g.poly([[3, 9], [10, 14], [12, 17], [5, 16]], C.rose);
    g.poly([[21, 9], [14, 14], [12, 17], [19, 16]], C.rose);
    g.rect(5, 17, 14, 3, C.leaf);
    g.px(12, 6, "#ffd6e6", true); g.px(12, 7, "#ffd6e6", true);
  } },
  // ---------- bicycle & tools ----------
  wheel: { th: "ล้อจักรยาน", en: "Bicycle wheel", draw: (g) => {
    g.ring(12, 12, 9.5, 2.2, C.black);
    g.ring(12, 12, 7.3, 1, C.steelLight);
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      g.line(12, 12, 12 + Math.cos(t) * 6.5, 12 + Math.sin(t) * 6.5, C.steel, true);
    }
    g.circle(12, 12, 1.6, C.steelLight);
  } },
  chain: { th: "โซ่จักรยาน", en: "Bicycle chain", draw: (g) => {
    for (let i = 0; i < 5; i++) {
      const x = 4 + i * 3.6;
      const y = 16 - i * 2.4;
      g.ellipse(x, y, 2.6, 1.9, i % 2 ? C.steelLight : C.steel);
      g.ellipse(x, y, 1, 0.7, "clear");
    }
  } },
  bike_bell: { th: "กระดิ่งจักรยาน", en: "Bicycle bell", draw: (g) => {
    g.rect(4, 17, 16, 3, C.steel);                       // handlebar clamp
    g.ellipse(12, 15, 8, 7, "#e0d8c4");                  // dome
    g.rect(3, 15, 18, 8, "clear");
    g.rect(4, 14, 16, 2, "#b9b0a0");
    g.circle(12, 7, 1.5, C.steelLight);
    g.poly([[15, 16], [21, 13], [22, 15], [16, 17.5]], C.red);   // thumb lever
    g.px(8, 10, "#ffffff", true); g.px(9, 9, "#ffffff", true);
  } },
  patch_kit: { th: "ชุดปะยาง", en: "Tire patch kit", draw: (g) => {
    g.rect(3, 7, 18, 12, "#3a6ea8");
    g.rect(3, 7, 18, 3, "#4f86c8");
    g.rect(6, 12, 5, 4, "#2c2a33");
    g.rect(13, 12, 5, 4, C.gold);
    g.rect(10, 4, 4, 3, C.steel);
  } },
  bicycle: { th: "จักรยาน", en: "Bicycle", draw: (g) => {
    g.ring(6, 15, 5, 1.6, C.black);
    g.ring(18, 15, 5, 1.6, C.black);
    g.line(6, 15, 11, 9, C.red); g.line(11, 9, 17, 9, C.red); g.line(11, 9, 12, 15, C.red);
    g.line(12, 15, 6, 15, C.red); g.line(17, 9, 18, 15, C.red); g.line(12, 15, 17, 9, C.red);
    g.line(10, 6, 10, 9, C.steel); g.rect(8, 5, 4, 1.5, C.woodDark);
    g.line(17, 9, 16, 5, C.steel); g.rect(15, 4, 4, 1.5, C.steel);
    g.circle(6, 15, 1, C.steelLight); g.circle(18, 15, 1, C.steelLight);
  } },
  basket: { th: "ตะกร้าหน้ารถ", en: "Delivery basket", draw: (g) => {
    g.poly([[3, 9], [21, 9], [19, 20], [5, 20]], C.straw);
    for (let x = 5; x < 20; x += 3) g.line(x, 10, x + 0.5, 19, C.strawLight);
    for (let y = 12; y < 20; y += 3) g.rect(4, y, 16, 1, "#b8873e");
    g.rect(2, 8, 20, 2, "#b8873e");
    g.ellipse(12, 7, 6, 3, "clear");
    g.line(6, 8, 9, 4, C.teak); g.line(9, 4, 15, 4, C.teak); g.line(15, 4, 18, 8, C.teak);
  } },
  straw_hat: { th: "หมวกสาน", en: "Woven hat", draw: (g) => {
    g.poly([[12, 4], [22, 15], [2, 15]], C.straw);
    for (let y = 7; y < 15; y += 3) g.line(12 - (y - 4) * 0.9, y, 12 + (y - 4) * 0.9, y, C.strawLight);
    g.ellipse(12, 16, 10.5, 2.5, "#c48a3c");
    g.rect(9, 12, 6, 1.5, C.red);
  } },
  pha_khao_ma: { th: "ผ้าขาวม้า", en: "Pha khao ma cloth", draw: (g) => {
    g.rect(3, 5, 18, 14, "#3a6ea8");
    for (let x = 3; x < 21; x += 4) g.rect(x, 5, 2, 14, "#d8402e");
    for (let y = 5; y < 19; y += 4) g.rect(3, y, 18, 1.5, "#2a8a5a");
    for (let x = 4; x < 21; x += 2) g.px(x, 19.5, "#3a6ea8");
  } },
  broom: { th: "ไม้กวาด", en: "Broom", draw: (g) => {
    g.line(18, 1, 11, 13, C.wood); g.line(19, 2, 12, 13, C.teak);
    g.poly([[9, 12], [14, 15], [10, 23], [3, 20]], "#d9c27a");
    g.line(6, 19, 9, 15, "#b7a050", true); g.line(8, 20, 11, 16, "#b7a050", true);
    g.rect(9, 12, 5, 2, C.red);
  } },
  umbrella: { th: "ร่มบ่อสร้าง", en: "Paper umbrella", draw: (g) => {
    g.ellipse(12, 12, 10.5, 8.5, "#e0402e");
    g.rect(0, 12, 24, 12, "clear");
    for (const x of [4, 8, 12, 16, 20]) g.line(12, 4, x, 12, C.goldLight, true);
    g.circle(12, 8, 2, C.gold);
    g.line(12, 12, 12, 21, C.teak);
    g.px(11, 21, C.teak);
  } },
  letter: { th: "จดหมาย", en: "Letter", draw: (g) => {
    g.rect(3, 6, 18, 13, "#f7ebd3");
    g.line(3, 6, 12, 13, "#cdb492");
    g.line(21, 6, 12, 13, "#cdb492");
    g.rect(11, 12, 3, 3, C.red);
    g.rect(16, 8, 3, 3, "#4f86b0");
  } },
  coin: { th: "เหรียญบาท", en: "Coin", draw: (g) => {
    g.circle(12, 12, 9, C.gold);
    g.circle(12, 12, 6.2, C.goldLight);
    g.rect(11, 7.5, 2, 9, "#b9741f");
    g.rect(9, 9, 6, 1.5, "#b9741f");
    g.rect(9, 13.5, 6, 1.5, "#b9741f");
  } },
  // ---------- Muslim community (halal food, plain textiles, Raya; no script) ----------
  ketupat: { th: "ตูปะ", en: "Ketupat", draw: (g) => {
    g.fill((X, Y) => Math.abs(X - 12) + Math.abs(Y - 13.5) <= 8.5, "#8fd060");
    g.fill((X, Y) => Math.abs(X - 12) + Math.abs(Y - 13.5) <= 8.5 && (Math.floor((X + Y) / 3) + Math.floor((X - Y + 30) / 3)) % 2 === 1, "#4f9e3a");
    g.line(12, 5, 13, 1, "#4f9e3a");
    g.line(13, 5, 18, 0, "#8fd060");
  } },
  ketupat_shell: { th: "ปลอกตูปะ", en: "Ketupat shell", draw: (g) => {
    g.fill((X, Y) => Math.abs(X - 12) + Math.abs(Y - 13.5) <= 8.5, "#c8e08a");
    g.fill((X, Y) => Math.abs(X - 12) + Math.abs(Y - 13.5) <= 8.5 && (Math.floor((X + Y) / 3) + Math.floor((X - Y + 30) / 3)) % 2 === 1, "#9cc054");
    g.fill((X, Y) => Math.abs(X - 12) + Math.abs(Y - 13.5) <= 3.5, "clear");
    g.line(3, 13, 0, 18, "#9cc054"); g.line(21, 13, 23, 7, "#c8e08a");
  } },
  rendang: { th: "เรินดังเนื้อ", en: "Beef rendang", draw: (g) => {
    g.ellipse(12, 15, 10, 5.5, "#f3f7ec");
    g.ellipse(12, 14.5, 8, 4, "#e8e0c8");
    for (const [x, y] of [[8, 13], [12, 12], [15, 14], [10, 15.5], [14, 16]] as const) g.ellipse(x, y, 2.3, 1.7, "#6b2e16");
    g.px(9, 12, "#a84a24", true); g.px(13, 11, "#a84a24", true); g.px(16, 13, "#a84a24", true);
    g.poly([[17, 8], [21, 6], [19, 10]], C.leaf);
  } },
  kurma: { th: "อินทผลัม", en: "Dates", draw: (g) => {
    g.ellipse(12, 17, 9.5, 4, "#c9b28a");
    for (const [x, y] of [[8, 13], [13, 12], [16, 15], [10, 16]] as const) g.ellipse(x, y, 3.2, 2.1, "#6b2e1e");
    g.px(7, 12, "#b0603a", true); g.px(12, 11, "#b0603a", true); g.px(15, 14, "#b0603a", true);
  } },
  roti: { th: "โรตี", en: "Roti", draw: (g) => {
    g.ellipse(12, 14, 10, 6.5, "#e8c27a");
    g.ellipse(12, 13, 8, 4.8, "#f3d79a");
    g.line(6, 12, 10, 15, "#c48a3c"); g.line(11, 11, 16, 15, "#c48a3c"); g.line(14, 10, 18, 13, "#c48a3c");
    g.ellipse(12, 12.5, 3, 1.5, C.cream);
  } },
  bubur: { th: "บูโบ", en: "Rice porridge", draw: (g) => {
    g.ellipse(12, 10.5, 9, 3.5, "#f7f2e4");
    g.poly([[3, 11], [21, 11], [18, 20], [6, 20]], "#3f8a6a");
    g.rect(8, 20, 8, 1.5, "#2c6a50");
    g.rect(4, 14, 16, 1, "#8ad0b0");
    g.px(9, 10, C.leaf, true); g.px(14, 9, C.leaf, true); g.px(12, 10, C.gold, true);
    g.line(9, 3, 9, 6, "#e8e0d0", true); g.line(14, 2, 14, 6, "#e8e0d0", true);
  } },
  teh_tarik: { th: "ชาชัก", en: "Teh tarik", draw: (g) => {
    g.poly([[5, 9], [17, 9], [16, 21], [6, 21]], "#c8945a");
    g.ellipse(11, 9, 6, 2, "#f3e0c0");
    g.rect(17, 12, 3, 5, "#d9d2c0"); g.rect(18, 13, 1, 3, "clear");
    g.line(12, 0, 11, 7, "#d8a874", true); g.line(13, 0, 12, 7, "#d8a874", true);
    g.rect(6, 15, 10, 1, "#e0b07a");
  } },
  songkok: { th: "หมวกซงกก", en: "Songkok", draw: (g) => {
    g.poly([[4, 9], [20, 9], [19, 19], [5, 19]], C.black);
    g.ellipse(12, 9, 8, 2.6, "#45424f");
    g.rect(5, 16, 14, 1.5, "#45424f");
    g.px(7, 11, "#5a5666", true); g.px(8, 12, "#5a5666", true);
  } },
  prayer_mat: { th: "ผ้าปูละหมาด", en: "Prayer mat (plain)", draw: (g) => {
    g.rect(5, 2, 14, 19, "#2f7a5a");                       // plain woven mat: border + field, no motif
    g.rect(7, 4, 10, 15, "#3f9a72");
    g.rect(7, 4, 10, 1, "#e8d9a8"); g.rect(7, 18, 10, 1, "#e8d9a8");
    for (let x = 5; x < 19; x += 2) { g.px(x, 1, "#e8d9a8"); g.px(x, 21, "#e8d9a8"); }
  } },
  sarong: { th: "ผ้าโสร่ง", en: "Kain pelekat sarong", draw: (g) => {
    g.poly([[5, 4], [19, 4], [20, 21], [4, 21]], "#5a3a8a");
    for (let x = 6; x < 20; x += 4) g.rect(x, 4, 1.5, 17, "#8a6ac0");
    for (let y = 7; y < 21; y += 4) g.rect(4.5, y, 15, 1, "#c0a0e0");
    g.rect(5, 4, 14, 2, "#3a2a6a");
  } },
  pelita: { th: "ตะเกียงปะลิตา", en: "Pelita lamp", draw: (g) => {
    g.rect(9, 9, 6, 12, "#5fa04a");
    g.rect(9, 13, 6, 1, "#3f7a32"); g.rect(9, 17, 6, 1, "#3f7a32");
    g.rect(6, 21, 12, 1.5, C.teak);
    g.rect(11, 6, 2, 3, C.woodDark);
    g.ellipse(12, 3.5, 2.2, 3, C.gold);
    g.rect(11.5, 3, 1, 2, "#fff3c4", true);
  } },
};

export const ICON_NAMES = Object.keys(ICONS);

const cache = new Map<string, Pixels>();
export function iconPixels(name: string, size = 24): Pixels {
  const key = `${name}@${size}`;
  let p = cache.get(key);
  if (!p) {
    const def = ICONS[name];
    if (!def) throw new Error(`Unknown icon "${name}" (try: easyitems icons)`);
    const g = new Ico(size);
    def.draw(g);
    p = g.done();
    cache.set(key, p);
  }
  return p;
}

export const isIcon = (name: string) => name in ICONS;
