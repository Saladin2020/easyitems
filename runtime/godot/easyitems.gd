extends Node
## Easy Items runtime (autoload "Items"): inventory, equipment, shops, loot tables and crafting.
## Same rules as the Easy Items TypeScript engine; test_items.gd replays a script and compares the state.
##
##   Items.buy("market", "thai_tea")        -> {"ok": true, ...} or {"ok": false, "reason": "not_enough_coins"}
##   Items.add("mango", 3); Items.count("mango"); Items.equip("bicycle"); Items.stats()
##   Items.loot("delivery_tip", seed); Items.craft("bicycle"); Items.advance_days(1)
##   var data := Items.state   # plain Dictionary: hand it to Easy Save's SaveManager

signal changed
signal coins_changed(coins: int)

const DB_PATH := "res://easyitems/db.json"

var db: Dictionary = {}
var items: Dictionary = {}
var shops: Dictionary = {}
var recipes: Dictionary = {}
var loot_tables: Dictionary = {}
var state: Dictionary = {}


func _ready() -> void:
	if db.is_empty():
		load_db()


func load_db(path: String = DB_PATH) -> void:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("Easy Items: cannot open %s" % path)
		return
	db = JSON.parse_string(f.get_as_text())
	items.clear()
	shops.clear()
	recipes.clear()
	loot_tables.clear()
	for it in db["items"]:
		items[it["id"]] = it
	for s in db["shops"]:
		shops[s["id"]] = s
	for r in db["recipes"]:
		recipes[r["id"]] = r
	for l in db["loot"]:
		loot_tables[l["id"]] = l
	reset()


## The generated EasyItem resource (name, icon AtlasTexture, price, effects...).
func resource(id: String) -> Resource:
	return load("res://easyitems/items/%s.tres" % id)


func icon(id: String) -> Texture2D:
	var r := resource(id)
	return r.icon if r else null


func item_name(id: String, lang: String = "th") -> String:
	var n: Dictionary = items[id]["name"]
	return str(n.get(lang, n["th"])) if n.get(lang, "") != "" else str(n["th"])


func reset() -> void:
	var r: Dictionary = db["rules"]
	var st := {"coins": int(r["startingCoins"]), "slots": [], "equipped": {}, "stock": {}, "restocked": {}, "day": 0}
	for i in int(r["slots"]):
		st["slots"].append(null)
	for s in r["equipSlots"]:
		st["equipped"][s] = null
	for sh in db["shops"]:
		st["stock"][sh["id"]] = {}
		st["restocked"][sh["id"]] = {}
		for e in sh["stock"]:
			st["stock"][sh["id"]][e["item"]] = int(e["qty"])
			st["restocked"][sh["id"]][e["item"]] = 0
	state = st
	for s in r.get("startingItems", []):
		add(s["item"], int(s["n"]))
	changed.emit()


## Plain state for a save file (Easy Save stores this): coins, day, slots, equipped, shop stock and restock days.
func to_dict() -> Dictionary:
	return state.duplicate(true)


## Restore to_dict() output, also after a JSON round trip (numbers come back as floats).
func from_dict(d: Dictionary) -> void:
	reset()
	state["coins"] = int(d.get("coins", state["coins"]))
	state["day"] = int(d.get("day", 0))
	var slots: Array = d.get("slots", [])
	for i in state["slots"].size():
		var s = slots[i] if i < slots.size() else null
		state["slots"][i] = null if s == null or not items.has(str(s["item"])) else {"item": str(s["item"]), "n": int(s["n"])}
	var eq: Dictionary = d.get("equipped", {})
	for k in state["equipped"].keys():
		var v = eq.get(k, null)
		state["equipped"][k] = null if v == null or not items.has(str(v)) else str(v)
	for key in ["stock", "restocked"]:
		var src: Dictionary = d.get(key, {})
		for sh in state[key].keys():
			var m: Dictionary = src.get(sh, {})
			for it in state[key][sh].keys():
				if m.has(it):
					state[key][sh][it] = int(m[it])
	changed.emit()
	coins_changed.emit(int(state["coins"]))


func _stack(id: String) -> int:
	return int(items[id]["stack"])


func count(id: String) -> int:
	var n := 0
	for s in state["slots"]:
		if s != null and s["item"] == id:
			n += int(s["n"])
	return n


func has(id: String, n: int = 1) -> bool:
	return count(id) >= n


func space(id: String) -> int:
	var stack := _stack(id)
	var n := 0
	for s in state["slots"]:
		if s == null:
			n += stack
		elif s["item"] == id:
			n += stack - int(s["n"])
	return n


## Adds up to n; returns how many did not fit.
func add(id: String, n: int = 1) -> int:
	var stack := _stack(id)
	var left := n
	for s in state["slots"]:
		if left <= 0:
			break
		if s != null and s["item"] == id and int(s["n"]) < stack:
			var k: int = min(stack - int(s["n"]), left)
			s["n"] = int(s["n"]) + k
			left -= k
	var slots: Array = state["slots"]
	for i in slots.size():
		if left <= 0:
			break
		if slots[i] == null:
			var k: int = min(stack, left)
			slots[i] = {"item": id, "n": k}
			left -= k
	changed.emit()
	return left


func remove(id: String, n: int = 1) -> bool:
	if count(id) < n:
		return false
	var left := n
	var slots: Array = state["slots"]
	for i in range(slots.size() - 1, -1, -1):
		if left <= 0:
			break
		var s = slots[i]
		if s == null or s["item"] != id:
			continue
		var k: int = min(int(s["n"]), left)
		s["n"] = int(s["n"]) - k
		left -= k
		if int(s["n"]) == 0:
			slots[i] = null
	changed.emit()
	return true


func compact() -> void:
	var order: Array = []
	var totals := {}
	for s in state["slots"]:
		if s == null:
			continue
		if not totals.has(s["item"]):
			order.append(s["item"])
			totals[s["item"]] = 0
		totals[s["item"]] += int(s["n"])
	var slots: Array = state["slots"]
	for i in slots.size():
		slots[i] = null
	for id in order:
		add(id, totals[id])


func _ok(extra: Dictionary = {}) -> Dictionary:
	var d := {"ok": true}
	d.merge(extra)
	return d


func _fail(reason: String) -> Dictionary:
	return {"ok": false, "reason": reason}


func is_consumable(it: Dictionary) -> bool:
	if it.has("consumable"):
		return bool(it["consumable"])
	return it.get("effects", []).size() > 0 and not it.has("equip")


func is_sellable(it: Dictionary) -> bool:
	if it.has("sellable"):
		return bool(it["sellable"])
	return int(it["price"]) > 0


func use(id: String) -> Dictionary:
	var it: Dictionary = items[id]
	if not has(id):
		return _fail("not_owned")
	if not is_consumable(it):
		return _fail("not_usable")
	remove(id, 1)
	return _ok({"effects": it.get("effects", [])})


func equip(id: String) -> Dictionary:
	var it: Dictionary = items[id]
	if not it.has("equip"):
		return _fail("not_equipment")
	if not has(id):
		return _fail("not_owned")
	var slot: String = it["equip"]["slot"]
	if not state["equipped"].has(slot):
		return _fail("no_slot")
	var prev = state["equipped"][slot]
	remove(id, 1)
	if prev != null:
		if space(prev) < 1:
			add(id, 1)
			return _fail("inventory_full")
		add(prev, 1)
	state["equipped"][slot] = id
	changed.emit()
	return _ok()


func unequip(slot: String) -> Dictionary:
	var id = state["equipped"].get(slot)
	if id == null:
		return _fail("empty_slot")
	if space(id) < 1:
		return _fail("inventory_full")
	add(id, 1)
	state["equipped"][slot] = null
	changed.emit()
	return _ok()


func stats() -> Dictionary:
	var out := {}
	for slot in state["equipped"]:
		var id = state["equipped"][slot]
		if id == null:
			continue
		var st: Dictionary = items[id].get("equip", {}).get("stats", {})
		for k in st:
			out[k] = round((float(out.get(k, 0.0)) + float(st[k])) * 1000.0) / 1000.0
	return out


func buy_price(shop_id: String, id: String) -> int:
	var sh: Dictionary = shops[shop_id]
	for e in sh["stock"]:
		if e["item"] == id:
			if e.has("price"):
				return int(e["price"])
			var it: Dictionary = items[id]
			if int(it["price"]) == 0:
				return 0
			var mult: float = float(sh["buyMod"])
			var mods: Dictionary = sh.get("tagMods", {})
			for t in it.get("tags", []):
				if mods.has(t):
					mult *= float(mods[t])
			return max(1, int(floor(float(it["price"]) * mult + 0.5)))
	return -1


## -1 when the shop does not buy this item.
func sell_price(shop_id: String, id: String) -> int:
	var sh: Dictionary = shops[shop_id]
	var it: Dictionary = items[id]
	if float(sh["sellMod"]) <= 0.0 or not is_sellable(it):
		return -1
	if sh.has("buys") and not (it["category"] in sh["buys"]):
		return -1
	return max(1, int(floor(float(it["price"]) * float(sh["sellMod"]))))


func stock(shop_id: String, id: String) -> int:
	return int(state["stock"].get(shop_id, {}).get(id, 0))


func buy(shop_id: String, id: String, n: int = 1) -> Dictionary:
	var price := buy_price(shop_id, id)
	if price < 0:
		return _fail("not_sold_here")
	var q := stock(shop_id, id)
	if q != -1 and q < n:
		return _fail("out_of_stock")
	var cost := price * n
	if int(state["coins"]) < cost:
		return _fail("not_enough_coins")
	if space(id) < n:
		return _fail("inventory_full")
	state["coins"] = int(state["coins"]) - cost
	if q != -1:
		state["stock"][shop_id][id] = q - n
	add(id, n)
	coins_changed.emit(state["coins"])
	return _ok({"coins": -cost, "items": [{"item": id, "n": n}]})


func sell(shop_id: String, id: String, n: int = 1) -> Dictionary:
	var price := sell_price(shop_id, id)
	if price < 0:
		return _fail("shop_wont_buy")
	if not has(id, n):
		return _fail("not_owned")
	remove(id, n)
	state["coins"] = int(state["coins"]) + price * n
	var st: Dictionary = state["stock"][shop_id]
	if st.has(id) and int(st[id]) != -1:
		st[id] = int(st[id]) + n
	coins_changed.emit(state["coins"])
	return _ok({"coins": price * n, "items": [{"item": id, "n": -n}]})


func advance_days(days: int = 1) -> void:
	state["day"] = int(state["day"]) + days
	for sh in db["shops"]:
		for e in sh["stock"]:
			var every := int(e.get("restock", 0))
			if every <= 0 or int(e["qty"]) == -1:
				continue
			var last := int(state["restocked"][sh["id"]].get(e["item"], 0))
			if int(state["day"]) - last >= every:
				state["stock"][sh["id"]][e["item"]] = max(int(state["stock"][sh["id"]].get(e["item"], 0)), int(e["qty"]))
				state["restocked"][sh["id"]][e["item"]] = int(state["day"])
	changed.emit()


func can_craft(recipe_id: String, times: int = 1) -> Dictionary:
	if not recipes.has(recipe_id):
		return _fail("unknown_recipe")
	var r: Dictionary = recipes[recipe_id]
	for e in r["inputs"]:
		if not has(e["item"], int(e["n"]) * times):
			return _fail("missing:" + str(e["item"]))
	var saved := state.duplicate(true)
	for e in r["inputs"]:
		remove(e["item"], int(e["n"]) * times)
	var full := false
	for e in r["outputs"]:
		if add(e["item"], int(e["n"]) * times) > 0:
			full = true
	state = saved
	if full:
		return _fail("inventory_full")
	var outs: Array = []
	for e in r["outputs"]:
		outs.append({"item": e["item"], "n": int(e["n"]) * times})
	return _ok({"items": outs})


func craft(recipe_id: String, times: int = 1) -> Dictionary:
	var check := can_craft(recipe_id, times)
	if not check["ok"]:
		return check
	var r: Dictionary = recipes[recipe_id]
	for e in r["inputs"]:
		remove(e["item"], int(e["n"]) * times)
	for e in r["outputs"]:
		add(e["item"], int(e["n"]) * times)
	return check


# ---- mulberry32, bit-for-bit with the TypeScript engine ----
var _rng_a := 0


func _rng_next() -> float:
	_rng_a = (_rng_a + 0x6D2B79F5) & 0xFFFFFFFF
	var t := _rng_a
	t = _imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
	return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


func _imul(a: int, b: int) -> int:
	# low 32 bits of a*b without 64-bit overflow surprises
	var ah := (a >> 16) & 0xFFFF
	var al := a & 0xFFFF
	var bh := (b >> 16) & 0xFFFF
	var bl := b & 0xFFFF
	return (al * bl + (((ah * bl + al * bh) & 0xFFFF) << 16)) & 0xFFFFFFFF


func _rint(lo: int, hi: int) -> int:
	return lo + int(floor(_rng_next() * float(hi - lo + 1)))


## Deterministic roll: same seed, same drop as the TypeScript engine and the Pixi runtime.
func roll_loot(table_id: String, seed: int) -> Array:
	var t: Dictionary = loot_tables[table_id]
	_rng_a = seed & 0xFFFFFFFF
	var rolls := 0
	if t["rolls"] is Array:
		rolls = _rint(int(t["rolls"][0]), int(t["rolls"][1]))
	else:
		rolls = int(t["rolls"])
	var total := 0.0
	for e in t["entries"]:
		total += float(e["weight"])
	var out: Array = []
	for i in rolls:
		var r := _rng_next() * total
		var pick: Dictionary = t["entries"][t["entries"].size() - 1]
		for e in t["entries"]:
			if r < float(e["weight"]):
				pick = e
				break
			r -= float(e["weight"])
		var mn := int(pick.get("min", 1))
		var n := _rint(mn, int(pick.get("max", mn)))
		if pick.has("item"):
			_push(out, pick["item"], n)
	for g in t.get("guaranteed", []):
		_push(out, g["item"], int(g["n"]))
	return out


func _push(out: Array, id: String, n: int) -> void:
	for o in out:
		if o["item"] == id:
			o["n"] += n
			return
	out.append({"item": id, "n": n})


func loot(table_id: String, seed: int) -> Dictionary:
	var got := roll_loot(table_id, seed)
	var lost: Array = []
	for s in got:
		if add(s["item"], int(s["n"])) > 0:
			lost.append(s["item"])
	if lost.size() > 0:
		return _fail("inventory_full:" + ",".join(PackedStringArray(lost)))
	return _ok({"items": got})
