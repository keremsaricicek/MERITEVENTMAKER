"""Relation scenes: which tables are pushed together, and which only stand close.

Generation 3's plans (synth_levels.py) reserve free space around every table,
so no two separate tables ever stand near each other there — and a grouping
rule scored on them scores perfectly whatever it does with "close". These
scenes exist to make that question measurable:

  POSITIVE (one dining unit, `logicalGroups`)
    merged       2-5 tables pushed edge to edge in a straight row
    merged-rot   the same row turned 15-60 degrees
    merged-L     a row and a short leg meeting at a corner, edges touching
  HARD NEGATIVE (separate tables, `separateNeighbours`)
    aisle        2-4 tables in a line with a visible aisle between them
    aisle-rot    the same, turned
    parallel     two pushed-together rows facing across an aisle: two units,
                 never one

LABELS ARE WHAT THE PICTURE SHOWS. Touching edges are one unit; a gap of at
least 0.35 of a table's side, drawn as white paper between two outlines, is
two tables. Nothing in between is generated, because nothing in between is a
label a person could defend.

    python training/synth_relations.py --out DIR --count 40 --split dev
    python training/synth_relations.py --out DIR --count 40 --split blind --scan

`dev` draws in the training families; `blind` only in the blind families 14
and 15. `--scan` passes the sheet through the L6 scan degradation, labels
carried through the same transform.
"""
import argparse
import json
import math
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # beside synth_levels.py, also under python -I
from synth_levels import FAMILIES, TRAIN_FAMILIES, BLIND_FAMILIES, Plan3, scanned, visibility  # noqa: E402
from synth import SS  # noqa: E402

SEEDS = {"dev": 7, "blind": 8}
KINDS = ["merged", "merged-rot", "merged-L", "aisle", "aisle-rot", "parallel"]


def square(p, cx, cy, u, deg, chair_sides, cs):
    """One square table turned `deg`, a chair on each side named in
    chair_sides (0: +v, 1: -v, 2: +u, 3: -u in the table's own frame)."""
    fam = p.fam
    p.rect(cx, cy, u, u, deg, fam["table_fill"], fam["line"], fam["lw"])
    tid = p.oid("t")
    p.objects.append(dict(id=tid, **{"class": "table"}, type="square", cx=round(cx, 1), cy=round(cy, 1), w=round(u, 1), h=round(u, 1), rotation=round(deg % 360, 1)))
    if fam["chair"] and cs:
        a = math.radians(deg)
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        dirs = [(vx, vy), (-vx, -vy), (ux, uy), (-ux, -uy)]
        for s in chair_sides:
            dx, dy = dirs[s]
            d = u / 2 + cs * 0.6
            px, py = cx + dx * d, cy + dy * d
            p.chair(px, py, cs, math.degrees(math.atan2(cy - py, cx - px)), tid)
        p.objects[[o["id"] for o in p.objects].index(tid)]["seats"] = len(chair_sides)
    return tid


def line_of(p, ox, oy, n, u, deg, gap, cs, outer_only=False):
    """n squares along the direction `deg` from (ox, oy), `gap` (in units of
    the side) between neighbours. Chairs on the two long sides; on a touching
    row the ends get one too."""
    a = math.radians(deg)
    ux, uy = math.cos(a), math.sin(a)
    ids = []
    for i in range(n):
        t = i * (1 + gap) * u
        sides = [0, 1]
        if gap == 0 and i == 0:
            sides.append(3)
        if gap == 0 and i == n - 1:
            sides.append(2)
        if outer_only:
            sides = [0]
        ids.append(square(p, ox + ux * t, oy + uy * t, u, deg, sides, cs))
    return ids


def scene(p, rng, kind, cx, cy, cell, u, cs):
    """One scene centred in its cell. Returns (groups, separate pairs)."""
    groups, separate = [], []
    if kind in ("merged", "merged-rot"):
        n = rng.randint(2, 5)
        deg = rng.choice([0, 90]) if kind == "merged" else rng.choice([15, 20, 30, 45, 60, -20, -30, -45])
        a = math.radians(deg)
        span = (n - 1) * u
        ids = line_of(p, cx - math.cos(a) * span / 2, cy - math.sin(a) * span / 2, n, u, deg, 0, cs)
        groups.append(ids)
    elif kind == "merged-L":
        n, k = rng.randint(2, 4), rng.randint(1, 3)
        deg = rng.choice([0, 0, 30, -30])
        a = math.radians(deg)
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        ox, oy = cx - ux * (n - 1) * u / 2, cy - vy * k * u / 2 - vx * 0
        ids = [square(p, ox + ux * i * u, oy + uy * i * u, u, deg, [1], cs) for i in range(n)]
        ex, ey = ox + ux * (n - 1) * u, oy + uy * (n - 1) * u
        ids += [square(p, ex + vx * j * u, ey + vy * j * u, u, deg, [2, 3] if j < k else [0, 2, 3], cs) for j in range(1, k + 1)]
        groups.append(ids)
    elif kind in ("aisle", "aisle-rot"):
        n = rng.randint(2, 4)
        gap = rng.uniform(0.35, 1.0)
        deg = rng.choice([0, 90]) if kind == "aisle" else rng.choice([15, 20, 30, 45, 60, -20, -30, -45])
        a = math.radians(deg)
        span = (n - 1) * (1 + gap) * u
        ids = line_of(p, cx - math.cos(a) * span / 2, cy - math.sin(a) * span / 2, n, u, deg, gap, cs)
        separate += [dict(members=[ids[i], ids[i + 1]], gapSides=round(gap, 2)) for i in range(n - 1)]
    elif kind == "parallel":
        n = rng.randint(2, 4)
        deg = rng.choice([0, 90, 0, 30])
        a = math.radians(deg)
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        # an aisle the chairs of both rows fit in, plus paper between them
        aisle = (2 * (cs * 1.1) if cs else 0) + u * rng.uniform(0.35, 0.8)
        span = (n - 1) * u
        rows = []
        for side in (-1, 1):
            off = side * (u + aisle) / 2
            ox, oy = cx - ux * span / 2 + vx * off, cy - uy * span / 2 + vy * off
            rows.append(line_of(p, ox, oy, n, u, deg, 0, cs))
        groups += rows
        separate += [dict(members=[rows[0][i], rows[1][i]], gapSides=round(aisle / u, 2)) for i in range(n)]
    return groups, separate


def draw(seed, fam_idx, scan):
    rng = random.Random(seed)
    fam = dict(FAMILIES[fam_idx])
    if fam["chair"] is None:  # a symbolic family draws no chairs; relation scenes are about furniture
        fam["chair"] = "rect"
        fam["chair_fill"] = fam.get("chair_fill") or (230, 230, 230)
    W = rng.choice([1600, 1900, 2200])
    H = int(W * rng.uniform(0.6, 0.75))
    p = Plan3(W, H, fam, rng)
    m = int(min(W, H) * 0.04)
    p.d.rectangle([m * SS, m * SS, (W - m) * SS, (H - m) * SS], outline=fam["line"], width=max(2, fam["lw"] + 1) * SS)
    u = rng.uniform(46, 70) * W / 1900
    cs = u * rng.uniform(0.5, 0.65)
    cell = u * 6.2
    cols, rows = int((W - 2 * m) // cell), int((H - 2 * m) // cell)
    separate, kinds = [], []
    for r in range(rows):
        for c in range(cols):
            kind = rng.choice(KINDS)
            cx, cy = m + (c + 0.5) * (W - 2 * m) / cols, m + (r + 0.5) * (H - 2 * m) / rows
            g, s = scene(p, rng, kind, cx, cy, cell, u, cs)
            for ids in g:
                if len(ids) > 1:
                    p.groups.append(dict(id=f"g{len(p.groups) + 1:02d}", type="merged", members=ids, seats=None, scene=kind))
            separate += [dict(x, scene=kind) for x in s]
            kinds.append(kind)
    img = p.img.resize((W, H), Image.LANCZOS)
    objs = p.objects
    meta = dict(family=fam["name"], familyIndex=fam_idx, level=6 if scan else 2, layout="relations", seed=seed, gen=3, relations=True)
    if scan:
        img, objs = scanned(img, objs, rng, meta)
    objs = visibility(objs, img.size, meta)
    return img, p, objs, meta, separate, kinds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--count", type=int, default=20)
    ap.add_argument("--split", choices=list(SEEDS), required=True)
    ap.add_argument("--scan", action="store_true")
    a = ap.parse_args()
    fams = BLIND_FAMILIES if a.split == "blind" else TRAIN_FAMILIES
    os.makedirs(a.out, exist_ok=True)
    for i in range(a.count):
        fam = fams[i % len(fams)]
        seed = SEEDS[a.split] * 1000003 + (50021 if a.scan else 0) + i
        img, p, objs, meta, separate, kinds = draw(seed, fam, a.scan)
        pid = f"rel-{FAMILIES[fam]['name']}-{'scan-' if a.scan else ''}{seed}"
        img.save(os.path.join(a.out, pid + ".png"))
        ann = {
            "planId": pid,
            "source": {"file": pid + ".png", "width": img.width, "height": img.height, "venue": f"synthetic:{meta['family']}", "layout": "relations", "synthetic": True},
            "annotationMethod": "generated by training/synth_relations.py: exact by construction, not a human judgement",
            "verification": "synthetic-exact",
            "level": meta["level"],
            "split": {"unit": "styleFamily", "family": meta["family"], "familyIndex": fam, "layoutSource": "relations", "set": a.split, "blind": a.split == "blind"},
            "generator": {k: v for k, v in meta.items() if k not in ("family", "familyIndex", "layout")},
            "scenes": kinds,
            "objects": objs,
            "relationships": p.rels,
            "logicalGroups": p.groups,
            "separateNeighbours": separate,
        }
        with open(os.path.join(a.out, pid + ".json"), "w") as f:
            json.dump(ann, f)
    print(f"wrote {a.count} {a.split} relation plans to {a.out}")


if __name__ == "__main__":
    main()
