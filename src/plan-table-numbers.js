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
// AGREEMENT IS THE EVIDENCE, NOT CONFIDENCE. Two different crops losing the
// same digit in the same way is rare; two crops both reading 137 means the
// symbol says 137 — measured, precision 1.000 on 87 agreeing tables. They are
// still ONE source: the same image read by the same engine, so their agreement
// is consistency, not independent confirmation (MeritObservations counts them
// as one channel).
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
    { id: "inset-28-x4", inset: 0.28, scale: 4, stretch: true, tight: true },
  ];
  // A THREE-DIGIT NUMBER IS OFTEN DRAWN ON TWO LINES inside its circle — "10"
  // over "4" for 104 — because three digits do not fit across the symbol.
  // On ORNEK every one of the 58 numbers from 100 up is drawn that way, and
  // none was read (2026-10-04): the reader took two digit runs for an
  // ambiguity, and the tight view physically cannot contain both lines. When
  // a view finds two runs stacked one above the other, the number is read as
  // top-then-bottom, and the confirming view is a WIDER crop that can hold both
  // lines; the tight view is not evidence for a two-line number (it is kept in
  // the readings, marked, and left out of the vote).
  // Measured on ORNEK's detected boxes (30 two-line symbols, 2026-10-04):
  // inset 0.18 and 0.15 both read the two lines and, wherever both read a
  // two-line number, agreed only on the right one; 0.21 is a tie-breaker that
  // reads some symbols the others miss and disagrees where it is wrong; wider
  // crops (0.08, 0, -0.05) take in the ring and the neighbours and read noise.
  const STACKED_MIN_CONFIDENCE = 50;
  const STACKED_VIEWS = [
    { id: "inset-15-x4", inset: 0.15, scale: 4, stretch: true },
    { id: "inset-21-x4", inset: 0.21, scale: 4, stretch: true },
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
  //
  // Two refinements, both narrower than they look:
  //   - quotes and commas the engine glues to a digit run (“10, 10,) are not
  //     part of it; nothing else is stripped;
  //   - a run whose box touches the crop's LEFT or RIGHT edge is a piece of
  //     the symbol's ring or of a neighbour, not the number in the middle —
  //     when the crop's size is known, it is not counted. (Top and bottom are
  //     not filtered: a two-line number's lines sit close to both.)
  // Two runs are still an ambiguity UNLESS they are stacked: one wholly above
  // the other, horizontally overlapping, two digits at most on top and one
  // below. Then they are one number, top line first, and the reading says so.
  const STRIP = /^[“”"'‘’,.]+|[“”"'‘’,.]+$/g;
  function numberFromResult(result, crop) {
    if (!result || !result.available) return null;
    const found = [];
    for (const w of (result.words || [])) {
      const text = String(w.text || "").trim().replace(STRIP, "");
      if (!NUMBER_PATTERN.test(text)) continue;
      const b = w.bbox || null;
      if (crop && b && (b.x0 <= 1 || b.x1 >= crop.width - 1)) continue;
      found.push({ text, value: Number(text), confidence: Math.round(w.confidence || 0), bbox: b });
    }
    if (found.length === 1) {
      const b = found[0].bbox, yShare = crop && b ? ((b.y0 + b.y1) / 2) / crop.height : null;
      return { value: found[0].value, confidence: found[0].confidence, yShare, digits: found[0].text.length };
    }
    if (found.length === 2 && found.every(f => f.bbox)) {
      const [top, bottom] = [...found].sort((p, q) => p.bbox.y0 - q.bbox.y0);
      const overlapX = Math.min(top.bbox.x1, bottom.bbox.x1) - Math.max(top.bbox.x0, bottom.bbox.x0);
      const stacked = top.bbox.y1 <= bottom.bbox.y0 + 0.15 * (bottom.bbox.y1 - bottom.bbox.y0)
        && overlapX > 0 && top.text.length <= 2 && bottom.text.length === 1;
      if (stacked) return { value: Number(top.text + bottom.text), confidence: Math.min(top.confidence, bottom.confidence), stacked: true };
    }
    return null;
  }

  // Read one table's number from its own symbol.
  // THE OCR MODEL'S READING (plan-ocr-paddle.js, PP-OCRv4): the text a trained
  // detector + recognizer found inside this symbol in its one plan-wide read.
  // It is one view — same image, a different engine — and it votes only when
  // it can be trusted to be the whole number:
  //   - its own score is at least MODEL_MIN_SCORE, and
  //   - it is two lines, or one line sitting in the middle of the symbol: a
  //     single short line high in the symbol is often the top of two with the
  //     second unread (the model's one measured error on ORNEK, 135 read "13").
  // Against it, a Tesseract reading that is the top or bottom line of the
  // model's two-line reading is a fragment, not a disagreement. A Tesseract
  // two-line reading too weak to vote on its own (below 50) may vote when it
  // agrees with the model — two engines, not two crops of one.
  const MODEL_MIN_SCORE = 0.9;
  function modelVote(m) {
    if (!m || m.value == null || !(m.score >= MODEL_MIN_SCORE)) return null;
    const centred = m.yShare != null && m.yShare >= 0.3 && m.yShare <= 0.7;
    if (!(m.lines >= 2 || centred)) return null;
    return { view: "model:" + (m.provider || "ocr-model"), value: m.value, confidence: Math.round(m.score * 100), model: true, lines: m.lines,
      lineTexts: Array.isArray(m.lineTexts) ? m.lineTexts : null };
  }
  async function readOne(runOCR, labelOCR, image, box, options) {
    const opts = options || {};
    const model = opts.model ? modelVote(opts.model) : null;
    if (opts.model && !model) {
      // Recorded for the operator either way, never as a vote.
      opts.modelNote = { view: "model:" + (opts.model.provider || "ocr-model"), value: opts.model.value ?? null, text: opts.model.text ?? null,
        confidence: opts.model.score != null ? Math.round(opts.model.score * 100) : null, excluded: "the OCR model's reading is not trusted as the whole number here" };
    }
    if (model && !opts.views) {
      // The model has a number: one Tesseract crop agreeing is two views, and
      // the remaining crops are not needed.
      const first = await readViews(runOCR, labelOCR, image, box, [VIEWS[0]], opts);
      if (first[0].value === model.value) return classify([model, first[0]], [model, ...first]);
      const rest = await readViews(runOCR, labelOCR, image, box, VIEWS.slice(1), opts);
      return judge([...first, ...rest], model, runOCR, labelOCR, image, box, opts);
    }
    const readings = await readViews(runOCR, labelOCR, image, box, opts.views || VIEWS, opts);
    if (opts.modelNote) readings.push(opts.modelNote);
    // A two-line number shows itself either as two stacked runs, or as one
    // short run sitting in the upper part of its crop with the line below it
    // unread. Then the symbol is read again with the two-line views, the
    // tight view leaves the vote, and a reading that saw only the top line
    // (the prefix of a two-line reading, high in its crop) is kept as what it
    // is -- consistent, not a vote.
    const looksStacked = readings.some(r => r.stacked || (r.value != null && r.digits <= 2 && r.yShare != null && r.yShare < 0.4));
    if (!opts.views && looksStacked) {
      readings.push(...await readViews(runOCR, labelOCR, image, box, STACKED_VIEWS, opts));
      const twoLine = readings.filter(r => r.stacked).map(r => String(r.value));
      for (const r of readings) {
        if (r.tight) r.excluded = "too tight to hold a two-line number";
        // Two crops of one symbol share the engine and the pixels, so they can
        // share a misread: on ORNEK both two-line views read 138 as 132, the
        // weaker at confidence 47. A two-line reading below 50 is not a vote.
        // Set on ORNEK, the only two-line plan there is (27 right two-line
        // readings measured 28..96, the one wrong one 47); the number-integrity
        // layer is the second guard -- a misread lands on another table's
        // number and is reported as a duplicate.
        else if (r.stacked && (r.confidence || 0) < STACKED_MIN_CONFIDENCE) r.excluded = "a two-line reading below the confidence a vote needs";
        else if (!r.stacked && r.value != null && r.yShare != null && r.yShare < 0.4 && twoLine.some(v => v.startsWith(String(r.value)) && v !== String(r.value)))
          r.excluded = "read only the top line of a two-line number";
      }
      return classify(readings.filter(r => !r.excluded), readings);
    }
    return classify(readings.filter(r => !r.excluded), readings);
  }
  // Tesseract's readings judged together with the model's.
  async function judge(readings, model, runOCR, labelOCR, image, box, opts) {
    const looksStacked = model.lines >= 2 || readings.some(r => r.stacked || (r.value != null && r.digits <= 2 && r.yShare != null && r.yShare < 0.4));
    if (looksStacked) readings.push(...await readViews(runOCR, labelOCR, image, box, STACKED_VIEWS, opts));
    const mv = String(model.value), lines = model.lineTexts && model.lineTexts.length === 2 ? model.lineTexts : null;
    let top = false, bottom = false;
    for (const r of readings) {
      if (r.value == null) continue;
      const v = String(r.value);
      if (r.tight && model.lines >= 2) r.excluded = "too tight to hold a two-line number";
      else if (v !== mv && model.lines >= 2 && !r.stacked && (mv.startsWith(v) || mv.endsWith(v))) {
        r.excluded = "one line of the OCR model's two-line reading";
        if (lines && v === lines[0]) top = r.confirmsLine = "top";
        if (lines && v === lines[1]) bottom = r.confirmsLine = "bottom";
      }
      else if (r.stacked && (r.confidence || 0) < STACKED_MIN_CONFIDENCE && v !== mv) r.excluded = "a two-line reading below the confidence a vote needs";
    }
    // The vote with the model in it. A Tesseract crop that read the top line
    // and another that read the bottom line confirm the model's number line by
    // line -- one more agreeing view. VERIFIED needs two agreeing views AND
    // more of them than any other value has: two engines reading 102 outvote
    // one crop reading 107; one against one is a person's call.
    const votes = readings.filter(r => !r.excluded && r.value != null);
    const agree = votes.filter(r => r.value === model.value).length + 1 + (top && bottom ? 1 : 0);
    const others = new Map();
    for (const r of votes) if (r.value !== model.value) others.set(r.value, (others.get(r.value) || 0) + 1);
    const strongestOther = Math.max(0, ...others.values());
    const all = [model, ...readings];
    if (agree >= 2 && agree > strongestOther) {
      return { value: model.value, state: STATES.VERIFIED, confidence: Math.max(model.confidence, ...votes.filter(r => r.value === model.value).map(r => r.confidence || 0)),
        readings: all, why: `the OCR model and ${agree - 1} crop reading(s) of this symbol read the same number${top && bottom ? " (two crops confirming it line by line)" : ""}${others.size ? `; ${[...others.keys()].join(" and ")} outvoted` : ""} (one image: consistent, not independently confirmed)` };
    }
    return { value: null, state: STATES.NEEDS_REVIEW, confidence: model.confidence, readings: all, suggestion: model.value,
      why: others.size ? `the OCR model reads ${model.value}, crops of this symbol read ${[...others.keys()].join(" and ")}` : `only the OCR model read a number here (${model.value})` };
  }
  async function readViews(runOCR, labelOCR, image, box, views, opts) {
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
      const hit = numberFromResult(result, { width: crops[0].width, height: crops[0].height });
      readings.push({ view: view.id, value: hit ? hit.value : null, confidence: hit ? hit.confidence : null,
        ...(hit && hit.stacked ? { stacked: true } : {}), ...(view.tight ? { tight: true } : {}),
        ...(hit && hit.yShare != null ? { yShare: +hit.yShare.toFixed(3), digits: hit.digits } : {}) });
    }
    return readings;
  }

  // Turn what the views saw into one of the four states an operator understands.
  //
  // LIKELY is deliberately NOT produced here. On the measurement above, a
  // number only one view saw is right 17% of the time — calling that "likely"
  // would be a lie told in the product's own vocabulary. LIKELY is reserved for
  // a reading corroborated from somewhere else (verified layout memory, or a
  // person), which is a different evidence source and belongs to a later layer.
  // `readings` are the views that vote; `all`, when given, is every view taken
  // (including any left out of the vote, each saying why) — what is reported.
  function classify(voting, all) {
    const readings = all || voting;
    const seen = voting.filter((r) => r.value != null);
    const values = [...new Set(seen.map((r) => r.value))];
    if (!seen.length) {
      return { value: null, state: STATES.UNKNOWN, confidence: null, readings,
        why: "no view of this symbol produced a number" };
    }
    if (values.length === 1 && seen.length >= 2) {
      return { value: values[0], state: STATES.VERIFIED,
        confidence: Math.max(...seen.map((r) => r.confidence || 0)), readings,
        why: `${seen.length} different crops of this symbol read the same number (one image, one OCR engine — consistent, not independently confirmed)` };
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
      const model = opts.modelReadings ? opts.modelReadings.get(table.id) || null : null;
      const r = await readOne(runOCR, labelOCR, image, table, { ...opts, model, modelNote: null });
      out.set(table.id, r);
      counts[r.state]++;
      if (typeof opts.onProgress === "function") opts.onProgress(out.size, tables.length);
    }
    return { byId: out, counts, views: (opts.views || VIEWS).map((v) => v.id) };
  }

  globalThis.MeritTableNumbers = {
    // 2: two-line numbers. 3: the OCR model's reading as a view (2026-10-04).
    version: 3,
    STATES,
    VIEWS,
    STACKED_VIEWS,
    MODEL_MIN_SCORE,
    modelVote,
    numberFromResult,
    classify,
    readOne,
    readTableNumbers,
  };
})();
