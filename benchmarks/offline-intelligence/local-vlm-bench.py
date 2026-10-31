"""Real local VLM inference on plan crops — accuracy, fabrication, CPU time, memory.

    python -I benchmarks/offline-intelligence/local-vlm-bench.py \\
        --server PATH/llama-server --models DIR --seat DIR --out FILE \\
        [--only NAME[,NAME]] [--threads 4] [--limit N]

Each candidate is served by llama.cpp's `llama-server` on 127.0.0.1 (its
multimodal projector beside it), one at a time, and asked about crops whose
answer is known:

  T1 "what is at the centre?"  one word from a closed list, on crops centred on
     an annotated object — generated furniture scenes (training/synth_relations.py
     --furniture: exact labels for sofa, bench, banquette, table, chair), the
     Golden Plan (tables, chairs, its three banquettes, the stage) and ORNEK
     (round table symbols) — and on NEGATIVE crops of generated sheets that hold
     no object at all (labels complete by construction). A negative answered
     with an object is a FABRICATION.
  T2 "how many tables?"  on crops of one generated scene (1 to 3 tables, known);
     an answer above the truth is an OVER-COUNT, the counting form of making
     something up.

Recorded per model: accuracy per source and class, fabrication rate, over-count
rate, latency per crop (median, p90), load time, and the server process's peak
resident memory (VmHWM). Nothing leaves the machine: the server listens on
loopback and the crops are cut here. The plans are the repository's own.
"""
import argparse
import base64
import io
import json
import math
import os
import random
import re
import signal
import statistics
import subprocess
import sys
import time
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORDS = ["table", "chair", "sofa", "bench", "banquette", "column", "stage", "bar", "nothing"]
T1 = ("This is a small crop of an event venue floor plan drawing, seen from above. "
      "What single object is at the centre of the image? Answer with exactly one word from this list: "
      + ", ".join(WORDS) + ".")
T2 = ("This is a crop of an event venue floor plan drawing, seen from above. "
      "How many tables are in the image? Count only tables, not chairs, sofas or benches. Answer with a number only.")
MODELS = {
    "smolvlm-256m": ("SmolVLM-256M-Instruct-Q8_0.gguf", "mmproj-SmolVLM-256M-Instruct-Q8_0.gguf"),
    "smolvlm-500m": ("SmolVLM-500M-Instruct-Q8_0.gguf", "mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"),
    "qwen2-vl-2b": ("Qwen2-VL-2B-Instruct-Q4_K_M.gguf", "mmproj-Qwen2-VL-2B-Instruct-Q8_0.gguf"),
}
FURN = {"sofa", "bench", "banquette"}


def crop(img, cx, cy, side, out=384):
    side = max(48, int(side))
    box = (int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2))
    c = Image.new("RGB", (side, side), (255, 255, 255))
    c.paste(img.crop(box), (0, 0))
    return c.resize((out, out), Image.LANCZOS)


def b64(im):
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def objects_in(objs, box):
    x0, y0, x1, y1 = box
    return [o for o in objs if x0 - o["w"] / 2 < o["cx"] < x1 + o["w"] / 2 and y0 - o["h"] / 2 < o["cy"] < y1 + o["h"] / 2]


def build_items(seat_dir, rng):
    items = []
    # generated furniture scenes: object crops, negatives, scene counts
    files = sorted(f for f in os.listdir(seat_dir) if f.endswith(".json") and f != "index.json")
    pool = {k: [] for k in ["sofa", "bench", "banquette", "table", "chair"]}
    negs, scenes = [], []
    for f in files:
        a = json.load(open(os.path.join(seat_dir, f)))
        img = Image.open(os.path.join(seat_dir, a["source"]["file"])).convert("RGB")
        objs = [o for o in a["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))]
        for o in objs:
            if o["class"] in pool and not o.get("ignore"):
                pool[o["class"]].append((f, a, o))
        W, H = img.size
        for _ in range(30):
            side = rng.uniform(90, 160)
            cx, cy = rng.uniform(side, W - side), rng.uniform(side, H - side)
            if not objects_in(objs, (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)):
                negs.append((f, cx, cy, side))
                break
        tables = [o for o in objs if o["class"] == "table"]
        for t in tables[:2]:
            side = 2.6 * max(t["w"], t["h"]) + 60
            box = (t["cx"] - side / 2, t["cy"] - side / 2, t["cx"] + side / 2, t["cy"] + side / 2)
            inside = [o for o in tables if box[0] + o["w"] / 2 <= o["cx"] <= box[2] - o["w"] / 2 and box[1] + o["h"] / 2 <= o["cy"] <= box[3] - o["h"] / 2]
            cut = [o for o in objects_in(tables, box) if o not in inside]
            if not cut:  # every table either wholly in or wholly out
                scenes.append((f, t["cx"], t["cy"], side, len(inside)))
    imgs = {}

    def im(f, a=None):
        if f not in imgs:
            a = a or json.load(open(os.path.join(seat_dir, f)))
            imgs[f] = Image.open(os.path.join(seat_dir, a["source"]["file"])).convert("RGB")
        return imgs[f]
    for cls, xs in pool.items():
        rng.shuffle(xs)
        for f, a, o in xs[:12]:
            items.append(dict(task="T1", source="generated", truth=cls, image=b64(crop(im(f, a), o["cx"], o["cy"], 2.0 * max(o["w"], o["h"]) + 30))))
    rng.shuffle(negs)
    for f, cx, cy, side in negs[:20]:
        items.append(dict(task="T1", source="generated-negative", truth="nothing", image=b64(crop(im(f), cx, cy, side))))
    rng.shuffle(scenes)
    for f, cx, cy, side, n in scenes[:24]:
        items.append(dict(task="T2", source="generated", truth=n, image=b64(crop(im(f), cx, cy, side, out=448))))
    # the two real plans in the repository
    for name, (ann, png) in {"golden": ("benchmarks/annotations/merit-real-venue.json", "benchmarks/plans/merit-real-venue-plan.png"),
                             "ornek": ("benchmarks/annotations/ornek-symbolic.json", "benchmarks/plans/ornek-upright.png")}.items():
        a = json.load(open(os.path.join(ROOT, ann)))
        img = Image.open(os.path.join(ROOT, png)).convert("RGB")
        objs = [o for o in a["objects"] if all(k in o for k in ("cx", "cy", "w", "h")) and not o.get("ignore")]
        want = {"golden": {"table": 12, "chair": 8, "banquette": 3, "stage": 1}, "ornek": {"table": 8}}[name]
        for cls, n in want.items():
            xs = [o for o in objs if o["class"] == cls]
            rng.shuffle(xs)
            for o in xs[:n]:
                side = 2.0 * max(o["w"], o["h"]) + 30 if cls != "stage" else 1.15 * max(o["w"], o["h"])
                items.append(dict(task="T1", source=name, truth=cls, image=b64(crop(img, o["cx"], o["cy"], side))))
    return items


def answer_word(text):
    t = text.lower()
    hits = [(t.find(w), w) for w in WORDS if re.search(r"\b" + w + r"s?\b", t)]
    return min(hits)[1] if hits else None


def answer_number(text):
    m = re.search(r"\d+", text)
    if m:
        return int(m.group(0))
    words = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
    for w, n in words.items():
        if re.search(r"\b" + w + r"\b", text.lower()):
            return n
    return None


def ask(port, item):
    prompt = T1 if item["task"] == "T1" else T2
    body = json.dumps({"messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + item["image"]}},
        {"type": "text", "text": prompt}]}], "temperature": 0, "max_tokens": 12, "cache_prompt": False}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=body, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        out = json.loads(r.read())
    return out["choices"][0]["message"]["content"] or "", time.time() - t0


def peak_rss_mb(pid):
    try:
        for line in open(f"/proc/{pid}/status"):
            if line.startswith("VmHWM"):
                return int(line.split()[1]) / 1024
    except OSError:
        return None


def run_model(name, args, items):
    model, proj = MODELS[name]
    port = 8090
    cmd = [args.server, "-m", os.path.join(args.models, model), "--mmproj", os.path.join(args.models, proj), "--host", "127.0.0.1",
           "--port", str(port), "-t", str(args.threads), "-tb", str(args.threads), "-c", "4096", "-np", "1", "--temp", "0", "-ngl", "0"]
    t0 = time.time()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=open(os.path.join(os.path.dirname(args.out) or ".", f"{name}-server.log"), "w"))
    try:
        while True:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as r:
                    if json.loads(r.read()).get("status") == "ok":
                        break
            except Exception:
                pass
            if proc.poll() is not None:
                raise RuntimeError(f"{name}: server exited {proc.returncode}")
            if time.time() - t0 > 300:
                raise RuntimeError(f"{name}: server did not come up")
            time.sleep(0.5)
        load = time.time() - t0
        rows = []
        for i, it in enumerate(items):
            text, dt = ask(port, it)
            got = answer_word(text) if it["task"] == "T1" else answer_number(text)
            rows.append(dict(task=it["task"], source=it["source"], truth=it["truth"], answer=text.strip()[:60], parsed=got, seconds=round(dt, 3)))
            if i % 20 == 0:
                print(f"  {name} {i}/{len(items)} {dt:.1f}s {it['truth']} -> {text.strip()[:30]!r}", flush=True)
        rss = peak_rss_mb(proc.pid)
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
    return dict(model=name, files=[model, proj], threads=args.threads, loadSeconds=round(load, 1), peakRssMb=round(rss) if rss else None, rows=rows)


def summarise(r):
    rows = r["rows"]
    t1 = [x for x in rows if x["task"] == "T1"]
    acc = lambda xs: round(sum(x["parsed"] == x["truth"] for x in xs) / len(xs), 3) if xs else None
    by = {}
    for x in t1:
        by.setdefault(f'{x["source"]}:{x["truth"]}', []).append(x)
    gen_obj = [x for x in t1 if x["source"] == "generated"]
    furn = [x for x in gen_obj if x["truth"] in FURN]
    real = [x for x in t1 if x["source"] in ("golden", "ornek")]
    neg = [x for x in t1 if x["source"] == "generated-negative"]
    t2 = [x for x in rows if x["task"] == "T2"]
    secs = sorted(x["seconds"] for x in rows)
    return dict(model=r["model"], threads=r["threads"], loadSeconds=r["loadSeconds"], peakRssMb=r["peakRssMb"],
                t1Generated=acc(gen_obj), t1Furniture=acc(furn), t1Real=acc(real),
                fabrication=round(sum(x["parsed"] not in (None, "nothing") for x in neg) / len(neg), 3) if neg else None,
                unparsed=sum(x["parsed"] is None for x in rows),
                t2Exact=acc(t2),
                t2OverCount=round(sum((x["parsed"] or 0) > x["truth"] for x in t2) / len(t2), 3) if t2 else None,
                medianSeconds=round(statistics.median(secs), 2), p90Seconds=round(secs[int(0.9 * (len(secs) - 1))], 2),
                perClass={k: f"{sum(x['parsed'] == x['truth'] for x in v)}/{len(v)}" for k, v in sorted(by.items())})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", required=True)
    ap.add_argument("--models", required=True)
    ap.add_argument("--seat", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--seed", type=int, default=5)
    args = ap.parse_args()
    items = build_items(args.seat, random.Random(args.seed))
    if args.limit:
        items = items[:args.limit]
    print(f"{len(items)} crops: " + json.dumps({k: sum(1 for i in items if f'{i["task"]}:{i["source"]}' == k) for k in sorted({f'{i["task"]}:{i["source"]}' for i in items})}))
    names = args.only.split(",") if args.only else list(MODELS)
    results = []
    for n in names:
        r = run_model(n, args, items)
        s = summarise(r)
        print(json.dumps(s, indent=1), flush=True)
        results.append(dict(summary=s, rows=r["rows"], files=r["files"]))
        json.dump(dict(ranAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), crops=len(items), seed=args.seed, prompts=dict(T1=T1, T2=T2), results=results),
                  open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
