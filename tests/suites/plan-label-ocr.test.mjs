// Reading the word a drawing prints on one of its own objects.
//
// Phase 6 stopped naming a venue object `stage` from its aspect ratio: measured
// across both real plans that guess named 8 objects and 6 were wrong, with the
// 2 right ones inside the range of the 6 wrong. The cost was the Golden Plan's
// real stage, and this is what buys it back — not a better guess, but the
// drawing's own word, read from that object's own crop.
//
// Why a crop and not the full-page OCR already in hand, measured on the Golden
// Plan with the same engine and the same build:
//
//   full-page OCR of the whole plan     53 tokens, none of them SAHNE
//   crop of the band the detector found SAHNE, confidence 90
//
// And why that is a rule rather than a coincidence, measured over every
// band-shaped object on both real plans:
//
//   merit-real-venue  the band inside the annotated stage   SAHNE (90)
//                     the other shape-only band             nothing
//   ornek-symbolic    all six bands                         nothing
//
// One of the real stages, none of the seven other objects. The ORNEK half is
// the strong half: those crops are NOT unreadable — they come back with
// "SILA 29.08.2026", "Haluk Elver Salonu 1/2/3", "SALON 1166 * 12:1992 PAX",
// "KONTROL servant". The engine worked and they are simply not stages.
//
// Everything below runs against an INJECTED reader, so the suite needs no OCR
// engine at all. That is deliberate: this sandbox has no network, the normal
// build therefore has no Tesseract, and a rule that only a network build could
// test is exactly how the Phase 5 OCR bug survived. The real-engine end of this
// is covered by the offline verifier.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-label-ocr",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

const STAGE = ["SAHNE", "STAGE", "PODYUM", "PLATFORM", "SCENE", "BUHNE"];

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const present = await page.evaluate(() => typeof globalThis.MeritLabelOCR === "object");
  checks.require(present, "the label reader is reachable from the suite");

  // ---- folding: the engine's Turkish is unreliable, the meaning is not ------
  const fold = (s) => page.evaluate((x) => globalThis.MeritLabelOCR.fold(x), s);
  checks.equal(await fold("SAHNE"), "SAHNE", "an ASCII reading folds to itself");
  checks.equal(await fold("şahne"), "SAHNE", "a Turkish s-cedilla folds to the same word");
  checks.equal(await fold("SAH NE"), "SAHNE", "and so does a reading the engine split with a space");
  checks.equal(await fold("SAHNE:"), "SAHNE", "punctuation the engine invented is dropped");
  checks.equal(await fold(""), "", "an empty reading folds to nothing");

  // ---- what counts as finding the word -------------------------------------
  const find = (result, vocab = STAGE) =>
    page.evaluate(({ r, v }) => globalThis.MeritLabelOCR.findVocabulary(r, v), { r: result, v: vocab });
  const ocr = (text, words) => ({ available: true, text, words: words || [] });
  const w = (text, confidence) => ({ text, confidence });

  {
    const r = await find(ocr("SAHNE 310m", [w("SAHNE", 90), w("310m", 71)]));
    checks.ok(!!r, "a clean reading of the label is found");
    checks.equal(r && r.term, "SAHNE", "and reported as the term it matched");
    checks.equal(r && r.confidence, 90, "with the confidence of the token that matched, not the page average");
  }
  {
    // The engine splits words. Adjacent pieces rejoin, because the whole crop's
    // text is searched rather than each token alone.
    const r = await find(ocr("310m SAHN E", [w("SAHN", 78), w("E", 86)]));
    checks.ok(!!r, "a label the engine split into adjacent pieces is still found");
    checks.equal(r && r.term, "SAHNE", "as the whole word");
  }
  {
    // ...but pieces with other readings BETWEEN them are NOT stitched back
    // together, and that is the deliberate choice rather than a gap. This is
    // the real 3x/4x reading of the Golden band: every letter of SAHNE is
    // present and scattered. Reassembling it means choosing which characters to
    // skip, which would find the word in almost any noisy crop. The variant
    // ladder stops at 2x so this case does not arise in production, and when it
    // does arise the safe answer is a miss.
    const r = await find(ocr("I SAHN J 3,10m E", [w("SAHN", 78), w("J", 77), w("3,10m", 90), w("E", 86)]));
    checks.ok(!r, "a label scattered through other readings is NOT stitched back together", r);
  }
  {
    const r = await find(ocr("SILA 29.08.2026 Haluk Elver Salonu 1/2/3",
      [w("SILA", 88), w("29.08.2026", 91), w("Salonu", 84)]));
    checks.ok(!r, "a crop full of readable text that is not the label finds nothing", r);
  }
  {
    // The near-miss that matters: SALON is a real word on ORNEK's title block
    // and shares four letters with nothing in the vocabulary. It must not match.
    const r = await find(ocr("SALON 1166 * 12:1992 PAX", [w("SALON", 92), w("1166", 60)]));
    checks.ok(!r, "SALON on ORNEK's capacity block is not read as a stage", r);
  }
  {
    const r = await find({ available: false, text: null, words: [] });
    checks.ok(!r, "an unavailable engine finds nothing rather than guessing");
  }
  {
    const r = await find(ocr("SAHNE", []));
    checks.ok(!r, "text with no token to attribute it to is not accepted", r);
  }

  // ---- a reading is evidence, and a miss must cost one call, not two -------
  //
  // Every variant is a full engine round-trip. Measured on ORNEK, whose nine
  // band-shaped objects are none of them stages, running every variant on every
  // object took detection from 15s to 29s; stopping after a variant that read
  // plenty and found nothing brought it to 22.5s with the Golden stage still
  // found. These pin that behaviour, since it is a correctness/cost trade and
  // not an implementation detail.
  const readWith = (script, box) =>
    page.evaluate(async ({ s, b, v }) => {
      const calls = [];
      const fake = async (dataUrl) => {
        const step = s[calls.length] || { text: "", words: [] };
        calls.push(dataUrl.slice(0, 22));
        return { available: true, text: step.text, words: step.words || [] };
      };
      const img = document.createElement("canvas");
      img.width = 1355; img.height = 788;
      const g = img.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, img.width, img.height);
      g.fillStyle = "#333"; g.fillRect(600, 600, 500, 60);
      const bitmap = new Image();
      await new Promise((res) => { bitmap.onload = res; bitmap.src = img.toDataURL("image/png"); });
      const r = await globalThis.MeritLabelOCR.readLabel(fake, bitmap, b, v);
      return { ...r, callCount: calls.length };
    }, { s: script, b: box, v: STAGE });

  const BAND = { x: 51.03, y: 88.26 - 12, w: 31.96, h: 5.33 };
  {
    const r = await readWith([{ text: "SAHNE 310m", words: [w("SAHNE", 90)] }], BAND);
    checks.ok(r.found, "the first variant finding the label ends the read");
    checks.equal(r.callCount, 1, "one engine call, not two");
    checks.equal(r.variant, "plain-1x", "and the variant that found it is reported");
  }
  {
    const r = await readWith([
      { text: "SILA 29.08.2026 Haluk Elver Salonu", words: [w("SILA", 88), w("Salonu", 84)] },
      { text: "SAHNE", words: [w("SAHNE", 99)] },
    ], BAND);
    checks.ok(!r.found, "a crop that read plenty and matched nothing is not retried");
    checks.equal(r.callCount, 1, "so a miss on a legible crop costs one call");
  }
  {
    const r = await readWith([
      { text: "  ", words: [] },
      { text: "SAHNE", words: [w("SAHNE", 88)] },
    ], BAND);
    checks.ok(r.found, "but a crop that read nothing at all IS retried with the next variant");
    checks.equal(r.callCount, 2, "which is what the second variant exists for");
    checks.equal(r.variant, "stretch-2x", "and the fallback is the contrast-stretched one");
  }

  // ---- the crop is a neighbourhood, because the label sits beside the band --
  //
  // Measured on the Golden Plan: the detector finds a 433x42px strip of the
  // stage and the drawing prints SAHNE 50px ABOVE that strip. Padding by a
  // fraction of the strip's own 42px height reaches 3px and reads nothing.
  const geom = (box) => page.evaluate(async (b) => {
    const c = document.createElement("canvas");
    c.width = 1355; c.height = 788;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    const bitmap = new Image();
    await new Promise((res) => { bitmap.onload = res; bitmap.src = c.toDataURL("image/png"); });
    const v = globalThis.MeritLabelOCR.cropVariants(bitmap, b);
    return v.map((x) => ({ id: x.id, w: x.width, h: x.height }));
  }, box);
  {
    const v = await geom({ x: 51.03, y: 76, w: 31.96, h: 5.33 });
    checks.equal(v.length, 2, "a band produces both variants");
    const band = { w: 31.96 / 100 * 1355, h: 5.33 / 100 * 788 };
    checks.ok(v[0].h > band.h * 3,
      "the crop reaches far enough across the band to include a label printed beside it",
      { cropHeight: v[0].h, bandHeight: Math.round(band.h) });
    checks.ok(v[0].w < band.w * 1.5,
      "while staying local along the band rather than swallowing the room",
      { cropWidth: v[0].w, bandWidth: Math.round(band.w) });
    // Each variant rounds its own pixel size, so 2x is within a pixel of double
    // rather than exactly double.
    checks.ok(Math.abs(v[1].w - v[0].w * 2) <= 2 && Math.abs(v[1].h - v[0].h * 2) <= 2,
      "and the second variant is the same crop at 2x", { one: v[0], two: v[1] });
  }
  {
    const v = await geom({ x: 10, y: 10, w: 0.4, h: 0.4 });
    checks.equal(v.length, 0, "an object too small to carry readable text is not sent to the engine at all");
  }
}
