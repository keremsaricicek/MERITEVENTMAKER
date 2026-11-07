#!/usr/bin/env python3
"""Measure the drawn OUTLINE of every ORNEK table, for review by a person.

    python3 benchmarks/annotate/ornek-outline-measure.py \
        benchmarks/plans/ornek-upright.png benchmarks/annotations/ornek-symbolic.json \
        OUT.json [REVIEW.png]

Why this exists (2026-10-18, D11). benchmarks/annotations/ornek-symbolic.json
records each table's CENTRE as measured ("within roughly 10px of the visible
disc centre") and gives every one of the 166 the same 78 x 78 box: the mode
radius of the circle finder (r ~ 39), not a measurement of that table. The
sheet is a PHOTOGRAPHED printout with slight perspective, so a symbol printed
round is not round in the pixels: table 155 is drawn about 88 x 64. Scoring a
box's aspect against a constant measures the constant.

This tool measures each outline from the pixels and shares no code and no
reasoning with the detector under test (src/plan-symbol-geometry.js,
src/plan-detection-*.js): from the annotated centre it casts 90 rays. Walking
OUT along a ray from 22 px (the printed number sits inside r < 20), the disc
ends where the profile first reaches the paper: within 4 grey levels of the
brightest point on that ray beyond 22 px (paper is the brightest thing on the
sheet, and taking it per ray follows the photograph's shadow band, where the
faint row 71-76 sits); the rim is the darkest point before that, and the
edge is where the profile climbs back half-way from the rim to the paper. The FIRST return to paper, not
the darkest point in a window: the first version took the darkest point and
read a wall or pillar line drawn just beyond four discs (47, 63, 70, 139) as
their rim, 5-12 px too wide, which the review sheet showed. A ray that never
reaches paper within 62 px (a disc touching a line, or the photograph's
shadow band) gives no point.
An ellipse is fitted to those edge points by direct least squares and refitted
without the points more than 3 px off it, twice. A fit keeping fewer than 60 %
of its rays, or with an rms over 1.5 px, is recorded as NOT MEASURED rather
than kept.

Its output is a PROPOSAL. REVIEW.png draws every fitted ellipse on its own
crop so a person can check each one by eye; what is committed to
benchmarks/plan-understanding/truth/ornek-symbolic.json is the checked result.
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

RAYS = 90
R_MIN, R_OUT, RIM_MIN, PROMINENCE, AFTER, DARK_STEP, RETURN_TOL, LINE_DARKER = 22, 62, 8, 0.35, 16, 40, 6, 35
KEEP_MIN, RMS_MAX = 0.60, 1.5


def bilinear(g, x, y):
    h, w = g.shape
    x0 = np.clip(np.floor(x).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(y).astype(int), 0, h - 2)
    fx, fy = np.clip(x - x0, 0, 1), np.clip(y - y0, 0, 1)
    a, b = g[y0, x0], g[y0, x0 + 1]
    c, d = g[y0 + 1, x0], g[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fit_ellipse(px, py):
    """Fitzgibbon direct least-squares ellipse. Returns (cx, cy, a, b, theta) or None."""
    x, y = px - px.mean(), py - py.mean()
    D1 = np.stack([x * x, x * y, y * y], 1)
    D2 = np.stack([x, y, np.ones_like(x)], 1)
    S1, S2, S3 = D1.T @ D1, D1.T @ D2, D2.T @ D2
    try:
        T = -np.linalg.solve(S3, S2.T)
    except np.linalg.LinAlgError:
        return None
    M = S1 + S2 @ T
    M = np.array([M[2] / 2, -M[1], M[0] / 2])
    w, v = np.linalg.eig(M)
    v = np.real(v)
    cond = 4 * v[0] * v[2] - v[1] ** 2
    k = np.where(cond > 0)[0]
    if not len(k):
        return None
    a1 = v[:, k[0]]
    A, B, C = a1
    Dd, E, F = T @ a1
    den = B * B - 4 * A * C
    if den >= 0:
        return None
    cx = (2 * C * Dd - B * E) / den
    cy = (2 * A * E - B * Dd) / den
    num = 2 * (A * E * E + C * Dd * Dd - B * Dd * E + den * F)
    root = math.sqrt((A - C) ** 2 + B * B)
    s1, s2 = -math.sqrt(abs(num * (A + C + root))) / den, -math.sqrt(abs(num * (A + C - root))) / den
    theta = 0.5 * math.atan2(-B, C - A)
    return cx + px.mean(), cy + py.mean(), abs(s1), abs(s2), theta


def ellipse_distance(e, px, py):
    cx, cy, a, b, t = e
    c, s = math.cos(t), math.sin(t)
    u = (px - cx) * c + (py - cy) * s
    v = -(px - cx) * s + (py - cy) * c
    r = np.hypot(u, v) + 1e-9
    rr = 1 / np.sqrt((u / r / a) ** 2 + (v / r / b) ** 2)
    return np.abs(r - rr)


def axis_box(e):
    cx, cy, a, b, t = e
    hw = math.sqrt((a * math.cos(t)) ** 2 + (b * math.sin(t)) ** 2)
    hh = math.sqrt((a * math.sin(t)) ** 2 + (b * math.cos(t)) ** 2)
    return cx, cy, 2 * hw, 2 * hh


def measure(g, cx, cy):
    ang = np.arange(RAYS) * 2 * math.pi / RAYS
    r = np.arange(0, R_OUT + 0.5, 0.5)
    X = cx + np.outer(np.cos(ang), r)
    Y = cy + np.outer(np.sin(ang), r)
    prof = bilinear(g, X, Y)
    k = np.array([1, 2, 1], float) / 4
    prof = np.apply_along_axis(lambda p: np.convolve(p, k, mode="same"), 1, prof)
    y0, y1 = int(max(0, cy - 70)), int(min(g.shape[0], cy + 70))
    x0, x1 = int(max(0, cx - 70)), int(min(g.shape[1], cx + 70))
    paper = float(np.percentile(g[y0:y1, x0:x1], 95))
    lo = int(R_MIN / 0.5)
    ex, ey, rims = [], [], []
    for i in range(RAYS):
        p = prof[i]
        top = float(p[lo:].max())
        floor = float(p[lo:].min())
        need = max(RIM_MIN, PROMINENCE * (top - floor))
        j = None
        for q in range(lo + 1, len(p) - 1):
            if not (p[q] <= p[q - 1] and p[q] < p[q + 1]):
                continue
            left, right = float(p[lo:q + 1].max()), float(p[q:q + AFTER].max())
            # a rim is followed by PAPER; a digit's stroke only by the disc's own fill
            if min(left, right) - p[q] >= need and right >= top - RETURN_TOL:
                j = q
                break
        if j is None:
            # A dark-FILLED disc (nine on this sheet) has no rim darker than its
            # inside: its edge is the step from the fill to the paper.
            inside = float(np.median(p[int(10 / 0.5):lo]))
            if top - inside < DARK_STEP:
                continue              # no rim and no dark fill: no point on this ray
            j = lo
            rim, out, filled = inside, top, True
        else:
            filled = False
            rim = p[j]
            out = float(p[j:j + AFTER].max())
        half = (rim + out) / 2
        m = j
        while m + 1 < len(p) and p[m + 1] < half:
            m += 1
        if m + 1 >= len(p):
            continue
        # linear interpolation of the half-way crossing
        f = min(1.0, max(0.0, (half - p[m]) / max(1e-6, p[m + 1] - p[m])))
        rr = r[m] + f * 0.5
        ex.append(cx + rr * math.cos(ang[i]))
        ey.append(cy + rr * math.sin(ang[i]))
        rims.append(rim if not filled else None)
    # A "rim" far darker than this disc's own rim is a wall or pillar line the
    # disc touches: that ray ends on the line, not on the disc.
    valley = [v for v in rims if v is not None]
    if valley:
        typical = float(np.median(valley))
        ok = [v is None or v >= typical - LINE_DARKER for v in rims]
        ex, ey = [x for x, k in zip(ex, ok) if k], [y for y, k in zip(ey, ok) if k]
    ex, ey = np.array(ex), np.array(ey)
    if len(ex) < RAYS * KEEP_MIN:
        return dict(status="NOT MEASURED", why=f"rim found on {len(ex)} of {RAYS} rays")
    # A consensus fit first: where a disc nearly touches a wall line, up to a
    # third of its rays end on the line, enough to drag a least-squares fit
    # (and its 3 px refit) with them. 300 six-point samples, fixed seed.
    rng = np.random.default_rng(7)
    best = None
    for _ in range(300):
        idx = rng.choice(len(ex), 6, replace=False)
        e = fit_ellipse(ex[idx], ey[idx])
        if e is None or not (20 < e[2] < 60 and 20 < e[3] < 60):
            continue
        n = int((ellipse_distance(e, ex, ey) <= 1.5).sum())
        if best is None or n > best[0]:
            best = (n, e)
    if best is None:
        return dict(status="NOT MEASURED", why="no ellipse fits the edge points")
    keep = ellipse_distance(best[1], ex, ey) <= 1.5
    e = None
    for _ in range(3):
        e = fit_ellipse(ex[keep], ey[keep])
        if e is None:
            return dict(status="NOT MEASURED", why="no ellipse fits the edge points")
        d = ellipse_distance(e, ex, ey)
        keep = d <= 3
    d = ellipse_distance(e, ex[keep], ey[keep])
    rms = float(np.sqrt(np.mean(d ** 2)))
    kept = int(keep.sum())
    if kept < RAYS * KEEP_MIN or rms > RMS_MAX:
        return dict(status="NOT MEASURED", why=f"{kept} of {RAYS} rays kept, rms {rms:.2f} px", ellipse=e)
    bx, by, bw, bh = axis_box(e)
    return dict(status="MEASURED", cx=round(bx, 1), cy=round(by, 1), w=round(bw, 1), h=round(bh, 1),
                semiAxes=[round(e[2], 1), round(e[3], 1)], thetaDeg=round(math.degrees(e[4]), 1),
                raysKept=kept, rays=RAYS, rmsPx=round(rms, 2), paper=round(paper), ellipse=e,
                points=list(zip(ex[keep].round(1).tolist(), ey[keep].round(1).tolist())))


def main():
    img_path, ann_path, out_path = sys.argv[1:4]
    review = sys.argv[4] if len(sys.argv) > 4 else None
    im = Image.open(img_path).convert("RGB")
    a = np.asarray(im).astype(float)
    g = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    ann = json.load(open(ann_path))
    assert (im.width, im.height) == (ann["source"]["width"], ann["source"]["height"])
    tables = [o for o in ann["objects"] if o["class"] == "table"]
    rows = []
    for t in tables:
        m = measure(g, t["cx"], t["cy"])
        rows.append((t, m))
    out = []
    for t, m in rows:
        o = {k: v for k, v in m.items() if k not in ("ellipse", "points")}
        o["id"] = t["id"]
        o["number"] = t.get("number")
        out.append(o)
    measured = [o for o in out if o["status"] == "MEASURED"]
    asp = sorted(abs(math.log(o["w"] / o["h"])) for o in measured)
    summary = dict(tables=len(out), measured=len(measured), notMeasured=[(o["id"], o["why"]) for o in out if o["status"] != "MEASURED"],
                   aspectLogP50=round(asp[len(asp) // 2], 3) if asp else None,
                   aspectLogP90=round(asp[int(0.9 * (len(asp) - 1))], 3) if asp else None,
                   wRange=[min(o["w"] for o in measured), max(o["w"] for o in measured)] if measured else None,
                   hRange=[min(o["h"] for o in measured), max(o["h"] for o in measured)] if measured else None)
    json.dump(dict(image=img_path, annotation=ann_path, method=__doc__.strip().split("\n\n")[3], summary=summary, outlines=out),
              open(out_path, "w"), indent=1)
    print(json.dumps(summary, indent=1))
    if review:
        S, cols = 120, 14
        rows_n = (len(rows) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * S, rows_n * S), "white")
        for i, (t, m) in enumerate(rows):
            cx, cy = t["cx"], t["cy"]
            crop = im.crop((int(cx - 60), int(cy - 60), int(cx + 60), int(cy + 60)))
            dr = ImageDraw.Draw(crop)
            if "ellipse" in m and m["ellipse"] is not None:
                ecx, ecy, ea, eb, et = m["ellipse"]
                pts = [(ecx - cx + 60 + ea * math.cos(s) * math.cos(et) - eb * math.sin(s) * math.sin(et),
                        ecy - cy + 60 + ea * math.cos(s) * math.sin(et) + eb * math.sin(s) * math.cos(et))
                       for s in np.linspace(0, 2 * math.pi, 73)]
                dr.line(pts, fill=(0, 160, 0) if m["status"] == "MEASURED" else (220, 0, 0), width=1)
            dr.rectangle((60 - 39 + (cx - int(cx)), 60 - 39, 60 + 39, 60 + 39), outline=(80, 120, 255))
            dr.text((2, 2), t["id"], fill=(200, 0, 0))
            if m["status"] != "MEASURED":
                dr.text((2, 108), "NOT MEASURED", fill=(220, 0, 0))
            sheet.paste(crop, ((i % cols) * S, (i // cols) * S))
        sheet.save(review)


if __name__ == "__main__":
    main()
