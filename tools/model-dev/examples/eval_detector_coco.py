"""Worked example: COCO-protocol box evaluation of the pinned plan-symbol
detector, with pycocotools and with FiftyOne.

    .venv-model-dev/bin/python -I tools/model-dev/examples/eval_detector_coco.py

Writes tools/model-dev/out/eval-coco-<version>.json (git-ignored).

What this adds to the project's own benchmark (npm run benchmark, centre
matching within a tolerance): BOX overlap. A detection here counts only when its
box overlaps the annotated box (IoU), and AP is integrated over the score, so a
model that finds the right places with the wrong sizes is visible.

Scope, stated so a number is never read as more than it is:
- Plans: Golden (merit-real-venue) and ORNEK, the two real plans the detector
  never trained on. One venue each, so per plan, never one pooled figure.
- Classes: table (the detector's table_round + table_rect, because the
  annotation's square/bistro/round types are not the detector's split) and chair.
  column is NOT scored: neither annotation labels columns.
- ORNEK draws no chairs (its annotation says so), so any chair reported there is
  a false positive, and chair AP on ORNEK is undefined, not zero.
- A rotated annotated chair is scored by the axis-aligned box that encloses it,
  because the detector predicts axis-aligned boxes.

Three evaluators, each recorded as run or as failed with its exact error:
1. pycocotools COCOeval: AP@0.5, AP@[.5:.95], AR, per class and per plan.
2. FiftyOne's COCO matcher, per sample, without a database: TP/FP/FN at IoU 0.5
   at the product's score threshold, cross-checked against pycocotools'.
3. FiftyOne Dataset + evaluate_detections(method="coco", compute_mAP=True):
   needs MongoDB. fiftyone-db downloads mongod on first use; where that download
   is refused, the error is recorded and evaluators 1-2 stand. To use a MongoDB
   you run yourself, set FIFTYONE_DATABASE_URI.
"""
import argparse
import contextlib
import io
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import offline_env  # noqa: E402,F401  - telemetry off before onnxruntime/fiftyone load
import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402

import detector_io as D  # noqa: E402

OUT = os.path.join(D.ROOT, "tools", "model-dev", "out")
# FiftyOne's database files, when it has one, stay beside the other outputs
os.environ.setdefault("FIFTYONE_DATABASE_DIR", os.path.join(OUT, "fiftyone-db"))

PLANS = {
    "golden": ("benchmarks/plans/merit-real-venue-plan.png", "benchmarks/annotations/merit-real-venue.json"),
    "ornek": ("benchmarks/plans/ornek-upright.png", "benchmarks/annotations/ornek-symbolic.json"),
}
CATS = {"table": 1, "chair": 2}
DET_CAT = {"table_round": "table", "table_rect": "table", "chair": "chair"}  # column: not annotated, not scored
PRODUCT_THRESHOLD = 0.5   # src/plan-model.js decodes at 0.5
CURVE_THRESHOLD = 0.05    # lower, so AP has a precision/recall curve to integrate


def enclosing_box(o):
    """[x, y, w, h] of the axis-aligned box enclosing an annotated (possibly rotated) box."""
    r = math.radians(o.get("rotation", 0) or 0)
    c, s = abs(math.cos(r)), abs(math.sin(r))
    w, h = o["w"] * c + o["h"] * s, o["w"] * s + o["h"] * c
    return [o["cx"] - w / 2, o["cy"] - h / 2, w, h]


def load_plan(name, sess):
    img, ann = PLANS[name]
    a = json.load(open(os.path.join(D.ROOT, ann), encoding="utf-8"))
    gt = [(o["class"], enclosing_box(o)) for o in a["objects"] if o.get("class") in CATS]
    dets, (W, H) = D.run(sess, os.path.join(D.ROOT, img), thr=CURVE_THRESHOLD)
    pred = [(DET_CAT[D.CLASSES[k]], [cx - w / 2, cy - h / 2, w, h], s)
            for k, cx, cy, w, h, s in dets if D.CLASSES[k] in DET_CAT]
    return {"W": W, "H": H, "gt": gt, "pred": pred, "image": img}


def coco_eval(plans, min_score, iou_thrs=None):
    from pycocotools.coco import COCO
    from pycocotools.cocoeval import COCOeval
    gt = {"images": [], "annotations": [], "categories": [{"id": i, "name": n} for n, i in CATS.items()]}
    dt = []
    for img_id, p in enumerate(plans.values(), 1):
        gt["images"].append({"id": img_id, "width": p["W"], "height": p["H"]})
        for cls, b in p["gt"]:
            gt["annotations"].append({"id": len(gt["annotations"]) + 1, "image_id": img_id, "category_id": CATS[cls],
                                      "bbox": b, "area": b[2] * b[3], "iscrowd": 0})
        dt += [{"image_id": img_id, "category_id": CATS[cls], "bbox": b, "score": s}
               for cls, b, s in p["pred"] if s >= min_score]
    with contextlib.redirect_stdout(io.StringIO()):
        cg = COCO()
        cg.dataset = gt
        cg.createIndex()
        cd = cg.loadRes(dt) if dt else COCO()
        E = COCOeval(cg, cd, "bbox")
        E.params.maxDets = [1, 10, 1000]   # a plan carries hundreds of objects; COCO's 100 would truncate it
        if iou_thrs is not None:
            E.params.iouThrs = np.array(iou_thrs)
        E.evaluate()
        E.accumulate()
    return E


def ap_table(E, names):
    """AP@0.5, AP@[.5:.95] and AR per class from COCOeval's accumulated arrays; None where undefined."""
    prec, rec = E.eval["precision"], E.eval["recall"]   # [T,R,K,A,M], [T,K,A,M]
    t50 = int(np.argmin(np.abs(E.params.iouThrs - 0.5)))
    out = {}
    for k, cat in enumerate(E.params.catIds):
        name = names[cat]
        p_all, p50, r_all = prec[:, :, k, 0, -1], prec[t50, :, k, 0, -1], rec[:, k, 0, -1]
        mean = lambda a: None if not (a > -1).any() else round(float(a[a > -1].mean()), 4)  # noqa: E731
        out[name] = {"AP50": mean(p50), "AP": mean(p_all), "AR": mean(r_all)}
    return out


def coco_counts(E):
    """TP/FP/FN per class at the single IoU threshold E was run with."""
    out = {}
    names = {i: n for n, i in CATS.items()}
    for e in E.evalImgs:
        if e is None or e["aRng"] != E.params.areaRng[0] or e["maxDet"] != E.params.maxDets[-1]:
            continue
        c = out.setdefault(names[e["category_id"]], {"tp": 0, "fp": 0, "fn": 0})
        m, ign = e["dtMatches"][0], e["dtIgnore"][0]
        tp = int(((m > 0) & ~ign).sum())
        c["tp"] += tp
        c["fp"] += int(((m == 0) & ~ign).sum())
        c["fn"] += int((~np.asarray(e["gtIgnore"], bool)).sum()) - tp
    return out


def fiftyone_sample(p):
    import fiftyone as fo
    rel = lambda b: [b[0] / p["W"], b[1] / p["H"], b[2] / p["W"], b[3] / p["H"]]  # noqa: E731
    return fo.Sample(
        filepath=os.path.join(D.ROOT, p["image"]),
        ground_truth=fo.Detections(detections=[fo.Detection(label=c, bounding_box=rel(b)) for c, b in p["gt"]]),
        predictions=fo.Detections(detections=[fo.Detection(label=c, bounding_box=rel(b), confidence=s)
                                              for c, b, s in p["pred"] if s >= PRODUCT_THRESHOLD]),
    )


def fiftyone_matcher(plans):
    """FiftyOne's COCO matching, per sample, with no database involved."""
    from fiftyone.utils.eval.coco import COCOEvaluation, COCOEvaluationConfig
    ev = COCOEvaluation(COCOEvaluationConfig("predictions", "ground_truth", iou=0.5, classwise=True))
    ev.gt_field, ev.pred_field = "ground_truth", "predictions"   # what register_samples() would set from a dataset
    out = {}
    for name, p in plans.items():
        counts = {}
        for gt_label, pred_label, _iou, _conf, gt_id, pred_id in ev.evaluate(fiftyone_sample(p), eval_key=None):
            c = counts.setdefault(gt_label or pred_label, {"tp": 0, "fp": 0, "fn": 0})
            c["tp" if gt_id and pred_id else "fn" if gt_id else "fp"] += 1
        out[name] = counts
    return out


def fiftyone_dataset(plans):
    import fiftyone as fo
    ds = fo.Dataset()   # starts (or connects to) MongoDB: the step that needs a database
    try:
        ds.add_samples([fiftyone_sample(p) for p in plans.values()])
        res = ds.evaluate_detections("predictions", gt_field="ground_truth", eval_key="eval",
                                     method="coco", compute_mAP=True, classwise=True)
        return {"mAP": round(float(res.mAP()), 4), "note": "predictions at the product threshold only"}
    finally:
        ds.delete()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="v2")
    ap.add_argument("--onnx", default="", help="a candidate model file instead of the pinned version")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    raw, model = D.model_bytes(a.version, a.onnx)
    tag = a.version if model["pinned"] else "candidate-" + model["sha256"][:12]
    sess = ort.InferenceSession(raw, providers=["CPUExecutionProvider"])
    plans = {n: load_plan(n, sess) for n in PLANS}
    names = {i: n for n, i in CATS.items()}

    report = {
        "what": "COCO-protocol box evaluation of the pinned detector on the two real plans it never trained on",
        "model": model,
        "scope": {"classes": list(CATS), "notScored": ["column (not annotated on either plan)"],
                  "ornekChairs": "ORNEK draws no chairs: chair detections there are false positives, chair AP undefined",
                  "rotatedGt": "rotated annotations scored by their enclosing axis-aligned box",
                  "curveThreshold": CURVE_THRESHOLD, "productThreshold": PRODUCT_THRESHOLD},
        "objects": {n: {"gt": len(p["gt"]), "predAtProductThreshold": sum(s >= PRODUCT_THRESHOLD for *_, s in p["pred"])}
                    for n, p in plans.items()},
        "pycocotools": {}, "fiftyoneMatcher": None, "fiftyoneDataset": None, "crossCheck": None,
    }
    import pycocotools
    report["pycocotools"]["version"] = getattr(pycocotools, "__version__", None) or __import__("importlib.metadata").metadata.version("pycocotools")
    report["pycocotools"]["perPlan"] = {n: ap_table(coco_eval({n: p}, CURVE_THRESHOLD), names) for n, p in plans.items()}
    coco_counts_50 = {n: coco_counts(coco_eval({n: p}, PRODUCT_THRESHOLD, iou_thrs=[0.5])) for n, p in plans.items()}
    report["pycocotools"]["countsAtIoU50ProductThreshold"] = coco_counts_50

    try:
        import fiftyone as fo
        report["fiftyoneVersion"] = fo.__version__
        fm = fiftyone_matcher(plans)
        report["fiftyoneMatcher"] = fm
        report["crossCheck"] = {
            n: {c: ("SAME" if fm[n].get(c, {"tp": 0, "fp": 0, "fn": 0}) == coco_counts_50[n].get(c, {"tp": 0, "fp": 0, "fn": 0}) else "DIFFERENT")
                for c in CATS}
            for n in plans}
    except Exception as e:  # noqa: BLE001 - the failure is the result
        report["fiftyoneMatcher"] = f"FAILED: {type(e).__name__}: {e}"
    try:
        report["fiftyoneDataset"] = fiftyone_dataset(plans)
    except Exception as e:  # noqa: BLE001 - the failure is the result
        report["fiftyoneDataset"] = f"FAILED: {type(e).__name__}: {str(e).strip()}"

    path = os.path.join(OUT, f"eval-coco-{tag}.json")
    json.dump(report, open(path, "w"), indent=1)
    print(json.dumps(report, indent=1))
    print("wrote", path)


if __name__ == "__main__":
    main()
