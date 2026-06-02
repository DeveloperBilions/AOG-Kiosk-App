#!/usr/bin/env python3
"""Generate launcher icons + Android TV banner as PNGs (no third-party deps).

Draws a black rounded square with a lime "A" mark for the launcher icons, and a
black 320x180 banner with "AOG" lime text for the TV home screen. Pure stdlib
(struct + zlib), so it runs anywhere without Pillow.
"""
import os
import struct
import zlib

LIME = (0xA5, 0xFF, 0x08)
BLACK = (0, 0, 0)

BASE = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res")


def blank(w, h, color=BLACK):
    return [[list(color) for _ in range(w)] for _ in range(h)]


def write_png(path, px):
    h = len(px)
    w = len(px[0])
    raw = bytearray()
    for row in px:
        raw.append(0)  # filter type 0
        for r, g, b in row:
            raw += bytes((r, g, b))
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)


def fill_tri(px, pts, color):
    """Fill a triangle (3 (x,y) points) with a scanline test."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    (x0, y0), (x1, y1), (x2, y2) = pts

    def sign(ax, ay, bx, by, cx, cy):
        return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)

    for y in range(int(min(ys)), int(max(ys)) + 1):
        for x in range(int(min(xs)), int(max(xs)) + 1):
            d1 = sign(x, y, x0, y0, x1, y1)
            d2 = sign(x, y, x1, y1, x2, y2)
            d3 = sign(x, y, x2, y2, x0, y0)
            neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
            pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
            if not (neg and pos) and 0 <= y < len(px) and 0 <= x < len(px[0]):
                px[y][x] = list(color)


def draw_A(px, cx, cy, s, color):
    """Draw a chunky letter A centred at (cx, cy) with height ~s."""
    half = s / 2.0
    top = (cx, cy - half)
    bl = (cx - half * 0.75, cy + half)
    br = (cx + half * 0.75, cy + half)
    # Outer triangle
    fill_tri(px, [top, bl, br], color)
    # Knock out the inner triangle (back to black) to make the A hollow
    inner_top = (cx, cy - half * 0.35)
    inner_bl = (cx - half * 0.42, cy + half * 0.62)
    inner_br = (cx + half * 0.42, cy + half * 0.62)
    fill_tri(px, [inner_top, inner_bl, inner_br], BLACK)
    # Crossbar
    for y in range(int(cy + half * 0.30), int(cy + half * 0.52)):
        for x in range(int(cx - half * 0.45), int(cx + half * 0.45)):
            if 0 <= y < len(px) and 0 <= x < len(px[0]):
                px[y][x] = list(color)


def rounded_bg(px, color, radius_frac=0.18):
    """Round the corners of a square icon by blacking corner pixels."""
    h = len(px)
    w = len(px[0])
    r = int(min(w, h) * radius_frac)
    for y in range(h):
        for x in range(w):
            px[y][x] = list(color)
    corners = [(r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)]
    for y in range(h):
        for x in range(w):
            # outside-corner test
            for (cx, cy) in corners:
                inx = (x < r and cx == r) or (x > w - r - 1 and cx == w - r - 1)
                iny = (y < r and cy == r) or (y > h - r - 1 and cy == h - r - 1)
                if inx and iny and (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                    px[y][x] = list(BLACK)


# ---- launcher icons (legacy raster, for API < 26) ----
ICON_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
for folder, sz in ICON_SIZES.items():
    img = blank(sz, sz, BLACK)
    rounded_bg(img, BLACK)
    draw_A(img, sz / 2, sz / 2 * 1.02, sz * 0.62, LIME)
    write_png(os.path.join(BASE, folder, "ic_launcher.png"), img)
    write_png(os.path.join(BASE, folder, "ic_launcher_round.png"), img)
    print("icon", folder, sz)

# ---- Android TV banner: 320x180 ----
banner = blank(320, 180, BLACK)
# subtle lime border
for x in range(320):
    banner[0][x] = list(LIME); banner[179][x] = list(LIME)
for y in range(180):
    banner[y][0] = list(LIME); banner[y][319] = list(LIME)
draw_A(banner, 70, 95, 110, LIME)
# "OG" blocks to the right of the A (simple lime rectangles as wordmark accent)
for y in range(70, 122):
    for x in range(150, 300):
        # leave it minimal — just an underline bar under where text would go
        pass
for x in range(140, 290):
    banner[128][x] = list(LIME); banner[129][x] = list(LIME); banner[130][x] = list(LIME)
write_png(os.path.join(BASE, "drawable", "tv_banner.png"), banner)
print("banner 320x180")
print("done")
