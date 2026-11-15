"""Labelled contact sheet of every item icon on the teak palette.

  python3 scripts/contact-sheet.py <png-export-dir> <out.png> [scale=3] [cols=6]

Reads <dir>/easyitems.json (written by `easyitems export --preset png`) and <dir>/icons/<id>.png.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

SRC, OUT = sys.argv[1], sys.argv[2]
K = int(sys.argv[3]) if len(sys.argv) > 3 else 3
COLS = int(sys.argv[4]) if len(sys.argv) > 4 else 6
FONT_DIRS = [os.path.join(os.path.dirname(__file__), "..", "assets", "fonts"), "/usr/share/fonts/truetype/sand-box/google/Kanit"]
def font(name, size):
    for d in FONT_DIRS:
        p = os.path.join(d, name)
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

man = json.load(open(os.path.join(SRC, "easyitems.json")))
items = man["items"]
TEAK, SLOT, INK, CREAM, GOLD, MUTED = (46, 32, 20), (32, 22, 14), (26, 18, 11), (246, 231, 200), (244, 174, 61), (184, 160, 128)
size = man["atlas"]["size"] if "size" in man["atlas"] else Image.open(os.path.join(SRC, items[0]["png"])).width
CW, CH, PAD = max(170, size * K + 24), size * K + 76, 16
rows = (len(items) + COLS - 1) // COLS
W, H = PAD * 2 + COLS * (CW + 6), PAD * 2 + 64 + rows * (CH + 6)
sheet = Image.new("RGBA", (W, H), TEAK + (255,))
d = ImageDraw.Draw(sheet)
fT, fN, fS = font("Kanit-Medium.ttf", 26), font("Kanit-Medium.ttf", 16), font("Kanit-Regular.ttf", 12)
d.text((PAD, PAD), f"Easy Items · {len(items)} starter items · {size}px icons ×{K}", font=fT, fill=GOLD)
for i, it in enumerate(items):
    x, y = PAD + (i % COLS) * (CW + 6), PAD + 64 + (i // COLS) * (CH + 6)
    d.rectangle([x, y, x + CW, y + CH], fill=INK)
    d.rectangle([x + 1, y + 1, x + CW - 1, y + CH - 1], fill=SLOT)
    im = Image.open(os.path.join(SRC, it["png"])).convert("RGBA")
    im = im.resize((im.width * K, im.height * K), Image.NEAREST)
    sheet.alpha_composite(im, (x + (CW - im.width) // 2, y + 8))
    ty = y + 12 + im.height
    d.text((x + CW // 2, ty), it["name"]["th"], font=fN, fill=CREAM, anchor="mt")
    d.text((x + CW // 2, ty + 22), it["name"]["en"], font=fS, fill=MUTED, anchor="mt")
    d.text((x + CW // 2, ty + 38), it["id"], font=fS, fill=GOLD, anchor="mt")
sheet.convert("RGB").save(OUT)
print(OUT, sheet.size)
