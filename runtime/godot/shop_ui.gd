extends Control
## Simple shop screen for the Items autoload: stock grid (icon, name, price, stock), the player's bag,
## coin count, buy / sell. Uses Easy UI's teak theme when res://easyui/themes/teak.tres exists in the
## project (export Easy UI into the same project), otherwise the bundled easyitems/theme.tres.
##
##   var ui := preload("res://easyitems/shop_ui.tscn").instantiate()
##   ui.shop_id = "raya_bazaar"; add_child(ui)

signal closed
signal traded(kind: String, item: String, result: Dictionary)

@export var shop_id: String = "market"
@export_enum("th", "en", "ms") var lang: String = "th"
@export var icon_scale: int = 2

const EASYUI_THEME := "res://easyui/themes/teak.tres"
const OWN_THEME := "res://easyitems/theme.tres"
const T := {
	"th": {"buy": "ซื้อ", "sell": "ขาย", "bag": "กระเป๋า", "coins": "เหรียญ", "close": "ปิด", "stock": "เหลือ", "inf": "∞", "not_enough_coins": "เหรียญไม่พอ", "out_of_stock": "ของหมด", "inventory_full": "กระเป๋าเต็ม", "shop_wont_buy": "ร้านนี้ไม่รับซื้อ", "ok_buy": "ซื้อแล้ว", "ok_sell": "ขายแล้ว"},
	"en": {"buy": "Buy", "sell": "Sell", "bag": "Bag", "coins": "coins", "close": "Close", "stock": "left", "inf": "∞", "not_enough_coins": "Not enough coins", "out_of_stock": "Sold out", "inventory_full": "Bag is full", "shop_wont_buy": "This shop won't buy that", "ok_buy": "Bought", "ok_sell": "Sold"},
	"ms": {"buy": "Beli", "sell": "Jual", "bag": "Beg", "coins": "syiling", "close": "Tutup", "stock": "baki", "inf": "∞", "not_enough_coins": "Syiling tidak cukup", "out_of_stock": "Habis dijual", "inventory_full": "Beg penuh", "shop_wont_buy": "Kedai ini tidak membeli itu", "ok_buy": "Dibeli", "ok_sell": "Dijual"},
}

var _grid: GridContainer
var _bag: GridContainer
var _title: Label
var _coins: Label
var _status: Label
var _detail: Label
var _selected := ""
var _items: Node


func _t(k: String) -> String:
	return T.get(lang, T["en"]).get(k, k)


func _ready() -> void:
	_items = get_node_or_null("/root/Items")
	if _items == null:
		push_error("Easy Items: add easyitems.gd as the 'Items' autoload")
		return
	if not _items.shops.has(shop_id):
		shop_id = _items.shops.keys()[0]
	theme = load(EASYUI_THEME) if ResourceLoader.exists(EASYUI_THEME) else load(OWN_THEME)
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_build()
	_items.changed.connect(_refresh)
	_refresh()


func _build() -> void:
	var panel := PanelContainer.new()
	panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	panel.offset_left = 8
	panel.offset_top = 8
	panel.offset_right = -8
	panel.offset_bottom = -8
	add_child(panel)
	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 4)
	panel.add_child(root)
	var head := HBoxContainer.new()
	root.add_child(head)
	_title = Label.new()
	_title.add_theme_font_size_override("font_size", 14)
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_title)
	var coin_icon := TextureRect.new()
	coin_icon.texture = load("res://easyitems/coin.tres")
	coin_icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	coin_icon.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
	head.add_child(coin_icon)
	_coins = Label.new()
	head.add_child(_coins)
	var close := Button.new()
	close.text = _t("close")
	close.pressed.connect(func(): closed.emit())
	head.add_child(close)
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(body)
	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.size_flags_stretch_ratio = 1.6
	body.add_child(scroll)
	_grid = GridContainer.new()
	_grid.columns = 4
	_grid.add_theme_constant_override("h_separation", 3)
	_grid.add_theme_constant_override("v_separation", 3)
	scroll.add_child(_grid)
	var side := VBoxContainer.new()
	side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_child(side)
	_detail = Label.new()
	_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_detail.custom_minimum_size = Vector2(0, 54)
	side.add_child(_detail)
	var buttons := HBoxContainer.new()
	side.add_child(buttons)
	var b := Button.new()
	b.text = _t("buy")
	b.name = "BuyButton"
	b.pressed.connect(func(): _trade("buy"))
	buttons.add_child(b)
	var s := Button.new()
	s.text = _t("sell")
	s.name = "SellButton"
	s.pressed.connect(func(): _trade("sell"))
	buttons.add_child(s)
	var bag_label := Label.new()
	bag_label.text = _t("bag")
	side.add_child(bag_label)
	_bag = GridContainer.new()
	_bag.columns = 6
	_bag.add_theme_constant_override("h_separation", 2)
	_bag.add_theme_constant_override("v_separation", 2)
	side.add_child(_bag)
	_status = Label.new()
	_status.add_theme_color_override("font_color", Color("#ffd27a"))
	root.add_child(_status)


func _tile(id: String, caption: String, sub: String, on_press: Callable) -> Button:
	var btn := Button.new()
	btn.toggle_mode = false
	btn.custom_minimum_size = Vector2(24 * icon_scale + 28, 24 * icon_scale + 26)
	btn.tooltip_text = _items.item_name(id, lang)
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 0)
	btn.add_child(v)
	var tr := TextureRect.new()
	tr.texture = _items.icon(id)
	tr.custom_minimum_size = Vector2(24 * icon_scale, 24 * icon_scale)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(tr)
	for text in [caption, sub]:
		if text == "":
			continue
		var l := Label.new()
		l.text = text
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.add_theme_font_size_override("font_size", 8)
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		v.add_child(l)
	btn.pressed.connect(on_press)
	if id == _selected:
		btn.modulate = Color(1.15, 1.05, 0.85)
	return btn


func _refresh() -> void:
	if _grid == null:
		return
	var sh: Dictionary = _items.shops[shop_id]
	_title.text = str(sh["name"].get(lang, sh["name"]["th"]))
	_coins.text = "%d %s" % [int(_items.state["coins"]), _t("coins")]
	for c in _grid.get_children():
		c.queue_free()
	for c in _bag.get_children():
		c.queue_free()
	for e in sh["stock"]:
		var id: String = e["item"]
		var q: int = _items.stock(shop_id, id)
		var qs: String = _t("inf") if q == -1 else str(q)
		_grid.add_child(_tile(id, "฿%d" % _items.buy_price(shop_id, id), "%s %s" % [_t("stock"), qs], _select.bind(id)))
	for s in _items.state["slots"]:
		if s == null:
			continue
		_bag.add_child(_tile(s["item"], "×%d" % int(s["n"]), "", _select.bind(s["item"])))
	_show_detail()


## Show another shop (keeps the language chosen before the node entered the tree).
func open(id: String) -> void:
	shop_id = id
	_selected = ""
	visible = true
	_refresh()


func _select(id: String) -> void:
	_selected = id
	_refresh()


func _show_detail() -> void:
	if _selected == "":
		_detail.text = ""
		return
	var it: Dictionary = _items.items[_selected]
	var desc: Dictionary = it.get("desc", {})
	var bp: int = _items.buy_price(shop_id, _selected)
	var sp: int = _items.sell_price(shop_id, _selected)
	var lines := [_items.item_name(_selected, lang)]
	if desc.size() > 0:
		lines.append(str(desc.get(lang, desc.get("en", ""))))
	lines.append("%s ฿%s · %s ฿%s" % [_t("buy"), str(bp) if bp >= 0 else "-", _t("sell"), str(sp) if sp >= 0 else "-"])
	_detail.text = "\n".join(PackedStringArray(lines))


func _trade(kind: String) -> void:
	if _selected == "":
		return
	var r: Dictionary = _items.buy(shop_id, _selected) if kind == "buy" else _items.sell(shop_id, _selected)
	_status.text = _t("ok_" + kind) if r["ok"] else _t(str(r["reason"]))
	traded.emit(kind, _selected, r)
	_refresh()
