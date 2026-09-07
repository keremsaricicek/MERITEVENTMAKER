// Reading the number printed inside each table symbol.
//
// On a symbolic plan the number IS the table's identity — it is what the
// operator says on the radio, what the guest list refers to, and what survives
// a re-import. So a wrong number is far worse than no number, and everything
// here is built around that asymmetry.
//
// ---- what was measured, on ORNEK's 153 annotated numbers -------------------
//
// A montage was tried first, because 163 engine calls sounded unaffordable:
// every table's crop tiled onto one sheet, read in a single call, each word
// mapped back to the tile its box lands in. It is fast and it is wrong —
// the engine's layout analysis runs across tile boundaries:
//
//   montage, 64px tiles   1 call, 3.8s, precision 0.755   (89->8, 105->107)
//   montage, 96px tiles   1 call, 6.5s, precision 0.506   (10->6, 90->9)
//
// Per-table calls turned out to cost almost nothing anyway — a warm worker
// reads a 150px crop in about 25ms, so all 163 take a few seconds — and they
// are far more accurate. The montage was abandoned on that measurement.
//
// One crop per table is still not enough:
//
//   inset 0.18, x3   read 109  right 92  precision 0.844
//   inset 0.18, x4   read 105  right 91  precision 0.867
//   inset 0.28, x4   read  98  right 88  precision 0.898
//   inset 0.28, x6   read  99  right 83  precision 0.838
//
// The failures are all the same shape — a digit lost off the end: 104 -> 10,
// 118 -> 11, 157 -> 15. Nothing about a single reading says which of those
// happened, so no confidence threshold rescues it.
//
// ---- the rule this module is built on --------------------------------------
//
// Two crops that look at DIFFERENT AMOUNTS of the symbol, agreeing:
//
//   inset 0.18 x4  +  inset 0.28 x4     agree 87, right 87, PRECISION 1.000
//                                       conflicts 0
//   read by only one of the two         29 readings, right 5, precision 0.172
//
// Two things follow, and both are load-bearing.
//
// AGREEMENT IS THE EVIDENCE, NOT CONFIDENCE. Two independent crops losing the
// same digit in the same way does not happen; two crops both reading 137 means
// the symbol says 137.
//
// THE VARIANTS MUST DIFFER IN WHAT THEY SEE, NOT JUST IN RESOLUTION. Pairs that
// differ only in scale agree far more often and are wrong more often
// (0.18x3 + 0.18x4: 99 agreeing, precision 0.909). Two views of the same crop
// share its mistakes; two different crops do not.
//
// A READING ONLY ONE VARIANT SAW IS USUALLY WRONG — precision 0.172, measured.
// It is offered to the operator as something to check, never as a number the
// system claims.
(function () {
  "use strict";

  // Two crops of the same symbol, differing in how much of it they include.
  // Chosen by the measurement above, not by taste.
  const VIEWS = [
    { id: "inset-18-x4", inset: 0.18, scale: 4, stretch: true },
    { id: "inset-28-x4", inset: 0.28, scale: 4, stretch: true },
  ];

  // A table number is a small integer. Three digits covers every seating plan
  // this product has met; anything longer is a dimension, a date or a capacity
  // figure that has strayed into the crop.
  const NUMBER_PATTERN = /^[0-9]{1,3}$/;

  const STATES = { VERIFIED: "VERIFIED", LIKELY: "LIKELY", NEEDS_REVIEW: "NEEDS_REVIEW", UNKNOWN: "UNKNOWN" };

  // Pull the single number out of one crop's reading.
  //
  // "Single" is the point: a crop that yields two separate digit runs has read
  // the number and something else — a neighbouring symbol that crept into the
  // frame, a dimension tick — and there is no way to tell which is which. Two
  // candidates is not a number, it is an ambiguity, and it is reported as one.
  function numberFromResult(result) {
    if (!result || !result.available) return null;
    const found = [];
    for (const w of (result.words || [])) {
      const text = String(w.text || "").trim();
      if (!NUMBER_PATTERN.test(text)) continue;
      found.push({ value: Number(text), confidence: Math.round(w.confidence || 0) });
    }
    if (found.length !== 1) return null;
    return found[0];
  }

  // Read one table's number from its own symbol.
  async function readOne(runOCR, labelOCR, image, box, options) {
    const opts = options || {};
    const views = opts.views || VIEWS;
    const readings = [];
    for (const view of views) {
      const crops = labelOCR.cropVariants(image, box, {
        variants: [{ id: view.id, scale: view.scale, stretch: view.stretch }],
        // Negative padding crops INTO the symbol, so its own ring does not
        // become a character. Each view keeps a different amount of it.
        padAlong: -view.inset,
        padAcrossOfLong: -view.inset,
      });
      if (!crops.length) { readings.push({ view: view.id, value: null, reason: "too small to read" }); continue; }
      let result = null;
      try {
        result = await runOCR(crops[0].dataUrl, { timeoutMs: opts.timeoutMs || 15000 });
      } catch (error) {
        readings.push({ view: view.id, value: null, reason: error && error.message ? error.message : String(error) });
        continue;
      }
      const hit = numberFromResult(result);
      readings.push({ view: view.id, value: hit ? hit.value : null, confidence: hit ? hit.confidence : null });
    }
    return classify(readings);
  }

  // Turn what the views saw into one of the four states an operator understands.
  //
  // LIKELY is deliberately NOT produced here. On the measurement above, a
  // number only one view saw is right 17% of the time — calling that "likely"
  // would be a lie told in the product's own vocabulary. LIKELY is reserved for
  // a reading corroborated from somewhere else (verified layout memory, or a
  // person), which is a different evidence source and belongs to a later layer.
  function classify(readings) {
    const seen = readings.filter((r) => r.value != null);
    const values = [...new Set(seen.map((r) => r.value))];
    if (!seen.length) {
      return { value: null, state: STATES.UNKNOWN, confidence: null, readings,
        why: "no view of this symbol produced a number" };
    }
    if (values.length === 1 && seen.length >= 2) {
      return { value: values[0], state: STATES.VERIFIED,
        confidence: Math.max(...seen.map((r) => r.confidence || 0)), readings,
        why: `${seen.length} independent crops of this symbol read the same number` };
    }
    if (values.length > 1) {
      return { value: null, state: STATES.NEEDS_REVIEW, confidence: null, readings,
        why: `crops of this symbol disagree: ${values.join(" and ")}` };
    }
    return { value: null, state: STATES.NEEDS_REVIEW, confidence: seen[0].confidence ?? null,
      readings, suggestion: seen[0].value,
      why: "only one crop of this symbol produced a number, and a single reading is measured right 17% of the time" };
  }

  // Read a whole plan's tables. Sequential rather than parallel: the engine is
  // one worker, and queueing 163 recognitions at once only moves the wait.
  async function readTableNumbers(runOCR, labelOCR, image, tables, options) {
    const opts = options || {};
    const out = new Map();
    const counts = { VERIFIED: 0, LIKELY: 0, NEEDS_REVIEW: 0, UNKNOWN: 0 };
    for (const table of tables) {
      const r = await readOne(runOCR, labelOCR, image, table, opts);
      out.set(table.id, r);
      counts[r.state]++;
      if (typeof opts.onProgress === "function") opts.onProgress(out.size, tables.length);
    }
    return { byId: out, counts, views: (opts.views || VIEWS).map((v) => v.id) };
  }

  globalThis.MeritTableNumbers = {
    version: 1,
    STATES,
    VIEWS,
    numberFromResult,
    classify,
    readOne,
    readTableNumbers,
  };
})();
