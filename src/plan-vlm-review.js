// MERIT Event Maker — reading a whole plan with a vision-language model, as rules (MeritVlmReview).
//
// The relay (server/vlm-relay.mjs) holds the key and builds the request; this
// module decides what the PAGE sends it and what the page does with the
// answer. A reading has two kinds of step: the WHOLE plan once ("overview"),
// then up to four zoomed REGIONS the model itself asked to look at more
// closely. Each answer is a list of FINDINGS — an object the detector missed,
// a detector object of the wrong type or not an object at all, a seat count, a
// printed number, a note — and every one of them is a suggestion a person
// accepts or dismisses. Nothing here writes to the analysis; the shell's
// existing writers do, one finding at a time, after a person pressed Accept.
//
// What is structural here, not promised:
//   ONLY THE PLAN TRAVELS. A payload is built from the analysis (boxes, types,
//     review status, a printed number, seats) and the plan's pixels. It is
//     never handed an event, so it has no path to a guest, a note, an inviter
//     or the event's name. The relay refuses any field it does not know.
//   THE PIXELS ARE THE COORDINATES. An image is sized within BOTH of the API's
//     limits (long edge and pixel count), so it is not resized on the way in
//     and a box the model reports is a pixel of the image that was sent; this
//     module maps it back to the plan exactly, region crops included.
//   AN ANSWER TO AN OLDER QUESTION IS REFUSED. Every step carries the run, the
//     analysis and the plan's fingerprint; an answer that arrives after a
//     re-analysis, a different plan, another event or a cancel is dropped whole
//     (staleReason), never merged.
//   ONE ACCEPT CHANGES ONE OBJECT. A type correction from a finding is applied
//     to the object it names and no other (spread:false): the person looked at
//     one suggestion, not at a family.
//   A FINDING ABOUT A DECIDED OBJECT IS NOT OFFERED. A person's confirmation or
//     rejection outranks the model; such a finding says so and has no Accept.
//
// Pure: no DOM, no state, no network. Published once on globalThis.
(function () {
  "use strict";

  const IMAGE_MAX_EDGE = 2576;          // the API's high-resolution long edge
  const IMAGE_MAX_PIXELS = 4784 * 750;  // its visual-token cap, as pixels
  const REGION_EDGE = 1536;             // a zoomed region is sent at up to this long edge
  const REGION_UPSCALE = 3;             // and enlarged at most this much
  const REGION_MIN_PCT = 12;            // a region is never narrower than this share of the plan
  const MAX_REGIONS = 4;
  const MAX_CANDIDATES = 400, MAX_PRINTED = 200;
  const KINDS = Object.freeze(["missing", "wrongType", "notAnObject", "seatCount", "printedNumber", "note"]);
  const TYPE_KIND = Object.freeze({ round: "table", square: "table", rectangle: "table", bistro: "table",
    chair: "venue", armchair: "venue", sofa: "venue", bench: "venue", banquette: "venue", loca: "venue", stage: "venue",
    bar: "venue", entrance: "venue", exit: "venue", column: "venue", text: "venue", other: "venue" });
  const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

  // The size an image is sent at: within both API limits, never enlarged
  // beyond `upscale`, never below 16 px.
  function fitSize(w, h, opts) {
    const o = opts || {}, maxEdge = o.maxEdge || IMAGE_MAX_EDGE, upscale = o.upscale || 1;
    if (!(w > 0 && h > 0)) return null;
    let s = Math.min(maxEdge / Math.max(w, h), Math.sqrt(IMAGE_MAX_PIXELS / (w * h)), upscale);
    let width = Math.max(16, Math.floor(w * s)), height = Math.max(16, Math.floor(h * s));
    while (width * height > IMAGE_MAX_PIXELS || Math.max(width, height) > IMAGE_MAX_EDGE) { s *= 0.99; width = Math.floor(w * s); height = Math.floor(h * s); }
    return { width, height, scale: s };
  }

  // A FRAME is the part of the plan an image shows, in plan-percent:
  // { x, y, w, h }. The whole plan is { x:0, y:0, w:100, h:100 }.
  const WHOLE = Object.freeze({ x: 0, y: 0, w: 100, h: 100 });
  const toPx = (box, frame, size) => [
    (box.x - frame.x) / frame.w * size.width, (box.y - frame.y) / frame.h * size.height,
    (box.x + box.w - frame.x) / frame.w * size.width, (box.y + box.h - frame.y) / frame.h * size.height,
  ];
  const toPct = (px, frame, size) => ({
    x: frame.x + px[0] / size.width * frame.w, y: frame.y + px[1] / size.height * frame.h,
    w: (px[2] - px[0]) / size.width * frame.w, h: (px[3] - px[1]) / size.height * frame.h,
  });
  const round1 = (n) => Math.round(n * 10) / 10;
  const round2 = (n) => Math.round(n * 100) / 100;
  const clampBox = (b, size) => [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(size.width, b[2]), Math.min(size.height, b[3])].map(round1);
  function overlapShare(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return a.w * a.h > 0 ? ix * iy / (a.w * a.h) : 0;
  }
  function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy, union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  }

  // What the page sends about the analysis: each detector object inside the
  // frame, by a short ref the model answers with. Refs map back to candidate
  // ids here and only here, so no id the app uses ever leaves the page.
  function candidatesPayload(analysis, frame, size) {
    const refs = {}, list = [];
    for (const c of (analysis && analysis.candidates) || []) {
      if (list.length >= MAX_CANDIDATES) break;
      if (!(c.w > 0 && c.h > 0) || overlapShare(c, frame) < 0.5) continue;
      const box = clampBox(toPx(c, frame, size), size);
      if (!(box[0] < box[2] && box[1] < box[3])) continue;
      const ref = "c" + (list.length + 1);
      refs[ref] = c.id;
      const pn = c.printedNumber;
      list.push({ ref, kind: c.kind === "venue" ? "venue" : "table", type: /^[a-z_]{1,24}$/.test(c.type || "") ? c.type : "other", box,
        status: ["unreviewed", "confirmed", "rejected"].includes(c.status) ? c.status : "unreviewed",
        seats: Number.isInteger(c.seats) && c.seats >= 0 && c.seats <= 99 ? c.seats : null,
        number: pn && pn.state === "VERIFIED" && /^[A-Za-z0-9 ._-]{1,12}$/.test(String(pn.value)) ? String(pn.value) : null,
        heldBack: c.lowEvidence === true });
    }
    return { candidates: list, refs };
  }

  // Text the OCR model read off the plan, as data, inside the frame.
  function printedTextPayload(analysis, frame, size) {
    const m = analysis && analysis.ocrModel, out = [];
    if (!m || !m.available || !m.imageSize || !Array.isArray(m.items)) return out;
    const W = m.imageSize.width, H = m.imageSize.height;
    for (const it of m.items) {
      if (out.length >= MAX_PRINTED) break;
      const text = String(it.text || "").trim();
      if (!text || !(it.score >= 0.8) || !it.box) continue;
      const pct = { x: it.box.x0 / W * 100, y: it.box.y0 / H * 100, w: (it.box.x1 - it.box.x0) / W * 100, h: (it.box.y1 - it.box.y0) / H * 100 };
      if (overlapShare(pct, frame) < 0.5) continue;
      const box = clampBox(toPx(pct, frame, size), size);
      if (box[0] < box[2] && box[1] < box[3]) out.push({ text: text.slice(0, 80), box });
    }
    return out;
  }

  // The body of one /vlm-relay/run request. `image` is { mediaType, data,
  // width, height } as encoded by the caller from exactly `frame`.
  function payloadFor({ analysis, planHash, runId, step, lang, frame, image, reason }) {
    const size = { width: image.width, height: image.height };
    const { candidates, refs } = candidatesPayload(analysis, frame, size);
    const body = { runId, step, analysisId: analysis.id, planHash: planHash || null, lang: lang === "tr" ? "tr" : "en",
      image: { mediaType: image.mediaType, data: image.data, width: image.width, height: image.height },
      candidates, printedText: printedTextPayload(analysis, frame, size) };
    if (step === "region") body.region = { reason: String(reason || "").slice(0, 200) };
    return { body, refs };
  }

  // A region the model asked to inspect, as a frame on the plan: its box from
  // the overview image, padded, at least REGION_MIN_PCT wide and tall.
  function regionFrame(boxPx, size) {
    const p = toPct(boxPx, WHOLE, size);
    const padX = p.w * 0.1 + 1, padY = p.h * 0.1 + 1;
    let w = Math.max(REGION_MIN_PCT, p.w + 2 * padX), h = Math.max(REGION_MIN_PCT, p.h + 2 * padY);
    w = Math.min(100, w); h = Math.min(100, h);
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const x = Math.min(100 - w, Math.max(0, cx - w / 2)), y = Math.min(100 - h, Math.max(0, cy - h / 2));
    return { x: round1(x), y: round1(y), w: round1(w), h: round1(h) };
  }

  // Findings from one step, in plan-percent, each tied to the candidate its
  // ref named. A ref the page did not send cannot appear (the relay drops it).
  function findingsFrom(result, { refs, frame, size, step, regionIndex, idPrefix }) {
    const out = [];
    (result && result.findings || []).forEach((f, i) => {
      if (!KINDS.includes(f.kind)) return;
      const candidateId = f.ref && Object.prototype.hasOwnProperty.call(refs, f.ref) ? refs[f.ref] : null;
      if (f.ref && !candidateId) return;
      const box = Array.isArray(f.box) ? toPct(f.box, frame, size) : null;
      out.push({ id: `${idPrefix || "vf"}-${step}${regionIndex != null ? regionIndex + 1 : ""}-${i + 1}`, step, regionIndex: regionIndex ?? null,
        kind: f.kind, candidateId, type: TYPE_KIND[f.type] ? f.type : null,
        box: box ? { x: round2(box.x), y: round2(box.y), w: round2(box.w), h: round2(box.h) } : null,
        value: Number.isInteger(f.value) ? f.value : null, confidence: CONFIDENCE_RANK[f.confidence] ? f.confidence : "low",
        evidence: String(f.evidence || "").slice(0, 300), state: "open" });
    });
    return out;
  }

  // One list, without the same suggestion twice. A zoomed look at a region
  // is the better look: on a tie it replaces the overview's finding.
  function mergeFindings(existing, incoming) {
    const out = existing.slice();
    const better = (a, b) => (CONFIDENCE_RANK[a.confidence] || 0) > (CONFIDENCE_RANK[b.confidence] || 0) || ((CONFIDENCE_RANK[a.confidence] || 0) === (CONFIDENCE_RANK[b.confidence] || 0) && a.step === "region");
    for (const f of incoming) {
      const i = out.findIndex(o => o.state === "open" && o.kind === f.kind && (f.candidateId ? o.candidateId === f.candidateId
        : !o.candidateId && o.box && f.box && iou(o.box, f.box) >= 0.5 && TYPE_KIND[o.type] === TYPE_KIND[f.type]));
      if (i < 0) out.push(f);
      else if (better(f, out[i])) out[i] = f;
    }
    return out;
  }

  // Whether an answer still belongs to what is on the screen.
  function staleReason(run, response, current) {
    if (!run || !response) return "NO_RUN";
    if (response.runId !== run.runId) return "OTHER_RUN";
    if (run.status === "cancelled") return "CANCELLED";
    if (!current || current.eventId !== run.eventId) return "EVENT_CHANGED";
    if (!current.analysisId || current.analysisId !== run.analysisId || response.analysisId !== run.analysisId) return "ANALYSIS_CHANGED";
    if ((current.planHash || null) !== (run.planHash || null) || (response.planHash || null) !== (run.planHash || null)) return "PLAN_CHANGED";
    return null;
  }

  // What Accept would do with a finding, against the analysis as it is NOW.
  //   { ok:true, action:"add", candidate }               an object the detector missed
  //   { ok:true, action:"decide", decision }             through decideReview, one object
  //   { ok:true, action:"seats", candidateId, value }    a seat count, the typed-count writer
  //   { ok:false, reason }                               shown on the disabled control
  // printedNumber and note are never applied: a verified printed number is an
  // identity (layout changes and venue lessons key on it) and only a reading
  // or a person typing it may set one; a note is information.
  function acceptPlan(finding, analysis) {
    if (!finding || finding.state !== "open") return { ok: false, reason: "DONE" };
    const byId = new Map(((analysis && analysis.candidates) || []).map(c => [c.id, c]));
    if (finding.kind === "missing") {
      if (!finding.box || !TYPE_KIND[finding.type]) return { ok: false, reason: "INCOMPLETE" };
      const covered = [...byId.values()].some(c => c.status !== "rejected" && (iou(c, finding.box) >= 0.4 || overlapShare(finding.box, c) >= 0.8));
      if (covered) return { ok: false, reason: "COVERED" };
      return { ok: true, action: "add", candidate: { kind: TYPE_KIND[finding.type], type: finding.type, ...finding.box } };
    }
    if (finding.kind === "note") return { ok: false, reason: "INFORMATION" };
    if (finding.kind === "printedNumber") return { ok: false, reason: "NUMBER_NOT_APPLIED" };
    const c = byId.get(finding.candidateId);
    if (!c) return { ok: false, reason: "GONE" };
    if (finding.kind === "seatCount") {
      if (!Number.isInteger(finding.value) || finding.value < 0 || finding.value > 99) return { ok: false, reason: "INCOMPLETE" };
      if (c.status === "rejected") return { ok: false, reason: "ALREADY_DECIDED" };
      if (c.seats === finding.value) return { ok: false, reason: "ALREADY_SO" };
      return { ok: true, action: "seats", candidateId: c.id, value: finding.value };
    }
    if (c.status !== "unreviewed") return { ok: false, reason: "ALREADY_DECIDED" };
    if (finding.kind === "notAnObject") return { ok: true, action: "decide", decision: { kind: "reject", candidateId: c.id, via: "vlm" } };
    if (finding.kind === "wrongType") {
      if (!TYPE_KIND[finding.type]) return { ok: false, reason: "INCOMPLETE" };
      if (c.type === finding.type && c.kind === TYPE_KIND[finding.type]) return { ok: false, reason: "ALREADY_SO" };
      return { ok: true, action: "decide", decision: { kind: "reclassify", candidateId: c.id, to: { kind: TYPE_KIND[finding.type], type: finding.type }, spread: false, via: "vlm" } };
    }
    return { ok: false, reason: "INFORMATION" };
  }

  function counts(run) {
    const f = (run && run.findings) || [];
    return { total: f.length, open: f.filter(x => x.state === "open").length, accepted: f.filter(x => x.state === "accepted").length,
      dismissed: f.filter(x => x.state === "dismissed").length, missing: f.filter(x => x.kind === "missing").length };
  }

  // A run id the relay accepts: 24 random hex characters.
  function newRunId(randomBytes) {
    const b = randomBytes(12);
    return "run_" + Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  }

  globalThis.MeritVlmReview = Object.freeze({
    IMAGE_MAX_EDGE, IMAGE_MAX_PIXELS, REGION_EDGE, REGION_UPSCALE, MAX_REGIONS, KINDS, TYPE_KIND, WHOLE,
    fitSize, candidatesPayload, printedTextPayload, payloadFor, regionFrame, findingsFrom, mergeFindings,
    staleReason, acceptPlan, counts, newRunId, iou,
  });
})();
