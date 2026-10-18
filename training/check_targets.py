"""Unit check for E10's targets (QA audit 2026-10-18, F1/F3/F7): what a turned
synthetic label teaches.

    python training/check_targets.py        # exit 0 = every check holds

- the box of a piece at 0, 30 and 90 degrees is the ENCLOSING box of its
  rotated corners (and, without --true-shape, the old axis-aligned own size);
- the size target sample_crop writes is that box, through any quarter turn or
  flip of the crop;
- the seating target is stretched along the piece's own axis, so a bench
  turned 90 degrees peaks in a vertical streak, not a horizontal one.

No data, no model: a plan built here, three pieces on paper.
"""
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detector as D  # noqa: E402

failures = []


def check(ok, what):
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        failures.append(what)


def close(a, b, tol=0.05):
    return abs(a - b) <= tol * max(1.0, abs(b))


L, Dp = 120.0, 20.0
for deg, want in ((0, (120.0, 20.0)), (30, (L * math.cos(math.pi / 6) + Dp * 0.5, L * 0.5 + Dp * math.cos(math.pi / 6))), (90, (20.0, 120.0))):
    (cx, cy, w, h), own = D.label_box({"cx": 100, "cy": 100, "w": L, "h": Dp, "rotation": deg}, true_shape=True)
    check(close(w, want[0]) and close(h, want[1]), f"{deg} deg: enclosing box {w:.1f} x {h:.1f} == {want[0]:.1f} x {want[1]:.1f}")
    check(close(own[2], L) and close(own[3], Dp), f"{deg} deg: the piece's own length x depth is kept for the oriented target")
(_, _, w0, h0), _ = D.label_box({"cx": 0, "cy": 0, "w": L, "h": Dp, "rotation": 90}, true_shape=False)
check(w0 == L and h0 == Dp, "without --true-shape the label is unchanged (every run before E10)")


class FakePlan:
    """A blank 512 x 512 sheet with one bench, as PlanSample would hold it."""

    def __init__(self, deg):
        D.set_classes(True)
        self.W = self.H = 512
        self.img = np.full((512, 512), 255, np.uint8)
        box, own = D.label_box({"cx": 256, "cy": 256, "w": L, "h": Dp, "rotation": deg}, true_shape=True)
        self.objs = [(D.CLASSES.index("bench"),) + box]
        self.shape = [own]
        self.ignore = []
        self.ref = 40.0
        self.annotated = [True] * D.K


def target_at_centre(plan, seed):
    rng = random.Random(seed)
    a, heat, size, off, mask, cls = D.sample_crop(plan, rng, oriented=True)
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    iy, ix = ys[0], xs[0]
    w, h = math.exp(size[0, iy, ix]) * D.STRIDE, math.exp(size[1, iy, ix]) * D.STRIDE
    k = D.CLASSES.index("bench")
    hm = heat[k]
    # the streak's direction: second moments of the target above 0.5
    yy, xx = np.nonzero(hm > 0.5)
    vx, vy = float(np.var(xx)) if len(xx) > 1 else 0.0, float(np.var(yy)) if len(yy) > 1 else 0.0
    return w, h, vx, vy, hm.max()


for deg in (0, 90):
    plan = FakePlan(deg)
    box = plan.objs[0][3:5]
    seen = 0
    for seed in range(40):
        r = target_at_centre(plan, seed)
        if not r:
            continue
        w, h, vx, vy, peak = r
        seen += 1
        # the crop scales the sheet: compare aspect, and the streak against it
        aspect_ok = close(w / h, box[0] / box[1], 0.08) or close(w / h, box[1] / box[0], 0.08)
        long_axis_x = w > h
        streak_ok = (vx > vy) == long_axis_x
        if not (aspect_ok and streak_ok and close(peak, 1.0, 0.001)):
            check(False, f"{deg} deg seed {seed}: target {w:.1f} x {h:.1f}, streak var x {vx:.2f} y {vy:.2f}, peak {peak:.3f}")
            break
    else:
        check(seen >= 10, f"{deg} deg: over {seen} crops (random quarter turns and flips) the size target is the enclosing box and the peak streaks along the piece")

print("ALL CHECKS HOLD" if not failures else f"{len(failures)} FAILED")
sys.exit(1 if failures else 0)
