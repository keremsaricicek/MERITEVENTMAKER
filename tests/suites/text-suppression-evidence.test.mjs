// A word read over a seat does not make the seat a word.
//
// Text suppression (MeritSuppressTextFalsePositives) deletes a candidate whose
// box is mostly covered by OCR word boxes. On degraded renderings Tesseract also
// emits JUNK -- "KID", "ihn", "BE", confidence 15-49 -- over chair fills, and the
// rule deleted what it covered: 25 real armchairs on the jpeg-q20 rendering of
// the Golden plan (benchmarks/robustness/README.md, 2026-10-18).
//
// Built from pixels, so it is the rule that is tested:
//   - a seat that is a filled region AND stands against a table is not
//     printing, whatever is read over it;
//   - printed strokes, a seat-sized filled square standing at no table (the
//     large-venue fixture's label squares) and bold lettering are still removed;
//   - TABLES ARE NOT EXEMPTED: a free-standing filled table and a grey plinth
//     cannot be told apart by anything measured (the architecture fixture,
//     a6), so the words decide for both, as before.
// Without pixels the rule is exactly what it was.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "text-suppression-evidence",
  tags: ["detection", "intelligence"],
  timeout: 30000,
  viewport: { width: 1000, height: 700 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const out = await page.evaluate(() => {
    const W = 400, H = 300;
    const data = new Uint8ClampedArray(W * H * 4).fill(250);
    const paint = (x0, y0, x1, y1, [r, g, b]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = 4 * (y * W + x); data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
      }
    };
    const outline = (x0, y0, x1, y1, c) => {
      paint(x0, y0, x1, y0 + 1, c); paint(x0, y1 - 1, x1, y1, c); paint(x0, y0, x0 + 1, y1, c); paint(x1 - 1, y0, x1, y1, c);
    };
    const ink = [40, 40, 40], tan = [200, 190, 170], orange = [240, 120, 40];
    // the plan's own table with two chairs at it, which no word covers
    paint(200, 180, 240, 220, tan); outline(200, 180, 240, 220, ink);
    paint(165, 185, 195, 215, orange); outline(165, 185, 195, 215, ink);
    paint(245, 185, 275, 215, orange); outline(245, 185, 275, 215, ink);
    // 1. a filled seat standing against that table's front edge (2 px gap)
    paint(205, 222, 235, 252, orange); outline(205, 222, 235, 252, ink);
    // 2. the same seat standing at no table (a label square)
    paint(330, 40, 360, 70, orange); outline(330, 40, 360, 70, ink);
    // 3. printed letters at the table: 2 px strokes of an "E" just above it
    paint(205, 150, 207, 170, ink); paint(205, 150, 217, 152, ink); paint(205, 159, 215, 161, ink); paint(205, 168, 217, 170, ink);
    // 4. bold lettering in the seats' colour, far from any table
    paint(40, 40, 48, 58, orange); paint(40, 40, 60, 46, orange); paint(40, 52, 60, 58, orange);
    // 5. a free-standing filled table, chairless
    paint(40, 200, 80, 240, tan); outline(40, 200, 80, 240, ink);
    // 6. a grey plinth beside it
    paint(100, 200, 140, 240, [140, 140, 140]); outline(100, 200, 140, 240, ink);
    const pixels = { data, width: W, height: H };
    const pct = (x0, y0, x1, y1) => ({ x: x0 / W * 100, y: y0 / H * 100, w: (x1 - x0) / W * 100, h: (y1 - y0) / H * 100 });
    const cand = (id, kind, type, b, extra = {}) => ({ id, kind, type, ...b, rotation: 0, status: "unreviewed", selected: true, chairDetections: [], ...extra });
    const accusedCands = [
      cand("seatAtTable", "venue", "chair", pct(205, 222, 235, 252), { seatFamily: "primary" }),
      cand("seatAtNoTable", "venue", "chair", pct(330, 40, 360, 70), { seatFamily: "primary" }),
      cand("letters", "venue", "chair", pct(203, 148, 219, 172), { seatFamily: "primary" }),
      cand("boldLetter", "venue", "chair", pct(40, 40, 60, 58), { seatFamily: "primary" }),
      cand("freeTable", "table", "square", pct(40, 200, 80, 240)),
      cand("plinth", "table", "square", pct(100, 200, 140, 240)),
    ];
    const seated = cand("seated", "table", "square", pct(200, 180, 240, 220), { chairDetections: [
      { id: "ch1", ...pct(165, 185, 195, 215), rotation: 0 }, { id: "ch2", ...pct(245, 185, 275, 215), rotation: 0 }] });
    // one junk word over each accused candidate, as Tesseract reads it off a fill
    const words = accusedCands.map((c) => ({ text: "nl", confidence: 46,
      bbox: { x0: c.x / 100 * W - 1, y0: c.y / 100 * H - 1, x1: (c.x + c.w) / 100 * W + 1, y1: (c.y + c.h) / 100 * H + 1 } }));
    const all = () => [...accusedCands, seated].map((c) => ({ ...c }));
    const ids = (r) => r.kept.map((c) => c.id).filter((id) => id !== "seated").sort();
    const withPixels = MeritSuppressTextFalsePositives(all(), words, W, H, pixels);
    return {
      kept: ids(withPixels), keptAsDrawn: withPixels.keptAsDrawn,
      without: ids(MeritSuppressTextFalsePositives(all(), words, W, H)),
      // pixels of another size are not this analysis's pixels: refused, old rule
      mismatched: ids(MeritSuppressTextFalsePositives(all(), words, W, H, { data, width: W / 2, height: H })),
      // with no table on the plan a seat stands at nothing: old rule
      noTable: ids(MeritSuppressTextFalsePositives(accusedCands.filter((c) => c.kind !== "table").map((c) => ({ ...c })), words, W, H, pixels)),
    };
  });
  checks.equal(out.kept, ["seatAtTable"],
    "a filled seat standing against a table survives a junk word; a seat at no table, printed strokes, bold lettering, a free-standing table and a plinth do not");
  checks.equal(out.keptAsDrawn, 1, "the analysis counts what the drawing kept");
  checks.equal(out.without, [], "without the plan's pixels the rule is unchanged: every covered candidate is removed");
  checks.equal(out.mismatched, [], "pixels that are not the analysis's own size are not used");
  checks.equal(out.noTable, [], "with no table on the plan, no seat stands at one: nothing is kept");
}
