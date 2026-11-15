/** Easy Items data model: `easyitems/1` database documents (items, shops, loot tables, recipes, rules). */

export const FORMAT = "easyitems/1";

export const CATEGORIES = ["food", "drink", "ingredient", "material", "tool", "equipment", "clothing", "festival", "gift", "textile", "key", "currency"] as const;
export type Category = (typeof CATEGORIES)[number];

export const RARITIES = ["common", "uncommon", "rare"] as const;
export type Rarity = (typeof RARITIES)[number];

export const EFFECT_KINDS = ["heal", "energy", "mood", "stat", "speed", "unlock"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const DEFAULT_EQUIP_SLOTS = ["head", "body", "hand", "accessory", "vehicle"] as const;

export const EXPORT_PRESETS = ["godot", "pixi", "png", "json", "all"] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number];

export const ICON_SIZES = [24, 32] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export interface Text {
  th: string;
  en: string;
  /** Malay (optional; Easy Save + i18n fills the rest). */
  ms?: string;
}

export interface ItemEffect {
  kind: EffectKind;
  /** heal / energy / mood: points; stat: added to `stat`; speed: multiplier delta (0.2 = +20%). */
  amount: number;
  stat?: string;
  /** Seconds; 0 / missing = instant or permanent while equipped. */
  duration?: number;
}

export interface Equip {
  slot: string;
  stats?: Record<string, number>;
}

export interface Item {
  id: string;
  name: Text;
  desc?: Text;
  category: Category;
  /** Base price in coins (baht). 0 = cannot be bought or sold. */
  price: number;
  /** Max per inventory slot (1 = not stackable). */
  stack: number;
  /** Built-in icon name (see `easyitems icons`). */
  icon: string;
  effects?: ItemEffect[];
  /** Used up by `use` (default: true when it has effects and no equip). */
  consumable?: boolean;
  equip?: Equip;
  rarity?: Rarity;
  tags?: string[];
  /** Can be sold to shops (default true when price > 0). */
  sellable?: boolean;
  /** false: a halal shop may not stock it (pork and alcohol words are detected too). */
  halal?: boolean;
}

export interface StockEntry {
  item: string;
  /** -1 = unlimited. */
  qty: number;
  /** Fixed price; overrides price × buyMod. */
  price?: number;
  /** Days until qty refills (0 / missing = never). */
  restock?: number;
}

export interface Shop {
  id: string;
  name: Text;
  /** Cast id from Easy Dialogue / Easy Quest (the shopkeeper). */
  keeper?: string;
  /** Multiplier on the item price when the player buys. */
  buyMod: number;
  /** Fraction of the item price the player gets when selling (0 = shop does not buy). */
  sellMod: number;
  /** Per-tag price multipliers on top of buyMod, e.g. { "festival": 0.8 } during a fair. */
  tagMods?: Record<string, number>;
  /** Only buys items with one of these categories (default: anything sellable). */
  buys?: Category[];
  /** Halal shop: may not stock pork, alcohol or anything with halal: false (checked). */
  halal?: boolean;
  tags?: string[];
  stock: StockEntry[];
}

export interface LootEntry {
  /** Item id, or omit for "nothing". */
  item?: string;
  weight: number;
  min?: number;
  max?: number;
}

export interface LootTable {
  id: string;
  name?: Text;
  /** Number of rolls, or [min, max]. */
  rolls: number | [number, number];
  entries: LootEntry[];
  /** Always dropped, on top of the rolls. */
  guaranteed?: Array<{ item: string; n: number }>;
}

export interface Recipe {
  id: string;
  name: Text;
  station?: string;
  inputs: Array<{ item: string; n: number }>;
  outputs: Array<{ item: string; n: number }>;
  /** Seconds (informational; runtimes don't wait). */
  time?: number;
}

export interface Rules {
  /** Inventory slots. */
  slots: number;
  /** Icon shown next to coin counts (built-in icon name). */
  currency: string;
  startingCoins: number;
  startingItems?: Array<{ item: string; n: number }>;
  equipSlots: string[];
  /** Pixel size of icons in exports. */
  iconSize: IconSize;
}

export interface ItemsDoc {
  format: typeof FORMAT;
  id?: string;
  name?: Text;
  rules?: Partial<Rules>;
  items?: Item[];
  shops?: Shop[];
  loot?: LootTable[];
  recipes?: Recipe[];
}

/** Every workspace document merged into one database. */
export interface ItemsDb {
  rules: Rules;
  items: Item[];
  shops: Shop[];
  loot: LootTable[];
  recipes: Recipe[];
  /** Which file each id came from. */
  sources: Record<string, string>;
}

export interface Diagnostic {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export const DEFAULT_RULES: Rules = {
  slots: 24,
  currency: "coin",
  startingCoins: 50,
  startingItems: [],
  equipSlots: [...DEFAULT_EQUIP_SLOTS],
  iconSize: 24,
};
