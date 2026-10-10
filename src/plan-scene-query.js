// MERIT Event Maker — questions about the plan (MeritSceneQuery).
//
// "Show the tables with no number read", "mark the boxes next to the stage":
// a CLOSED set of questions, each a rule over the analysis the review screen
// already holds. A sentence is matched to one of them by its words, in
// Turkish or English; a sentence that matches none is answered with the
// questions this build can answer, never with a guess. Nothing here decides
// or changes anything: the answer is a list of objects, which the review
// screen opens as a queue so a person can step through them, one click each.
//
// "Next to" is measured, not inferred: the gap between an object's box and
// the stage's box, in the plan's own pixels, within one and a half of that
// kind's typical size. There is no claim about what a person would call
// "next to"; the rule and its reach are stated with the answer.
//
// Pure: no DOM, no state. Published once on globalThis.
(function () {
  "use strict";

  const QUESTIONS = Object.freeze(["unnumbered", "duplicateNumbers", "nearStage", "noChairs", "heldBack", "unreviewed"]);
  const TYPES = Object.freeze({
    loca: ["loca", "locas", "localar", "localari", "loge", "box", "boxes"],
    bar: ["bar", "bars", "barlar", "barlari"],
    chair: ["chair", "chairs", "sandalye", "sandalyeler", "sandalyeleri"],
    table: ["table", "tables", "masa", "masalar", "masalari"],
  });
  const REACH = 1.5;

  // Lower case, Turkish-aware, accents folded: "Sahnenin yanındaki LOCALAR"
  // and "sahnenin yanindaki localar" are the same sentence.
  const fold = (s) => String(s || "").slice(0, 300).toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

  function parse(text) {
    const s = " " + fold(text) + " ";
    const has = (...w) => w.some((x) => s.includes(x));
    const word = (list) => list.some((x) => new RegExp(`(^|[^a-z])${x}([^a-z]|$)`).test(s));
    if (!s.trim()) return null;
    if (has("sahne", "stage") && has("yan", "yakin", "near", "next to", "beside", "around", "cevres", "dibinde")) {
      const type = Object.keys(TYPES).find((k) => word(TYPES[k])) || null;
      return { id: "nearStage", type };
    }
    if (has("ayni numara", "tekrar eden", "cift numara", "duplicate", "same number", "shared number", "sharing a number")) return { id: "duplicateNumbers" };
    if (has("numara", "number") && has("okunmayan", "okunamayan", "olmayan", "yok", "eksik", "without", "no number", "unread", "not read", "missing")) return { id: "unnumbered" };
    if (has("sandalye", "chair") && has("olmayan", "yok", "siz ", "without", "no chair", "missing")) return { id: "noChairs" };
    if (has("geri tutul", "held back", "held-back", "holdback", "gizlenen")) return { id: "heldBack" };
    if (has("incelenmemis", "incelenmeyen", "bekleyen", "unreviewed", "not reviewed", "not yet reviewed")) return { id: "unreviewed" };
    return null;
  }

  const isType = (c, type) => type === "table" ? c.kind === "table"
    : type === "chair" ? c.kind === "chair" || (c.kind === "venue" && c.type === "chair")
    : c.type === type;
  const verified = (c) => !!(c.printedNumber && c.printedNumber.state === "VERIFIED" && c.printedNumber.value != null);

  // The answer: { ok:true, id, type, ids, reach } or { ok:false, reason }.
  // `size` is the analysed image in pixels, so a gap is measured in one unit
  // on both axes (plan-percent is not square).
  function run(text, analysis, size) {
    const q = parse(text);
    if (!q) return { ok: false, reason: "UNKNOWN_QUESTION", questions: QUESTIONS };
    const all = (analysis && Array.isArray(analysis.candidates)) ? analysis.candidates : null;
    if (!all) return { ok: false, reason: "NO_ANALYSIS", id: q.id };
    const live = all.filter((c) => c && c.status !== "rejected");
    const tables = live.filter((c) => c.kind === "table");
    let ids = [], reach = null;
    if (q.id === "unnumbered") ids = tables.filter((c) => !verified(c)).map((c) => c.id);
    else if (q.id === "duplicateNumbers") {
      const by = new Map();
      for (const c of tables) if (verified(c)) { const k = String(c.printedNumber.value); by.set(k, [...(by.get(k) || []), c.id]); }
      ids = [...by.values()].filter((l) => l.length > 1).flat();
    } else if (q.id === "noChairs") ids = tables.filter((c) => !(c.chairDetections || []).length).map((c) => c.id);
    else if (q.id === "heldBack") ids = live.filter((c) => c.status === "unreviewed" && (c.lowEvidence || c.selected === false)).map((c) => c.id);
    else if (q.id === "unreviewed") ids = live.filter((c) => c.status === "unreviewed").map((c) => c.id);
    else if (q.id === "nearStage") {
      const W = size && size.width > 0 ? size.width : 100, H = size && size.height > 0 ? size.height : 100;
      const px = (c) => ({ x0: c.x / 100 * W, y0: c.y / 100 * H, x1: (c.x + c.w) / 100 * W, y1: (c.y + c.h) / 100 * H });
      const stages = live.filter((c) => c.type === "stage");
      if (!stages.length) return { ok: false, reason: "NO_STAGE", id: q.id, type: q.type };
      const pool = live.filter((c) => c.type !== "stage" && (q.type ? isType(c, q.type) : true));
      if (!pool.length) return { ok: true, id: q.id, type: q.type, ids: [], reach: null };
      const sides = pool.map((c) => { const b = px(c); return Math.min(b.x1 - b.x0, b.y1 - b.y0); }).sort((a, b) => a - b);
      reach = Math.round(REACH * sides[Math.floor(sides.length / 2)] * 10) / 10;
      const gap = (a, b) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
      ids = pool.map((c) => ({ id: c.id, g: Math.min(...stages.map((s) => gap(px(c), px(s)))) }))
        .filter((r) => r.g <= reach).sort((a, b) => a.g - b.g).map((r) => r.id);
    }
    return { ok: true, id: q.id, type: q.type || null, ids, reach };
  }

  globalThis.MeritSceneQuery = Object.freeze({ QUESTIONS, TYPES, REACH, parse, run, fold });
})();
