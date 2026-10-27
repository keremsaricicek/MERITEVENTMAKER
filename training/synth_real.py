"""Generation 6: the two real plans' OWN symbols, in new arrangements (V6).

The owner's plans come in the two drawing styles of the two real plans this
repository has (Golden: `benchmarks/plans/merit-real-venue-plan.png`; ORNEK:
`benchmarks/plans/ornek-upright.png`), so the gap that keeps real-plan
accuracy below generated-plan accuracy is the drawing itself. This cuts each
annotated symbol out of the real image (its own pixels; the paper becomes
transparent) and composes NEW scenes from them — rows of the real square
tables touching or apart, the real armchairs and crescent chairs counted
around the real tables, the real banquette against or away from them, the
real numbered circles alone — with the labels known by construction, then
the same photometric levels as generation 5 (`synth_vlm.degrade`).

SPATIAL SPLIT, per plan: symbols are cut only from the TRAIN part of each
plan (x < 0.6 of its width); the TEST part (x >= 0.6) is never cut, never
composed and never trained on. `test` writes the real crops of the test part
— every object in it, empty paper, chair counts, touching groups and
separate pairs — in the V5 item format, so `local-vlm-bench2.py --v5 DIR`
asks them. Both plans were looked at in earlier evaluations (V4 real crops):
the test part is held out from training, not blind to a person.

    python -I training/synth_real.py scenes --out DIR [--scale 1.0]
    python -I training/synth_real.py test --out DIR
"""
import argparse
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth_vlm as G5  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANS = {"golden": ("benchmarks/annotations/merit-real-venue.json", "benchmarks/plans/merit-real-venue-plan.png"),
         "ornek": ("benchmarks/annotations/ornek-symbolic.json", "benchmarks/plans/ornek-upright.png")}
SPLIT_X = 0.6  # train part: object centre x < 0.6 W; test part: >= 0.6 W
TUCK = 0.0  # share of chairs drawn half under their table (scenes --tuck; 0 keeps the V6 scenes as generated)
# Drawn things the annotations do not list as objects, kept out of every
# "nothing" crop (x0, y0, x1, y1 in plan pixels, read off the images): a crop
# of the bar counter or the loca strip is not empty (first contact sheet).
AVOID = {"golden": [(95, 140, 640, 300), (625, 55, 715, 175), (600, 465, 1205, 745), (15, 145, 100, 190), (1255, 40, 1305, 150)],
         "ornek": [(190, 1500, 2402, 1719), (100, 1030, 260, 1560), (1020, 530, 1380, 890), (1070, 1350, 1450, 1520)]}


def clear(name, objs, cx, cy, side):
    """Is the square crop at (cx, cy) free of every object and every AVOID box?"""
    if any(abs(o["cx"] - cx) < (o["w"] + side) / 2 + 4 and abs(o["cy"] - cy) < (o["h"] + side) / 2 + 4 for o in objs):
        return False
    return not any(cx + side / 2 > x0 and cx - side / 2 < x1 and cy + side / 2 > y0 and cy - side / 2 < y1 for x0, y0, x1, y1 in AVOID[name])


def load(name):
    a_, p_ = PLANS[name]
    ann = json.load(open(os.path.join(ROOT, a_)))
    img = Image.open(os.path.join(ROOT, p_)).convert("RGB")
    return ann, img


def part(o, W):
    return "train" if o["cx"] < SPLIT_X * W else "test"


def paper_of(img):
    a = np.asarray(img).reshape(-1, 3)
    return tuple(int(v) for v in np.median(a[:: max(1, len(a) // 20000)], axis=0))


def sprite(img, o, pad=2):
    """The object's own pixels with the paper made transparent."""
    x0, y0 = int(o["cx"] - o["w"] / 2 - pad), int(o["cy"] - o["h"] / 2 - pad)
    x1, y1 = int(o["cx"] + o["w"] / 2 + pad + 1), int(o["cy"] + o["h"] / 2 + pad + 1)
    c = img.crop((max(0, x0), max(0, y0), min(img.width, x1), min(img.height, y1)))
    a = np.asarray(c).astype(np.int16)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    alpha = (np.abs(a - bg).max(axis=2) > 28).astype(np.uint8) * 255
    m = Image.fromarray(alpha).filter(ImageFilter.MaxFilter(3))
    out = c.convert("RGBA")
    out.putalpha(m)
    return out


class Bank:
    """Sprites cut from the TRAIN part of both plans."""

    def __init__(self, side_part="train"):
        self.s = {}
        self.paper = {}
        self.text = []   # real printed words (Golden's declared text regions) in the train part
        self.empty = {}  # real empty paper patches in the train part
        for name in PLANS:
            ann, img = load(name)
            W = img.width
            self.paper[name] = paper_of(img)
            objs = [o for o in ann["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))]
            for o in objs:
                if part(o, W) != side_part:
                    continue
                key = (name, o["class"], o.get("type") or o.get("family") or o.get("state") or "")
                self.s.setdefault(key, []).append((sprite(img, o), o))
            for r in ann.get("regions") or []:
                if r.get("class") == "text" and ((r["x"] + r["w"] / 2 < SPLIT_X * W) == (side_part == "train")) and not r["id"].startswith("giris"):  # an entrance's label is not "nothing"
                    self.text.append(img.crop((int(r["x"]), int(r["y"]), int(r["x"] + r["w"]), int(r["y"] + r["h"]))))
            rng = random.Random(61)
            self.empty[name] = []
            for _ in range(4000):
                side = rng.uniform(60, 160)
                cx = rng.uniform(side, SPLIT_X * W - side) if side_part == "train" else rng.uniform(SPLIT_X * W + side, W - side)
                cy = rng.uniform(side, img.height - side)
                box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
                if clear(name, objs, cx, cy, side):
                    self.empty[name].append(img.crop(tuple(int(v) for v in box)))
                if len(self.empty[name]) >= 120:
                    break

    def pick(self, rng, name, cls, typ=None):
        keys = [k for k in self.s if k[0] == name and k[1] == cls and (typ is None or k[2] == typ)]
        if not keys:
            return None
        return rng.choice(self.s[rng.choice(keys)])


class Canvas:
    def __init__(self, side, paper):
        self.img = Image.new("RGBA", (int(side), int(side)), paper + (255,))
        self.paper = paper

    def put(self, spr, cx, cy, scale=1.0, deg=0):
        s = spr
        if scale != 1.0:
            s = s.resize((max(2, int(s.width * scale)), max(2, int(s.height * scale))), Image.LANCZOS)
        if deg:
            s = s.rotate(deg, resample=Image.BICUBIC, expand=True)
        self.img.alpha_composite(s, (int(cx - s.width / 2), int(cy - s.height / 2)))
        return s.width, s.height

    def crop(self, cx, cy, side, out=448):
        return G5.L_crop(self.img.convert("RGB"), cx, cy, side, out)


# ---- one item ---------------------------------------------------------------------------------
def make(task, stratum, rng, bank, size=448):
    level = rng.choices([1, 2, 3, 4], weights=[3, 3, 2, 2])[0]
    sc = rng.uniform(0.85, 1.5)  # the plans' own scale, enlarged a little, as the product's crops vary
    name = "golden" if task in ("CHAIRS", "MERGED", "SERVES") else rng.choice(["golden", "ornek"])
    cv = Canvas(900, bank.paper[name])
    C = 450
    sub = None
    if task == "ID":
        cls = stratum
        if cls == "table":
            sp, o = bank.pick(rng, name, "table") or bank.pick(rng, "golden", "table")
            w, h = cv.put(sp, C, C, sc)
            big = max(w, h)
            sub = f"{name}-table-{o.get('type') or ''}"
        elif cls == "chair":
            name = "golden"
            sp, o = bank.pick(rng, "golden", "chair")
            # at the table it serves, as the plan draws it
            tsp, to = bank.pick(rng, "golden", "table", "square")
            ang = rng.choice([0, 90, 180, 270])
            d = (tsp.width + sp.width) / 2 * sc
            if TUCK and rng.random() < TUCK:  # half under the table: chair first, the table drawn over it
                w, h = cv.put(sp, C, C, sc, rng.choice([0, 90, 180, 270]) if o.get("family") == "orange-armchair" else 0)
                horiz = ang in (0, 180)
                cl_, tl_ = (w if horiz else h), max(2, int((tsp.width if horiz else tsp.height) * sc))
                v = rng.uniform(0.35, 0.65)  # share of the chair left visible along the table's side
                d = tl_ / 2 + cl_ / 2 - (1 - v) * cl_
                ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
                cv.put(tsp, C + ux * d, C + uy * d, sc)
                big = max(w, h)
                sub = f"golden-chair-{o.get('family')}-tucked"
                # the crop is centred on what is still visible of the chair, so the centre shows the chair
                off = (1 - v) * cl_ / 2
                img = cv.crop(C - ux * off, C - uy * off, (2.0 * big + 30) * rng.uniform(0.95, 1.08), size)
                truth, q = cls, G5.Q("identify")
                k = rng.randrange(4)
                if k:
                    img = img.rotate(90 * k)
                img = G5.degrade(img, level, rng)
                return dict(task=task, sub=sub, truth=truth, q=q, level=level, family=f"real-{name}", image=img)
            else:
                cv.put(tsp, C + math.cos(math.radians(ang)) * d, C + math.sin(math.radians(ang)) * d, sc)
                w, h = cv.put(sp, C, C, sc, rng.choice([0, 90, 180, 270]) if o.get("family") == "orange-armchair" else 0)
                big = max(w, h)
                sub = f"golden-chair-{o.get('family')}"
        elif cls == "banquette":
            name = "golden"
            sp, o = bank.pick(rng, "golden", "banquette")
            w, h = cv.put(sp, C, C, sc, rng.choice([0, 90]))
            big = max(w, h)
            sub = "golden-banquette"
        else:  # nothing: real empty paper, half the time with a real printed word
            name = rng.choice([n for n in bank.empty if bank.empty[n]])
            patch = rng.choice(bank.empty[name])
            img = patch.resize((size, size), Image.LANCZOS)
            sub = f"{name}-nothing"
            if bank.text and rng.random() < 0.5:
                t = rng.choice(bank.text)
                f = min(1.0, size * 0.6 / max(t.width, t.height))
                t = t.resize((max(2, int(t.width * f)), max(2, int(t.height * f))))
                img.paste(t, (rng.randint(0, size - t.width), rng.randint(0, size - t.height)))
                sub += "-word"
            img = G5.degrade(img, level, rng)
            return dict(task="NEG", sub=sub, truth="nothing", q=G5.Q("identify"), level=level, family=f"real-{name}", image=img)
        frame = 2.0 * big + 30
        # partial real neighbours at the edges, clear of the centre
        for _ in range(rng.randint(0, 2)):
            a = rng.uniform(0, 2 * math.pi)
            nsp, _o = bank.pick(rng, name, "table") or bank.pick(rng, "golden", "table")
            r = max(nsp.width, nsp.height) * sc / 2
            d = max(frame * 0.55, big / 2 + r + 12)
            cv.put(nsp, C + math.cos(a) * d, C + math.sin(a) * d, sc)
        img = cv.crop(C, C, frame * rng.uniform(0.95, 1.08), size)
        truth, q = cls, G5.Q("identify")
    elif task == "CHAIRS":
        n = stratum
        if n <= 4 and rng.random() < 0.7:
            tsp, to = bank.pick(rng, "golden", "table", "square")
            csp, co = bank.pick(rng, "golden", "chair", "orange-armchair")
            tuck = bool(TUCK and rng.random() < TUCK)
            tw, th = max(2, int(tsp.width * sc)), max(2, int(tsp.height * sc))  # as Canvas.put returns them
            if not tuck:
                cv.put(tsp, C, C, sc)
            sides = rng.sample([0, 1, 2, 3], n)
            for s_ in sides:
                dx, dy = [(0, -1), (1, 0), (0, 1), (-1, 0)][s_]
                f = rng.uniform(0.62, 0.8) if tuck else 1.02
                cv.put(csp, C + dx * (tw + csp.width * sc) / 2 * f, C + dy * (th + csp.height * sc) / 2 * f, sc, [180, 90, 0, 270][s_])
            if tuck:
                cv.put(tsp, C, C, sc)
            big = max(tw, th) + 2 * csp.width * sc
            sub = f"square-{'odd' if n % 2 else 'even'}" + ("-tucked" if tuck else "")
        else:
            tsp, to = bank.pick(rng, "golden", "table", "round")
            cl = bank.s.get(("golden", "chair", "pale-outlined-chair")) or []
            tuck = bool(TUCK and rng.random() < TUCK)
            tw, th = max(2, int(tsp.width * sc)), max(2, int(tsp.height * sc))  # as Canvas.put returns them
            if not tuck:
                cv.put(tsp, C, C, sc)
            r = tw / 2
            a0 = rng.uniform(0, 360)
            for i in range(n):
                csp, co = rng.choice(cl)
                ang = a0 + 360 * i / n
                # the crescent's own facing is co["rotation"]; turn it to face this table
                dd = r + max(csp.width, csp.height) * sc * (rng.uniform(-0.05, 0.15) if tuck else 0.35)
                cv.put(csp, C + math.cos(math.radians(ang)) * dd, C + math.sin(math.radians(ang)) * dd, sc, co.get("rotation", 0) - ang - 180)
            if tuck:
                cv.put(tsp, C, C, sc)
            big = tw + 2 * 30 * sc
            sub = f"round-{'odd' if n % 2 else 'even'}" + ("-tucked" if tuck else "")
        img = cv.crop(C, C, 2.4 * big / 1.3 + 50, size)
        truth, q = n, G5.Q("chairs")
    elif task == "MERGED":
        lab = stratum
        k = rng.randint(2, 4)
        tsp, to = bank.pick(rng, "golden", "table", "square")
        csp, co = bank.pick(rng, "golden", "chair", "orange-armchair")
        vertical = rng.random() < 0.4
        tw, th = tsp.width * sc, tsp.height * sc
        step = (th if vertical else tw) * (1.0 if lab == "yes" else 1 + rng.uniform(0.35, 1.0)) - (2 * sc if lab == "yes" else 0)
        pts = [(C + (0 if vertical else (i - (k - 1) / 2) * step), C + ((i - (k - 1) / 2) * step if vertical else 0)) for i in range(k)]
        for x, y in pts:
            cv.put(tsp, x, y, sc)
            if rng.random() < 0.8:
                for sg in (-1, 1):
                    if vertical:
                        cv.put(csp, x + sg * (tw + csp.width * sc) / 2, y, sc, 90 if sg > 0 else 270)
                    else:
                        cv.put(csp, x, y + sg * (th + csp.height * sc) / 2, sc, 0 if sg > 0 else 180)
        span = (k - 1) * step + (th if vertical else tw)
        img = cv.crop(C, C, max(span, tw) * 1.25 + 40, size)
        truth, q = lab, G5.Q("merged")
        sub = f"{lab}-{'col' if vertical else 'row'}"
    else:  # SERVES: the real banquette against a column of real square tables, or set apart
        lab = stratum
        bsp, bo = bank.pick(rng, "golden", "banquette")
        tsp, to = bank.pick(rng, "golden", "table", "square")
        bw, bh = bsp.width * sc, bsp.height * sc
        tw, th = tsp.width * sc, tsp.height * sc
        side = rng.choice([-1, 1])
        gap = 0 if lab == "yes" else tw * rng.uniform(0.6, 1.5)
        cv.put(bsp, C, C, sc)
        k = max(1, min(3, int(round(bh / th))))
        tx = C + side * (bw / 2 + gap + tw / 2)
        for i in range(k):
            cv.put(tsp, tx, C + (i - (k - 1) / 2) * th, sc)
        cx = (C + tx) / 2
        img = cv.crop(cx, C, max(abs(tx - C) + max(bw, tw), bh) * 1.3 + 30, size)
        truth, q = lab, G5.Q("serves", "banquette")
        sub = f"banquette-{lab}"
    k = rng.randrange(4)
    if k:
        img = img.rotate(90 * k)
    img = G5.degrade(img, level, rng)
    return dict(task=task, sub=sub, truth=truth, q=q, level=level, family=f"real-{name}", image=img)


PLAN = {"ID": {c: 220 for c in ["table", "chair", "banquette", "nothing"]},
        "CHAIRS": {n: 70 for n in range(1, 9)},
        "MERGED": {"yes": 220, "no": 220},
        "SERVES": {"yes": 160, "no": 160}}


# B6c (2026-10-27): more chairs (half of them tucked under the table) and serves.
PLAN2 = {"ID": {"table": 120, "chair": 360, "banquette": 120, "nothing": 160},
         "CHAIRS": {n: 40 for n in range(1, 9)},
         "MERGED": {"yes": 120, "no": 120},
         "SERVES": {"yes": 200, "no": 260}}


def cmd_scenes(a):
    global TUCK
    TUCK = a.tuck
    bank = Bank(a.sprites)
    os.makedirs(os.path.join(a.out, "img"), exist_ok=True)
    rows, k = [], 0
    for task, strata in (PLAN2 if a.plan2 else PLAN).items():
        for stratum, n in strata.items():
            for _ in range(max(1, round(n * a.scale))):
                seed = a.seed_base * 1000003 + k
                it = make(task, stratum, random.Random(seed), bank, a.size)
                name = f"img/{len(rows):05d}.png"
                it["image"].save(os.path.join(a.out, name))
                rows.append(dict({x: it[x] for x in ("task", "sub", "truth", "q", "level", "family")}, seed=seed, split="train" if a.sprites == "train" else "test", image=name))
                k += 1
    with open(os.path.join(a.out, "items.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    json.dump(dict(generator="training/synth_real.py scenes", splitX=SPLIT_X, n=len(rows), tuck=a.tuck, plan2=a.plan2, seedBase=a.seed_base, spritePart=a.sprites, sprites={"|".join(k_): len(v) for k_, v in bank.s.items()}),
              open(os.path.join(a.out, "meta.json"), "w"), indent=1)
    print(len(rows), "scenes")


# ---- the held-out real test ----------------------------------------------------------------------
def cmd_test(a):
    os.makedirs(os.path.join(a.out, "img"), exist_ok=True)
    rows = []

    def add(task, sub, truth, q, img, cx, cy, side, name):
        c = G5.L_crop(img, cx, cy, side, a.size)
        fn = f"img/{len(rows):05d}.png"
        c.save(os.path.join(a.out, fn))
        rows.append(dict(task=task, sub=sub, truth=truth, q=q, level=0, family=f"real-{name}", seed=0, split="test", image=fn))

    for name in PLANS:
        ann, img = load(name)
        W = img.width
        objs = [o for o in ann["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))]
        test = [o for o in objs if part(o, W) == "test"]
        word = {"table": "table", "chair": "chair", "banquette": "banquette", "stage": "stage"}
        for o in test:
            if o["class"] in word:
                big = max(o["w"], o["h"])
                add("ID", f"{name}-{o['class']}", word[o["class"]], G5.Q("identify"), img, o["cx"], o["cy"], 1.15 * big if o["class"] == "stage" else 2.0 * big + 30, name)
        rng = random.Random(62)
        n_empty, taken = 0, []
        for _ in range(20000):
            side = rng.uniform(60, 160)
            cx, cy = rng.uniform(SPLIT_X * W + side, W - side), rng.uniform(side, img.height - side)
            if clear(name, objs, cx, cy, side) and all(math.hypot(cx - x, cy - y) > 0.8 * side for x, y in taken):  # no near-duplicates
                taken.append((cx, cy))
                add("NEG", f"{name}-nothing", "nothing", G5.Q("identify"), img, cx, cy, side, name)
                n_empty += 1
            if n_empty >= 30:
                break
        owner = {}
        for r in ann.get("relationships") or []:
            if "chair" in r and "belongsTo" in r:
                owner.setdefault(r["belongsTo"], []).append(r["chair"])
        tables = [o for o in test if o["class"] == "table"]
        for t in tables:
            if t["id"] in owner:
                add("CHAIRS", f"{name}-{t.get('type')}", len(owner[t["id"]]), G5.Q("chairs"), img, t["cx"], t["cy"], 2.4 * max(t["w"], t["h"]) + 50, name)
        # touching neighbours (one long table) and separate pairs, from the drawn geometry
        def gap(p, q):
            gx = abs(p["cx"] - q["cx"]) - (p["w"] + q["w"]) / 2
            gy = abs(p["cy"] - q["cy"]) - (p["h"] + q["h"]) / 2
            return gx, gy
        sq = [t for t in tables if t.get("type") == "square"]
        par = {t["id"]: t["id"] for t in sq}
        def find(x):
            while par[x] != x:
                x = par[x]
            return x
        for i, p in enumerate(sq):
            for q in sq[i + 1:]:
                gx, gy = gap(p, q)
                # drawn touching; the boxes stop 5-8 px short of the ink (every such pair in Golden), separate pairs are > 20 px apart
                if (gx <= 10 and gy < -min(p["h"], q["h"]) * 0.5) or (gy <= 10 and gx < -min(p["w"], q["w"]) * 0.5):
                    par[find(p["id"])] = find(q["id"])
        groups = {}
        for t in sq:
            groups.setdefault(find(t["id"]), []).append(t)
        for ms in groups.values():
            if 2 <= len(ms) <= 4:
                x0 = min(o["cx"] - o["w"] / 2 for o in ms); x1 = max(o["cx"] + o["w"] / 2 for o in ms)
                y0 = min(o["cy"] - o["h"] / 2 for o in ms); y1 = max(o["cy"] + o["h"] / 2 for o in ms)
                add("MERGED", f"{name}-group{len(ms)}", "yes", G5.Q("merged"), img, (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 1.25 + 40, name)
        pairs = 0
        for i, p in enumerate(tables):
            for q in tables[i + 1:]:
                gx, gy = gap(p, q)
                g = max(gx, gy)
                if find(p["id"]) == find(q["id"]) if p in sq and q in sq else False:
                    continue
                if 0.35 * min(p["w"], q["w"]) <= g <= 1.5 * max(p["w"], q["w"]):
                    x0 = min(p["cx"] - p["w"] / 2, q["cx"] - q["w"] / 2); x1 = max(p["cx"] + p["w"] / 2, q["cx"] + q["w"] / 2)
                    y0 = min(p["cy"] - p["h"] / 2, q["cy"] - q["h"] / 2); y1 = max(p["cy"] + p["h"] / 2, q["cy"] + q["h"] / 2)
                    add("MERGED", f"{name}-apart", "no", G5.Q("merged"), img, (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 1.25 + 40, name)
                    pairs += 1
                    if pairs >= 25:
                        break
            if pairs >= 25:
                break
    with open(os.path.join(a.out, "items.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tally = {}
    for r in rows:
        tally[f"{r['task']}:{r['sub']}:{r['truth']}"] = tally.get(f"{r['task']}:{r['sub']}:{r['truth']}", 0) + 1
    json.dump(dict(generator="training/synth_real.py test", splitX=SPLIT_X, n=len(rows), tally=dict(sorted(tally.items()))), open(os.path.join(a.out, "meta.json"), "w"), indent=1)
    print(len(rows), "real test items")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scenes")
    s.add_argument("--out", required=True)
    s.add_argument("--scale", type=float, default=1.0)
    s.add_argument("--size", type=int, default=448)
    s.add_argument("--tuck", type=float, default=0.0, help="share of chairs drawn half under their table")
    s.add_argument("--plan2", action="store_true", help="B6c's mix (PLAN2)")
    s.add_argument("--seed-base", type=int, default=61)
    s.add_argument("--sprites", choices=["train", "test"], default="train", help="cut symbols from this part of the plans (test: a held-out scene test)")
    t = sub.add_parser("test")
    t.add_argument("--out", required=True)
    t.add_argument("--size", type=int, default=448)
    a = ap.parse_args()
    {"scenes": cmd_scenes, "test": cmd_test}[a.cmd](a)


if __name__ == "__main__":
    main()
