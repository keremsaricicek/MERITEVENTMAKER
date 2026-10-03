// Does dist/merit-offline/ really run with no network at all, OCR included?
//
// This exists because the claim that it did was written down and was false:
// build-offline-full.mjs sliced index.html's body at the first HTML comment,
// so #guestDialog never reached the package, app-guests.js threw on
// `getElementById("guestForm").elements`, and since all eight sources are
// concatenated into ONE <script> that throw killed i18n, plan-ocr,
// plan-intelligence and app-v8 with it. The package booted to a dead shell.
// Nothing caught it because nobody ran the built artifact.
//
// So: serve the real build, abort every request that is not same-origin --
// harder than a CDN allowlist, because a silent fetch to any outside host
// shows up as an attempt rather than passing quietly -- and drive real OCR.
//
// Usage: node benchmarks/offline/verify-offline-package.mjs
// Exits non-zero on any failure. Run it after touching either build script.

import { launchChromium } from "../../tests/lib/env.mjs";
import { appSourceFiles } from "../../scripts/lib/app-sources.mjs";
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ROOT = join(REPO, 'dist', 'merit-offline');
if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('dist/merit-offline/index.html not found — run: node scripts/build-offline-full.mjs');
  process.exit(2);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const srv = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = join(ROOT, normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const buf = await readFile(p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => srv.listen(8123, r));
const ORIGIN = 'http://127.0.0.1:8123';

const b = await launchChromium();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const blocked = [];
await ctx.route('**/*', route => {
  const u = route.request().url();
  // file: is allowed because the single-file build's real deployment is
  // "double-click the .html" -- but it still must not reach the network, and
  // any http(s) attempt from either build lands in `blocked`.
  if (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('file:')) return route.continue();
  blocked.push(u);
  return route.abort();
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await p.goto(ORIGIN + '/index.html');
await p.waitForLoadState('domcontentloaded');
await p.waitForTimeout(1500);

// Every source file in the concatenated bundle must have actually executed.
// One global per file, in load order, so a throw is located rather than just
// detected.
const boot = await p.evaluate(() => ({
  'storage-provider.js': typeof globalThis.MeritStorageProviders === 'object',
  'venue-model.js': typeof globalThis.MeritVenueModel === 'object',
  'app.js': typeof globalThis.render === 'function',
  'app-guests.js': typeof globalThis.meritGuestsLoaded !== 'undefined' || !!document.getElementById('guestForm'),
  'i18n.js': typeof globalThis.t === 'function',
  'plan-ocr.js': typeof globalThis.runPlanOCR === 'function',
  'plan-intelligence.js': typeof globalThis.buildPlanIntelligence === 'function',
  'app-v8.js': typeof globalThis.meritTableIndex === 'function',
  dialogs: ['guestDialog', 'excelDialog', 'guideDialog', 'toastWrap', 'app', 'floorPlanFile', 'guestFileInput', 'backupFileInput']
    .filter(id => !document.getElementById(id)),
  tesseract: typeof globalThis.Tesseract,
  xlsx: typeof globalThis.XLSX,
  assetPaths: globalThis.MERIT_OCR_ASSET_PATHS || null,
}));

// A plan-like image: printed capacity text and a Turkish venue label, the
// sort of thing the capacity auditor actually reads off an imported plan.
const ocr = await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1000; c.height = 420;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 420);
  x.fillStyle = '#000';
  x.font = 'bold 44px sans-serif'; x.fillText('TOTAL 124 PAX', 60, 90);
  x.font = '34px sans-serif'; x.fillText('114 pax seating', 60, 160);
  x.fillText('10 pax bistro', 60, 215);
  x.font = 'bold 40px sans-serif'; x.fillText('SAHNE', 60, 300);
  x.fillText('T01   T02   T03', 60, 375);
  const t0 = performance.now();
  const r = await runPlanOCR(c.toDataURL('image/png'), { timeoutMs: 120000 });
  return { ...r, ms: Math.round(performance.now() - t0),
    words: (r.words || []).map(w => ({ t: w.text, c: Math.round(w.confidence) })) };
});

// The auditor's own parser must survive real OCR output, not just clean text.
const parsed = await p.evaluate(text => {
  const pi = buildPlanIntelligence({ tables: [], venueObjects: [], guests: [],
    analysis: { candidates: [], groupingDecisions: [] }, background: null }, text);
  return pi?.capacityAudit ? { stated: pi.capacityAudit.stated ?? pi.capacityAudit.drawingStated ?? null,
    ocrAvailable: pi.capacityAudit.ocrAvailable } : null;
}, ocr.text || null);

// The whole capacity loop, driven by REAL OCR output rather than by a string
// someone typed into a test. The drawing says 124; the question is what the
// product does when what it counted does not agree, and whether that ends up
// somewhere an operator can act on rather than in a diagnostics panel.
//
// Two runs over the same OCR text: one where the counted seats match the
// printed figure, one where they do not. The interesting one is the second.
const capacityLoop = await p.evaluate(text => {
  const plan = seatsPerTable => {
    const candidates = [];
    for (let i = 0; i < 20; i++) {
      const chairs = [];
      for (let s = 0; s < seatsPerTable; s++)
        chairs.push({ id: `ch-${i}-${s}`, x: 5 + i * 4, y: 20 + s, w: 1, h: 1, rotation: 0 });
      candidates.push({ id: `t-${i}`, kind: 'table', type: 'square', x: 4 + i * 4, y: 18, w: 3, h: 3,
        rotation: 0, confidence: 0.9, status: 'unreviewed', selected: true, chairDetections: chairs,
        evidence: { geometry: 0.9, chairs: seatsPerTable, repetition: 20, sizeAgreement: 0.9 } });
    }
    return { tables: [], venueObjects: [], guests: [], background: null,
      analysis: { candidates, groupingDecisions: [] } };
  };
  const read = seatsPerTable => {
    const pi = buildPlanIntelligence(plan(seatsPerTable), text);
    const contra = (pi.contradictions || []).find(c => c.kind === 'CAPACITY');
    const priority = (pi.reviewPriorities || []).find(x => x.contradictionId === (contra && contra.id));
    const fact = (pi.facts || []).find(f => f.id === 'capacity');
    return {
      counted: pi.capacityEstimate.physical,
      stated: pi.capacityAudit && (pi.capacityAudit.stated ?? pi.capacityAudit.drawingStated),
      factKey: fact && fact.key,
      factStrength: fact && fact.strength,
      contradiction: contra ? { key: contra.key, severity: contra.severity,
        targets: (contra.targetIds || []).length, sides: contra.sides.map(s => s.from) } : null,
      priorityRank: priority ? priority.rank : null,
      priorityTargets: priority ? (priority.targetIds || []).length : 0,
    };
  };
  // 20 x 4 = 80 against a printed 124: a difference of 44, far outside the
  // auditor's tolerance of max(2, 5%) = 6.2.
  //
  // The first version of this used 6 seats a table -- 120 against 124, a
  // difference of 4 -- and the auditor correctly called that agreement. The
  // fixture was wrong, not the product. 20 x 6 is also what the "agrees" case
  // rounds to, so the two runs were the same run.
  return { differs: read(4), agrees: read(Math.round(124 / 20)) };
}, ocr.text || null);

const text = (ocr.text || '').toUpperCase();
const offOrigin = [...new Set(blocked.filter(u => !u.startsWith('chrome-extension')))];
const notBooted = Object.entries(boot).filter(([k, v]) => v === false).map(([k]) => k);

const checks = [
  ['every source file in the bundle executed', notBooted.length === 0, notBooted],
  ['all required dialogs/inputs are present in the markup', boot.dialogs.length === 0, boot.dialogs],
  ['Tesseract + SheetJS loaded from local assets', boot.tesseract === 'object' && boot.xlsx === 'object'],
  ['OCR engine is embedded in the package, not fetched', !!boot.assetPaths && String(boot.assetPaths.embedded).startsWith('./')],
  ['OCR reported available', ocr.available === true, ocr.reason],
  ['zero off-origin requests were even attempted', offOrigin.length === 0, offOrigin.slice(0, 6)],
  ['read the printed total "124"', text.includes('124')],
  ['read the seating count "114"', text.includes('114')],
  ['read the bistro count "10"', /\b10\b/.test(text)],
  ['read a Turkish venue label (SAHNE)', text.includes('SAHNE')],
  ['returned per-word boxes with confidences, not one blob', (ocr.words || []).length > 0],
  ['the capacity auditor parsed a stated total out of real OCR text', parsed?.stated === 124, parsed],
  // The loop, end to end, on real OCR output: read the drawing's own figure,
  // disagree with the count when they disagree, and put that disagreement at
  // the top of the queue pointing at real regions.
  ['capacity loop: a real disagreement is stated as one',
    capacityLoop.differs.factKey === 'fact.capacityDiffers', capacityLoop.differs],
  ['capacity loop: it becomes a CAPACITY contradiction naming both sides',
    !!capacityLoop.differs.contradiction && capacityLoop.differs.contradiction.sides.length === 2,
    capacityLoop.differs.contradiction],
  ['capacity loop: rated serious and queued first',
    capacityLoop.differs.contradiction?.severity === 'high' && capacityLoop.differs.priorityRank === 0,
    { severity: capacityLoop.differs.contradiction?.severity, rank: capacityLoop.differs.priorityRank }],
  ['capacity loop: it points at regions an operator can open',
    capacityLoop.differs.priorityTargets > 0, capacityLoop.differs.priorityTargets],
  ['capacity loop: agreement raises no disagreement',
    capacityLoop.agrees.factKey === 'fact.capacityAgrees' && !capacityLoop.agrees.contradiction,
    capacityLoop.agrees],
  ['no page errors', errs.length === 0, errs.slice(0, 3)],
];

console.log('BOOT:', JSON.stringify(boot, null, 1));
console.log('\nOCR available:', ocr.available, '| ms:', ocr.ms);
console.log('OCR text:', JSON.stringify(ocr.text));
console.log('words:', JSON.stringify((ocr.words || []).slice(0, 14)));
console.log('capacity auditor:', JSON.stringify(parsed));
console.log('capacity loop:', JSON.stringify(capacityLoop, null, 1));

// Reported, not asserted. OCR reads the capacity numbers this product depends
// on at 95-97 confidence and misreads alphanumeric table labels (T01 -> TO1)
// at 57-89. That is a genuine engine limitation, and the architecture already
// says OCR is supporting evidence that never defines object identity -- so it
// is surfaced here rather than either ignored or "fixed" by tuning.
const labelWords = (ocr.words || []).filter(w => /^T[O0]{1,2}\d?$/i.test(w.t));
console.log('\nNOTE — alphanumeric table labels, evidence only, not asserted:',
  JSON.stringify(labelWords), labelWords.some(w => /O/.test(w.t))
    ? '(letter-O for digit-0 confusion present, as documented in MERIT_OCR_STATUS)' : '(read cleanly this run)');

// THE SAME FOLDER, OPENED BY DOUBLE-CLICK. An operator does not run a server.
// Served over HTTP (above) the package read its OCR; opened from disk, Chrome
// would not start the OCR worker from a file:// script and OCR was simply
// unavailable — measured 2026-10-03 on the package handed to the user. So the
// package is opened as a file too, and must read the same text with zero
// off-origin requests.
{
  const fp = await ctx.newPage();
  const fileErrs = [];
  fp.on('pageerror', e => fileErrs.push(e.message));
  await fp.goto('file://' + join(ROOT, 'index.html'));
  await fp.waitForTimeout(1500);
  const fileOcr = await fp.evaluate(async (pdfB64) => {
    const c = document.createElement('canvas'); c.width = 1000; c.height = 200;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 200);
    x.fillStyle = '#000'; x.font = 'bold 44px sans-serif'; x.fillText('TOTAL 124 PAX SAHNE', 60, 90);
    const r = await runPlanOCR(c.toDataURL('image/png'), { timeoutMs: 120000 });
    // A PDF plan, rendered through the package's own pdf.js worker.
    let pdf = null;
    try {
      const bin = atob(pdfB64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const doc = await MeritPdf.getDocument({ data: u }).promise, page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 0.5 }), pc = document.createElement('canvas');
      pc.width = vp.width; pc.height = vp.height;
      await page.render({ canvasContext: pc.getContext('2d'), viewport: vp }).promise;
      pdf = { pages: doc.numPages, width: Math.round(vp.width) };
    } catch (e) { pdf = { error: String(e) }; }
    return { available: r.available, text: r.text, reason: r.reason, booted: typeof globalThis.t === 'function', pdf };
  }, (await readFile(join(REPO, 'benchmarks', 'plans', 'ORNEK.pdf'))).toString('base64'));
  await fp.close();
  const ft = (fileOcr.text || '').toUpperCase();
  checks.push(
    ['opened by double-click (file://): the app boots', fileOcr.booted === true],
    ['opened by double-click (file://): OCR is available', fileOcr.available === true, fileOcr.reason],
    ['opened by double-click (file://): OCR reads "124" and "SAHNE"', ft.includes('124') && ft.includes('SAHNE'), fileOcr.text],
    ['opened by double-click (file://): a PDF plan renders', !!fileOcr.pdf && fileOcr.pdf.pages >= 1 && fileOcr.pdf.width > 0, fileOcr.pdf],
    ['opened by double-click (file://): no page errors', fileErrs.length === 0, fileErrs.slice(0, 3)],
  );
  console.log('\nFILE:// OCR:', JSON.stringify(fileOcr));
}

// Is every source file the app loads actually IN the folder build? The same
// question the light build is asked below, asked of the deliverable an
// operator is told to use.
{
  const artifact = await readFile(join(ROOT, 'index.html'), 'utf8');
  const absent = [];
  for (const rel of appSourceFiles(REPO)) {
    const src = await readFile(join(REPO, rel), 'utf8');
    const mid = Math.floor(src.length / 2);
    if (!artifact.includes(src.slice(mid, mid + 160))) absent.push(rel);
  }
  checks.push(['folder build: every script index.html loads is bundled'
    + (absent.length ? ` (missing: ${absent.join(', ')})` : ''), absent.length === 0]);
}

// ---- the other deliverable: the single email-able file -------------------
// It ships without OCR on purpose. The contract is that it says so rather
// than quietly returning nothing that reads like a result, so that is what
// gets asserted here -- an honest "unavailable" is a passing state.
const LIGHT = join(REPO, 'dist', 'index-offline.html');
if (existsSync(LIGHT)) {
  const lp = await ctx.newPage();
  const lightErrs = [];
  lp.on('pageerror', e => lightErrs.push(e.message));
  await lp.goto('file://' + LIGHT);
  await lp.waitForTimeout(1200);
  const light = await lp.evaluate(async () => {
    const missing = ['guestDialog', 'excelDialog', 'guideDialog', 'toastWrap', 'app', 'floorPlanFile', 'guestFileInput', 'backupFileInput']
      .filter(id => !document.getElementById(id));
    const booted = typeof globalThis.t === 'function' && typeof globalThis.meritTableIndex === 'function' &&
      typeof globalThis.buildPlanIntelligence === 'function' && typeof globalThis.MeritVenueModel === 'object';
    let ocr = null;
    if (typeof globalThis.runPlanOCR === 'function') ocr = await runPlanOCR('data:image/png;base64,iVBORw0KGgo=', { timeoutMs: 4000 });
    // The trained encoder's weights are INLINED rather than fetched, precisely
    // so that they survive into a single file opened from disk. That claim is
    // only worth making if something checks it: run the forward pass here, on
    // this artifact, and confirm it produces a unit vector.
    let encoder = null;
    if (globalThis.MeritPlanEncoder) {
      const probe = new Uint8Array(32 * 32);
      for (let i = 0; i < probe.length; i++) probe[i] = (i * 37) % 256;
      const v = globalThis.MeritPlanEncoder.available ? globalThis.MeritPlanEncoder.encode(probe) : null;
      const provider = globalThis.MeritVisualEmbedding ? globalThis.MeritVisualEmbedding.resolve() : null;
      encoder = {
        available: !!globalThis.MeritPlanEncoder.available,
        parameters: globalThis.MERIT_PLAN_ENCODER_WEIGHTS ? globalThis.MERIT_PLAN_ENCODER_WEIGHTS.parameters : null,
        dims: v ? v.length : 0,
        norm: v ? Math.sqrt(v.reduce((s, x) => s + x * x, 0)) : 0,
        providerId: provider ? provider.id : null,
        trainedModel: provider ? provider.trainedModel : null,
      };
    }
    return { missing, booted, xlsx: typeof globalThis.XLSX, ocr, encoder };
  });
  await lp.close();
  // Is every source file the app loads actually IN the artifact?
  //
  // The `booted` probe below tests four hand-picked globals, and that is
  // exactly why it did not notice when plan-relationships.js and
  // plan-memory.js stopped being bundled: neither defines one of the four.
  // Both offline artifacts shipped without the relationship engine and
  // without plan memory, and both builds reported success.
  //
  // So this asks the question directly and without a list of its own: take
  // the scripts index.html loads, and require a verbatim slice of each one's
  // real content to be present in the built file. A file that was not
  // bundled cannot pass, and a file added to the app tomorrow is covered the
  // moment it is added, with nothing here to remember to update.
  {
    const artifact = await readFile(LIGHT, 'utf8');
    const absent = [];
    for (const rel of appSourceFiles(REPO)) {
      const src = await readFile(join(REPO, rel), 'utf8');
      // A slice from the middle, long enough to be unique to this file and
      // clear of the header comment every one of them starts with.
      const mid = Math.floor(src.length / 2);
      const probe = src.slice(mid, mid + 160);
      if (!artifact.includes(probe)) absent.push(rel);
    }
    checks.push(['light build: every script index.html loads is bundled'
      + (absent.length ? ` (missing: ${absent.join(', ')})` : ''), absent.length === 0]);
  }

  checks.push(
    ['light build: every source file executed', light.booted === true],
    ['light build: the trained encoder is inlined and runs offline',
      !!light.encoder && light.encoder.available === true && light.encoder.dims > 0 &&
      Math.abs(light.encoder.norm - 1) < 1e-4 && light.encoder.parameters > 0],
    ['light build: the learned representation is the one detection would use',
      !!light.encoder && light.encoder.trainedModel === true &&
      /merit-plan-encoder/.test(light.encoder.providerId || '')],
    ['light build: all required dialogs/inputs present', light.missing.length === 0, light.missing],
    ['light build: SheetJS is inlined (XLSX export works with no network)', light.xlsx === 'object'],
    ['light build: OCR reports itself unavailable rather than faking a result',
      light.ocr === null || light.ocr.available === false, light.ocr],
    ['light build: no page errors', lightErrs.length === 0, lightErrs.slice(0, 3)],
    ['light build: still zero off-origin requests after opening it',
      blocked.filter(u => !u.startsWith('chrome-extension')).length === 0,
      [...new Set(blocked)].slice(0, 6)],
  );
  console.log('\nLIGHT BUILD (dist/index-offline.html):', JSON.stringify(light));
} else {
  console.log('\nLIGHT BUILD: dist/index-offline.html not built — skipping (run node scripts/build-offline.mjs)');
}

let failed = 0;
console.log('');
for (const [label, ok, detail] of checks) {
  if (!ok) failed++;
  console.log((ok ? 'OK: ' : 'FAIL: ') + label + (!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
console.log(`\n${checks.length - failed} passed, ${failed} failed`);
await b.close(); srv.close();
process.exit(failed ? 1 : 0);
