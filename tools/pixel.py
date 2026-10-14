"""Make a 16-bit style pixel-art icon for every project (used by the arcade site).

For each src/projects/<slug>.json without an icon at src/arcade/px/<slug>.png, this reads the
project's cover photo and turns it into a 32x32 sprite with a limited palette:
  - photos on a plain background become a cut-out sprite with a dark outline
  - busy photos (rooms, scenes) become a little framed "cartridge" tile
Icons already in src/arcade/px/ are never overwritten, so you can replace any of them with
hand-drawn art: just save a PNG with the project's file name there.
Run:  python3 tools/pixel.py          (add --force to regenerate everything)
"""
import os, sys, json, glob
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(SRC, "arcade", "px")
N = 32          # sprite size in pixels
COLORS = 14     # palette size per icon

try:
    from PIL import Image, ImageOps, ImageEnhance, ImageDraw
    Image.MAX_IMAGE_PIXELS = None
except ImportError:
    print("pixel.py: Pillow not installed, skipping")
    sys.exit(0)

INK = (17, 17, 17, 255)


def sources_for(p, slug):
    out = []
    if p.get("icon_from"):
        f = os.path.join(SRC, p["icon_from"].lstrip("/"))
        if os.path.exists(f):
            return [f]
    for c in [p.get("cover")] + list(p.get("images") or [])[:14]:
        if not c:
            continue
        f = os.path.join(SRC, c.lstrip("/"))
        if os.path.exists(f) and f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")) and f not in out:
            out.append(f)
    r = os.path.join(ROOT, ".sizes", "raster", slug + ".png")  # rasterized SVG cover, if made
    if os.path.exists(r):
        out.append(r)
    return out


def load(f):
    im = ImageOps.exif_transpose(Image.open(f))
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        im = bg
    im = im.convert("RGB")
    im.thumbnail((1400, 1400))
    return im


def pick(files):
    """Prefer a product shot on a plain background; otherwise the cover as a tile."""
    best = None
    for f in files:
        try:
            im = load(f)
        except Exception:
            continue
        bgc, spread = border_stats(im)
        if spread >= 22:
            continue
        box = subject_box(im, bgc)
        if not box:
            continue
        frac = ((box[2] - box[0]) * (box[3] - box[1])) / (im.size[0] * im.size[1])
        if not 0.04 < frac < 1.3:
            continue
        score = 1 - abs(frac - 0.35) - spread / 60 + (0.15 if lum(bgc) > 150 else 0)
        if not best or score > best[0]:
            best = (score, im, bgc, box)
    return best


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def border_stats(im):
    w, h = im.size
    px = im.load()
    pts = [px[x, 0] for x in range(0, w, max(1, w // 60))] + [px[x, h - 1] for x in range(0, w, max(1, w // 60))]
    pts += [px[0, y] for y in range(0, h, max(1, h // 60))] + [px[w - 1, y] for y in range(0, h, max(1, h // 60))]
    avg = tuple(sum(c[i] for c in pts) / len(pts) for i in range(3))
    var = sum((lum(c) - lum(avg)) ** 2 for c in pts) / len(pts)
    return avg, var ** 0.5


def dist(a, b):
    return sum((a[i] - b[i]) ** 2 for i in range(3)) ** 0.5


def subject_box(im, bg, thr=38):
    small = im.copy()
    small.thumbnail((320, 320))
    w, h = small.size
    px = small.load()
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if dist(px[x, y], bg) > thr:
                xs.append(x); ys.append(y)
    if len(xs) < 40:
        return None
    k = im.size[0] / w
    x0, x1, y0, y1 = min(xs) * k, max(xs) * k, min(ys) * k, max(ys) * k
    side = max(x1 - x0, y1 - y0) * 1.1
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)


def crop_box_padded(im, box, fill):
    x0, y0, x1, y1 = [round(v) for v in box]
    side = x1 - x0
    canvas = Image.new("RGB", (side, y1 - y0), tuple(int(v) for v in fill))
    canvas.paste(im, (-x0, -y0))
    return canvas


def punch(im):
    im = ImageEnhance.Color(im).enhance(1.35)
    im = ImageEnhance.Contrast(im).enhance(1.2)
    return im


def quantize(im):
    q = im.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    return q.convert("RGB")


def sprite(im, bg):
    """Cut-out sprite with a 1px dark outline on a transparent canvas."""
    small = quantize(punch(im.resize((N, N), Image.LANCZOS)))
    px = small.load()
    # background = pixels close to the bg colour that touch the border (flood fill)
    isbg = [[dist(px[x, y], bg) < 46 for x in range(N)] for y in range(N)]
    seen = [[False] * N for _ in range(N)]
    dq = deque([(x, y) for x in range(N) for y in (0, N - 1)] + [(x, y) for y in range(N) for x in (0, N - 1)])
    while dq:
        x, y = dq.popleft()
        if not (0 <= x < N and 0 <= y < N) or seen[y][x] or not isbg[y][x]:
            continue
        seen[y][x] = True
        dq.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    S = N + 4
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    op = out.load()
    solid = [[not seen[y][x] for x in range(N)] for y in range(N)]
    total = sum(map(sum, solid))
    if total < N * N * 0.08:   # cut-out failed: fall back to a tile
        return None
    # one solid shape reads as a sprite; scattered fragments don't
    seen2 = [[False] * N for _ in range(N)]
    biggest = 0
    for sy in range(N):
        for sx in range(N):
            if solid[sy][sx] and not seen2[sy][sx]:
                n, st = 0, [(sx, sy)]
                seen2[sy][sx] = True
                while st:
                    x, y = st.pop(); n += 1
                    for xx, yy in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1), (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1)):
                        if 0 <= xx < N and 0 <= yy < N and solid[yy][xx] and not seen2[yy][xx]:
                            seen2[yy][xx] = True; st.append((xx, yy))
                biggest = max(biggest, n)
    if biggest < total * 0.8:
        return None
    for y in range(N):
        for x in range(N):
            if solid[y][x]:
                op[x + 2, y + 2] = px[x, y] + (255,)
    # outline
    for y in range(S):
        for x in range(S):
            if op[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < S and 0 <= yy < S and op[xx, yy][3] == 255 and op[xx, yy] != INK:
                    op[x, y] = INK
                    break
    return out


def tile(im):
    """Busy photo: a framed cartridge tile."""
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    small = quantize(punch(im.resize((N - 4, N - 4), Image.LANCZOS)))
    S = N + 4
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    d.rectangle((1, 1, S - 2, S - 2), fill=(238, 238, 234, 255), outline=INK)   # shell
    d.rectangle((3, 3, S - 4, S - 4), fill=INK)
    out.paste(small, (4, 4))
    d.point([(S - 4, 2), (S - 3, 2)], fill=(255, 79, 0, 255))  # orange tab, top right
    return out


def letters(title):
    S = N + 4
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    d.rectangle((1, 1, S - 2, S - 2), fill=(238, 238, 234, 255), outline=INK)
    d.text((6, 11), "".join(w[0] for w in title.split()[:2]).upper(), fill=INK)
    return out


def make(path, force=False):
    slug = os.path.splitext(os.path.basename(path))[0]
    dst = os.path.join(OUT, slug + ".png")
    if os.path.exists(dst) and not force:
        return False
    p = json.load(open(path))
    files = sources_for(p, slug)
    icon = None
    best = pick(files)
    if best:
        _, im, bgc, box = best
        sub = crop_box_padded(im, box, bgc)
        icon = sprite(sub, bgc) or tile(sub)
    if icon is None and files:
        icon = tile(load(files[0]))
    if icon is None:
        icon = letters(p.get("title", slug))
    os.makedirs(OUT, exist_ok=True)
    icon.save(dst)
    return True


if __name__ == "__main__":
    force = "--force" in sys.argv
    made = sum(make(f, force) for f in sorted(glob.glob(os.path.join(SRC, "projects", "*.json"))))
    print(f"pixel.py: {made} icons made")
