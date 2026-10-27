"""Can the local model turn a Turkish event brief into numbers? (AI planner, step 0)

Asks a llama-server (base model, optionally with a LoRA) to read each brief in
`training/planner_briefs.jsonl` and answer in a fixed JSON shape (schema-
constrained, temperature 0, thinking off). Scores every field the brief states
(`want`): exact match. A field the brief does not state but the model filled is
counted as "invented". Also asks a few everyday chat prompts and stores the
answers as written, for a person to read (not scored).

    python -I training/planner_brief_eval.py --server LLAMA_SERVER --model MODEL.gguf [--lora A.gguf] --out OUT.json
"""
import argparse
import json
import os
import subprocess
import time
import urllib.request

EVENTS = ["meeting", "banquet", "gala", "wedding", "theatre", "classroom", "cocktail", "u_shape", "boardroom"]
KINDS = ["round", "rect", "square", "bistro"]
NUM = ["pax", "area_m2", "room_w_m", "room_l_m", "table_count", "table_diam_cm", "table_len_cm", "table_wid_cm",
       "seats_per_table", "chair_w_cm", "chair_d_cm", "extra_seats"]
FIELDS = NUM + ["event", "table_kind", "extra_kind"]
SCHEMA = {"type": "object", "additionalProperties": False, "required": FIELDS, "properties": {
    **{k: {"type": ["integer", "null"]} for k in NUM},
    "event": {"enum": EVENTS + [None]}, "table_kind": {"enum": KINDS + [None]},
    "extra_kind": {"enum": ["bistro", "cocktail", None]}}}
SYSTEM = ("Sen bir etkinlik planlama asistanısın. Kullanıcının yazdığı etkinlik tarifini oku ve SADECE JSON ver. "
          "Yazılmayan her alan null olsun; tahmin etme. pax = kişi sayısı. area_m2 = salon alanı. room_w_m/room_l_m = salonun "
          "eni ve boyu (metre). event: meeting=toplantı, banquet=yemek/banket/şirket yemeği/doğum günü, gala=gala/balo, "
          "wedding=düğün/nişan/kına/nikah, theatre=tiyatro/konferans oturma, classroom=sınıf/eğitim/workshop, "
          "cocktail=kokteyl, u_shape=U düzeni, boardroom=yönetim kurulu/tek masa toplantı. table_kind: round=yuvarlak, "
          "rect=dikdörtgen, square=kare, bistro=bistro/yüksek masa. Ölçüler cm (180'lik = 180). seats_per_table = masa başı "
          "kişi. extra_kind/extra_seats = 'kalanı ...' ile istenen ek masa türü ve kişi sayısı.")
CHAT = ["Merhaba, nasılsın?", "Bugün çok yoğunum, 3 etkinliğim var. Bana kısa bir moral ver.",
        "Gala ile banket arasındaki fark ne?", "100 kişilik bir düğün için kaç tane 10 kişilik masa gerekir?",
        "Yarın bana hatırlat: saat 10'da salon keşfi var.", "Kokteylde kişi başı kaç metrekare ayırmalıyım?",
        "Sandalyeler masanın altına itilmiş görünüyorsa planda nasıl anlarım?", "Teşekkürler, iyi akşamlar!"]


def post(port, messages, schema=None, max_tokens=300):
    body = {"messages": messages, "temperature": 0, "max_tokens": max_tokens, "cache_prompt": False,
            "chat_template_kwargs": {"enable_thinking": False}}
    if schema:
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": "brief", "schema": schema}}
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        out = json.loads(r.read())
    return out["choices"][0]["message"].get("content") or "", time.time() - t0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--server", required=True); p.add_argument("--model", required=True); p.add_argument("--lora")
    p.add_argument("--briefs", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "planner_briefs.jsonl"))
    p.add_argument("--out", required=True); p.add_argument("--port", type=int, default=8099); p.add_argument("--threads", type=int, default=4)
    a = p.parse_args()
    cmd = [a.server, "-m", a.model, "-c", "4096", "-t", str(a.threads), "-np", "1", "--cache-ram", "0",
           "--host", "127.0.0.1", "--port", str(a.port)] + (["--lora", a.lora] if a.lora else [])
    log = open(a.out + ".server.log", "w")
    proc = subprocess.Popen(cmd, stdout=log, stderr=log)
    try:
        for _ in range(600):
            try:
                if b"ok" in urllib.request.urlopen(f"http://127.0.0.1:{a.port}/health", timeout=5).read(): break
            except Exception:
                time.sleep(2)
        rows, right, total, invented, offered = [], 0, 0, 0, 0
        for line in open(a.briefs):
            b = json.loads(line)
            text, dt = post(a.port, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": b["text"]}], SCHEMA)
            try: got = json.loads(text)
            except Exception: got = {}
            per = {k: got.get(k) == v for k, v in b["want"].items()}
            inv = [k for k in FIELDS if k not in b["want"] and got.get(k) is not None]
            right += sum(per.values()); total += len(per); invented += len(inv); offered += len(FIELDS) - len(b["want"])
            rows.append(dict(id=b["id"], text=b["text"], want=b["want"], got=got, wrong=[k for k, ok in per.items() if not ok],
                             invented=inv, allRight=all(per.values()), seconds=round(dt, 2)))
        chat = []
        for q in CHAT:
            text, dt = post(a.port, [{"role": "user", "content": q}], None, 200)
            chat.append(dict(q=q, a=text, seconds=round(dt, 2)))
        s = dict(briefs=len(rows), fieldsRight=round(right / total, 3), briefsAllRight=round(sum(r["allRight"] for r in rows) / len(rows), 3),
                 inventedRate=round(invented / offered, 3), medianSeconds=sorted(r["seconds"] for r in rows)[len(rows) // 2],
                 model=os.path.basename(a.model), lora=os.path.basename(a.lora) if a.lora else None)
        json.dump(dict(summary=s, rows=rows, chat=chat), open(a.out, "w"), ensure_ascii=False, indent=1)
        print(json.dumps(s))
    finally:
        proc.terminate(); proc.wait()


if __name__ == "__main__":
    main()
