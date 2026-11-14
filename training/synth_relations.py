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

SEATING FURNITURE (`--furniture`, added 2026-10-17; its own seed base, so the
sets above regenerate byte for byte):
    bench-table     a long table with a bench along each long side
    lounge          a low table with one or two sofas facing it, and armchairs
    banquette-wall  one banquette serving two or three small tables, each with
                    a chair opposite: ONE physical piece, several usage groups
    sofa-apart      HARD NEGATIVE: a sofa near a table, its back to it, across
                    paper: proximity is not membership
A bench, sofa or banquette has a seat count only when its divisions are drawn
(`seats: n`); undivided it is `seats: null` — "not shown", never a guess of
three. `seatingGroups` names, per table, the furniture and chairs that serve it
and the seats the picture shows (null when any member's are not shown); a
banquette appears in the group of every table it serves (`sharedSeating`).

    python training/synth_relations.py --out DIR --count 24 --split dev --furniture
    python training/synth_relations.py --out DIR --count 400 --split train --furniture

TRAIN RELATION SCENES (`--split train` without `--furniture`, added 2026-10-18 for
training/vlm_lora.py): the merged / aisle / parallel scenes in the training
families from a seed base of their own (12), so dev and blind regenerate byte
for byte and no train plan is a dev or blind plan.
"""
import argparse
import json
import math
import os
import random
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # beside synth_levels.py, also under python -I
from synth_levels import FAMILIES, TRAIN_FAMILIES, BLIND_FAMILIES, Plan3, round_table3, scanned, visibility  # noqa: E402
from synth import SS  # noqa: E402

SEEDS = {"dev": 7, "blind": 8, "train": 12}  # train: added 2026-10-18 for the local-VLM LoRA (training/vlm_lora.py)
FURNITURE_SEEDS = {"dev": 9, "blind": 10, "train": 11}
KINDS = ["merged", "merged-rot", "merged-L", "aisle", "aisle-rot", "parallel"]
FURNITURE_KINDS = ["bench-table", "lounge", "banquette-wall", "sofa-apart"]
# The supplementary blind test S1 (training/README.md, V4 run A, pre-registered
# 2026-10-19): blind families only, a seed base of its own, kinds of its own, so
# every set above regenerates byte for byte.
S1_SEEDS = {"blind": 14}
S1_KINDS = ["odd-chairs", "bench-apart", "banquette-apart", "bench-table", "banquette-wall"]
S1_CHAIRS = [3, 5, 7, 9, 11, 3, 5, 7, 9, 11, 4, 8, 12]


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


def plain_table(p, cx, cy, w, h, deg, typ):
    """A table with no chairs of its own (the furniture beside it seats it)."""
    fam = p.fam
    if typ == "round":
        p.ellipse(cx, cy, w / 2, w / 2, fam["table_fill"], fam["line"], fam["lw"])
    else:
        p.rect(cx, cy, w, h, deg, fam["table_fill"], fam["line"], fam["lw"])
    tid = p.oid("t")
    p.objects.append(dict(id=tid, **{"class": "table"}, type=typ, cx=round(cx, 1), cy=round(cy, 1), w=round(w, 1), h=round(h, 1),
                          rotation=round(deg % 360, 1) if typ != "round" else 0))
    return tid


def seats_of(p, oid):
    return next(o for o in p.objects if o["id"] == oid).get("seats")


def furniture_scene(p, rng, kind, cx, cy, u, cs):
    """One seating-furniture scene. Returns (seating groups, separate pairs)."""
    groups, separate = [], []
    deg = rng.choice([0, 90, 0, 30, -30])
    a = math.radians(deg)
    ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
    if kind == "bench-table":
        L, D = u * rng.uniform(2.6, 3.4), u * 0.95
        tid = plain_table(p, cx, cy, L, D, deg, "rectangle")
        bd = u * 0.42
        members = []
        for side in (-1, 1):
            off = side * (D / 2 + bd / 2 + u * 0.08)
            # the bench's own v points AWAY from the table on side +1, so a
            # banquette back (cls banquette) would face out; a bench has none
            bid = p.bench(cx + vx * off, cy + vy * off, L * 0.96, bd, deg, rng.random() < 0.5)
            p.rels.append(dict(seating=bid, belongsTo=tid, method="generated"))
            members.append(bid)
        seats = [seats_of(p, b) for b in members]
        groups.append(dict(table=tid, members=members, seats=None if None in seats else sum(seats)))
    elif kind == "lounge":
        typ = rng.choice(["round", "square", "rectangle"])
        tw = u * (0.8 if typ != "rectangle" else 1.3)
        th = u * 0.8
        tid = plain_table(p, cx, cy, tw, th, deg, typ)
        members = []
        n = rng.choice([1, 2])
        for side in ((1,) if n == 1 else (1, -1)):
            SL, SD = u * rng.uniform(1.7, 2.3), u * 0.8
            # sofa(): its back is drawn on its own -v side; to face the table
            # from the +v side of the table, turn it half a turn
            sdeg = deg + (180 if side == 1 else 0)
            off = side * (th / 2 + SD / 2 + u * 0.18)
            sid = p.sofa(cx + vx * off, cy + vy * off, SL, SD, sdeg, rng.random() < 0.5, table_id=tid)
            members.append(sid)
        for s2 in (-1, 1):
            if rng.random() < 0.6:
                off = s2 * (tw / 2 + cs * 0.9)
                px, py = cx + ux * off, cy + uy * off
                members.append(p.chair(px, py, cs * 1.1, math.degrees(math.atan2(cy - py, cx - px)), tid, typ="armchair"))
        seats = [seats_of(p, m) if any(o["id"] == m and o["class"] == "sofa" for o in p.objects) else 1 for m in members]
        groups.append(dict(table=tid, members=members, seats=None if None in seats else sum(seats)))
    elif kind == "banquette-wall":
        k = rng.choice([2, 3])
        BL, BD = u * (1.25 * k), u * 0.5
        divided = rng.random() < 0.5
        # banquette(): its back is on its own -v side, the tables on +v
        bid = p.bench(cx, cy, BL, BD, deg, divided, cls="banquette")
        served = []
        for i in range(k):
            t = (i - (k - 1) / 2) * u * 1.25
            tx, ty = cx + ux * t + vx * (BD / 2 + u * 0.55), cy + uy * t + vy * (BD / 2 + u * 0.55)
            tid = plain_table(p, tx, ty, u * 0.8, u * 0.8, deg, "square")
            px, py = tx + vx * (u * 0.4 + cs * 0.6), ty + vy * (u * 0.4 + cs * 0.6)
            cid = p.chair(px, py, cs, math.degrees(math.atan2(ty - py, tx - px)), tid)
            served.append(tid)
            bseats = seats_of(p, bid)
            share = None if bseats is None or bseats % k else bseats // k
            groups.append(dict(table=tid, members=[bid, cid], seats=None if share is None else share + 1, sharedSeating=bid))
        p.rels.append(dict(seating=bid, servesTables=served, method="generated"))
    elif kind == "odd-chairs":
        # a round table standing alone in its cell; S1 counts are odd as well as even
        n = rng.choice(S1_CHAIRS)
        round_table3(p, cx, cy, u * 0.6, n, None, p.fam.get("round_chair") or p.fam["chair"], 2)
    elif kind in ("bench-apart", "banquette-apart"):
        # HARD NEGATIVE: a bench or a banquette near a table, across paper; the
        # table keeps its own chairs, away from the piece (as sofa-apart)
        tid = p.oid("t")
        p.objects.append(dict(id=tid, **{"class": "table"}, type="square", cx=round(cx, 1), cy=round(cy, 1), w=round(u, 1), h=round(u, 1), rotation=round(deg % 360, 1)))
        p.rect(cx, cy, u, u, deg, p.fam["table_fill"], p.fam["line"], p.fam["lw"])
        for side in (0, 1):
            dx, dy = (ux, uy) if side == 0 else (-ux, -uy)
            px, py = cx + dx * (u / 2 + cs * 0.6), cy + dy * (u / 2 + cs * 0.6)
            p.chair(px, py, cs, math.degrees(math.atan2(cy - py, cx - px)), tid)
        p.objects[[o["id"] for o in p.objects].index(tid)]["seats"] = 2
        cls = "banquette" if kind == "banquette-apart" else "bench"
        BL, BD = (u * 2.2, u * 0.5) if cls == "banquette" else (u * 2.0, u * 0.42)
        gap = u * rng.uniform(0.8, 1.4)
        off = u / 2 + gap + BD / 2
        # a banquette's back (its own -v side) toward the table: it faces away
        bid = p.bench(cx + vx * off, cy + vy * off, BL, BD, deg, rng.random() < 0.5, cls=cls)
        separate.append(dict(members=[bid, tid], gapSides=round(gap / u, 2)))
    elif kind == "sofa-apart":
        tid = p.oid("t")
        p.objects.append(dict(id=tid, **{"class": "table"}, type="square", cx=round(cx, 1), cy=round(cy, 1), w=round(u, 1), h=round(u, 1), rotation=round(deg % 360, 1)))
        p.rect(cx, cy, u, u, deg, p.fam["table_fill"], p.fam["line"], p.fam["lw"])
        for side in (0, 1):  # the table keeps its own chairs, away from the sofa
            dx, dy = (ux, uy) if side == 0 else (-ux, -uy)
            px, py = cx + dx * (u / 2 + cs * 0.6), cy + dy * (u / 2 + cs * 0.6)
            p.chair(px, py, cs, math.degrees(math.atan2(cy - py, cx - px)), tid)
        p.objects[[o["id"] for o in p.objects].index(tid)]["seats"] = 2
        SL, SD = u * 2.0, u * 0.8
        gap = u * rng.uniform(0.8, 1.4)
        off = u / 2 + gap + SD / 2
        # its back (own -v) toward the table: it faces away
        sid = p.sofa(cx + vx * off, cy + vy * off, SL, SD, deg, rng.random() < 0.5)
        separate.append(dict(members=[sid, tid], gapSides=round(gap / u, 2)))
    return groups, separate


def draw(seed, fam_idx, scan, furniture=False, s1=False):
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
    separate, kinds, seating = [], [], []
    for r in range(rows):
        for c in range(cols):
            kind = rng.choice(S1_KINDS if s1 else FURNITURE_KINDS if furniture else KINDS)
            cx, cy = m + (c + 0.5) * (W - 2 * m) / cols, m + (r + 0.5) * (H - 2 * m) / rows
            if furniture or s1:
                g, s = furniture_scene(p, rng, kind, cx, cy, u, cs)
                seating += [dict(x, id=f"s{len(seating) + 1 + i:02d}", type="seating", scene=kind) for i, x in enumerate(g)]
            else:
                g, s = scene(p, rng, kind, cx, cy, cell, u, cs)
                for ids in g:
                    if len(ids) > 1:
                        p.groups.append(dict(id=f"g{len(p.groups) + 1:02d}", type="merged", members=ids, seats=None, scene=kind))
            separate += [dict(x, scene=kind) for x in s]
            kinds.append(kind)
    img = p.img.resize((W, H), Image.LANCZOS)
    objs = p.objects
    meta = dict(family=fam["name"], familyIndex=fam_idx, level=6 if scan else 2, layout="relations", seed=seed, gen=3, relations=True)
    if furniture or s1:
        meta["furniture"] = True
    if s1:
        meta["s1"] = True
    if scan:
        img, objs = scanned(img, objs, rng, meta)
    objs = visibility(objs, img.size, meta)
    return img, p, objs, meta, separate, kinds, seating


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--count", type=int, default=20)
    ap.add_argument("--split", choices=["dev", "blind", "train"], required=True, help="train: a training set apart from dev and blind (its own seed base)")
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--furniture", action="store_true", help="seating-furniture scenes (benches, sofas, banquettes)")
    ap.add_argument("--s1", action="store_true", help="the supplementary blind test S1: odd chair counts, bench/banquette set apart (blind only)")
    a = ap.parse_args()
    if a.s1 and (a.split != "blind" or a.furniture):
        ap.error("--s1 is a blind test of its own: --split blind, without --furniture")
    fams = BLIND_FAMILIES if a.split == "blind" else TRAIN_FAMILIES
    os.makedirs(a.out, exist_ok=True)
    for i in range(a.count):
        fam = fams[i % len(fams)]
        seed = (S1_SEEDS if a.s1 else FURNITURE_SEEDS if a.furniture else SEEDS)[a.split] * 1000003 + (50021 if a.scan else 0) + i
        img, p, objs, meta, separate, kinds, seating = draw(seed, fam, a.scan, a.furniture, a.s1)
        pid = f"{'s1' if a.s1 else 'seat' if a.furniture else 'rel'}-{FAMILIES[fam]['name']}-{'scan-' if a.scan else ''}{seed}"
        img.save(os.path.join(a.out, pid + ".png"))
        ann = {
            "planId": pid,
            "source": {"file": pid + ".png", "width": img.width, "height": img.height, "venue": f"synthetic:{meta['family']}", "layout": "relations", "synthetic": True},
            "annotationMethod": "generated by training/synth_relations.py: exact by construction, not a human judgement",
            "verification": "synthetic-exact",
            "level": meta["level"],
            "split": {"unit": "styleFamily", "family": meta["family"], "familyIndex": fam, "layoutSource": "s1" if a.s1 else "furniture" if a.furniture else "relations", "set": a.split, "blind": a.split == "blind"},
            "generator": {k: v for k, v in meta.items() if k not in ("family", "familyIndex", "layout")},
            "scenes": kinds,
            "objects": objs,
            "relationships": p.rels,
            "logicalGroups": p.groups,
            "separateNeighbours": separate,
        }
        if a.furniture or a.s1:
            # a group naming an object the visibility pass removed is dropped
            # whole: a usage group with a missing member is not a label
            kept = {o["id"] for o in objs}
            ann["seatingGroups"] = [g for g in seating if g["table"] in kept and all(x in kept for x in g["members"])]
            ann["relationships"] = [r for r in p.rels if all(v in kept for k2, v in r.items() if k2 in ("seating", "belongsTo", "chair"))
                                    and all(t in kept for t in r.get("servesTables", []))]
        with open(os.path.join(a.out, pid + ".json"), "w") as f:
            json.dump(ann, f)
    print(f"wrote {a.count} {a.split} relation plans to {a.out}")


if __name__ == "__main__":
    main()
