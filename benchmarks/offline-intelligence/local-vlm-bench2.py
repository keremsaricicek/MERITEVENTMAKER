"""Local VLM on plan crops, second harness (2026-10-18): the questions a plan
reading needs, asked fairly.

    python -I benchmarks/offline-intelligence/local-vlm-bench2.py \\
        --server PATH/llama-server --models DIR --seat DIR --rel DIR --syn DIR --out FILE \\
        --model NAME [--size 448] [--min-tokens N] [--seed 5] [--limit N] [--threads 4]
        [--no-real] [--lora ADAPTER.gguf] [--ctx 8192] [--looks 2] [--cache-ram 0] [--resume]

    python -I benchmarks/offline-intelligence/local-vlm-bench2.py --v5 DIR \\
        --server PATH/llama-server --models DIR --out FILE --model NAME [--lora A.gguf] --looks 2 --ctx 2048 --cache-ram 0

--v5 asks the V5 test's own crops (training/synth_vlm.py --split blind) and
reports summary.v5 (its pre-registered bars) and summary.tasks (accuracy,
covered, agreed right / wrong, undecided, missed, false yes, per task).
--no-real leaves the Golden/ORNEK crops out (a run that chooses settings);
--lora serves a llama.cpp adapter (training/vlm_lora.py gguf) with the model;
--looks 2 also asks every crop turned a quarter and reports the product's rule
(an answer counts only when both looks give it: summary.twoLooks).
--cache-ram 0 turns off llama-server's host prompt cache (this build's default
keeps up to 8 GiB of prompt states although every request here sends
cache_prompt:false and none is reused): without it, peakRssMb measures that
cache, not the model (V4 blind run, 2026-10-19: 9,448 MB on a 0.8B model).

What the first harness (local-vlm-bench.py) got wrong, found by checking it
before trusting it:
  - a crop reaching past the plan's edge was padded with BLACK (PIL fills an
    out-of-range crop with zeros, and that block was pasted over the white);
  - `max_tokens` 12 with no control of a model's thinking mode: Qwen3.5 puts
    its whole answer in `reasoning_content` and returns an EMPTY answer, so every
    crop would be scored "unparsed";
  - one image size for every model, below what Qwen-VL projectors ask for (the
    server warns: "require at minimum 1024 image tokens").
The image path itself was checked and is sound (a red circle, "HELLO 42" and a
table with four chairs are described correctly).

Questions (each with a closed answer and a known truth, labels complete by
construction on generated scenes; Golden/ORNEK from their annotations):
  ID       what single object is at the centre (closed list incl. "nothing")
  NEG      the same question on a crop that holds no object -> FABRICATION
  COUNT    how many tables (crops whose tables are wholly in or out)
  CHAIRS   how many chairs belong to the table at the centre (capacity)
  MERGED   do the tables at the centre touch to form one long table (yes/no;
           negatives are labelled separate neighbours, gap >= 0.9 sides)
  SERVES   does the sofa/bench/banquette stand against and serve this table
           (yes/no; negatives are the generator's "sofa-apart" pieces)
A "yes" on a negative is counted as a fabrication too.

Nothing leaves the machine: llama-server on 127.0.0.1, crops cut here from the
repository's own plans and generated scenes.
"""
import argparse, base64, io, json, math, os, random, re, signal, statistics, subprocess, sys, time, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# The questions, the closed answer words and their synonyms come from ONE file
# the relay reads too (server/local-check-questions.json): what is measured
# here is word for word what the product asks.
_QF = json.load(open(os.path.join(ROOT, "server", "local-check-questions.json")))
WORDS = list(_QF["words"])
SYN = dict(_QF["synonyms"])
PRE = _QF["preamble"]
Q = {k: PRE + _QF["questions"][v].replace("{words}", ", ".join(WORDS))
     for k, v in {"ID": "identify", "COUNT": "count", "CHAIRS": "chairs", "MERGED": "merged", "SERVES": "serves"}.items()}
MODELS = {
    "smolvlm-256m": ("SmolVLM-256M-Instruct-Q8_0.gguf", "mmproj-SmolVLM-256M-Instruct-Q8_0.gguf"),
    "smolvlm-500m": ("SmolVLM-500M-Instruct-Q8_0.gguf", "mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"),
    "qwen2-vl-2b": ("Qwen2-VL-2B-Instruct-Q4_K_M.gguf", "mmproj-Qwen2-VL-2B-Instruct-Q8_0.gguf"),
    # The published projectors are F16; on CPU that encodes an image 3x slower
    # than the same projector quantized to Q8_0 here with the pinned
    # llama-quantize (15.5 s -> 5.2 s per 448 px crop). "-f16proj" keeps the
    # published file for the accuracy comparison.
    "qwen3.5-0.8b": ("Qwen3.5-0.8B-Q8_0.gguf", "mmproj-Qwen3.5-0.8B-Q8_0-local.gguf"),
    "qwen3.5-0.8b-f16proj": ("Qwen3.5-0.8B-Q8_0.gguf", "mmproj-Qwen3.5-0.8B-F16.gguf"),
    "qwen3.5-2b": ("Qwen3.5-2B-Q4_K_M.gguf", "mmproj-Qwen3.5-2B-Q8_0-local.gguf"),
    "qwen3-vl-2b": ("Qwen3VL-2B-Instruct-Q4_K_M.gguf", "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"),
    "internvl3.5-1b": ("InternVL3_5-1B-Q4_K_M.gguf", "mmproj-InternVL3_5-1B-Q8_0-local.gguf"),
    "smolvlm2-500m": ("SmolVLM2-500M-Video-Instruct-Q8_0.gguf", "mmproj-SmolVLM2-500M-Video-Instruct-Q8_0.gguf"),
}


def crop(img, cx, cy, side, out):
    """A square crop centred on (cx, cy); outside the plan is PAPER, never black."""
    side = max(48, int(side))
    x0, y0 = int(cx - side / 2), int(cy - side / 2)
    c = Image.new("RGB", (side, side), (255, 255, 255))
    W, H = img.size
    bx0, by0, bx1, by1 = max(0, x0), max(0, y0), min(W, x0 + side), min(H, y0 + side)
    if bx1 > bx0 and by1 > by0:
        c.paste(img.crop((bx0, by0, bx1, by1)), (bx0 - x0, by0 - y0))
    return c.resize((out, out), Image.LANCZOS)


def b64(im):
    buf = io.BytesIO(); im.save(buf, "PNG"); return base64.b64encode(buf.getvalue()).decode()


def inside(o, box, whole=True):
    x0, y0, x1, y1 = box
    if whole:
        return x0 <= o["cx"] - o["w"] / 2 and o["cx"] + o["w"] / 2 <= x1 and y0 <= o["cy"] - o["h"] / 2 and o["cy"] + o["h"] / 2 <= y1
    return x0 - o["w"] / 2 < o["cx"] < x1 + o["w"] / 2 and y0 - o["h"] / 2 < o["cy"] < y1 + o["h"] / 2


def load(d):
    out = []
    for f in sorted(os.listdir(d)):
        if f.endswith(".json") and f != "index.json":
            a = json.load(open(os.path.join(d, f)))
            out.append((a, os.path.join(d, a["source"]["file"])))
    return out


def build_items(seat_dir, rel_dir, rng, size, syn_dir=None, real=True, asked=None):
    """The V4 items. `asked`, if a list, receives the (plan, cx, cy) of every
    pushed-together group V4 asks about, so S1 can leave them out; it changes
    nothing the run asks."""
    items, cache = [], {}

    def im(p):
        if p not in cache:
            cache[p] = Image.open(p).convert("RGB")
        return cache[p]

    def add(task, source, truth, img, cx, cy, side, q=None, **kw):
        items.append(dict(task=task, source=source, truth=truth, q=q or Q["ID" if task in ("ID", "NEG") else task],
                          image=b64(crop(img, cx, cy, side, size)), **kw))

    seats = load(seat_dir)
    pool = {k: [] for k in ["sofa", "bench", "banquette", "table", "chair"]}
    negs, serves_pos, serves_neg = [], [], []
    for a, p in seats:
        objs = [o for o in a["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))]
        by = {o["id"]: o for o in objs}
        for o in objs:
            if o["class"] in pool and not o.get("ignore"):
                pool[o["class"]].append((p, o))
        W, H = a["source"]["width"], a["source"]["height"]
        for _ in range(40):
            side = rng.uniform(90, 160)
            cx, cy = rng.uniform(side, W - side), rng.uniform(side, H - side)
            if not any(inside(o, (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), whole=False) for o in objs):
                negs.append((p, cx, cy, side)); break
        for g in a.get("seatingGroups") or []:
            t = by.get(g["table"])
            for m in g["members"]:
                o = by.get(m)
                if t and o and o["class"] in ("sofa", "bench", "banquette"):
                    serves_pos.append((p, t, o))
        for s in a.get("separateNeighbours") or []:
            ms = [by.get(m) for m in s["members"]]
            if len(ms) == 2 and all(ms):
                t = next((o for o in ms if o["class"] == "table"), None)
                o = next((o for o in ms if o["class"] in ("sofa", "bench", "banquette")), None)
                if t and o:
                    serves_neg.append((p, t, o))
    for cls, xs in pool.items():
        rng.shuffle(xs)
        for p, o in xs[:12]:
            add("ID", "generated", cls, im(p), o["cx"], o["cy"], 2.0 * max(o["w"], o["h"]) + 30)
    rng.shuffle(negs)
    for p, cx, cy, side in negs[:20]:
        add("NEG", "generated", "nothing", im(p), cx, cy, side)
    for lab, xs in (("yes", serves_pos), ("no", serves_neg)):
        rng.shuffle(xs)
        for p, t, o in xs[:12]:
            cx, cy = (t["cx"] + o["cx"]) / 2, (t["cy"] + o["cy"]) / 2
            side = max(abs(t["cx"] - o["cx"]) + max(t["w"], o["w"]), abs(t["cy"] - o["cy"]) + max(t["h"], o["h"])) * 1.3 + 30
            add("SERVES", "generated", lab, im(p), cx, cy, side, q=Q["SERVES"].format(piece=o["class"]))

    rels = load(rel_dir) + (load(syn_dir) if syn_dir else [])
    counts, chairs, merged, apart = [], [], [], []
    for a, p in rels:
        objs = [o for o in a["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))]
        by = {o["id"]: o for o in objs}
        tables = [o for o in objs if o["class"] == "table"]
        owner = {}
        for r in a.get("relationships") or []:
            if "chair" in r:
                owner.setdefault(r["belongsTo"], []).append(r["chair"])
        in_group = {m for g in a.get("logicalGroups") or [] for m in g["members"]}
        for t in tables[:6]:
            side = 2.6 * max(t["w"], t["h"]) + 60
            box = (t["cx"] - side / 2, t["cy"] - side / 2, t["cx"] + side / 2, t["cy"] + side / 2)
            whole = [o for o in tables if inside(o, box)]
            cut = [o for o in tables if inside(o, box, whole=False) and o not in whole]
            if not cut:
                counts.append((p, t["cx"], t["cy"], side, len(whole)))
            if t["id"] not in in_group and t["id"] in owner and all(o is t or math.hypot(o["cx"] - t["cx"], o["cy"] - t["cy"]) > 1.8 * max(t["w"], t["h"], o["w"], o["h"]) for o in tables):
                chairs.append((p, t, len(owner[t["id"]])))
        for g in a.get("logicalGroups") or []:
            ms = [by[m] for m in g["members"] if m in by]
            if 2 <= len(ms) <= 4:
                x0 = min(o["cx"] - o["w"] / 2 for o in ms); x1 = max(o["cx"] + o["w"] / 2 for o in ms)
                y0 = min(o["cy"] - o["h"] / 2 for o in ms); y1 = max(o["cy"] + o["h"] / 2 for o in ms)
                merged.append((p, (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 1.25 + 40))
        for s in a.get("separateNeighbours") or []:
            ms = [by.get(m) for m in s["members"]]
            if len(ms) == 2 and all(ms) and all(o["class"] == "table" for o in ms) and s.get("gapSides", 0) >= 0.9:
                x0 = min(o["cx"] - o["w"] / 2 for o in ms); x1 = max(o["cx"] + o["w"] / 2 for o in ms)
                y0 = min(o["cy"] - o["h"] / 2 for o in ms); y1 = max(o["cy"] + o["h"] / 2 for o in ms)
                side = max(x1 - x0, y1 - y0) * 1.25 + 40
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
                # a true "no": no table in view belongs to a pushed-together group
                if not any(o["id"] in in_group and inside(o, box, whole=False) for o in tables):
                    apart.append((p, cx, cy, side))
    rng.shuffle(counts); rng.shuffle(chairs); rng.shuffle(merged); rng.shuffle(apart)

    def stratified(xs, key, per, total):
        # at most `per` of each true value, so "always answer 2" cannot score
        seen, out = {}, []
        for x in xs:
            k = key(x)
            if seen.get(k, 0) < per:
                seen[k] = seen.get(k, 0) + 1; out.append(x)
        return out[:total]
    for p, cx, cy, side, n in stratified(counts, lambda x: x[4], 5, 20):
        add("COUNT", "generated", n, im(p), cx, cy, side)
    for p, t, n in stratified(chairs, lambda x: x[2], 3, 16):
        add("CHAIRS", "generated", n, im(p), t["cx"], t["cy"], 2.4 * max(t["w"], t["h"]) + 50)
    for p, cx, cy, side in merged[:12]:
        add("MERGED", "generated", "yes", im(p), cx, cy, side)
        if asked is not None:
            asked.append((p, round(cx, 1), round(cy, 1)))
    for p, cx, cy, side in apart[:12]:
        add("MERGED", "generated", "no", im(p), cx, cy, side)

    # --no-real: a run that CHOOSES settings (dev) leaves the two real plans
    # out, so they stay a test the settings were not tuned on.
    for name, (ann, png) in ({"golden": ("benchmarks/annotations/merit-real-venue.json", "benchmarks/plans/merit-real-venue-plan.png"),
                              "ornek": ("benchmarks/annotations/ornek-symbolic.json", "benchmarks/plans/ornek-upright.png")} if real else {}).items():
        a = json.load(open(os.path.join(ROOT, ann)))
        img = im(os.path.join(ROOT, png))
        objs = [o for o in a["objects"] if all(k in o for k in ("cx", "cy", "w", "h")) and not o.get("ignore")]
        want = {"golden": {"table": 12, "chair": 8, "banquette": 3, "stage": 1}, "ornek": {"table": 8}}[name]
        for cls, n in want.items():
            xs = [o for o in objs if o["class"] == cls]
            rng.shuffle(xs)
            for o in xs[:n]:
                side = 2.0 * max(o["w"], o["h"]) + 30 if cls != "stage" else 1.15 * max(o["w"], o["h"])
                add("ID", name, cls, img, o["cx"], o["cy"], side)
        if name == "golden":
            owner = {}
            for r in a.get("relationships") or []:
                if "chair" in r:
                    owner.setdefault(r["belongsTo"], []).append(r["chair"])
            # a table standing alone, so "the table in the centre" has one meaning
            alone = lambda t: all(o is t or math.hypot(o["cx"] - t["cx"], o["cy"] - t["cy"]) > 1.8 * max(t["w"], t["h"], o["w"], o["h"])
                                  for o in objs if o["class"] == "table")
            ts = [o for o in objs if o["class"] == "table" and o["id"] in owner and alone(o)]
            rng.shuffle(ts)
            for t in stratified(ts, lambda t: len(owner[t["id"]]), 3, 8):
                add("CHAIRS", "golden", len(owner[t["id"]]), img, t["cx"], t["cy"], 2.4 * max(t["w"], t["h"]) + 50)
    return items


def build_s1_items(s1_dir, rel_dir, rng, size, v4_asked):
    """The supplementary blind test S1 (training/README.md, pre-registered
    2026-10-19): odd chair counts, near-miss separate tables, and benches and
    banquettes set apart from a table — what the V4 test could not see. Each
    item carries `sub`, the stratum it is scored in."""
    items, cache = [], {}

    def im(p):
        if p not in cache:
            cache[p] = Image.open(p).convert("RGB")
        return cache[p]

    def add(task, sub, truth, img, cx, cy, side, q=None):
        items.append(dict(task=task, source="s1", sub=sub, truth=truth, q=q or Q[task], image=b64(crop(img, cx, cy, side, size))))

    chairs, serves = {}, {}
    for a, p in load(s1_dir):
        objs = [o for o in a["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))]
        by = {o["id"]: o for o in objs}
        tables = [o for o in objs if o["class"] == "table"]
        owner = {}
        for r in a.get("relationships") or []:
            if "chair" in r:
                owner.setdefault(r["belongsTo"], []).append(r["chair"])
        for t in tables:
            if t.get("type") == "round" and t["id"] in owner and all(o is t or math.hypot(o["cx"] - t["cx"], o["cy"] - t["cy"]) > 1.8 * max(t["w"], t["h"], o["w"], o["h"]) for o in tables):
                chairs.setdefault(len(owner[t["id"]]), []).append((p, t))
        for g in a.get("seatingGroups") or []:
            t = by.get(g["table"])
            for m in g["members"]:
                o = by.get(m)
                if t and o and o["class"] in ("bench", "banquette"):
                    serves.setdefault((o["class"], "yes"), []).append((p, t, o))
        for sn in a.get("separateNeighbours") or []:
            ms = [by.get(m) for m in sn["members"]]
            if len(ms) == 2 and all(ms):
                t = next((o for o in ms if o["class"] == "table"), None)
                o = next((o for o in ms if o["class"] in ("bench", "banquette")), None)
                if t and o:
                    serves.setdefault((o["class"], "no"), []).append((p, t, o))
    for n, per in [(3, 6), (5, 6), (7, 6), (9, 6), (11, 6), (4, 4), (8, 4), (12, 4)]:
        xs = sorted(chairs.get(n, []), key=lambda x: (x[0], x[1]["id"]))
        rng.shuffle(xs)
        for p, t in xs[:per]:
            add("CHAIRS", "odd" if n % 2 else "even", n, im(p), t["cx"], t["cy"], 2.4 * max(t["w"], t["h"]) + 50)
    for (cls, lab), per in [(("bench", "no"), 10), (("banquette", "no"), 10), (("bench", "yes"), 10), (("banquette", "yes"), 10)]:
        xs = sorted(serves.get((cls, lab), []), key=lambda x: (x[0], x[2]["id"]))
        rng.shuffle(xs)
        for p, t, o in xs[:per]:
            cx, cy = (t["cx"] + o["cx"]) / 2, (t["cy"] + o["cy"]) / 2
            side = max(abs(t["cx"] - o["cx"]) + max(t["w"], o["w"]), abs(t["cy"] - o["cy"]) + max(t["h"], o["h"])) * 1.3 + 30
            add("SERVES", cls + ("neg" if lab == "no" else "pos"), lab, im(p), cx, cy, side, q=Q["SERVES"].format(piece=cls))
    near, pos = [], []
    asked = set(v4_asked)
    for a, p in load(rel_dir):
        objs = [o for o in a["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))]
        by = {o["id"]: o for o in objs}
        tables = [o for o in objs if o["class"] == "table"]
        in_group = {m for g in a.get("logicalGroups") or [] for m in g["members"]}
        span = lambda ms: (min(o["cx"] - o["w"] / 2 for o in ms), min(o["cy"] - o["h"] / 2 for o in ms), max(o["cx"] + o["w"] / 2 for o in ms), max(o["cy"] + o["h"] / 2 for o in ms))
        for g in a.get("logicalGroups") or []:
            ms = [by[m] for m in g["members"] if m in by]
            if 2 <= len(ms) <= 4:
                x0, y0, x1, y1 = span(ms)
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                if (p, round(cx, 1), round(cy, 1)) not in asked:
                    pos.append((p, cx, cy, max(x1 - x0, y1 - y0) * 1.25 + 40))
        for sn in a.get("separateNeighbours") or []:
            ms = [by.get(m) for m in sn["members"]]
            if len(ms) == 2 and all(ms) and all(o["class"] == "table" for o in ms) and 0.35 <= sn.get("gapSides", 0) < 0.9:
                x0, y0, x1, y1 = span(ms)
                side = max(x1 - x0, y1 - y0) * 1.25 + 40
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
                if not any(o["id"] in in_group and inside(o, box, whole=False) for o in tables):
                    near.append((p, cx, cy, side))
    rng.shuffle(near); rng.shuffle(pos)
    for p, cx, cy, side in near[:20]:
        add("MERGED", "nearmiss", "no", im(p), cx, cy, side)
    for p, cx, cy, side in pos[:20]:
        add("MERGED", "pos", "yes", im(p), cx, cy, side)
    return items


def build_v5_items(d):
    """The V5 test (training/synth_vlm.py --split blind, frozen): its own crops
    and questions, as generated; nothing is re-cut or re-framed here."""
    items = []
    for line in open(os.path.join(d, "items.jsonl")):
        r = json.loads(line)
        with open(os.path.join(d, r["image"]), "rb") as f:
            items.append(dict(task=r["task"], source="v5", sub=r["sub"], truth=r["truth"], q=r["q"], level=r["level"], family=r["family"],
                              image=base64.b64encode(f.read()).decode()))
    return items


def task_metrics(rows):
    """Per task, what the product's two-look rule makes of the answers
    (MeritLocalCheck.judge), all on the same items:
      accuracy    one look right
      covered     both looks answered and agree (an answer the product can use)
      agreedRight / agreedWrong  of all items: both looks agree and are right /
                  wrong (wrong is the upper bound of a WRONG SUGGESTION: the
                  product offers one where the agreed answer differs from the
                  analysis)
      undecided   the looks disagree (UNSURE) or one did not answer
      missed      a true object called "nothing", a true "yes" answered "no",
                  or a count below the truth (one look)
      falseYes / fabricated  "yes" on a true "no"; an object named on an empty
                  crop (one look)"""
    out = {}
    for task in sorted({r["task"] for r in rows}):
        xs = [r for r in rows if r["task"] == task]
        n = len(xs)
        two = [r for r in xs if "parsed2" in r]
        agreed = [r for r in two if r["parsed"] is not None and r["parsed"] == r["parsed2"]]
        right = lambda r: r["parsed"] == r["truth"]
        m = dict(n=n, accuracy=round(sum(map(right, xs)) / n, 3), accuracyWilson=wilson(sum(map(right, xs)), n))
        if two:
            m.update(covered=round(len(agreed) / len(two), 3), agreedRight=round(sum(map(right, agreed)) / len(two), 3),
                     agreedWrong=round(sum(not right(r) for r in agreed) / len(two), 3), undecided=round(1 - len(agreed) / len(two), 3))
        if task == "ID":
            m["missed"] = round(sum(r["parsed"] == "nothing" for r in xs) / n, 3)
        elif task == "NEG":
            m["fabricated"] = round(sum(r["parsed"] not in (None, "nothing") for r in xs) / n, 3)
        elif task in ("COUNT", "CHAIRS"):
            m["missed"] = round(sum(isinstance(r["parsed"], int) and r["parsed"] < r["truth"] for r in xs) / n, 3)
            m["over"] = round(sum(isinstance(r["parsed"], int) and r["parsed"] > r["truth"] for r in xs) / n, 3)
        else:
            pos, neg = [r for r in xs if r["truth"] == "yes"], [r for r in xs if r["truth"] == "no"]
            m["missed"] = round(sum(r["parsed"] == "no" for r in pos) / len(pos), 3) if pos else None
            m["falseYes"] = round(sum(r["parsed"] == "yes" for r in neg) / len(neg), 3) if neg else None
        m["unparsed"] = sum(r["parsed"] is None for r in xs)
        out[task] = m
    return out


def v5_summary(rows):
    """V5's pre-registered rows (training/README.md, 2026-10-24, written before
    any V5 item was generated or any V5 adapter trained). Each with n, rate and
    a Wilson 95 % interval; `passes` applies the bars exactly as written."""
    rows = [r for r in rows if r.get("source") == "v5"]
    if not rows:
        return None
    def rate(xs, ok):
        k = sum(1 for x in xs if ok(x))
        return dict(n=len(xs), k=k, rate=round(k / len(xs), 3) if xs else None, wilson=wilson(k, len(xs)), unparsed=sum(x["parsed"] is None for x in xs))
    T = lambda task, f=lambda r: True: [r for r in rows if r["task"] == task and f(r)]
    right = lambda x: x["parsed"] == x["truth"]
    over = lambda x: isinstance(x["parsed"], int) and x["parsed"] > x["truth"]
    yes = lambda x: x["parsed"] == "yes"
    furn = lambda r: r["truth"] in ("sofa", "bench", "banquette")
    notnear = lambda r: not r["sub"].endswith("-near")
    out = dict(idOther=rate(T("ID", lambda r: not furn(r)), right), idFurniture=rate(T("ID", furn), right),
               idEntrance=rate(T("ID", lambda r: r["truth"] == "entrance"), right), idLodge=rate(T("ID", lambda r: r["truth"] == "lodge"), right),
               idWithWord=rate(T("ID", lambda r: r["sub"].endswith("-word")), right),
               emptyFabricated=rate(T("NEG"), lambda x: x["parsed"] not in (None, "nothing")),
               emptyWordFabricated=rate(T("NEG", lambda r: r["sub"] == "nothing-word"), lambda x: x["parsed"] not in (None, "nothing")),
               chairsAll=rate(T("CHAIRS"), right), chairsOdd=rate(T("CHAIRS", lambda r: r["truth"] % 2), right), chairsOver=rate(T("CHAIRS"), over),
               chairsPrinted=rate(T("CHAIRS", lambda r: r["sub"].endswith("-printed")), right),
               countAll=rate(T("COUNT"), right), countOver=rate(T("COUNT"), over),
               mergedAll=rate(T("MERGED"), right), mergedYesOnNo=rate(T("MERGED", lambda r: r["truth"] == "no"), yes),
               mergedYesOnNear=rate(T("MERGED", lambda r: r["sub"].endswith("-near")), yes),
               servesAll=rate(T("SERVES", notnear), right), servesYesOnNo=rate(T("SERVES", lambda r: r["truth"] == "no" and notnear(r)), yes),
               servesNearReported=rate(T("SERVES", lambda r: not notnear(r)), yes), servesBack=rate(T("SERVES", lambda r: r["sub"].endswith("-back")), right),
               **{f"serves_{p}": rate(T("SERVES", lambda r, p=p: r["sub"].startswith(p + "-") and notnear(r)), right) for p in ("sofa", "bench", "banquette")},
               **{f"servesYesOnNo_{p}": rate(T("SERVES", lambda r, p=p: r["sub"].startswith(p + "-no") and notnear(r)), yes) for p in ("sofa", "bench", "banquette")},
               **{f"id_{c}": rate(T("ID", lambda r, c=c: r["truth"] == c), right) for c in WORDS if c != "nothing"},
               idUnlabelled=rate(T("ID", lambda r: r["sub"].endswith("-unlabelled")), right),
               chairsPrintedMatch=rate(T("CHAIRS", lambda r: r["sub"].endswith("-printed-match")), right),
               chairsPrintedWrong=rate(T("CHAIRS", lambda r: r["sub"].endswith("-printed-wrong")), right))
    r_ = lambda k: out[k]["rate"]
    ok = lambda k, lo=None, hi=None: r_(k) is not None and (lo is None or r_(k) >= lo) and (hi is None or r_(k) <= hi)
    out["passes"] = dict(
        identify=ok("idOther", 0.85) and ok("idFurniture", 0.80) and ok("emptyFabricated", hi=0.05) and ok("emptyWordFabricated", hi=0.10)
        and all(ok(f"id_{c}", 0.70) for c in WORDS if c != "nothing"),
        chairs=ok("chairsAll", 0.80) and ok("chairsOdd", 0.80) and ok("chairsOver", hi=0.10) and ok("chairsPrintedMatch", 0.70) and ok("chairsPrintedWrong", 0.70),
        count=ok("countAll", 0.80) and ok("countOver", hi=0.10),
        merged=ok("mergedAll", 0.85) and ok("mergedYesOnNo", hi=0.10),
        serves=ok("servesAll", 0.85) and ok("servesYesOnNo", hi=0.10) and all(ok(f"servesYesOnNo_{p}", hi=0.15) for p in ("sofa", "bench", "banquette")))
    out["perLevel"] = {f"L{lv}": rate([r for r in rows if r.get("level") == lv], right) for lv in sorted({r.get("level") for r in rows if r.get("level")})}
    out["perFamily"] = {f: rate([r for r in rows if r.get("family") == f], right) for f in sorted({r.get("family") for r in rows if r.get("family")})}
    return out


def answer_word(text):
    t = text.lower()
    hits = [(m.start(), w) for w in WORDS for m in [re.search(r"\b" + w + r"s?\b", t)] if m]
    hits += [(m.start(), SYN[w]) for w in SYN for m in [re.search(r"\b" + w + r"s?\b", t)] if m]
    return min(hits)[1] if hits else None


def answer_number(text):
    m = re.search(r"\d+", text)
    if m:
        return int(m.group(0))
    for w, n in {"zero": 0, "no": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}.items():
        if re.search(r"\b" + w + r"\b", text.lower()):
            return n
    return None


def answer_yesno(text):
    m = re.search(r"\b(yes|no)\b", text.lower())
    return m.group(1) if m else None


def ask(port, item, max_tokens):
    body = json.dumps({"messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + item["image"]}},
        {"type": "text", "text": item["q"]}]}], "temperature": 0, "max_tokens": max_tokens, "cache_prompt": False,
        "chat_template_kwargs": {"enable_thinking": False}}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=body, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=900) as r:
        out = json.loads(r.read())
    msg = out["choices"][0]["message"]
    return (msg.get("content") or ""), (msg.get("reasoning_content") or ""), out.get("usage", {}), time.time() - t0


def peak_rss_mb(pid):
    try:
        for line in open(f"/proc/{pid}/status"):
            if line.startswith("VmHWM"):
                return int(line.split()[1]) / 1024
    except OSError:
        return None


def parse(task, text):
    if task in ("ID", "NEG"):
        return answer_word(text)
    if task in ("COUNT", "CHAIRS"):
        return answer_number(text)
    return answer_yesno(text)


def two_looks(rows):
    """The product's rule (MeritLocalCheck.judge): an answer counts only when
    both looks give it. Per task: how often the looks agree (`consistent`), how
    often an agreed answer is right (`consistentAccuracy`), and on empty crops
    and true "no" items, how often both looks agree on a fabrication."""
    rows = [r for r in rows if "parsed2" in r]
    if not rows:
        return None
    out = {}
    for task in sorted({r["task"] for r in rows}):
        xs = [r for r in rows if r["task"] == task]
        same = [r for r in xs if r["parsed"] is not None and r["parsed"] == r["parsed2"]]
        out[task] = dict(n=len(xs), consistent=round(len(same) / len(xs), 3),
                         consistentAccuracy=round(sum(r["parsed"] == r["truth"] for r in same) / len(same), 3) if same else None)
    neg = [r for r in rows if r["task"] == "NEG"]
    out["fabricationEmptyBothLooks"] = round(sum(r["parsed"] not in (None, "nothing") and r["parsed"] == r["parsed2"] for r in neg) / len(neg), 3) if neg else None
    no = [r for r in rows if r["task"] in ("MERGED", "SERVES") and r["truth"] == "no"]
    out["fabricationYesBothLooks"] = round(sum(r["parsed"] == "yes" == r["parsed2"] for r in no) / len(no), 3) if no else None
    real = [r for r in rows if r["task"] == "ID" and r["source"] in ("golden", "ornek")]
    same = [r for r in real if r["parsed"] is not None and r["parsed"] == r["parsed2"]]
    out["idRealConsistentAccuracy"] = round(sum(r["parsed"] == r["truth"] for r in same) / len(same), 3) if same else None
    out["idRealConsistent"] = round(len(same) / len(real), 3) if real else None
    return out


def wilson(k, n, z=1.96):
    if not n:
        return None
    ph = k / n; d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d; h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 3), round(min(1.0, c + h), 3)]


def s1_summary(rows):
    """S1's pre-registered rows (training/README.md), each with its n, its rate,
    a Wilson 95 % interval and the two-look figure beside it (reported, not
    used to pass)."""
    rows = [r for r in rows if r.get("sub") and r.get("source") == "s1"]
    if not rows:
        return None
    def rate(xs, ok):
        k = sum(1 for x in xs if ok(x))
        both = [x for x in xs if "parsed2" in x and x["parsed"] is not None and x["parsed"] == x["parsed2"]]
        return dict(n=len(xs), k=k, rate=round(k / len(xs), 3) if xs else None, wilson=wilson(k, len(xs)),
                    twoLooksConsistent=len(both), twoLooksRight=sum(1 for x in both if ok(x)))
    T = lambda task, subs=None: [r for r in rows if r["task"] == task and (subs is None or r["sub"] in subs)]
    right = lambda x: x["parsed"] == x["truth"]
    over = lambda x: isinstance(x["parsed"], int) and x["parsed"] > x["truth"]
    yes = lambda x: x["parsed"] == "yes"
    out = dict(chairsOddExact=rate(T("CHAIRS", ["odd"]), right), chairsAllExact=rate(T("CHAIRS"), right), chairsOver=rate(T("CHAIRS"), over),
               mergedAll=rate(T("MERGED"), right), mergedYesOnNearMiss=rate(T("MERGED", ["nearmiss"]), yes),
               servesAll=rate(T("SERVES"), right), servesYesOnBenchBanquetteNeg=rate(T("SERVES", ["benchneg", "banquetteneg"]), yes))
    bars = dict(chairs=out["chairsOddExact"]["rate"] is not None and out["chairsOddExact"]["rate"] >= 0.80 and out["chairsAllExact"]["rate"] >= 0.80 and out["chairsOver"]["rate"] <= 0.10,
                merged=out["mergedAll"]["rate"] is not None and out["mergedAll"]["rate"] >= 0.85 and out["mergedYesOnNearMiss"]["rate"] <= 0.10,
                serves=out["servesAll"]["rate"] is not None and out["servesAll"]["rate"] >= 0.85 and out["servesYesOnBenchBanquetteNeg"]["rate"] <= 0.10)
    out["passes"] = bars
    out["perSub"] = {f"{r_task}:{sub}": rate(T(r_task, [sub]), right) for r_task, sub in sorted({(r["task"], r["sub"]) for r in rows})}
    return out


def summarise(name, rows, load_s, rss, settings):
    def acc(xs):
        return round(sum(x["parsed"] == x["truth"] for x in xs) / len(xs), 3) if xs else None
    by = lambda f: [x for x in rows if f(x)]
    idg = by(lambda x: x["task"] == "ID" and x["source"] == "generated")
    furn = [x for x in idg if x["truth"] in ("sofa", "bench", "banquette")]
    real = by(lambda x: x["task"] == "ID" and x["source"] in ("golden", "ornek"))
    neg = by(lambda x: x["task"] == "NEG")
    yesno_neg = by(lambda x: x["task"] in ("MERGED", "SERVES") and x["truth"] == "no")
    counts = by(lambda x: x["task"] == "COUNT")
    chairs = by(lambda x: x["task"] == "CHAIRS")
    secs = sorted(x["seconds"] for x in rows)
    return dict(model=name, settings=settings, loadSeconds=round(load_s, 1), peakRssMb=round(rss) if rss else None,
                idGenerated=acc(idg), idFurniture=acc(furn), idReal=acc(real),
                fabricationEmpty=round(sum(x["parsed"] not in (None, "nothing") for x in neg) / len(neg), 3) if neg else None,
                fabricationYes=round(sum(x["parsed"] == "yes" for x in yesno_neg) / len(yesno_neg), 3) if yesno_neg else None,
                count=acc(counts), countOver=round(sum((x["parsed"] or 0) > x["truth"] for x in counts) / len(counts), 3) if counts else None,
                chairs=acc(chairs), chairsGolden=acc([x for x in chairs if x["source"] == "golden"]),
                chairsWithin1=round(sum(x["parsed"] is not None and abs(x["parsed"] - x["truth"]) <= 1 for x in chairs) / len(chairs), 3) if chairs else None,
                merged=acc(by(lambda x: x["task"] == "MERGED")), serves=acc(by(lambda x: x["task"] == "SERVES")),
                unparsed=sum(x["parsed"] is None for x in rows), emptyAnswers=sum(not x["answer"] for x in rows),
                medianSeconds=round(statistics.median(secs), 2), p90Seconds=round(secs[int(0.9 * (len(secs) - 1))], 2),
                n=len(rows), twoLooks=two_looks(rows), s1=s1_summary(rows), tasks=task_metrics(rows), v5=v5_summary(rows))


def main():
    ap = argparse.ArgumentParser()
    for k in ("server", "models", "out", "model"):
        ap.add_argument("--" + k, required=True)
    ap.add_argument("--seat", default="", help="furniture scenes (V4 items; not needed with --v5)")
    ap.add_argument("--rel", default="", help="relation scenes (V4 and S1 items; not needed with --v5)")
    ap.add_argument("--v5", default="", help="the V5 test: a DIR written by training/synth_vlm.py (items.jsonl + img/); its items only")
    ap.add_argument("--syn", default="", help="generation-3 plans: round tables with 6-12 chairs, for CHAIRS")
    ap.add_argument("--size", type=int, default=448)
    ap.add_argument("--min-tokens", type=int, default=0)
    ap.add_argument("--max-tokens", type=int, default=48)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--port", type=int, default=8095)
    ap.add_argument("--no-real", action="store_true", help="leave the Golden/ORNEK crops out (settings and training choices)")
    ap.add_argument("--lora", default="", help="a llama.cpp LoRA adapter (training/vlm_lora.py gguf) served with the model")
    ap.add_argument("--ctx", type=int, default=8192)
    ap.add_argument("--looks", type=int, choices=[1, 2], default=1, help="2: also ask each crop turned a quarter, as the product's second look does")
    ap.add_argument("--s1", default="", help="the supplementary blind test S1: its scene DIR (synth_relations.py --s1); items from it and from --rel")
    ap.add_argument("--resume", action="store_true", help="continue a run a restart cut short (OUT.partial.jsonl)")
    ap.add_argument("--cache-ram", type=int, default=None, help="llama-server --cache-ram MiB (0: no host prompt cache; unset: the build's default)")
    args = ap.parse_args()
    if args.v5:
        items = build_v5_items(args.v5)
    elif args.s1:
        asked = []
        build_items(args.seat, args.rel, random.Random(5), args.size, args.syn or None, real=False, asked=asked)  # V4's own selection (seed 5)
        items = build_s1_items(args.s1, args.rel, random.Random(args.seed), args.size, asked)
    else:
        items = build_items(args.seat, args.rel, random.Random(args.seed), args.size, args.syn or None, real=not args.no_real)
    if args.limit:
        random.Random(1).shuffle(items); items = items[:args.limit]
    print(f"{len(items)} items: " + json.dumps({k: sum(1 for i in items if f'{i["task"]}:{i["source"]}' == k) for k in sorted({f'{i["task"]}:{i["source"]}' for i in items})}), flush=True)
    model, proj = MODELS[args.model]
    cmd = [args.server, "-m", os.path.join(args.models, model), "--mmproj", os.path.join(args.models, proj), "--host", "127.0.0.1",
           "--port", str(args.port), "-t", str(args.threads), "-tb", str(args.threads), "-c", str(args.ctx), "-np", "1", "-ngl", "0"]
    if args.lora:
        cmd += ["--lora", args.lora]
    if args.cache_ram is not None:
        cmd += ["--cache-ram", str(args.cache_ram)]
    if args.min_tokens:
        cmd += ["--image-min-tokens", str(args.min_tokens)]
    # Every answered item is appended to OUT.partial.jsonl as it lands (with the
    # server's VmHWM at that moment); --resume continues a run a restart cut
    # short, skipping the items already answered after checking they are the
    # same items in the same order. Each request is independent (no prompt
    # reuse, temperature 0), so a resumed run asks exactly what one run asks;
    # the peak RSS is the largest any segment's server reached.
    partial = args.out + ".partial.jsonl"
    done, hwm_prev, segments = {}, 0, 1
    if args.resume and os.path.exists(partial):
        for line in open(partial):
            rec = json.loads(line)
            it = items[rec["i"]]
            if rec["key"] != [it["task"], it["source"], str(it["truth"])]:
                raise SystemExit(f"--resume: item {rec['i']} is not the item this run would ask; refusing")
            done[rec["i"]] = rec["row"]
            hwm_prev = max(hwm_prev, rec.get("hwm") or 0)
            segments = max(segments, rec.get("segment", 1) + 1)
        print(f"resuming: {len(done)} of {len(items)} already answered, segment {segments}", flush=True)
    elif os.path.exists(partial):
        os.remove(partial)
    pf = open(partial, "a")
    t0 = time.time()
    log = open(args.out + ".server.log", "a" if done else "w")
    proc = subprocess.Popen(cmd, stdout=log, stderr=log)
    rows = []
    try:
        while True:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/health", timeout=2) as r:
                    if json.loads(r.read()).get("status") == "ok":
                        break
            except Exception:
                pass
            if proc.poll() is not None:
                raise RuntimeError("server exited")
            if time.time() - t0 > 300:
                raise RuntimeError("server did not come up")
            time.sleep(0.5)
        load_s = time.time() - t0
        for i, it in enumerate(items):
            if i in done:
                rows.append(done[i])
                continue
            text, reasoning, usage, dt = ask(args.port, it, args.max_tokens)
            row = dict(task=it["task"], source=it["source"], **{k: it[k] for k in ("sub", "level", "family") if k in it}, truth=it["truth"], answer=text.strip()[:120],
                       reasoningChars=len(reasoning), parsed=parse(it["task"], text), seconds=round(dt, 3),
                       promptTokens=usage.get("prompt_tokens"))
            if args.looks == 2:
                # the product's second look: the same crop turned a quarter
                # (src/plan-local-check.js LOOKS); the truth does not change
                turned = Image.open(io.BytesIO(base64.b64decode(it["image"]))).rotate(90)
                text2, _, _, dt2 = ask(args.port, dict(it, image=b64(turned)), args.max_tokens)
                row.update(answer2=text2.strip()[:120], parsed2=parse(it["task"], text2), seconds2=round(dt2, 3))
            rows.append(row)
            pf.write(json.dumps(dict(i=i, key=[it["task"], it["source"], str(it["truth"])], row=row, hwm=peak_rss_mb(proc.pid), segment=segments)) + "\n")
            pf.flush()
            os.fsync(pf.fileno())
            if i % 25 == 0:
                print(f"  {i}/{len(items)} {dt:.1f}s {it['task']} {it['truth']} -> {text.strip()[:40]!r}", flush=True)
        rss = max(peak_rss_mb(proc.pid) or 0, hwm_prev) or None
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
    s = summarise(args.model, rows, load_s, rss, dict(looks=args.looks, size=args.size, minTokens=args.min_tokens, maxTokens=args.max_tokens, threads=args.threads, seed=args.seed,
                                                      ctx=args.ctx, real=not args.no_real, lora=os.path.basename(args.lora) or None,
                                                      cacheRam=args.cache_ram, s1=bool(args.s1), v5=os.path.basename(os.path.normpath(args.v5)) or None))
    print(json.dumps(s, indent=1), flush=True)
    json.dump(dict(ranAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), segments=segments, summary=s, prompts=Q, files=[model, proj] + ([os.path.basename(args.lora)] if args.lora else []),
                   dirs=dict(seat=args.seat, rel=args.rel, syn=args.syn), rows=rows), open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
