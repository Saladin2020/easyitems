# `easyitems/1` format

A workspace has `items/*.easyitems.json` documents. All documents merge into **one database**: ids must be unique
across files, and a shop in one file may stock items from another. Optional `easyitems.config.json` holds
`{ name, scale, quests: ["quests"] }` (folders or `.ezq` files read by `check`).

```jsonc
{
  "format": "easyitems/1",          // required
  "id": "raya",                     // optional, defaults to the file name
  "name": { "th": "…", "en": "…" },
  "rules": { … },                   // at most one document should set rules (later file wins, with a warning)
  "items": [ … ], "shops": [ … ], "loot": [ … ], "recipes": [ … ]
}
```

Ids (`item`, `shop`, `loot`, `recipe`, equip slots) match `^[a-z0-9_-]+$`. Text fields are `{ th, en, ms? }`:
Thai and English required, Malay optional (falls back to Thai in the runtimes, then English for descriptions).

## rules

| Field | Default | Meaning |
|---|---|---|
| `slots` | 24 | Bag slots (1..200) |
| `currency` | `coin` | Built-in icon shown next to coin counts |
| `startingCoins` | 50 (the village sample sets 60) | Coins on a new game |
| `startingItems` | `[]` | `[{ item, n }]` added on a new game |
| `equipSlots` | `head, body, hand, accessory, vehicle` | Allowed `equip.slot` values |
| `iconSize` | 24 | 24 or 32: atlas size for exports |

## item

| Field | Required | Meaning |
|---|---|---|
| `id`, `name` | yes | |
| `desc` | | `{ th, en, ms? }` |
| `category` | yes | `food drink ingredient material tool equipment clothing festival gift textile key currency` |
| `price` | yes | List price in coins, integer ≥ 0. 0 = free / not sellable by default |
| `stack` | yes | Max per bag slot, 1..999. Equipment should be 1 (warning) |
| `icon` | yes | A built-in icon name (`easyitems icons`) |
| `effects` | | `[{ kind, amount, stat?, duration? }]`, kind `heal energy mood stat speed unlock` |
| `equip` | | `{ slot, stats?: { name: n } }` |
| `consumable` | | Default: true for food / drink or items with effects |
| `sellable` | | Default: `price > 0`. Shops never buy unsellable items |
| `halal` | | Set `false` on anything a halal shop must not stock (pork, alcohol words are detected too) |
| `rarity` | | `common uncommon rare epic` |
| `tags` | | Free strings; shops use them in `tagMods`; `list --tag` filters on them |

## shop

| Field | Meaning |
|---|---|
| `id`, `name` | |
| `keeper` | Cast id (Easy Dialogue / Easy Sprite) of the shopkeeper |
| `buyMod` | Multiplier on the list price when the player buys (1 = list price) |
| `sellMod` | 0..1: share of the list price paid when the player sells; 0 = the shop buys nothing |
| `tagMods` | `{ tag: multiplier }` applied to the buy price for items with that tag (multiplied together) |
| `buys` | Categories the shop buys from the player (default: everything sellable) |
| `halal` | `true`: stock may not include pork, alcohol or `halal: false` items (error) |
| `stock` | `[{ item, qty, price?, restock? }]`: `qty -1` = unlimited; `price` overrides; `restock` = days until refilled to `qty` |

**Prices.** Buy: `stock.price`, else `max(1, floor(price × buyMod × Π tagMods + 0.5))`. Sell:
`floor(price × sellMod)`, or nothing when `sellMod` is 0, the item is not sellable, or its category is not in
`buys`. Selling to a shop puts the item back into its stock when listed.

## loot

`{ id, rolls, entries, guaranteed? }`: `rolls` is `n` or `[min, max]`; each roll picks one entry by `weight`
(`item` omitted = nothing) and gives `min..max` (default 1). `guaranteed: [{ item, n }]` always drops. Rolls use
mulberry32 seeded with the given seed, so the CLI, MCP, web editor, Pixi runtime and Godot autoload agree.

## recipe

`{ id, name, station?, inputs: [{ item, n }], outputs: [{ item, n }], time? }`. Crafting checks inputs and that the
outputs fit in the bag, then swaps them.

## life skills (`skills`, `crops`, `fishing`)

- `skills: [{ id, name, icon?, maxLevel = 10, xpBase = 20 }]` — XP to reach level L is `xpBase × (L−1) × L / 2`.
  The engine uses the ids `farming`, `fishing` and any recipe `skill` (e.g. `cooking`).
- `crops: [{ id, name?, seed, produce, days, seasons?, yield = [1, 2], xp = 5 }]` — plant uses one `seed`; the plot
  needs `days` watered days (one watering per day; `newDay(day, rained)` waters every plot on rain / storm days from
  the Easy NPC calendar); harvest yields `yield` + 1 per 3 farming levels above 1. `seasons` are Easy NPC season ids.
- `fishing: [{ id, name?, loot, bite = 0.6, minLevel?, xp = 5, tool? }]` — a cast bites when
  `rnd < min(0.95, bite × (1 + 0.05 × (level − 1)) × weatherMult)` (`WEATHER_INFO[w].fishing` from Easy NPC), then
  rolls the `loot` table with seed + 1. A miss still gives 1 XP.
- recipe `skill`, `level`, `xp` — `cook(recipe)` needs that skill level and gives `xp` per craft.

Runtimes: `LifeSkills` in `easyitems-core.js` (`loadItems(...).life`), Godot `Items.plant / water / new_day /
harvest / fish / cook / skill_level / skill_progress`, signal `skill_level_up`, save with `life_to_dict()`.

## Checks

`easyitems check` (and `check_items`, and every save from the editor or MCP) reports JSON paths such as
`raya.easyitems.json:shops[0].stock[3].item`:

- shape and range of every field; unknown icons; duplicate ids across files;
- unknown item ids in shops, loot, recipes and starting items (with "did you mean");
- equip slots not in `rules.equipSlots`; halal shops stocking non-halal items;
- content rule: no scripture, calligraphy or sacred figures as items;
- Easy Quest cross-reference: item ids used by `@item`, `give`, `take`, `has()` and `count()` in `.ezq` files that
  the database lacks (warnings, so a quest-only key item does not block exports).

Saving a document refuses changes that **break other documents** (for example deleting an item another shop stocks).

## Runtime state

The inventory state (TS `Inventory.state`, Pixi `inventory.state`, Godot `Items.state` / `to_dict()`) is plain JSON:

```json
{ "coins": 60, "day": 0, "slots": [{ "item": "letter", "n": 1 }, null], "equipped": { "head": null },
  "stock": { "market": { "mango": 12 } }, "restocked": { "market": { "mango": 0 } } }
```

Godot `Items.from_dict(d)` restores it after a JSON round trip.
