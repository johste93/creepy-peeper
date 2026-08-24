"""Normalise harvested icons to 64px PNG and pull a brand colour out of each.

The colour that matters is the one a person would name if you showed them the
logo: the most saturated colour with real area, not the average (which turns
every logo into mud) and not the most common (which is usually the background).
"""
import json, os, sys, colorsys
from PIL import Image
from iconnorm import to_png

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAND = os.path.join(ROOT, "data/candidates")
batch = sys.argv[1] if len(sys.argv) > 1 else "1"

def brand_color(png):
    im = Image.open(png).convert("RGBA")
    buckets = {}
    for r, g, b, a in im.getdata():
        if a < 128:
            continue
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        # Near-white and near-black are chrome, not brand.
        if s < 0.18 or l > 0.94 or l < 0.06:
            continue
        key = (round(h * 24), round(s * 4), round(l * 4))
        e = buckets.setdefault(key, [0, 0, 0, 0])
        e[0] += r; e[1] += g; e[2] += b; e[3] += 1
    if not buckets:
        # Wholly monochrome mark: fall back to its darkest real pixel.
        px = [(r, g, b) for r, g, b, a in im.getdata() if a >= 128]
        if not px:
            return None
        r, g, b = min(px, key=sum)
        return "#%02X%02X%02X" % (r, g, b)
    # Weight area by saturation so a small vivid mark beats a large muted wash.
    def score(kv):
        (h, s, l), e = kv
        return e[3] * (0.4 + s / 4)
    (_, e) = max(buckets.items(), key=score)
    return "#%02X%02X%02X" % (e[0] // e[3], e[1] // e[3], e[2] // e[3])

rows = json.load(open(os.path.join(CAND, f"batch-{batch}.json")))
out = []
for r in rows:
    if not r.get("ok"):
        out.append(r); continue
    d = os.path.join(CAND, r["id"])
    src, dst = os.path.join(d, r["icon"]), os.path.join(d, "icon64.png")
    try:
        to_png(src, dst)
        r["color"] = brand_color(dst)
        r["png"] = "icon64.png"
    except Exception as ex:
        r["ok"] = False
        r["why"] = f"convert failed: {type(ex).__name__}"
    out.append(r)
json.dump(out, open(os.path.join(CAND, f"batch-{batch}.json"), "w"), indent=1)
good = [r for r in out if r.get("color")]
print(f"batch {batch}: {len(good)}/{len(out)} normalised with a colour")
for r in out:
    if not r.get("ok"):
        print(f"  miss  {r['id']} — {r.get('why')}")
