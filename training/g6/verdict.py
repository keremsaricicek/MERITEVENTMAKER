"""Verdict for runS + detector v5-s against the bars pre-registered in training/README.md (2026-11-08).
usage: python -I verdict.py OUT.json"""
import json, os, sys

S = "/tmp/claude-0/-home-user-MERITEVENTMAKER/7b41f49a-1109-57da-b022-838b2499b2be/scratchpad"
R = "/home/user/MERITEVENTMAKER"
O = S + "/g6/out"
EV = R + "/benchmarks/offline-intelligence/local-vlm-results"
rows_out, verdict = [], {}


def ld(p):
    return json.load(open(p)) if os.path.exists(p) else None


def row(group, name, value, bar, ok):
    rows_out.append(dict(group=group, name=name, value=value, bar=bar, ok=bool(ok) if ok is not None else None))
    return ok


# ---- detector -------------------------------------------------------------------------------
def pooled(run, s):
    d = ld(f"{R}/runs/{run}/eval-{s}.json")
    return d and d["pooled"]


def f1(p):
    return p["f1"]


det_ok = True
for st in ("G", "P"):
    b, c = pooled("v2ref-s", "exam-" + st), pooled("v5-s", "exam-" + st)
    if not (b and c):
        det_ok = row("detector", f"exam-{st}", "missing", "", False) and False
        continue
    def ph(p):
        fp = p["tables"]["fp"] + p["chairs"]["fp"]; tp = p["tables"]["tp"] + p["chairs"]["tp"]
        return round(fp / max(1, fp + tp), 4)
    det_ok &= row("detector", f"exam-{st} phantom rate (v2 {ph(b)})", ph(c), "< 0.03", ph(c) < 0.03)
    for k in ("tables", "chairs"):
        det_ok &= row("detector", f"exam-{st} {k} recall (v2 {b[k]['recall']})", c[k]["recall"], ">= v2 - 0.01", c[k]["recall"] >= b[k]["recall"] - 0.01)
        row("detector", f"exam-{st} {k} precision (v2 {b[k]['precision']})", c[k]["precision"], "reported", None)
    det_ok &= row("detector", f"exam-{st} F1 tables/chairs (v2 {f1(b['tables'])}/{f1(b['chairs'])})", f"{f1(c['tables'])}/{f1(c['chairs'])}", "one above v2",
                  f1(c["tables"]) > f1(b["tables"]) or f1(c["chairs"]) > f1(b["chairs"]))
for s in ("gen3val", "gen3heldout", "gen3blind", "gen3blind2", "g18val", "g10Lval"):
    b, c = pooled("v2ref-s", s), pooled("v5-s", s)
    if not (b and c):
        det_ok = row("detector", s, "missing", "", False) and False
        continue
    drops = [f"{k}.{m} {b[k][m]}->{c[k][m]}" for k in ("tables", "chairs") for m in ("precision", "recall") if c[k][m] <= b[k][m] - 0.01]
    if c["columns"]["recall"] <= b["columns"]["recall"] - 0.01:
        drops.append(f"columns.recall {b['columns']['recall']}->{c['columns']['recall']}")
    det_ok &= row("detector", f"{s} no drop >= 0.01", "; ".join(drops) or "none", "none", not drops)
for run in ("v2ref-s", "v5-s"):
    t = open(f"{R}/runs/{run}/baseline-compare.txt").read() if os.path.exists(f"{R}/runs/{run}/baseline-compare.txt") else ""
    ok = "exit 0" in t and "No regressions" in t
    r_ = row("detector", f"{run} real Golden+ORNEK vs BASELINE", t.strip().splitlines()[-2][:90] if t else "missing", "no regression", ok)
    if run == "v5-s":
        det_ok &= r_
g = {run: ld(f"{R}/runs/{run}/golden2-score.json") for run in ("v2ref-s", "v5-s")}
if all(g.values()):
    b, c = g["v2ref-s"], g["v5-s"]
    det_ok &= row("detector", f"Golden 2 (SEEN) tables found (v2 {b['tables']['found']})", c["tables"]["found"], ">= v2", c["tables"]["found"] >= b["tables"]["found"])
    det_ok &= row("detector", f"Golden 2 phantom tables (v2 {b['tables']['phantom']})", c["tables"]["phantom"], "<= v2", c["tables"]["phantom"] <= b["tables"]["phantom"])
    det_ok &= row("detector", f"Golden 2 chairs tied (v2 {b['chairsTied']['rightTable']})", c["chairsTied"]["rightTable"], ">= v2", c["chairsTied"]["rightTable"] >= b["chairsTied"]["rightTable"])
else:
    det_ok = row("detector", "Golden 2", "missing", "", False) and False
verdict["detector"] = bool(det_ok)


# ---- VLM ------------------------------------------------------------------------------------
def rows(p):
    d = ld(p)
    return [r for r in d["rows"] if "parsed2" in r] if d else None


acc = lambda xs: round(sum(r["parsed"] == r["truth"] for r in xs) / len(xs), 3) if xs else None
agreed = lambda r: r["parsed"] is not None and r["parsed"] == r["parsed2"]
aw = lambda xs: round(sum(agreed(r) and r["parsed"] != r["truth"] for r in xs) / len(xs), 3) if xs else None
T = lambda rs, task, f=lambda r: True: [r for r in rs if r["task"] == task and f(r)]


def new_questions(rs, tag):
    out = {}
    if not rs:
        return {"zone": False, "number": False, "chairs": False, "neg": False}
    Z = T(rs, "ZONE")
    zt = ["stage", "dancefloor", "bar", "entrance", "vip", "aisle"]
    ok = row(tag, "zone one-look accuracy", acc(Z), ">= 0.80", (acc(Z) or 0) >= 0.80)
    for st in ("G", "P"):
        a = acc(T(rs, "ZONE", lambda r: r["style"] == st))
        ok &= row(tag, f"zone accuracy style {st}", a, ">= 0.75", (a or 0) >= 0.75)
    for z in zt:
        xs = T(rs, "ZONE", lambda r: r["truth"] == z)
        ok &= row(tag, f"zone {z} (n={len(xs)})", acc(xs), ">= 0.70", (acc(xs) or 0) >= 0.70)
    ok &= row(tag, "zone agreed-wrong", aw(Z), "<= 0.05", aw(Z) is not None and aw(Z) <= 0.05)
    neg = T(rs, "ZONE", lambda r: r["truth"] in ("none", "seating"))
    claim = round(sum(agreed(r) and r["parsed"] in zt for r in neg) / len(neg), 3) if neg else None
    ok &= row(tag, f"zone claimed on none/seating (n={len(neg)})", claim, "<= 0.05", claim is not None and claim <= 0.05)
    out["zone"] = bool(ok)
    N = T(rs, "NUMBER")
    printed = [r for r in N if r["truth"] != "none"]
    two = [r for r in printed if r["sub"] == "two-line"]
    none_ = [r for r in N if r["truth"] == "none"]
    inv = round(sum(agreed(r) and r["parsed"] != "none" for r in none_) / len(none_), 3) if none_ else None
    ok = row(tag, f"number exact on printed (n={len(printed)})", acc(printed), ">= 0.85", (acc(printed) or 0) >= 0.85)
    ok &= row(tag, f"number two-line (n={len(two)})", acc(two), ">= 0.75", (acc(two) or 0) >= 0.75)
    ok &= row(tag, "number agreed-wrong", aw(N), "<= 0.03", aw(N) is not None and aw(N) <= 0.03)
    ok &= row(tag, f"number invented on none (n={len(none_)})", inv, "<= 0.03", inv is not None and inv <= 0.03)
    out["number"] = bool(ok)
    C = T(rs, "CHAIRS")
    over = round(sum(isinstance(r["parsed"], int) and r["parsed"] > r["truth"] for r in C) / len(C), 3) if C else None
    ok = row(tag, f"chairs accuracy (n={len(C)})", acc(C), ">= 0.80", (acc(C) or 0) >= 0.80)
    ok &= row(tag, "chairs over-count", over, "<= 0.10", over is not None and over <= 0.10)
    ok &= row(tag, "chairs agreed-wrong", aw(C), "<= 0.05", aw(C) is not None and aw(C) <= 0.05)
    out["chairs"] = bool(ok)
    Ng = T(rs, "NEG")
    fab = round(sum(agreed(r) and r["parsed"] != "nothing" for r in Ng) / len(Ng), 3) if Ng else None
    out["neg"] = bool(row(tag, f"phantom: agreed object on clutter (n={len(Ng)})", fab, "<= 0.03", fab is not None and fab <= 0.03))
    return out


verdict["runS-new"] = new_questions(rows(O + "/g6exam-S.json"), "runS exam (SYNTHETIC)")
new_questions(rows(O + "/g6exam-B6d.json"), "B6d exam (SYNTHETIC, reference)")

# regression on the existing tests, runS vs B6d's evidence rows
reg_ok = True
pairs = {"real": ("real-S", "v5-real-B6d"), "tuck2": ("tuck2-S", "v5-tuck2-B6d"), "blind4": ("blind4-S", "v5-blind4-B6d"), "s1": ("s1-S", "v5-s1-B6d")}
R_ = {k: (rows(f"{O}/{a}.json"), rows(f"{EV}/{b}.json")) for k, (a, b) in pairs.items()}
yes_on_no = lambda xs: round(sum(r["parsed"] == "yes" for r in xs) / len(xs), 3) if xs else None
for k in ("real", "tuck2"):
    c, b = R_[k]
    if not (c and b):
        reg_ok = row("regression", k, "missing", "", False) and False
        continue
    for task in ("ID", "CHAIRS", "MERGED", "SERVES"):
        if T(b, task):
            reg_ok &= row("regression", f"{k} {task} one-look (B6d {acc(T(b, task))})", acc(T(c, task)), ">= B6d - 0.03", acc(T(c, task)) >= acc(T(b, task)) - 0.03)
    if T(b, "NEG"):
        fb = round(sum(r["parsed"] not in (None, "nothing") for r in T(b, "NEG")) / len(T(b, "NEG")), 3)
        fc = round(sum(r["parsed"] not in (None, "nothing") for r in T(c, "NEG")) / len(T(c, "NEG")), 3)
        reg_ok &= row("regression", f"{k} NEG fabrication (B6d {fb})", fc, "<= B6d + 0.02", fc <= fb + 0.02)
    for task in ("MERGED", "SERVES"):
        nb, nc = T(b, task, lambda r: r["truth"] == "no"), T(c, task, lambda r: r["truth"] == "no")
        if nb:
            reg_ok &= row("regression", f"{k} {task} yes-on-no (B6d {yes_on_no(nb)})", yes_on_no(nc), "<= B6d + 0.02", yes_on_no(nc) <= yes_on_no(nb) + 0.02)
# merged, the shipped question
c_real, b_real = R_["real"]
c_v5 = R_["blind4"][0]
c_s1 = R_["s1"][0]
if c_real and c_v5 and c_s1 and b_real:
    M = lambda rs: T(rs, "MERGED")
    reg_ok &= row("merged", "V5 (blind4) accuracy", acc(M(c_v5)), ">= 0.85", acc(M(c_v5)) >= 0.85)
    reg_ok &= row("merged", "V5 yes-on-no", yes_on_no(T(c_v5, "MERGED", lambda r: r["truth"] == "no")), "<= 0.10", yes_on_no(T(c_v5, "MERGED", lambda r: r["truth"] == "no")) <= 0.10)
    reg_ok &= row("merged", "S1 accuracy", acc(M(c_s1)), ">= 0.85", acc(M(c_s1)) >= 0.85)
    nm = [r for r in M(c_s1) if r.get("sub") == "nearmiss"]
    reg_ok &= row("merged", f"S1 near-miss yes (n={len(nm)})", yes_on_no(nm), "<= 0.10", nm and yes_on_no(nm) <= 0.10)
    reg_ok &= row("merged", "real accuracy", acc(M(c_real)), ">= 0.85", acc(M(c_real)) >= 0.85)
    reg_ok &= row("merged", "real yes-on-no", yes_on_no(T(c_real, "MERGED", lambda r: r["truth"] == "no")), "<= 0.10", yes_on_no(T(c_real, "MERGED", lambda r: r["truth"] == "no")) <= 0.10)
    reg_ok &= row("merged", f"autoApply real agreed-wrong (n={len(M(c_real))}, B6d {aw(M(b_real))})", aw(M(c_real)), "<= 0.03, n>=30, <= B6d",
                  aw(M(c_real)) <= 0.03 and len(M(c_real)) >= 30 and aw(M(c_real)) <= aw(M(b_real)))
    reg_ok &= row("merged", "autoApply V5 agreed-wrong", aw(M(c_v5)), "<= 0.03", aw(M(c_v5)) <= 0.03)
else:
    reg_ok = row("merged", "benches", "missing", "", False) and False
verdict["runS-regression"] = bool(reg_ok)
json.dump({"verdict": verdict, "rows": rows_out}, open(sys.argv[1], "w"), indent=1)
for r in rows_out:
    print(f"{'PASS' if r['ok'] else ('----' if r['ok'] is None else 'FAIL')} | {r['group']} | {r['name']} | {r['value']} | {r['bar']}")
print(verdict)
