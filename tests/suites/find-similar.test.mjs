// "Find more like this" (L3, 2026-10-18). A person confirms an object on the
// review screen and asks for more of it: the object's own pixels are the
// template (MeritPlanExemplar), and every place found comes back as a
// SUGGESTION — an unreviewed candidate of the same kind and type, never
// selected, decided by a person like any other. Undo removes the ones still
// unreviewed; a completed event refuses. The plan is drawn in the test (six
// identical tables, two other shapes), so what is checked is the wiring and
// the honesty of the result, not a benchmark — that is
// benchmarks/offline-intelligence/exemplar-measure.mjs (--robustness).
import { openApp, createBlankEvent, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "find-similar", tags: ["intelligence", "teach", "ui"], timeout: 60000, viewport: { width: 1600, height: 1000 } };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Similar", date: futureDate() });
  const setup = await page.evaluate(() => {
    const W = 1200, H = 800, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    const table = (x, y) => { g.fillStyle = "#e8dcc0"; g.fillRect(x, y, 60, 60); g.strokeStyle = "#333"; g.lineWidth = 2; g.strokeRect(x, y, 60, 60);
      g.fillStyle = "#333"; g.beginPath(); g.arc(x + 30, y + 30, 6, 0, 7); g.fill(); };
    const spots = [[100, 100], [300, 100], [500, 100], [100, 400], [300, 400], [700, 600]];
    spots.forEach(([x, y]) => table(x, y));
    g.strokeStyle = "#333"; g.lineWidth = 2; g.beginPath(); g.arc(900, 200, 50, 0, 7); g.stroke(); // a round thing, not a table like these
    g.strokeRect(850, 450, 200, 30);
    const ev = state.events[0];
    ev.background = { src: cv.toDataURL("image/png"), name: "p.png", opacity: 1, visible: true, locked: false, scale: 100 };
    const pct = (x, y, id, status) => ({ id, kind: "table", type: "square", x: x / W * 100, y: y / H * 100, w: 60 / W * 100, h: 60 / H * 100, rotation: 0,
      status, selected: status === "confirmed", confidence: 0.9, chairDetections: [] });
    const candidates = [pct(100, 100, "c1", "confirmed"), pct(300, 100, "c2", "unreviewed")];
    ev.analysis = { id: "an", planHash: "h", engine: "ASSISTED_DETECTION", trainedModel: false, createdAt: new Date().toISOString(), imageWidth: W, imageHeight: H,
      threshold: 128, candidates, missed: [], groupingDecisions: [], comparison: { added: candidates.length, removed: 0, changed: 0 }, memoryReapplied: 0, memoryRestored: 0,
      memoryConflicts: [], ocr: { available: false, engine: "tesseract.js" }, ocrText: null, timings: {}, diagnostics: {} };
    ev.analysis.planIntelligence = globalThis.buildPlanIntelligence(ev, null);
    ui.screen = "workspace"; ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = "c1"; render();
    return { spots: spots.length };
  });
  await page.waitForSelector('[data-review-action="find-similar"]', { timeout: 10000 });
  checks.ok(true, "a confirmed object's card offers \"Find more like this\"");
  await page.click('[data-review-action="find-similar"]');
  await page.waitForFunction(() => state.events[0].analysis.candidates.length > 2, null, { timeout: 15000 });
  const after = await page.evaluate(() => {
    const a = state.events[0].analysis, W = 1200, H = 800;
    const sug = a.candidates.filter((c) => c.source === "exemplar");
    return { n: sug.length, all: sug.every((c) => c.status === "unreviewed" && c.selected === false && c.kind === "table" && c.type === "square" && c.exemplarOf === "c1"),
      at: sug.map((c) => [Math.round(c.x / 100 * W), Math.round(c.y / 100 * H)]).sort((p, q) => p[0] - q[0] || p[1] - q[1]),
      toast: !!document.querySelector(".toast.has-action .toast-action"),
      audit: (state.audit || []).some((e) => e.action === "EXEMPLAR_SUGGESTIONS_ADDED") };
  });
  checks.equal(after.n, 4, "the four other drawings of the same table are found — not the one already in the analysis, nor the round or long shapes");
  const expected = [[100, 400], [300, 400], [500, 100], [700, 600]];
  checks.ok(expected.every(([x, y]) => after.at.some(([ax, ay]) => Math.abs(ax - x) <= 4 && Math.abs(ay - y) <= 4)),
    "each where one of those tables is drawn (within 4 px)", after.at);
  checks.ok(after.all, "every one is a suggestion: unreviewed, not selected, the same kind and type, naming the object it resembles");
  checks.ok(after.toast && after.audit, "the operator is told how many, with Undo, and the audit records it");
  // the card of a suggestion says why it is there
  await page.evaluate(() => { const s = state.events[0].analysis.candidates.find((c) => c.source === "exemplar"); ui.selectedCandidateId = s.id; render(); });
  checks.ok(await page.evaluate(() => /looks like an object you confirmed/.test(document.querySelector(".poi-card")?.textContent || "")), "a suggestion's card says it was suggested for its resemblance");
  // Undo
  await page.evaluate(() => { const c = state.events[0].analysis.candidates.find((x) => x.source === "exemplar"); c.status = "confirmed"; ui.selectedCandidateId = "c1"; render(); });
  await page.click(".toast.has-action .toast-action");
  const undone = await page.evaluate(() => state.events[0].analysis.candidates.map((c) => `${c.id === "c1" || c.id === "c2" ? c.id : c.source}:${c.status}`));
  checks.equal(undone.length, 3, "Undo removes the suggestions still unreviewed — the one a person already confirmed stays");
  checks.ok(undone.includes("exemplar:confirmed"), "and the confirmed one is kept as the person decided", undone);
  // a completed event refuses
  const before = await page.evaluate(() => state.events[0].analysis.candidates.length);
  await page.evaluate(() => { state.events[0].status = "Completed"; ui.selectedCandidateId = "c1"; render(); });
  const btn = await page.$('[data-review-action="find-similar"]');
  if (btn) { await btn.click(); await page.waitForTimeout(500); }
  checks.equal(await page.evaluate(() => state.events[0].analysis.candidates.length), before, "a completed event gains no suggestions");
}
