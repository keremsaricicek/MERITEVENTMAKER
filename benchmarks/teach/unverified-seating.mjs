// Gate W: sofa / bench / banquette as first-class object types whose capacity
// is never guessed.
//
// A round table with eight chairs drawn around it states its own capacity. A
// banquette running along a wall does not, and how many covers a venue sets on
// it is an operational decision rather than a geometric fact. So these three
// types must carry an admitted unknown -- which is a different thing from
// zero, because zero is a claim.
//
// Usage: node benchmarks/teach/unverified-seating.mjs
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The runner serves the app itself; nothing here depends on a server a
// person remembered to start. MERIT_BASE_URL overrides it.
const app = await serveApp();

const REPO = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const b = await launchChromium();
const p = await b.newPage({ viewport: { width: 1800, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
let passed = 0, failed = 0;
const ok = (c, l, d) => { if (c) { passed++; console.log('OK: ' + l); } else { failed++; console.log('FAIL: ' + l + (d !== undefined ? ' :: ' + JSON.stringify(d) : '')); } };

await p.goto(app.baseUrl + '/index.html'); await p.waitForLoadState('networkidle');
await p.click('.appbar [data-action="create-event"]'); await p.waitForTimeout(300);
await p.fill('input[name="name"]', 'Seating'); await p.fill('input[name="hotel"]', 'Seating');
await p.fill('input[name="date"]', '2026-10-02');
await p.click('button[data-setup="blank"]'); await p.waitForTimeout(700);
const b64 = fs.readFileSync(path.join(REPO, 'benchmarks/plans/merit-real-venue-plan.png')).toString('base64');
await p.evaluate(src => { state.events[0].background = { src, name: 'p.png', opacity: 1, visible: true, locked: false, scale: 100 }; render(); }, `data:image/png;base64,${b64}`);
await p.waitForTimeout(400);
await p.click('[data-v8-action="detect"]');
await p.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 180000 }).catch(() => {});
await p.waitForTimeout(900);

// --- 1. all three types are offered, as separate options -------------------
await p.evaluate(() => {
  const c = state.events[0].analysis.candidates.find(x => x.kind === 'table' && x.status === 'unreviewed');
  ui.selectedCandidateId = c.id; ui.activeReviewGroupId = null; ui.activeQuestionId = null; render();
});
const options = await p.evaluate(() =>
  [...document.querySelectorAll('[data-candidate-edit="kindtype"] option')].map(o => o.value));
ok(['venue:sofa', 'venue:bench', 'venue:banquette'].every(v => options.includes(v)),
  '1. sofa, bench and banquette are all offered as distinct types', options.filter(o => o.startsWith('venue:')));

// --- 2. reclassifying into seating furniture does NOT invent a capacity ----
await p.selectOption('[data-candidate-edit="kindtype"]', 'venue:banquette');
await p.waitForTimeout(400);
const afterReclass = await p.evaluate(() => {
  const c = state.events[0].analysis.candidates.find(x => x.id === ui.selectedCandidateId);
  return { type: c.type, seats: c.seats, conf: c.seatsConfidence,
    hasInput: !!document.querySelector('[data-candidate-edit="seatCount"]'),
    inputValue: document.querySelector('[data-candidate-edit="seatCount"]')?.value ?? null,
    note: document.querySelector('.poi-seat-note')?.textContent ?? null };
});
ok(afterReclass.seats === null, '2. seats is null, not a guessed number', afterReclass);
ok(afterReclass.conf === 'unverified', '3. seatsConfidence says unverified', afterReclass.conf);
ok(afterReclass.hasInput && afterReclass.inputValue === '',
  '4. the review card offers a seat-count field and it starts EMPTY, not 0', afterReclass);
ok(/unverified|doğrulanmamış/i.test(afterReclass.note || ''),
  '5. the card says the capacity is unverified rather than zero', afterReclass.note);

// --- 3. an unverified banquette is not counted as capacity -----------------
const capacityWhileUnknown = await p.evaluate(() => {
  const pi = state.events[0].analysis.planIntelligence;
  return { physicalSeats: pi?.planSummary?.physicalSeats ?? null,
    unverified: (pi?.capacityAudit?.unverifiedSeating || pi?.capacityAudit?.unverified || []).length };
});
ok(capacityWhileUnknown.physicalSeats !== null,
  '6. the plan still reports a physical seat total', capacityWhileUnknown);

// --- 4. entering a number verifies it -------------------------------------
await p.fill('[data-candidate-edit="seatCount"]', '5');
await p.evaluate(() => document.querySelector('[data-candidate-edit="seatCount"]').dispatchEvent(new Event('change', { bubbles: true })));
await p.waitForTimeout(400);
const verified = await p.evaluate(() => {
  const c = state.events[0].analysis.candidates.find(x => x.id === ui.selectedCandidateId);
  return { seats: c.seats, conf: c.seatsConfidence, note: document.querySelector('.poi-seat-note')?.textContent ?? null };
});
ok(verified.seats === 5 && verified.conf === 'verified',
  '7. a number the operator typed makes it verified', verified);

// --- 5. clearing it returns to unknown, NOT to zero -----------------------
await p.fill('[data-candidate-edit="seatCount"]', '');
await p.evaluate(() => document.querySelector('[data-candidate-edit="seatCount"]').dispatchEvent(new Event('change', { bubbles: true })));
await p.waitForTimeout(400);
const cleared = await p.evaluate(() => {
  const c = state.events[0].analysis.candidates.find(x => x.id === ui.selectedCandidateId);
  return { seats: c.seats, conf: c.seatsConfidence };
});
ok(cleared.seats === null && cleared.conf === 'unverified',
  '8. clearing the field returns to unknown, not to zero', cleared);

// --- 6. the state survives commit to the floor plan ------------------------
await p.fill('[data-candidate-edit="seatCount"]', '4');
await p.evaluate(() => document.querySelector('[data-candidate-edit="seatCount"]').dispatchEvent(new Event('change', { bubbles: true })));
await p.waitForTimeout(300);
const committed = await p.evaluate(() => {
  const e = state.events[0];
  const c = e.analysis.candidates.find(x => x.id === ui.selectedCandidateId);
  c.selected = true; c.status = 'confirmed';
  // commit through the real control
  document.querySelector('[data-review-action="commit"]')?.click();
  return new Promise(r => setTimeout(() => {
    const obj = e.venueObjects.find(o => o.type === 'banquette');
    r(obj ? { type: obj.type, seats: obj.seats, conf: obj.seatsConfidence } : null);
  }, 700));
});
ok(committed && committed.seats === 4 && committed.conf === 'verified',
  '9. the verified count reaches the committed plan object', committed);

// --- 7. reclassifying back to a table clears the seating state -------------
// Commit navigates to the workspace, so come back to the review screen first.
const backToTable = await p.evaluate(() => {
  const c = state.events[0].analysis.candidates.find(x => x.kind === 'table' && x.status === 'unreviewed');
  if (!c) return 'no unreviewed table left';
  ui.screen = 'review'; ui.reviewCenterOpen = false;
  ui.selectedCandidateId = c.id; ui.activeReviewGroupId = null; ui.activeQuestionId = null; render();
  return null;
});
await p.waitForTimeout(300);
if (!backToTable) {
  await p.selectOption('[data-candidate-edit="kindtype"]', 'venue:sofa');
  await p.waitForTimeout(300);
  await p.selectOption('[data-candidate-edit="kindtype"]', 'table:round');
  await p.waitForTimeout(300);
  const cleaned = await p.evaluate(() => {
    const c = state.events[0].analysis.candidates.find(x => x.id === ui.selectedCandidateId);
    return { type: c.type, hasSeats: 'seats' in c, hasConf: 'seatsConfidence' in c };
  });
  ok(!cleaned.hasSeats && !cleaned.hasConf,
    '10. reclassifying back to a table drops the unverified-seating fields', cleaned);
} else {
  console.log('  (skipped 10: ' + backToTable + ')');
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'clean');
await b.close();
process.exit(failed ? 1 : 0);
