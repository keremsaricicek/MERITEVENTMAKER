#!/usr/bin/env python3
"""The chairs drawn around each round table of the Golden Plan, one box per chair.

    python3 benchmarks/annotate/round-table-chairs.py \
        benchmarks/plans/merit-real-venue-plan.png benchmarks/annotations/merit-real-venue.json \
        OUT.json [REVIEW.png]

Why (2026-10-18, D10). The pale crescent chairs were first recovered by
build-real-annotation.mjs as ANGULAR clusters of tan pixels just outside each
disc. Two of its clusters were wrong, and a rendered review showed it:
around t038 the right, lower-right and lower chairs came out as two boxes
91 px wide whose centres lie INSIDE the table (c090, c094), and around t040
the one right-hand chair came out as two half-boxes (c101, c107). The
count, 24, was right by coincidence (one missing at t038, one extra at t040).

This tool shares no code with that one or with the detector. Around each
annotated round table it keeps the ink (luma below paper - 12) in the ring
from 3 to 28 px outside the disc's drawn edge, and
takes 8-connected components; the disc's edge is the darkest circle within
-4..+6 px of the annotated radius, and the ring starts 3 px beyond it so the
outline itself does not join the chairs into one ring. A drawn chair abuts its table and is separated
from its neighbours by paper, so each component that touches the inner edge
of the ring and is chair-sized (80-900 px of ink) is one chair. Its box is
the component's extent. Near-black ink (luma <= 80), and any straight vertical or horizontal run of
ink 45 px or longer (a chair is at most 35), is a wall line and is left out:
two chairs stand against a pale inner wall line and joined it otherwise.
One chair of t040 still touches a drawn diagonal bar of the same grey and
comes out merged with it; its existing box (c102) is right and is kept.
Facing is the direction from the box centre to the table centre (the crescent opens toward it, which the review image shows).

Its output is a PROPOSAL, checked against the existing boxes of the chairs
the first tool got right (agreement is printed) and by eye on REVIEW.png.
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

RING_IN, RING_OUT, PAPER_DROP = 3, 28, 12
MIN_INK, MAX_INK = 80, 900
WALL_LUMA, LINE_RUN = 80, 45


def components(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), int)
    n = 0
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or lab[y, x]:
                continue
            n += 1
            stack = [(y, x)]
            lab[y, x] = n
            while stack:
                cy, cx = stack.pop()
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        yy, xx = cy + dy, cx + dx
                        if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = n
                            stack.append((yy, xx))
    return lab, n


def long_runs(mask, n):
    out = np.zeros_like(mask)
    for axis in (0, 1):
        m = mask if axis == 0 else mask.T
        o = out if axis == 0 else out.T
        for i in range(m.shape[1]):
            col, start = m[:, i], None
            for j in range(len(col) + 1):
                on = j < len(col) and col[j]
                if on and start is None:
                    start = j
                elif not on and start is not None:
                    if j - start >= n:
                        o[start:j, i] = True
                    start = None
    return out


def iou(a, b):
    ax0, ay0, ax1, ay1 = a["cx"] - a["w"] / 2, a["cy"] - a["h"] / 2, a["cx"] + a["w"] / 2, a["cy"] + a["h"] / 2
    bx0, by0, bx1, by1 = b["cx"] - b["w"] / 2, b["cy"] - b["h"] / 2, b["cx"] + b["w"] / 2, b["cy"] + b["h"] / 2
    iw, ih = max(0, min(ax1, bx1) - max(ax0, bx0)), max(0, min(ay1, by1) - max(ay0, by0))
    inter = iw * ih
    return inter / (a["w"] * a["h"] + b["w"] * b["h"] - inter)


def main():
    img_path, ann_path, out_path = sys.argv[1:4]
    review = sys.argv[4] if len(sys.argv) > 4 else None
    im = Image.open(img_path).convert("RGB")
    a = np.asarray(im).astype(float)
    L = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    paper = float(np.percentile(L[::4, ::4], 98))
    ann = json.load(open(ann_path))
    objs = {o["id"]: o for o in ann["objects"]}
    rel = {r["chair"]: r["belongsTo"] for r in ann["relationships"] if r.get("chair")}
    tables = [o for o in ann["objects"] if o["class"] == "table" and o.get("type") == "round"]
    out, tiles = [], []
    for t in tables:
        # the disc's own drawn outline: the darkest circle near the annotated
        # radius (mean luma over 360 directions), so the ring starts beyond it
        R0 = (t["w"] + t["h"]) / 4
        ang = np.linspace(0, 2 * math.pi, 360, endpoint=False)
        def ring_mean(rr):
            xs = np.clip((t["cx"] + rr * np.cos(ang)).astype(int), 0, L.shape[1] - 1)
            ys = np.clip((t["cy"] + rr * np.sin(ang)).astype(int), 0, L.shape[0] - 1)
            return float(L[ys, xs].mean())
        R = min(np.arange(R0 - 4, R0 + 6.01, 0.5), key=ring_mean)
        pad = int(R + RING_OUT + 2)
        x0, y0 = int(t["cx"] - pad), int(t["cy"] - pad)
        sub = L[y0:y0 + 2 * pad, x0:x0 + 2 * pad]
        yy, xx = np.mgrid[0:sub.shape[0], 0:sub.shape[1]]
        r = np.hypot(xx + x0 - t["cx"], yy + y0 - t["cy"])
        ring = (r >= R + RING_IN) & (r <= R + RING_OUT)
        # near-black is a wall or structure line (luma ~30), never a chair's
        # grey outline (~125-170): two chairs beside a wall joined it otherwise
        ink = (sub < paper - PAPER_DROP) & (sub > WALL_LUMA) & ring
        # inside the ring, a straight vertical or horizontal run of ink longer
        # than any chair (45 px; chairs are <= 35) is a drawn wall, whatever its grey
        ink &= ~long_runs(ink, LINE_RUN)
        lab, n = components(ink)
        found = []
        for k in range(1, n + 1):
            ys, xs = np.nonzero(lab == k)
            if not (MIN_INK <= len(xs) <= MAX_INK):
                continue
            if r[ys, xs].min() > R + RING_IN + 2:      # does not abut the table
                continue
            bx0, bx1, by0, by1 = xs.min() + x0, xs.max() + x0 + 1, ys.min() + y0, ys.max() + y0 + 1
            cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
            facing = math.degrees(math.atan2(t["cy"] - cy, t["cx"] - cx)) % 360
            found.append(dict(table=t["id"], cx=round(cx, 1), cy=round(cy, 1), w=int(bx1 - bx0), h=int(by1 - by0),
                              ink=int(len(xs)), facingDeg=round(facing, 1),
                              angleAroundTable=round(math.degrees(math.atan2(cy - t["cy"], cx - t["cx"])) % 360, 1)))
        found.sort(key=lambda f: f["angleAroundTable"])
        # agreement with the chairs the first tool already holds for this table
        held = [objs[c] for c, tt in rel.items() if tt == t["id"] and objs[c]["class"] == "chair"]
        for f in found:
            best = max(held, key=lambda o: iou(f, o), default=None)
            f["bestExisting"] = best["id"] if best else None
            f["iouWithExisting"] = round(iou(f, best), 2) if best else 0
        out.append(dict(table=t["id"], radius=round(R, 1), chairs=found,
                        existing=[dict(id=o["id"], cx=o["cx"], cy=o["cy"], w=o["w"], h=o["h"]) for o in held]))
        if review:
            k = 3
            crop = im.crop((x0, y0, x0 + 2 * pad, y0 + 2 * pad)).resize((2 * pad * k, 2 * pad * k), Image.LANCZOS)
            d = ImageDraw.Draw(crop)
            for o in held:
                d.rectangle(((o["cx"] - o["w"] / 2 - x0) * k, (o["cy"] - o["h"] / 2 - y0) * k,
                             (o["cx"] + o["w"] / 2 - x0) * k, (o["cy"] + o["h"] / 2 - y0) * k), outline=(220, 0, 0), width=1)
            for f in found:
                d.rectangle(((f["cx"] - f["w"] / 2 - x0) * k, (f["cy"] - f["h"] / 2 - y0) * k,
                             (f["cx"] + f["w"] / 2 - x0) * k, (f["cy"] + f["h"] / 2 - y0) * k), outline=(0, 160, 0), width=2)
            d.text((4, 4), f"{t['id']}: {len(found)} found (green), {len(held)} held (red)", fill=(0, 0, 200))
            tiles.append(crop)
    json.dump(dict(image=img_path, paper=paper, method=__doc__.strip().split("\n\n")[3], tables=out), open(out_path, "w"), indent=1)
    for t in out:
        print(t["table"], "found", len(t["chairs"]), "held", len(t["existing"]),
              [(f["bestExisting"], f["iouWithExisting"], f["w"], f["h"]) for f in t["chairs"]])
    if review and tiles:
        W = sum(t.width for t in tiles)
        sheet = Image.new("RGB", (W, max(t.height for t in tiles)), "white")
        x = 0
        for t in tiles:
            sheet.paste(t, (x, 0))
            x += t.width
        sheet.save(review)


if __name__ == "__main__":
    main()
