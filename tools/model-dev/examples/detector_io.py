"""Shared helpers for the model-dev examples: the pinned plan-symbol detector,
run with ONNX Runtime and decoded with NumPy only (no torch).

The model is read from the same pinned bytes the product loads
(models/plan-detector/<version>/model.js, base64) and refused if its size or
sha256 differs from the manifest — the rule src/plan-model.js applies.
Pre-processing and decoding mirror training/detector.py (detect_plan, decode):
grey 0..1, long side resized to 1536 and both sides to multiples of 16, peaks
are 3x3 local maxima of the heat map, sizes are exp(log(w/4)) * 4.
"""
import base64
import hashlib
import json
import math
import os
import re

import offline_env  # noqa: F401  - before anything that could import onnxruntime
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CLASSES = ["table_round", "table_rect", "chair", "column"]
STRIDE = 4
LONG_SIDE = 1536


def pinned_model_bytes(version="v2"):
    d = os.path.join(ROOT, "models", "plan-detector", version)
    man = json.load(open(os.path.join(d, "manifest.json"), encoding="utf-8"))
    js = open(os.path.join(d, "model.js"), encoding="utf-8").read()
    m = re.search(r'"b64":\s*"([A-Za-z0-9+/=]+)"', js)
    if not m:
        raise SystemExit(f"{d}/model.js carries no base64 model")
    raw = base64.b64decode(m.group(1))
    digest = hashlib.sha256(raw).hexdigest()
    if len(raw) != man["bytes"] or digest != man["sha256"]:
        raise SystemExit(f"model {version} does not match its pin: {len(raw)} bytes {digest} vs {man['bytes']} {man['sha256']}")
    return raw, man


def model_bytes(version="v2", onnx_path=None):
    """The pinned version, or a CANDIDATE file (e.g. runs/<x>/model.onnx from
    training/detector.py export), which is reported as unpinned: a candidate is
    never the product's model until training/package.py --activate pins it."""
    if not onnx_path:
        raw, man = pinned_model_bytes(version)
        return raw, {"version": version, "pinned": True, "sha256": man["sha256"], "bytes": man["bytes"]}
    raw = open(onnx_path, "rb").read()
    return raw, {"version": None, "pinned": False, "file": os.path.abspath(onnx_path),
                 "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


def prepare(img_path, long_side=LONG_SIDE):
    im = Image.open(img_path).convert("L")
    W, H = im.size
    f = long_side / max(W, H)
    W2, H2 = int(round(W * f / 16) * 16), int(round(H * f / 16) * 16)
    x = np.asarray(im.resize((W2, H2), Image.BILINEAR), np.float32)[None, None] / 255.0
    return x, (W, H, W2, H2)


def maxpool3(a):
    """3x3 max pool, stride 1, padding 1, per channel (what F.max_pool2d(t,3,1,1) does)."""
    p = np.pad(a, ((0, 0), (1, 1), (1, 1)), constant_values=-np.inf)
    out = np.full_like(a, -np.inf)
    for dy in range(3):
        for dx in range(3):
            out = np.maximum(out, p[:, dy:dy + a.shape[1], dx:dx + a.shape[2]])
    return out


def decode(heat, size, off, thr=0.5, topk=3000):
    peaks = np.where(maxpool3(heat) == heat, heat, 0.0)
    ks, ys, xs = np.nonzero(peaks >= thr)
    sc = peaks[ks, ys, xs]
    out = []
    for i in np.argsort(-sc)[:topk]:
        k, y, x = ks[i], ys[i], xs[i]
        out.append((int(k), float((x + off[0, y, x]) * STRIDE), float((y + off[1, y, x]) * STRIDE),
                    float(math.exp(size[0, y, x]) * STRIDE), float(math.exp(size[1, y, x]) * STRIDE), float(sc[i])))
    return out


def run(session, img_path, thr=0.5):
    """Detections in SOURCE pixels: (class, cx, cy, w, h, score)."""
    x, (W, H, W2, H2) = prepare(img_path)
    heat, size, off = session.run(None, {"image": x})
    dets = decode(heat[0], size[0], off[0], thr)
    sx, sy = W / W2, H / H2
    return [(k, cx * sx, cy * sy, w * sx, h * sy, s) for k, cx, cy, w, h, s in dets], (W, H)
