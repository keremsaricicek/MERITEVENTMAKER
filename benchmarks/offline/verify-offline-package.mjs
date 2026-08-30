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

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
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

const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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

const text = (ocr.text || '').toUpperCase();
const offOrigin = [...new Set(blocked.filter(u => !u.startsWith('chrome-extension')))];
const notBooted = Object.entries(boot).filter(([k, v]) => v === false).map(([k]) => k);

const checks = [
  ['every source file in the bundle executed', notBooted.length === 0, notBooted],
  ['all required dialogs/inputs are present in the markup', boot.dialogs.length === 0, boot.dialogs],
  ['Tesseract + SheetJS loaded from local assets', boot.tesseract === 'object' && boot.xlsx === 'object'],
  ['OCR asset paths point at local files', !!boot.assetPaths && String(boot.assetPaths.workerPath).startsWith('./')],
  ['OCR reported available', ocr.available === true, ocr.reason],
  ['zero off-origin requests were even attempted', offOrigin.length === 0, offOrigin.slice(0, 6)],
  ['read the printed total "124"', text.includes('124')],
  ['read the seating count "114"', text.includes('114')],
  ['read the bistro count "10"', /\b10\b/.test(text)],
  ['read a Turkish venue label (SAHNE)', text.includes('SAHNE')],
  ['returned per-word boxes with confidences, not one blob', (ocr.words || []).length > 0],
  ['the capacity auditor parsed a stated total out of real OCR text', parsed?.stated === 124, parsed],
  ['no page errors', errs.length === 0, errs.slice(0, 3)],
];

console.log('BOOT:', JSON.stringify(boot, null, 1));
console.log('\nOCR available:', ocr.available, '| ms:', ocr.ms);
console.log('OCR text:', JSON.stringify(ocr.text));
console.log('words:', JSON.stringify((ocr.words || []).slice(0, 14)));
console.log('capacity auditor:', JSON.stringify(parsed));

// Reported, not asserted. OCR reads the capacity numbers this product depends
// on at 95-97 confidence and misreads alphanumeric table labels (T01 -> TO1)
// at 57-89. That is a genuine engine limitation, and the architecture already
// says OCR is supporting evidence that never defines object identity -- so it
// is surfaced here rather than either ignored or "fixed" by tuning.
const labelWords = (ocr.words || []).filter(w => /^T[O0]{1,2}\d?$/i.test(w.t));
console.log('\nNOTE — alphanumeric table labels, evidence only, not asserted:',
  JSON.stringify(labelWords), labelWords.some(w => /O/.test(w.t))
    ? '(letter-O for digit-0 confusion present, as documented in MERIT_OCR_STATUS)' : '(read cleanly this run)');

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
    return { missing, booted, xlsx: typeof globalThis.XLSX, ocr };
  });
  await lp.close();
  checks.push(
    ['light build: every source file executed', light.booted === true],
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
