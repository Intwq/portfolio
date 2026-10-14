"""8-bit cut-out sprites for every project (arcade site), drawn in code.

Each sprite is built from simple shapes on a 48x48 grid. Every shape has a material (a 4-tone
colour ramp) and a shading mode; the toolkit quantises the light to those 4 tones with a little
ordered dithering, then adds a hard black outline, the way NES/"Cyber Shadow" sprites are drawn.
Output: src/arcade/px/<slug>.png (52x52 with outline). Run: python3 tools/sprites8.py
A project without a hand-made sprite here still gets an automatic icon from tools/pixel.py.
"""
import os, math
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "arcade", "px")
N = 48
OUTLINE = (10, 8, 20)

def hx(s):
    s = s.lstrip("#"); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))

# 4-tone ramps (dark -> light), shadows leaning cool/purple
M = {k: [hx(c) for c in v.split()] for k, v in dict(
    steel="2a2846 56597e 9aa2c2 eef2ff",
    alu="34324f 6f7591 b2b9cf f6f8ff",
    dark="120f22 25213d 3f3a5e 6c6894",
    black="0d0b18 1c1930 2f2b4a 4f4a72",
    glass="12284a 1f5f8c 46b4dc c4f6ff",
    glassd="0f1d3a 17406a 2f7fb0 8fe0ff",
    orange="4a1400 a83400 ff6a14 ffc27a",
    red="3d0614 8f0f2a e0263f ff8a9a",
    gold="3a2000 8a5a00 e8b010 fff0a0",
    bronze="2e1a10 6a3f22 a8703a e2b07a",
    wood="2c160c 6a3518 a85e2c e0a060",
    white="4a4866 8e8cad cfcde4 ffffff",
    cream="5a4c48 a8988a e2d8c8 fffaf0",
    blue="0c1650 1d3fb0 3f80ff b0d4ff",
    sky="10306a 2f6fc0 6fb4f0 d6f0ff",
    teal="08302e 117a70 2ed6b8 b8fff0",
    cyan="0a2a40 0a7aa8 22e4ff c8ffff",
    pink="3a0830 9a1478 ff3fb4 ffb0e6",
    green="0a2a14 1e6b30 4cc35a c0ff9a",
    leaf="0c2410 22602a 46a840 a8f080",
    rust="2a0f08 6a2a12 b0582a e8a060",
    concrete="2e2c3c 5e5c70 9a98ac d8d6e6",
    marble="6a6880 aeacc4 e2e0f0 ffffff",
    coffee="1e0e06 4a2410 8a4a20 c8844a",
    red2="40081a 9a1a2a e83a3a ffb0a0",
    lime="1e3a08 4a8a10 9ae020 e8ff9a",
    onyx="1c1930 3a3562 6f6aaa cac6ff",
).items()}

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
LIGHT = (-0.55, -0.7, 0.45)


class Sprite:
    def __init__(self):
        self.mat = [[None] * N for _ in range(N)]
        self.tone = [[0] * N for _ in range(N)]
        self.pid = [[-1] * N for _ in range(N)]
        self.line = [[False] * N for _ in range(N)]
        self.n = 0
        self.pending = []

    # ---- coverage helpers ----
    def _cover_poly(self, pts):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        out = []
        for y in range(max(0, int(min(ys))), min(N, int(math.ceil(max(ys))) + 1)):
            for x in range(max(0, int(min(xs))), min(N, int(math.ceil(max(xs))) + 1)):
                if self._inside(pts, x + 0.5, y + 0.5):
                    out.append((x, y))
        return out

    @staticmethod
    def _inside(pts, x, y):
        c = False; j = len(pts) - 1
        for i in range(len(pts)):
            xi, yi = pts[i]; xj, yj = pts[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi:
                c = not c
            j = i
        return c

    # ---- shapes ----
    def rect(self, x0, y0, x1, y1, mat, mode="bevel", **k):
        self.poly([(x0, y0), (x1 + 1, y0), (x1 + 1, y1 + 1), (x0, y1 + 1)], mat, mode, **k)

    def ellipse(self, cx, cy, rx, ry, mat, mode="sphere", **k):
        pts = [(cx + rx * math.cos(a / 40 * 2 * math.pi), cy + ry * math.sin(a / 40 * 2 * math.pi)) for a in range(40)]
        self.poly(pts, mat, mode, **k)

    def bar(self, x0, y0, x1, y1, w, mat, mode="cyl", **k):
        dx, dy = x1 - x0, y1 - y0; d = math.hypot(dx, dy) or 1
        nx, ny = -dy / d * w / 2, dx / d * w / 2
        self.poly([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], mat, mode,
                  axis=(dx / d, dy / d), **k)

    def poly(self, pts, mat, mode="flat", tone=2, outline=True, axis=None, glint=True):
        cells = self._cover_poly(pts)
        if not cells:
            return
        xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
        bx0, bx1, by0, by1 = min(xs), max(xs), min(ys), max(ys)
        cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
        w, h = max(1, bx1 - bx0), max(1, by1 - by0)
        cs = set(cells)
        pid = self.n; self.n += 1
        for (x, y) in cells:
            u, v = (x - cx) / (w / 2 + 0.5), (y - cy) / (h / 2 + 0.5)
            if mode == "flat":
                L = tone / 3
            elif mode == "sphere":
                r2 = u * u + v * v
                nz = math.sqrt(max(0, 1 - min(1, r2)))
                L = max(0, -(u * LIGHT[0] + v * LIGHT[1]) * 0.75 + nz * LIGHT[2] * 1.2) * 0.95 + 0.08
                if glint and (u + 0.42) ** 2 + (v + 0.45) ** 2 < 0.03:
                    L = 1.2
            elif mode in ("cyl", "cylv", "cylh"):
                ax = axis or ((0, 1) if mode == "cylv" else (1, 0) if mode == "cylh" else (0, 1))
                t = (u * -ax[1] + v * ax[0]) if axis else (u if ax == (0, 1) else v)
                L = 0.92 - abs(t + 0.32) * 0.85
                if glint and abs(t + 0.42) < 0.12:
                    L = 1.15
            elif mode == "bevel":
                L = tone / 3
                if (x - 1, y) not in cs or (x, y - 1) not in cs:
                    L = min(1, tone / 3 + 0.34)
                if (x + 1, y) not in cs or (x, y + 1) not in cs:
                    L = max(0, tone / 3 - 0.36)
            elif mode == "vgrad":
                L = 0.95 - (v + 1) / 2 * 0.75
            elif mode == "hgrad":
                L = 0.95 - (u + 1) / 2 * 0.75
            elif mode == "glass":
                L = 0.42 + (-(u + v)) * 0.12
                d = (x - bx0) - (y - by0) * 0.9
                if glint and (d % 13 in (0, 1) and (y - by0) < h * 0.6) or ((x - bx0) + (y - by0)) % 17 == 0 and glint and (y - by0) < h * 0.4:
                    L = 1.15
                if (x + 1, y) not in cs or (x, y + 1) not in cs:
                    L = 0.55
            else:
                L = tone / 3
            q = L * 3 + (BAYER[y % 4][x % 4] / 16 - 0.5) * (0.28 if mode == "glass" else 0.42)
            t = max(0, min(3, int(round(q))))
            self.mat[y][x] = mat; self.tone[y][x] = t; self.pid[y][x] = pid
            self.line[y][x] = False
        if outline:
            for (x, y) in cells:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < N and 0 <= yy < N and self.pid[yy][xx] not in (-1, pid) and (xx, yy) not in cs:
                        self.line[y][x] = True
                        break

    def px(self, x, y, mat, tone):
        if 0 <= x < N and 0 <= y < N:
            self.mat[y][x] = mat; self.tone[y][x] = tone; self.line[y][x] = False
            if self.pid[y][x] == -1:
                self.pid[y][x] = self.n; self.n += 1

    def hline(self, x0, x1, y, mat, tone):
        for x in range(x0, x1 + 1):
            self.px(x, y, mat, tone)

    def vline(self, x, y0, y1, mat, tone):
        for y in range(y0, y1 + 1):
            self.px(x, y, mat, tone)

    def ink(self, x, y):
        self.px(x, y, "ink", 0)

    def save(self, slug):
        S = N + 4
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        p = img.load()
        for y in range(N):
            for x in range(N):
                m = self.mat[y][x]
                if m is None:
                    continue
                if m == "ink" or self.line[y][x]:
                    c = OUTLINE
                else:
                    c = M[m][self.tone[y][x]]
                p[x + 2, y + 2] = c + (255,)
        # exterior outline
        q = img.copy().load()
        for y in range(S):
            for x in range(S):
                if q[x, y][3]:
                    continue
                if any(0 <= x + dx < S and 0 <= y + dy < S and q[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    p[x, y] = OUTLINE + (255,)
        os.makedirs(OUT, exist_ok=True)
        img.save(os.path.join(OUT, slug + ".png"))


SPRITES = {}
def sprite(slug):
    def deco(fn):
        SPRITES[slug] = fn
        return fn
    return deco


# ===================================================================== C.R. Laurence
@sprite("turboflex")
def _(s):
    s.rect(9, 3, 38, 30, "glass", "glass")                       # glass panel
    s.poly([(4, 28), (43, 28), (43, 44), (4, 44)], "alu", "vgrad")  # base shoe body
    s.poly([(4, 26), (12, 26), (12, 30), (4, 30)], "alu", "bevel", tone=2)    # left lip
    s.poly([(35, 26), (43, 26), (43, 30), (35, 30)], "alu", "bevel", tone=2)  # right lip
    s.rect(13, 28, 34, 33, "dark", "flat", tone=0)                 # channel
    s.rect(15, 30, 32, 33, "orange", "bevel", tone=2)              # turbo clamp
    s.rect(22, 31, 25, 33, "dark", "flat", tone=1)
    for x in (9, 23, 37):
        s.ellipse(x, 39, 1.6, 1.6, "steel", "flat", tone=0)        # anchor bolts
    s.hline(5, 42, 35, "alu", 3)
    s.rect(4, 45, 43, 46, "concrete", "flat", tone=1, outline=False)


@sprite("drx-kits")
def _(s):
    s.rect(8, 2, 39, 27, "glass", "glass")
    s.rect(3, 26, 44, 38, "bronze", "vgrad")
    s.rect(3, 26, 6, 38, "dark", "bevel", tone=2); s.rect(41, 26, 44, 38, "dark", "bevel", tone=2)
    s.hline(7, 40, 31, "bronze", 3)
    s.rect(30, 30, 34, 34, "dark", "flat", tone=0)                 # lock
    s.ellipse(32, 32, 1, 1, "gold", "flat", tone=3, outline=False)
    s.rect(14, 40, 33, 46, "cream", "bevel", tone=2)               # kit box
    s.rect(16, 42, 21, 44, "orange", "flat", tone=2)
    s.hline(23, 31, 43, "dark", 1)


@sprite("modular-header")
def _(s):
    s.poly([(3, 18), (33, 6), (45, 12), (15, 24)], "black", "flat", tone=2)       # top face
    s.poly([(3, 18), (15, 24), (15, 34), (3, 28)], "black", "flat", tone=1)        # front
    s.poly([(15, 24), (45, 12), (45, 22), (15, 34)], "black", "vgrad")             # side
    s.poly([(6, 19), (31, 9), (40, 13), (15, 23)], "dark", "flat", tone=0)         # channel opening
    s.poly([(20, 36), (34, 30), (40, 33), (26, 39)], "steel", "flat", tone=2)       # splice
    s.poly([(20, 36), (26, 39), (26, 42), (20, 39)], "steel", "flat", tone=1)
    s.poly([(26, 39), (40, 33), (40, 36), (26, 42)], "steel", "flat", tone=0)
    s.rect(30, 40, 44, 45, "orange", "bevel", tone=2)               # drilling jig
    for x in (33, 37, 41):
        s.px(x, 42, "dark", 0)


@sprite("entice-hp-plus")
def _(s):
    s.rect(2, 1, 45, 46, "black", "bevel", tone=1)
    s.rect(5, 4, 22, 43, "glass", "glass"); s.rect(25, 4, 42, 43, "glass", "glass")
    s.bar(19, 14, 19, 32, 2.5, "steel"); s.bar(28, 14, 28, 32, 2.5, "steel")
    s.rect(5, 43, 42, 44, "orange", "flat", tone=2)                # drop seal
    s.rect(22, 4, 25, 43, "black", "flat", tone=0)                 # geared hinge meet


@sprite("entice-hp-plus-transom-sidelites")
def _(s):
    s.rect(0, 1, 47, 46, "black", "bevel", tone=1)
    s.rect(3, 4, 44, 12, "glass", "glass")
    s.rect(3, 15, 9, 43, "glass", "glass"); s.rect(38, 15, 44, 43, "glass", "glass")
    s.rect(12, 15, 22, 43, "glass", "glass"); s.rect(25, 15, 35, 43, "glass", "glass")
    s.bar(20, 22, 20, 36, 2, "steel"); s.bar(27, 22, 27, 36, 2, "steel")
    s.rect(12, 43, 35, 44, "orange", "flat", tone=2)


@sprite("fallbrook")
def _(s):
    s.rect(1, 6, 46, 44, "black", "bevel", tone=1)
    s.rect(4, 9, 14, 41, "glass", "glass"); s.rect(33, 9, 43, 41, "glass", "glass")
    s.rect(17, 9, 30, 41, "wood", "vgrad")
    s.vline(20, 10, 40, "wood", 1); s.vline(25, 10, 40, "wood", 3)
    s.rect(26, 23, 28, 26, "steel", "bevel", tone=2)
    for x0 in (1, 39):                                              # cut-to-length marks
        s.hline(x0, x0 + 7, 2, "orange", 2)
        s.vline(x0, 1, 3, "orange", 2); s.vline(x0 + 7, 1, 3, "orange", 2)
    s.bar(18, 45, 29, 45, 2, "orange", "flat", tone=2)


@sprite("floating-sliding-door")
def _(s):
    s.rect(4, 2, 46, 5, "steel", "bevel", tone=1)                   # hidden head track
    s.rect(15, 7, 41, 43, "glass", "glass")
    s.bar(37, 18, 37, 32, 2, "steel")
    for y, l in ((14, 7), (22, 10), (30, 6)):                       # motion streaks
        s.hline(2, 2 + l, y, "cyan", 2)
    s.hline(15, 41, 46, "cyan", 3)                                  # floating gap glow


@sprite("ladder-pulls")
def _(s):
    s.bar(14, 1, 14, 46, 6, "steel"); s.bar(33, 1, 33, 46, 6, "steel")
    for y in (10, 37):
        s.bar(17, y, 30, y, 4, "alu", "cylh")
        s.rect(22, y - 2, 25, y + 2, "orange", "bevel", tone=2)
    s.rect(11, 0, 17, 1, "alu", "flat", tone=3); s.rect(30, 0, 36, 1, "alu", "flat", tone=3)


@sprite("lat34-softbrake")
def _(s):
    s.rect(0, 3, 47, 9, "steel", "vgrad")                          # track
    s.rect(31, 5, 38, 8, "orange", "bevel", tone=2)                 # soft-brake inside the track
    for x in (12, 30):
        s.ellipse(x, 10, 4, 4, "black", "sphere")
        s.ellipse(x, 10, 1.3, 1.3, "steel", "flat", tone=3, outline=False)
        s.rect(x - 1, 13, x + 1, 17, "dark", "bevel", tone=2)
    s.rect(6, 17, 37, 45, "glass", "glass")
    s.bar(33, 24, 33, 38, 2, "black", "cyl")
    s.rect(40, 12, 46, 16, "orange", "flat", tone=1)                # stop


@sprite("s100-4track-corner-pocket")
def _(s):
    s.rect(0, 2, 47, 45, "dark", "bevel", tone=2)
    for i in range(4):
        x0 = 3 + i * 10
        s.rect(x0, 5 + (i % 2), x0 + 11, 41, "black", "flat", tone=1)
        s.rect(x0 + 2, 7 + (i % 2), x0 + 9, 39, "glass" if i % 2 == 0 else "glassd", "glass")
    s.rect(0, 42, 47, 45, "steel", "vgrad")
    for i in range(4):
        s.hline(4 + i * 10, 9 + i * 10, 44, "orange", 2)


@sprite("tdr-door-rail")
def _(s):
    s.rect(11, 2, 36, 22, "glass", "glass")
    s.poly([(1, 22), (46, 22), (41, 38), (6, 38)], "alu", "vgrad")
    s.hline(3, 44, 23, "alu", 3)
    s.ellipse(34, 30, 3.5, 3.5, "black", "sphere")
    s.rect(33, 28, 35, 32, "gold", "flat", tone=2, outline=False)
    s.hline(6, 41, 43, "orange", 2); s.vline(6, 41, 45, "orange", 2); s.vline(41, 41, 45, "orange", 2)


@sprite("geared-deadbolt")
def _(s):
    s.rect(4, 12, 30, 42, "steel", "bevel", tone=2)
    s.rect(30, 21, 46, 31, "alu", "vgrad")                          # bolt
    cx, cy = 17, 27
    for k in range(10):
        a = k * math.pi / 5
        s.ellipse(cx + 10 * math.cos(a), cy + 10 * math.sin(a), 2, 2, "orange", "flat", tone=1)
    s.ellipse(cx, cy, 9, 9, "orange", "sphere")
    s.ellipse(cx, cy, 3, 3, "dark", "flat", tone=0)
    s.rect(13, 1, 21, 11, "black", "bevel", tone=2)                 # thumb turn
    s.rect(15, 3, 19, 9, "steel", "flat", tone=2)


@sprite("top-latch-blumcraft")
def _(s):
    s.bar(24, 14, 24, 47, 14, "alu", "cyl")                          # rod housing
    s.rect(15, 4, 33, 16, "steel", "vgrad")                         # head
    s.rect(18, 1, 30, 6, "blue", "bevel", tone=2)                   # roller latch
    s.ellipse(24, 3.5, 3, 2, "black", "sphere")
    s.rect(15, 17, 33, 19, "black", "flat", tone=1)
    s.rect(34, 6, 40, 14, "dark", "bevel", tone=2)                  # back plate


# ===================================================================== design work
@sprite("aga-t-mini-genesis")
def _(s):
    s.bar(6, 42, 40, 8, 10, "pink", "cyl")                           # body
    s.ellipse(28, 20, 13, 13, "cyan", "sphere")                      # disc
    s.ellipse(28, 20, 4, 4, "dark", "flat", tone=0)
    s.bar(30, 18, 44, 4, 4, "pink", "cyl")                           # mouthpiece
    s.ellipse(44, 4, 3, 3, "cyan", "sphere")
    s.bar(8, 40, 3, 45, 7, "dark", "cyl")


@sprite("candle-holder")
def _(s):
    s.poly([(4, 40), (40, 40), (44, 46), (8, 46)], "gold", "vgrad")
    s.poly([(28, 14), (40, 14), (40, 40), (28, 40)], "gold", "hgrad")
    for y in (18, 23, 28, 33):
        s.hline(31, 38, y, "gold", 0)
    s.poly([(8, 20), (26, 20), (26, 40), (8, 40)], "gold", "bevel", tone=2)
    s.bar(17, 8, 17, 24, 11, "lime", "cyl")                          # candle
    s.ellipse(17, 5, 2, 3.5, "orange", "flat", tone=3)
    s.px(17, 3, "gold", 3)


@sprite("cbd-inhaler-social-media")
def _(s):
    s.bar(24, 14, 24, 46, 22, "white", "cyl")
    s.rect(13, 22, 34, 36, "teal", "bevel", tone=2)                  # label
    s.hline(16, 31, 26, "white", 3); s.hline(16, 27, 29, "white", 2)
    s.rect(17, 3, 30, 14, "black", "vgrad")                         # cap
    s.rect(20, 0, 27, 3, "orange", "bevel", tone=2)


@sprite("coral-form-study")
def _(s):
    import random
    r = random.Random(4)
    for k in range(9):
        cx, cy = 8 + r.random() * 32, 10 + r.random() * 30
        s.ellipse(cx, cy, 5 + r.random() * 5, 3 + r.random() * 4, "onyx", "sphere")
    for k in range(7):
        a = -0.4 - k * 0.38
        x1, y1 = 24 + 21 * math.cos(a), 30 + 22 * math.sin(a)
        s.bar(24, 44, x1, y1, 4, "onyx", "cyl")
        s.ellipse(x1, y1, 3, 3, "onyx", "sphere")


@sprite("dispenser")
def _(s):
    s.poly([(2, 30), (46, 30), (46, 47), (2, 47)], "blue", "vgrad")  # blue plinth
    s.poly([(8, 32), (14, 10), (24, 4), (34, 10), (40, 32)], "white", "hgrad")   # dome
    s.ellipse(24, 32, 16, 4, "white", "flat", tone=1)
    s.poly([(17, 14), (31, 14), (28, 22), (20, 22)], "white", "flat", tone=1)    # funnel
    s.ellipse(24, 20, 3, 2, "dark", "flat", tone=0)
    s.rect(30, 26, 33, 27, "cyan", "flat", tone=3)                  # sensor


@sprite("facial-scrubber")
def _(s):
    s.ellipse(24, 26, 14, 20, "white", "sphere")                   # egg-shaped body
    s.poly([(10, 12), (38, 12), (38, 20), (24, 23), (10, 20)], "red", "vgrad")   # red crown
    s.ellipse(24, 7, 9, 5, "red", "sphere")
    s.ellipse(24, 33, 7, 6, "concrete", "flat", tone=1)            # silicone brush pad
    for (x, y) in ((21, 31), (24, 30), (27, 31), (20, 34), (23, 34), (26, 34), (29, 34), (22, 37), (25, 37)):
        s.px(x, y, "concrete", 3)
    s.rect(30, 24, 32, 26, "white", "flat", tone=1)


@sprite("fictional-mafia-movie-posters")
def _(s):
    s.rect(6, 1, 41, 46, "red", "flat", tone=2)
    s.ellipse(23, 17, 11, 11, "white", "flat", tone=3)               # clock face
    for k in range(12):
        a = k * math.pi / 6
        s.px(int(23 + 9 * math.cos(a)), int(17 + 9 * math.sin(a)), "dark", 0)
    s.bar(23, 17, 23, 10, 1.5, "black", "flat", tone=0); s.bar(23, 17, 29, 19, 1.5, "black", "flat", tone=0)
    s.poly([(10, 33), (30, 33), (30, 37), (18, 37), (16, 42), (12, 42), (13, 37), (10, 37)], "black", "flat", tone=1)  # pistol
    for y in (32, 35, 38, 41):
        s.hline(33, 38, y, "white", 3)


@sprite("flowerpot-d-x-oa")
def _(s):
    s.poly([(4, 42), (30, 26), (34, 28), (8, 44)], "glass", "glass")  # bent acrylic
    s.poly([(30, 26), (44, 26), (44, 29), (34, 28)], "glass", "glass")
    s.poly([(18, 22), (36, 22), (33, 34), (21, 34)], "blue", "vgrad")  # pot
    s.rect(17, 20, 37, 22, "blue", "flat", tone=3)
    for (x, y, rx, ry) in ((27, 12, 6, 5), (21, 15, 5, 4), (33, 16, 5, 4), (27, 7, 3, 3)):
        s.ellipse(x, y, rx, ry, "leaf", "sphere")
    s.vline(27, 16, 20, "wood", 1)


@sprite("fountain")
def _(s):
    s.poly([(6, 46), (16, 14), (30, 14), (40, 46)], "concrete", "hgrad")
    s.poly([(16, 14), (30, 14), (34, 8), (12, 8)], "concrete", "flat", tone=3)
    s.rect(18, 9, 28, 12, "steel", "flat", tone=1)                   # basin
    for t in range(12):                                             # water arc
        x = 22 + t * 1.2; y = 9 - math.sin(t / 11 * math.pi) * 7
        s.px(int(x), int(y), "cyan", 3 if t % 3 else 2)
    s.rect(19, 24, 27, 38, "dark", "flat", tone=1)
    s.hline(20, 26, 28, "cyan", 2); s.hline(20, 26, 32, "cyan", 1)


@sprite("isl-tlc-waterfall-countertops")
def _(s):
    s.rect(2, 10, 45, 15, "marble", "flat", tone=2)                 # countertop
    s.rect(2, 10, 6, 46, "marble", "hgrad")                         # waterfall edge
    s.rect(7, 16, 45, 46, "white", "bevel", tone=2)
    s.vline(26, 16, 46, "white", 0)
    s.hline(7, 45, 22, "white", 0)
    for x in (16, 36):
        s.bar(x, 26, x, 36, 2, "black", "flat", tone=1)
    s.bar(14, 19, 20, 19, 1.5, "black", "flat", tone=1); s.bar(32, 19, 38, 19, 1.5, "black", "flat", tone=1)
    for x in (13, 28, 37):
        s.px(x, 12, "marble", 0)


@sprite("jar")
def _(s):
    s.ellipse(24, 28, 19, 18, "glass", "glass")
    import random
    r = random.Random(7)
    for k in range(18):                                              # beans
        x, y = 10 + r.random() * 28, 26 + r.random() * 16
        if (x - 24) ** 2 / 19 ** 2 + (y - 28) ** 2 / 18 ** 2 < 0.8:
            s.ellipse(x, y, 2, 1.4, "coffee", "flat", tone=2, outline=False)
            s.px(int(x), int(y), "coffee", 0)
    s.ellipse(24, 9, 12, 4, "white", "flat", tone=3)                 # lid
    s.ellipse(24, 8, 7, 2, "red2", "flat", tone=2)
    s.ellipse(17, 20, 2, 4, "glass", "flat", tone=3, outline=False)


@sprite("module")
def _(s):
    s.poly([(4, 20), (36, 8), (46, 16), (14, 30)], "blue", "flat", tone=3)
    s.poly([(4, 20), (14, 30), (14, 46), (4, 36)], "blue", "flat", tone=1)
    s.poly([(14, 30), (46, 16), (46, 32), (14, 46)], "blue", "vgrad")
    s.ellipse(25, 17, 8, 4, "white", "flat", tone=3)                 # cylinder top
    s.rect(17, 17, 33, 26, "white", "cyl")
    s.ellipse(25, 26, 8, 3, "white", "flat", tone=1)


@sprite("motech-products")
def _(s):
    s.ellipse(24, 9, 10, 9, "steel", "flat", tone=1)                 # round mirror
    s.ellipse(24, 9, 8, 7, "sky", "glass")
    s.rect(4, 22, 43, 25, "white", "flat", tone=3)                   # top
    s.ellipse(24, 23, 7, 1.5, "white", "flat", tone=1)
    s.bar(24, 23, 24, 17, 1.5, "gold", "flat", tone=2)
    s.rect(5, 26, 42, 44, "wood", "bevel", tone=2)
    s.vline(23, 26, 44, "wood", 0); s.hline(5, 42, 32, "wood", 0)
    for x in (14, 33):
        s.hline(x - 3, x + 3, 29, "gold", 3)
    s.rect(6, 45, 8, 47, "dark", "flat", tone=1); s.rect(39, 45, 41, 47, "dark", "flat", tone=1)


@sprite("pendulus")
def _(s):
    s.ellipse(30, 14, 14, 13, "glassd", "glass")                     # disc shade
    s.ellipse(30, 14, 3, 3, "dark", "flat", tone=0)
    s.bar(30, 16, 22, 34, 4, "white", "cyl")                         # arm
    s.rect(6, 34, 26, 44, "white", "bevel", tone=2)                  # base box
    s.rect(8, 36, 11, 38, "red", "flat", tone=2)
    for t in range(10):                                             # cord
        s.px(26 + t * 2, 42 - int(math.sin(t / 3) * 2), "steel", 2)


@sprite("planter")
def _(s):
    s.ellipse(30, 15, 14, 13, "red", "sphere")
    s.poly([(4, 30), (26, 26), (30, 44), (10, 46)], "white", "hgrad")
    s.ellipse(17, 28, 11, 4, "dark", "flat", tone=0)                 # opening
    s.ellipse(17, 26, 4, 3, "leaf", "sphere")


@sprite("roll-dispenser")
def _(s):
    s.poly([(3, 6), (44, 6), (44, 14), (3, 14)], "red2", "vgrad")     # coral bracket
    s.rect(3, 6, 7, 32, "red2", "hgrad"); s.rect(40, 6, 44, 32, "red2", "hgrad")
    s.bar(8, 23, 39, 23, 15, "white", "cylh")                         # roll
    s.poly([(10, 30), (24, 30), (22, 47), (12, 46)], "white", "flat", tone=2)   # sheet
    s.hline(12, 22, 38, "white", 1)


@sprite("sculptural-works")
def _(s):
    s.poly([(2, 30), (20, 10), (46, 34), (40, 40), (20, 26), (6, 36)], "rust", "hgrad")
    s.poly([(6, 36), (20, 26), (40, 40), (36, 42), (20, 32), (8, 40)], "rust", "flat", tone=0)
    s.bar(14, 22, 33, 30, 2, "red", "cyl")
    for (x, y) in ((22, 17), (28, 24), (12, 30), (34, 31)):
        s.px(x, y, "rust", 3)
    s.rect(4, 43, 44, 46, "cream", "flat", tone=2)


@sprite("sd-v21-explorations")
def _(s):
    s.ellipse(24, 16, 20, 7, "leaf", "sphere")                        # grass top
    s.poly([(5, 17), (43, 17), (32, 32), (24, 42), (14, 32)], "rust", "hgrad")
    s.ellipse(15, 8, 5, 6, "leaf", "sphere"); s.ellipse(32, 6, 6, 7, "leaf", "sphere")
    s.vline(15, 12, 15, "wood", 1); s.vline(32, 11, 14, "wood", 1)
    for y in range(18, 46):                                          # waterfall
        s.px(38 + (y % 2), y, "cyan", 3 if y % 3 else 2)
    s.ellipse(9, 30, 3, 2, "pink", "flat", tone=2)


@sprite("sdxl-exploration")
def _(s):
    s.poly([(4, 30), (24, 22), (44, 30), (24, 38)], "concrete", "flat", tone=1)
    for (x, y, w, h) in ((8, 20, 14, 10), (20, 10, 12, 14), (28, 18, 14, 10), (14, 2, 10, 10)):
        s.poly([(x, y + 4), (x + w / 2, y), (x + w, y + 4), (x + w / 2, y + 8)], "white", "flat", tone=3)
        s.poly([(x, y + 4), (x + w / 2, y + 8), (x + w / 2, y + 8 + h), (x, y + 4 + h)], "white", "flat", tone=2)
        s.poly([(x + w / 2, y + 8), (x + w, y + 4), (x + w, y + 4 + h), (x + w / 2, y + 8 + h)], "white", "flat", tone=1)
    s.rect(26, 30, 28, 33, "cyan", "flat", tone=2)


@sprite("shop-thermostat")
def _(s):
    s.rect(4, 4, 43, 43, "black", "bevel", tone=2)
    s.rect(9, 9, 38, 30, "dark", "flat", tone=0)
    seg = {"7": ["111", "001", "001", "010", "010"], "6": ["111", "100", "111", "101", "111"]}
    for i, ch in enumerate("76"):                                    # 7-segment "76"
        for yy, row in enumerate(seg[ch]):
            for xx, b in enumerate(row):
                if b == "1":
                    s.rect(13 + i * 12 + xx * 3, 12 + yy * 3, 14 + i * 12 + xx * 3, 13 + yy * 3, "orange", "flat", tone=3, outline=False)
    s.ellipse(24, 37, 4, 3, "steel", "sphere")
    s.rect(4, 0, 43, 3, "wood", "flat", tone=2)


@sprite("silverware")
def _(s):
    s.bar(12, 46, 12, 18, 4, "bronze", "cyl")                         # fork
    for x in (9, 11, 13, 15):
        s.bar(x, 18, x, 4, 1.4, "bronze", "flat", tone=2)
    s.bar(24, 46, 24, 20, 4, "steel", "cyl")                          # knife
    s.poly([(22, 20), (27, 20), (27, 4), (22, 8)], "steel", "hgrad")
    s.bar(36, 46, 36, 20, 4, "bronze", "cyl")                         # spoon
    s.ellipse(36, 11, 6, 9, "bronze", "sphere")


@sprite("sputnik-speaker")
def _(s):
    for k in range(5):                                               # twisted lattice stand
        y = 30 + k * 3.4
        s.bar(10 + (k % 2) * 4, y, 38 - (k % 2) * 4, y + 3, 3, "blue", "cyl")
    s.bar(14, 46, 34, 46, 3, "dark", "flat", tone=1)
    s.ellipse(24, 16, 15, 15, "white", "sphere")
    s.ellipse(20, 16, 7, 7, "black", "sphere")                        # driver
    s.ellipse(20, 16, 2.5, 2.5, "steel", "sphere")
    s.bar(36, 22, 43, 26, 2, "dark", "flat", tone=1)


@sprite("workshop-stool")
def _(s):
    s.poly([(6, 6), (42, 6), (42, 14), (14, 14), (14, 34), (42, 34), (42, 42), (6, 42)], "white", "bevel", tone=2)
    s.poly([(42, 6), (46, 9), (46, 45), (42, 42)], "white", "flat", tone=1)
    for y in (20, 26):
        s.bar(14, y, 42, y, 2.5, "steel", "cylh")
    s.rect(18, 9, 30, 11, "dark", "flat", tone=0)                    # handle slot
    s.rect(6, 43, 46, 46, "red", "flat", tone=1)


if __name__ == "__main__":
    for slug, fn in SPRITES.items():
        s = Sprite(); fn(s); s.save(slug)
    print(f"sprites8.py: {len(SPRITES)} sprites written")
