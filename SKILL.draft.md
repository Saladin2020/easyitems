---
name: easyitems-catalog
description: >-
  Use when a game needs an item database, shops, an inventory with equipment, loot tables or crafting recipes
  (with Thai / English / Malay names and 24-32 px pixel icons), wants to balance prices by simulating purchases,
  must cross-check Easy Quest reward item ids, or needs a Godot 4.3+ Items autoload + shop UI or a PixiJS runtime.
  Not for drawing new icon art (44 built-in icons only).
---
# Easy Items catalog

Easy Items **validates, simulates and exports** `easyitems/1` catalogs. Read `/workspace/indie-studio/tools/EASYITEMS.md`
for paths, commands and import details; full format: `/workspace/indie-studio/tools/easyitems/docs/FORMAT.md`.

## Setup

Install: `/workspace/indie-studio/tools/easyitems`. CLI: `node /workspace/indie-studio/tools/easyitems-cli.mjs`.
Game files go under `/workspace/indie-studio/projects/<Name>/` (`init --workspace` once). Ports: editor 8878,
MCP HTTP 8879, Vite 5185.

## Steps

1. **Look.** `list`, `shops`, `icons`. Reuse starter items when they fit. Never invent icon names.
2. **Write.** Add items / shops / loot / recipes in `items/<doc>.easyitems.json` (or MCP `write_items` with `dryRun`
   first). Every name needs `th` and `en`; add `ms` for Malay-speaking characters.
3. **Check.** `check` must report 0 errors. Fix by JSON path. Put the game's `.ezq` quests in `quests/` so missing
   reward ids show up.
4. **Balance.** `shops <id>` for prices, `simulate` (MCP) or the editor's Shops tab to play a shopping run,
   `loot <table> --seed N --times 10` for drops.
5. **Look at icons.** `render --out <png> --scale 3` and open the PNG.
6. **Export.** `export --preset godot` or `pixi`; for Godot run `test_items.gd` headless and expect `OK`.

## Rules

- Halal shops: no pork, alcohol or `halal: false` items. No Quran, calligraphy, sacred figures or the Prophet.
- Keep catalogs multicultural (Thai, Malay-Muslim, Chinese-Thai side by side).
- Do not push or change the upstream repo; ask before any push or merge.
