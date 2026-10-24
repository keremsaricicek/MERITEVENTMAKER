"""A small plan-symbol detector, trained on CPU, exported to ONNX.

Developer-time only. The end user never runs Python: the app loads the exported
ONNX file with the onnxruntime-web build it already ships for OCR.

What it is: a CenterNet-style fully convolutional network, ~0.5 M parameters,
trained FROM SCRATCH (no pretrained weights were reachable from this
environment, and none are needed for line-art symbols). It predicts, at 1/4
resolution, a heatmap per class plus box size and sub-cell offset.

Classes: 0 round table · 1 square/rectangular table · 2 chair · 3 column.

What it is not: a model of rooms. It finds symbols. Relationships, capacity,
merged tables and numbers stay with the rule layer, which consumes its output.

    python training/detector.py train  --synthetic DIR --real golden,ornek --steps 6000 --out runs/v1
    python training/detector.py eval   --model runs/v1/model.pt --plans golden,ornek,DIR
    python training/detector.py export --model runs/v1/model.pt --onnx models/plan-detector/v1/model.onnx
"""
import argparse
import glob
import json
import math
import os
import random
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLASSES = ["table_round", "table_rect", "chair", "column"]
K = len(CLASSES)
# E4 (training/README.md): seating furniture as classes of their own, the
# generator's labels. Off unless a run asks for it (`--seating`) or a checkpoint
# was trained with it; the four-class model is unchanged.
SEATING = ["sofa", "bench", "banquette"]


def set_classes(seating):
    global CLASSES, K
    CLASSES = ["table_round", "table_rect", "chair", "column"] + (SEATING if seating else [])
    K = len(CLASSES)
STRIDE = 4
CROP = 256
LONG_SIDE = 1536  # inference scale: the plan's long side is resized to this

REAL = {
    "golden": ("benchmarks/annotations/merit-real-venue.json", "benchmarks/plans/merit-real-venue-plan.png"),
    "ornek": ("benchmarks/annotations/ornek-symbolic.json", "benchmarks/plans/ornek-upright.png"),
}


# ---- data ------------------------------------------------------------------------
def class_of(o):
    c = o.get("class")
    if c == "table":
        return 0 if o.get("type") in ("round", "bistro") else 1
    if c == "chair":
        return 2
    if c == "column":
        return 3
    if c in SEATING and c in CLASSES:
        return CLASSES.index(c)
    return None


def label_box(o, true_shape=False):
    """The box a label teaches. Synthetic labels store a piece's OWN length and
    depth with its rotation (synth.py, synth_levels.py, synth_relations.py);
    until E10 those were taught as an axis-aligned box, so a bench turned 90
    degrees was taught transposed and one at 30 degrees was taught at its own
    length x depth (QA audit 2026-10-18, F1). With `true_shape` the box is the
    ENCLOSING box of the rotated corners -- what the decoder, E3b, fusion and
    the evaluator all assume -- and the piece's own axis is kept for the
    oriented target. Real annotations already store the enclosing box and are
    never passed through this."""
    cx, cy, w, h = float(o["cx"]), float(o["cy"]), float(o["w"]), float(o["h"])
    deg = float(o.get("rotation") or 0.0)
    if not true_shape or deg % 180 == 0:
        return (cx, cy, w, h), (math.cos(math.radians(deg)), math.sin(math.radians(deg)), w, h)
    t = math.radians(deg)
    c, s_ = abs(math.cos(t)), abs(math.sin(t))
    return (cx, cy, w * c + h * s_, w * s_ + h * c), (math.cos(t), math.sin(t), w, h)


class PlanSample:
    """One plan: its pixels (grey), its labelled objects, and which classes its
    annotation is exhaustive for. A class the annotation does not cover is
    masked out of the loss rather than taught as background."""

    def __init__(self, name, ann_path, img_path, annotated, targets=None, true_shape=False):
        self.name = name
        a = json.load(open(ann_path))
        self.ann = a
        im = Image.open(img_path).convert("L")
        self.W, self.H = im.size
        self.img = np.asarray(im, dtype=np.uint8)
        self.objs = []
        # The piece's own axis and size, aligned with self.objs (E10).
        self.shape = []
        # Boxes taught as NEITHER an object nor background: objects nobody has
        # verified (an exported plan's unreviewed candidates, a teacher's
        # suggestion nobody accepted). Their k is -1.
        self.ignore = []
        for o in a["objects"]:
            k = class_of(o)
            if k is None or not np.isfinite(o.get("cx", float("nan"))):
                continue
            box, own = label_box(o, true_shape)
            # Generation 3 marks what a person could not see (cut by the sheet's
            # edge, under glare, a legend's sample symbol): neither taught nor
            # counted against.
            if o.get("ignore"):
                self.ignore.append((-1,) + box)
                continue
            v = o.get("verification")
            if targets is not None and v is not None and v not in targets:
                # a rejected object is background, which is what every
                # unlabelled pixel already is; anything else is unknown
                if v != "rejected":
                    self.ignore.append((-1,) + box)
                continue
            self.objs.append((k,) + box)
            self.shape.append(own)
        self.annotated = annotated  # list of K bools
        tables = [min(w, h) for k, cx, cy, w, h in self.objs if k in (0, 1)]
        self.ref = float(np.median(tables)) if tables else 40.0
        self.family = (a.get("split") or {}).get("family") or name


def load_real(names):
    out = []
    for n in names:
        if not n:
            continue
        ann, img = REAL[n]
        # Golden: tables and chairs labelled exhaustively, columns not.
        # ORNEK: tables exhaustively; no chair is drawn on that sheet, so
        # "no chairs" is exhaustive too; columns not labelled.
        out.append(PlanSample(n, os.path.join(REPO, ann), os.path.join(REPO, img), [True, True, True, False]))
    return out


# Verification states (training/export_plans.py) that are training targets.
TARGETS = ("human-confirmed",)
TARGETS_WITH_CONFIRM = ("human-confirmed", "accepted-on-confirm")


def load_dataset(dirs, with_confirm=False):
    """Plans exported from the app (training/export_plans.py). Only what a
    person decided is a target; what nobody verified is ignored, never taught
    as background; a rejection is background."""
    targets = TARGETS_WITH_CONFIRM if with_confirm else TARGETS
    out = []
    for d in dirs:
        for f in sorted(glob.glob(os.path.join(d, "exp-*.json"))):
            a = json.load(open(f))
            has_col = any(o.get("class") == "column" and o.get("verification") in targets for o in a["objects"])
            out.append(PlanSample(a["planId"], f, os.path.join(d, a["source"]["file"]), [True, True, True, has_col], targets=targets))
    return out


def load_synthetic(d, families=None, exclude=None, limit=None, true_shape=False):
    out = []
    # generated plans: synth*.py (syn-), relation scenes (rel-) and furniture
    # scenes (seat-) — a directory only ever holds one kind
    for f in sorted(sum((glob.glob(os.path.join(d, pat)) for pat in ("syn-*.json", "rel-*.json", "seat-*.json")), [])):
        a = json.load(open(f))
        fi = a["split"]["familyIndex"]
        if families is not None and fi not in families:
            continue
        if exclude is not None and fi in exclude:
            continue
        out.append(PlanSample(a["planId"], f, os.path.join(d, a["source"]["file"]), [True] * K, true_shape=true_shape))
        if limit and len(out) >= limit:
            break
    return out


def gaussian(heat, cx, cy, sigma):
    h, w = heat.shape
    r = int(3 * sigma) + 1
    x0, x1, y0, y1 = max(0, int(cx) - r), min(w, int(cx) + r + 1), max(0, int(cy) - r), min(h, int(cy) + r + 1)
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    g = np.exp(-((xs - cx) ** 2 + (ys - cy) ** 2) / (2 * sigma * sigma))
    heat[y0:y1, x0:x1] = np.maximum(heat[y0:y1, x0:x1], g)


def gaussian_oriented(heat, cx, cy, s_along, s_across, ux, uy):
    """E10: a Gaussian stretched along a piece's own axis (ux, uy), for the
    seating classes. Centred on the integer cell, so the peak is exactly 1."""
    h, w = heat.shape
    r = int(3 * max(s_along, s_across)) + 1
    x0, x1, y0, y1 = max(0, int(cx) - r), min(w, int(cx) + r + 1), max(0, int(cy) - r), min(h, int(cy) + r + 1)
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    dx, dy = xs - cx, ys - cy
    a, c = dx * ux + dy * uy, -dx * uy + dy * ux
    g = np.exp(-(a * a / (2 * s_along * s_along) + c * c / (2 * s_across * s_across)))
    heat[y0:y1, x0:x1] = np.maximum(heat[y0:y1, x0:x1], g)


def sample_crop(p, rng, crop=CROP, ignore_cut=False, oriented=False):
    # scale so the plan's typical table lands between 18 and 70 px
    target = rng.uniform(18, 70)
    f = target / p.ref
    src = crop / f
    if src >= min(p.W, p.H):
        f = crop / min(p.W, p.H) * 1.0001
        src = crop / f
    x0 = rng.uniform(0, max(0, p.W - src))
    y0 = rng.uniform(0, max(0, p.H - src))
    im = Image.fromarray(p.img).crop((int(x0), int(y0), int(x0 + src), int(y0 + src))).resize((crop, crop), Image.BILINEAR)
    sx = crop / (int(x0 + src) - int(x0))
    sy = crop / (int(y0 + src) - int(y0))
    ox, oy = int(x0), int(y0)
    # photometric augmentation
    if rng.random() < 0.3:
        im = im.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
    a = np.asarray(im, dtype=np.float32) / 255.0
    if rng.random() < 0.5:
        a = np.clip((a - 0.5) * rng.uniform(0.6, 1.3) + 0.5 + rng.uniform(-0.15, 0.1), 0, 1)
    if rng.random() < 0.3:
        a = np.clip(a + np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, rng.uniform(0.01, 0.06), a.shape), 0, 1)
    # each object carries its own axis (ux, uy) and own length/depth in crop
    # pixels beside its box, so a quarter turn or a flip turns the axis too
    shapes = list(getattr(p, "shape", [])) + [None] * len(getattr(p, "ignore", []))
    if len(shapes) != len(p.objs) + len(getattr(p, "ignore", [])):
        shapes = [None] * (len(p.objs) + len(getattr(p, "ignore", [])))
    objs = [(k, (cx - ox) * sx, (cy - oy) * sy, w * sx, h * sy) for k, cx, cy, w, h in p.objs + getattr(p, "ignore", [])]
    axes = [(sh[0], sh[1], sh[2] * sx, sh[3] * sy) if sh else None for sh in shapes]
    # geometric augmentation: quarter turns and flips
    rot = rng.randint(0, 3)
    flip = rng.random() < 0.5
    for _ in range(rot):
        a = np.rot90(a)  # counter-clockwise: (x, y) -> (y, crop - x)
        objs = [(k, cy, crop - cx, h, w) for k, cx, cy, w, h in objs]
        axes = [(ax[1], -ax[0], ax[2], ax[3]) if ax else None for ax in axes]
    if flip:
        a = a[:, ::-1]
        objs = [(k, crop - cx, cy, w, h) for k, cx, cy, w, h in objs]
        axes = [(-ax[0], ax[1], ax[2], ax[3]) if ax else None for ax in axes]
    axis_of = {i: ax for i, ax in enumerate(axes)}
    a = np.ascontiguousarray(a, dtype=np.float32)
    out = crop // STRIDE
    heat = np.zeros((K, out, out), np.float32)
    size = np.zeros((2, out, out), np.float32)
    off = np.zeros((2, out, out), np.float32)
    mask = np.zeros((out, out), np.float32)
    # Ignored boxes first: every class's target there is held just under 1, so
    # the focal loss neither counts it a positive (target == 1) nor teaches it
    # as background (its negative weight (1 - target)^4 is ~1e-12). A real
    # object's peak drawn afterwards still reaches exactly 1.
    # E6: an object the crop shows only part of, its centre outside, is not
    # background. Without this its visible part was taught as background:
    # measured on seat/train (training/README.md, E6), for every positive
    # banquette in a crop 0.55 more stood cut at the crop's edge (bench 0.46,
    # sofa 0.44, chair 0.17). Held just under 1, like an ignored box.
    if ignore_cut:
        objs = objs + [(-1, cx, cy, w, h) for k, cx, cy, w, h in objs
                       if k != -1 and not (0 <= cx < crop and 0 <= cy < crop)
                       and cx + w / 2 > 0 and cx - w / 2 < crop and cy + h / 2 > 0 and cy - h / 2 < crop]
    for k, cx, cy, w, h in objs:
        if k != -1:
            continue
        x0, x1 = max(0, int((cx - w / 2) / STRIDE)), min(out, int(math.ceil((cx + w / 2) / STRIDE)) + 1)
        y0, y1 = max(0, int((cy - h / 2) / STRIDE)), min(out, int(math.ceil((cy + h / 2) / STRIDE)) + 1)
        if x0 < x1 and y0 < y1:
            heat[:, y0:y1, x0:x1] = np.maximum(heat[:, y0:y1, x0:x1], 0.999)
    for i, (k, cx, cy, w, h) in enumerate(objs):
        if k == -1 or not (0 <= cx < crop and 0 <= cy < crop):
            continue
        gx, gy = cx / STRIDE, cy / STRIDE
        sigma = max(0.8, min(w, h) / STRIDE / 5)
        ix, iy = int(gx), int(gy)
        # Centred on the integer cell, so the peak is exactly 1 there: the
        # focal loss counts a cell as positive only where the target IS 1, and
        # the offset head carries the sub-cell remainder.
        ax = axis_of.get(i)
        if oriented and ax and K > 4 and k >= 4:
            # E10 (QA F7): across the piece sigma is today's rule on its own
            # depth; along it, the same rule on its own length
            ux, uy, L, D = ax
            gaussian_oriented(heat[k], ix, iy, max(0.8, max(L, D) / STRIDE / 5), max(0.8, min(L, D) / STRIDE / 5), ux, uy)
        else:
            gaussian(heat[k], ix, iy, sigma)
        size[:, iy, ix] = (math.log(max(w, 2) / STRIDE), math.log(max(h, 2) / STRIDE))
        off[:, iy, ix] = (gx - ix, gy - iy)
        mask[iy, ix] = 1
    cls_mask = np.array(p.annotated, np.float32)
    return a[None], heat, size, off, mask, cls_mask


# ---- model ------------------------------------------------------------------------
def cbr(i, o, s=1, d=1):
    return nn.Sequential(nn.Conv2d(i, o, 3, s, padding=d, dilation=d, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class Res(nn.Module):
    def __init__(self, c, d=1):
        super().__init__()
        self.a = cbr(c, c, 1, d)
        self.b = nn.Sequential(nn.Conv2d(c, c, 3, 1, padding=d, dilation=d, bias=False), nn.BatchNorm2d(c))

    def forward(self, x):
        return F.relu(x + self.b(self.a(x)))


class PlanNet(nn.Module):
    def __init__(self, k=None):
        super().__init__()
        k = k or K
        self.stem = nn.Sequential(cbr(1, 24, 2), cbr(24, 32, 2))
        self.s4 = nn.Sequential(Res(32), Res(32))
        self.s8 = nn.Sequential(cbr(32, 64, 2), Res(64), Res(64))
        self.s16 = nn.Sequential(cbr(64, 96, 2), Res(96), Res(96, 2), Res(96, 4))
        self.l16 = nn.Conv2d(96, 64, 1)
        self.f8 = cbr(64, 64)
        self.l8 = nn.Conv2d(64, 48, 1)
        self.p4 = nn.Conv2d(32, 48, 1)
        self.f4 = cbr(48, 48)
        self.heat = nn.Sequential(cbr(48, 48), nn.Conv2d(48, k, 1))
        self.size = nn.Sequential(cbr(48, 32), nn.Conv2d(32, 2, 1))
        self.off = nn.Sequential(cbr(48, 32), nn.Conv2d(32, 2, 1))
        self.heat[-1].bias.data.fill_(-2.19)

    def features(self, x):
        x = (x - 0.5) / 0.5
        a4 = self.s4(self.stem(x))
        a8 = self.s8(a4)
        a16 = self.s16(a8)
        u8 = self.f8(a8 + F.interpolate(self.l16(a16), size=a8.shape[-2:], mode="bilinear", align_corners=False))
        return self.f4(self.p4(a4) + F.interpolate(self.l8(u8), size=a4.shape[-2:], mode="bilinear", align_corners=False))

    def forward(self, x):
        u4 = self.features(x)
        return torch.sigmoid(self.heat(u4)), self.size(u4), self.off(u4)


class PlanNetSeat(nn.Module):
    """E5 (training/README.md): a frozen four-class PlanNet plus a seating
    branch — its own heat for sofa / bench / banquette and its own size and
    offset — on the same stride-4 features. The outputs keep PlanNet's form
    (heat[K=7], size, off) so export, decode and the app read it unchanged: at
    a cell where a seating channel is the strongest, size and offset come from
    the branch."""

    def __init__(self):
        super().__init__()
        self.base = PlanNet(k=4)
        self.seat_trunk = nn.Sequential(cbr(48, 64), cbr(64, 64, d=2))
        self.seat_heat = nn.Conv2d(64, len(SEATING), 1)
        self.seat_size = nn.Sequential(cbr(64, 32), nn.Conv2d(32, 2, 1))
        self.seat_off = nn.Sequential(cbr(64, 32), nn.Conv2d(32, 2, 1))
        self.seat_heat.bias.data.fill_(-2.19)

    def parts(self, x):
        u4 = self.base.features(x)
        t = self.seat_trunk(u4)
        return (torch.sigmoid(self.base.heat(u4)), self.base.size(u4), self.base.off(u4),
                torch.sigmoid(self.seat_heat(t)), self.seat_size(t), self.seat_off(t))

    def forward(self, x):
        bh, bs, bo, sh, ss, so = self.parts(x)
        use = (sh.amax(1, keepdim=True) > bh.amax(1, keepdim=True)).float()
        return torch.cat([bh, sh], 1), bs * (1 - use) + ss * use, bo * (1 - use) + so * use


def focal(pred, gt, cls_mask, balance=False):
    pred = pred.clamp(1e-4, 1 - 1e-4)
    pos = gt.eq(1).float()
    neg = 1 - pos
    m = cls_mask[:, :, None, None]
    pl = torch.log(pred) * (1 - pred) ** 2 * pos * m
    if balance:
        # E6: each class's positives weigh as much in total as any other
        # class's (inverse of its share of the batch's positives), so the
        # rarest class is not learned from a fifth of the gradient. The
        # negatives and the normaliser are unchanged.
        nc = (pos * m).sum((0, 2, 3))
        present = nc > 0
        wc = torch.where(present, nc.sum() / (present.sum().clamp(min=1) * nc.clamp(min=1)), torch.zeros_like(nc))
        pl = pl * wc[None, :, None, None]
    nl = torch.log(1 - pred) * pred ** 2 * (1 - gt) ** 4 * neg * m
    n = (pos * m).sum()
    return -(pl.sum() + nl.sum()) / max(1.0, n.item())


# ---- decode ---------------------------------------------------------------------------
def decode(heat, size, off, thr=0.3, topk=3000):
    """heat [K,h,w] numpy -> list of (k, cx, cy, w, h, score) in input px."""
    t = torch.from_numpy(heat)[None]
    peaks = (F.max_pool2d(t, 3, 1, 1) == t).float() * t
    p = peaks[0].numpy()
    ks, ys, xs = np.nonzero(p >= thr)
    sc = p[ks, ys, xs]
    order = np.argsort(-sc)[:topk]
    out = []
    for i in order:
        k, y, x = ks[i], ys[i], xs[i]
        cx = (x + off[0, y, x]) * STRIDE
        cy = (y + off[1, y, x]) * STRIDE
        w = math.exp(size[0, y, x]) * STRIDE
        h = math.exp(size[1, y, x]) * STRIDE
        out.append((int(k), float(cx), float(cy), float(w), float(h), float(sc[i])))
    return out


# Classes that are one kind of object to the person reading the plan: a round
# and a rectangular table on the same spot are one table; a sofa, a bench and a
# banquette on the same spot are one piece of seating furniture.
GROUP_OF = {0: 0, 1: 0, 2: 2, 3: 3, 4: 4, 5: 4, 6: 4}


# E5: a table box and a seating-furniture box on the same spot are one object
# drawn once; the stronger reading is kept, as within a group.
CONFLICT = {(0, 4), (4, 0)}


# E3b (training/README.md, E9): seating furniture is LONG, so half its short
# side (~10 px for a bench) cannot merge two peaks standing 30 px apart along
# one bench. Within the seating group and its table conflict, a weaker centre
# INSIDE the stronger box is the same piece. Off with MERIT_DECODE_E3B=0 for an
# A/B measurement; tables, chairs and columns keep E3 either way.
SEATING_GROUP = 4
E3B = os.environ.get("MERIT_DECODE_E3B", "1") != "0"


def suppress_close(dets):
    """Drop a detection whose centre lies within half the short side of a
    STRONGER detection of the same group (E3, training/README.md). A 3x3 peak
    pick leaves two peaks on one broad table; two real tables cannot stand that
    close without overlapping. For seating furniture, a centre inside the
    stronger box (E3b). `dets` is sorted by score, strongest first, and so is
    the result. Mirrored in src/plan-model.js."""
    kept = []
    for d in dets:
        g = GROUP_OF.get(d[0], d[0])
        if any((GROUP_OF.get(k[0], k[0]) == g or (GROUP_OF.get(k[0], k[0]), g) in CONFLICT)
               and (math.hypot(d[1] - k[1], d[2] - k[2]) < 0.5 * min(k[3], k[4])
                    or (E3B and SEATING_GROUP in (g, GROUP_OF.get(k[0], k[0]))
                        and abs(d[1] - k[1]) <= k[3] / 2 and abs(d[2] - k[2]) <= k[4] / 2)) for k in kept):
            continue
        kept.append(d)
    return kept


def detect_plan(model, p, long_side=LONG_SIDE, thr=0.3, suppress=True):
    f = long_side / max(p.W, p.H)
    W2, H2 = int(round(p.W * f / 16) * 16), int(round(p.H * f / 16) * 16)
    im = Image.fromarray(p.img).resize((W2, H2), Image.BILINEAR)
    x = torch.from_numpy(np.asarray(im, np.float32) / 255.0)[None, None]
    with torch.no_grad():
        h, s, o = model(x)
    dets = decode(h[0].numpy(), s[0].numpy(), o[0].numpy(), thr)
    sx, sy = p.W / W2, p.H / H2
    out = [(k, cx * sx, cy * sy, w * sx, h_ * sy, sc) for k, cx, cy, w, h_, sc in dets]
    return suppress_close(out) if suppress else out


# ---- scoring: the same greedy nearest-first match as benchmarks/run-benchmark.mjs -------
def match(gt, det, diag, tol_pct):
    tol = tol_pct / 100 * diag
    pairs = []
    for gi, g in enumerate(gt):
        for di, d in enumerate(det):
            dist = math.hypot(g[0] - d[0], g[1] - d[1])
            if dist <= tol:
                pairs.append((dist, gi, di))
    pairs.sort()
    gu, du, m = set(), set(), []
    for dist, gi, di in pairs:
        if gi in gu or di in du:
            continue
        gu.add(gi)
        du.add(di)
        m.append((gi, di))
    return m, len(gt) - len(gu), len(det) - len(du)


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return dict(tp=tp, fp=fp, fn=fn, precision=round(p, 3), recall=round(r, 3), f1=round(2 * p * r / (p + r), 3) if p + r else 0.0)


def score(p, dets):
    diag = math.hypot(p.W, p.H)
    tol = p.ann.get("matchToleranceP") or 3.0
    res = {}
    groups = {"tables": (0, 1), "chairs": (2,), "columns": (3,)}
    if K > 4:
        groups.update({"sofas": (4,), "benches": (5,), "banquettes": (6,), "seating": (4, 5, 6)})
    for name, ks in groups.items():
        # a class the annotation does not declare (a real plan annotated before
        # the furniture classes existed) is not scored, as for any unannotated class
        if not all(k < len(p.annotated) and p.annotated[k] for k in ks):
            continue
        gt = [(cx, cy) for k, cx, cy, w, h in p.objs if k in ks]
        dt = [(cx, cy) for k, cx, cy, w, h, s in dets if k in ks]
        # A detection on an object marked `ignore` (generation 3: cut by the
        # edge, under glare, a legend's sample) is neither right nor wrong.
        ign = [(cx, cy, max(w, h)) for k, cx, cy, w, h in getattr(p, "ignore", [])]
        if ign:
            dt = [(x, y) for x, y in dt if not any(math.hypot(x - ix, y - iy) <= max(r * 0.6, 4) for ix, iy, r in ign)]
        if not gt and not dt:
            continue
        m, fn, fp = match(gt, dt, diag, tol)
        res[name] = prf(len(m), fp, fn)
    # table type on matched tables
    gtt = [(cx, cy, k) for k, cx, cy, w, h in p.objs if k in (0, 1)]
    dtt = [(cx, cy, k) for k, cx, cy, w, h, s in dets if k in (0, 1)]
    m, _, _ = match(gtt, dtt, diag, tol)
    if m:
        res["tableType"] = dict(matched=len(m), correct=sum(1 for gi, di in m if gtt[gi][2] == dtt[di][2]))
    return res


# ---- train ----------------------------------------------------------------------------
def train(args):
    set_classes(getattr(args, "seating", False))
    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    torch.set_num_threads(args.threads)
    # one directory, or several separated by commas (generation 2 and 3 together)
    excl = set(int(x) for x in args.exclude_families.split(",") if x != "")
    syn = [s for d in args.synthetic.split(",") if d for s in load_synthetic(d, exclude=excl, true_shape=getattr(args, "true_shape", False))]
    real = load_real([x for x in args.real.split(",") if x])
    if args.dataset:
        real += load_dataset([x for x in args.dataset.split(",") if x], with_confirm=args.with_confirm)
    print(f"train: {len(syn)} synthetic plans, real: {[p.name for p in real]}", flush=True)
    # --oversample "5=2,6=2": a generation-3 plan of that level is drawn that many
    # times as often. Empty (the default) keeps the exact sampling of every
    # earlier run, random stream included.
    over = {int(k): float(v) for k, v in (x.split("=") for x in args.oversample.split(",") if x)}
    syn_w = [over.get((p.ann.get("level") if isinstance(p.ann.get("level"), int) else -1), 1.0) for p in syn] if over else None
    if over:
        print(f"oversample {over}: {sum(1 for w in syn_w if w != 1.0)} plans weighted", flush=True)
    seat_branch = getattr(args, "seat_branch", False)
    teacher = None
    if seat_branch:
        # E5: the four-class model is loaded into `base` and frozen; only the
        # seating branch trains. Furniture plans are drawn more often.
        model = PlanNetSeat()
        base_state = torch.load(args.init, map_location="cpu", weights_only=False)["state"]
        model.base.load_state_dict(base_state)
        teacher = None
        if args.distill > 0:
            # E7: the base may adapt (at --base-lr-scale of the rate) so the
            # features can learn what a bench is; a frozen copy of the starting
            # model is the teacher, and the base's own four channels are held to
            # its answers on every pixel of every crop (weight --distill), so a
            # table, chair or column reading moves only where it has to.
            teacher = PlanNet(k=4)
            teacher.load_state_dict(base_state)
            teacher.eval()
            for q in teacher.parameters():
                q.requires_grad_(False)
        else:
            for q in model.base.parameters():
                q.requires_grad_(False)
        w = [4.0 if any(k >= 4 for k, *_ in p.objs) else 1.0 for p in syn]
        syn_w = w
        print(f"seat branch on {'a distilled' if teacher is not None else 'frozen'} {args.init}; {sum(1 for x in w if x > 1)} plans with furniture weighted x4", flush=True)
    else:
        model = PlanNet()
    if args.init and not seat_branch:
        # Warm start from another run (e.g. a fold model from the synthetic-only
        # run). Recorded in the checkpoint's args; it adds no data of its own.
        state = torch.load(args.init, map_location="cpu", weights_only=False)["state"]
        own = model.state_dict()
        for name in ("heat.1.weight", "heat.1.bias"):
            # a run that adds classes keeps the starting model's channels and
            # gives the new ones the head's own initial values
            if name in state and state[name].shape != own[name].shape:
                grown = own[name].clone()
                grown[: state[name].shape[0]] = state[name]
                state[name] = grown
                print(f"{name}: {tuple(state[name].shape)} (first {CLASSES.index('column') + 1} channels from {args.init})", flush=True)
        model.load_state_dict(state)
        print(f"initialised from {args.init}", flush=True)
    nparams = sum(p.numel() for p in model.parameters())
    print(f"params: {nparams}", flush=True)
    if seat_branch and teacher is not None:
        base_ids = {id(q) for q in model.base.parameters()}
        groups = [{"params": [q for q in model.parameters() if q.requires_grad and id(q) not in base_ids], "lr": args.lr},
                  {"params": [q for q in model.base.parameters()], "lr": args.lr * args.base_lr_scale}]
        opt = torch.optim.AdamW(groups, weight_decay=1e-4)
        max_lr = [args.lr, args.lr * args.base_lr_scale]
    else:
        opt = torch.optim.AdamW([q for q in model.parameters() if q.requires_grad], lr=args.lr, weight_decay=1e-4)
        max_lr = args.lr
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=max_lr, total_steps=args.steps, pct_start=0.1)
    os.makedirs(args.out, exist_ok=True)
    log = open(os.path.join(args.out, "train.log"), "a")
    t0 = time.time()
    model.train()
    if seat_branch:
        model.base.eval()  # its batch-norm statistics stay v2's; its weights train only under --distill (E7)
    for step in range(1, args.steps + 1):
        batch = []
        for _ in range(args.batch):
            pool = real if (real and rng.random() < args.real_frac) else syn
            pick = rng.choices(syn, weights=syn_w)[0] if (syn_w and pool is syn) else rng.choice(pool)
            batch.append(sample_crop(pick, rng, ignore_cut=args.ignore_cut, oriented=getattr(args, "true_shape", False)))
        x = torch.from_numpy(np.stack([b[0] for b in batch]))
        heat = torch.from_numpy(np.stack([b[1] for b in batch]))
        size = torch.from_numpy(np.stack([b[2] for b in batch]))
        off = torch.from_numpy(np.stack([b[3] for b in batch]))
        mask = torch.from_numpy(np.stack([b[4] for b in batch]))
        cm = torch.from_numpy(np.stack([b[5] for b in batch]))
        if seat_branch:
            # only the branch's channels and only furniture centres: the loss is
            # normalised by furniture positives, not by every object on the crop
            bh, bs, bo, ph, ps, po = model.parts(x)
            lh = focal(ph, heat[:, 4:], cm[:, 4:], balance=args.balance_classes)
            if teacher is not None:
                # the base's four channels held to the teacher's, per pixel; the
                # sum is normalised like the focal loss, by the batch's positives
                with torch.no_grad():
                    th, ts, to = teacher(x)
                npos = max(1.0, float((heat[:, :4] == 1).sum()))
                tc = th.clamp(1e-4, 1 - 1e-4)
                # KL(teacher || student): the cross-entropy minus the teacher's
                # own entropy, so it reads 0 where the base still agrees
                kl = F.binary_cross_entropy(bh.clamp(1e-4, 1 - 1e-4), tc, reduction="sum") - F.binary_cross_entropy(tc, tc, reduction="sum")
                lh = lh + args.distill * kl / npos
            mask = mask * (heat[:, 4:] == 1).any(1).float()
        else:
            ph, ps, po = model(x)
            lh = focal(ph, heat, cm)
        n = mask.sum().clamp(min=1)
        ls = (F.l1_loss(ps, size, reduction="none").sum(1) * mask).sum() / n
        lo = (F.l1_loss(po, off, reduction="none").sum(1) * mask).sum() / n
        loss = lh + args.size_weight * ls + lo
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        opt.step()
        sched.step()
        if step % 50 == 0 or step == 1:
            msg = f"step {step} loss {loss.item():.3f} heat {lh.item():.3f} size {ls.item():.3f} off {lo.item():.3f} {time.time() - t0:.0f}s"
            print(msg, flush=True)
            log.write(msg + "\n")
            log.flush()
        if step % 1000 == 0 or step == args.steps:
            torch.save({"state": model.state_dict(), "step": step, "args": vars(args), "params": nparams}, os.path.join(args.out, "model.pt"))
    print(f"done in {time.time() - t0:.0f}s", flush=True)


def load_model(path):
    ck = torch.load(path, map_location="cpu", weights_only=False)
    a = ck.get("args") or {}
    set_classes(bool(a.get("seating")))
    m = PlanNetSeat() if a.get("seat_branch") else PlanNet()
    m.load_state_dict(ck["state"])
    m.eval()
    return m, ck


def evaluate(args):
    torch.set_num_threads(args.threads)
    model, ck = load_model(args.model)
    plans = []
    for spec in args.plans.split(","):
        if spec in REAL:
            plans += load_real([spec])
        elif os.path.isdir(spec):
            plans += load_synthetic(spec, families=set(int(x) for x in args.families.split(",")) if args.families else None, limit=args.limit)
    thr_by_class = {}
    if args.thresholds:
        tj = json.load(open(args.thresholds))
        thr_by_class = {CLASSES.index(k): v["threshold"] for k, v in tj["perClass"].items()}
    report = {"model": args.model, "thresholds": thr_by_class or args.thr, "step": ck.get("step"), "trainedOn": {k: ck["args"].get(k) for k in ("synthetic", "real", "exclude_families")}, "longSide": args.long_side, "threshold": args.thr, "plans": {}}
    agg = {}
    for p in plans:
        t = time.time()
        dets = detect_plan(model, p, args.long_side, min(thr_by_class.values()) if thr_by_class else args.thr, suppress=not thr_by_class)
        if thr_by_class:
            dets = suppress_close([d for d in dets if d[5] >= thr_by_class.get(d[0], args.thr)])
        ms = round((time.time() - t) * 1000)
        s = score(p, dets)
        report["plans"][p.name] = dict(family=p.family, ms=ms, **s)
        for k, v in s.items():
            if "tp" in v:
                a = agg.setdefault(k, [0, 0, 0])
                a[0] += v["tp"]; a[1] += v["fp"]; a[2] += v["fn"]
        if p.name in REAL or len(plans) <= 6:
            print(p.name, ms, "ms", json.dumps(s), flush=True)
    report["pooled"] = {k: prf(*v) for k, v in agg.items()}
    print("pooled", json.dumps(report["pooled"]), flush=True)
    if args.report:
        os.makedirs(os.path.dirname(args.report) or ".", exist_ok=True)
        json.dump(report, open(args.report, "w"), indent=1)


def calibrate(args):
    """Per-class score thresholds chosen on the SYNTHETIC VALIDATION plans only
    (never on Golden/ORNEK, which are test venues for the cross-venue folds):
    the lowest threshold whose precision on val reaches --target-precision, so
    what the model adds is mostly right; recall is whatever that leaves."""
    torch.set_num_threads(args.threads)
    model, ck = load_model(args.model)
    plans = load_synthetic(args.plans, limit=args.limit)
    fixed = {CLASSES.index(k): float(v) for k, v in (x.split("=") for x in args.fixed.split(",") if x)} if getattr(args, "fixed", "") else {}
    if fixed:
        return calibrate_app_order(args, model, plans, fixed)
    per = {k: [] for k in range(K)}  # (score, is_tp) per class, pooled over plans
    totals = {k: 0 for k in range(K)}
    for p in plans:
        dets = detect_plan(model, p, args.long_side, 0.1)
        diag = math.hypot(p.W, p.H)
        tol = (p.ann.get("matchToleranceP") or 3.0) / 100 * diag
        for k in range(K):
            gt = [(cx, cy) for kk, cx, cy, w, h in p.objs if kk == k]
            dt = sorted([(s, cx, cy) for kk, cx, cy, w, h, s in dets if kk == k], reverse=True)
            totals[k] += len(gt)
            used = set()
            for s, cx, cy in dt:  # greedy by score: a detection is TP if an unused GT lies within tol
                best, bd = -1, tol
                for gi, (gx, gy) in enumerate(gt):
                    if gi in used:
                        continue
                    d = math.hypot(gx - cx, gy - cy)
                    if d <= bd:
                        best, bd = gi, d
                if best >= 0:
                    used.add(best)
                per[k].append((s, best >= 0))
    out = {}
    for k in range(K):
        rows = sorted(per[k], reverse=True)
        tp = fp = 0
        choice = None
        curve = []
        for s, ok in rows:
            tp += ok
            fp += (not ok)
            prec = tp / (tp + fp)
            rec = tp / totals[k] if totals[k] else 0
            curve.append((s, prec, rec))
        for s, prec, rec in curve:
            if prec >= args.target_precision:
                choice = (s, prec, rec)
        if choice is None and curve:
            choice = max(curve, key=lambda c: c[1])
        out[CLASSES[k]] = {"threshold": round(max(0.2, choice[0]), 3) if choice else 0.5,
                           "valPrecision": round(choice[1], 3) if choice else None, "valRecall": round(choice[2], 3) if choice else None,
                           "valObjects": totals[k]}
    res = {"targetPrecision": args.target_precision, "chosenOn": args.plans, "plans": len(plans), "perClass": out}
    print(json.dumps(res, indent=1))
    json.dump(res, open(os.path.join(os.path.dirname(args.model), "thresholds.json"), "w"), indent=1)


def calibrate_app_order(args, model, plans, fixed):
    """Calibration in the order the app and `evaluate` decode: per-class
    thresholds FIRST, then suppression (QA audit 2026-10-18, F4). The old
    order suppressed at 0.1 and thresholded after, so a base-class peak below
    its own 0.5 threshold still suppressed a seating peak beside it (the
    table/seating conflict) -- a peak the app never sees. Measured on 40
    training scenes: sofa precision 0.971 in that order, 0.912 in the app's.

    `fixed` classes keep their threshold (the base classes at 0.5). The others
    are swept together on a grid, then each again with the rest at their first
    choice; the lowest threshold whose precision reaches the target wins."""
    raw = []
    for p in plans:
        dets = detect_plan(model, p, args.long_side, 0.1, suppress=False)
        diag = math.hypot(p.W, p.H)
        raw.append((p, dets, (p.ann.get("matchToleranceP") or 3.0) / 100 * diag))
    free = [k for k in range(K) if k not in fixed]
    grid = [round(0.1 + 0.02 * i, 2) for i in range(43)]

    def counts(thr):
        tp = {k: 0 for k in free}; fp = {k: 0 for k in free}; tot = {k: 0 for k in free}
        for p, dets, tol in raw:
            kept = suppress_close([d for d in dets if d[5] >= thr.get(d[0], 0.5)])
            for k in free:
                gt = [(cx, cy) for kk, cx, cy, w, h in p.objs if kk == k]
                tot[k] += len(gt)
                used = set()
                for d in sorted([d for d in kept if d[0] == k], key=lambda d: -d[5]):
                    best, bd = -1, tol
                    for gi, (gx, gy) in enumerate(gt):
                        if gi not in used and math.hypot(gx - d[1], gy - d[2]) <= bd:
                            best, bd = gi, math.hypot(gx - d[1], gy - d[2])
                    if best >= 0:
                        used.add(best); tp[k] += 1
                    else:
                        fp[k] += 1
        return tp, fp, tot

    def choose(k, others):
        best = None
        for t in grid:
            tp, fp, tot = counts({**fixed, **others, k: t})
            prec = tp[k] / (tp[k] + fp[k]) if tp[k] + fp[k] else 0.0
            rec = tp[k] / tot[k] if tot[k] else 0.0
            if prec >= args.target_precision:
                return t, prec, rec, tot[k]
            if best is None or prec > best[1]:
                best = (t, prec, rec, tot[k])
        return best

    first = {}
    for t in grid:  # the free classes swept together
        tp, fp, tot = counts({**fixed, **{k: t for k in free}})
        for k in free:
            prec = tp[k] / (tp[k] + fp[k]) if tp[k] + fp[k] else 0.0
            if k not in first and prec >= args.target_precision:
                first[k] = t
    for k in free:
        first.setdefault(k, 0.5)
    out = {}
    for k in range(K):
        if k in fixed:
            out[CLASSES[k]] = {"threshold": fixed[k], "note": "fixed (not calibrated)"}
            continue
        t, prec, rec, n = choose(k, {kk: first[kk] for kk in free if kk != k})
        out[CLASSES[k]] = {"threshold": t, "valPrecision": round(prec, 3), "valRecall": round(rec, 3), "valObjects": n}
    res = {"targetPrecision": args.target_precision, "chosenOn": args.plans, "plans": len(plans), "order": "threshold-then-suppress (app order)", "perClass": out}
    print(json.dumps(res, indent=1))
    json.dump(res, open(os.path.join(os.path.dirname(args.model), "thresholds.json"), "w"), indent=1)


def export(args):
    model, ck = load_model(args.model)
    x = torch.zeros(1, 1, 512, 512)
    os.makedirs(os.path.dirname(args.onnx), exist_ok=True)
    torch.onnx.export(model, x, args.onnx, input_names=["image"], output_names=["heat", "size", "offset"],
                      dynamic_axes={"image": {2: "h", 3: "w"}, "heat": {2: "h4", 3: "w4"}, "size": {2: "h4", 3: "w4"}, "offset": {2: "h4", 3: "w4"}},
                      opset_version=17, dynamo=False)
    print("exported", args.onnx, os.path.getsize(args.onnx), "bytes")


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    t = sp.add_parser("train")
    t.add_argument("--synthetic", default="")
    t.add_argument("--real", default="")
    t.add_argument("--dataset", default="", help="directories written by training/export_plans.py")
    t.add_argument("--with-confirm", action="store_true", help="also train on labels accepted with Confirm Plan, not one by one")
    t.add_argument("--exclude-families", default="8,9")
    t.add_argument("--steps", type=int, default=6000)
    t.add_argument("--batch", type=int, default=16)
    t.add_argument("--lr", type=float, default=2e-3)
    t.add_argument("--real-frac", type=float, default=0.3)
    t.add_argument("--threads", type=int, default=4)
    t.add_argument("--seed", type=int, default=1)
    t.add_argument("--init", default="")
    t.add_argument("--seating", action="store_true", help="E4: sofa, bench and banquette as classes of their own (K = 7)")
    t.add_argument("--seat-branch", action="store_true", help="E5: with --seating, a seating branch on a FROZEN four-class --init model")
    t.add_argument("--size-weight", type=float, default=0.1, help="weight of the log-size L1 loss (0.1 = every run before 2026-10-17)")
    t.add_argument("--ignore-cut", action="store_true", help="E6: an object cut by the crop's edge, its centre outside, is ignored rather than taught as background")
    t.add_argument("--balance-classes", action="store_true", help="E6: with --seat-branch, each seating class's positives weigh equally in the focal loss")
    t.add_argument("--distill", type=float, default=0.0, help="E7: with --seat-branch, the base trains too and its four channels are held to a frozen copy of --init (weight)")
    t.add_argument("--base-lr-scale", type=float, default=0.1, help="E7: the base's learning rate as a share of --lr")
    t.add_argument("--true-shape", action="store_true", help="E10: a turned synthetic label teaches the ENCLOSING box of its rotated corners (size target, ignore-cut), and sofa/bench/banquette an oriented Gaussian along the piece")
    t.add_argument("--oversample", default="", help='generation-3 levels drawn more often, e.g. "5=2,6=2"')
    t.add_argument("--out", required=True)
    e = sp.add_parser("eval")
    e.add_argument("--model", required=True)
    e.add_argument("--plans", required=True)
    e.add_argument("--families", default="")
    e.add_argument("--limit", type=int, default=None)
    e.add_argument("--long-side", type=int, default=LONG_SIDE)
    e.add_argument("--thr", type=float, default=0.3)
    e.add_argument("--threads", type=int, default=4)
    e.add_argument("--report", default="")
    e.add_argument("--thresholds", default="")
    c = sp.add_parser("calibrate")
    c.add_argument("--model", required=True)
    c.add_argument("--plans", required=True)
    c.add_argument("--limit", type=int, default=None)
    c.add_argument("--long-side", type=int, default=LONG_SIDE)
    c.add_argument("--target-precision", type=float, default=0.95)
    c.add_argument("--threads", type=int, default=4)
    c.add_argument("--fixed", default="", help='classes NOT calibrated, decoded at a fixed threshold in the app order, e.g. "table_round=0.5,table_rect=0.5,chair=0.5,column=0.5"')
    x = sp.add_parser("export")
    x.add_argument("--model", required=True)
    x.add_argument("--onnx", required=True)
    a = ap.parse_args()
    {"train": train, "eval": evaluate, "export": export, "calibrate": calibrate}[a.cmd](a)


if __name__ == "__main__":
    main()
