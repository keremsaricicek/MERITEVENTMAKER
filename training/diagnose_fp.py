"""What is under each false table? Names the drawn object every unmatched table
detection sits on, for one or more models on the same plans.

    python training/diagnose_fp.py --models v2=runs/v2/model.pt,v4b=runs/v4b/model.pt \\
        --plans DIR[,DIR][,golden,ornek] [--levels 4,5,6] [--thr 0.5] [--json OUT]

A false table is put in exactly one bucket, in this order:
  duplicate     a second box on a table another detection already matched
  on:<class>    its centre inside an annotated object of that class (a sofa, a
                loca, an armchair, a legend sample marked `ignore`, ...) — the
                class is the annotation's own word, not the detector's
  near-table    within one table side of a real table it did not match (an
                offset or a fragment)
  background    none of the above: paper, linework, text
The match is training/detector.py's own (`score`), so the counts add up to its
false positives exactly.
"""
import argparse
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detector as D  # noqa: E402


def inside(o, x, y, pad=0.1):
    a = math.radians(o.get("rotation") or 0)
    ux, uy = math.cos(a), math.sin(a)
    dx, dy = x - o["cx"], y - o["cy"]
    along, across = dx * ux + dy * uy, -dx * uy + dy * ux
    m = pad * min(o["w"], o["h"])
    return abs(along) <= o["w"] / 2 + m and abs(across) <= o["h"] / 2 + m


def classify(p, dets):
    diag = math.hypot(p.W, p.H)
    tol = p.ann.get("matchToleranceP") or 3.0
    gt = [(cx, cy) for k, cx, cy, w, h in p.objs if k in (0, 1)]
    dt = [(cx, cy, w, h) for k, cx, cy, w, h, s in dets if k in (0, 1)]
    ign = [(cx, cy, max(w, h)) for k, cx, cy, w, h in p.ignore]
    dt = [d for d in dt if not any(math.hypot(d[0] - ix, d[1] - iy) <= max(r * 0.6, 4) for ix, iy, r in ign)]
    m, fn, fp = D.match(gt, [(x, y) for x, y, w, h in dt], diag, tol)
    matched = {di for gi, di in m}
    matched_gt = {gi for gi, di in m}
    side = p.ref
    objs = [o for o in p.ann["objects"] if all(isinstance(o.get(k), (int, float)) for k in ("cx", "cy", "w", "h"))]
    out = Counter()
    for di, (x, y, w, h) in enumerate(dt):
        if di in matched:
            continue
        near = [gi for gi, g in enumerate(gt) if math.hypot(g[0] - x, g[1] - y) <= side]
        if any(gi in matched_gt for gi in near) and any(math.hypot(gt[gi][0] - x, gt[gi][1] - y) <= 0.6 * side for gi in near):
            out["duplicate"] += 1
            continue
        under = [o for o in objs if o.get("class") != "table" and inside(o, x, y)]
        if under:
            o = min(under, key=lambda o: o["w"] * o["h"])
            out["on:" + o["class"] + (":ignored" if o.get("ignore") else "")] += 1
        elif near:
            out["near-table"] += 1
        else:
            out["background"] += 1
    assert sum(out.values()) == fp, (p.name, out, fp)
    return out, fp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--plans", required=True)
    ap.add_argument("--levels", default="")
    ap.add_argument("--thr", type=float, default=0.5)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    D.torch.set_num_threads(a.threads)
    levels = set(a.levels.split(",")) if a.levels else None
    plans = []
    for d in a.plans.split(","):
        for p in (D.load_real([d]) if d in D.REAL else D.load_synthetic(d)):
            lv = re.search(r"-L(\d)-", p.name)
            if levels is None or (lv and lv.group(1) in levels):
                plans.append(p)
    report = {}
    for spec in a.models.split(","):
        name, path = spec.split("=", 1)
        model, _ = D.load_model(path)
        total, per_level, fps = Counter(), defaultdict(Counter), 0
        for p in plans:
            dets = D.detect_plan(model, p, D.LONG_SIDE, a.thr)
            c, fp = classify(p, dets)
            total.update(c)
            lv = re.search(r"-L(\d)-", p.name)
            per_level["L" + (lv.group(1) if lv else "?")].update(c)
            fps += fp
        report[name] = dict(falseTables=fps, buckets=dict(total.most_common()), byLevel={k: dict(v.most_common()) for k, v in sorted(per_level.items())})
        print(f"{name}: {fps} false tables on {len(plans)} plans")
        for k, v in total.most_common():
            print(f"   {v:5d}  {k}")
    if a.json:
        json.dump(dict(plans=len(plans), thr=a.thr, report=report), open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
