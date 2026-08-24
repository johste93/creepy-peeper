"""Turn harvested favicons into camera decals, and pick each company's band colour.

Favicons come in two shapes, and they want opposite treatment on the barrel:

  1. A mark on a solid brand-coloured tile (Adobe, Criteo, Taboola, Yahoo).
     The tile IS the brand colour, so it becomes the band, and the mark is
     lifted off it as a white silhouette — which is exactly how a real camera
     would be printed.

  2. A coloured mark on white or nothing (Google, TikTok, Magnite).
     Here the mark carries the colour, so it keeps its own colours and rides a
     white plate, and the band takes the mark's dominant colour.

Everything is trimmed to the mark's bounding box and written to icons/brands/ as
a 44px PNG — twice the 22px it is drawn at, so it stays crisp on a retina
display. They are files rather than data: URIs because a page's own CSP applies
to anything a content script injects into its DOM, and extension-origin URLs are
the only thing exempt from it.
"""
import colorsys, io, json, glob, os, re, shutil, sys
from iconnorm import to_png, NoRasteriser
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAND = os.path.join(ROOT, "data/candidates")
OUT_PX = 44

# Two modes, because icons/brands/ is not committed (see tools/fetch-logos.mjs).
#
#   default    curation. Reads the harvest in data/candidates/batch-*.json,
#              decides each mark's treatment from its pixels, and writes both
#              icons/brands/ and data/decals.json.
#   --restore  rebuild. Reads data/candidates/restore.json, which fetch-logos
#              populated from the URLs already recorded in data/decals.json,
#              and writes only icons/brands/. data/decals.json is committed and
#              authoritative in this mode, so it is never overwritten: a fetch
#              that half-failed must not be able to erase the manifest.
RESTORE = "--restore" in sys.argv

def lum(c):
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255

def sat(c):
    return colorsys.rgb_to_hls(*[v / 255 for v in c[:3]])[2]

def border_bg(im):
    """The tile colour, if the icon sits on a solid one."""
    w, h = im.size
    px = im.load()
    ring = []
    for x in range(w):
        ring += [px[x, 0], px[x, h - 1]]
    for y in range(h):
        ring += [px[0, y], px[w - 1, y]]
    opaque = [p for p in ring if p[3] > 200]
    if len(opaque) < 0.7 * len(ring):
        return None                      # transparent edges: no tile
    avg = tuple(sum(p[i] for p in opaque) // len(opaque) for i in range(3))
    spread = max(
        max(abs(p[i] - avg[i]) for i in range(3)) for p in opaque
    )
    return avg if spread < 40 else None  # noisy edge: a photo, not a tile

def dominant(im, skip=None):
    """Most saturation-weighted colour with real area."""
    buckets = {}
    for p in im.getdata():
        if p[3] < 128:
            continue
        if skip and max(abs(p[i] - skip[i]) for i in range(3)) < 36:
            continue
        h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in p[:3]])
        if s < 0.15 or l > 0.95 or l < 0.05:
            continue
        k = (round(h * 24), round(s * 3), round(l * 3))
        e = buckets.setdefault(k, [0, 0, 0, 0])
        for i in range(3):
            e[i] += p[i]
        e[3] += 1
    if not buckets:
        return None
    _, e = max(buckets.items(), key=lambda kv: kv[1][3] * (0.4 + kv[0][1] / 3))
    return tuple(e[i] // e[3] for i in range(3))

def is_blob(mask):
    """True when a silhouette fills most of its own bounding box.

    That is what a plain circle or rounded square looks like, and it is how the
    tile-knockout fails: some favicons draw a white plate with the glyph cut
    back out of it in the tile's own colour, so removing the tile removes the
    glyph and leaves the plate. Real logo shapes come in well under this.
    """
    bx = mask.getbbox()
    if not bx:
        return False
    area = (bx[2] - bx[0]) * (bx[3] - bx[1])
    ink = sum(1 for v in mask.crop(bx).getdata() if v > 140)
    return bool(area) and ink / area > 0.72

def is_featureless(im):
    """True when a mark carries no shape information worth printing.

    Some sites serve a placeholder favicon — Criteo, Piano and Cxense all ship a
    plain white circle on a tile — and extracting it faithfully produces a blank
    disc on the barrel. That reads as a rendering fault. A monogram of the
    company's name is more informative than a featureless blob, so reject these
    and let the fallback take over.
    """
    bx = im.getbbox()
    if not bx:
        return True
    inner = im.crop(bx)
    if not is_blob(inner.getchannel("A")):
        return False              # a real silhouette; its outline is the detail

    # It is a solid blob, so the only thing that can make it a logo is contrast
    # *inside* the shape. Look at the middle 60%, well clear of the anti-aliased
    # rim — a plain disc is flat there, a mark is not.
    w, h = inner.size
    core = inner.crop((int(w * 0.2), int(h * 0.2), int(w * 0.8), int(h * 0.8)))
    lums = [lum(p) for p in core.getdata() if p[3] > 200]
    if len(lums) < 16:
        return True
    return max(lums) - min(lums) < 0.22

def mark_lum(path):
    """Mean luminance of a mark's opaque pixels."""
    im = Image.open(path).convert("RGBA")
    op = [p for p in im.getdata() if p[3] > 140]
    return sum(lum(p) for p in op) / len(op) if op else 0.0

# A plate is a white disc behind the mark. It rescues a dark or multi-coloured
# logo that would be lost against a dark band, and ruins a pale one — which is
# the same disc the mark then vanishes into. So the mark gets whichever backdrop
# it contrasts with more, and if neither is good enough the band is darkened
# until it is. That guarantees a legible decal instead of picking a lesser evil.
# tools/build-brands.mjs enforces 0.34 as the floor. Aim above it so a decal
# that lands exactly on the line cannot fail the build on a rounding difference.
MIN_CONTRAST = 0.38

def set_lum(band_hex, target):
    """Move a colour to a target relative luminance, keeping its hue.

    HLS lightness is not luminance: a yellow at lightness 0.26 still reads as
    bright, which is why setting lightness directly left New Relic's green and
    Mercado Livre's gold barely separated from a white mark. Bisect on lightness
    against the luminance we actually care about instead.
    """
    h, l0, sa = colorsys.rgb_to_hls(*[int(band_hex.lstrip("#")[i:i + 2], 16) / 255
                                      for i in (0, 2, 4)])
    sa = max(sa, 0.42)
    lo, hi = 0.0, 1.0
    for _ in range(24):
        mid = (lo + hi) / 2
        rgb = colorsys.hls_to_rgb(h, mid, sa)
        if lum(tuple(v * 255 for v in rgb)) < target:
            lo = mid
        else:
            hi = mid
    return hexc(tuple(round(v * 255) for v in colorsys.hls_to_rgb(h, (lo + hi) / 2, sa)))

def hex_lum(h):
    h = h.lstrip("#")
    return lum(tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)))

def backdrop_for(mark_path, band_hex):
    """-> (plate, band_hex). Both may change to keep the mark readable."""
    m = mark_lum(mark_path)
    on_band = abs(m - hex_lum(band_hex))
    on_plate = abs(m - 1.0)
    if max(on_band, on_plate) >= MIN_CONTRAST:
        return ("plated circle", band_hex) if on_plate > on_band else ("", band_hex)

    # Neither backdrop separates the mark. Push the band away from the mark's
    # own luminance, keeping its hue, and drop the plate.
    return "", set_lum(band_hex, 0.16 if m > 0.5 else 0.86)

def trim(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im

def square(im, px=OUT_PX):
    im = trim(im)
    w, h = im.size
    s = max(w, h)
    pad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    pad.paste(im, ((s - w) // 2, (s - h) // 2))
    return pad.resize((px, px), Image.LANCZOS)

BRANDS = os.path.join(ROOT, "icons/brands")

def write_png(im, name):
    """PNG-8 with an alpha channel. Logos use few colours, so quantising to 64
    is visually free and roughly thirds the size on disk."""
    # FASTOCTREE is the only method Pillow will quantise RGBA with.
    q = im.quantize(colors=64, method=Image.FASTOCTREE, dither=Image.NONE)
    buf = io.BytesIO()
    q.save(buf, format="PNG", optimize=True)
    small = buf.getvalue()
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    full = buf.getvalue()
    best = small if len(small) < len(full) else full
    # Ids can hold dots and the "~" that marks a company-less tracker; keep the
    # filename to a plain slug so it is safe in a URL and on any filesystem.
    rel = "icons/brands/" + re.sub(r"[^a-z0-9_-]+", "-", name.lower()) + ".png"
    open(os.path.join(ROOT, rel), "wb").write(best)
    return rel, len(best)

def mean_lum(im):
    px = [p for p in im.getdata() if p[3] > 140]
    return sum(lum(p) for p in px) / len(px) if px else 0

def whiten(im):
    """Keep the shape, drop the colour — a printed white decal."""
    a = im.getchannel("A")
    out = Image.new("RGBA", im.size, (255, 255, 255, 0))
    out.putalpha(a)
    return out

def hexc(c):
    return "#%02X%02X%02X" % tuple(c)

def build(path, ident):
    im = Image.open(path).convert("RGBA")
    bg = border_bg(im)

    if bg is not None and (sat(bg) > 0.2 or lum(bg) < 0.35):
        # Case 1: a mark on a brand-coloured tile. Knock the tile out and keep
        # the silhouette, painted white so it reads on the band.
        w, h = im.size
        px = im.load()
        mask = Image.new("L", (w, h), 0)
        mp = mask.load()
        for y in range(h):
            for x in range(w):
                p = px[x, y]
                d = max(abs(p[i] - bg[i]) for i in range(3))
                if p[3] > 100 and d > 44:
                    mp[x, y] = min(255, int(p[3] * min(1.0, d / 110)))
        if mask.getbbox() is None:
            return None

        # Some tiles hold a plain white circle or rounded square with the glyph
        # cut back out of it in the tile's own colour. Knocking the tile out
        # then leaves that blank shape and loses the logo entirely. A silhouette
        # that fills most of its own bounding box is what that looks like, so
        # keep the artwork as drawn instead and let it ride a plate.
        if is_blob(mask):
            bx = mask.getbbox()
            keep = Image.new("RGBA", im.size, (0, 0, 0, 0))
            keep.paste(im.crop(bx), (bx[0], bx[1]))
            if is_featureless(keep):
                return None
            return {"band": hexc(bg), "palette": [hexc(bg)],
                    "mark": write_png(square(keep), ident)[0], "plate": "plated circle"}
        white = Image.new("RGBA", (w, h), (255, 255, 255, 0))
        white.putalpha(mask)
        ink = square(white)
        if sum(mask.getdata()) < 255 * 30:      # mark too thin to survive
            return None
        if is_featureless(ink):
            return None
        band = hexc(bg) if lum(bg) <= 0.72 else set_lum(hexc(bg), 0.42)
        return {"band": band, "palette": [band],
                "mark": write_png(ink, ident)[0], "plate": ""}

    # Case 2: a coloured mark on white or nothing. Drop the white background,
    # keep the mark's own colours, and give it a plate to sit on.
    w, h = im.size
    px = im.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if p[3] < 100:
                continue
            if bg is not None and max(abs(p[i] - bg[i]) for i in range(3)) < 30:
                continue
            op[x, y] = p
    if out.getbbox() is None:
        return None
    col = dominant(out)

    # A mark that is itself white would vanish on a white plate. It was drawn to
    # sit on a colour, so give it one: the tile it came from, or a neutral slate.
    if col is None or mean_lum(out) > 0.82:
        band = bg if bg is not None and lum(bg) < 0.8 else (61, 66, 77)
        # Same blob guard as the tile path: a silhouette that fills its own
        # bounding box is a plate with the glyph cut out of it, not a logo.
        if not is_blob(out.getchannel("A")):
            return {"band": hexc(band), "palette": [hexc(band)],
                    "mark": write_png(square(whiten(out)), ident)[0], "plate": ""}
        if is_featureless(out):
            return None
        return {"band": hexc(band), "palette": [hexc(band)],
                "mark": write_png(square(out), ident)[0], "plate": "plated circle"}

    # A near-white band would swallow the shell and leave nothing to read
    # against, so darken it until the mark has something to sit on.
    if lum(col) > 0.72:
        col = tuple(int(set_lum(hexc(col), 0.42).lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))

    if is_featureless(out):
        return None
    return {"band": hexc(col), "palette": [hexc(col)],
            "mark": write_png(square(out), ident)[0], "plate": "plated circle"}

shutil.rmtree(BRANDS, ignore_errors=True)
os.makedirs(BRANDS, exist_ok=True)

if RESTORE:
    manifest = os.path.join(CAND, "restore.json")
    if not os.path.exists(manifest):
        sys.exit("no data/candidates/restore.json — run node tools/fetch-logos.mjs first")
    rows = json.load(open(manifest))
    committed = json.load(open(os.path.join(ROOT, "data/decals.json")))
    # Curation feeds build() a 64px PNG that tools/icon-colors.py normalised,
    # and every extraction threshold below is tuned to that. Restore downloads
    # the original file, so it has to do the same normalisation before the
    # heuristics see it — otherwise the same logo extracts differently here
    # than it did during curation.
    normalised, unreadable = [], []
    for r in rows:
        d = os.path.join(CAND, r["id"])
        out = os.path.join(d, "restore64.png")
        try:
            to_png(os.path.join(d, r["png"]), out)
        except NoRasteriser:
            unreadable.append((r["id"], "needs rsvg-convert for SVG"))
            continue
        except Exception as ex:
            unreadable.append((r["id"], f"{type(ex).__name__}"))
            continue
        normalised.append({**r, "png": "restore64.png"})
    if unreadable:
        svg = sum(1 for _, w in unreadable if "rsvg" in w)
        if svg:
            print(f"note: {svg} SVG logos skipped — install librsvg for rsvg-convert")
    rows = normalised
else:
    rows = []
    for f in sorted(glob.glob(os.path.join(CAND, "batch-*.json")),
                    key=lambda p: int(p.rsplit("-", 1)[1].split(".")[0])):
        rows += json.load(open(f))
    committed = None

decals, skipped = {}, []
for r in rows:
    if not r.get("png"):
        skipped.append((r["id"], r.get("why", "no icon")))
        continue
    try:
        d = build(os.path.join(CAND, r["id"], r["png"]), r["id"])
    except Exception as ex:
        d = None
        r["why"] = f"{type(ex).__name__}: {ex}"
    if not d:
        skipped.append((r["id"], r.get("why", "mark did not survive extraction")))
        continue
    d["decalW"], d["decalH"] = 20, 20
    d["src"] = r.get("iconUrl")
    # How the mark is inked, so tools/build-brands.mjs can reject a white
    # silhouette paired with a white plate — which renders as nothing at all.
    d["plate"], d["band"] = backdrop_for(os.path.join(ROOT, d["mark"]), d["band"])
    d["palette"] = [d["band"]]
    # Recorded so tools/build-brands.mjs can apply the same contrast rule to a
    # hand-curated entry without needing to decode the PNG itself.
    d["markLum"] = round(mark_lum(os.path.join(ROOT, d["mark"])), 3)
    decals[r["id"]] = d

size = sum(os.path.getsize(os.path.join(ROOT, v["mark"])) for v in decals.values())

if RESTORE:
    print(f"icons/brands/: {len(decals)} of {len(rows)} logos rebuilt, "
          f"{size/1024:.0f} KB")
    # The committed manifest describes artwork we fetched rather than shipped,
    # so a company that has since redrawn its icon will rebuild to a different
    # colour or a different backdrop. That is not an error — it is the manifest
    # going stale — but it should be visible rather than silently applied.
    drift = [i for i, d in decals.items()
             if i in committed and (d["band"] != committed[i]["band"]
                                    or d["plate"] != committed[i]["plate"])]
    if drift:
        print(f"  {len(drift)} differ from data/decals.json (icon changed upstream):")
        for i in drift[:12]:
            print(f"    {i}: {committed[i]['band']}/{committed[i]['plate'] or 'flat'}"
                  f" -> {decals[i]['band']}/{decals[i]['plate'] or 'flat'}")
    gone = [i for i in committed if i not in decals]
    if gone:
        print(f"  {len(gone)} unavailable, falling back to a monogram")
else:
    json.dump(decals, open(os.path.join(ROOT, "data/decals.json"), "w"), indent=1)
    print(f"data/decals.json: {len(decals)} of {len(rows)} companies "
          f"({100*len(decals)//len(rows)}%), {size/1024:.0f} KB across "
          f"{len(decals)} files in icons/brands/")
    plated = sum(1 for v in decals.values() if v["plate"])
    print(f"  {len(decals)-plated} white-on-brand, {plated} coloured-on-plate")
    print(f"  {len(skipped)} fall back to a monogram")
