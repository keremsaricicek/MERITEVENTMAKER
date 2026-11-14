// Reading what a drawing prints ON one specific object.
//
// Full-page OCR is the wrong instrument for this. It runs once over a canvas
// capped at 1920 on its long side, so a label printed inside an object gets
// whatever pixels are left after that downscale — and on a real plan that is
// not enough. Measured on the Golden Plan, whose stage has "SAHNE" printed
// across it:
//
//   full-page OCR of the whole plan     53 tokens, none of them SAHNE
//   OCR of a crop of that one band      SAHNE, confidence 91
//
// Same engine, same image, same build. The only difference is how many pixels
// the word was given. That is what this module exists to exploit: the detector
// already knows WHERE its objects are, so each object's own label can be read
// from its own crop.
//
// Two rules govern everything here.
//
//   THE CROP IS ANALYSIS ONLY. The plan the operator sees is never altered.
//   Contrast stretching, upscaling and thresholding happen on a throwaway
//   canvas and are thrown away with it.
//
//   A READING IS EVIDENCE, NOT A DECISION. This module returns what it saw and
//   how sure it is. Whether that is enough to name an object is the caller's
//   judgement, made against a measured floor.
(function () {
  "use strict";

  // The preprocessing variants, and why these two.
  //
  // Measured on the Golden Plan's stage band, reading "SAHNE" (confidence in
  // brackets, "-" meaning the word came back broken or not at all):
  //
  //   variant             1x        2x        3x        4x
  //   plain               SAHNE(48) -         -         -
  //   contrast-stretched  SHE(30)   SAHNE(91) SAHN+E    SAHN+E
  //
  // Upscaling past 2x makes it WORSE, not better: Tesseract starts splitting
  // the word across boxes ("SAHN" + "E"). So the ladder stops at 2x rather
  // than reaching for more pixels, and both survivors are kept because they
  // fail differently — the plain pass reads it at 1x where the stretched pass
  // does not, and the stretched pass reads it far more confidently at 2x.
  //
  // Nothing here is tuned to the word SAHNE. The variants are generic image
  // preparation; the vocabulary is the caller's.
  const VARIANTS = [
    { id: "plain-1x", scale: 1, stretch: false },
    { id: "stretch-2x", scale: 2, stretch: true },
  ];

  // A crop is padded outward before reading, and the pad along the SHORT side
  // is measured against the object's LONG side. That asymmetry is deliberate.
  //
  // A label is sized relative to the object it names, not to how thin that
  // object is, and whether the drafter put it on the band, just above it or
  // just below it is a drafting habit rather than a meaning. Measured on the
  // Golden Plan: the detector finds a 433 x 42 px strip of the stage, and the
  // drawing prints SAHNE 50 px above that strip — inside the real stage, and
  // completely outside the strip the detector found. Padding by a fraction of
  // the object's own 42 px height reaches 3 px and reads nothing. Padding the
  // short side by a fraction of the 433 px length reaches the label.
  //
  // So the pad along the long axis stays a fraction of that axis (a small
  // margin, to keep a label's ascenders), and the pad across the short axis is
  // a fraction of the long axis (a neighbourhood, to find the label at all).
  const PAD_ALONG = 0.04;
  const PAD_ACROSS_OF_LONG = 0.22;

  // Guard rails on what is worth OCRing at all. A box a few pixels across
  // carries no readable text and costs a full engine round-trip to prove it.
  const MIN_CROP_PX = 24;
  const MAX_CROP_PX = 2600;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Build the throwaway canvases. `box` is in PERCENT of the plan, the same
  // units candidates are reported in, so callers never convert.
  function cropVariants(image, box, options) {
    const opts = options || {};
    const variants = opts.variants || VARIANTS;
    const W = image.naturalWidth || image.width, H = image.naturalHeight || image.height;
    if (!W || !H) return [];
    const along = opts.padAlong == null ? PAD_ALONG : opts.padAlong;
    const across = opts.padAcrossOfLong == null ? PAD_ACROSS_OF_LONG : opts.padAcrossOfLong;
    const bw = (box.w / 100) * W, bh = (box.h / 100) * H;
    const longPx = Math.max(bw, bh);
    // Which axis is long decides which pad each axis gets.
    const padX = bw >= bh ? bw * along : longPx * across;
    const padY = bw >= bh ? longPx * across : bh * along;
    const px = {
      x: (box.x / 100) * W - padX,
      y: (box.y / 100) * H - padY,
      w: bw + padX * 2,
      h: bh + padY * 2,
    };
    px.x = clamp(px.x, 0, W); px.y = clamp(px.y, 0, H);
    px.w = clamp(px.w, 1, W - px.x); px.h = clamp(px.h, 1, H - px.y);
    if (Math.min(px.w, px.h) < MIN_CROP_PX) return [];

    const out = [];
    for (const v of variants) {
      let cw = Math.round(px.w * v.scale), ch = Math.round(px.h * v.scale);
      if (Math.max(cw, ch) > MAX_CROP_PX) {
        const k = MAX_CROP_PX / Math.max(cw, ch);
        cw = Math.max(1, Math.round(cw * k)); ch = Math.max(1, Math.round(ch * k));
      }
      const canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      // White ground, so a crop that runs off the page edge does not hand the
      // engine a black margin to hallucinate characters out of.
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, cw, ch);
      g.imageSmoothingEnabled = v.scale <= 2;
      g.drawImage(image, px.x, px.y, px.w, px.h, 0, 0, cw, ch);
      if (v.stretch) stretchContrast(g, cw, ch);
      out.push({ id: v.id, width: cw, height: ch, dataUrl: canvas.toDataURL("image/png") });
    }
    return out;
  }

  // Local contrast stretch: map this crop's own darkest and lightest pixel to
  // black and white. Deliberately LOCAL — a faintly printed label on a big
  // sheet is faint relative to the whole page and perfectly legible relative to
  // the few square centimetres around it.
  function stretchContrast(g, w, h) {
    const img = g.getImageData(0, 0, w, h), px = img.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 4) {
      const v = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // A crop with no range at all is blank; stretching it would amplify noise
    // into letter-shaped artefacts, which is exactly the failure mode this
    // whole module is supposed to avoid.
    if (hi - lo < 12) return;
    const span = hi - lo;
    for (let i = 0; i < px.length; i += 4) {
      const v = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      const s = clamp(((v - lo) / span) * 255, 0, 255);
      px[i] = px[i + 1] = px[i + 2] = s;
      px[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  // Normalise a token for comparison. Turkish letters are folded to ASCII
  // because the engine confuses them constantly on a photographed sheet, and a
  // label that reads SAHNE or ŞAHNE means the same thing either way.
  const FOLD = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c" };
  function fold(text) {
    return String(text || "").replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => FOLD[c] || c)
      .toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // Does this crop's text contain one of the words the caller is looking for?
  //
  // The whole crop's folded text is searched as one string, not each token
  // alone, so a word the engine broke into ADJACENT pieces still reads: "SAHN"
  // followed by "E" folds to SAHNE and matches.
  //
  // A word broken into pieces with other tokens BETWEEN them does not match,
  // and deliberately so. Measured on the real band at 3x and 4x, the engine
  // returned "I SAHN J 3,10m E" — the letters of the word are there, scattered
  // through other readings. Stitching them back together means choosing which
  // characters to skip, which is OCR repair: it would find SAHNE in almost any
  // sufficiently noisy crop. The variants that produce that scattering are the
  // 3x and 4x ones, and the ladder stops at 2x precisely so this case does not
  // arise in production. It is a miss, and a miss is the safe answer.
  //
  // Confidence is the best of the tokens that actually contributed, so a
  // confident label inside a noisy crop is not dragged down by the noise.
  function findVocabulary(result, vocabulary) {
    if (!result || !result.available) return null;
    const words = result.words || [];
    const joined = fold(result.text);
    for (const term of vocabulary) {
      const needle = fold(term);
      if (!needle || joined.indexOf(needle) === -1) continue;
      // Confidence comes from the tokens that actually overlap the term, not
      // from the page average, so a confident label inside a noisy crop is not
      // dragged down by the noise around it.
      let best = 0, contributing = [];
      for (const w of words) {
        const f = fold(w.text);
        if (!f) continue;
        if (needle.indexOf(f) !== -1 || f.indexOf(needle) !== -1) {
          contributing.push({ text: w.text, confidence: w.confidence });
          if ((w.confidence || 0) > best) best = w.confidence || 0;
        }
      }
      if (!contributing.length) continue;
      return { term, matched: needle, confidence: Math.round(best), tokens: contributing };
    }
    return null;
  }

  // Read one object's own crop, trying each variant until the vocabulary is
  // found, and reporting which variant found it.
  //
  // `runOCR` is injected rather than reached for, so a suite can drive this
  // with recorded readings and never need a working engine — the same reason
  // the capacity parser is testable without OCR.
  // When a miss is worth a second look, and when it is not.
  //
  // Every variant costs a full engine round-trip, and most objects offered to
  // this module are not labelled at all — so what a miss costs decides whether
  // the whole pass is affordable. Measured on ORNEK, whose nine band-shaped
  // objects are none of them stages: running every variant on every object took
  // detection from 15s to 29s.
  //
  // The distinction that makes a second attempt worth paying for: did the first
  // variant fail to READ, or did it read plenty and simply not find the word?
  // ORNEK's bands come back with "SILA 29.08.2026", "Haluk Elver Salonu 1/2/3",
  // "SALON 1166 * 12:1992 PAX" — the engine worked, the label is not there, and
  // re-preprocessing the same pixels will not conjure it. A crop that comes back
  // empty or near-empty is the opposite case: the preprocessing was wrong for
  // this ink, and the next variant is exactly the remedy.
  const READABLE_ENOUGH = 12;

  async function readLabel(runOCR, image, box, vocabulary, options) {
    const opts = options || {};
    const crops = cropVariants(image, box, opts);
    const attempts = [];
    for (const crop of crops) {
      let result = null;
      try {
        result = await runOCR(crop.dataUrl, { timeoutMs: opts.timeoutMs || 20000 });
      } catch (error) {
        attempts.push({ variant: crop.id, error: error && error.message ? error.message : String(error) });
        continue;
      }
      const hit = findVocabulary(result, vocabulary);
      const readable = fold(result && result.text).length;
      attempts.push({
        variant: crop.id,
        text: result && result.text ? String(result.text).replace(/\s+/g, " ").trim().slice(0, 120) : null,
        readable,
        match: hit ? hit.term : null,
        confidence: hit ? hit.confidence : null,
      });
      if (hit) return { found: true, term: hit.term, confidence: hit.confidence, variant: crop.id, tokens: hit.tokens, attempts };
      if (readable >= READABLE_ENOUGH) break;
    }
    return { found: false, term: null, confidence: null, variant: null, tokens: [], attempts };
  }

  globalThis.MeritLabelOCR = {
    version: 1,
    VARIANTS,
    PAD_ALONG,
    PAD_ACROSS_OF_LONG,
    cropVariants,
    findVocabulary,
    readLabel,
    fold,
  };
})();
