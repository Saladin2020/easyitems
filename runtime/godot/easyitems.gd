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
signal skill_level_up(skill: String, level: int)

const DB_PATH := "res://easyitems/db.json"

var db: Dictionary = {}
var items: Dictionary = {}
var shops: Dictionary = {}
var recipes: Dictionary = {}
var loot_tables: Dictionary = {}
var state: Dictionary = {}
## Life skills: { xp: { skill: int }, plots: { plot: { crop, planted, water, last } } } — save with life_to_dict().
var life: Dictionary = {"xp": {}, "plots": {}}


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


# ---------- life skills (same rules as src/shared/skills.ts and LifeSkills in easyitems-core.js) ----------
func _find(list_key: String, id: String) -> Variant:
	for x in db.get(list_key, []):
		if x["id"] == id:
			return x
	return null


func xp_for_level(sk, level: int) -> int:
	var base := 20 if sk == null else int(sk.get("xpBase", 20))
	return base * (level - 1) * level / 2


func skill_xp(id: String) -> int:
	return int(life["xp"].get(id, 0))


func skill_level(id: String) -> int:
	var sk = _find("skills", id)
	var mx := 10 if sk == null else int(sk.get("maxLevel", 10))
	var xp := skill_xp(id)
	var l := 1
	while l < mx and xp >= xp_for_level(sk, l + 1):
		l += 1
	return l


## { level, xp, into, need } for an XP bar.
func skill_progress(id: String) -> Dictionary:
	var sk = _find("skills", id)
	var mx := 10 if sk == null else int(sk.get("maxLevel", 10))
	var lv := skill_level(id)
	var lo := xp_for_level(sk, lv)
	return {"level": lv, "xp": skill_xp(id), "into": skill_xp(id) - lo, "need": 0 if lv >= mx else xp_for_level(sk, lv + 1) - lo}


func gain_xp(id: String, n: int) -> Dictionary:
	var before := skill_level(id)
	life["xp"][id] = skill_xp(id) + n
	var lv := skill_level(id)
	if lv > before:
		skill_level_up.emit(id, lv)
	return {"skill": id, "xp": n, "level": lv, "levelUp": lv > before}


func plant(plot: String, crop_id: String, day: int, season = null) -> Dictionary:
	var c = _find("crops", crop_id)
	if c == null:
		return _fail("unknown_crop")
	if life["plots"].has(plot):
		return _fail("plot_busy")
	if season != null and c.has("seasons") and not (c["seasons"] as Array).has(season):
		return _fail("wrong_season")
	if not has(c["seed"], 1):
		return _fail("missing:" + str(c["seed"]))
	remove(c["seed"], 1)
	life["plots"][plot] = {"crop": c["id"], "planted": day, "water": 0, "last": -1}
	return _ok(gain_xp("farming", 1))


func water(plot: String, day: int) -> Dictionary:
	if not life["plots"].has(plot):
		return _fail("empty_plot")
	var p: Dictionary = life["plots"][plot]
	if int(p["last"]) == day:
		return _fail("already_watered")
	p["last"] = day
	p["water"] = int(p["water"]) + 1
	return _ok()


## Start of a day: rain / storm (Easy NPC WEATHER_INFO.waters) water every plot. Returns how many.
func new_day(day: int, rained: bool) -> int:
	var n := 0
	if rained:
		var ids: Array = life["plots"].keys()
		ids.sort()
		for id in ids:
			if water(id, day)["ok"]:
				n += 1
	return n


func growth(plot: String) -> float:
	if not life["plots"].has(plot):
		return 0.0
	var p: Dictionary = life["plots"][plot]
	var c = _find("crops", p["crop"])
	return 0.0 if c == null else minf(1.0, float(p["water"]) / float(c["days"]))


func harvest(plot: String, seed: int) -> Dictionary:
	if not life["plots"].has(plot):
		return _fail("empty_plot")
	var p: Dictionary = life["plots"][plot]
	var c = _find("crops", p["crop"])
	if int(p["water"]) < int(c["days"]):
		return _fail("not_ready")
	var y: Array = c.get("yield", [1, 2])
	_rng_a = seed & 0xFFFFFFFF
	var n := _rint(int(y[0]), int(y[1])) + (skill_level("farming") - 1) / 3
	if add(c["produce"], n) > 0:
		return _fail("inventory_full")
	life["plots"].erase(plot)
	var r := _ok(gain_xp("farming", int(c.get("xp", 5))))
	r["items"] = [{"item": c["produce"], "n": n}]
	return r


func bite_chance(spot_id: String, weather_mult := 1.0) -> float:
	var s = _find("fishing", spot_id)
	if s == null:
		return 0.0
	return minf(0.95, float(s.get("bite", 0.6)) * (1.0 + 0.05 * float(skill_level("fishing") - 1)) * weather_mult)


func fish(spot_id: String, seed: int, weather_mult := 1.0) -> Dictionary:
	var s = _find("fishing", spot_id)
	if s == null:
		return _fail("unknown_spot")
	if skill_level("fishing") < int(s.get("minLevel", 1)):
		return _fail("level_low:%d" % int(s["minLevel"]))
	if s.has("tool") and not has(s["tool"], 1):
		return _fail("missing:" + str(s["tool"]))
	_rng_a = seed & 0xFFFFFFFF
	if _rng_next() >= bite_chance(spot_id, weather_mult):
		var miss := _fail("no_bite")
		miss.merge(gain_xp("fishing", 1))
		return miss
	var got := roll_loot(s["loot"], seed + 1)
	for it in got:
		if add(it["item"], int(it["n"])) > 0:
			return _fail("inventory_full")
	var r := _ok(gain_xp("fishing", int(s.get("xp", 5))))
	r["items"] = got
	r["bite"] = true
	return r


func can_cook(recipe_id: String) -> Dictionary:
	if not recipes.has(recipe_id):
		return _fail("unknown_recipe")
	var r: Dictionary = recipes[recipe_id]
	if r.has("skill") and skill_level(r["skill"]) < int(r.get("level", 1)):
		return _fail("level_low:%d" % int(r["level"]))
	return can_craft(recipe_id, 1)


func cook(recipe_id: String, times: int = 1) -> Dictionary:
	if not recipes.has(recipe_id):
		return _fail("unknown_recipe")
	var r: Dictionary = recipes[recipe_id]
	if r.has("skill") and skill_level(r["skill"]) < int(r.get("level", 1)):
		return _fail("level_low:%d" % int(r["level"]))
	var c := craft(recipe_id, times)
	if not c["ok"]:
		return c
	if r.has("skill"):
		c.merge(gain_xp(r["skill"], int(r.get("xp", 5)) * times), true)
	return c


func life_to_dict() -> Dictionary:
	return life.duplicate(true)


func life_from_dict(d: Dictionary) -> void:
	life = {"xp": {}, "plots": {}}
	for k in d.get("xp", {}).keys():
		life["xp"][str(k)] = int(d["xp"][k])
	for k in d.get("plots", {}).keys():
		var p: Dictionary = d["plots"][k]
		life["plots"][str(k)] = {"crop": str(p["crop"]), "planted": int(p["planted"]), "water": int(p["water"]), "last": int(p["last"])}
