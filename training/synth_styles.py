"""Generation 6 (2026-11-08): the owner's two plan styles, with hard variants and zones.

Style spec: benchmarks/plans/STYLE-SPEC-2026-11.md (written from the three real plans,
all SEEN). This file draws a LOOK, never a layout: no real plan's arrangement, count,
position or text block is copied; layouts are random.

  style G  office graphic (Golden, Golden 2): thin blue outlines, beige squares with a green
           centre dot, orange armchairs, wood rounds with petal chairs, banquettes, a stage
           with a truss, a bar counter, word-art labels, NO table numbers by default
  style P  printed symbols (ORNEK, the "PDF style"): grey dotted discs, numbers in the disc
           (3-digit numbers on two lines), no chairs drawn, servant boxes, loca row, legend,
           title and capacity boxes, photographed with a fold

Hard variants, drawn in every split: page turn 0/90/180/270, A4 200 dpi scan, phone photo
(perspective, shadow, glare, blur, strong JPEG), a fold; density; merged rows; theatre rows
(chairs, no tables); cocktail tables (bistro, no chairs); clutter (logos, dimension lines,
planters, columns, capacity and title text, legends); numbering patterns (row, column,
block, skip-13, prefix, block letters, out-of-sequence inserts); zones drawn and/or labelled
(stage, dance floor, bar, entrance, VIP area, aisle).

HELD OUT for the exam (never in train or val): the families G-hold (23) and P-hold (26),
the layouts `diagonal` (G) and `arc` (P), and the numbering pattern `serpentine`.

GROUND TRUTH is written by construction (`verification: synthetic-exact`): objects in the
repository's annotation format (tables with `seats`, `number`/`numberText`, chairs with
`relationships`, merged `logicalGroups`), plus `zones` [{type, cx, cy, w, h, rotation,
drawn, labelled, label}] carried through every transform. A zone is written only where the
picture shows it (drawn and/or labelled); an aisle only where tables stand on both sides.

    python -I training/synth_styles.py plans --split train --style G --count 160 --out DIR
    python -I training/synth_styles.py vlm --plans DIR1,DIR2 --out DIR --seed 81
"""
import argparse
import io
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth_levels as L  # noqa: E402
from synth import SS, font, rot_pts  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = json.load(open(os.path.join(ROOT, "server", "local-check-questions.json")))

# ---- families ------------------------------------------------------------------------------
F = L.FAMILIES
FAMS = {
    20: ("G-golden", "G", dict(F[10], line=(84, 150, 200), wall=(222, 224, 228), wordart=(232, 120, 50)), False),
    21: ("G-scan", "G", dict(F[18]), False),
    22: ("G-warm", "G", dict(F[10], line=(115, 92, 70), table_fill=(244, 232, 205), chair_fill=(214, 88, 48), round_fill=(222, 196, 150),
                             wall=(230, 226, 220), wordart=(214, 88, 48), sofa_fill=(214, 88, 48)), False),
    23: ("G-hold", "G", dict(F[10], line=(95, 90, 150), table_fill=(236, 230, 214), chair="rounded", chair_fill=(240, 120, 100), round_fill=(230, 222, 200),
                             round_chair="petal-blue", petal_fill=(246, 244, 236), petal_back=(150, 140, 200), wall=(220, 218, 232), wordart=(150, 120, 210),
                             sofa_fill=(240, 120, 100), dot=((90, 110, 200), (40, 50, 120))), True),
    24: ("P-ornek", "P", dict(F[11]), False),
    25: ("P-flat", "P", dict(F[11], line=(30, 30, 30), table_fill=(236, 236, 236), paper=(255, 255, 255), dotted=False, scan=False), False),
    26: ("P-hold", "P", dict(F[11], line=(60, 70, 98), table_fill=(214, 220, 232), paper=(250, 246, 236)), True),
}
TRAIN_FAMILIES = {"G": [20, 21, 22], "P": [24, 25]}
HOLD_FAMILIES = {"G": [23], "P": [26]}
LAYOUTS = {"G": ["lounge", "banquet", "dense", "theatre", "cocktail"], "P": ["grid", "split", "dense", "theatre", "cocktail"]}
HOLD_LAYOUTS = {"G": ["diagonal"], "P": ["arc"]}
NUMBERING = ["row", "column", "block", "skip13", "prefix", "letters", "insert"]
HOLD_NUMBERING = ["serpentine"]
ZONE_WORDS = ["stage", "dancefloor", "bar", "entrance", "vip", "aisle", "seating", "none"]
SEEDS = {"train": 7100000, "val": 7200000, "exam": 7300000}
WORDS = {
    "stage": ["SAHNE", "STAGE", "PODYUM", "SAHNE"],
    "dancefloor": ["DANS PİSTİ", "DANCE FLOOR", "PİST", "DANS ALANI"],
    "bar": ["BAR", "Bar", "BAR 1", "KOKTEYL BAR"],
    "entrance": ["GİRİŞ", "GIRIS", "ENTRANCE", "GİRİŞ"],
    "vip": ["VIP", "VIP ALAN", "V.I.P.", "VIP"],
    "aisle": ["KORİDOR", "AISLE", "YOL"],
}


class StylePlan(L.Plan3):
    def __init__(self, w, h, fam, rng, style):
        super().__init__(w, h, fam, rng)
        self.style = style
        self.zones = []

    def zone(self, typ, cx, cy, w, h, drawn, label):
        self.zones.append(dict(id=f"z{len(self.zones) + 1:02d}", **{"class": "zone"}, type=typ, cx=round(cx, 1), cy=round(cy, 1), w=round(w, 1), h=round(h, 1),
                               rotation=0, drawn=bool(drawn), labelled=bool(label), label=label or None))

    def wordart(self, cx, cy, s, size, colour, vertical=False):
        f = font(size * SS, self.rng)
        if vertical:
            tw = int(f.getlength(s)) + 8 * SS
            th = int(size * SS * 1.6)
            tile = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
            ImageDraw.Draw(tile).text((tw / 2, th / 2), s, font=f, fill=(255, 255, 255, 255), anchor="mm", stroke_width=max(1, int(size * 0.08 * SS)), stroke_fill=colour + (255,))
            tile = tile.rotate(90, expand=True)
            self.img.paste(tile, (int(cx * SS - tile.width / 2), int(cy * SS - tile.height / 2)), tile)
        else:
            self.d.text((cx * SS, cy * SS), s, font=f, fill=(255, 255, 255), anchor="mm", stroke_width=max(1, int(size * 0.08 * SS)), stroke_fill=colour)

    def label(self, cx, cy, s, size, colour=None):
        if self.style == "G" and self.rng.random() < 0.75:
            self.wordart(cx, cy, s, size, colour or self.fam.get("wordart") or (232, 120, 50))
        else:
            self.text(cx, cy, s, size, fill=colour)

    def dashed_rect(self, box, colour, width=1, step=9):
        x0, y0, x1, y1 = [v * SS for v in box]
        st = step * SS
        for x in np.arange(x0, x1, st * 2):
            self.d.line([(x, y0), (min(x + st, x1), y0)], fill=colour, width=width * SS)
            self.d.line([(x, y1), (min(x + st, x1), y1)], fill=colour, width=width * SS)
        for y in np.arange(y0, y1, st * 2):
            self.d.line([(x0, y), (x0, min(y + st, y1))], fill=colour, width=width * SS)
            self.d.line([(x1, y), (x1, min(y + st, y1))], fill=colour, width=width * SS)


# ---- zones -----------------------------------------------------------------------------------
def draw_stage(p, rng, hall, unit):
    x0, y0, x1, y1 = hall
    W, H = x1 - x0, y1 - y0
    side = rng.choice(["top", "bottom", "left", "right"])
    if p.style == "P" and rng.random() < 0.45:  # a runway T in the middle (catwalk joined to a stage)
        cx, cy = (x0 + x1) / 2 + rng.uniform(-0.08, 0.08) * W, (y0 + y1) / 2 + rng.uniform(-0.1, 0.1) * H
        bw, bh, rw, rh = W * rng.uniform(0.12, 0.18), H * rng.uniform(0.07, 0.1), W * rng.uniform(0.035, 0.05), H * rng.uniform(0.18, 0.3)
        fill = (222, 222, 222)
        p.rect(cx, cy + rh / 2 + bh / 2, bw, bh, 0, fill, p.fam["line"], max(2, p.fam["lw"] + 1))
        p.rect(cx, cy, rw, rh, 0, fill, p.fam["line"], max(2, p.fam["lw"] + 1))
        for _ in range(int(bw * bh * 0.05)):
            p.d.point(((cx + rng.uniform(-bw / 2, bw / 2)) * SS, (cy + rh / 2 + bh / 2 + rng.uniform(-bh / 2, bh / 2)) * SS), fill=(150, 150, 150))
        lab = rng.choice(WORDS["stage"]) if rng.random() < 0.4 else None
        if lab:
            p.text(cx, cy + rh / 2 + bh / 2, lab, bh * 0.35)
        bx = (cx - bw / 2, cy - rh / 2, cx + bw / 2, cy + rh / 2 + bh)
        p.take((bx[0] - 4, bx[1] - 4, bx[2] + 4, bx[3] + 4))
        p.zone("stage", (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, bx[2] - bx[0], bx[3] - bx[1], True, lab)
        return side, bx, "runway"
    long_ = (W if side in ("top", "bottom") else H) * rng.uniform(0.3, 0.5)
    depth = (H if side in ("top", "bottom") else W) * rng.uniform(0.12, 0.2)
    sw, sh = (long_, depth) if side in ("top", "bottom") else (depth, long_)
    off = rng.uniform(-0.25, 0.25)
    cx = {"top": (x0 + x1) / 2 + off * W, "bottom": (x0 + x1) / 2 + off * W, "left": x0 + sw / 2 + 4, "right": x1 - sw / 2 - 4}[side]
    cy = {"top": y0 + sh / 2 + 4, "bottom": y1 - sh / 2 - 4, "left": (y0 + y1) / 2 + off * H, "right": (y0 + y1) / 2 + off * H}[side]
    line = p.fam["line"]
    if p.style == "G":
        p.rect(cx, cy, sw, sh, 0, (255, 255, 255), line, max(1, p.fam["lw"]))
        blue = (84, 150, 210) if rng.random() < 0.7 else line
        # side blocks (speakers/screens) and a truss along the front edge with discs and crosses
        horiz = side in ("top", "bottom")
        for s in (-1, 1):
            bx, by = (cx + s * sw * 0.42, cy) if horiz else (cx, cy + s * sh * 0.42)
            bw_, bh_ = (sw * 0.1, sh * 0.55) if horiz else (sw * 0.55, sh * 0.1)
            p.rect(bx, by, bw_, bh_, 0, blue, line, 1)
        fx, fy = {"top": (cx, cy + sh / 2), "bottom": (cx, cy - sh / 2), "left": (cx + sw / 2, cy), "right": (cx - sw / 2, cy)}[side]
        if rng.random() < 0.8:
            tw = max(3, unit * 0.12)
            a, b = ((fx - sw * 0.45, fy), (fx + sw * 0.45, fy)) if horiz else ((fx, fy - sh * 0.45), (fx, fy + sh * 0.45))
            p.d.line([(a[0] * SS, a[1] * SS), (b[0] * SS, b[1] * SS)], fill=blue, width=int(tw * SS))
            for (ex, ey) in (a, b):
                r = tw * 1.6
                p.ellipse(ex, ey, r, r, blue, line, 1)
                for dx, dy in ((1, 1), (1, -1)):
                    p.d.line([((ex - dx * r * 2) * SS, (ey - dy * r * 2) * SS), ((ex + dx * r * 2) * SS, (ey + dy * r * 2) * SS)], fill=blue, width=int(tw * 0.6 * SS))
        if rng.random() < 0.6:
            p.text(cx - sw * 0.2, cy - sh * 0.2, rng.choice(["8 m", "10 m", "6,5 m", "12 m"]), max(9, unit * 0.25), fill=(40, 40, 40))
        lab = rng.choice(WORDS["stage"]) if rng.random() < 0.75 else None
        if lab:
            p.text(cx, cy + sh * 0.15, lab, max(10, min(sh, sw) * 0.12), fill=(40, 40, 40))
    else:
        p.rect(cx, cy, sw, sh, 0, (224, 224, 224), line, max(2, p.fam["lw"] + 1))
        for _ in range(int(sw * sh * 0.03)):
            p.d.point(((cx + rng.uniform(-sw / 2, sw / 2)) * SS, (cy + rng.uniform(-sh / 2, sh / 2)) * SS), fill=(150, 150, 150))
        lab = rng.choice(WORDS["stage"]) if rng.random() < 0.7 else None
        if lab:
            p.text(cx, cy, lab, max(10, min(sh, sw) * 0.25))
    bx = (cx - sw / 2, cy - sh / 2, cx + sw / 2, cy + sh / 2)
    p.take((bx[0] - 6, bx[1] - 6, bx[2] + 6, bx[3] + 6))
    p.zone("stage", cx, cy, sw, sh, True, lab)
    return side, bx, "end"


def draw_dancefloor(p, rng, side, sbox, hall, unit):
    x0, y0, x1, y1 = sbox
    sw, sh = x1 - x0, y1 - y0
    horiz = side in ("top", "bottom")
    dw, dh = (sw * rng.uniform(0.6, 1.0), sh * rng.uniform(0.8, 1.5)) if horiz else (sw * rng.uniform(0.8, 1.5), sh * rng.uniform(0.6, 1.0))
    gap = unit * rng.uniform(0.15, 0.6)
    cx = {"top": (x0 + x1) / 2, "bottom": (x0 + x1) / 2, "left": x1 + gap + dw / 2, "right": x0 - gap - dw / 2}[side]
    cy = {"top": y1 + gap + dh / 2, "bottom": y0 - gap - dh / 2, "left": (y0 + y1) / 2, "right": (y0 + y1) / 2}[side]
    box = (cx - dw / 2, cy - dh / 2, cx + dw / 2, cy + dh / 2)
    if not p.free(box, pad=2):
        return
    drawn = rng.random() < 0.85
    lab = rng.choice(WORDS["dancefloor"]) if (rng.random() < 0.7 or not drawn) else None
    if drawn:
        s = max(8, unit * rng.uniform(0.35, 0.6))
        cols = [(226, 204, 160), (196, 162, 112)] if p.style == "G" else [(232, 232, 232), (196, 196, 196)]
        if rng.random() < 0.25:
            cols = [(250, 250, 250), (70, 70, 70)]
        i = 0
        for yy in np.arange(box[1], box[3] - 1e-6, s):
            for xx in np.arange(box[0], box[2] - 1e-6, s):
                c = cols[(int((xx - box[0]) / s) + int((yy - box[1]) / s)) % 2]
                p.d.rectangle([xx * SS, yy * SS, min(xx + s, box[2]) * SS, min(yy + s, box[3]) * SS], fill=c)
                i += 1
        p.d.rectangle([v * SS for v in box], outline=p.fam["line"], width=max(1, p.fam["lw"]) * SS)
    if lab:
        p.label(cx, cy, lab, max(11, min(dw, dh) * 0.14), colour=(40, 40, 40) if drawn else None)
    p.take(box)
    p.zone("dancefloor", cx, cy, dw, dh, drawn, lab)


def draw_bar(p, rng, hall, unit):
    x0, y0, x1, y1 = hall
    for _ in range(12):
        side = rng.choice(["top", "bottom", "left", "right"])
        L_ = (x1 - x0 if side in ("top", "bottom") else y1 - y0) * rng.uniform(0.18, 0.35)
        d = unit * rng.uniform(0.8, 1.4)
        bw, bh = (L_, d) if side in ("top", "bottom") else (d, L_)
        t = rng.uniform(0.15, 0.85)
        cx = {"top": x0 + t * (x1 - x0), "bottom": x0 + t * (x1 - x0), "left": x0 + bw / 2 + 6, "right": x1 - bw / 2 - 6}[side]
        cy = {"top": y0 + bh / 2 + 6, "bottom": y1 - bh / 2 - 6, "left": y0 + t * (y1 - y0), "right": y0 + t * (y1 - y0)}[side]
        box = (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
        if p.free(box, pad=6):
            break
    else:
        return
    line = p.fam["line"]
    if p.style == "G":
        p.rect(cx, cy, bw, bh, 0, (250, 250, 252), line, 1)
        horiz = bw > bh
        for k in range(rng.randint(2, 5)):
            f = (k + 0.5) / 5 - 0.5
            ix, iy = (cx + f * bw * 0.9, cy - bh * 0.18) if horiz else (cx - bw * 0.18, cy + f * bh * 0.9)
            p.rect(ix, iy, (bw * 0.1 if horiz else bw * 0.3), (bh * 0.3 if horiz else bh * 0.1), 0, (255, 255, 255), line, 1)
        if rng.random() < 0.6:
            p.rect(cx + (bw * 0.42 if horiz else 0), cy + (0 if horiz else bh * 0.42), unit * 0.18, unit * 0.4, 0 if not horiz else 90, (84, 150, 210), line, 1)
    else:
        p.rect(cx, cy, bw, bh, 0, (200, 200, 200), line, max(1, p.fam["lw"]))
    lab = rng.choice(WORDS["bar"]) if rng.random() < 0.8 else None
    if lab:
        p.label(cx, cy, lab, max(11, min(bw, bh) * 0.45))
    p.take((box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4))
    p.zone("bar", cx, cy, bw, bh, True, lab)


def draw_entrance(p, rng, hall, unit, wall_lw):
    x0, y0, x1, y1 = hall
    for _ in range(12):
        side = rng.choice(["top", "bottom", "left", "right"])
        r = unit * rng.uniform(0.8, 1.3)
        t = rng.uniform(0.08, 0.92)
        cx = {"top": x0 + t * (x1 - x0), "bottom": x0 + t * (x1 - x0), "left": x0, "right": x1}[side]
        cy = {"top": y0, "bottom": y1, "left": y0 + t * (y1 - y0), "right": y0 + t * (y1 - y0)}[side]
        inward = {"top": (0, 1), "bottom": (0, -1), "left": (1, 0), "right": (-1, 0)}[side]
        zc = (cx + inward[0] * r * 0.7, cy + inward[1] * r * 0.7)
        box = (zc[0] - r, zc[1] - r, zc[0] + r, zc[1] + r)
        if p.free(box, pad=2):
            break
    else:
        return
    line = p.fam["line"]
    horiz = side in ("top", "bottom")
    # the gap in the wall
    gx0, gy0, gx1, gy1 = (cx - r, cy - wall_lw * 2, cx + r, cy + wall_lw * 2) if horiz else (cx - wall_lw * 2, cy - r, cx + wall_lw * 2, cy + r)
    p.d.rectangle([gx0 * SS, gy0 * SS, gx1 * SS, gy1 * SS], fill=p.fam["paper"])
    if p.style == "G" or rng.random() < 0.3:
        # a door leaf and its swing arc
        hx, hy = (cx - r, cy) if horiz else (cx, cy - r)
        ex, ey = hx + inward[0] * r * 2 if not horiz else hx, hy + inward[1] * r * 2 if horiz else hy
        p.d.line([hx * SS, hy * SS, ex * SS, ey * SS], fill=line, width=max(1, p.fam["lw"]) * SS)
        start = {"top": 0, "bottom": 270, "left": 270, "right": 180}[side]
        p.d.arc([(hx - 2 * r) * SS, (hy - 2 * r) * SS, (hx + 2 * r) * SS, (hy + 2 * r) * SS], start, start + 90, fill=line, width=SS)
    else:
        # an outlined arrow pointing into the hall
        L_, w_ = r * 1.6, r * 0.5
        pts = [(-w_ / 2, 0), (w_ / 2, 0), (w_ / 2, L_ * 0.6), (w_, L_ * 0.6), (0, L_), (-w_, L_ * 0.6), (-w_ / 2, L_ * 0.6)]
        ang = math.atan2(inward[1], inward[0]) - math.pi / 2
        P = [(cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)) for x, y in pts]
        p.poly(P, (236, 236, 236), line, max(1, p.fam["lw"]))
    lab = rng.choice(WORDS["entrance"]) if rng.random() < 0.7 else None
    if lab:
        lx, ly = zc[0] + (r * 0.2 if horiz else 0), zc[1] + (0 if horiz else r * 0.2)
        if p.style == "G":
            p.wordart(lx, ly, lab, max(10, r * 0.45), p.fam.get("wordart") or (232, 120, 50), vertical=not horiz)
        else:
            p.text(lx, ly, lab, max(10, r * 0.4))
    p.take(box)
    p.zone("entrance", zc[0], zc[1], 2 * r, 2 * r, True, lab)


def draw_vip(p, rng, seat_box, unit):
    x0, y0, x1, y1 = seat_box
    vw, vh = (x1 - x0) * rng.uniform(0.22, 0.38), (y1 - y0) * rng.uniform(0.22, 0.4)
    for _ in range(10):
        cx, cy = rng.uniform(x0 + vw / 2, x1 - vw / 2), rng.uniform(y0 + vh / 2, y1 - vh / 2)
        box = (cx - vw / 2, cy - vh / 2, cx + vw / 2, cy + vh / 2)
        if p.free(box, pad=4):
            break
    else:
        return None
    colour = rng.choice([(190, 150, 60), (180, 40, 40), p.fam["line"]])
    if rng.random() < 0.6:
        p.dashed_rect(box, colour, width=2)
    else:
        p.d.rectangle([v * SS for v in box], outline=colour, width=2 * SS)
        for k in range(4):  # rope posts
            px_, py_ = (box[0], box[1]) if k == 0 else (box[2], box[1]) if k == 1 else (box[2], box[3]) if k == 2 else (box[0], box[3])
            p.ellipse(px_, py_, 4, 4, colour, colour, 1)
    lab = rng.choice(WORDS["vip"]) if rng.random() < 0.9 else None
    th = max(11, unit * 0.45)
    if lab:
        lb = (box[0] + 6, box[1] + 4, box[0] + 6 + len(lab) * th * 0.75, box[1] + 4 + th * 1.3)
        p.take(lb)
        p.text((lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2, lab, th, fill=colour)
    # the rope itself is kept free of furniture
    for e in ((box[0] - 3, box[1] - 3, box[2] + 3, box[1] + 3), (box[0] - 3, box[3] - 3, box[2] + 3, box[3] + 3),
              (box[0] - 3, box[1] - 3, box[0] + 3, box[3] + 3), (box[2] - 3, box[1] - 3, box[2] + 3, box[3] + 3)):
        p.take(e)
    p.zone("vip", cx, cy, vw, vh, True, lab)
    return box


def reserve_aisle(p, rng, seat_box, unit):
    x0, y0, x1, y1 = seat_box
    vertical = rng.random() < 0.55
    aw = unit * rng.uniform(1.4, 2.2)
    if vertical:
        cx = x0 + (x1 - x0) * rng.uniform(0.35, 0.65)
        box = (cx - aw / 2, y0 + 4, cx + aw / 2, y1 - 4)
    else:
        cy = y0 + (y1 - y0) * rng.uniform(0.35, 0.65)
        box = (x0 + 4, cy - aw / 2, x1 - 4, cy + aw / 2)
    drawn = rng.random() < 0.3
    lab = rng.choice(WORDS["aisle"]) if rng.random() < 0.15 else None
    p.take(box)
    return dict(box=box, vertical=vertical, drawn=drawn, label=lab)


def finish_aisle(p, a, unit):
    """An aisle is a zone only where tables stand on both sides of it, along most of it."""
    b = a["box"]
    tabs = [o for o in p.objects if o["class"] == "table"]
    if a["vertical"]:
        near = [o for o in tabs if b[1] <= o["cy"] <= b[3] and abs(o["cx"] - (b[0] + b[2]) / 2) < (b[2] - b[0]) / 2 + unit * 2.5]
        left, right = [o for o in near if o["cx"] < b[0]], [o for o in near if o["cx"] > b[2]]
        span = lambda xs: (max(o["cy"] for o in xs) - min(o["cy"] for o in xs)) if len(xs) > 1 else 0
        ok = len(left) >= 2 and len(right) >= 2 and min(span(left), span(right)) > (b[3] - b[1]) * 0.4
        if ok:
            lo, hi = max(min(o["cy"] for o in left), min(o["cy"] for o in right)), min(max(o["cy"] for o in left), max(o["cy"] for o in right))
            b = (b[0], lo - unit * 0.6, b[2], hi + unit * 0.6)
    else:
        near = [o for o in tabs if b[0] <= o["cx"] <= b[2] and abs(o["cy"] - (b[1] + b[3]) / 2) < (b[3] - b[1]) / 2 + unit * 2.5]
        top, bot = [o for o in near if o["cy"] < b[1]], [o for o in near if o["cy"] > b[3]]
        span = lambda xs: (max(o["cx"] for o in xs) - min(o["cx"] for o in xs)) if len(xs) > 1 else 0
        ok = len(top) >= 2 and len(bot) >= 2 and min(span(top), span(bot)) > (b[2] - b[0]) * 0.4
        if ok:
            lo, hi = max(min(o["cx"] for o in top), min(o["cx"] for o in bot)), min(max(o["cx"] for o in top), max(o["cx"] for o in bot))
            b = (lo - unit * 0.6, b[1], hi + unit * 0.6, b[3])
    if not ok:
        return
    if a["drawn"]:
        for k in (0, 2) if a["vertical"] else (1, 3):
            if a["vertical"]:
                p.d.line([(b[k] * SS, b[1] * SS), (b[k] * SS, b[3] * SS)], fill=p.fam["line"], width=SS)
            else:
                p.d.line([(b[0] * SS, b[k] * SS), (b[2] * SS, b[k] * SS)], fill=p.fam["line"], width=SS)
    if a["label"]:
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        p.text(cx, cy, a["label"], max(9, unit * 0.3))
    p.zone("aisle", (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, b[2] - b[0], b[3] - b[1], a["drawn"], a["label"])


# ---- clutter -----------------------------------------------------------------------------------
def clutter(p, rng, hall, page, unit):
    x0, y0, x1, y1 = hall
    W, H = page
    line = p.fam["line"]
    def spot(w, h, outside=False, tries=25):
        for _ in range(tries):
            if outside:
                cx, cy = rng.uniform(w / 2 + 6, W - w / 2 - 6), rng.choice([rng.uniform(h / 2 + 4, max(h / 2 + 5, y0 - h / 2 - 4)), rng.uniform(min(H - h / 2 - 5, y1 + h / 2 + 4), H - h / 2 - 4)])
            else:
                cx, cy = rng.uniform(x0 + w / 2 + 8, x1 - w / 2 - 8), rng.uniform(y0 + h / 2 + 8, y1 - h / 2 - 8)
            b = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
            if p.free(b, pad=4):
                p.take(b)
                return cx, cy
        return None
    def rec(cls, cx, cy, w, h, label=None):
        p.objects.append(dict(id=p.oid("v"), **{"class": cls}, cx=round(cx, 1), cy=round(cy, 1), w=round(w, 1), h=round(h, 1), rotation=0, label=label))
    # capacity / title text (numbers that are NOT table numbers)
    for _ in range(rng.randint(1, 3)):
        s = rng.choice(["114 pax seating", "Total : 96 pax", "10 pax bistro", "TOPLAM : 840 PAX", "SALON : 120 * 10 : 1200 PAX", "LOCALAR : 48 PAX", "DÜĞÜN 12.09.2026", "SILA 29.08.2026", "Balo Salonu A", "Gala 2026"])
        ts = max(11, unit * rng.uniform(0.3, 0.5))
        w, h = len(s) * ts * 0.62, ts * 1.5
        c = spot(w, h, outside=rng.random() < 0.4)
        if c:
            if p.style == "P" and rng.random() < 0.5:
                p.rect(c[0], c[1], w + 10, h + 6, 0, (255, 255, 255), line, max(1, p.fam["lw"]))
            p.label(c[0], c[1], s, ts)
            rec("text", c[0], c[1], w, h, s)
    # dimension lines
    for _ in range(rng.randint(0, 3)):
        Ld = unit * rng.uniform(2, 5)
        horiz = rng.random() < 0.6
        c = spot(Ld if horiz else unit * 0.6, unit * 0.6 if horiz else Ld)
        if c:
            a, b = ((c[0] - Ld / 2, c[1]), (c[0] + Ld / 2, c[1])) if horiz else ((c[0], c[1] - Ld / 2), (c[0], c[1] + Ld / 2))
            p.d.line([(a[0] * SS, a[1] * SS), (b[0] * SS, b[1] * SS)], fill=(60, 60, 60), width=SS)
            for (ex, ey) in (a, b):
                t = unit * 0.15
                if horiz:
                    p.d.line([(ex * SS, (ey - t) * SS), (ex * SS, (ey + t) * SS)], fill=(60, 60, 60), width=SS)
                else:
                    p.d.line([((ex - t) * SS, ey * SS), ((ex + t) * SS, ey * SS)], fill=(60, 60, 60), width=SS)
            txt = rng.choice(["12,40 m", "8 m", "3,10 m", "24.5 m", "6 m"])
            p.text(c[0] + (0 if horiz else unit * 0.35), c[1] - (unit * 0.25 if horiz else 0), txt, max(9, unit * 0.22), fill=(60, 60, 60))
            rec("dimension", c[0], c[1], Ld if horiz else unit * 0.6, unit * 0.6 if horiz else Ld, txt)
    # logo
    if rng.random() < 0.45:
        s = unit * rng.uniform(0.7, 1.2)
        c = spot(2 * s, 2 * s, outside=rng.random() < 0.6)
        if c:
            col = rng.choice([(150, 40, 40), (40, 60, 130), (30, 30, 30), (190, 150, 60)])
            p.ellipse(c[0], c[1], s, s, None, col, 3)
            p.ellipse(c[0], c[1], s * 0.75, s * 0.75, None, col, 1)
            p.text(c[0], c[1], rng.choice(["ME", "GH", "HE", "M", "LOGO"]), s * 0.6, fill=col)
            rec("logo", c[0], c[1], 2 * s, 2 * s)
    # planters / plants (G) and the planter box
    for _ in range(rng.randint(0, 3) if p.style == "G" else rng.randint(0, 1)):
        s = unit * rng.uniform(0.5, 0.9)
        if rng.random() < 0.5:
            bw, bh = s * 3, s * 1.6
            c = spot(bw, bh)
            if c:
                p.rect(c[0], c[1], bw, bh, 0, (255, 255, 255), (30, 30, 50), 2)
                p.rect(c[0], c[1], bw * 0.6, bh * 0.5, 0, (255, 255, 255), (30, 30, 50), 3)
                for k in range(7):
                    p.ellipse(c[0] - bw / 2 + bw * (k + 0.5) / 7, c[1] - bh / 2, s * 0.18, s * 0.18, (110, 175, 70), (40, 100, 40), 1)
                rec("planter", c[0], c[1], bw, bh)
        else:
            c = spot(2 * s, 2 * s)
            if c:
                p.ellipse(c[0], c[1], s * 0.8, s * 0.8, (120, 170, 110), (40, 90, 50), 1)
                for k in range(8):
                    a = 2 * math.pi * k / 8
                    p.ellipse(c[0] + math.cos(a) * s * 0.55, c[1] + math.sin(a) * s * 0.55, s * 0.18, s * 0.18, (70, 140, 80), (40, 90, 50), 1)
                rec("planter", c[0], c[1], 1.6 * s, 1.6 * s)
    # columns along the walls (real objects: class column)
    for _ in range(rng.randint(0, 5)):
        cs = unit * rng.uniform(0.4, 0.7)
        t = rng.uniform(0.1, 0.9)
        side = rng.choice(["top", "bottom", "left", "right"])
        cx = {"top": x0 + t * (x1 - x0), "bottom": x0 + t * (x1 - x0), "left": x0 + cs, "right": x1 - cs}[side]
        cy = {"top": y0 + cs, "bottom": y1 - cs, "left": y0 + t * (y1 - y0), "right": y0 + t * (y1 - y0)}[side]
        b = (cx - cs / 2, cy - cs / 2, cx + cs / 2, cy + cs / 2)
        if p.free(b, pad=3):
            p.take(b)
            p.rect(cx, cy, cs, cs, 0, line if rng.random() < 0.5 else (200, 200, 200), line, 1)
            p.objects.append(dict(id=p.oid("v"), **{"class": "column"}, cx=round(cx, 1), cy=round(cy, 1), w=round(cs, 1), h=round(cs, 1), rotation=0))
    if p.style == "P":
        # servant boxes on the hall line, a loca row, a legend list outside the hall
        for _ in range(rng.randint(0, 3)):
            bw, bh = unit * rng.uniform(2.2, 3.2), unit * 0.75
            cx = rng.uniform(x0 + bw, x1 - bw)
            cy = rng.choice([y0 + 2, y1 - 2])
            b = (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
            if p.free(b, pad=2):
                p.take(b)
                p.rect(cx, cy, bw, bh, 0, (128, 128, 128), (90, 90, 90), 1)
                p.text(cx, cy, rng.choice(["servant", "SERVİS", "servant"]), bh * 0.5, fill=(255, 255, 255))
                rec("service", cx, cy, bw, bh, "servant")
        if rng.random() < 0.5:
            n = rng.randint(4, 9)
            th = unit * 0.32
            lw_, lh = th * 4.5, th * 1.5
            lx = rng.choice([max(lw_ / 2 + 4, x0 - lw_ / 2 - 10), min(W - lw_ / 2 - 4, x1 + lw_ / 2 + 10)])
            ly0 = rng.uniform(y0, max(y0 + 1, y1 - n * lh))
            if all(p.free((lx - lw_ / 2, ly0 + k * lh, lx + lw_ / 2, ly0 + (k + 1) * lh), pad=1) for k in range(n)):
                for k in range(n):
                    p.take((lx - lw_ / 2, ly0 + k * lh, lx + lw_ / 2, ly0 + (k + 1) * lh))
                    p.d.rectangle([(lx - lw_ / 2) * SS, (ly0 + k * lh) * SS, (lx + lw_ / 2) * SS, (ly0 + (k + 1) * lh) * SS], outline=line, width=SS)
                    p.text(lx, ly0 + (k + 0.5) * lh, f"Loca {k + 1}", th)
                rec("legend", lx, ly0 + n * lh / 2, lw_, n * lh)


# ---- tables ------------------------------------------------------------------------------------
def unit_of(rng, style, scale):
    return (rng.uniform(34, 52) if style == "G" else rng.uniform(30, 44)) * scale


def lay_tables(p, rng, layout, box, unit, stage_side):
    x0, y0, x1, y1 = box
    fam = p.fam
    facing = {"top": -90, "bottom": 90, "left": 180, "right": 0}.get(stage_side, -90)
    if p.style == "G":
        kind = fam.get("round_chair") or fam["chair"]
        if layout == "lounge":
            L.lounge_groups(p, rng, 4, box, unit)
        elif layout in ("banquet", "dense"):
            r = unit * rng.uniform(0.75, 1.0)
            gap = r * (rng.uniform(2.6, 3.2) if layout == "banquet" else rng.uniform(2.25, 2.5))
            stagger = rng.random() < 0.5
            y, row = y0 + gap * 0.6, 0
            while y < y1 - r:
                x = x0 + gap * 0.6 + (gap / 2 if stagger and row % 2 else 0)
                while x < x1 - r:
                    if rng.random() < 0.92:
                        L.round_table3(p, x + rng.uniform(-0.05, 0.05) * gap, y + rng.uniform(-0.05, 0.05) * gap, r,
                                       rng.choice([5, 6, 6, 7, 8, 8, 9, 10]), None, kind, 4)
                    x += gap
                y += gap
                row += 1
            for _ in range(rng.randint(2, 8) if layout == "banquet" else rng.randint(0, 3)):
                n = rng.choice([2, 3, 3, 4, 5])
                horiz = rng.random() < 0.6
                p.merged_row(rng.uniform(x0 + 20, x1 - 20 - n * unit), rng.uniform(y0 + 20, y1 - 20 - n * unit), n, unit, horiz)
        elif layout == "theatre":
            box, rest = theatre_split(box, stage_side, rng)
            lay_tables(p, rng, "banquet", rest, unit, stage_side)
            x0, y0, x1, y1 = box
            cs = unit * rng.uniform(0.55, 0.75)
            pitch = cs * rng.uniform(1.15, 1.5)
            ck = rng.choice([fam["chair"], kind, "rect"])
            for yy in np.arange(y0 + pitch, y1 - pitch / 2, pitch * rng.uniform(1.3, 1.7) / 1.0):
                for xx in np.arange(x0 + pitch, x1 - pitch / 2, pitch):
                    b = (xx - cs / 2, yy - cs / 2, xx + cs / 2, yy + cs / 2)
                    if p.free(b, pad=1):
                        p.take(b)
                        p.chair(xx, yy, cs, facing, None, kind=ck)
        elif layout == "cocktail":
            for _ in range(rng.randint(12, 40)):
                r = unit * rng.uniform(0.3, 0.45)
                cx, cy = rng.uniform(x0 + r, x1 - r), rng.uniform(y0 + r, y1 - r)
                stools = rng.choice([0, 0, 0, 2, 3])
                tid = L.round_table3(p, cx, cy, r, stools, None, "circle" if stools else None, 2) if rng.random() < 0.7 else \
                    p.rect_table(cx, cy, r * 1.7, r * 1.7, 0, 0, 0)
                if tid:
                    o = next(o for o in p.objects if o.get("id") == tid)
                    o["type"] = "bistro"
                    if not stools:
                        o.pop("seats", None)
        elif layout == "diagonal":
            deg = rng.choice([30, 35, 40, 45, -30, -45])
            gap = unit * rng.uniform(2.6, 3.2)
            c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
            cx0, cy0 = (x0 + x1) / 2, (y0 + y1) / 2
            R = max(x1 - x0, y1 - y0)
            for i in np.arange(-R, R, gap):
                for j in np.arange(-R, R, gap):
                    x, y = cx0 + i * c - j * s, cy0 + i * s + j * c
                    if x0 + unit < x < x1 - unit and y0 + unit < y < y1 - unit and rng.random() < 0.9:
                        if rng.random() < 0.7:
                            p.rect_table(x, y, unit, unit, deg, 1, 1)
                        else:
                            p.rect_table(x, y, unit * 2, unit, deg, 2, 0)
    else:  # P: bare round symbols
        r = unit * rng.uniform(0.75, 0.95)
        dark_some = True
        if layout in ("grid", "split", "dense", "cocktail"):
            pitch = r * (rng.uniform(2.5, 2.9) if layout != "dense" else rng.uniform(2.2, 2.4))
            wave = rng.uniform(0, 0.12) * pitch
            stagger = rng.random() < 0.4
            y, row = y0 + pitch * 0.6, 0
            while y < y1 - r:
                x = x0 + pitch * 0.6 + (pitch / 2 if stagger and row % 2 else 0)
                while x < x1 - r:
                    if rng.random() < 0.95:
                        rr = r * (rng.uniform(0.45, 0.6) if layout == "cocktail" and rng.random() < 0.4 else 1)
                        tid = p.symbol_table(x + rng.uniform(-0.04, 0.04) * pitch, y + wave * math.sin(x / pitch) + rng.uniform(-0.04, 0.04) * pitch, rr, None)
                        if tid and rr < r:
                            p.objects[-1]["type"] = "bistro"
                    x += pitch
                y += pitch
                row += 1
        elif layout == "theatre":
            box, rest = theatre_split(box, stage_side, rng)
            lay_tables(p, rng, "grid", rest, unit, stage_side)
            x0, y0, x1, y1 = box
            cs = unit * rng.uniform(0.4, 0.55)
            pitch = cs * rng.uniform(1.2, 1.5)
            for yy in np.arange(y0 + pitch, y1 - pitch / 2, pitch * 1.4):
                for xx in np.arange(x0 + pitch, x1 - pitch / 2, pitch):
                    b = (xx - cs / 2, yy - cs / 2, xx + cs / 2, yy + cs / 2)
                    if p.free(b, pad=1):
                        p.take(b)
                        p.chair(xx, yy, cs, facing, None, kind="rect")
        elif layout == "arc":
            sx, sy = {"top": ((x0 + x1) / 2, y0 - (y1 - y0) * 0.1), "bottom": ((x0 + x1) / 2, y1 + (y1 - y0) * 0.1),
                      "left": (x0 - (x1 - x0) * 0.1, (y0 + y1) / 2), "right": (x1 + (x1 - x0) * 0.1, (y0 + y1) / 2)}.get(stage_side, ((x0 + x1) / 2, y0))
            pitch = r * rng.uniform(2.5, 2.9)
            for rad in np.arange(pitch * 2, math.hypot(x1 - x0, y1 - y0), pitch):
                n = int(math.pi * rad / pitch)
                for k in range(n):
                    a = math.pi * (k + 0.5) / n + (0 if stage_side in ("top",) else math.pi if stage_side == "bottom" else -math.pi / 2 if stage_side == "left" else math.pi / 2)
                    x, y = sx + rad * math.cos(a), sy + rad * math.sin(a)
                    if x0 + r < x < x1 - r and y0 + r < y < y1 - r:
                        p.symbol_table(x, y, r, None)
    return


def theatre_split(box, side, rng):
    """Theatre rows take the part of the hall nearest the stage; tables fill the rest."""
    x0, y0, x1, y1 = box
    f = rng.uniform(0.35, 0.6)
    side = side or "top"
    if side == "top":
        return (x0, y0, x1, y0 + (y1 - y0) * f), (x0, y0 + (y1 - y0) * f, x1, y1)
    if side == "bottom":
        return (x0, y1 - (y1 - y0) * f, x1, y1), (x0, y0, x1, y1 - (y1 - y0) * f)
    if side == "left":
        return (x0, y0, x0 + (x1 - x0) * f, y1), (x0 + (x1 - x0) * f, y0, x1, y1)
    return (x1 - (x1 - x0) * f, y0, x1, y1), (x0, y0, x1 - (x1 - x0) * f, y1)


# ---- numbering ---------------------------------------------------------------------------------
def numbering(p, rng, pattern, unit):
    tabs = [o for o in p.objects if o["class"] == "table" and o.get("type") != "bistro"]
    merged = {m for g in p.groups for m in g["members"]}
    tabs = [o for o in tabs if o["id"] not in merged]
    if not tabs:
        return
    tol = unit * 0.7
    def rows_of(key_a, key_b):
        xs = sorted(tabs, key=lambda o: o[key_a])
        rows, cur = [], [xs[0]]
        for o in xs[1:]:
            if abs(o[key_a] - cur[-1][key_a]) < tol:
                cur.append(o)
            else:
                rows.append(cur); cur = [o]
        rows.append(cur)
        return [sorted(r, key=lambda o: o[key_b]) for r in rows]
    if pattern == "column":
        order = [o for r in rows_of("cx", "cy") for o in r]
    elif pattern == "serpentine":
        order = [o for i, r in enumerate(rows_of("cy", "cx")) for o in (r if i % 2 == 0 else r[::-1])]
    elif pattern in ("block", "letters"):
        mid = sorted(o["cx"] for o in tabs)[len(tabs) // 2]
        left = [o for r in rows_of("cy", "cx") for o in r if o["cx"] < mid]
        right = [o for r in rows_of("cy", "cx") for o in r if o["cx"] >= mid]
        order = left + right
    else:
        order = [o for r in rows_of("cy", "cx") for o in r]
    texts, n = [], rng.choice([1, 1, 1, 1, 101 if p.style == "P" else 1, 21])
    prefix = rng.choice(["T", "M", "T-", "T"]) if pattern == "prefix" else ""
    for i, o in enumerate(order):
        if pattern == "skip13" and n == 13:
            n += 1
        if pattern == "letters":
            half = sum(1 for x in order if x in left)
            texts.append(("A" + str(i + 1)) if i < half else ("B" + str(i - half + 1)))
        else:
            texts.append(prefix + str(n))
        n += 1
    if pattern == "insert" and len(order) > 12:
        k = rng.randint(3, len(order) - 6)
        tail = [n + j for j in range(3)]
        for j in range(3):
            texts[k + j] = str(tail[j])
    line = p.fam["line"]
    for o, s in zip(order, texts):
        r = min(o["w"], o["h"]) / 2
        if p.style == "P":
            if rng.random() < 0.04:  # dark disc: printed dark on dark, unreadable
                p.ellipse(o["cx"], o["cy"], r, r, (62, 62, 62), line, max(1, p.fam["lw"]))
                p.text(o["cx"], o["cy"], s, r * 0.55, fill=(78, 78, 78))
                o["numberUnreadable"] = True
                continue
            size = r * rng.uniform(0.48, 0.62)
            if len(s) >= 3 and s.isdigit() and rng.random() < 0.7:
                p.text(o["cx"], o["cy"] - size * 0.5, s[:-1], size * 0.85)
                p.text(o["cx"], o["cy"] + size * 0.5, s[-1], size * 0.85)
                o["numberTwoLine"] = True
            else:
                p.text(o["cx"], o["cy"], s, size / max(1, (len(s) - 2) * 0.35 + 1) if len(s) > 2 else size)
        else:
            size = max(9, r * rng.uniform(0.55, 0.75))
            if rng.random() < 0.3:  # a tag beside the table
                tx, ty = o["cx"], o["cy"] - r - size * 0.9
                p.d.rounded_rectangle([(tx - size * 0.5 * len(s) * 0.7 - 3) * SS, (ty - size * 0.6) * SS, (tx + size * 0.5 * len(s) * 0.7 + 3) * SS, (ty + size * 0.6) * SS],
                                      radius=3 * SS, fill=(255, 255, 255), outline=line, width=SS)
                p.text(tx, ty, s, size, fill=(40, 40, 40))
                o["numberPlacement"] = "tag"
            else:
                p.text(o["cx"], o["cy"] - r * 0.35, s, size, fill=rng.choice([(40, 40, 40), (200, 60, 30)]))
        o["numberText"] = s
        if s.isdigit():
            o["number"] = int(s)


# ---- capture -----------------------------------------------------------------------------------
def turn(img, objs, rng, meta, choices=(90, 270, 180)):
    W, H = img.size
    rot = rng.choice(choices)
    if rot == 90:
        img, R = img.transpose(Image.ROTATE_90), np.array([[0, 1, 0], [-1, 0, W], [0, 0, 1]], float)
    elif rot == 270:
        img, R = img.transpose(Image.ROTATE_270), np.array([[0, -1, H], [1, 0, 0], [0, 0, 1]], float)
    else:
        img, R = img.transpose(Image.ROTATE_180), np.array([[-1, 0, W], [0, -1, H], [0, 0, 1]], float)
    meta["turnDeg"] = rot
    return img, L.map_objects(objs, R)


def fold(img, rng, meta):
    a = np.asarray(img, dtype=np.float32).copy()
    H, W = a.shape[:2]
    if rng.random() < 0.6:
        y = int(H * rng.uniform(0.35, 0.65)); a[y:, :] *= rng.uniform(0.9, 0.96); a[max(0, y - 2):y + 2] *= 0.85
    else:
        x = int(W * rng.uniform(0.35, 0.65)); a[:, x:] *= rng.uniform(0.9, 0.96); a[:, max(0, x - 2):x + 2] *= 0.85
    meta["fold"] = True
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def capture(img, objs, rng, meta, style):
    c = rng.choices(["clean", "scan", "photo", "turned"], weights=[30, 30, 25, 15] if style == "G" else [25, 15, 45, 15])[0]
    meta["capture"] = c
    if c == "scan":
        if style == "G":
            img, objs = L.page_scan(img, objs, rng, meta)
        else:
            img, objs = L.scanned(img, objs, rng, meta)
    elif c == "photo":
        if style == "P" or rng.random() < 0.4:
            img = fold(img, rng, meta)
        if rng.random() < 0.35:
            img, objs = turn(img, objs, rng, meta, (90, 270))
        img, objs = L.photographed(img, objs, rng, meta)
    elif c == "turned":
        img, objs = turn(img, objs, rng, meta)
        img, objs = L.scanned(img, objs, rng, meta)
    return img, objs


# ---- one plan ------------------------------------------------------------------------------------
def draw_plan(seed, fam_idx, layout, pattern):
    rng = random.Random(seed)
    name, style, fam, held = FAMS[fam_idx]
    fam = dict(fam)
    W = rng.choice([1400, 1600, 1800, 2000]) if style == "G" else rng.choice([1800, 2000, 2200, 2400])
    H = int(W * rng.uniform(0.55, 0.72))
    p = StylePlan(W, H, fam, rng, style)
    mx, my = int(W * rng.uniform(0.04, 0.07)), int(H * rng.uniform(0.06, 0.12))
    if style == "P":
        mx, my = int(W * rng.uniform(0.07, 0.11)), int(H * rng.uniform(0.1, 0.15))
    hall = (mx, my, W - mx, H - my)
    wall_lw = max(2, fam["lw"] + 1)
    if fam.get("wall"):
        p.d.rectangle([v * SS for v in hall], outline=fam["wall"], width=max(6, int(min(W, H) * 0.01)) * SS)
    p.d.rectangle([v * SS for v in hall], outline=fam["line"], width=wall_lw * SS)
    # piers / wall blocks along the walls
    for _ in range(rng.randint(2, 8)):
        side = rng.choice(["top", "bottom", "left", "right"])
        t = rng.uniform(0.05, 0.95)
        pw, ph = (W * 0.04, H * 0.025) if side in ("top", "bottom") else (W * 0.012, H * 0.08)
        cx = {"top": hall[0] + t * (hall[2] - hall[0]), "bottom": hall[0] + t * (hall[2] - hall[0]), "left": hall[0], "right": hall[2]}[side]
        cy = {"top": hall[1], "bottom": hall[3], "left": hall[1] + t * (hall[3] - hall[1]), "right": hall[1] + t * (hall[3] - hall[1])}[side]
        p.rect(cx, cy, pw, ph, 0, (228, 230, 234) if style == "G" else (150, 150, 150), fam["line"], 1)
    scale = W / 1600 * rng.uniform(0.85, 1.2)
    unit = unit_of(rng, style, scale)
    inner = (hall[0] + 10, hall[1] + 10, hall[2] - 10, hall[3] - 10)
    stage_side, sbox = None, None
    if rng.random() < 0.85:
        stage_side, sbox, skind = draw_stage(p, rng, inner, unit)
        if skind == "end" and rng.random() < 0.5:
            draw_dancefloor(p, rng, stage_side, sbox, inner, unit)
    elif rng.random() < 0.3:
        cx, cy = (inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2
        draw_dancefloor(p, rng, "top", (cx - unit * 3, cy - unit * 4, cx + unit * 3, cy - unit * 3), inner, unit)
    if rng.random() < 0.6:
        draw_bar(p, rng, inner, unit)
    for _ in range(rng.choice([0, 1, 1, 2, 2])):
        draw_entrance(p, rng, hall, unit, wall_lw)
    clutter(p, rng, inner, (W, H), unit)
    vip = draw_vip(p, rng, inner, unit) if rng.random() < 0.4 else None
    aisle = reserve_aisle(p, rng, inner, unit) if rng.random() < 0.6 and layout not in ("arc", "theatre") else None
    lay_tables(p, rng, layout, inner, unit, stage_side)
    if aisle:
        finish_aisle(p, aisle, unit)
    if vip:
        inside = [o for o in p.objects if o["class"] == "table" and vip[0] < o["cx"] < vip[2] and vip[1] < o["cy"] < vip[3]]
        if not inside:
            p.zones = [z for z in p.zones if z["type"] != "vip"]
    numbered = rng.random() < (0.3 if style == "G" else 0.92)
    if numbered:
        numbering(p, rng, pattern, unit)
    img = p.img.resize((W, H), Image.LANCZOS)
    meta = dict(family=name, familyIndex=fam_idx, style=style, layout=layout, numbering=pattern if numbered else "none", seed=seed, heldOutFamily=held, gen=6)
    objs = p.objects + [dict(z, _zone=True) for z in p.zones]
    img, objs = capture(img, objs, rng, meta, style)
    zones = [dict({k: v for k, v in o.items() if k not in ("_zone", "_corners")}) for o in objs if o.get("_zone")]
    objs = L.visibility([o for o in objs if not o.get("_zone")], img.size, meta)
    Wd, Hd = img.size
    zones = [z for z in zones if 0 < z["cx"] < Wd and 0 < z["cy"] < Hd]
    return img, p, objs, zones, meta


def annotation(plan_id, file, img, objs, zones, p, meta, split):
    ann = L.annotation(plan_id, file, img, objs, p, dict(meta, level=meta["capture"]), split, split == "exam")
    ann["annotationMethod"] = "generated by training/synth_styles.py (generation 6, the owner's two styles): exact by construction, not a human judgement"
    ann["level"] = {"clean": 1, "turned": 2, "scan": 3, "photo": 4}[meta["capture"]]
    ann["split"].update(heldOutFamily=meta["heldOutFamily"], style=meta["style"], numbering=meta["numbering"],
                        heldOutLayout=meta["layout"] in sum(HOLD_LAYOUTS.values(), []), heldOutNumbering=meta["numbering"] in HOLD_NUMBERING)
    ann["styleSpec"] = "benchmarks/plans/STYLE-SPEC-2026-11.md"
    ann["zones"] = zones
    return ann


def plan_jobs(split, style, count, seed0):
    rng = random.Random(seed0 * 7 + (1 if style == "G" else 2))
    jobs = []
    for k in range(count):
        if split == "exam":
            # half: held-out families on every layout (incl. held-out); half: training families on the held-out layout or numbering
            if k % 2 == 0:
                fam = HOLD_FAMILIES[style][0]
                layout = rng.choice(LAYOUTS[style] + HOLD_LAYOUTS[style])
                pattern = rng.choice(NUMBERING + HOLD_NUMBERING)
            else:
                fam = rng.choice(TRAIN_FAMILIES[style])
                layout, pattern = (HOLD_LAYOUTS[style][0], rng.choice(NUMBERING + HOLD_NUMBERING)) if k % 4 == 1 else (rng.choice(LAYOUTS[style]), HOLD_NUMBERING[0])
        else:
            fam = TRAIN_FAMILIES[style][k % len(TRAIN_FAMILIES[style])]
            layout = LAYOUTS[style][(k // len(TRAIN_FAMILIES[style])) % len(LAYOUTS[style])]
            pattern = rng.choice(NUMBERING)
        jobs.append((seed0 + (0 if style == "G" else 50000) + k, fam, layout, pattern))
    return jobs


def cmd_plans(a):
    os.makedirs(a.out, exist_ok=True)
    index = []
    for seed, fam, layout, pattern in plan_jobs(a.split, a.style, a.count, SEEDS[a.split]):
        pid = f"syn-{FAMS[fam][0]}-{layout}-{seed}"
        jf = os.path.join(a.out, pid + ".json")
        if os.path.exists(jf):
            index.append(pid)
            continue
        img, p, objs, zones, meta = draw_plan(seed, fam, layout, pattern)
        ext = ".png" if meta["capture"] == "clean" else ".jpg"
        if ext == ".png":
            img.save(os.path.join(a.out, pid + ext), optimize=True)
        else:
            img.save(os.path.join(a.out, pid + ext), "JPEG", quality=92)
        json.dump(annotation(pid, pid + ext, img, objs, zones, p, meta, a.split), open(jf, "w"))
        index.append(pid)
    json.dump({"generator": "training/synth_styles.py", "split": a.split, "style": a.style, "count": a.count, "plans": index}, open(os.path.join(a.out, f"index-{a.style}.json"), "w"), indent=1)
    print(f"{a.split} {a.style}: {len(index)} plans in {a.out}")


# ---- VLM crops ---------------------------------------------------------------------------------
def Q(task):
    if task in ("ID", "NEG"):
        return SPEC["preamble"] + SPEC["questions"]["identify"].replace("{words}", ", ".join(SPEC["words"]))
    if task == "CHAIRS":
        return SPEC["preamble"] + SPEC["questions"]["chairs"]
    if task == "ZONE":
        return SPEC["preamble"] + SPEC["questions"]["zone"].replace("{zones}", ", ".join(SPEC["zoneWords"]))
    if task == "NUMBER":
        return SPEC["preamble"] + SPEC["questions"]["number"]
    raise KeyError(task)


def crop(img, cx, cy, side, out=448):
    side = max(32, int(side))
    bg = tuple(int(v) for v in np.asarray(img.resize((8, 8))).reshape(-1, 3).max(axis=0))
    c = Image.new("RGB", (side, side), bg)
    x0, y0 = int(round(cx - side / 2)), int(round(cy - side / 2))
    c.paste(img.crop((max(0, x0), max(0, y0), min(img.width, x0 + side), min(img.height, y0 + side))), (max(0, -x0), max(0, -y0)))
    return c.resize((out, out), Image.LANCZOS)


def cmd_vlm(a):
    os.makedirs(os.path.join(a.out, "img"), exist_ok=True)
    rng = random.Random(a.seed)
    rows, n = [], 0
    files = sorted(f for d in a.plans.split(",") for f in [os.path.join(d, x) for x in os.listdir(d) if x.startswith("syn-") and x.endswith(".json")])[::a.every]
    for jf in files:
        ann = json.load(open(jf))
        img = Image.open(os.path.join(os.path.dirname(jf), ann["source"]["file"])).convert("RGB")
        W, H = img.size
        S = min(W, H)
        meta = dict(family=ann["split"]["family"], style=ann["split"]["style"], layout=ann["split"]["layoutSource"], capture=ann["generator"].get("capture"),
                    numbering=ann["split"]["numbering"], heldOutFamily=ann["split"]["heldOutFamily"], heldOutLayout=ann["split"]["heldOutLayout"],
                    heldOutNumbering=ann["split"]["heldOutNumbering"], plan=ann["planId"], level=ann["level"])
        objs = [o for o in ann["objects"] if not o.get("ignore")]
        tabs = [o for o in objs if o["class"] == "table"]
        merged = {m for g in ann.get("logicalGroups", []) for m in g["members"]}
        items = []
        def add(task, sub, truth, cx, cy, side):
            items.append((task, sub, truth, cx, cy, side))
        # ZONE: every zone, plus a seating crop and a none crop
        for z in ann.get("zones", []):
            side = min(S, max(1.3 * max(z["w"], z["h"]), 0.2 * S)) if z["type"] != "entrance" else min(S, max(3 * z["w"], 0.16 * S))
            add("ZONE", f"{z['type']}-{'d' if z['drawn'] else ''}{'l' if z['labelled'] else ''}", z["type"], z["cx"], z["cy"], side)
        zb = [(z["cx"] - z["w"] / 2, z["cy"] - z["h"] / 2, z["cx"] + z["w"] / 2, z["cy"] + z["h"] / 2) for z in ann.get("zones", [])]
        in_zone = lambda x, y, pad=0: any(b[0] - pad < x < b[2] + pad and b[1] - pad < y < b[3] + pad for b in zb)
        free_tabs = [o for o in tabs if not in_zone(o["cx"], o["cy"], max(o["w"], o["h"]) * 3)]
        if len(free_tabs) >= 4:
            t = rng.choice(free_tabs)
            add("ZONE", "seating", "seating", t["cx"], t["cy"], 0.22 * S)
        cl = [o for o in objs if o["class"] in ("text", "logo", "legend", "dimension", "planter") and not in_zone(o["cx"], o["cy"], 0.12 * S)]
        if cl:
            o = rng.choice(cl)
            add("ZONE", "none-" + o["class"], "none", o["cx"], o["cy"], max(0.16 * S, 1.4 * max(o["w"], o["h"])))
        # NUMBER: numbered, unnumbered and unreadable tables, never a merged member
        single = [o for o in tabs if o["id"] not in merged]
        withn = [o for o in single if o.get("numberText")]
        without = [o for o in single if not o.get("numberText")]
        for o in rng.sample(withn, min(len(withn), a.numbers)):
            sub = "two-line" if o.get("numberTwoLine") else ("tag" if o.get("numberPlacement") == "tag" else ("prefixed" if not o["numberText"].isdigit() else "plain"))
            add("NUMBER", sub, o["numberText"], o["cx"], o["cy"], max(2.4 * max(o["w"], o["h"]), 56))
        k_none = 1 if withn else 2
        for o in rng.sample(without, min(len(without), k_none)):
            add("NUMBER", "unreadable" if o.get("numberUnreadable") else "none", "none", o["cx"], o["cy"], max(2.4 * max(o["w"], o["h"]), 56))
        # CHAIRS: tables standing alone with their chairs (G); P discs carry none
        rels = {}
        for r in ann.get("relationships", []):
            if r.get("chair") and r.get("belongsTo"):
                rels.setdefault(r["belongsTo"], []).append(r["chair"])
        byid = {o["id"]: o for o in ann["objects"]}
        cand = [o for o in single if o.get("seats") and len(rels.get(o["id"], [])) == o["seats"] and o.get("type") != "bistro"]
        for o in rng.sample(cand, min(len(cand), 1)):
            pts = [byid[c] for c in rels[o["id"]] if c in byid] + [o]
            ext = max(max(abs(q["cx"] - o["cx"]) + q["w"] / 2, abs(q["cy"] - o["cy"]) + q["h"] / 2) for q in pts)
            add("CHAIRS", ann["split"]["style"], o["seats"], o["cx"], o["cy"], 2 * ext * 1.35)
        if ann["split"]["style"] == "P" and single and rng.random() < 0.3:
            o = rng.choice(single)
            add("CHAIRS", "P-none", 0, o["cx"], o["cy"], max(2.4 * max(o["w"], o["h"]), 56))
        # ID / NEG: hard negatives on clutter, positives on a table and a chair
        neg = [o for o in objs if o["class"] in ("text", "logo", "legend", "dimension", "planter")]
        for o in rng.sample(neg, min(len(neg), 2)):
            add("NEG", "nothing-" + o["class"], "nothing", o["cx"], o["cy"], max(2.0 * max(o["w"], o["h"]), 56) if o["class"] not in ("text", "dimension", "legend") else max(1.2 * max(o["w"], o["h"]), 56))
        if single:
            o = rng.choice(single)
            add("ID", "table", "table", o["cx"], o["cy"], max(2.2 * max(o["w"], o["h"]), 56))
        chairs = [o for o in objs if o["class"] == "chair"]
        if chairs:
            o = rng.choice(chairs)
            add("ID", "chair", "chair", o["cx"], o["cy"], max(2.2 * max(o["w"], o["h"]), 48))
        for task, sub, truth, cx, cy, side in items:
            jx, jy = (rng.uniform(-0.04, 0.04) * side, rng.uniform(-0.04, 0.04) * side) if a.jitter else (0, 0)
            im = crop(img, cx + jx, cy + jy, side * (rng.uniform(0.92, 1.1) if a.jitter else 1))
            if a.jitter and rng.random() < 0.25:  # the product's second look is the crop turned a quarter
                im = im.rotate(rng.choice([90, 270]))
            name = f"img/{n:06d}.png"
            im.save(os.path.join(a.out, name))
            rows.append(dict(task=task, sub=sub, truth=truth, q=Q(task), image=name, split=a.split, **meta))
            n += 1
    with open(os.path.join(a.out, "items.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tally = {}
    for r in rows:
        tally[f"{r['task']}:{r['sub']}"] = tally.get(f"{r['task']}:{r['sub']}", 0) + 1
    json.dump({"generator": "training/synth_styles.py vlm", "plans": a.plans, "seed": a.seed, "split": a.split, "n": len(rows), "tally": tally}, open(os.path.join(a.out, "meta.json"), "w"), indent=1)
    print(f"{len(rows)} crops -> {a.out}")


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("plans")
    p.add_argument("--split", choices=list(SEEDS), required=True)
    p.add_argument("--style", choices=["G", "P"], required=True)
    p.add_argument("--count", type=int, required=True)
    p.add_argument("--out", required=True)
    v = sp.add_parser("vlm")
    v.add_argument("--plans", required=True)
    v.add_argument("--out", required=True)
    v.add_argument("--seed", type=int, default=81)
    v.add_argument("--split", default="train")
    v.add_argument("--numbers", type=int, default=3)
    v.add_argument("--jitter", action="store_true")
    v.add_argument("--every", type=int, default=1, help="every k-th plan (sorted by name)")
    a = ap.parse_args()
    cmd_plans(a) if a.cmd == "plans" else cmd_vlm(a)


if __name__ == "__main__":
    main()
