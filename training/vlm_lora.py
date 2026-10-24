"""Plan-specific LoRA for a small local vision-language model (V4, 2026-10-18).

A small VLM asked about a floor-plan crop out of the box answers like a model
that has never seen a floor plan drawn from above: on the 60-item dev check
Qwen3.5-0.8B named the object at the centre right 17 % of the time and called
an EMPTY crop a "table" every time. The symbols are a drawing convention
(a sofa is a rectangle with a back line, a banquette a long one against a
wall), so this teaches the convention with labelled examples and nothing else:

    data   cut question/answer crops from the TRAINING splits only
           (generated plans: furniture scenes, generation-3 plans, relation
           scenes), with the exact question wording the benchmark asks
           (benchmarks/offline-intelligence/local-vlm-bench2.py);
    train  a LoRA on the language model's MLP layers (gate/up/down, all 24
           blocks); the vision encoder and projector stay frozen, so the
           published projector file is reused unchanged;
    gguf   write the adapter in llama.cpp's LoRA format, so the SAME
           llama-server that serves the base model serves it (`--lora`);
    agree  the adapter served by llama.cpp must answer what transformers +
           PEFT answer on the same crops — the conversion is checked, not
           assumed.

    python -I training/vlm_lora.py data  --seat DIR --syn DIR --rel DIR --out DATA [--seed 21]
    python -I training/vlm_lora.py train --base HF_DIR --data DATA[,DATA2] --out RUN [--rank 16 --epochs 1] [--curriculum] [--replay-tasks ID,NEG,COUNT,MERGED]
    python -I training/vlm_lora.py gguf  --run RUN --out adapter.gguf
    python -I training/vlm_lora.py agree --base HF_DIR --run RUN --data DATA --server URL [--n 24]

Nothing here sees a dev, blind, Golden or ORNEK crop: the benchmark's items
are cut from `dev`/`blind`/`val` splits and the two real plans, and `data`
refuses a directory whose annotations name another split. Only the MLP
projections are adapted because they map one-to-one onto llama.cpp's
`ffn_gate/ffn_up/ffn_down` tensors; the attention projections of this hybrid
model are reordered by the GGUF conversion, and an adapter on a reordered
tensor would be silently wrong.
"""
import argparse
import importlib.util
import io
import json
import math
import os
import random
import re
import sys
import time

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("bench2", os.path.join(ROOT, "benchmarks", "offline-intelligence", "local-vlm-bench2.py"))
bench = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bench)

MLP = re.compile(r"model\.language_model\.layers\.(\d+)\.mlp\.(gate_proj|up_proj|down_proj)$")
GGUF_NAME = {"gate_proj": "ffn_gate", "up_proj": "ffn_up", "down_proj": "ffn_down"}


# ---- data -------------------------------------------------------------------------------
def _split_ok(a, want="train"):
    s = a.get("split")
    s = s.get("set") if isinstance(s, dict) else s
    return s == want


def _load_train(d):
    out = []
    for a, p in bench.load(d):
        if not _split_ok(a):
            raise SystemExit(f"{a.get('planId')} in {d} is not a training plan (split {a.get('split')!r}); refusing")
        out.append((a, p))
    return out


def build(seat_dir, syn_dir, rel_dir, rng, size):
    """Training items as (task, truth, question, image) with jittered crops."""
    cache = {}

    def im(p):
        if p not in cache:
            if len(cache) > 24:
                cache.clear()
            cache[p] = Image.open(p).convert("RGB")
        return cache[p]

    items = []

    def add(task, truth, p, cx, cy, side, q=None, obj=None, keep=None):
        # Jitter the framing the way a real crop varies (scale, offset, quarter
        # turns) — but never so far that the label stops being true. A first
        # cut of this set moved the centre of a bench crop onto the table
        # beside it and let a half table into a COUNT crop; the contact sheet
        # showed both. So: an ID crop's centre stays inside its own object, and
        # a crop whose label depends on what is in view is re-checked after the
        # jitter and cut unjittered when the check fails.
        lo, hi, off = {"ID": (0.9, 1.2, 0.0), "NEG": (0.85, 1.25, 0.08), "COUNT": (0.9, 1.15, 0.05),
                       "CHAIRS": (0.92, 1.1, 0.03), "MERGED": (0.92, 1.15, 0.04), "SERVES": (0.92, 1.15, 0.04)}[task]
        s = side * rng.uniform(lo, hi)
        if obj is not None:
            jx, jy = cx + rng.uniform(-0.3, 0.3) * obj["w"], cy + rng.uniform(-0.3, 0.3) * obj["h"]
        else:
            jx, jy = cx + rng.uniform(-off, off) * s, cy + rng.uniform(-off, off) * s
        if keep is not None and not keep(jx, jy, s):
            jx, jy, s = cx, cy, side
        c = bench.crop(im(p), jx, jy, s, size)
        k = rng.randrange(4)
        if k:
            c = c.rotate(90 * k)
        items.append(dict(task=task, truth=truth, q=q or bench.Q["ID" if task in ("ID", "NEG") else task], image=c))

    seats = _load_train(seat_dir)
    syn = _load_train(syn_dir)
    rel = _load_train(rel_dir)
    ID_CAP = 140
    pools = {k: [] for k in ["table", "chair", "sofa", "bench", "banquette", "column", "stage", "bar"]}
    negs, serves_pos, serves_neg, chairs, counts, merged, apart = [], [], [], [], [], [], []
    for a, p in seats + syn + rel:
        objs = [o for o in a["objects"] if all(k in o for k in ("cx", "cy", "w", "h"))]
        by = {o["id"]: o for o in objs}
        for o in objs:
            if o["class"] in pools and not o.get("ignore"):
                pools[o["class"]].append((p, o))
        W, H = a["source"]["width"], a["source"]["height"]
        for _ in range(60):
            side = rng.uniform(90, 200)
            cx, cy = rng.uniform(side / 2, W - side / 2), rng.uniform(side / 2, H - side / 2)
            if not any(bench.inside(o, (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), whole=False) for o in objs):
                negs.append((p, cx, cy, side))
                break
        for g in a.get("seatingGroups") or []:
            t = by.get(g["table"])
            for m in g["members"]:
                o = by.get(m)
                if t and o and o["class"] in ("sofa", "bench", "banquette"):
                    serves_pos.append((p, t, o))
        tables = [o for o in objs if o["class"] == "table"]
        in_group = {m for g in a.get("logicalGroups") or [] for m in g["members"]}
        for s in a.get("separateNeighbours") or []:
            ms = [by.get(m) for m in s["members"]]
            if len(ms) != 2 or not all(ms):
                continue
            t = next((o for o in ms if o["class"] == "table"), None)
            o = next((o for o in ms if o["class"] in ("sofa", "bench", "banquette")), None)
            if t and o:
                serves_neg.append((p, t, o))
            elif all(o["class"] == "table" for o in ms) and s.get("gapSides", 0) >= 0.9:
                x0 = min(o["cx"] - o["w"] / 2 for o in ms); x1 = max(o["cx"] + o["w"] / 2 for o in ms)
                y0 = min(o["cy"] - o["h"] / 2 for o in ms); y1 = max(o["cy"] + o["h"] / 2 for o in ms)
                side = max(x1 - x0, y1 - y0) * 1.25 + 40
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
                if not any(o["id"] in in_group and bench.inside(o, box, whole=False) for o in tables):
                    apart.append((p, cx, cy, side))
        owner = {}
        for r in a.get("relationships") or []:
            if "chair" in r and "belongsTo" in r:
                owner.setdefault(r["belongsTo"], []).append(r["chair"])
        rng.shuffle(tables)
        for t in tables[:8]:
            side = 2.6 * max(t["w"], t["h"]) + 60
            box = (t["cx"] - side / 2, t["cy"] - side / 2, t["cx"] + side / 2, t["cy"] + side / 2)
            whole = [o for o in tables if bench.inside(o, box)]
            if not [o for o in tables if bench.inside(o, box, whole=False) and o not in whole]:
                counts.append((p, t["cx"], t["cy"], side, len(whole), tables))
            if t["id"] not in in_group and t["id"] in owner and all(
                    o is t or math.hypot(o["cx"] - t["cx"], o["cy"] - t["cy"]) > 1.8 * max(t["w"], t["h"], o["w"], o["h"]) for o in tables):
                chairs.append((p, t, len(owner[t["id"]])))
        for g in a.get("logicalGroups") or []:
            ms = [by[m] for m in g["members"] if m in by]
            if 2 <= len(ms) <= 4:
                x0 = min(o["cx"] - o["w"] / 2 for o in ms); x1 = max(o["cx"] + o["w"] / 2 for o in ms)
                y0 = min(o["cy"] - o["h"] / 2 for o in ms); y1 = max(o["cy"] + o["h"] / 2 for o in ms)
                merged.append((p, (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 1.25 + 40))

    def strat(xs, key, per):
        rng.shuffle(xs)
        seen, out = {}, []
        for x in xs:
            k = key(x)
            if seen.get(k, 0) < per:
                seen[k] = seen.get(k, 0) + 1
                out.append(x)
        return out

    for cls, xs in pools.items():
        rng.shuffle(xs)
        for p, o in xs[:ID_CAP]:
            side = 2.0 * max(o["w"], o["h"]) + 30 if cls != "stage" else 1.15 * max(o["w"], o["h"])
            # rotated boxes: w/h are the object's own sides, so 0.3 of them stays on it
            add("ID", cls, p, o["cx"], o["cy"], side, obj=dict(w=min(o["w"], o["h"]), h=min(o["w"], o["h"])))
    rng.shuffle(negs)
    for p, cx, cy, side in negs[:ID_CAP]:
        add("NEG", "nothing", p, cx, cy, side)
    for lab, xs in (("yes", serves_pos), ("no", serves_neg)):
        rng.shuffle(xs)
        for p, t, o in xs[:220]:
            cx, cy = (t["cx"] + o["cx"]) / 2, (t["cy"] + o["cy"]) / 2
            side = max(abs(t["cx"] - o["cx"]) + max(t["w"], o["w"]), abs(t["cy"] - o["cy"]) + max(t["h"], o["h"])) * 1.3 + 30
            add("SERVES", lab, p, cx, cy, side, q=bench.Q["SERVES"].format(piece=o["class"]))
    def same_count(tables, n):
        def ok(x, y, s):
            box = (x - s / 2, y - s / 2, x + s / 2, y + s / 2)
            whole = [o for o in tables if bench.inside(o, box)]
            return len(whole) == n and not [o for o in tables if bench.inside(o, box, whole=False) and o not in whole]
        return ok
    for p, cx, cy, side, n, tables in strat(counts, lambda x: x[4], 45):
        add("COUNT", n, p, cx, cy, side, keep=same_count(tables, n))
    for p, t, n in strat(chairs, lambda x: x[2], 40):
        add("CHAIRS", n, p, t["cx"], t["cy"], 2.4 * max(t["w"], t["h"]) + 50)
    rng.shuffle(merged); rng.shuffle(apart)
    for p, cx, cy, side in merged[:220]:
        add("MERGED", "yes", p, cx, cy, side)
    for p, cx, cy, side in apart[:220]:
        add("MERGED", "no", p, cx, cy, side)
    rng.shuffle(items)
    return items


def cmd_data(a):
    rng = random.Random(a.seed)
    items = build(a.seat, a.syn, a.rel, rng, a.size)
    os.makedirs(os.path.join(a.out, "img"), exist_ok=True)
    rows = []
    for i, it in enumerate(items):
        name = f"img/{i:05d}.png"
        it["image"].save(os.path.join(a.out, name))
        rows.append(dict(task=it["task"], truth=it["truth"], q=it["q"], image=name))
    with open(os.path.join(a.out, "items.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    tally = {}
    for r in rows:
        k = f"{r['task']}:{r['truth']}"
        tally[k] = tally.get(k, 0) + 1
    meta = dict(n=len(rows), seed=a.seed, size=a.size, sources=dict(seat=a.seat, syn=a.syn, rel=a.rel), splits="train only", tally=dict(sorted(tally.items())))
    json.dump(meta, open(os.path.join(a.out, "meta.json"), "w"), indent=1)
    print(json.dumps(meta, indent=1))


# ---- model ------------------------------------------------------------------------------
def load_model(base, run=None, dtype="bf16"):
    import torch
    from transformers import AutoProcessor, Qwen3_5ForConditionalGeneration
    proc = AutoProcessor.from_pretrained(base)
    model = Qwen3_5ForConditionalGeneration.from_pretrained(base, dtype=torch.bfloat16 if dtype == "bf16" else torch.float32)
    model.eval()
    if run:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, run)
        model.eval()
    return proc, model


def prompt(proc, q):
    msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": q}]}]
    return proc.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False, enable_thinking=False)


def cmd_train(a):
    import torch
    from peft import LoraConfig, get_peft_model
    torch.manual_seed(a.seed)
    torch.set_num_threads(a.threads)
    proc, model = load_model(a.base, dtype=a.dtype)
    for p_ in model.parameters():
        p_.requires_grad_(False)
    targets = [n for n, _ in model.named_modules() if MLP.search(n)]
    cfg = LoraConfig(r=a.rank, lora_alpha=2 * a.rank, lora_dropout=0.05, target_modules=targets, bias="none")
    if a.grad_ckpt:  # recompute activations in the backward pass: less memory, more time
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model = get_peft_model(model, cfg)
    if a.init:  # continue from an earlier run's adapter (same rank and targets)
        from peft import set_peft_model_state_dict
        from safetensors.torch import load_file as st_load
        set_peft_model_state_dict(model, st_load(os.path.join(a.init, "adapter_model.safetensors")))
    trainable = sum(p_.numel() for p_ in model.parameters() if p_.requires_grad)
    # Several data dirs (comma separated): the first in full, each further one
    # (a replay of an earlier run's crops) only for --replay-tasks.
    rows = []
    for k, d in enumerate(a.data.split(",")):
        part = []
        for l in open(os.path.join(d, "items.jsonl")):
            r = json.loads(l)
            if k and r["task"] not in a.replay_tasks.split(","):
                continue
            r["image"] = os.path.join(d, r["image"])
            part.append(r)
        if k and a.replay_max and len(part) > a.replay_max:
            part = random.Random(a.seed + k).sample(part, a.replay_max)
        rows += part
    if a.limit:
        rows = rows[:a.limit]
    os.makedirs(a.out, exist_ok=True)
    params = [p_ for p_ in model.parameters() if p_.requires_grad]
    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=0.0)
    total = math.ceil(len(rows) * a.epochs / a.accum)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 20) * max(0.05, 1 - s / max(1, total)))
    end_id = proc.tokenizer.convert_tokens_to_ids("<|im_end|>")
    log = open(os.path.join(a.out, "train.log"), "a")
    say = lambda s: (print(s, flush=True), log.write(s + "\n"), log.flush())
    # Resume: the newest checkpoint holds the adapter, the optimizer, the
    # schedule and how many items were seen; the order is a pure function of
    # the seed, so a resumed run trains exactly what one run trains.
    ck = os.path.join(a.out, "resume")
    start = 0
    if os.path.exists(os.path.join(ck, "state.pt")):
        from peft import set_peft_model_state_dict
        from safetensors.torch import load_file as st_load
        st = torch.load(os.path.join(ck, "state.pt"), weights_only=False)
        set_peft_model_state_dict(model, st_load(os.path.join(ck, "adapter_model.safetensors")))
        opt.load_state_dict(st["opt"]); sched.load_state_dict(st["sched"])
        start = st["seen"]
        say(f"resume at item {start} step {st['step']}")
    say(f"start {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} items={len(rows)} epochs={a.epochs} rank={a.rank} lr={a.lr} accum={a.accum} trainable={trainable} targets={len(targets)}")
    model.train()
    step, t0, run_loss, seen = start // a.accum, time.time(), 0.0, 0
    peak = lambda: __import__("resource").getrusage(__import__("resource").RUSAGE_SELF).ru_maxrss / 1024
    order = list(range(len(rows)))
    for ep in range(math.ceil(a.epochs)):
        rr = random.Random(a.seed + ep)
        rr.shuffle(order)
        if a.curriculum:
            # easy to hard, softly: level plus noise, so every level is present
            # throughout and the end is not hard crops only (replay crops: level 2)
            key = {i: rows[i].get("level", 2) + rr.uniform(0, 2.0) for i in order}
            order.sort(key=key.get)
        n_this = len(order) if ep + 1 <= a.epochs else int(len(order) * (a.epochs - ep))
        for j, idx in enumerate(order[:n_this]):
            if seen < start:
                seen += 1
                continue
            r = rows[idx]
            img = Image.open(r["image"]).convert("RGB")
            pre = prompt(proc, r["q"])
            ans = str(r["truth"])
            x = proc(text=[pre + ans + "<|im_end|>"], images=[img], return_tensors="pt")
            ans_ids = proc.tokenizer(ans, add_special_tokens=False)["input_ids"] + [end_id]
            ids = x["input_ids"][0]
            A = len(ans_ids)
            assert ids[-A:].tolist() == ans_ids, (ids[-A:].tolist(), ans_ids)
            # bf16 autocast is fast only on a CPU with bf16 instructions (AMX /
            # AVX512-BF16); without them fp32 is the faster path (measured, README)
            with torch.autocast("cpu", dtype=torch.bfloat16, enabled=a.dtype == "bf16"):
                out = model(**x, logits_to_keep=A + 1)
            logits = out.logits[0, :A].float()
            loss = torch.nn.functional.cross_entropy(logits, torch.tensor(ans_ids)) / a.accum
            loss.backward()
            run_loss += loss.item() * a.accum
            seen += 1
            if seen % a.accum == 0:
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
                step += 1
                if step % 10 == 0:
                    el = time.time() - t0
                    say(f"step {step}/{total} items {seen} loss {run_loss / (10 * a.accum):.4f} lr {sched.get_last_lr()[0]:.2e} {el / max(1, seen - start):.2f}s/item elapsed {el / 60:.1f}min peakRSS {peak():.0f}MB")
                    run_loss = 0.0
                if a.save_every and step % a.save_every == 0:
                    # atomic: the adapter and its state land together or not at all
                    import shutil
                    new = ck + ".new"
                    shutil.rmtree(new, ignore_errors=True)
                    model.save_pretrained(new)
                    torch.save(dict(opt=opt.state_dict(), sched=sched.state_dict(), seen=seen, step=step), os.path.join(new, "state.pt"))
                    if os.path.exists(ck):
                        shutil.rmtree(ck + ".old", ignore_errors=True)
                        os.replace(ck, ck + ".old")
                    os.replace(new, ck)
                    shutil.rmtree(ck + ".old", ignore_errors=True)
    model.save_pretrained(a.out)
    json.dump(dict(base=os.path.abspath(a.base), data=os.path.abspath(a.data), items=len(rows), epochs=a.epochs, rank=a.rank, alpha=2 * a.rank,
                   lr=a.lr, accum=a.accum, seed=a.seed, trainable=trainable, targets=f"language_model MLP gate/up/down, {len(targets) // 3} blocks",
                   curriculum=a.curriculum, dtype=a.dtype, init=os.path.abspath(a.init) if a.init else None, replayMax=a.replay_max, gradCkpt=a.grad_ckpt, replayTasks=a.replay_tasks, resumedAt=start, peakTrainRssMb=round(peak()),
                   seconds=round(time.time() - t0), finished=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
              open(os.path.join(a.out, "run.json"), "w"), indent=1)
    say(f"done in {(time.time() - t0) / 60:.1f} min")


# ---- llama.cpp adapter --------------------------------------------------------------------
def cmd_gguf(a):
    import numpy as np
    from safetensors.numpy import load_file
    import gguf
    cfg = json.load(open(os.path.join(a.run, "adapter_config.json")))
    sd = load_file(os.path.join(a.run, "adapter_model.safetensors"))
    w = gguf.GGUFWriter(a.out, arch="qwen35")
    w.add_string("general.type", "adapter")
    w.add_string("adapter.type", "lora")
    w.add_float32("adapter.lora.alpha", float(cfg["lora_alpha"]))
    n = 0
    for k in sorted(sd):
        m = re.search(r"model\.language_model\.layers\.(\d+)\.mlp\.(gate_proj|up_proj|down_proj)\.lora_([AB])\.weight$", k)
        if not m:
            raise SystemExit(f"unexpected adapter tensor {k}")
        name = f"blk.{m.group(1)}.{GGUF_NAME[m.group(2)]}.weight.lora_{m.group(3).lower()}"
        # PEFT: A is (rank, in), B is (out, rank) — llama.cpp's lora_a / lora_b as they are
        w.add_tensor(name, sd[k].astype(np.float32))
        n += 1
    w.write_header_to_file(); w.write_kv_data_to_file(); w.write_tensors_to_file(); w.close()
    print(f"wrote {n} tensors, rank {cfg['r']}, alpha {cfg['lora_alpha']} -> {a.out}")


# ---- the conversion is checked -------------------------------------------------------------
def cmd_agree(a):
    import base64
    import torch
    import urllib.request
    torch.set_num_threads(a.threads)
    proc, model = load_model(a.base, a.run)
    rows = [json.loads(l) for l in open(os.path.join(a.data, "items.jsonl"))][-a.n:]
    same = 0
    for r in rows:
        img = Image.open(os.path.join(a.data, r["image"])).convert("RGB")
        x = proc(text=[prompt(proc, r["q"])], images=[img], return_tensors="pt")
        with torch.no_grad():
            g = model.generate(**x, max_new_tokens=8, do_sample=False)
        hf = proc.tokenizer.decode(g[0, x["input_ids"].shape[1]:], skip_special_tokens=True).strip()
        buf = io.BytesIO(); img.save(buf, "PNG")
        body = json.dumps({"messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}},
            {"type": "text", "text": r["q"]}]}], "temperature": 0, "max_tokens": 8, "cache_prompt": False,
            "chat_template_kwargs": {"enable_thinking": False}}).encode()
        req = urllib.request.Request(a.server.rstrip("/") + "/v1/chat/completions", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as resp:
            ll = (json.loads(resp.read())["choices"][0]["message"].get("content") or "").strip()
        ok = bench.parse(r["task"], hf) == bench.parse(r["task"], ll)
        same += ok
        print(f"{'  ' if ok else 'X '}{r['task']:7} truth={r['truth']!s:9} transformers={hf!r:14} llama.cpp={ll!r}", flush=True)
    print(f"agree {same}/{len(rows)}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("data")
    for k in ("seat", "syn", "rel", "out"):
        d.add_argument("--" + k, required=True)
    d.add_argument("--seed", type=int, default=21)
    d.add_argument("--size", type=int, default=448)
    t = sub.add_parser("train")
    for k in ("base", "data", "out"):
        t.add_argument("--" + k, required=True)
    t.add_argument("--rank", type=int, default=16)
    t.add_argument("--epochs", type=float, default=1.0)
    t.add_argument("--lr", type=float, default=2e-4)
    t.add_argument("--accum", type=int, default=8)
    t.add_argument("--threads", type=int, default=4)
    t.add_argument("--seed", type=int, default=3)
    t.add_argument("--limit", type=int, default=0)
    t.add_argument("--save-every", type=int, default=25)
    t.add_argument("--dtype", choices=["bf16", "fp32"], default="bf16", help="weights and compute: bf16 (autocast) or fp32")
    t.add_argument("--grad-ckpt", action="store_true", help="gradient checkpointing (for a model whose fp32 training would not fit in memory)")
    t.add_argument("--init", default="", help="start from this run's adapter (fine-tune) instead of a fresh LoRA")
    t.add_argument("--replay-max", type=int, default=0, help="at most this many items from each 2nd and later data dir (0: all)")
    t.add_argument("--curriculum", action="store_true", help="easy to hard by the items' level (soft)")
    t.add_argument("--replay-tasks", default="ID,NEG,COUNT,MERGED", help="tasks kept from the 2nd and later data dirs")
    g = sub.add_parser("gguf")
    g.add_argument("--run", required=True)
    g.add_argument("--out", required=True)
    c = sub.add_parser("agree")
    for k in ("base", "run", "data", "server"):
        c.add_argument("--" + k, required=True)
    c.add_argument("--n", type=int, default=24)
    c.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    {"data": cmd_data, "train": cmd_train, "gguf": cmd_gguf, "agree": cmd_agree}[a.cmd](a)


if __name__ == "__main__":
    main()
