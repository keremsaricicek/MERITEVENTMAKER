"""Generation 5: closed-question crops for the local vision-language model (V5).

The V4 training set (vlm_lora.py data) was cut from plans drawn for the
detector, and it taught three things nobody meant to teach: every chair count
was even, so the model answers 3 → 4 and 7 → 8; every bench and banquette in
it served its table, so "bench" came to mean "yes"; and every separate pair of
tables stood at least 0.9 sides apart. This generator draws each crop for the
question it answers, with the label known by construction and the classes
balanced on purpose:

  identify  one object at the centre — a round / oval / square / rectangular /
            bistro table, a chair (eight drawn styles), a sofa, a bench, a
            banquette, a column, a stage, a bar, an entrance, a lodge (loca)
            box — or nothing, with partial neighbours at the edges
  count     2-6 whole tables, chairs and sofas around them
  chairs    a table standing alone with 1-14 chairs, odd and even alike, on
            round, oval, square and rectangular tops
  merged    2-4 tables in a straight row, turned, an L or a T: touching ("yes")
            or with a visible gap of 0.2-1.0 table sides ("no"), half and half
  serves    a sofa, bench or banquette against its table ("yes") or set apart
            from it, facing it or turned away ("no"), half and half PER PIECE

Counter-examples against learning the wrong thing:
  - a printed "N pax" beside a table that does NOT match the drawn chairs (the
    answer is what is drawn, never the printed figure);
  - words with no object ("BAR", "SAHNE", "SOFA", "8 pax") in an empty crop —
    the answer is "nothing";
  - colours swapped between classes (a sofa in the table's colour, a table in
    the sofa's), so a colour is never the answer.
A seat count for a sofa, bench or banquette is never asked: when its divisions
are not drawn, nobody can read it, and the product never takes it from a model.

Every crop carries a difficulty level 1-4 (1: clean drawing; 2: + line width,
scale, colour; 3: + fade, blur, noise, JPEG; 4: + photographed perspective,
shadow, strong JPEG). Labels never move with the photometric steps: they act on
the whole crop.

Splits by DRAWING FAMILY and seed base (synth_levels.FAMILIES):
  train  TRAIN_FAMILIES (0-7, 10-13), seed base 51
  dev    families 8, 9 (not 14/15: the V4/S1 test families stay out of every choice), base 52
  blind  families 16, 17 (never drawn for any VLM), base 53 — the frozen V5 test
One family per item in turn, checked per stratum. dev and blind are boosted
where a bar needs n (BOOST), and print a figure on half their chairs crops,
half matching the drawing.

    python -I training/synth_vlm.py --split train --out DIR [--scale 1.0]
    python -I training/synth_vlm.py --split blind --out DIR --scale 0.08
"""
import argparse
import io
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth_levels as L  # noqa: E402
from synth import SS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = json.load(open(os.path.join(ROOT, "server", "local-check-questions.json")))
WORDS = SPEC["words"]
PIECES = SPEC["pieces"]


def Q(task, piece=None):
    q = SPEC["questions"][task]
    return SPEC["preamble"] + q.replace("{words}", ", ".join(WORDS)).replace("{piece}", piece or "")


# blind3 (2026-10-25): a fresh V5 test, same never-trained families, new seed
# base — for an adapter made after the V5 test's results were seen (runB6b).
SPLITS = {"train": (L.TRAIN_FAMILIES, 51), "dev": ([8, 9], 52), "blind": (L.BLIND2_FAMILIES, 53), "blind3": (L.BLIND2_FAMILIES, 54),
          "train2": (L.TRAIN_FAMILIES, 55), "blind4": (L.BLIND2_FAMILIES, 56)}  # train2: B6c's extra crops, training families, new seeds (2026-10-27)
CHAIR_KINDS = ["rect", "rounded", "arm", "circle", "backrest", "petal", "semicircle", "silhouette"]
PALETTE = [(232, 216, 176), (205, 235, 232), (240, 228, 200), (225, 225, 225), (232, 110, 40), (60, 140, 140), (160, 205, 170),
           (120, 90, 160), (200, 215, 245), (250, 226, 230), (176, 188, 226), (90, 90, 90), (255, 255, 255)]
NOISE_WORDS = ["BAR", "SAHNE", "STAGE", "SOFA", "8 pax", "10 pax", "T12", "VIP", "GİRİŞ", "LOCA", "DJ", "SERVİS", "WC", "PODYUM", "ENTRANCE", "LOCA 3", "GIRIS"]

# How many items per stratum at --scale 1.0 (the training set).
PLAN = {
    "identify": {c: 150 for c in ["table", "chair", "sofa", "bench", "banquette", "column", "stage", "bar", "entrance", "lodge", "nothing"]},
    "count": {n: 50 for n in range(1, 7)},
    "chairs": {n: 48 for n in range(1, 15)},
    "merged": {"yes": 330, "no": 330},
    "serves": {(p, lab): 120 for p in PIECES for lab in ("yes", "no")},
}


# ---- drawing ------------------------------------------------------------------------------
class Scene:
    """One canvas; every object drawn is recorded with its box, so a crop can be
    checked against what it shows."""

    def __init__(self, fam, rng, side):
        self.fam, self.rng = fam, rng
        self.p = L.Plan3(int(side), int(side), fam, rng)
        self.objs = []

    def rec(self, cls, cx, cy, w, h, deg=0, **kw):
        o = dict(cls=cls, cx=cx, cy=cy, w=w, h=h, deg=deg, **kw)
        self.objs.append(o)
        return o

    # tables ---------------------------------------------------------------------------------
    def table(self, kind, cx, cy, u, deg=0, fill="fam", lf=None):
        fam, p = self.fam, self.p
        fill = (fam.get("round_fill") or fam["table_fill"]) if fill == "fam" else fill
        line, lw = fam["line"], fam["lw"]
        if kind in ("round", "bistro"):
            r = u * (0.62 if kind == "round" else 0.36)
            p.ellipse(cx, cy, r, r, fill, line, lw)
            if fam.get("centre_dot"):
                p.ellipse(cx, cy, r * 0.12, r * 0.12, (60, 140, 70), (30, 80, 40), 1)
            return self.rec("table", cx, cy, 2 * r, 2 * r, 0, shape=kind)
        if kind == "oval":
            rx, ry = u * 0.85, u * 0.5
            if deg % 180:
                rx, ry = ry, rx
            p.ellipse(cx, cy, rx, ry, fill, line, lw)
            return self.rec("table", cx, cy, 2 * rx, 2 * ry, 0, shape=kind)
        w, h = (u, u) if kind == "square" else (u * (lf or self.rng.uniform(1.6, 2.4)), u * 0.85)
        p.rect(cx, cy, w, h, deg, fill, line, lw)
        return self.rec("table", cx, cy, w, h, deg, shape=kind)

    def chairs_around(self, t, n, kind, cs, offset=0.6):
        """n chairs around table t, evenly by angle (round/oval), or spread over
        the four sides by their length and centred on each (square/rectangle:
        never on a corner, where a first cut drew them overlapping), each facing
        the table. Never crowded: n is cut to what fits side by side (the chairs
        task grows its table instead). Returns how many were drawn."""
        pts = []
        if t["shape"] in ("round", "bistro", "oval"):
            n = min(n, int(math.pi * (t["w"] + t["h"] + 2 * cs * offset) / 2 // (cs * 1.15)))
        else:
            fit = [int(t["w"] // (cs * 1.15)), int(t["h"] // (cs * 1.15))] * 2
            n = min(n, sum(fit))
        if t["shape"] in ("round", "bistro", "oval"):
            a0 = self.rng.uniform(0, 360)
            for i in range(n):
                a = math.radians(a0 + 360 * i / n)
                rx, ry = t["w"] / 2 + cs * offset, t["h"] / 2 + cs * offset
                pts.append((t["cx"] + math.cos(a) * rx, t["cy"] + math.sin(a) * ry))
        else:
            w, h, deg = t["w"], t["h"], t["deg"]
            sides = [w, h, w, h]
            # by length, largest remainder, then a random side first among ties; never past a side's fit
            share = [0, 0, 0, 0]
            order = sorted(range(4), key=lambda i: (-sides[i], self.rng.random()))
            for k in range(n):
                i = min((i for i in order if share[i] < fit[i]), key=lambda i: (share[i] + 1) / sides[i])
                share[i] += 1
            a = math.radians(deg)
            for i, m in enumerate(share):
                for k in range(m):
                    s = (k + 0.5) / m - 0.5
                    x, y = [(s * w, -h / 2 - cs * offset), (w / 2 + cs * offset, s * h), (-s * w, h / 2 + cs * offset), (-w / 2 - cs * offset, -s * h)][i]
                    pts.append((t["cx"] + x * math.cos(a) - y * math.sin(a), t["cy"] + x * math.sin(a) + y * math.cos(a)))
        for x, y in pts:
            self.p.chair(x, y, cs, math.degrees(math.atan2(t["cy"] - y, t["cx"] - x)), None, kind=kind)
            self.rec("chair", x, y, cs, cs)
        return len(pts)

    # seating furniture -------------------------------------------------------------------------
    def piece(self, cls, cx, cy, length, depth, deg, fill=None):
        divided = self.rng.random() < 0.5
        saved = (self.fam.get("sofa_fill"), self.fam.get("chair_fill"))
        if fill is not None:
            self.fam["sofa_fill"] = fill
            self.fam["chair_fill"] = fill
        try:
            if cls == "sofa":
                self.p.sofa(cx, cy, length, depth, deg, divided)
            else:
                self.p.bench(cx, cy, length, depth, deg, divided, cls=cls)
        finally:
            self.fam["sofa_fill"], self.fam["chair_fill"] = saved
        return self.rec(cls, cx, cy, length, depth, deg)

    # venue objects ---------------------------------------------------------------------------------
    def column(self, cx, cy, u):
        s = u * self.rng.uniform(0.35, 0.6)
        if self.rng.random() < 0.5:
            self.p.rect(cx, cy, s, s, 0, self.fam["line"], self.fam["line"], 1)
        else:
            self.p.ellipse(cx, cy, s / 2, s / 2, self.fam["line"], self.fam["line"], 1)
        return self.rec("column", cx, cy, s, s)

    def stage(self, cx, cy, u):
        w, h = u * self.rng.uniform(4, 7), u * self.rng.uniform(1.6, 2.6)
        fill = self.rng.choice([self.fam["table_fill"] or (235, 235, 235), (230, 236, 246), (240, 240, 240), None])
        self.p.rect(cx, cy, w, h, 0, fill, self.fam["line"], self.fam["lw"] + 1)
        steps = self.rng.random() < 0.5
        words = not steps or self.rng.random() < 0.6  # never a bare rectangle: that is a table's drawing too
        if steps:
            for k in range(3):
                self.p.rect(cx + (k - 1) * u * 0.35, cy + h / 2 + u * 0.12, u * 0.3, u * 0.22, 0, None, self.fam["line"], 1)
        if words:
            self.p.text(cx, cy, self.rng.choice(["SAHNE", "STAGE", "PODYUM"]), h * 0.3)
        return self.rec("stage", cx, cy, w, h, labelled=words)

    def bar(self, cx, cy, u):
        w, h = u * self.rng.uniform(2.5, 4.5), u * self.rng.uniform(0.6, 0.9)
        fill = self.rng.choice([(90, 70, 60), (200, 190, 180), self.fam["table_fill"] or (220, 220, 220)])
        self.p.rect(cx, cy, w, h, 0, fill, self.fam["line"], self.fam["lw"])
        if self.rng.random() < 0.5:  # an L return
            self.p.rect(cx + w / 2 - h / 2, cy + h * 1.2, h, h * 1.6, 0, fill, self.fam["line"], self.fam["lw"])
        stools = self.rng.random() < 0.6
        if stools:  # along the front
            for k in range(int(w // (u * 0.6))):
                self.p.ellipse(cx - w / 2 + u * 0.4 + k * u * 0.6, cy - h / 2 - u * 0.3, u * 0.14, u * 0.14, None, self.fam["line"], 1)
        words = not stools or self.rng.random() < 0.6  # a bare long box is a table's drawing too
        if words:
            self.p.text(cx, cy, "BAR", h * 0.55, fill=(255, 255, 255) if fill[0] < 120 else None)
        return self.rec("bar", cx, cy, w, h, labelled=words)

    def entrance(self, cx, cy, u):
        r = u * self.rng.uniform(0.7, 1.1)
        line = self.fam["line"]
        d = self.p.d
        double = self.rng.random() < 0.4
        for sgn in ((-1, 1) if double else (1,)):
            hx = cx - sgn * r if double else cx - r
            d.line([hx * SS, cy * SS, (hx + sgn * r) * SS if double else (cx + r) * SS, cy * SS], fill=line, width=max(1, self.fam["lw"]) * SS)
            box = [(hx - r) * SS, (cy - r) * SS, (hx + r) * SS, (cy + r) * SS]
            d.arc(box, 270 if sgn > 0 else 180, 360 if sgn > 0 else 270, fill=line, width=SS)
            d.line([hx * SS, cy * SS, hx * SS, (cy - r) * SS], fill=line, width=SS)
        # the wall it opens in
        d.line([(cx - 3 * r) * SS, cy * SS, (cx - (2 * r if double else r)) * SS, cy * SS], fill=line, width=max(2, self.fam["lw"] + 1) * SS)
        d.line([(cx + (2 * r if double else r)) * SS, cy * SS, (cx + 3 * r) * SS, cy * SS], fill=line, width=max(2, self.fam["lw"] + 1) * SS)
        words = self.rng.random() < 0.6
        if words:
            self.p.text(cx, cy + r * 0.55, self.rng.choice(["GİRİŞ", "ENTRANCE", "GIRIS"]), r * 0.4)
        return self.rec("entrance", cx, cy, (4 if double else 2) * r, r, labelled=words)

    def lodge(self, cx, cy, u):
        w, h = u * self.rng.uniform(2.2, 3.4), u * self.rng.uniform(1.6, 2.4)
        line = self.fam["line"]
        self.p.rect(cx, cy, w, h, 0, self.rng.choice([None, (245, 240, 230), (235, 240, 250)]), line, self.fam["lw"] + 1)
        self.p.rect(cx, cy - h / 2 + u * 0.18, w * 0.9, u * 0.22, 0, self.fam.get("sofa_fill") or (200, 200, 200), line, 1)  # its own sofa along the back
        if self.rng.random() < 0.5:
            self.p.ellipse(cx, cy + h * 0.1, u * 0.3, u * 0.3, self.fam["table_fill"], line, 1)
        words = self.rng.random() < 0.8  # a lodge is usually labelled, not always
        if words:
            self.p.text(cx, cy + h * 0.32, self.rng.choice(["LOCA", "LOCA 3", "VIP 2", "L-4", "LOCA A"]), h * 0.16)
        return self.rec("lodge", cx, cy, w, h, labelled=words)


# ---- one centre object of a class ----------------------------------------------------------------
def draw_centre(sc, cls, cx, cy, u, cs, chair_kind, colour_swap):
    rng = sc.rng
    if cls == "table":
        kind = rng.choice(["round", "oval", "square", "rect", "bistro"])
        fill = rng.choice(PALETTE) if colour_swap else "fam"
        t = sc.table(kind, cx, cy, u, rng.choice([0, 0, 90, 30, 45]) if kind in ("square", "rect") else 0, fill=fill)
        if rng.random() < 0.6:
            sc.chairs_around(t, rng.randint(1, 10), chair_kind, cs)
        return t
    if cls == "chair":
        # A chair alone on paper is a filled square or circle — a column's or a
        # small table's drawing too (seen on the first contact sheet). A plan
        # draws it at the table it faces, so the crop shows that table's edge.
        kind = rng.choice(CHAIR_KINDS)
        size = cs * rng.uniform(1.0, 1.25)
        face = rng.uniform(0, 360)
        if rng.random() < 0.9:
            tk = rng.choice(["round", "square", "rect"])
            tr = u * {"round": 0.62, "square": 0.5, "rect": 0.425}[tk]  # a rectangle turned so the chair is at a long side
            d = tr + size * 0.6
            sc.table(tk, cx + math.cos(math.radians(face)) * d, cy + math.sin(math.radians(face)) * d, u, {"round": 0, "square": face, "rect": face + 90}[tk])
            sc.objs.pop()  # the table is context, not the labelled object
        sc.p.chair(cx, cy, size, face, None, kind=kind)
        return sc.rec("chair", cx, cy, size, size)
    if cls in PIECES:
        length = u * rng.uniform(1.6, 2.6) if cls != "banquette" else u * rng.uniform(2.6, 4.0)
        depth = u * (0.8 if cls == "sofa" else 0.42 if cls == "bench" else 0.5)
        fill = (sc.fam.get("round_fill") or sc.fam["table_fill"] or (225, 225, 225)) if colour_swap else None
        return sc.piece(cls, cx, cy, length, depth, rng.choice([0, 90, 30, -30, 180]), fill=fill)
    return {"column": sc.column, "stage": sc.stage, "bar": sc.bar, "entrance": sc.entrance, "lodge": sc.lodge}[cls](cx, cy, u)


def inside(o, x, y, pad=0):
    """Is (x, y) within the (turned) box of o, grown by pad?"""
    a = math.radians(-o.get("deg", 0))
    dx, dy = x - o["cx"], y - o["cy"]
    lx, ly = dx * math.cos(a) - dy * math.sin(a), dx * math.sin(a) + dy * math.cos(a)
    return abs(lx) <= o["w"] / 2 + pad and abs(ly) <= o["h"] / 2 + pad


def neighbours(sc, cx, cy, side, u, cs, chair_kind, k, keep):
    """Partial objects at the crop's edges. `keep` is the radius around the
    centre that holds the labelled object(s): no neighbour reaches into it by
    less than a clear chair's width of paper (a first cut let a neighbour
    table's chairs touch the centre chair)."""
    rng = sc.rng
    for _ in range(k):
        a = rng.uniform(0, 2 * math.pi)
        what = rng.choice(["table", "table", "chair", "sofa", "column", "wall"])
        reach = {"table": u * 0.62 + cs * 1.2, "chair": cs * 0.8, "sofa": u * 1.1, "column": u * 0.35, "wall": 0}[what]
        d = max(side * rng.uniform(0.48, 0.62), keep + cs * 1.5 + reach)
        if d - reach > side * 0.5 * 1.42:  # it would not show in the crop at all
            continue
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
        if what == "table":
            t = sc.table(rng.choice(["round", "square"]), x, y, u * rng.uniform(0.8, 1.0))
            if rng.random() < 0.6:
                sc.chairs_around(t, rng.randint(2, 8), chair_kind, cs)
        elif what == "chair":
            sc.p.chair(x, y, cs, rng.uniform(0, 360), None, kind=chair_kind)
        elif what == "sofa":
            sc.piece("sofa", x, y, u * 2, u * 0.8, rng.choice([0, 90]))
        elif what == "column":
            sc.column(x, y, u)
        else:  # a wall, tangent to the circle the neighbours stand on, so it never crosses the centre
            tx, ty = -math.sin(a) * side, math.cos(a) * side
            sc.p.d.line([(x - tx) * SS, (y - ty) * SS, (x + tx) * SS, (y + ty) * SS], fill=sc.fam["line"], width=max(2, sc.fam["lw"] + 1) * SS)


# ---- photometric difficulty ------------------------------------------------------------------------
def degrade(img, level, rng):
    if level >= 2 and rng.random() < 0.5:  # a slight turn of the whole sheet
        img = img.rotate(rng.uniform(-6, 6), resample=Image.BICUBIC, fillcolor=img.getpixel((2, 2)))
    if level >= 3:
        a = np.asarray(img, dtype=np.float32)
        if rng.random() < 0.7:  # faded print
            a = (a - 128) * rng.uniform(0.45, 0.85) + 128 + rng.uniform(-5, 25)
        a = a + np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, rng.uniform(1, 6), a.shape)
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
        buf = io.BytesIO(); img.save(buf, "JPEG", quality=rng.randint(40, 85)); img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    if level >= 4:
        W, H = img.size
        j = lambda: rng.uniform(0, 0.05)
        src = [(0, 0), (W, 0), (W, H), (0, H)]
        dst = [(j() * W, j() * H), (W - j() * W, j() * H), (W - j() * W, H - j() * H), (j() * W, H - j() * H)]
        Hm = L.homography(src, dst)
        Hinv = np.linalg.inv(Hm)
        img = img.transform((W, H), Image.PERSPECTIVE, tuple((Hinv / Hinv[2, 2]).flatten()[:8]), resample=Image.BICUBIC, fillcolor=(120, 115, 105))
        a = np.asarray(img, dtype=np.float32)
        yy, xx = np.mgrid[0:H, 0:W]
        gx, gy = rng.uniform(-1, 1), rng.uniform(-1, 1)
        a = a * (1 - rng.uniform(0.1, 0.35) * np.clip(gx * (xx / W - 0.5) + gy * (yy / H - 0.5) + 0.5, 0, 1))[..., None]
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 1.4)))
        buf = io.BytesIO(); img.save(buf, "JPEG", quality=rng.randint(25, 55)); img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    return img


def family(fam_idx, rng, level):
    fam = dict(L.FAMILIES[fam_idx])
    if fam.get("chair") is None:
        fam["chair"] = "rect"
        fam["chair_fill"] = fam.get("chair_fill") or (230, 230, 230)
    if level >= 2:
        fam["lw"] = max(1, fam["lw"] + rng.choice([-1, 0, 0, 1, 2]))
        if rng.random() < 0.3:
            fam["table_fill"] = rng.choice(PALETTE)
    return fam


# ---- one item ----------------------------------------------------------------------------------------
# The test and dev are boosted where a bar needs n (QA pre-audit 2026-10-24):
# empty crops, serves per piece and answer, chairs, merged; printed figures on
# half the chairs crops.
BOOST = {"train": {}, "dev": {"identify:nothing": 2.67, "chairs": 1.6, "merged": 1.2, "serves": 3.33},
         "blind": {"identify:nothing": 2.67, "chairs": 1.6, "merged": 1.2, "serves": 3.33}}
BOOST["blind3"] = BOOST["blind4"] = BOOST["blind"]
# train2 (B6c): weight on what runB6b got wrong — furniture identify (bench 10/15
# on the fresh test), serves "yes" on pieces that do not serve; little else.
BOOST["train2"] = {"identify": 0.3, "identify:sofa": 1.5, "identify:bench": 2.0, "identify:banquette": 1.5, "identify:nothing": 0.6,
                   "count": 0.3, "chairs": 0.4, "merged": 0.3, "serves": 1.5}
PRINTED = {"train": 0.25, "dev": 0.5, "blind": 0.5, "blind3": 0.5, "train2": 0.25, "blind4": 0.5}


def make(task, stratum, rng, fam_idx, size=448, split="train"):
    level = rng.choices([1, 2, 3, 4], weights=[3, 3, 2, 2])[0]
    fam = family(fam_idx, rng, level)
    u = rng.uniform(44, 80)
    cs = u * rng.uniform(0.42, 0.6)
    chair_kind = rng.choice(CHAIR_KINDS + [fam["chair"]] * 3)
    colour_swap = rng.random() < 0.25
    W = int(u * 16)
    sc = Scene(fam, rng, W)
    cx = cy = W / 2
    sub, truth, q = None, None, None

    if task == "identify":
        cls = stratum
        truth = cls
        if cls == "nothing":
            if rng.random() < 0.5:  # a word with no object
                sc.p.text(cx + rng.uniform(-u, u), cy + rng.uniform(-u, u), rng.choice(NOISE_WORDS), u * rng.uniform(0.35, 0.6))
                sub = "nothing-word"
            else:
                sub = "nothing"
            side = rng.uniform(2.2, 3.6) * u
        else:
            o = draw_centre(sc, cls, cx, cy, u, cs, chair_kind, colour_swap)
            big = max(o["w"], o["h"])
            side = 1.15 * big if cls == "stage" else 2.0 * big + 30
            sub = cls + ({True: "-labelled", False: "-unlabelled"}[o["labelled"]] if "labelled" in o else "")
            if rng.random() < 0.15 and cls != "nothing":  # a misleading word beside it
                sc.p.text(cx + big * 0.9, cy - big * 0.7, rng.choice(NOISE_WORDS), u * 0.3)
                sub = cls + "-word"
        keep = 0 if cls == "nothing" else math.hypot(o["w"], o["h"]) / 2 + (cs * 1.3 if cls == "table" else 0)
        neighbours(sc, cx, cy, side, u, cs, chair_kind, rng.randint(0, 3), keep)
        q = Q("identify")

    elif task == "count":
        n = stratum
        span = u * (2.8 + 1.3 * n)
        placed = []
        tries = 0
        while len(placed) < n and tries < 400:
            tries += 1
            x, y = cx + rng.uniform(-span / 2, span / 2) * 0.7, cy + rng.uniform(-span / 2, span / 2) * 0.7
            if all(math.hypot(x - a, y - b) > u * 3.0 for a, b in placed):
                placed.append((x, y))
        if len(placed) < n:
            return None
        for x, y in placed:
            k_ = rng.choice(["round", "square", "rect", "oval"])
            t = sc.table(k_, x, y, u * rng.uniform(0.85, 1.1), rng.choice([0, 0, 90, 30]) if k_ in ("square", "rect") else 0)
            if rng.random() < 0.7:
                sc.chairs_around(t, rng.randint(1, 8), chair_kind, cs)
        if rng.random() < 0.5:  # a sofa or bench among them, never on a table
            px, py = cx + rng.uniform(-span, span) * 0.35, cy + rng.uniform(-span, span) * 0.35
            if all(math.hypot(px - a_, py - b_) > u * 2.4 for a_, b_ in placed):
                sc.piece(rng.choice(PIECES), px, py, u * 1.8, u * 0.6, rng.choice([0, 90]))
        xs = [o for o in sc.objs if o["cls"] == "table"]
        ext = [(abs(o["w"] / 2 * math.cos(math.radians(o["deg"]))) + abs(o["h"] / 2 * math.sin(math.radians(o["deg"]))),
                abs(o["w"] / 2 * math.sin(math.radians(o["deg"]))) + abs(o["h"] / 2 * math.cos(math.radians(o["deg"])))) for o in xs]
        x0 = min(o["cx"] - e[0] for o, e in zip(xs, ext)); x1 = max(o["cx"] + e[0] for o, e in zip(xs, ext))
        y0 = min(o["cy"] - e[1] for o, e in zip(xs, ext)); y1 = max(o["cy"] + e[1] for o, e in zip(xs, ext))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        side = max(x1 - x0, y1 - y0) + 2.6 * cs + 40
        truth, sub, q = n, str(n), Q("count")

    elif task == "chairs":
        n = stratum
        kind = rng.choice(["round", "round", "oval", "square", "rect"])
        ccs = cs * (0.85 if n >= 11 else 1.0)
        lf = rng.uniform(1.6, 2.4)
        uu = u * (1.0 if n <= 8 else 1.3)
        while True:  # the top grows until n chairs fit side by side (chairs_around's own rule)
            if kind in ("round", "oval"):
                rx, ry = (0.62 * uu, 0.62 * uu) if kind == "round" else (0.85 * uu, 0.5 * uu)
                fit = int(math.pi * (2 * rx + 2 * ry + 2 * ccs * 0.6) / 2 // (ccs * 1.15))
            else:
                w_, h_ = (uu, uu) if kind == "square" else (uu * lf, uu * 0.85)
                fit = 2 * int(w_ // (ccs * 1.15)) + 2 * int(h_ // (ccs * 1.15))
            if fit >= n:
                break
            uu *= 1.08
        t = sc.table(kind, cx, cy, uu, rng.choice([0, 0, 90, 30]) if kind in ("square", "rect") else 0, lf=lf)
        assert sc.chairs_around(t, n, chair_kind, ccs) == n
        side = 2.4 * max(t["w"], t["h"]) + 50
        sub = ("odd" if n % 2 else "even")
        if rng.random() < PRINTED[split]:  # a printed figure: half the time the drawing's own, half not
            match = rng.random() < 0.5
            shown = n if match else rng.choice([v for v in range(2, 15) if v != n])
            sc.p.text(cx, cy + max(t["w"], t["h"]) / 2 + cs * 1.4, f"{shown} pax", cs * 0.55)
            sub += "-printed-match" if match else "-printed-wrong"
        neighbours(sc, cx, cy, side * 1.15, u, cs, chair_kind, rng.randint(0, 2), max(t["w"], t["h"]) / 2 + cs * 1.4)
        truth, q = n, Q("chairs")

    elif task == "merged":
        lab = stratum
        n = rng.randint(2, 4)
        shape = rng.choice(["row", "row", "turned", "L", "T"]) if n >= 3 else rng.choice(["row", "turned"])
        tw = u * rng.choice([1.0, 1.0, 1.6])
        th = u
        gap = 0 if lab == "yes" else max(u * rng.uniform(0.2, 1.0), 3 * fam["lw"] + 5)
        deg = rng.uniform(15, 75) if shape == "turned" else rng.choice([0, 90])
        a = math.radians(deg)
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        cells = []
        if shape in ("row", "turned"):
            cells = [(i - (n - 1) / 2, 0) for i in range(n)]
        elif shape == "L":
            cells = [(i - (n - 2) / 2, 0) for i in range(n - 1)] + [((n - 2) / 2, 1)]
        else:  # T
            cells = [(i - (n - 2) / 2, 0) for i in range(n - 1)] + [(0 if n == 3 else 0.5 - 0.5, 1)]
        tabs = []
        for i, j in cells:
            x = cx + ux * i * (tw + gap) + vx * j * (th + gap)
            y = cy + uy * i * (tw + gap) + vy * j * (th + gap)
            sc.p.rect(x, y, tw, th, deg, fam["table_fill"], fam["line"], fam["lw"])
            tabs.append(sc.rec("table", x, y, tw, th, deg, shape="rect"))
        if rng.random() < 0.5:  # chairs along the outside
            for t in tabs:
                for sgn in (-1, 1):
                    if rng.random() < 0.7:
                        x, y = t["cx"] + vx * sgn * (th / 2 + cs * 0.6), t["cy"] + vy * sgn * (th / 2 + cs * 0.6)
                        if any(inside(o, x, y, cs * 0.6) for o in tabs if o is not t):
                            continue
                        sc.p.chair(x, y, cs, math.degrees(math.atan2(t["cy"] - y, t["cx"] - x)), None, kind=chair_kind)
        # the product's framing (MeritLocalCheck.frameFor): the members' union, x1.25 + 40
        ex = abs(tw / 2 * math.cos(a)) + abs(th / 2 * math.sin(a)); ey = abs(tw / 2 * math.sin(a)) + abs(th / 2 * math.cos(a))
        x0 = min(t["cx"] for t in tabs) - ex; x1 = max(t["cx"] for t in tabs) + ex
        y0 = min(t["cy"] for t in tabs) - ey; y1 = max(t["cy"] for t in tabs) + ey
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        side = max(x1 - x0, y1 - y0) * 1.25 + 40
        sub = f"{lab}-{shape}" + ("" if lab == "yes" else ("-near" if gap < 0.45 * u else "-apart"))
        neighbours(sc, cx, cy, side * 1.1, u, cs, chair_kind, rng.randint(0, 2), math.hypot(x1 - x0, y1 - y0) / 2 + cs * 1.3)
        truth, q = lab, Q("merged")

    elif task == "serves":
        piece, lab = stratum
        deg = rng.choice([0, 90, 30, -30])
        a = math.radians(deg)
        vx, vy = -math.sin(a), math.cos(a)
        kind = rng.choice(["square", "rect", "round"])
        t = sc.table(kind, cx, cy, u, deg if kind != "round" else 0)
        length = u * (rng.uniform(1.6, 2.4) if piece != "banquette" else rng.uniform(2.4, 3.6))
        depth = u * (0.8 if piece == "sofa" else 0.42 if piece == "bench" else 0.5)
        th = t["h"] if kind != "round" else t["w"]
        if lab == "yes":
            gap, facing = u * rng.uniform(0.0, 0.12), True
            sub = f"{piece}-yes"
        else:
            # "near" (0.2-0.5 sides, facing) is a zone a person could argue either
            # way for a lounge sofa: asked in dev/test and reported on its own,
            # never trained, never in a bar
            kinds_ = ["far-facing", "far-away"] + (["near"] if split not in ("train", "train2") else []) + (["back"] if piece != "bench" else [])  # a bench has no back to turn
            k_ = rng.choice(kinds_)
            gap = u * (rng.uniform(0.55, 1.5) if k_.startswith("far") else rng.uniform(0.2, 0.5) if k_ == "near" else rng.uniform(0.0, 0.12))
            facing = k_ in ("far-facing", "near")
            sub = f"{piece}-no-{k_}"
        off = th / 2 + gap + depth / 2
        # sofa(): back on its own -v side. Facing the table from +v means turned half a turn.
        pdeg = deg + (180 if facing else 0)
        fill = (fam.get("round_fill") or fam["table_fill"]) if colour_swap else None
        sc.piece(piece, cx + vx * off, cy + vy * off, length, depth, pdeg, fill=fill)
        # the table's own chairs on the far side, so a table never stands bare
        if rng.random() < 0.7:
            for k in range(rng.randint(1, 3)):
                x = cx - vx * (th / 2 + cs * 0.6) + (k - 1) * cs * 1.2 * math.cos(a)
                y = cy - vy * (th / 2 + cs * 0.6) + (k - 1) * cs * 1.2 * math.sin(a)
                sc.p.chair(x, y, cs, math.degrees(math.atan2(cy - y, cx - x)), None, kind=chair_kind)
        pcx, pcy = cx + vx * off, cy + vy * off
        cx, cy = (cx + pcx) / 2, (cy + pcy) / 2
        side = (off + max(th, length) / 2 + depth) * 1.3 + 30
        side = max(side, max(length, t["w"]) * 1.3 + 30)
        neighbours(sc, cx, cy, side * 1.1, u, cs, chair_kind, rng.randint(0, 2), off / 2 + max(th, length) / 2 + depth + cs)
        truth, q = lab, Q("serves", piece)

    img = sc.p.img.resize((W, W), Image.LANCZOS)
    s = side * rng.uniform(0.95, 1.08)
    c = L_crop(img, cx + rng.uniform(-0.03, 0.03) * s, cy + rng.uniform(-0.03, 0.03) * s, s, size)
    k = rng.randrange(4)
    if k:
        c = c.rotate(90 * k)
    c = degrade(c, level, rng)
    return dict(task=task, sub=sub, truth=truth, q=q, level=level, family=L.FAMILIES[fam_idx]["name"], image=c)


def L_crop(img, cx, cy, side, out):
    side = max(48, int(side))
    x0, y0 = int(cx - side / 2), int(cy - side / 2)
    paper = img.getpixel((1, 1))
    c = Image.new("RGB", (side, side), paper)
    W, H = img.size
    bx0, by0, bx1, by1 = max(0, x0), max(0, y0), min(W, x0 + side), min(H, y0 + side)
    if bx1 > bx0 and by1 > by0:
        c.paste(img.crop((bx0, by0, bx1, by1)), (bx0 - x0, by0 - y0))
    return c.resize((out, out), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=list(SPLITS), required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--scale", type=float, default=1.0, help="items per stratum = round(PLAN * scale), at least 1")
    ap.add_argument("--size", type=int, default=448)
    a = ap.parse_args()
    fams, base = SPLITS[a.split]
    os.makedirs(os.path.join(a.out, "img"), exist_ok=True)
    rows, tally, k = [], {}, 0
    for task, strata in PLAN.items():
        for stratum, n in strata.items():
            b = BOOST[a.split]
            want = max(1, round(n * a.scale * b.get(f"{task}:{stratum}", b.get(task, 1.0))))
            made = 0
            attempt = 0
            while made < want:
                seed = base * 1000003 + k * 97 + attempt
                rng = random.Random(seed)
                # one family per ITEM in turn (a first cut stepped by two per
                # item and tied each answer to one family: QA pre-audit)
                fam = fams[k % len(fams)]
                it = make(task, stratum, rng, fam, a.size, a.split)
                attempt += 1
                if it is None:
                    continue
                name = f"img/{len(rows):05d}.png"
                it["image"].save(os.path.join(a.out, name))
                rows.append(dict(task=it["task"].upper() if it["task"] != "identify" else ("NEG" if it["truth"] == "nothing" else "ID"),
                                 sub=it["sub"], truth=it["truth"], q=it["q"], level=it["level"], family=it["family"], seed=seed, split=a.split, image=name))
                made += 1
                k += 1
            key = f"{task}:{stratum}"
            tally[key] = made
            fc = {}
            for r in rows[-made:]:
                fc[r["family"]] = fc.get(r["family"], 0) + 1
            if made >= len(fams) and (len(fc) < len(fams) or max(fc.values()) - min(fc.values()) > 1):
                raise SystemExit(f"stratum {key} is not family-balanced: {fc}")
    with open(os.path.join(a.out, "items.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    meta = dict(generator="training/synth_vlm.py", split=a.split, families=[L.FAMILIES[i]["name"] for i in fams], seedBase=base, scale=a.scale, n=len(rows),
                words=WORDS, tally=tally)
    json.dump(meta, open(os.path.join(a.out, "meta.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: meta[k] for k in ("split", "families", "n")}))


if __name__ == "__main__":
    main()
