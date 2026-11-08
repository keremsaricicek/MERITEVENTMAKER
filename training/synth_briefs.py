"""Turkish event briefs -> the planner's JSON (text-only training items for runB6c).

Each item is a brief written by a small grammar (numbers as digits or words,
missing Turkish letters, "180'lik", "10'ar", m2 / m² / metrekare, word order
shuffled, unstated fields left null) and its answer: the JSON shape that
`planner_brief_eval.py` asks for, every field present, null when not stated.
The 40 test briefs (`planner_briefs.jsonl`) were written by hand before this
generator and are never produced by it (checked: no generated text equals one).

    python -I training/synth_briefs.py --out DIR [--n 1500 --seed 64]

`--grammar 8` (runQ, training/README.md): grammar 1 plus thousands as words, briefs
split into short sentences, "Ø180" (round) and a diameter or "AxB" size with no kind
word (a diameter alone names no kind; "AxB" names rect, square when A = B), "150 lik",
numbers that are no field (garson, bar, saat, sahne 8x6), more event words; and a
stricter guard: no brief shares a six-word run with a test brief.
"""
import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from planner_brief_eval import FIELDS, SYSTEM  # noqa: E402

ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"]
TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"]
EVENT_WORDS = {"meeting": ["toplantı", "toplanti", "brifing", "basın toplantısı"],
               "banquet": ["banket", "şirket yemeği", "yemek", "doğum günü", "teşekkür yemeği", "iftar"],
               "gala": ["gala", "gala yemeği", "balo", "mezuniyet balosu", "ödül töreni"],
               "wedding": ["düğün", "dugun", "nişan", "kına gecesi", "nikah yemeği"],
               "theatre": ["tiyatro düzeni", "tiyatro tipi", "konferans", "panel", "seminer tiyatro oturma"],
               "classroom": ["sınıf düzeni", "sinif tipi", "eğitim", "workshop", "atölye"],
               "cocktail": ["kokteyl", "kokteyl prolonje", "lansman kokteyli", "resepsiyon"],
               "u_shape": ["U düzeni", "U masa", "u tipi toplantı"],
               "boardroom": ["yönetim kurulu toplantısı", "boardroom", "tek masa toplantı"]}
KIND_WORDS = {"round": ["yuvarlak", "yuvarlak masa"], "rect": ["dikdörtgen", "dikdörtgen masa"],
              "square": ["kare", "kare masa"], "bistro": ["bistro", "yüksek masa", "bistro masa"]}


def words(n):
    if n >= 1000:
        k, r = divmod(n, 1000)
        return ("bin" if k == 1 else words(k) + " bin") + (" " + words(r) if r else "")
    if n >= 100:
        h, r = divmod(n, 100)
        return ("yüz" if h == 1 else ONES[h] + " yüz") + (" " + words(r) if r else "")
    t, o = divmod(n, 10)
    return " ".join(x for x in (TENS[t], ONES[o]) if x)


def deturk(s):
    return s.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU"))


def num(rng, n):
    return words(n) if n <= 2000 and rng.random() < (0.4 if G8 and n >= 1000 else 0.12) else str(n)


def suffix_each(n):  # 10'ar, 8er, 6şar
    s = str(n)
    last = {"0": "ar", "1": "er", "2": "şer", "3": "er", "4": "er", "5": "er", "6": "şar", "7": "şer", "8": "er", "9": "ar"}[s[-1]]
    return s + (rng_choice(["'", ""]) + last)


_R = random.Random(0)
G8 = False
EVENT_WORDS_8 = {"banquet": ["akşam yemeği", "öğle yemeği", "kurum yemeği"], "gala": ["gala gecesi", "yılsonu galası", "ödül gecesi"],
                 "wedding": ["düğün yemeği", "evlilik yemeği", "nikah daveti"], "meeting": ["bilgilendirme toplantısı", "genel kurul"],
                 "cocktail": ["açılış kokteyli", "karşılama kokteyli"], "classroom": ["eğitim semineri sınıf düzeni", "kurs"]}
NOISE_8 = ["10 garson", "4 garson", "2 bar", "saat 20:00", "saat 19.30'da başlıyor", "sahne 8x6", "sahne 10x4 metre", "3 ikram noktası", "2 DJ kabini", "1 vestiyer", "fotoğraf köşesi"]


def rng_choice(xs):
    return _R.choice(xs)


def make(rng):
    global _R
    _R = rng
    want = {k: None for k in FIELDS}
    parts = []
    event = rng.choice(list(EVENT_WORDS))
    want["event"] = event
    pax = {"boardroom": rng.randint(6, 40), "u_shape": rng.randint(10, 60)}.get(event) or rng.choice([rng.randint(2, 30) * 10, rng.randint(12, 120), rng.randint(5, 120) * 10])
    want["pax"] = pax
    if G8 and rng.random() < 0.08:
        pax = rng.choice([1000, 1100, 1200, 1500, 1800, 2000])
        want["pax"] = pax
    ew = rng.choice(EVENT_WORDS[event] + (EVENT_WORDS_8.get(event, []) if G8 else []))
    if "tek masa" in ew:
        want["table_count"] = 1
    parts.append(rng.choice([f"{num(rng, pax)} kişilik {ew}", f"{ew} {num(rng, pax)} kişi", f"{num(rng, pax)} pax {ew}", f"{ew}, {num(rng, pax)} davetli"]))
    if rng.random() < 0.45:
        if rng.random() < 0.6:
            a = rng.randint(4, 120) * 10
            want["area_m2"] = a
            parts.append(rng.choice([f"{a} m2 salon", f"salon {a} m²", f"{a} metrekare alan", f"alan {a} m2"]))
        else:
            w, l = rng.randint(8, 30), rng.randint(10, 50)
            want["room_w_m"], want["room_l_m"] = w, l
            parts.append(rng.choice([f"salon {w}x{l} metre", f"salon {w} metreye {l} metre", f"{w}x{l} m salon"]))
    if event not in ("theatre", "u_shape") and want["table_count"] is None and rng.random() < (0.3 if event == "boardroom" else 0.7):
        kind = rng.choice({"cocktail": ["bistro"], "classroom": ["rect"], "boardroom": ["rect", None], "u_shape": [None]}.get(event, ["round", "round", "rect", "square", None]))
        cnt = (1 if event == "boardroom" else rng.randint(2, 120)) if rng.random() < 0.7 else None
        bits = []
        if cnt is not None:
            want["table_count"] = cnt
            bits.append(f"{num(rng, cnt)} {rng.choice(['', 'adet ', 'tane '])}")
        if kind:
            want["table_kind"] = kind
            if kind == "round" and rng.random() < 0.6:
                d = rng.choice([150, 160, 180, 200])
                want["table_diam_cm"] = d
                if G8 and rng.random() < 0.35:
                    if rng.random() < 0.5:
                        bits.append(rng.choice([f"Ø{d}", f"Ø {d}"]))  # the diameter sign names a round table
                    else:
                        bits.append(rng.choice([f"{d}'lik", f"{d}lik", f"{d} lik"]))  # a bare diameter names no kind
                        want["table_kind"] = None
                else:
                    bits.append(rng.choice([f"{d}'lik yuvarlak", f"{d} cm yuvarlak", f"Ø{d} yuvarlak", f"{d}lik yuvarlak"] + ([f"{d} lik yuvarlak"] if G8 else [])))
            elif kind in ("rect", "square") and rng.random() < 0.6:
                L, W = (rng.choice([120, 140]),) * 2 if kind == "square" else (rng.choice([160, 180, 200, 240]), rng.choice([60, 75, 80, 100]))
                want["table_len_cm"], want["table_wid_cm"] = L, W
                bits.append(f"{L}x{W}" if G8 and rng.random() < 0.4 else f"{KIND_WORDS[kind][0]} {L}x{W}")  # "AxB" names rect / square
            else:
                bits.append(rng.choice(KIND_WORDS[kind]))
        bits.append("masa" if not bits or not bits[-1].endswith("masa") else "")
        if cnt is not None or kind:
            parts.append(" ".join(b.strip() for b in bits if b.strip()))
        if rng.random() < 0.5:
            spt = rng.choice([2, 3, 4, 6, 8, 9, 10, 12])
            want["seats_per_table"] = spt
            parts.append(rng.choice([f"masalar {spt} kişilik", f"masa başı {spt}", f"{suffix_each(spt)} kişi", f"her masaya {spt} kişi"]))
    if rng.random() < 0.3:
        cw, cd = rng.choice([42, 44, 45, 46, 48, 50]), rng.choice([48, 50, 52, 55])
        want["chair_w_cm"], want["chair_d_cm"] = cw, cd
        parts.append(rng.choice([f"sandalye {cw}x{cd}", f"sandalye ölçüsü {cw}x{cd}", f"sandalye {cw}e {cd}", f"sandalyeler {cw} x {cd} cm"]))
    if rng.random() < 0.2:
        ek = rng.choice(["bistro", None])
        es = rng.choice([2, 4, None]) if ek else rng.choice([2, 4])
        want["extra_kind"], want["extra_seats"] = ek, es
        parts.append("kalanı " + " ".join(x for x in ((f"{es} kişilik" if es else ""), ("bistro" if ek else "")) if x) + rng.choice(["", " ile doldur", " olsun"]))
    if rng.random() < 0.15:
        parts.append(rng.choice(["sahne önü boş kalsın", "acil", "VIP masa sahneye yakın", "dans pisti var"]))
    if G8 and rng.random() < 0.3:
        parts.append(rng.choice(NOISE_8))
    rng.shuffle(parts) if rng.random() < 0.35 else None
    if G8 and rng.random() < 0.3:
        text = ". ".join(x[0].upper() + x[1:] for x in parts if x) + "."
    else:
        text = rng.choice([", ", ". ", " ", ", "]).join(parts)
    if rng.random() < 0.3:
        text = deturk(text)
    if rng.random() < 0.3:
        text = text[0].upper() + text[1:]
    return text, want


def fold(t):
    return " ".join("".join(c if c.isalnum() else " " for c in deturk(t.lower().replace("İ", "i"))).split())


def grams6(t):
    w = fold(t).split()
    return [" ".join(w[i:i + 6]) for i in range(len(w) - 5)]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True); p.add_argument("--n", type=int, default=1500); p.add_argument("--seed", type=int, default=64)
    p.add_argument("--grammar", default="1")
    a = p.parse_args()
    global G8
    G8 = a.grammar == "8"
    tests = {json.loads(l)["text"].strip().lower() for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "planner_briefs.jsonl"))}
    tfold = {fold(t) for t in tests}
    tgrams = {g for t in tests for g in grams6(t)}
    rng = random.Random(a.seed)
    os.makedirs(a.out, exist_ok=True)
    n = 0
    with open(os.path.join(a.out, "items.jsonl"), "w") as f:
        while n < a.n:
            text, want = make(rng)
            if text.strip().lower() in tests or (G8 and (fold(text) in tfold or set(grams6(text)) & tgrams)):
                continue
            f.write(json.dumps(dict(task="BRIEF", sub="brief", q=text, system=SYSTEM, truth=json.dumps(want, ensure_ascii=False, separators=(",", ":")),
                                    level=2, family="synth-brief", seed=a.seed, split="train", image=None), ensure_ascii=False) + "\n")
            n += 1
    print(n, "briefs")


if __name__ == "__main__":
    main()
