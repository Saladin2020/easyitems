@tool
class_name EasyShop
extends Resource
## One Easy Items shop (generated). Stock rows: {"item", "qty" (-1 = unlimited), "price"?, "restock"?}.

@export var id: String = ""
@export var name_th: String = ""
@export var name_en: String = ""
@export var keeper: String = ""
@export var buy_mod: float = 1.0
@export var sell_mod: float = 0.5
@export var halal: bool = false
@export var stock: Array = []
