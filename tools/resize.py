"""Make web-sized copies of every image so visitors only download what their screen needs.

Reads src/images/** (your full-resolution originals) and writes WebP copies at a few widths
into .sizes/images/** . build.js picks them up automatically. Re-runs skip files already done.
Cloudflare runs this on every build (Pillow comes from requirements.txt).
If Pillow isn't installed this exits quietly and the site still works using the originals.
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "images")
OUT = os.path.join(ROOT, ".sizes", "images")
WIDTHS = [800, 1600, 2560]   # sharp on phones, laptops and large/retina screens
EXTS = (".jpg", ".jpeg", ".png", ".webp")

try:
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = None
except ImportError:
    print("resize.py: Pillow not installed, skipping (site will use original images)")
    sys.exit(0)


def jobs():
    for d, _, files in os.walk(SRC):
        for f in files:
            if f.lower().endswith(EXTS):
                yield os.path.join(d, f)


def flatten(im):
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (6, 7, 8))
        bg.paste(im, mask=im.split()[3])
        return bg
    return im.convert("RGB")


def work(path):
    rel = os.path.relpath(path, SRC)
    base = os.path.splitext(rel)[0]
    made = 0
    try:
        with Image.open(path) as im:
            w, h = im.size
            # Copies at each width smaller than the original, plus one at the original's own
            # width when it is no bigger than the largest size (so every image gets a WebP).
            targets = [t for t in WIDTHS if t < w] + ([w] if w <= WIDTHS[-1] else [])
            todo = []
            for tw in sorted(set(targets)):
                out = os.path.join(OUT, f"{base}-{tw}.webp")
                if not (os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(path)):
                    todo.append((tw, out))
            if not todo:
                return 0
            im = flatten(ImageOps.exif_transpose(im))
            for tw, out in todo:
                os.makedirs(os.path.dirname(out), exist_ok=True)
                copy = im if tw == w else im.resize((tw, round(h * tw / w)), Image.LANCZOS)
                copy.save(out, "WEBP", quality=86 if tw >= 2000 else 82, method=4)
                made += 1
    except Exception as e:  # a bad file shouldn't break the whole site
        print(f"resize.py: skipped {rel}: {e}")
    return made


def edge(path):
    """Average colour of an image's outer border, so a letterboxed photo can sit on a matching background."""
    try:
        with Image.open(path) as im:
            im.draft("RGB", (256, 256))
            im = flatten(ImageOps.exif_transpose(im))
            im.thumbnail((128, 128))
            w, h = im.size
            px = im.load()
            ring = [px[x, y] for x in range(w) for y in (0, 1, h - 2, h - 1)] + [px[x, y] for y in range(h) for x in (0, 1, w - 2, w - 1)]
            # most common border colour (not the average, so a shadow or a product touching the edge doesn't tint it)
            bins = {}
            for c in ring:
                k = tuple(v // 6 for v in c)
                bins.setdefault(k, []).append(c)
            top = max(bins.values(), key=len)
            return "#%02x%02x%02x" % tuple(round(sum(c[i] for c in top) / len(top)) for i in range(3))
    except Exception:
        return None


if __name__ == "__main__":
    import json
    files = list(jobs())
    with ProcessPoolExecutor() as pool:
        total = sum(pool.map(work, files, chunksize=4))
    meta_path = os.path.join(ROOT, ".sizes", "meta.json")
    try:
        meta = json.load(open(meta_path))
    except Exception:
        meta = {}
    todo = [f for f in files if meta.get(os.path.relpath(f, SRC).replace(os.sep, "/"), {}).get("mtime") != os.path.getmtime(f) or meta.get(os.path.relpath(f, SRC).replace(os.sep, "/"), {}).get("v") != 2]
    with ProcessPoolExecutor() as pool:
        for f, e in zip(todo, pool.map(edge, todo, chunksize=4)):
            meta[os.path.relpath(f, SRC).replace(os.sep, "/")] = {"mtime": os.path.getmtime(f), "edge": e, "v": 2}
    os.makedirs(os.path.dirname(meta_path), exist_ok=True)
    json.dump(meta, open(meta_path, "w"))
    print(f"resize.py: {len(files)} images checked, {total} sizes made")
