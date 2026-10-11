"""Procedural banquet plans for training and held-out style tests.

Synthetic data is auxiliary. It teaches a detector what tables, chairs and
columns look like across many drawing styles; it is never reported as
real-venue accuracy (benchmarks/offline-intelligence/ACCEPTANCE.md).

Every plan is drawn from a STYLE FAMILY (how symbols are drawn) and a LAYOUT
(where things are). Splits are made by style family, so a held-out family is a
way of drawing that the model never saw. A crop or a colour variant of one plan
never lands on both sides of a split, because the split unit is the family.

Labels use the repository's annotation schema (benchmarks/annotations):
pixel centre, size, rotation, class, type, printed number, chair-to-table
relationship and merged-table groups. Every label here is GENERATED, so its
verification state is "synthetic-exact": exact by construction, and not a
human judgement.

    python training/synth.py --out DIR --count N --families 0,1,2 --seed 7
"""
import argparse
import io
import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/freefont"]
FONTS = [os.path.join(d, f) for d in FONT_DIRS if os.path.isdir(d) for f in sorted(os.listdir(d)) if f.endswith(".ttf")]

# A family fixes HOW things are drawn. Ten families: 0-7 are training
# families, 8-9 are held out (never trained on) unless a caller says otherwise.
FAMILIES = [
    dict(name="cad-line", line=(20, 20, 20), lw=2, table_fill=None, chair="rect", chair_fill=None, paper=(255, 255, 255), centre_dot=False, scan=False),
    dict(name="cad-grey", line=(60, 60, 60), lw=2, table_fill=(225, 225, 225), chair="rounded", chair_fill=(240, 240, 240), paper=(255, 255, 255), centre_dot=False, scan=False),
    dict(name="colour-arm", line=(70, 80, 100), lw=2, table_fill=(240, 222, 180), chair="arm", chair_fill=(235, 120, 40), paper=(255, 255, 255), centre_dot=True, scan=False),
    dict(name="symbolic-num", line=(90, 90, 90), lw=2, table_fill=(215, 215, 215), chair=None, chair_fill=None, paper=(250, 250, 250), centre_dot=False, scan=True, numbers=True),
    dict(name="thin-circle", line=(40, 40, 40), lw=1, table_fill=None, chair="circle", chair_fill=None, paper=(255, 255, 255), centre_dot=False, scan=False),
    dict(name="blue-print", line=(30, 60, 140), lw=2, table_fill=(220, 230, 250), chair="backrest", chair_fill=(200, 215, 245), paper=(250, 252, 255), centre_dot=False, scan=False),
    dict(name="scan-dark", line=(25, 25, 25), lw=3, table_fill=(200, 200, 200), chair="rect", chair_fill=(160, 160, 160), paper=(238, 236, 230), centre_dot=False, scan=True),
    dict(name="green-event", line=(40, 90, 60), lw=2, table_fill=(225, 240, 228), chair="rounded", chair_fill=(160, 205, 170), paper=(255, 255, 255), centre_dot=True, scan=False),
    # held out
    dict(name="hatched-arm", line=(50, 40, 30), lw=2, table_fill=(235, 225, 205), chair="arm", chair_fill=(120, 90, 160), paper=(252, 250, 245), centre_dot=False, scan=True),
    dict(name="mono-num-chairs", line=(0, 0, 0), lw=1, table_fill=None, chair="backrest", chair_fill=None, paper=(255, 255, 255), centre_dot=False, scan=False, numbers=True),
]
HELD_OUT = (8, 9)

SS = 2  # supersampling


def font(size, rng):
    return ImageFont.truetype(rng.choice(FONTS), max(6, int(size)))


def rot_pts(pts, cx, cy, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in pts]


class Plan:
    def __init__(self, w, h, fam, rng):
        self.w, self.h, self.fam, self.rng = w, h, fam, rng
        self.img = Image.new("RGB", (w * SS, h * SS), fam["paper"])
        self.d = ImageDraw.Draw(self.img)
        self.objects, self.rels, self.groups = [], [], []
        self.occupied = []  # boxes already used, in px (x0,y0,x1,y1)
        self.n = {"t": 0, "c": 0, "v": 0}
        # Where a rectangular table's chairs sit, as a fraction of the chair's
        # size beyond the table edge: 0.6 stands them clear of it; a negative
        # value draws them ON the table (generation 2 — the a1 fixture's
        # "chairs tucked under" drawing, which v1 never saw).
        self.chair_off = 0.6

    # ---- geometry bookkeeping -------------------------------------------------
    def free(self, box, pad=4):
        x0, y0, x1, y1 = box
        if x0 < 4 or y0 < 4 or x1 > self.w - 4 or y1 > self.h - 4:
            return False
        return all(x1 + pad < a or x0 - pad > c or y1 + pad < b or y0 - pad > d for a, b, c, d in self.occupied)

    def take(self, box):
        self.occupied.append(box)

    def oid(self, k):
        self.n[k] += 1
        return f"{k}{self.n[k]:03d}"

    # ---- primitives (coordinates in px; drawn at SS) ----------------------------
    def poly(self, pts, fill, outline, lw):
        P = [(x * SS, y * SS) for x, y in pts]
        self.d.polygon(P, fill=fill, outline=outline)
        if outline and lw > 1:
            self.d.line(P + [P[0]], fill=outline, width=lw * SS, joint="curve")

    def rect(self, cx, cy, w, h, deg, fill, outline, lw, radius=0):
        if radius and not deg:
            self.d.rounded_rectangle([(cx - w / 2) * SS, (cy - h / 2) * SS, (cx + w / 2) * SS, (cy + h / 2) * SS], radius=radius * SS, fill=fill, outline=outline, width=lw * SS)
            return
        pts = rot_pts([(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)], cx, cy, deg)
        self.poly(pts, fill, outline, lw)

    def ellipse(self, cx, cy, rx, ry, fill, outline, lw):
        self.d.ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=fill, outline=outline, width=max(1, lw * SS))

    def text(self, cx, cy, s, size, fill=None, anchor="mm"):
        f = font(size * SS, self.rng)
        self.d.text((cx * SS, cy * SS), s, font=f, fill=fill or self.fam["line"], anchor=anchor)

    # ---- furniture ----------------------------------------------------------------
    def chair(self, cx, cy, size, facing_deg, table_id):
        fam = self.fam
        kind = fam["chair"]
        line, lw, fill = fam["line"], max(1, fam["lw"] - (1 if kind == "circle" else 0)), fam["chair_fill"]
        w, h = size, size * self.rng.uniform(0.8, 1.0)
        # facing_deg: direction from chair to table; the back is on the far side.
        deg = facing_deg - 90
        if kind == "circle":
            self.ellipse(cx, cy, w / 2, w / 2, fill, line, lw)
            h = w
        elif kind == "rounded":
            if abs(deg % 90) < 1e-6:
                ww, hh = (w, h) if int(round(deg / 90)) % 2 == 0 else (h, w)
                self.rect(cx, cy, ww, hh, 0, fill, line, lw, radius=size * 0.25)
            else:
                self.rect(cx, cy, w, h, deg, fill, line, lw)
        else:
            self.rect(cx, cy, w, h, deg, fill, line, lw)
            if kind in ("arm", "backrest"):
                # backrest: a bar on the side away from the table
                a = math.radians(facing_deg)
                bx, by = cx - math.cos(a) * h * 0.38, cy - math.sin(a) * h * 0.38
                self.rect(bx, by, w * 0.95, h * 0.22, deg, line if kind == "backrest" else fill, line, lw)
            if kind == "arm":
                a = math.radians(facing_deg + 90)
                for sgn in (-1, 1):
                    ax, ay = cx + sgn * math.cos(a) * w * 0.4, cy + sgn * math.sin(a) * w * 0.4
                    self.rect(ax, ay, w * 0.18, h * 0.8, deg, fill, line, lw)
        cid = self.oid("c")
        self.objects.append(dict(id=cid, **{"class": "chair"}, cx=round(cx, 1), cy=round(cy, 1), w=round(w, 1), h=round(h, 1), rotation=round(deg % 360, 1)))
        if table_id:
            self.rels.append(dict(chair=cid, belongsTo=table_id, method="generated"))
        return cid

    def round_table(self, cx, cy, r, chairs, number=None):
        fam = self.fam
        cs = r * self.rng.uniform(0.55, 0.75)
        outer = r + (cs * 1.2 if chairs else 0)
        box = (cx - outer, cy - outer, cx + outer, cy + outer)
        if not self.free(box):
            return None
        self.take(box)
        self.ellipse(cx, cy, r, r, fam["table_fill"], fam["line"], fam["lw"])
        if fam.get("centre_dot"):
            self.ellipse(cx, cy, r * 0.18, r * 0.18, (60, 140, 70), (30, 80, 40), 1)
        tid = self.oid("t")
        obj = dict(id=tid, **{"class": "table"}, type="round", cx=round(cx, 1), cy=round(cy, 1), w=round(2 * r, 1), h=round(2 * r, 1), rotation=0)
        if number is not None:
            self.text(cx, cy, str(number), r * self.rng.uniform(0.55, 0.85))
            obj["number"] = number
        self.objects.append(obj)
        if chairs and fam["chair"]:
            off = self.rng.uniform(0, 360)
            for i in range(chairs):
                a = off + 360 * i / chairs
                d = r + cs * 0.65
                self.chair(cx + math.cos(math.radians(a)) * d, cy + math.sin(math.radians(a)) * d, cs, a + 180, tid)
        if chairs and fam["chair"]:
            obj["seats"] = chairs
        return tid

    def rect_table(self, cx, cy, w, h, deg, chairs_long, chairs_short, number=None, reserve=True):
        fam = self.fam
        cs = min(w, h) * self.rng.uniform(0.55, 0.8) if fam["chair"] else 0
        pad = cs * 1.3
        if reserve:
            box = (cx - w / 2 - pad, cy - h / 2 - pad, cx + w / 2 + pad, cy + h / 2 + pad)
            if not self.free(box):
                return None
            self.take(box)
        self.rect(cx, cy, w, h, deg, fam["table_fill"], fam["line"], fam["lw"])
        if fam.get("centre_dot"):
            self.ellipse(cx, cy, min(w, h) * 0.12, min(w, h) * 0.12, (60, 140, 70), (30, 80, 40), 1)
        tid = self.oid("t")
        typ = "square" if abs(w - h) < 0.12 * max(w, h) else "rectangle"
        obj = dict(id=tid, **{"class": "table"}, type=typ, cx=round(cx, 1), cy=round(cy, 1), w=round(w, 1), h=round(h, 1), rotation=round(deg, 1))
        if number is not None:
            self.text(cx, cy, str(number), min(w, h) * 0.5)
            obj["number"] = number
        self.objects.append(obj)
        seats = 0
        if fam["chair"]:
            a = math.radians(deg)
            ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
            for side, n, along, across in ((1, chairs_long, w, h), (-1, chairs_long, w, h)):
                for i in range(n):
                    t = (i + 0.5) / n - 0.5
                    px = cx + ux * t * along + vx * side * (across / 2 + cs * self.chair_off)
                    py = cy + uy * t * along + vy * side * (across / 2 + cs * self.chair_off)
                    face = math.degrees(math.atan2(cy + uy * t * along - py, cx + ux * t * along - px))
                    self.chair(px, py, cs, face, tid)
                    seats += 1
            for side in (1, -1):
                for i in range(chairs_short):
                    px = cx + ux * side * (w / 2 + cs * self.chair_off)
                    py = cy + uy * side * (w / 2 + cs * self.chair_off)
                    face = math.degrees(math.atan2(cy - py, cx - px))
                    self.chair(px, py, cs, face, tid)
                    seats += 1
            obj["seats"] = seats
        return tid

    def merged_row(self, x0, y0, n, unit, horizontal):
        """n square tables pushed together into one long table, chairs both sides."""
        fam = self.fam
        cs = unit * self.rng.uniform(0.55, 0.75) if fam["chair"] else 0
        L = n * unit
        bw, bh = (L, unit) if horizontal else (unit, L)
        pad = cs * 1.3
        box = (x0 - pad, y0 - pad, x0 + bw + pad, y0 + bh + pad)
        if not self.free(box):
            return None
        self.take(box)
        ids, seats = [], 0
        for i in range(n):
            cx = x0 + (i + 0.5) * unit if horizontal else x0 + unit / 2
            cy = y0 + unit / 2 if horizontal else y0 + (i + 0.5) * unit
            tid = self.rect_table(cx, cy, unit, unit, 0 if horizontal else 90, 1, 0, reserve=False)
            ids.append(tid)
            seats += 2 if fam["chair"] else 0
        if len(ids) > 1:
            self.groups.append(dict(id=f"g{len(self.groups) + 1:02d}", type="merged", members=ids, seats=seats or None))
        return ids

    def venue(self, cls, cx, cy, w, h, label=None, fill=None, take=True):
        box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        if take:
            if not self.free(box, pad=2):
                return None
            self.take(box)
        fam = self.fam
        self.rect(cx, cy, w, h, 0, fill if fill is not None else fam["table_fill"], fam["line"], fam["lw"])
        if label:
            self.text(cx, cy, label, min(h * 0.35, w / max(3, len(label)) * 1.4))
        vid = self.oid("v")
        self.objects.append(dict(id=vid, **{"class": cls}, cx=round(cx, 1), cy=round(cy, 1), w=round(w, 1), h=round(h, 1), rotation=0))
        return vid


def draw_plan(seed, fam_idx, size=None, gen=2):
    rng = random.Random(seed)
    # Generation 2's additions draw from their OWN generator, so a generation-1
    # plan (what v1 was trained on) is still reproduced exactly from its seed.
    rng2 = random.Random(seed * 7919 + 2)
    fam = dict(FAMILIES[fam_idx])
    W = size[0] if size else rng.choice([1200, 1400, 1600, 1900, 2200, 2400])
    H = size[1] if size else int(W * rng.uniform(0.55, 0.8))
    p = Plan(W, H, fam, rng)
    m = int(min(W, H) * rng.uniform(0.04, 0.08))
    # room outline
    p.d.rectangle([m * SS, m * SS, (W - m) * SS, (H - m) * SS], outline=fam["line"], width=max(2, fam["lw"] + 1) * SS)
    scale = rng.uniform(0.7, 1.4) * W / 1600
    # stage on one wall
    stage_label = rng.choice(["SAHNE", "STAGE", "", "SAHNE", "PODIUM"])
    side = rng.choice(["top", "bottom", "left", "right"])
    sw, sh = W * rng.uniform(0.2, 0.35), H * rng.uniform(0.1, 0.18)
    if side in ("left", "right"):
        sw, sh = sh * W / H, sw * H / W
    scx = {"top": W / 2, "bottom": W / 2, "left": m + sw / 2 + 4, "right": W - m - sw / 2 - 4}[side] + (rng.uniform(-0.2, 0.2) * W if side in ("top", "bottom") else 0)
    scy = {"top": m + sh / 2 + 4, "bottom": H - m - sh / 2 - 4, "left": H / 2, "right": H / 2}[side]
    p.venue("stage", scx, scy, sw, sh, stage_label or None, fill=(235, 240, 245) if not fam["scan"] else None)
    # columns along walls
    cs = rng.uniform(16, 28) * scale
    for _ in range(rng.randint(0, 8)):
        if rng.random() < 0.5:
            x = rng.uniform(m + cs, W - m - cs)
            y = rng.choice([m + cs / 2 + 3, H - m - cs / 2 - 3])
        else:
            x = rng.choice([m + cs / 2 + 3, W - m - cs / 2 - 3])
            y = rng.uniform(m + cs, H - m - cs)
        p.venue("column", x, y, cs * rng.uniform(1, 2.2), cs, None, fill=fam["line"] if rng.random() < 0.5 else (200, 200, 200))
    if rng.random() < 0.6:
        p.venue("bar", rng.uniform(m + 120, W - m - 120) * 1.0, rng.uniform(m + 60, H - m - 60), 160 * scale, 50 * scale, rng.choice(["BAR", "BAR", "Bar"]))
    # text blocks (not objects): title, capacity lines
    tf = rng.uniform(14, 26) * scale
    for _ in range(rng.randint(1, 3)):
        s = rng.choice(["SILA 29.08.2026", "Gala Dinner", "114 pax seating", "TOPLAM : 2064 PAX", "LOCALAR : 72 PAX", "166 * 12 : 1992 PAX", "Haluk Salonu 1/2", "8 m", "3,10 m", "GİRİŞ", "servant", "SYSTEM KONTROL"])
        x, y = rng.uniform(m + 100, W - m - 100), rng.uniform(m + 30, H - m - 30)
        bw = len(s) * tf * 0.6
        if p.free((x - bw / 2, y - tf, x + bw / 2, y + tf)):
            p.take((x - bw / 2, y - tf, x + bw / 2, y + tf))
            p.text(x, y, s, tf)
    # tables
    layout = rng.choice(["rounds", "long", "long", "mixed"] if fam["chair"] in ("arm", "rect", "rounded") else ["rounds", "rounds", "long", "mixed"]) if fam["chair"] else "rounds"
    numbers = bool(fam.get("numbers")) or (rng.random() < 0.3)
    num = 1
    r = rng.uniform(22, 40) * scale
    gap = r * rng.uniform(2.6, 3.6) if fam["chair"] else r * rng.uniform(2.1, 2.8)
    if layout in ("rounds", "mixed"):
        y = m + gap
        stagger = rng.random() < 0.4
        row = 0
        while y < H - m - r:
            x = m + gap + (gap / 2 if stagger and row % 2 else 0)
            while x < W - m - r:
                jx, jy = rng.uniform(-0.08, 0.08) * gap, rng.uniform(-0.08, 0.08) * gap
                if rng.random() < 0.92:
                    chairs = rng.choice([6, 8, 8, 10, 10, 12]) if fam["chair"] else 0
                    if p.round_table(x + jx, y + jy, r, chairs, num if numbers else None):
                        num += 1
                x += gap
            y += gap
            row += 1
            if layout == "mixed" and y > H / 2:
                break
    if layout in ("long", "mixed"):
        unit = rng.uniform(28, 48) * scale
        if gen >= 2 and fam["chair"] and rng2.random() < 0.3:
            p.chair_off = rng2.uniform(-0.55, 0.2)
        for _ in range(rng.randint(6, 18)):
            if gen >= 2 and rng2.random() < 0.35:
                # ONE long banquet table: no dividing lines, chairs along both
                # sides. v1 only ever saw long rows of pushed-together squares
                # (each its own table), and split a1's long tables in two.
                L = unit * rng2.uniform(1.8, 3.5)
                deg = rng2.choice([0, 0, 90, 90, 45])
                ext = L / 2 + unit
                x, y = rng2.uniform(m + 20 + ext, W - m - 20 - ext), rng2.uniform(m + 20 + ext, H - m - 20 - ext)
                p.rect_table(x, y, L, unit * rng2.uniform(0.8, 1.1), deg, max(2, round(L / unit * rng2.uniform(0.9, 1.4))), rng2.choice([0, 0, 1]))
                continue
            n = rng.choice([1, 2, 3, 3, 4, 4, 5])
            horiz = rng.random() < 0.6
            x0, y0 = rng.uniform(m + 20, W - m - 20 - n * unit), rng.uniform(m + 20, H - m - 20 - n * unit)
            if n == 1:
                p.rect_table(x0 + unit / 2, y0 + unit / 2, unit, unit * rng.choice([1, 1, 1.6]), rng.choice([0, 0, 0, 45]), 1, rng.choice([0, 1]))
            else:
                p.merged_row(x0, y0, n, unit, horiz)
    # distractors: plants (small circle clusters), arrows, legend box
    for _ in range(rng.randint(0, 3)):
        x, y = rng.uniform(m + 40, W - m - 40), rng.uniform(m + 40, H - m - 40)
        if p.free((x - 30, y - 30, x + 30, y + 30)):
            p.take((x - 30, y - 30, x + 30, y + 30))
            for k in range(rng.randint(3, 7)):
                p.ellipse(x + rng.uniform(-20, 20), y + rng.uniform(-20, 20), 5 * scale, 5 * scale, (70, 150, 80), (40, 90, 50), 1)
    if rng.random() < 0.4:
        lx, ly = m + 10, H - m - 200 * scale
        lf = 12 * scale
        if p.free((lx, ly, lx + 90 * scale, ly + 12 * lf)):
            p.take((lx, ly, lx + 90 * scale, ly + 12 * lf))
            for k in range(10):
                p.text(lx + 4, ly + k * lf * 1.2, f"Loca {k + 1}", lf, anchor="lm")
    img = p.img.resize((W, H), Image.LANCZOS)
    # scan degradation
    meta = {}
    if fam["scan"] or rng.random() < 0.25:
        if rng.random() < 0.5:
            img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.1)))
        if rng.random() < 0.6:
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=rng.randint(35, 85))
            img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
        meta["degraded"] = True
    return img, p, dict(family=fam["name"], familyIndex=fam_idx, layout=layout, seed=seed, numbers=numbers, gen=gen,
                        chairOffset=round(p.chair_off, 3), **meta)


def annotation(plan_id, file, img, p, meta):
    return {
        "planId": plan_id,
        "source": {"file": file, "width": img.width, "height": img.height, "venue": f"synthetic:{meta['family']}", "layout": meta["layout"], "synthetic": True},
        "annotationMethod": "generated by training/synth.py: exact by construction, not a human judgement",
        "verification": "synthetic-exact",
        "split": {"unit": "styleFamily", "family": meta["family"], "familyIndex": meta["familyIndex"], "heldOutFamily": meta["familyIndex"] in HELD_OUT},
        "generator": {k: v for k, v in meta.items() if k not in ("family", "familyIndex", "layout")},
        "objects": p.objects,
        "relationships": p.rels,
        "logicalGroups": p.groups,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--count", type=int, default=50)
    ap.add_argument("--families", default=",".join(str(i) for i in range(len(FAMILIES)) if i not in HELD_OUT))
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--gen", type=int, default=2, help="1 = what v1 was trained on, reproduced exactly; 2 adds long banquet tables and chairs drawn on the table")
    a = ap.parse_args()
    fams = [int(x) for x in a.families.split(",")]
    os.makedirs(a.out, exist_ok=True)
    index = []
    for i in range(a.count):
        fam = fams[i % len(fams)]
        seed = a.seed * 100003 + i
        img, p, meta = draw_plan(seed, fam, gen=a.gen)
        pid = f"syn-{FAMILIES[fam]['name']}-{seed}"
        img.save(os.path.join(a.out, pid + ".png"))
        with open(os.path.join(a.out, pid + ".json"), "w") as f:
            json.dump(annotation(pid, pid + ".png", img, p, meta), f)
        index.append(dict(planId=pid, family=meta["family"], objects=len(p.objects)))
    with open(os.path.join(a.out, "index.json"), "w") as f:
        json.dump({"generator": "training/synth.py", "gen": a.gen, "seed": a.seed, "families": [FAMILIES[i]["name"] for i in fams], "plans": index}, f, indent=1)
    print(f"wrote {len(index)} plans to {a.out}")


if __name__ == "__main__":
    main()
