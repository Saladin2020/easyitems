# Easy Items MCP server

```bash
npm run mcp                      # stdio
npm run mcp:http                 # http://127.0.0.1:8879/mcp (streamable HTTP)
node dist/mcp/server.js --workspace /path/to/game [--http --port 8879]
```

Client config (stdio):

```json
{ "mcpServers": { "easyitems": { "command": "node", "args": ["/path/to/easyitems/dist/mcp/server.js", "--workspace", "/path/to/game"] } } }
```

| Tool | Args | Returns |
|---|---|---|
| `workspace_info` | | documents, rules, items, shops, loot, recipes, icon names, format cheat sheet with the content rules. Call first |
| `list_items` | `category?`, `tag?` | items with names, category, price, stack, icon, equip slot |
| `get_item` | `id` | the item plus `shops` (buy / sell price at each) and `recipes` |
| `write_items` | `id`, `doc`, `dryRun?` | validates against the whole workspace; saves only without errors. `{ saved, errors, warnings }` |
| `check_items` | `quests?` | `{ ok, errors, warnings, quests: { files, matched, missing } }` |
| `render_icons` | `ids?`, `size?`, `scale?` | PNG at `exports/renders/icons.png`, also returned as an image |
| `roll_loot` | `table`, `seed?`, `times?` | `{ rolls: [{ seed, items }] }` |
| `simulate` | `ops` | runs ops on a fresh inventory: `["buy", shop, item, n?]`, `["sell", shop, item, n?]`, `["use", item]`, `["equip", item]`, `["unequip", slot]`, `["craft", recipe, times?]`, `["loot", table, seed]`, `["coins", delta]`, `["day", n]`, `["compact"]`. Returns `results` ("ok" or a reason), `coins`, `bag`, `equipped`, `stats`, `day` |
| `export_items` | `preset?`, `out?`, `size?` | written folders and file counts. `out` must stay inside the workspace |

Errors carry JSON paths (`game.easyitems.json:items[0].stack`) so an agent can fix them in place.
Write ids match `^[a-z0-9_-]+$`; paths outside the workspace and `EASYITEMS_ALLOWED_DIRS` are refused.
