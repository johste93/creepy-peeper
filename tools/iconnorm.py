"""Normalise a harvested icon to a 64px RGBA PNG.

Shared by tools/icon-colors.py (curation) and tools/build-decals.py --restore
(rebuild), and it has to stay one function: the extraction heuristics in
build-decals.py — how thin a mark can be, whether a silhouette counts as a
blob — are all tuned against 64px input. Feeding one path a raw 512px icon and
the other a resampled 64px one makes the two disagree about the same logo.
"""
import subprocess
from PIL import Image

PX = 64

class NoRasteriser(Exception):
    """rsvg-convert is not installed, so an SVG source cannot be read."""

def to_png(src, dst, px=PX):
    if src.endswith(".svg"):
        try:
            subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), src, "-o", dst],
                           check=True, capture_output=True)
        except FileNotFoundError:
            raise NoRasteriser("rsvg-convert not found")
        return dst
    im = Image.open(src)
    # .ico files hold several sizes; take the largest frame available.
    if getattr(im, "n_frames", 1) > 1:
        best, area = im, 0
        for i in range(im.n_frames):
            im.seek(i)
            if im.size[0] * im.size[1] > area:
                area, best = im.size[0] * im.size[1], im.copy()
        im = best
    im.convert("RGBA").resize((px, px), Image.LANCZOS).save(dst)
    return dst
