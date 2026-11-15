# Easy Items studio install plan (prepared, NOT applied)

Nothing below has been run against `/workspace/indie-studio`. Apply only after the user approves.

1. `git clone /workspace/easyitems /workspace/indie-studio/tools/easyitems && cd $_ && git checkout --detach <SHA>`
2. `npm ci && npm run build && npm test` (expect 46 passed, 1 skipped; `GODOT=… npx vitest run test/godot.test.ts` for the Godot check).
3. Copy `install-plan/easyitems-cli.mjs` → `/workspace/indie-studio/tools/easyitems-cli.mjs` (same shape as the other
   `easy*-cli.mjs` wrappers: sets `EASYITEMS_HOME`, `EASYITEMS_WORKSPACE`, adds `/workspace/indie-studio/projects` to
   `EASYITEMS_ALLOWED_DIRS`).
4. Copy `install-plan/EASYITEMS.md` → `/workspace/indie-studio/tools/EASYITEMS.md` and replace `<SHA>`.
5. Smoke: `node /workspace/indie-studio/tools/easyitems-cli.mjs init --workspace /workspace/indie-studio/projects/_smoke_items`
   then `check`, `shops raya_bazaar` and `export --preset godot` with the same `--workspace`.
6. Shared skill: install `SKILL.draft.md` as `easyitems-catalog` (the parent agent does this).
7. Once a GitHub repo exists (user's call): `git remote add github https://github.com/Saladin2020/easyitems.git` in the install.

Ports: editor 8878, MCP HTTP 8879, Vite 5185 (Easy FX uses 8848 / 8849 / 5180).
