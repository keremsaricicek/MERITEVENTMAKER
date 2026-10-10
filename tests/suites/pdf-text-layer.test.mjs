// What a PDF plan carries besides its pixels (src/plan-pdf-text.js).
//
// What this pins:
//   A SCAN IS SAID TO BE A SCAN: ORNEK.pdf — the real plan, one JPEG and no
//     font — is recorded as SCAN with no text objects and no vector paths, so
//     nothing downstream can imply the document stated a word.
//   THE DOCUMENT'S OWN WORDS ARE USED AS SUCH: a PDF drawn with vector paths
//     whose stage label is an INVISIBLE text object (render mode 3, how a
//     searchable PDF carries its words) — no pixel shows it, so no OCR engine
//     can read it — still names its stage. The stage is the closed outline the
//     label sits in, measured on the raster; its label says it came from the
//     PDF's own text, with no confidence figure, and its observation is the
//     pdf-text channel, never "ocr".
//   VECTORS ARE NAMED, NOT READ: the paths are counted and the analysis says
//     this build does not turn them into objects.
//   TEXT FROM A FILE IS DATA: a markup string in the PDF's text never runs and
//     never becomes an element; a stored text record that comes back damaged
//     is dropped field by field, not trusted.
//
// The vector PDF is SYNTHETIC — written below, byte by byte. It is not a
// venue and is never counted as a real plan.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "pdf-text-layer", tags: ["intelligence", "security"], timeout: 300000, viewport: { width: 1400, height: 900 } };

// A one-page PDF, 600 x 400 pt: the room's outline, a closed stage outline,
// a visible table label, the stage's name as INVISIBLE text, and a markup
// string as invisible text. Offsets in the xref table are computed, not typed.
function vectorPdf() {
  const content = [
    "2 w",
    "20 20 560 360 re S",
    "200 300 200 80 re S",
    "100 120 m 130 120 l 130 150 l 100 150 l h S",
    "BT /F1 14 Tf 3 Tr 270 335 Td (SAHNE) Tj ET",
    "BT /F1 10 Tf 0 Tr 104 132 Td (T1) Tj ET",
    "BT /F1 6 Tf 3 Tr 440 60 Td (<img src=x onerror=window.__pdfTextPwned=1>) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl, { lang: "en" });
  checks.require(await page.evaluate(() => typeof globalThis.MeritPdfText === "object"), "MeritPdfText is published");

  // ---- a stored record is rebuilt, not trusted --------------------------------
  const stored = await page.evaluate(() => globalThis.MeritPdfText.scaledItems({ width: 100, height: 100, text: { items: [
    { text: "BAR", box: { x0: 10, y0: 10, x1: 20, y1: 15 }, score: 0.01, engine: "somethingElse", extra: "<script>" },
    { text: { toString: "x" }, box: { x0: 1, y0: 1, x1: 2, y1: 2 } },
    { text: "SAHNE", box: { x0: "10", y0: 1, x1: 2, y1: 2 } },
    null,
  ] } }, 200, 50));
  checks.equal(JSON.stringify(stored), JSON.stringify([{ text: "BAR", score: 1, engine: "pdfTextLayer", box: { x0: 20, y0: 5, x1: 40, y1: 7.5 } }]),
    "a stored text record comes back as text, a box and nothing else: a non-string, a non-number or a null is dropped", stored);

  // ---- the real scan -----------------------------------------------------------
  await createBlankEvent(page, { name: "Scan", date: futureDate() });
  await page.setInputFiles("#floorPlanFile", path.join(repoRoot, "benchmarks/plans/ORNEK.pdf"));
  await page.waitForFunction(() => !!state.events[0].background?.pdfSource, null, { timeout: 60000 });
  const scan = await page.evaluate(() => { const s = state.events[0].background.pdfSource; return { kind: s.kind, items: s.text.items.length, paths: s.vector.paths, images: s.vector.images }; });
  checks.ok(scan.kind === "SCAN" && scan.items === 0 && scan.paths === 0 && scan.images >= 1,
    "ORNEK.pdf is recorded as what it is: a scanned image, no text objects, no painted path (its one path is the clip around the photograph)", scan);

  // ---- a vector PDF whose stage label is invisible text ------------------------
  await page.click('[data-action="back-events"]');
  await page.waitForTimeout(400);
  await createBlankEvent(page, { name: "Vector", date: futureDate() });
  await page.setInputFiles("#floorPlanFile", { name: "vector-plan.pdf", mimeType: "application/pdf", buffer: vectorPdf() });
  await page.waitForFunction(() => !!state.events[0].background?.pdfSource && state.events[0].name === "Vector", null, { timeout: 60000 });
  const src = await page.evaluate(() => { const s = state.events[0].background.pdfSource; return { kind: s.kind, width: s.width, height: s.height, paths: s.vector.paths,
    texts: s.text.items.map(i => ({ text: i.text, box: Object.fromEntries(Object.entries(i.box).map(([k, v]) => [k, Math.round(v)])) })) }; });
  const sahne = src.texts.find(t => t.text === "SAHNE");
  checks.ok(src.kind === "VECTOR_WITH_TEXT" && src.paths >= 3 && src.width === 1560 && src.height === 1040,
    "the vector PDF is recorded as drawn with paths and carrying text, at the raster's own size", src);
  // SAHNE's baseline starts at (270, 335) pt at 14 pt: x 270*2.6 = 702, the
  // baseline at y (400-335)*2.6 = 169, Helvetica's ascent (about 0.72 of 36.4
  // px) above it and its descent (about 0.21) below — about 143..177.
  checks.ok(sahne && sahne.box.x0 >= 698 && sahne.box.x0 <= 706 && sahne.box.y0 >= 138 && sahne.box.y0 <= 148 && sahne.box.y1 >= 172 && sahne.box.y1 <= 182,
    "the invisible SAHNE is placed in the raster's pixels where the page puts it (the y flip included)", sahne);

  await runDetection(page);
  const golden = await page.evaluate(() => {
    const a = state.events[0].analysis, W = 1560, H = 1040;
    const px = c => ({ x0: Math.round(c.x / 100 * W), y0: Math.round(c.y / 100 * H), x1: Math.round((c.x + c.w) / 100 * W), y1: Math.round((c.y + c.h) / 100 * H) });
    const st = a.candidates.filter(c => c.type === "stage");
    const obsKinds = st.flatMap(c => (c.observationIds || []).map(id => (a.observations || []).find(o => o.id === id)).filter(Boolean).map(o => o.source.kind));
    return {
      stages: st.map(c => ({ ...px(c), basis: c.geometryBasis, typeBasis: c.typeBasis, engine: c.labelRead && c.labelRead.engine, labelConfidence: c.labelRead ? c.labelRead.confidence : undefined,
        source: c.labelRead && c.labelRead.source, confidence: c.confidence, selected: c.selected })),
      obsKinds,
      modelReadSahne: !!(a.ocrModel && a.ocrModel.available && (a.ocrModel.items || []).some(i => /SAHNE/i.test(i.text))),
      diag: a.diagnostics.pdfSource,
      pwned: globalThis.__pdfTextPwned === 1,
      imgs: document.querySelectorAll('img[src="x"]').length,
    };
  });
  checks.ok(!golden.modelReadSahne, "the OCR model did not read SAHNE: no pixel shows it", golden);
  const s0 = golden.stages[0] || {};
  checks.ok(golden.stages.length === 1 && s0.typeBasis === "printedLabel" && s0.engine === "pdfTextLayer" && s0.selected === true,
    "the stage is named by the PDF's own text and offered", golden.stages);
  checks.ok(s0.basis === "region" && s0.x0 >= 515 && s0.x0 <= 530 && s0.x1 >= 1030 && s0.x1 <= 1045 && s0.y0 >= 47 && s0.y0 <= 60 && s0.y1 >= 252 && s0.y1 <= 265,
    "its extent is the closed outline the label sits in, measured on the raster", s0);
  checks.ok(s0.labelConfidence === null && s0.confidence === null && s0.source === "the PDF's own text",
    "and it carries no confidence figure: the document stated the word, nothing read it", s0);
  checks.ok(golden.obsKinds.includes("pdf-text") && !golden.obsKinds.includes("ocr"),
    "its observation is the pdf-text channel, never OCR", golden.obsKinds);
  checks.ok(golden.diag && golden.diag.kind === "VECTOR_WITH_TEXT" && golden.diag.textItems >= 3 && golden.diag.paths >= 3,
    "the analysis records what the PDF carried and how much of its text it used", golden.diag);
  checks.ok(!golden.pwned && golden.imgs === 0, "a markup string in the PDF's text never ran and never became an element", { pwned: golden.pwned, imgs: golden.imgs });

  // The diagnostics say what was used and what was not (the Advanced
  // Diagnostics panel of the review screen; its content is in the page closed).
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => (document.querySelector(".planintel-diagnostics .analysis-note") || {}).textContent || "");
  checks.ok(rows.includes(`${golden.diag && golden.diag.textItems} text object(s) used as the document's own text`) && /does not turn vector paths into objects/.test(rows),
    "the review screen's diagnostics name the text used and the vectors not read", rows);
}
