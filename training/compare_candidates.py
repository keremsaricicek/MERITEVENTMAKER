"""Compare a candidate detector against the active one, group by group.

    python training/compare_candidates.py --base runs/v2/eval-val.json --cand runs/v4a/eval-val.json [--min 100] [--tol 0.005] [--json OUT]

Both files are `training/detector.py eval --report` outputs on the SAME plans at
the SAME threshold (the script refuses otherwise). Pooled per level (from the
plan id's `-L<n>-`), per style family and in total, per class, with precision,
recall and table-type accuracy. A group with at least --min objects of a class
whose precision or recall is lower than the base's by more than --tol is a
REGRESSION and is listed — the activation rule in
benchmarks/offline-intelligence/ACCEPTANCE.md (2026-10-12 additions).
"""
import argparse
import json
import re
from collections import defaultdict

CLASSES = ("tables", "chairs", "columns")


def pool(report):
    groups = defaultdict(lambda: {c: [0, 0, 0] for c in CLASSES} | {"type": [0, 0]})
    for pid, p in report["plans"].items():
        m = re.search(r"-L(\d)-", pid)
        keys = ["all", f"family:{p.get('family') or '?'}"] + ([f"level:{m.group(1)}"] if m else [])
        for k in keys:
            g = groups[k]
            for c in CLASSES:
                if c in p:
                    g[c][0] += p[c]["tp"]; g[c][1] += p[c]["fp"]; g[c][2] += p[c]["fn"]
            if "tableType" in p:
                g["type"][0] += p["tableType"]["correct"]; g["type"][1] += p["tableType"]["matched"]
    return groups


def pr(tp, fp, fn):
    return (tp / (tp + fp) if tp + fp else None, tp / (tp + fn) if tp + fn else None, tp + fn)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--cand", required=True)
    ap.add_argument("--min", type=int, default=100)
    ap.add_argument("--tol", type=float, default=0.005)
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    B, C = json.load(open(a.base)), json.load(open(a.cand))
    if set(B["plans"]) != set(C["plans"]):
        raise SystemExit("the two reports are not on the same plans")
    if B.get("threshold") != C.get("threshold") or B.get("thresholds") != C.get("thresholds"):
        raise SystemExit(f"thresholds differ: {B.get('threshold')}/{B.get('thresholds')} vs {C.get('threshold')}/{C.get('thresholds')}")
    gb, gc = pool(B), pool(C)
    order = sorted(gb, key=lambda k: (k != "all", not k.startswith("level"), k))
    rows, regressions = [], []
    for k in order:
        row = {"group": k}
        for c in CLASSES:
            pb, rb, n = pr(*gb[k][c]); pc, rc, _ = pr(*gc[k][c])
            if n == 0:
                continue
            row[c] = {"n": n, "P": [None if pb is None else round(pb, 4), None if pc is None else round(pc, 4)],
                      "R": [None if rb is None else round(rb, 4), None if rc is None else round(rc, 4)]}
            if n >= a.min:
                for name, x, y in (("precision", pb, pc), ("recall", rb, rc)):
                    if x is not None and y is not None and y < x - a.tol:
                        regressions.append(f"{k} {c} {name} {x:.4f} -> {y:.4f} (n={n})")
        tb, tc = gb[k]["type"], gc[k]["type"]
        if tb[1]:
            row["tableType"] = [round(tb[0] / tb[1], 4), round(tc[0] / max(1, tc[1]), 4)]
        rows.append(row)
    for r in rows:
        cells = []
        for c in CLASSES:
            if c in r:
                x = r[c]
                f = lambda v: "  -  " if v is None else f"{v:.3f}"
                cells.append(f"{c[:2]} n{x['n']} P {f(x['P'][0])}>{f(x['P'][1])} R {f(x['R'][0])}>{f(x['R'][1])}")
        if "tableType" in r:
            cells.append(f"type {r['tableType'][0]:.3f}>{r['tableType'][1]:.3f}")
        print(f"{r['group']:24s} " + " | ".join(cells))
    print(f"\nREGRESSIONS (n >= {a.min}, drop > {a.tol}): {len(regressions)}")
    for x in regressions:
        print("  " + x)
    if a.json:
        json.dump({"base": a.base, "cand": a.cand, "threshold": C.get("threshold"), "rows": rows, "regressions": regressions}, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
