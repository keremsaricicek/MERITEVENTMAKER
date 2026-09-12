// The number printed inside a table symbol, and when the system is allowed to
// claim it.
//
// On a symbolic plan the number IS the table's identity — what the operator
// says on the radio, what the guest list refers to, what has to survive a
// re-import. A wrong number is far worse than no number, and every rule pinned
// below exists because of that asymmetry.
//
// ---- the measurements these tests protect, on ORNEK's 153 annotated numbers -
//
// A montage was tried first and abandoned: every table's crop tiled onto one
// sheet and read in a single call. Fast, and wrong, because the engine's layout
// analysis runs across tile boundaries —
//
//   64px tiles   1 call, 3.8s, precision 0.755   (89->8, 105->107, 104->10)
//   96px tiles   1 call, 6.5s, precision 0.506   (10->6, 90->9)
//
// One crop per table is not enough either:
//
//   inset 0.18 x3   read 109  right 92  precision 0.844
//   inset 0.18 x4   read 105  right 91  precision 0.867
//   inset 0.28 x4   read  98  right 88  precision 0.898
//
// Every failure is a digit lost off the end — 104 -> 10, 118 -> 11, 157 -> 15 —
// and nothing in a single reading distinguishes that from a correct short
// number, so no confidence threshold rescues it.
//
// Two crops that include DIFFERENT AMOUNTS of the symbol, agreeing:
//
//   inset 0.18 x4 + inset 0.28 x4   agree 87, right 87, PRECISION 1.000
//   read by only one of the two     29 readings, right 5, precision 0.172
//
// End to end on the shipped path: 163 symbols examined, 87 VERIFIED, 87 right,
// precision 1.000 against the frozen annotation, 31 NEEDS_REVIEW, 45 UNKNOWN.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-table-numbers",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const present = await page.evaluate(() => typeof globalThis.MeritTableNumbers === "object");
  checks.require(present, "the table-number reader is reachable from the suite");

  const w = (text, confidence) => ({ text, confidence });
  const ocr = (words) => ({ available: true, text: words.map((x) => x.text).join(" "), words });

  // ---- what counts as a number in one crop --------------------------------
  const num = (result) => page.evaluate((r) => globalThis.MeritTableNumbers.numberFromResult(r), result);
  {
    const r = await num(ocr([w("137", 88)]));
    checks.ok(!!r, "a lone digit run is a number");
    checks.equal(r && r.value, 137, "read as an integer");
  }
  {
    const r = await num(ocr([w("O", 40), w("137", 88), w("|", 12)]));
    checks.ok(!!r, "non-numeric noise around it does not prevent the reading");
    checks.equal(r && r.value, 137, "and the number is still the number");
  }
  {
    // Two digit runs is an ambiguity, not a number. A neighbouring symbol has
    // crept into the frame and nothing says which run is this table's.
    const r = await num(ocr([w("137", 88), w("138", 84)]));
    checks.ok(!r, "two digit runs in one crop is not a reading", r);
  }
  {
    const r = await num(ocr([w("1992", 91)]));
    checks.ok(!r, "a four-digit run is a capacity figure, not a table number", r);
  }
  {
    const r = await num(ocr([w("SALON", 92)]));
    checks.ok(!r, "a word is not a number");
  }
  {
    const r = await num({ available: false, text: null, words: [] });
    checks.ok(!r, "an unavailable engine reads nothing rather than guessing");
  }

  // ---- the four states, and which evidence earns which ---------------------
  const classify = (readings) => page.evaluate((r) => globalThis.MeritTableNumbers.classify(r), readings);
  const view = (id, value, confidence) => ({ view: id, value, confidence });
  {
    const r = await classify([view("a", 137, 88), view("b", 137, 84)]);
    checks.equal(r.state, "VERIFIED", "two different crops reading the same number is VERIFIED");
    checks.equal(r.value, 137, "and the number is claimed");
    checks.equal(r.confidence, 88, "reported at the best confidence that contributed");
  }
  {
    const r = await classify([view("a", 104, 88), view("b", 10, 91)]);
    checks.equal(r.state, "NEEDS_REVIEW", "crops that disagree are NEEDS REVIEW");
    checks.equal(r.value, null, "and NO number is claimed, however confident either reading was");
  }
  {
    // The measured case: 29 such readings on ORNEK, 5 of them right.
    const r = await classify([view("a", 137, 93), view("b", null, null)]);
    checks.equal(r.state, "NEEDS_REVIEW", "a number only one crop saw is NEEDS REVIEW");
    checks.equal(r.value, null, "with no number claimed");
    checks.equal(r.suggestion, 137, "though what was seen is offered to the operator to check");
  }
  {
    const r = await classify([view("a", null, null), view("b", null, null)]);
    checks.equal(r.state, "UNKNOWN", "a symbol no crop could read is UNKNOWN");
    checks.equal(r.value, null, "and stays unnumbered");
  }
  {
    // LIKELY is never produced from OCR alone. A single reading is right 17% of
    // the time, and calling that "likely" would be a lie in the product's own
    // vocabulary. The state is reserved for corroboration from another source.
    const states = await Promise.all([
      classify([view("a", 5, 99), view("b", null, null)]),
      classify([view("a", 5, 99), view("b", 6, 99)]),
      classify([view("a", null, null), view("b", null, null)]),
      classify([view("a", 5, 30), view("b", 5, 30)]),
    ]);
    checks.ok(!states.some((s) => s.state === "LIKELY"),
      "no OCR-only evidence ever produces LIKELY", states.map((s) => s.state));
  }
  {
    // Low confidence does not downgrade agreement. Agreement between two
    // different crops IS the evidence — that is the whole measured finding, and
    // second-guessing it with a confidence floor would discard true readings.
    const r = await classify([view("a", 42, 31), view("b", 42, 28)]);
    checks.equal(r.state, "VERIFIED", "two crops agreeing at low confidence is still VERIFIED");
  }

  // ---- reading one table, with an injected engine --------------------------
  const readOne = (script, box) => page.evaluate(async ({ s, b }) => {
    let n = 0;
    const fake = async () => {
      const step = s[n++] || { words: [] };
      return { available: true, text: (step.words || []).map((x) => x.text).join(" "), words: step.words || [] };
    };
    const c = document.createElement("canvas");
    c.width = 2402; c.height = 1719;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#222"; g.fillRect(400, 400, 80, 80);
    const im = new Image();
    await new Promise((res) => { im.onload = res; im.src = c.toDataURL("image/png"); });
    const r = await globalThis.MeritTableNumbers.readOne(fake, globalThis.MeritLabelOCR, im, b);
    return { ...r, calls: n };
  }, { s: script, b: box });

  const SYMBOL = { x: 16.6, y: 23.2, w: 3.3, h: 4.7 };
  {
    const r = await readOne([{ words: [w("137", 88)] }, { words: [w("137", 84)] }], SYMBOL);
    checks.equal(r.state, "VERIFIED", "a symbol both crops agree on is verified end to end");
    checks.equal(r.value, 137, "with the number attached");
    checks.equal(r.calls, 2, "and both crops are always read — agreement needs two opinions");
  }
  {
    const r = await readOne([{ words: [w("104", 88)] }, { words: [w("10", 92)] }], SYMBOL);
    checks.equal(r.state, "NEEDS_REVIEW", "the measured failure — a digit lost off the end — is caught");
    checks.equal(r.value, null, "and 104 is not silently recorded as 10");
  }
  {
    const r = await readOne([{ words: [] }, { words: [] }], SYMBOL);
    checks.equal(r.state, "UNKNOWN", "a symbol neither crop could read stays unknown");
  }

  // ---- a whole plan --------------------------------------------------------
  {
    const out = await page.evaluate(async () => {
      const script = [
        [{ text: "1", confidence: 90 }], [{ text: "1", confidence: 88 }],   // agree
        [{ text: "12", confidence: 90 }], [{ text: "2", confidence: 88 }],  // disagree
        [], [],                                                              // nothing
      ];
      let n = 0;
      const fake = async () => {
        const words = script[n++] || [];
        return { available: true, text: words.map((x) => x.text).join(" "), words };
      };
      const c = document.createElement("canvas");
      c.width = 2402; c.height = 1719;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      const im = new Image();
      await new Promise((res) => { im.onload = res; im.src = c.toDataURL("image/png"); });
      const tables = [
        { id: "t1", x: 10, y: 10, w: 3.3, h: 4.7 },
        { id: "t2", x: 20, y: 10, w: 3.3, h: 4.7 },
        { id: "t3", x: 30, y: 10, w: 3.3, h: 4.7 },
      ];
      const r = await globalThis.MeritTableNumbers.readTableNumbers(fake, globalThis.MeritLabelOCR, im, tables);
      return { counts: r.counts, t1: r.byId.get("t1"), t2: r.byId.get("t2"), t3: r.byId.get("t3"), views: r.views };
    });
    checks.equal(out.counts.VERIFIED, 1, "a plan reports how many numbers it actually verified");
    checks.equal(out.counts.NEEDS_REVIEW, 1, "how many need a human");
    checks.equal(out.counts.UNKNOWN, 1, "and how many could not be read at all");
    checks.equal(out.counts.LIKELY, 0, "with LIKELY unused by this evidence source");
    checks.equal(out.t1.value, 1, "the verified table carries its number");
    checks.equal(out.t2.value, null, "the disagreeing one carries none");
    checks.equal(out.views.length, 2, "and the views that were used are reported");
  }
}
