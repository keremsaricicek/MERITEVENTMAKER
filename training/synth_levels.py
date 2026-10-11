"""Generation 3: synthetic banquet plans at seven difficulty levels.

Same purpose and the same rule as synth.py: synthetic data is auxiliary, never
real-venue accuracy. What generation 3 adds is coverage, laid out as LEVELS so
a model can be checked level by level and an easy-case loss cannot hide behind
a hard-case gain:

  L1  clean line drawing, round tables, their chairs or bare symbols
  L2  + square, rectangular, long and pushed-together tables, printed numbers,
      stage, bar, columns
  L3  + armchairs, sofas, benches, banquettes, loca boxes, entrances, exits,
      service areas, titles and capacity lines
  L4  + style range: scale 0.5-2.2x, rotated groups, colour and fill, thin and
      thick lines, crowding, tables that touch
  L5  + what looks like an object and is not: big letters and digits, round
      planters the size of a table, stamps, legends; objects cut by the edge,
      text over objects
  L6  + a scanned sheet: blur, JPEG, noise, paper tone, low contrast, a slight
      skew, fold lines
  L7  + a photographed sheet: perspective, rotation, a shadow, glare, uneven
      light, strong compression

STYLE, NOT LAYOUT. Two of the new families take their drawing style from the
two real sheets in this repository — the office-graphic look of the Golden plan
(tan tables with a dot, orange armchairs and sofas, outlined word-art labels)
and the printed-and-photographed look of ORNEK (grey numbered circles, two-line
numbers, "servant" boxes, a fold). No layout, position, count or text block is
copied from either: layouts come from this file's own generators, so a model
trained here has not seen Golden's or ORNEK's arrangement (they stay the
regression set; see benchmarks/offline-intelligence/ACCEPTANCE.md).

LABELS ARE WHAT THE PICTURE SHOWS. A sofa's seats are counted only when the
drawing divides its cushions (otherwise `seats` is null — never "3 by
default"); a bench is a bench, not chairs; a legend's sample symbols, an
object more than 40 % outside the sheet, one under glare, or one shrunk below
six pixels is marked `ignore` (neither an object nor background to a learner).
Every label is `synthetic-exact` and generated, never a human judgement.

SPLITS by style family and by layout source:
  train / val   families 0-7 and 10-13, layouts rounds|staggered|rows|mixed|cabaret
  held-out      families 8-9 (used in earlier development: not blind any more)
  BLIND         families 14-15 AND the u-shape layout, which no training or
                tuning run ever sees. Generated once, scored once.

    python training/synth_levels.py --out DIR --level 3 --count 40 --split train --seed 5
"""
import argparse
import io
import json
import math
import os
import random

import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # synth.py beside this file, also under python -I
import synth  # noqa: E402
from synth import Plan, font, rot_pts, SS

# ---- families ------------------------------------------------------------------------
NEW_FAMILIES = [
    # 10: the Golden sheet's look (office graphic), not its layout
    dict(name="office-graphic", line=(70, 80, 100), lw=2, table_fill=(232, 216, 176), chair="arm", chair_fill=(232, 110, 40), paper=(255, 255, 255),
         centre_dot=True, scan=False, wall=(214, 218, 226), wordart=(232, 110, 40), round_chair="petal", round_fill=(226, 212, 178), sofa_fill=(232, 110, 40)),
    # 11: the ORNEK sheet's look (printed, then photographed), not its layout
    dict(name="printed-symbolic", line=(70, 70, 70), lw=2, table_fill=(205, 205, 205), chair=None, chair_fill=None, paper=(246, 246, 244),
         centre_dot=False, scan=True, numbers=True, two_line=True, dotted=True, servant=True, dark_some=True),
    dict(name="pastel-arch", line=(90, 110, 130), lw=1, table_fill=(236, 242, 250), chair="semicircle", chair_fill=(250, 226, 230), paper=(255, 255, 255), centre_dot=False, scan=False),
    dict(name="bold-black", line=(0, 0, 0), lw=4, table_fill=(255, 255, 255), chair="silhouette", chair_fill=(0, 0, 0), paper=(255, 255, 255), centre_dot=False, scan=False),
    # 14-15: BLIND
    dict(name="teal-lounge", line=(20, 80, 90), lw=2, table_fill=(205, 235, 232), chair="rounded", chair_fill=(120, 190, 185), paper=(252, 255, 255),
         centre_dot=False, scan=False, sofa_fill=(60, 140, 140)),
    dict(name="sepia-scan", line=(90, 60, 30), lw=2, table_fill=(240, 228, 200), chair="backrest", chair_fill=(225, 205, 170), paper=(248, 240, 222),
         centre_dot=False, scan=True, numbers=True, prefix="T"),
]
FAMILIES = synth.FAMILIES + NEW_FAMILIES
TRAIN_FAMILIES = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13]
HELD_OUT = [8, 9]
BLIND_FAMILIES = [14, 15]
TRAIN_LAYOUTS = ["rounds", "staggered", "rows", "mixed", "cabaret"]
BLIND_LAYOUTS = ["ushape"]


class Plan3(Plan):
    """synth.Plan plus the seating, venue objects and distractors of generation 3."""

    def chair(self, cx, cy, size, facing_deg, table_id, kind=None, typ="chair"):
        fam = self.fam
        kind = kind or fam["chair"]
        if kind not in ("petal", "semicircle", "silhouette"):
            saved = fam["chair"]
            fam["chair"] = kind
            try:
                cid = super().chair(cx, cy, size, facing_deg, table_id)
            finally:
                fam["chair"] = saved
            if typ != "chair":
                self.objects[-1]["type"] = typ
            return cid
        line, lw, fill = fam["line"], max(1, fam["lw"]), fam.get("chair_fill") or (200, 200, 200)
        w = h = size
        deg = facing_deg - 90
        a = math.radians(facing_deg)
        if kind == "petal":
            # a rounded seat with a back arc, the round tables' chairs on the Golden look
            self.ellipse(cx, cy, w * 0.45, w * 0.45, fill, line, 1)
            bx, by = cx - math.cos(a) * w * 0.32, cy - math.sin(a) * w * 0.32
            self.d.arc([(bx - w * 0.5) * SS, (by - w * 0.5) * SS, (bx + w * 0.5) * SS, (by + w * 0.5) * SS],
                       facing_deg + 180 - 70, facing_deg + 180 + 70, fill=line, width=max(2, lw * SS))
        elif kind == "semicircle":
            self.d.pieslice([(cx - w / 2) * SS, (cy - w / 2) * SS, (cx + w / 2) * SS, (cy + w / 2) * SS],
                            facing_deg + 90, facing_deg + 270, fill=fill, outline=line, width=max(1, lw * SS))
        else:  # silhouette: a filled seat with a filled back
            self.rect(cx, cy, w, h * 0.85, deg, fam["line"], fam["line"], 1)
            bx, by = cx - math.cos(a) * h * 0.55, cy - math.sin(a) * h * 0.55
            self.rect(bx, by, w, h * 0.25, deg, fam["line"], fam["line"], 1)
        lx, ly, lh = cx, cy, h
        if kind == "semicircle":
            # the label is the half disc that is drawn, not the circle it is cut from
            lx, ly, lh = cx - math.cos(a) * w * 0.21, cy - math.sin(a) * w * 0.21, w / 2
        cid = self.oid("c")
        self.objects.append(dict(id=cid, **{"class": "chair"}, type=typ, cx=round(lx, 1), cy=round(ly, 1), w=round(w, 1), h=round(lh, 1), rotation=round(deg % 360, 1)))
        if table_id:
            self.rels.append(dict(chair=cid, belongsTo=table_id, method="generated"))
        return cid

    def number_text(self, cx, cy, n, size):
        fam = self.fam
        s = (fam.get("prefix") or "") + str(n)
        if fam.get("two_line") and n >= 100 and self.rng.random() < 0.7:
            self.text(cx, cy - size * 0.45, s[:-1], size * 0.8)
            self.text(cx, cy + size * 0.45, s[-1], size * 0.8)
        else:
            self.text(cx, cy, s, size)
        return s

    def symbol_table(self, cx, cy, r, number, dark=False):
        """A bare round symbol (no chairs), the printed-symbolic look."""
        box = (cx - r, cy - r, cx + r, cy + r)
        if not self.free(box, pad=3):
            return None
        self.take(box)
        fam = self.fam
        fill = (60, 60, 60) if dark else fam["table_fill"]
        self.ellipse(cx, cy, r, r, fill, fam["line"], fam["lw"])
        if fam.get("dotted") and not dark:
            for _ in range(int(r * r * 0.25)):
                a, rr = self.rng.uniform(0, 2 * math.pi), r * math.sqrt(self.rng.random()) * 0.92
                x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
                self.d.point((x * SS, y * SS), fill=(150, 150, 150))
        tid = self.oid("t")
        obj = dict(id=tid, **{"class": "table"}, type="round", cx=round(cx, 1), cy=round(cy, 1), w=round(2 * r, 1), h=round(2 * r, 1), rotation=0)
        if number is not None:
            # a dark symbol's number is printed dark-on-dark: not legible, so not labelled
            if not dark:
                obj["number"] = number
                obj["numberText"] = self.number_text(cx, cy, number, r * 0.6)
            else:
                self.text(cx, cy, str(number), r * 0.6, fill=(75, 75, 75))
        self.objects.append(obj)
        return tid

    def sofa(self, cx, cy, length, depth, deg, divided, table_id=None):
        """A sofa: body, back along one long side, arms at both ends. Its seats
        are labelled only when the cushions are drawn divided."""
        fam = self.fam
        fill = fam.get("sofa_fill") or fam.get("chair_fill") or (210, 210, 210)
        line, lw = fam["line"], fam["lw"]
        self.rect(cx, cy, length, depth, deg, fill, line, lw)
        a = math.radians(deg)
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        bx, by = cx - vx * depth * 0.38, cy - vy * depth * 0.38
        self.rect(bx, by, length, depth * 0.24, deg, fill, line, lw)
        for s in (-1, 1):
            self.rect(cx + ux * s * length * 0.45, cy + uy * s * length * 0.45, length * 0.1, depth, deg, fill, line, lw)
        seats = None
        if divided:
            seats = max(2, round(length / depth))
            for i in range(1, seats):
                t = (i / seats - 0.5) * length * 0.8
                p0 = (cx + ux * t + vx * depth * -0.25, cy + uy * t + vy * depth * -0.25)
                p1 = (cx + ux * t + vx * depth * 0.5, cy + uy * t + vy * depth * 0.5)
                self.d.line([(p0[0] * SS, p0[1] * SS), (p1[0] * SS, p1[1] * SS)], fill=line, width=max(1, lw * SS))
        sid = self.oid("v")
        self.objects.append(dict(id=sid, **{"class": "sofa"}, cx=round(cx, 1), cy=round(cy, 1), w=round(length, 1), h=round(depth, 1), rotation=round(deg % 360, 1),
                                 seats=seats, seatsSource="divided cushions drawn" if divided else "not shown: unknown"))
        if table_id:
            self.rels.append(dict(seating=sid, belongsTo=table_id, method="generated"))
        return sid

    def bench(self, cx, cy, length, depth, deg, divided, cls="bench"):
        fam = self.fam
        fill = fam.get("chair_fill") or (220, 220, 220)
        self.rect(cx, cy, length, depth, deg, fill, fam["line"], fam["lw"])
        seats = None
        if divided:
            a = math.radians(deg)
            ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
            seats = max(2, round(length / (depth * 1.6)))
            for i in range(1, seats):
                t = (i / seats - 0.5) * length
                p0 = (cx + ux * t - vx * depth / 2, cy + uy * t - vy * depth / 2)
                p1 = (cx + ux * t + vx * depth / 2, cy + uy * t + vy * depth / 2)
                self.d.line([(p0[0] * SS, p0[1] * SS), (p1[0] * SS, p1[1] * SS)], fill=fam["line"], width=max(1, fam["lw"] * SS))
        if cls == "banquette":
            a = math.radians(deg)
            vx, vy = -math.sin(a), math.cos(a)
            self.rect(cx - vx * depth * 0.42, cy - vy * depth * 0.42, length, depth * 0.18, deg, fam["line"], fam["line"], 1)
        bid = self.oid("v")
        self.objects.append(dict(id=bid, **{"class": cls}, cx=round(cx, 1), cy=round(cy, 1), w=round(length, 1), h=round(depth, 1), rotation=round(deg % 360, 1),
                                 seats=seats, seatsSource="divisions drawn" if divided else "not shown: unknown"))
        return bid

    def labelled_box(self, cls, cx, cy, w, h, label, fill=None, dashed=False, rounded=False, text_fill=None):
        box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        if not self.free(box, pad=2):
            return None
        self.take(box)
        fam = self.fam
        if dashed:
            x0, y0, x1, y1 = [v * SS for v in box]
            step = 10 * SS
            for x in np.arange(x0, x1, step * 2):
                self.d.line([(x, y0), (min(x + step, x1), y0)], fill=fam["line"], width=SS)
                self.d.line([(x, y1), (min(x + step, x1), y1)], fill=fam["line"], width=SS)
            for y in np.arange(y0, y1, step * 2):
                self.d.line([(x0, y), (x0, min(y + step, y1))], fill=fam["line"], width=SS)
                self.d.line([(x1, y), (x1, min(y + step, y1))], fill=fam["line"], width=SS)
        elif rounded:
            self.d.rounded_rectangle([v * SS for v in box], radius=h * 0.45 * SS, fill=fill, outline=fam["line"], width=max(1, fam["lw"]) * SS)
        else:
            self.rect(cx, cy, w, h, 0, fill, fam["line"], fam["lw"])
        if label:
            self.text(cx, cy, label, min(h * 0.45, w / max(3, len(label)) * 1.5), fill=text_fill)
        vid = self.oid("v")
        self.objects.append(dict(id=vid, **{"class": cls}, cx=round(cx, 1), cy=round(cy, 1), w=round(w, 1), h=round(h, 1), rotation=0, label=label))
        return vid

    def door(self, cls, cx, cy, r, label):
        fam = self.fam
        box = (cx - r, cy - r, cx + r, cy + r)
        if not self.free(box, pad=2):
            return None
        self.take(box)
        self.d.line([(cx - r) * SS, cy * SS, (cx + r) * SS, cy * SS], fill=fam["line"], width=max(1, fam["lw"]) * SS)
        self.d.arc([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], 180, 270, fill=fam["line"], width=SS)
        self.d.line([(cx - r) * SS, cy * SS, (cx - r) * SS, (cy - r) * SS], fill=fam["line"], width=SS)
        if label:
            self.text(cx + r * 0.2, cy + r * 0.45, label, r * 0.42, fill=fam.get("wordart"))
        vid = self.oid("v")
        self.objects.append(dict(id=vid, **{"class": cls}, cx=round(cx, 1), cy=round(cy, 1), w=round(2 * r, 1), h=round(r * 1.4, 1), rotation=0, label=label))
        return vid

    def distractor(self, kind, cx, cy, s):
        """Things that look like an object and are not. Labelled for what they are,
        which a 4-class learner reads as background — or `ignore` where a person
        could not tell either (a legend's sample symbols)."""
        fam = self.fam
        box = (cx - s, cy - s, cx + s, cy + s)
        if not self.free(box, pad=2):
            return None
        self.take(box)
        vid = self.oid("v")
        if kind == "letter":
            ch = self.rng.choice(["O", "0", "o", "Q", "8", "D"])
            self.text(cx, cy, ch, s * 1.6)
            self.objects.append(dict(id=vid, **{"class": "text"}, cx=round(cx, 1), cy=round(cy, 1), w=round(s, 1), h=round(s * 1.4, 1), rotation=0, label=ch))
        elif kind == "planter":
            self.ellipse(cx, cy, s * 0.8, s * 0.8, (120, 170, 110), (40, 90, 50), 1)
            for k in range(8):
                a = 2 * math.pi * k / 8
                self.ellipse(cx + math.cos(a) * s * 0.55, cy + math.sin(a) * s * 0.55, s * 0.18, s * 0.18, (70, 140, 80), (40, 90, 50), 1)
            self.objects.append(dict(id=vid, **{"class": "planter"}, cx=round(cx, 1), cy=round(cy, 1), w=round(1.6 * s, 1), h=round(1.6 * s, 1), rotation=0))
        elif kind == "stamp":
            self.ellipse(cx, cy, s * 0.9, s * 0.9, None, (150, 40, 40), 2)
            self.ellipse(cx, cy, s * 0.65, s * 0.65, None, (150, 40, 40), 1)
            self.text(cx, cy, self.rng.choice(["ONAY", "OK", "2026", "MERIT"]), s * 0.35, fill=(150, 40, 40))
            self.objects.append(dict(id=vid, **{"class": "decoration"}, cx=round(cx, 1), cy=round(cy, 1), w=round(1.8 * s, 1), h=round(1.8 * s, 1), rotation=0))
        else:  # legend: a framed key with sample symbols; the samples are ignored
            self.rect(cx, cy, 2 * s, 2 * s, 0, (255, 255, 255), fam["line"], 1)
            self.ellipse(cx - s * 0.5, cy - s * 0.4, s * 0.28, s * 0.28, fam["table_fill"], fam["line"], 1)
            self.text(cx + s * 0.3, cy - s * 0.4, "= 10", s * 0.22, anchor="mm")
            self.rect(cx - s * 0.5, cy + s * 0.4, s * 0.25, s * 0.25, 0, fam.get("chair_fill"), fam["line"], 1)
            self.text(cx + s * 0.3, cy + s * 0.4, "= 1", s * 0.22, anchor="mm")
            self.objects.append(dict(id=vid, **{"class": "legend"}, cx=round(cx, 1), cy=round(cy, 1), w=round(2 * s, 1), h=round(2 * s, 1), rotation=0))
            for dy, cls, ww in ((-0.4, "table", 0.56), (0.4, "chair", 0.25)):
                self.objects.append(dict(id=self.oid("v"), **{"class": cls}, cx=round(cx - s * 0.5, 1), cy=round(cy + dy * s, 1), w=round(ww * s, 1), h=round(ww * s, 1),
                                         rotation=0, ignore=True, why="a legend's sample symbol"))
        return vid


# ---- layouts ---------------------------------------------------------------------------
def tables_round_grid(p, rng, level, box, r, gap, stagger, numbers, num, symbolic, crowd):
    x0, y0, x1, y1 = box
    y, row = y0 + gap * 0.6, 0
    fam = p.fam
    while y < y1 - r:
        x = x0 + gap * 0.6 + (gap / 2 if stagger and row % 2 else 0)
        while x < x1 - r:
            jx, jy = rng.uniform(-0.06, 0.06) * gap, rng.uniform(-0.06, 0.06) * gap
            if rng.random() < 0.93:
                if symbolic:
                    dark = fam.get("dark_some") and rng.random() < 0.05
                    if p.symbol_table(x + jx, y + jy, r, num if numbers else None, dark=dark):
                        num += 1
                else:
                    chairs = rng.choice([6, 8, 8, 10, 10, 12]) if fam["chair"] else 0
                    kind = fam.get("round_chair") or fam["chair"]
                    tid = round_table3(p, x + jx, y + jy, r, chairs, num if numbers else None, kind, level)
                    if tid:
                        num += 1
            x += gap
        y += gap
        row += 1
    return num


def round_table3(p, cx, cy, r, chairs, number, kind, level):
    fam = p.fam
    cs = r * p.rng.uniform(0.55, 0.75)
    outer = r + (cs * 1.2 if chairs else 0)
    bx = (cx - outer, cy - outer, cx + outer, cy + outer)
    if not p.free(bx):
        return None
    p.take(bx)
    p.ellipse(cx, cy, r, r, fam.get("round_fill") or fam["table_fill"], fam["line"], fam["lw"])
    if fam.get("centre_dot"):
        p.ellipse(cx, cy, r * 0.12, r * 0.12, (60, 140, 70), (30, 80, 40), 1)
    tid = p.oid("t")
    obj = dict(id=tid, **{"class": "table"}, type="bistro" if r < 18 and chairs <= 4 else "round", cx=round(cx, 1), cy=round(cy, 1), w=round(2 * r, 1), h=round(2 * r, 1), rotation=0)
    if number is not None:
        obj["numberText"] = p.number_text(cx, cy, number, r * p.rng.uniform(0.5, 0.75))
        obj["number"] = number
    p.objects.append(obj)
    if chairs and kind:
        off = p.rng.uniform(0, 360)
        for i in range(chairs):
            a = off + 360 * i / chairs
            d = r + cs * 0.65
            p.chair(cx + math.cos(math.radians(a)) * d, cy + math.sin(math.radians(a)) * d, cs, a + 180, tid, kind=kind)
        obj["seats"] = chairs
    if level >= 3 and p.rng.random() < 0.12:
        p.text(cx, cy + outer + 10, f"{chairs or 10} pax", max(8, r * 0.35))
    return tid


def long_rows(p, rng, level, box, unit, numbers, num):
    x0, y0, x1, y1 = box
    fam = p.fam
    for _ in range(rng.randint(5, 14)):
        n = rng.choice([1, 2, 3, 3, 4, 5])
        horiz = rng.random() < 0.6
        deg = rng.choice([0, 0, 0, 30, 45, -30]) if level >= 4 else 0
        bx, by = rng.uniform(x0 + 20, x1 - 20 - n * unit), rng.uniform(y0 + 20, y1 - 20 - n * unit)
        if n == 1 or deg:
            L = unit * (n if n > 1 else rng.choice([1, 1, 1.6]))
            tid = p.rect_table(bx + L / 2, by + unit / 2, L, unit, deg, max(1, n), rng.choice([0, 1]), number=(num if numbers else None))
            if tid and numbers:
                num += 1
        else:
            ids = p.merged_row(bx, by, n, unit, horiz)
            if ids and level >= 3 and fam.get("sofa_fill") and rng.random() < 0.4:
                # a sofa along the row's free end: a seat of the group, counted only if divided
                L = unit * rng.uniform(1.6, 2.4)
                ex = bx + (n * unit + unit * 0.9 if horiz else unit / 2)
                ey = by + (unit / 2 if horiz else n * unit + unit * 0.9)
                if p.free((ex - L / 2, ey - L / 2, ex + L / 2, ey + L / 2)):
                    p.take((ex - L / 2, ey - L / 2, ex + L / 2, ey + L / 2))
                    p.sofa(ex, ey, L, unit * 0.8, 90 if horiz else 0, rng.random() < 0.5, table_id=ids[-1])
    return num


def draw_level(seed, fam_idx, level, layout, size=None):
    rng = random.Random(seed)
    fam = dict(FAMILIES[fam_idx])
    W = size[0] if size else rng.choice([1200, 1400, 1600, 1900, 2200, 2400])
    H = size[1] if size else int(W * rng.uniform(0.55, 0.8))
    p = Plan3(W, H, fam, rng)
    m = int(min(W, H) * rng.uniform(0.04, 0.08))
    wall = fam.get("wall")
    if wall:
        p.d.rectangle([m * SS, m * SS, (W - m) * SS, (H - m) * SS], outline=wall, width=max(6, int(min(W, H) * 0.012)) * SS)
    p.d.rectangle([m * SS, m * SS, (W - m) * SS, (H - m) * SS], outline=fam["line"], width=max(2, fam["lw"] + 1) * SS)
    scale = (rng.uniform(0.5, 2.2) if level >= 4 else rng.uniform(0.8, 1.25)) * W / 1600
    symbolic = fam["chair"] is None
    numbers = bool(fam.get("numbers")) or (level >= 2 and rng.random() < 0.35)
    inner = (m + 8, m + 8, W - m - 8, H - m - 8)

    # venue objects (L2+): stage, bar, columns
    if level >= 2:
        side = rng.choice(["top", "bottom", "left", "right"])
        sw, sh = W * rng.uniform(0.18, 0.32), H * rng.uniform(0.09, 0.16)
        if side in ("left", "right"):
            sw, sh = sh * W / H, sw * H / W
        scx = {"top": W / 2, "bottom": W / 2, "left": m + sw / 2 + 6, "right": W - m - sw / 2 - 6}[side] + (rng.uniform(-0.2, 0.2) * W if side in ("top", "bottom") else 0)
        scy = {"top": m + sh / 2 + 6, "bottom": H - m - sh / 2 - 6, "left": H / 2, "right": H / 2}[side]
        p.venue("stage", scx, scy, sw, sh, rng.choice(["SAHNE", "STAGE", "", "PODYUM"]) or None, fill=(235, 240, 245) if not fam["scan"] else None)
        cs = rng.uniform(16, 28) * scale
        for _ in range(rng.randint(0, 6)):
            if rng.random() < 0.5:
                x, y = rng.uniform(m + cs, W - m - cs), rng.choice([m + cs / 2 + 4, H - m - cs / 2 - 4])
            else:
                x, y = rng.choice([m + cs / 2 + 4, W - m - cs / 2 - 4]), rng.uniform(m + cs, H - m - cs)
            p.venue("column", x, y, cs * rng.uniform(1, 2), cs, None, fill=fam["line"] if rng.random() < 0.5 else (200, 200, 200))
        if rng.random() < 0.6:
            p.venue("bar", rng.uniform(m + 120, W - m - 120), rng.uniform(m + 60, H - m - 60), 160 * scale, 50 * scale, rng.choice(["BAR", "Bar", "BAR"]))

    # L3: loca boxes, doors, service, titles, capacity lines, armchairs/sofas/benches
    if level >= 3:
        if rng.random() < 0.6:
            n, lw_, lh = rng.randint(4, 9), 80 * scale, 26 * scale
            y = H - m - lh / 2 - 6
            x = m + 20 + lw_ / 2
            for k in range(n):
                p.labelled_box("loca", x + k * (lw_ + 6), y, lw_, lh, rng.choice(["Loca ", "LOCA ", ""]) + str(k + 1), rounded=rng.random() < 0.5)
        for cls, words in (("entrance", ["GİRİŞ", "GIRIS", "ENTRANCE", "GİRİŞ"]), ("exit", ["ÇIKIŞ", "EXIT", "ACİL ÇIKIŞ"])):
            if rng.random() < 0.65:
                r = 34 * scale
                p.door(cls, rng.choice([m + r + 8, W - m - r - 8]), rng.uniform(m + r + 8, H - m - r - 8), r, rng.choice(words))
        if rng.random() < 0.5 or fam.get("servant"):
            for _ in range(rng.randint(1, 3)):
                p.labelled_box("service", rng.uniform(m + 90, W - m - 90), rng.choice([m + 22, H - m - 22]), 150 * scale, 34 * scale,
                               rng.choice(["servant", "SERVİS", "SERVICE"]), fill=(130, 130, 130) if fam.get("servant") else None,
                               dashed=not fam.get("servant"), text_fill=(255, 255, 255) if fam.get("servant") else None)
        tf = rng.uniform(14, 24) * scale
        for _ in range(rng.randint(1, 3)):
            s = rng.choice(["Gala Dinner", "DÜĞÜN 12.09.2026", "Balo Salonu A", "120 pax", "TOPLAM : 840 PAX", "LOCALAR : 48 PAX", "70 * 12 : 840 PAX", "Kokteyl 18:00", "4,20 m", "SALON 2"])
            x, y = rng.uniform(m + 100, W - m - 100), rng.uniform(m + 30, H - m - 30)
            bw = len(s) * tf * 0.6
            if p.free((x - bw / 2, y - tf, x + bw / 2, y + tf)):
                p.take((x - bw / 2, y - tf, x + bw / 2, y + tf))
                p.text(x, y, s, tf, fill=fam.get("wordart"))

    # tables
    if layout == "ushape":
        unit = rng.uniform(30, 46) * scale
        cx, cy = W / 2, H / 2
        Lw, Lh = W * 0.5, H * 0.45
        n = max(3, int(Lw / unit) - 1)
        p.merged_row(cx - Lw / 2, cy - Lh / 2, n, unit, True)
        k = max(2, int(Lh / unit) - 1)
        p.merged_row(cx - Lw / 2, cy - Lh / 2 + unit * 1.6, k, unit, False)
        p.merged_row(cx - Lw / 2 + (n - 1) * unit, cy - Lh / 2 + unit * 1.6, k, unit, False)
        num = 1
    else:
        r = rng.uniform(20, 40) * scale
        crowd = level >= 4 and rng.random() < 0.4
        gap = (r * rng.uniform(2.5, 3.4) if fam["chair"] else r * rng.uniform(2.05, 2.6)) * (0.88 if crowd else 1.0)
        num = 1
        top = inner if layout != "mixed" else (inner[0], inner[1], inner[2], H * 0.55)
        if symbolic:  # a sheet of numbered symbols: the grid is its only form
            num = tables_round_grid(p, rng, level, inner, r, gap, layout in ("staggered", "cabaret"), numbers, num, symbolic, crowd)
        elif layout in ("rounds", "staggered", "mixed", "cabaret"):
            num = tables_round_grid(p, rng, level, top, r, gap, layout == "staggered", numbers, num, symbolic, crowd)
        if (layout in ("rows", "mixed") or (layout == "cabaret" and level >= 2)) and level >= 2 and not symbolic:
            num = long_rows(p, rng, level, (inner[0], H * 0.45 if layout == "mixed" else inner[1], inner[2], inner[3]), rng.uniform(28, 46) * scale, numbers, num)
        if level == 1 and layout in ("rows",):
            num = tables_round_grid(p, rng, level, inner, r, gap, False, numbers, num, symbolic, False)

    # L3 seating variety in free space: armchairs, sofas, benches, banquettes
    if level >= 3 and not symbolic:
        s = 26 * scale
        for _ in range(rng.randint(1, 4)):
            x, y = rng.uniform(m + 80, W - m - 80), rng.uniform(m + 80, H - m - 80)
            kind = rng.choice(["armchair", "sofa", "bench", "banquette"])
            L = s * rng.uniform(2.2, 4.5)
            if not p.free((x - L / 2 - 4, y - L / 2 - 4, x + L / 2 + 4, y + L / 2 + 4)):
                continue
            p.take((x - L / 2 - 4, y - L / 2 - 4, x + L / 2 + 4, y + L / 2 + 4))
            deg = rng.choice([0, 90]) if level < 4 else rng.choice([0, 90, 30, 135])
            if kind == "armchair":
                p.chair(x, y, s * 1.2, deg + 90, None, kind="arm", typ="armchair")
            elif kind == "sofa":
                p.sofa(x, y, L, s * 1.1, deg, rng.random() < 0.5)
            else:
                p.bench(x, y, L, s * 0.7, deg, rng.random() < 0.4, cls=kind)

    # L5: distractors, text over objects
    if level >= 5:
        r0 = 24 * scale
        for _ in range(rng.randint(2, 6)):
            p.distractor(rng.choice(["letter", "planter", "planter", "stamp", "legend"]), rng.uniform(m + 50, W - m - 50), rng.uniform(m + 50, H - m - 50), r0 * rng.uniform(0.8, 1.4))
        tables = [o for o in p.objects if o["class"] == "table"]
        for o in rng.sample(tables, min(len(tables), rng.randint(0, 3))):
            p.text(o["cx"] + o["w"] * 0.6, o["cy"], rng.choice(["VIP", "Rezerve", "Aile", "A"]), max(9, o["h"] * 0.35), fill=(180, 30, 30))

    img = p.img.resize((W, H), Image.LANCZOS)
    objs = p.objects
    meta = dict(family=fam["name"], familyIndex=fam_idx, level=level, layout=layout, seed=seed, numbers=numbers, gen=3)

    # L5: cut by the edge — the sheet is cropped
    if level >= 5 and rng.random() < 0.5:
        cx0, cy0 = int(W * rng.uniform(0, 0.12)), int(H * rng.uniform(0, 0.12))
        cx1, cy1 = W - int(W * rng.uniform(0, 0.12)), H - int(H * rng.uniform(0, 0.12))
        img = img.crop((cx0, cy0, cx1, cy1))
        objs = [dict(o, cx=round(o["cx"] - cx0, 1), cy=round(o["cy"] - cy0, 1)) for o in objs]
        W, H = img.size
        meta["cropped"] = True

    # L6: scanned
    if level >= 6:
        img, objs = scanned(img, objs, rng, meta)
    # L7: photographed
    if level >= 7:
        img, objs = photographed(img, objs, rng, meta)
    objs = visibility(objs, img.size, meta)
    return img, p, objs, meta


# ---- degradations, with labels carried through every transform -------------------------------
def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    b = np.array([c for pt in dst for c in pt], dtype=float)
    h = np.linalg.solve(np.array(A, dtype=float), b)
    return np.append(h, 1).reshape(3, 3)


def map_objects(objs, Hm):
    out = []
    for o in objs:
        corners = rot_pts([(o["cx"] - o["w"] / 2, o["cy"] - o["h"] / 2), (o["cx"] + o["w"] / 2, o["cy"] - o["h"] / 2),
                           (o["cx"] + o["w"] / 2, o["cy"] + o["h"] / 2), (o["cx"] - o["w"] / 2, o["cy"] + o["h"] / 2)], o["cx"], o["cy"], o.get("rotation", 0))
        pts = np.array([[x, y, 1.0] for x, y in corners]) @ Hm.T
        pts = pts[:, :2] / pts[:, 2:3]
        c = pts.mean(axis=0)
        w = (np.linalg.norm(pts[1] - pts[0]) + np.linalg.norm(pts[2] - pts[3])) / 2
        h = (np.linalg.norm(pts[3] - pts[0]) + np.linalg.norm(pts[2] - pts[1])) / 2
        deg = math.degrees(math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]))
        n = dict(o, cx=round(float(c[0]), 1), cy=round(float(c[1]), 1), w=round(float(w), 1), h=round(float(h), 1), rotation=round(deg % 360, 1))
        n["_corners"] = pts.tolist()
        out.append(n)
    return out


def scanned(img, objs, rng, meta):
    W, H = img.size
    a = np.asarray(img, dtype=np.float32)
    paper = np.array(rng.choice([(246, 242, 232), (238, 238, 238), (250, 248, 240)]), dtype=np.float32)
    a = a * (paper / 255.0)
    if rng.random() < 0.6:  # low contrast
        a = (a - 128) * rng.uniform(0.55, 0.85) + 128 + rng.uniform(-10, 15)
    if rng.random() < 0.5:  # fold line
        x = int(W * rng.uniform(0.3, 0.7))
        a[:, max(0, x - 2):x + 2] *= rng.uniform(0.82, 0.92)
    a = a + np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, rng.uniform(2, 7), a.shape)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    deg = rng.uniform(-3, 3)
    img2 = img.rotate(deg, resample=Image.BICUBIC, expand=False, fillcolor=(235, 235, 235))
    t = math.radians(-deg)
    cx, cy = W / 2, H / 2
    Hm = np.array([[math.cos(t), -math.sin(t), cx - cx * math.cos(t) + cy * math.sin(t)], [math.sin(t), math.cos(t), cy - cx * math.sin(t) - cy * math.cos(t)], [0, 0, 1]])
    objs = map_objects(objs, Hm)
    img2 = img2.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.0)))
    buf = io.BytesIO()
    img2.save(buf, "JPEG", quality=rng.randint(45, 85))
    meta["scanned"] = {"skewDeg": round(deg, 2)}
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB"), objs


def photographed(img, objs, rng, meta):
    W, H = img.size
    j = lambda s: rng.uniform(0, s)
    dst = [(j(0.08) * W, j(0.08) * H), (W - j(0.08) * W, j(0.08) * H), (W - j(0.08) * W, H - j(0.08) * H), (j(0.08) * W, H - j(0.08) * H)]
    src = [(0, 0), (W, 0), (W, H), (0, H)]
    Hm = homography(src, dst)          # sheet -> photo
    Hinv = np.linalg.inv(Hm)           # photo -> sheet, what PIL wants
    coeffs = (Hinv / Hinv[2, 2]).flatten()[:8]
    bg = rng.choice([(60, 55, 50), (120, 110, 95), (200, 195, 185)])
    img = img.transform((W, H), Image.PERSPECTIVE, tuple(coeffs), resample=Image.BICUBIC, fillcolor=bg)
    objs = map_objects(objs, Hm)
    a = np.asarray(img, dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    # a shadow across the sheet and uneven light
    gx, gy = rng.uniform(-1, 1), rng.uniform(-1, 1)
    shade = 1 - rng.uniform(0.15, 0.4) * np.clip((gx * (xx / W - 0.5) + gy * (yy / H - 0.5)) + 0.5, 0, 1)
    a = a * shade[..., None]
    glare = np.zeros((H, W), np.float32)
    if rng.random() < 0.6:
        gxc, gyc, gr = rng.uniform(0.2, 0.8) * W, rng.uniform(0.2, 0.8) * H, rng.uniform(0.08, 0.2) * min(W, H)
        glare = np.exp(-(((xx - gxc) ** 2 + (yy - gyc) ** 2) / (2 * gr * gr))).astype(np.float32)
        a = a + (255 - a) * (glare[..., None] * rng.uniform(0.6, 0.95))
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.6, 1.8)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=rng.randint(25, 60))
    meta["photo"] = {"glare": bool(glare.max() > 0)}
    meta["_glare"] = glare
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB"), objs


def visibility(objs, size, meta):
    """What a person could still see. More than 40 % outside the sheet, under
    glare, or shrunk below 6 px: `ignore`. Wholly outside: gone."""
    W, H = size
    glare = meta.pop("_glare", None)
    out = []
    for o in objs:
        corners = o.pop("_corners", None)
        if corners is None:
            corners = [(o["cx"] - o["w"] / 2, o["cy"] - o["h"] / 2), (o["cx"] + o["w"] / 2, o["cy"] + o["h"] / 2)]
        xs, ys = [c[0] for c in corners], [c[1] for c in corners]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        area = max(1e-6, (x1 - x0) * (y1 - y0))
        inside = max(0, min(x1, W) - max(x0, 0)) * max(0, min(y1, H) - max(y0, 0)) / area
        if inside <= 0:
            continue
        why = o.get("why")
        if inside < 0.6:
            why = "cut by the edge of the sheet"
        elif min(o["w"], o["h"]) < 6:
            why = "too small to see"
        elif glare is not None and 0 <= int(o["cy"]) < H and 0 <= int(o["cx"]) < W and glare[int(o["cy"]), int(o["cx"])] > 0.55:
            why = "washed out by glare"
        if why:
            o = dict(o, ignore=True, why=why)
            o.pop("number", None)  # an unreadable number is not a label
        out.append(o)
    return out


def annotation(plan_id, file, img, objs, p, meta, split, blind):
    return {
        "planId": plan_id,
        "source": {"file": file, "width": img.width, "height": img.height, "venue": f"synthetic:{meta['family']}", "layout": meta["layout"], "synthetic": True},
        "annotationMethod": "generated by training/synth_levels.py (generation 3): exact by construction, not a human judgement",
        "verification": "synthetic-exact",
        "level": meta["level"],
        "split": {"unit": "styleFamily+layout", "family": meta["family"], "familyIndex": meta["familyIndex"], "layoutSource": meta["layout"],
                  "set": split, "heldOutFamily": meta["familyIndex"] in HELD_OUT, "blind": blind},
        "generator": {k: v for k, v in meta.items() if k not in ("family", "familyIndex", "layout")},
        "objects": objs,
        "relationships": p.rels,
        "logicalGroups": p.groups,
    }


SEEDS = {"train": 1, "val": 2, "heldout": 3, "blind": 4}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--level", type=int, required=True, choices=range(1, 8))
    ap.add_argument("--count", type=int, default=20)
    ap.add_argument("--split", choices=list(SEEDS), required=True)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    fams = {"train": TRAIN_FAMILIES, "val": TRAIN_FAMILIES, "heldout": HELD_OUT, "blind": BLIND_FAMILIES}[a.split]
    layouts = BLIND_LAYOUTS + TRAIN_LAYOUTS if a.split == "blind" else TRAIN_LAYOUTS
    os.makedirs(a.out, exist_ok=True)
    index = []
    for i in range(a.count):
        fam = fams[i % len(fams)]
        seed = (SEEDS[a.split] * 1000003 + a.level * 10007 + a.seed * 101 + i)
        rng = random.Random(seed)
        layout = layouts[0] if (a.split == "blind" and i % 2 == 0) else rng.choice(TRAIN_LAYOUTS)
        img, p, objs, meta = draw_level(seed, fam, a.level, layout)
        pid = f"syn-{FAMILIES[fam]['name']}-L{a.level}-{seed}"
        img.save(os.path.join(a.out, pid + ".png"))
        with open(os.path.join(a.out, pid + ".json"), "w") as f:
            json.dump(annotation(pid, pid + ".png", img, objs, p, meta, a.split, a.split == "blind"), f)
        index.append(dict(planId=pid, family=meta["family"], level=a.level, layout=layout, objects=len(objs), ignored=sum(1 for o in objs if o.get("ignore"))))
    path = os.path.join(a.out, "index.json")
    prev = json.load(open(path)) if os.path.exists(path) else {"generator": "training/synth_levels.py", "gen": 3, "plans": []}
    prev["plans"] += index
    with open(path, "w") as f:
        json.dump(prev, f, indent=1)
    print(f"wrote {len(index)} level-{a.level} {a.split} plans to {a.out}")


if __name__ == "__main__":
    main()
