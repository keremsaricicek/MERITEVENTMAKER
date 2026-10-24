#!/usr/bin/env python3
"""Pre-flight check of a plan-detector dataset, before any training step runs.

ADAPTED IDEA, NEW CODE. huggingface/skills' huggingface-vision-trainer ships
scripts/dataset_inspector.py, which asks the HF Datasets Server API whether a Hub
dataset has the columns its trainer expects. Nothing here is on the Hub and
nothing may be sent to it, so that script cannot be used. What is kept is its
rule: validate the format BEFORE training, and say READY or exactly what is wrong.
No line of the upstream script is reused; this reads the repository's own
annotation format (benchmarks/annotations/*.json, training/synth*.py output,
training/export_plans.py output) from local disk only.

    python .claude/skills/merit-local-vision-training/scripts/inspect_dataset.py \
        --train D/train --val D/val --heldout D/heldout,golden,ornek [--json]

Checks, per plan: the image exists and has the size the annotation states (and
the sha256, when stated); every detector object (table, chair, column) has
finite centre and size, positive size, and sits inside the image; near-duplicate
objects; chair->table links and merged-table members point at objects that
exist; how labels were made (a model-assisted or unreviewed label is never a
training target).

LEAKAGE fails the check. --val is in-distribution (training/README.md: val is
drawn from the training families), so against --train only the same planId or
byte-identical image counts. --heldout is what an "unseen" number is measured
on, so the same split unit (style family for synthetic plans, venue for real
ones) on both sides also counts: a venue the model trained on is never scored
as unseen.

Problems fail the check; WARNINGS are printed and do not (a merged-table group
whose members are placeholders rather than object ids: the repository's own
group measurement skips such members, benchmarks/relations/measure-groups-e2e.mjs).

Exit code 0 = READY, 1 = NEEDS ATTENTION (each problem listed), 2 = usage error.
Standard library + Pillow only.
"""
import argparse
import glob
import hashlib
import json
import math
import os
import sys
from collections import Counter, defaultdict

from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
REAL = {  # the same two regression plans training/detector.py knows by name
    "golden": ("benchmarks/annotations/merit-real-venue.json", "benchmarks/plans/merit-real-venue-plan.png"),
    "ornek": ("benchmarks/annotations/ornek-symbolic.json", "benchmarks/plans/ornek-upright.png"),
}
DETECTOR_CLASSES = {"table", "chair", "column"}
TRAINABLE = {"synthetic-exact", "human-confirmed", "accepted-on-confirm", "rejected", None}
DUP_PX = 2.0


def plans_of(spec):
    """(annotation path, image path) for a directory, a real-plan name, or a comma list of either."""
    out = []
    for part in [p for p in spec.split(",") if p]:
        if part in REAL:
            ann, img = REAL[part]
            out.append((os.path.join(REPO, ann), os.path.join(REPO, img)))
            continue
        if not os.path.isdir(part):
            raise SystemExit(f"--train/--eval: {part!r} is neither a directory nor one of {sorted(REAL)}")
        for f in sorted(glob.glob(os.path.join(part, "*.json"))):
            if os.path.basename(f) == "index.json":
                continue
            a = json.load(open(f, encoding="utf-8"))
            src = (a.get("source") or {}).get("file")
            out.append((f, os.path.join(part, os.path.basename(src)) if src else None))
    return out


def split_unit(a):
    s = a.get("split") or {}
    if s.get("family"):
        return "family:" + s["family"]
    venue = (a.get("source") or {}).get("venue")
    return "venue:" + venue if venue else "plan:" + a.get("planId", "?")


def inspect_plan(ann_path, img_path, problems, warnings):
    a = json.load(open(ann_path, encoding="utf-8"))
    pid = a.get("planId") or os.path.basename(ann_path)
    src = a.get("source") or {}
    info = {"planId": pid, "unit": split_unit(a), "imageSha256": None, "counts": Counter(), "untrainable": 0}

    def bad(msg):
        problems.append(f"{pid}: {msg}")

    if not img_path or not os.path.exists(img_path):
        bad(f"image missing ({img_path})")
        W = H = None
    else:
        raw = open(img_path, "rb").read()
        info["imageSha256"] = hashlib.sha256(raw).hexdigest()
        if src.get("sha256") and src["sha256"] != info["imageSha256"]:
            bad("image sha256 differs from the annotation's source.sha256")
        W, H = Image.open(img_path).size
        if (src.get("width"), src.get("height")) != (W, H):
            bad(f"image is {W}x{H}, annotation says {src.get('width')}x{src.get('height')}")

    ids, centres = set(), defaultdict(list)
    for o in a.get("objects", []):
        ids.add(o.get("id"))
        c = o.get("class")
        if c not in DETECTOR_CLASSES:
            continue
        info["counts"][c] += 1
        nums = [o.get(k) for k in ("cx", "cy", "w", "h")]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in nums):
            bad(f"{o.get('id')} ({c}) has a non-finite centre or size")
            continue
        cx, cy, w, h = nums
        if w <= 0 or h <= 0:
            bad(f"{o.get('id')} ({c}) has size {w}x{h}")
        if W and not (-w / 2 <= cx <= W + w / 2 and -h / 2 <= cy <= H + h / 2):
            bad(f"{o.get('id')} ({c}) centre ({cx},{cy}) lies outside the {W}x{H} image")
        if not math.isfinite(o.get("rotation", 0) or 0):
            bad(f"{o.get('id')} ({c}) has a non-finite rotation")
        if o.get("verification") not in TRAINABLE or o.get("ignore"):
            info["untrainable"] += 1
        for px, py in centres[c]:
            if math.hypot(cx - px, cy - py) < DUP_PX:
                bad(f"{o.get('id')} ({c}) duplicates another {c} within {DUP_PX}px")
                break
        centres[c].append((cx, cy))

    for r in a.get("relationships", []):
        for k in ("chair", "belongsTo"):
            if r.get(k) is not None and r.get(k) not in ids:
                bad(f"relationship {r} names {k}={r.get(k)!r}, which is not an object")
    for g in a.get("logicalGroups", []):
        missing = [m for m in g.get("members", []) if m not in ids]
        if missing:
            warnings.append(f"{pid}: logical group {g.get('id')} names members that are not object ids: {missing}")
    method = (a.get("annotationMethod") or "") + " " + str(a.get("verification") or "")
    if "model-assisted" in method.lower():
        bad("labels are model-assisted: never a training target (training/README.md)")
    if not a.get("annotationMethod") and not a.get("verification"):
        bad("does not say how its labels were made (annotationMethod / verification)")
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", default="", help="dirs and/or golden,ornek")
    ap.add_argument("--val", default="", help="in-distribution validation: dirs and/or golden,ornek")
    ap.add_argument("--heldout", default="", help="what unseen numbers are measured on: dirs and/or golden,ornek")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not (a.train or a.val or a.heldout):
        ap.print_usage()
        sys.exit(2)
    problems, warnings, sides = [], [], {}
    for side, spec in (("train", a.train), ("val", a.val), ("heldout", a.heldout)):
        sides[side] = [inspect_plan(ann, img, problems, warnings) for ann, img in plans_of(spec)] if spec else []

    leaks = []
    exact = (("planId", "the same plan"), ("imageSha256", "byte-identical images"))
    for x, y, keys in (("train", "val", exact), ("train", "heldout", exact + (("unit", "the same split unit"),)),
                       ("val", "heldout", exact)):
        for key, label in keys:
            both = {p[key] for p in sides[x] if p[key]} & {p[key] for p in sides[y] if p[key]}
            leaks += [f"LEAKAGE {x}/{y}: {label} on both sides: {v}" for v in sorted(both)]
    summary = {
        side: {"plans": len(ps), "objects": dict(sum((p["counts"] for p in ps), Counter())),
               "untrainableObjects": sum(p["untrainable"] for p in ps),
               "splitUnits": dict(Counter(p["unit"] for p in ps))}
        for side, ps in sides.items()
    }
    verdict = "READY" if not problems and not leaks else "NEEDS ATTENTION"
    if a.json:
        print(json.dumps({"verdict": verdict, "summary": summary, "leakage": leaks, "problems": problems,
                          "warnings": warnings}, indent=1))
    else:
        for side, s in summary.items():
            print(f"{side}: {s['plans']} plans, objects {s['objects']}, untrainable {s['untrainableObjects']}, units {s['splitUnits']}")
        for line in leaks + problems:
            print("  -", line)
        for line in warnings:
            print("  ~ warning:", line)
        print(("✓ " if verdict == "READY" else "✗ ") + verdict)
    sys.exit(0 if verdict == "READY" else 1)


if __name__ == "__main__":
    main()
