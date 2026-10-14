"""Hand-built 16-bit sprites for the C.R. Laurence product launches (arcade site).
Run once: python3 tools/crl_sprites.py   (writes src/arcade/px/<slug>.png)"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "arcade", "px")
INK = (17, 17, 17, 255)
C = dict(
    g1=(214, 238, 242, 255), g2=(170, 214, 224, 255), g3=(128, 186, 201, 255), gh=(250, 255, 255, 255),
    a1=(232, 234, 236, 255), a2=(196, 200, 205, 255), a3=(146, 152, 160, 255), a4=(96, 102, 110, 255),
    k1=(70, 70, 72, 255), k2=(42, 42, 44, 255), o=(255, 79, 0, 255), o2=(255, 140, 70, 255),
    w1=(196, 140, 92, 255), w2=(160, 104, 62, 255), w3=(118, 74, 42, 255), br=(120, 92, 60, 255),
)


def canvas():
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def glass(d, x0, y0, x1, y1):
    d.rectangle((x0, y0, x1, y1), fill=C["g1"])
    d.rectangle((x1 - 1, y0, x1, y1), fill=C["g2"])
    d.rectangle((x0, y1 - 1, x1, y1), fill=C["g2"])
    for k in range(4, (x1 - x0), 9):                       # diagonal glints, kept inside the pane
        for t in range(6):
            x, y = x0 + k - t, y0 + 1 + t
            if x0 < x < x1 - 1 and y0 < y < y1 - 1:
                d.point((x, y), fill=C["gh"])
    d.point((x0 + 1, y0 + 1), fill=C["gh"])


def finish(im, slug):
    S = 36
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(im, (2, 2), im)
    p = out.load()
    for y in range(S):
        for x in range(S):
            if p[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < S and 0 <= yy < S and p[xx, yy][3] == 255 and p[xx, yy] != INK:
                    p[x, y] = INK
                    break
    os.makedirs(OUT, exist_ok=True)
    out.save(os.path.join(OUT, slug + ".png"))


def turboflex():
    im, d = canvas()
    glass(d, 7, 1, 24, 21)
    d.rectangle((4, 19, 27, 29), fill=C["a2"])                 # base shoe
    d.rectangle((4, 19, 27, 20), fill=C["a1"])
    d.rectangle((4, 28, 27, 29), fill=C["a4"])
    d.rectangle((26, 19, 27, 29), fill=C["a3"])
    d.rectangle((10, 19, 21, 22), fill=C["k2"])                # clamp slot
    d.rectangle((12, 23, 19, 24), fill=C["o"])                 # turbo clamp
    for x in (7, 15, 23):
        d.point((x, 26), fill=C["a4"])
    return im


def drx():
    im, d = canvas()
    glass(d, 6, 1, 25, 19)
    d.rectangle((2, 18, 29, 27), fill=C["br"])                 # bronze rail
    d.rectangle((2, 18, 29, 19), fill=(160, 128, 90, 255))
    d.rectangle((2, 26, 29, 27), fill=(84, 64, 42, 255))
    d.rectangle((2, 18, 3, 27), fill=C["k1"]); d.rectangle((28, 18, 29, 27), fill=C["k1"])
    d.rectangle((13, 29, 18, 30), fill=C["o"])                 # "1 kit" tag
    return im


def tdr():
    im, d = canvas()
    glass(d, 9, 1, 22, 15)
    d.polygon([(1, 16), (30, 16), (27, 26), (4, 26)], fill=C["a2"])   # tapered rail
    d.line((1, 16, 30, 16), fill=C["a1"])
    d.line((4, 26, 27, 26), fill=C["a4"])
    d.line((28, 18, 27, 24), fill=C["a3"])
    d.ellipse((20, 19, 24, 23), fill=C["k2"]); d.point((22, 21), fill=C["o"])   # lock
    d.rectangle((6, 28, 25, 29), fill=C["k1"])                 # 36-3/4" dimension bar
    d.point((6, 27), fill=C["k1"]); d.point((25, 27), fill=C["k1"])
    return im


def entice():
    im, d = canvas()
    d.rectangle((2, 1, 29, 30), fill=C["k2"])
    glass(d, 4, 3, 15, 28); glass(d, 17, 3, 27, 28)
    d.rectangle((13, 10, 13, 21), fill=C["a1"]); d.rectangle((19, 10, 19, 21), fill=C["a1"])
    d.rectangle((4, 29, 27, 30), fill=C["o"])                  # drop seal
    return im


def entice_ts():
    im, d = canvas()
    d.rectangle((0, 1, 31, 30), fill=C["k2"])
    glass(d, 2, 3, 29, 8)                                       # transom
    glass(d, 2, 10, 6, 28); glass(d, 25, 10, 29, 28)            # sidelites
    glass(d, 8, 10, 15, 28); glass(d, 17, 10, 23, 28)
    d.line((14, 15, 14, 22), fill=C["a1"]); d.line((18, 15, 18, 22), fill=C["a1"])
    d.point((30, 2), fill=C["o"])
    return im


def fallbrook():
    im, d = canvas()
    d.rectangle((0, 3, 31, 29), fill=C["k2"])
    glass(d, 2, 5, 9, 27); glass(d, 22, 5, 29, 27)
    d.rectangle((11, 5, 20, 27), fill=C["w2"])                 # door
    d.rectangle((11, 5, 12, 27), fill=C["w1"]); d.rectangle((19, 5, 20, 27), fill=C["w3"])
    d.rectangle((17, 15, 18, 17), fill=C["a1"])
    d.line((0, 1, 6, 1), fill=C["o"]); d.line((25, 1, 31, 1), fill=C["o"])   # cut marks
    d.line((0, 0, 0, 2), fill=C["o"]); d.line((31, 0, 31, 2), fill=C["o"])
    return im


def floating():
    im, d = canvas()
    d.rectangle((0, 1, 31, 3), fill=C["a3"])                   # hidden track above
    glass(d, 9, 5, 25, 27)
    d.line((26, 6, 26, 26), fill=C["a1"])
    for y, l in ((10, 5), (15, 7), (20, 4)):                   # motion lines
        d.line((1, y, 1 + l, y), fill=C["a3"])
    d.rectangle((9, 30, 25, 30), fill=C["o"])                  # floor gap glow
    return im


def ladder():
    im, d = canvas()
    for x in (7, 21):
        d.rectangle((x, 0, x + 4, 31), fill=C["a2"])
        d.rectangle((x, 0, x + 1, 31), fill=C["a1"])
        d.rectangle((x + 4, 0, x + 4, 31), fill=C["a4"])
    for y in (6, 24):
        d.rectangle((12, y, 20, y + 2), fill=C["a3"])
        d.rectangle((15, y, 16, y + 2), fill=C["o"])
    return im


def lat34():
    im, d = canvas()
    d.rectangle((0, 2, 31, 6), fill=C["a3"]); d.rectangle((0, 2, 31, 3), fill=C["a1"])
    d.rectangle((22, 3, 27, 5), fill=C["o"])                   # soft-brake in track
    for x in (8, 19):
        d.ellipse((x - 2, 4, x + 2, 8), fill=C["k2"]); d.rectangle((x - 1, 8, x, 11), fill=C["k1"])
    glass(d, 4, 11, 23, 30)
    d.line((21, 17, 21, 24), fill=C["k1"])
    return im


def s100():
    im, d = canvas()
    d.rectangle((0, 2, 31, 29), fill=C["k1"])
    tones = [C["g1"], C["g2"], C["g1"], C["g2"]]
    for i in range(4):
        x0 = 2 + i * 7
        d.rectangle((x0, 4 + (i % 2), x0 + 7, 27), fill=C["k2"])
        d.rectangle((x0 + 1, 5 + (i % 2), x0 + 6, 26), fill=tones[i])
        d.point((x0 + 2, 6 + (i % 2)), fill=C["gh"])
    d.rectangle((0, 28, 31, 29), fill=C["a2"])
    for i in range(4):
        d.point((3 + i * 7, 30), fill=C["o"])                  # four tracks
    return im


def deadbolt():
    im, d = canvas()
    d.rectangle((3, 8, 19, 26), fill=C["a2"]); d.rectangle((3, 8, 19, 9), fill=C["a1"]); d.rectangle((3, 25, 19, 26), fill=C["a4"])
    d.rectangle((19, 14, 29, 19), fill=C["a3"]); d.rectangle((19, 14, 29, 14), fill=C["a1"])   # bolt
    cx, cy = 11, 17
    for k in range(8):                                         # gear teeth
        import math
        a = k * math.pi / 4
        x, y = cx + round(6 * math.cos(a)), cy + round(6 * math.sin(a))
        d.rectangle((x - 1, y - 1, x, y), fill=C["o"])
    d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=C["o"])
    d.ellipse((cx - 2, cy - 2, cx + 2, cy + 2), fill=C["k2"])
    d.rectangle((9, 1, 12, 7), fill=C["k1"])                   # thumb turn
    return im


for slug, fn in [("turboflex", turboflex), ("drx-kits", drx), ("tdr-door-rail", tdr), ("entice-hp-plus", entice),
                 ("entice-hp-plus-transom-sidelites", entice_ts), ("fallbrook", fallbrook), ("floating-sliding-door", floating),
                 ("ladder-pulls", ladder), ("lat34-softbrake", lat34), ("s100-4track-corner-pocket", s100), ("geared-deadbolt", deadbolt)]:
    finish(fn(), slug)
print("crl sprites written")
