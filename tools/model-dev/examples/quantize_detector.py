"""Worked example: INT8 dynamic quantization of the pinned plan-symbol detector,
measured before it could ever be proposed.

    # torch-free: ONNX Runtime's own quantizer (works in the base environment)
    .venv-model-dev/bin/python -I tools/model-dev/examples/quantize_detector.py --engine ort
    # Microsoft Olive (needs torch importable: setup.sh --with-olive; not -I if
    # torch is supplied through PYTHONPATH, which -I ignores)
    .venv-model-dev/bin/python tools/model-dev/examples/quantize_detector.py --engine olive

Writes tools/model-dev/out/quantize-<engine>.json and the INT8 model beside it
(both git-ignored). It changes nothing the product loads: the shipped model is
the pinned v2 file, and a quantized model would be a NEW pinned version that
must pass the same regression set (benchmarks/offline-intelligence/ACCEPTANCE.md).

What it reports, per real regression plan (Golden, ORNEK — both never trained
on): the FP32 and INT8 detections scored against the committed annotation with
the benchmark's own nearest-first centre matching, how many INT8 detections
agree with FP32, the file size, and CPU latency (median and worst of 7 runs,
one thread, after one warm-up). A quantized model that loses a table here is
not a candidate, however much faster it is.
"""
import argparse
import json
import math
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import offline_env  # noqa: E402,F401  - telemetry off before onnxruntime/olive load
import onnxruntime as ort  # noqa: E402

import detector_io as D  # noqa: E402

OUT = os.path.join(D.ROOT, "tools", "model-dev", "out")
PLANS = {
    "golden": ("benchmarks/plans/merit-real-venue-plan.png", "benchmarks/annotations/merit-real-venue.json"),
    "ornek": ("benchmarks/plans/ornek-upright.png", "benchmarks/annotations/ornek-symbolic.json"),
}
CLASS_OF = {"table_round": "tables", "table_rect": "tables", "chair": "chairs", "column": "columns"}


def gt_of(ann_path):
    a = json.load(open(os.path.join(D.ROOT, ann_path), encoding="utf-8"))
    out = {"tables": [], "chairs": [], "columns": []}
    for o in a["objects"]:
        c = o.get("class")
        key = "tables" if c == "table" else "chairs" if c == "chair" else "columns" if c == "column" else None
        if key and math.isfinite(o.get("cx", float("nan"))):
            out[key].append((o["cx"], o["cy"]))
    return out, a.get("matchToleranceP", 3), a["source"]["width"], a["source"]["height"]


def score(gt, dets, tol):
    pairs = sorted((math.hypot(g[0] - d[0], g[1] - d[1]), gi, di) for gi, g in enumerate(gt) for di, d in enumerate(dets)
                   if math.hypot(g[0] - d[0], g[1] - d[1]) <= tol)
    gu, du = set(), set()
    for _, gi, di in pairs:
        if gi not in gu and di not in du:
            gu.add(gi); du.add(di)
    tp = len(gu)
    return {"tp": tp, "fp": len(dets) - tp, "fn": len(gt) - tp}


def evaluate(model_bytes):
    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    sess = ort.InferenceSession(model_bytes, so, providers=["CPUExecutionProvider"])
    res = {}
    for name, (img, ann) in PLANS.items():
        dets, (W, H) = D.run(sess, os.path.join(D.ROOT, img))
        gt, tolp, _, _ = gt_of(ann)
        tol = tolp / 100 * math.hypot(W, H)
        by = {"tables": [], "chairs": [], "columns": []}
        for k, cx, cy, w, h, s in dets:
            by[CLASS_OF[D.CLASSES[k]]].append((cx, cy))
        x, _ = D.prepare(os.path.join(D.ROOT, img))
        sess.run(None, {"image": x})
        ms = []
        for _ in range(7):
            t0 = time.perf_counter(); sess.run(None, {"image": x}); ms.append((time.perf_counter() - t0) * 1000)
        res[name] = {
            # ORNEK's annotation labels tables only; chairs/columns are scored where the annotation carries them
            "scores": {c: score(gt[c], by[c], tol) for c in ("tables", "chairs") if gt[c]},
            "detections": {c: len(v) for c, v in by.items()},
            "latencyMs": {"median": round(statistics.median(ms), 1), "max": round(max(ms), 1), "input": list(x.shape)},
            "raw": dets,
        }
    return res


def agreement(a, b, px=4.0):
    """How many of B's detections have a same-class detection in A within px."""
    hit = 0
    for k, cx, cy, *_ in b:
        if any(k2 == k and math.hypot(cx - x2, cy - y2) <= px for k2, x2, y2, *_ in a):
            hit += 1
    return {"agree": hit, "of": len(b)}


def quantize_ort(src, dst):
    from onnxruntime.quantization import QuantType, quantize_dynamic
    quantize_dynamic(src, dst, weight_type=QuantType.QInt8)
    return {"tool": "onnxruntime.quantization.quantize_dynamic", "weightType": "QInt8"}


def quantize_olive(src, out_dir):
    try:
        from olive.workflows import run as olive_run
    except Exception as e:  # noqa: BLE001 - the reason is the result
        raise SystemExit(f"Olive is not importable here ({type(e).__name__}: {e}). "
                         "Run tools/model-dev/setup.sh --with-olive, or use --engine ort.")
    # olive.workflows.run consumes keys of the dict it is given, so the output
    # path is kept here rather than read back from cfg afterwards
    output_dir = os.path.join(out_dir, "olive-output")
    cfg = {
        "input_model": {"type": "ONNXModel", "model_path": src},
        "systems": {"local": {"type": "LocalSystem",
                              "accelerators": [{"device": "cpu", "execution_providers": ["CPUExecutionProvider"]}]}},
        "passes": {"quantize": {"type": "OnnxDynamicQuantization", "weight_type": "QInt8"}},
        "host": "local", "target": "local",
        "evaluate_input_model": False,
        "cache_dir": os.path.join(out_dir, "olive-cache"),
        "output_dir": output_dir,
        "log_severity_level": 3,
    }
    olive_run(cfg)
    found = [os.path.join(r, f) for r, _, fs in os.walk(output_dir) for f in fs if f.endswith(".onnx")]
    if not found:
        raise SystemExit(f"Olive finished but wrote no .onnx under {output_dir}")
    import olive
    return {"tool": f"Microsoft Olive {olive.__version__}, pass OnnxDynamicQuantization (QInt8)", "olivePath": found[0]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=["ort", "olive"], required=True)
    ap.add_argument("--version", default="v2")
    ap.add_argument("--onnx", default="", help="a candidate model file instead of the pinned version")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    raw, model = D.model_bytes(a.version, a.onnx)
    tag = a.version if model["pinned"] else "candidate-" + model["sha256"][:12]
    fp32 = os.path.join(OUT, f"detector-{tag}-fp32.onnx")
    open(fp32, "wb").write(raw)
    int8 = os.path.join(OUT, f"detector-{tag}-int8-{a.engine}.onnx")
    info = quantize_ort(fp32, int8) if a.engine == "ort" else quantize_olive(fp32, OUT)
    if a.engine == "olive":
        os.replace(info.pop("olivePath"), int8)
    base, q = evaluate(raw), evaluate(open(int8, "rb").read())
    report = {
        "what": "INT8 dynamic quantization of the pinned detector, scored on the two real regression plans (never trained on)",
        "model": {**model, "fp32Bytes": len(raw), "int8Bytes": os.path.getsize(int8)},
        "quantizer": info, "onnxruntime": ort.__version__, "threads": 1,
        "plans": {n: {"fp32": {k: v for k, v in base[n].items() if k != "raw"},
                      "int8": {k: v for k, v in q[n].items() if k != "raw"},
                      "int8AgreesWithFp32": agreement(base[n]["raw"], q[n]["raw"])} for n in PLANS},
    }
    path = os.path.join(OUT, f"quantize-{a.engine}{'' if model['pinned'] else '-' + tag}.json")
    json.dump(report, open(path, "w"), indent=1)
    print(json.dumps(report, indent=1))
    print("wrote", path)


if __name__ == "__main__":
    main()
