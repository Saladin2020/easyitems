# Credits

## Icons and sample data (CC0 1.0)

* All 44 item icons are **drawn from code** on a 24-unit grid (`src/shared/icons.ts`) at 24 or 32 px: no source
  images, no AI generation, no network calls. The starter catalog (`samples/items/`), the copied Easy Quest samples
  (`samples/quests/`) and everything you render or export from them are dedicated to the public domain (CC0 1.0).
* Content rules for the catalog: halal-appropriate food (no pork, no alcohol; the halal Raya bazaar is checked);
  no depiction of the Prophet or of sacred figures; no Quran, scripture or Arabic calligraphy on items or icons
  (the prayer mat is a plain striped mat and is not sellable). Thai village, Malay-Muslim and Chinese-Thai life
  appear side by side.

## Fonts

* **Kanit** (Cadson Demak, SIL Open Font License 1.1) is bundled in `assets/fonts/` with `OFL.txt` and copied into
  the Godot and PixiJS exports so Thai text renders out of the box.
* **Press Start 2P** (SIL OFL 1.1) appears only in the README art (`docs/brand/`).

## Runtimes

* PixiJS v8 is **not** bundled: the exported `index.html` loads `./pixi.min.js` if you drop it next to the file,
  otherwise the jsDelivr CDN (MIT).
* Godot exports target Godot 4.3+ (MIT); nothing from the engine is included. The shop UI uses Easy UI's teak theme
  when it is installed in the same project.
