"""Seat counts from chairs, one by one (training/README.md, 2026-10-25, follow-up 2).

The model never says a number: the detector's own chairs around a table are each
asked `identify`, and the table's count is the chairs both looks call `chair`.
Measured on the held-out real test's chair-count tables (Golden, x >= 0.6 W —
the same 20 tables as `synth_real.py test`), beside the detector alone.

    python -I training/seat_count_eval.py items --dets DUMP/merit-real-venue.detections.json --out DIR
    (score DIR with local-vlm-bench2.py --v5 DIR ... --looks 2)
    python -I training/seat_count_eval.py score --items DIR --bench RESULT.json

`items` writes one identify crop per detected chair (the test's identify crop,
centred on the detected chair) with `sub` = the table and `truth` = `chair` when
the detected chair lies on an annotated chair of that table, else `nothing`.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth_real as R  # noqa: E402
import synth_vlm as G5  # noqa: E402


def test_tables(ann, W):
    objs = {o["id"]: o for o in ann["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))}
    owner = {}
    for r in ann.get("relationships") or []:
        if "chair" in r and "belongsTo" in r:
            owner.setdefault(r["belongsTo"], []).append(r["chair"])
    return [(objs[t], [objs[c] for c in owner[t] if c in objs]) for t in owner
            if t in objs and objs[t]["class"] == "table" and R.part(objs[t], W) == "test"]


def px(c, W, H):
    return dict(cx=(c["xPct"] + c["wPct"] / 2) / 100 * W, cy=(c["yPct"] + c["hPct"] / 2) / 100 * H,
                w=c["wPct"] / 100 * W, h=c["hPct"] / 100 * H)


def cmd_items(a):
    ann, img = R.load("golden")
    W, H = img.width, img.height
    dets = [d for d in json.load(open(a.dets))["candidates"] if d.get("status") != "rejected" and d.get("kind") == "table"]
    os.makedirs(os.path.join(a.out, "img"), exist_ok=True)
    rows, tables = [], []
    for t, chairs in test_tables(ann, W):
        # the detected table whose centre lies inside the annotated table's box
        inside = [d for d in dets if abs(px(d, W, H)["cx"] - t["cx"]) <= t["w"] / 2 and abs(px(d, W, H)["cy"] - t["cy"]) <= t["h"] / 2]
        d = min(inside, key=lambda d: math.hypot(px(d, W, H)["cx"] - t["cx"], px(d, W, H)["cy"] - t["cy"])) if inside else None
        found = [px(ch, W, H) for ch in (d or {}).get("chairs", [])] if d else []
        tables.append(dict(id=t["id"], truth=len(chairs), detected=d is not None, detectorCount=len(found)))
        for i, ch in enumerate(found):
            real = any(abs(ch["cx"] - c["cx"]) <= c["w"] / 2 + 3 and abs(ch["cy"] - c["cy"]) <= c["h"] / 2 + 3 for c in chairs)
            big = max(ch["w"], ch["h"])
            crop = G5.L_crop(img, ch["cx"], ch["cy"], 2.0 * big + 30, 448)
            fn = f"img/{len(rows):05d}.png"
            crop.save(os.path.join(a.out, fn))
            rows.append(dict(task="ID", sub=f"seat-{t['id']}", truth="chair" if real else "nothing", q=G5.Q("identify"),
                             level=0, family="real-golden", seed=0, split="test", image=fn))
    with open(os.path.join(a.out, "items.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    json.dump(dict(tables=tables, note="seat counts from chairs one by one; see training/README.md 2026-10-25"),
              open(os.path.join(a.out, "meta.json"), "w"), indent=1)
    print(f"{len(tables)} tables, {sum(t['detected'] for t in tables)} found by the detector, {len(rows)} detected chairs")


def cmd_score(a):
    meta = json.load(open(os.path.join(a.items, "meta.json")))
    rows = json.load(open(a.bench))["rows"]
    yes = {}
    for r in rows:
        tid = r["sub"][len("seat-"):]
        yes[tid] = yes.get(tid, 0) + (r["parsed"] == "chair" and r.get("parsed2") == "chair")
    out = []
    for t in meta["tables"]:
        out.append(dict(id=t["id"], truth=t["truth"], detector=t["detectorCount"], model=yes.get(t["id"], 0)))
    n = len(out)
    rate = lambda k, f: round(sum(f(o[k], o["truth"]) for o in out) / n, 3) if n else None
    s = dict(tables=n,
             detectorExact=rate("detector", lambda v, t: v == t), detectorOver=rate("detector", lambda v, t: v > t),
             modelExact=rate("model", lambda v, t: v == t), modelOver=rate("model", lambda v, t: v > t))
    s["passes"] = bool(n and s["modelExact"] >= 0.80 and s["modelOver"] <= 0.10)
    print(json.dumps(dict(summary=s, tables=out), indent=1))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("items"); i.add_argument("--dets", required=True); i.add_argument("--out", required=True)
    c = sub.add_parser("score"); c.add_argument("--items", required=True); c.add_argument("--bench", required=True)
    a = p.parse_args()
    {"items": cmd_items, "score": cmd_score}[a.cmd](a)
