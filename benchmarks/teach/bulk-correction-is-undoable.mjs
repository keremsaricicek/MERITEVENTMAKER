// Gate H: one correction repairs a whole family of objects -- and that whole
// action has to be reversible as one unit.
//
// The spread already reported a real match count. What it did not have was an
// undo. A reclassification lives entirely in event.analysis.candidates and
// event.planMemory, and the canvas undo stack snapshots {tables,
// venueObjects, background}, so it could not reach any of it. The more
// objects the spread correctly fixed, the more damage one wrong pick did.
//
// Drives the real review UI throughout.
//
// Usage: node benchmarks/teach/bulk-correction-is-undoable.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1800, height: 1000 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
let passed = 0, failed = 0;
const ok = (c, l, d) => { if (c) { passed++; console.log('OK: ' + l); } else { failed++; console.log('FAIL: ' + l + (d !== undefined ? ' :: ' + JSON.stringify(d) : '')); } };

await p.goto('http://localhost:8000/index.html'); await p.waitForLoadState('networkidle');
await p.click('.appbar [data-action="create-event"]'); await p.waitForTimeout(300);
await p.fill('input[name="name"]', 'Bulk'); await p.fill('input[name="hotel"]', 'Bulk');
await p.fill('input[name="date"]', '2026-10-02');
await p.click('button[data-setup="blank"]'); await p.waitForTimeout(700);
const b64 = fs.readFileSync(path.join(REPO, 'benchmarks/plans/merit-real-venue-plan.png')).toString('base64');
await p.evaluate(src => { state.events[0].background = { src, name: 'p.png', opacity: 1, visible: true, locked: false, scale: 100 }; render(); }, `data:image/png;base64,${b64}`);
await p.waitForTimeout(400);
await p.click('[data-v8-action="detect"]');
await p.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 180000 }).catch(() => {});
await p.waitForTimeout(1000);

// Pick a candidate that actually belongs to a similarity family with other
// unreviewed members, so the spread has something to reach.
const target = await p.evaluate(() => {
  const e = state.events[0], a = e.analysis, pi = a.planIntelligence || {};
  const groups = [...(pi.similarityGroups || []), ...(pi.reviewGroups || [])];
  for (const c of a.candidates) {
    if (c.kind !== 'table' || c.status !== 'unreviewed') continue;
    const g = groups.find(g => (g.memberIds || []).includes(c.id));
    if (!g) continue;
    const family = g.memberIds.filter(id => {
      const o = a.candidates.find(x => x.id === id);
      return o && o.id !== c.id && o.status === 'unreviewed' && o.kind === c.kind && o.type === c.type;
    });
    if (family.length >= 2) {
      ui.selectedCandidateId = c.id; ui.activeReviewGroupId = null; ui.activeQuestionId = null; render();
      return { id: c.id, kind: c.kind, type: c.type, familyIds: family, familySize: family.length };
    }
  }
  return null;
});
ok(!!target, '1. found a candidate with a real similarity family to spread across', target);
if (!target) { console.log('cannot continue'); await b.close(); process.exit(2); }
console.log('target family size:', target.familySize);

const before = await p.evaluate(t => {
  const a = state.events[0].analysis;
  const snap = id => { const c = a.candidates.find(x => x.id === id); return c && { kind: c.kind, type: c.type, status: c.status }; };
  return { target: snap(t.id), family: t.familyIds.map(snap), memory: (state.events[0].planMemory || []).length };
}, target);

// --- the correction, through the real dropdown ---------------------------
await p.selectOption('[data-candidate-edit="kindtype"]', 'venue:chair');
await p.waitForTimeout(400);

const after = await p.evaluate(t => {
  const a = state.events[0].analysis;
  const snap = id => { const c = a.candidates.find(x => x.id === id); return c && { kind: c.kind, type: c.type, status: c.status }; };
  return { target: snap(t.id), family: t.familyIds.map(snap), memory: (state.events[0].planMemory || []).length,
    undoDepth: (ui.correctionUndo || []).length };
}, target);

ok(after.target.kind === 'venue' && after.target.type === 'chair',
  '2. the corrected object took the new class', after.target);
const spreadCount = after.family.filter(f => f && f.kind === 'venue' && f.type === 'chair').length;
ok(spreadCount >= 2, `3. the correction spread to ${spreadCount} family members (a real count, not a claim)`, after.family);
ok(after.memory > before.memory, '4. the corrections were written to plan memory', { before: before.memory, after: after.memory });
ok(after.undoDepth === 1, '5. exactly one undo entry was recorded for the whole action', after.undoDepth);

// --- undo, through the real control --------------------------------------
await p.evaluate(() => { ui.reviewCenterOpen = true; render(); });
await p.waitForTimeout(200);
const undoBtn = await p.$('[data-review-decision-action="undo-correction"]');
ok(!!undoBtn, '6. the Review Center offers an undo affordance for the correction');
if (undoBtn) { await undoBtn.click(); await p.waitForTimeout(500); }

const undone = await p.evaluate(t => {
  const a = state.events[0].analysis;
  const snap = id => { const c = a.candidates.find(x => x.id === id); return c && { kind: c.kind, type: c.type, status: c.status }; };
  return { target: snap(t.id), family: t.familyIds.map(snap), memory: (state.events[0].planMemory || []).length,
    undoDepth: (ui.correctionUndo || []).length };
}, target);

ok(undone.target.kind === before.target.kind && undone.target.type === before.target.type,
  '7. the corrected object is back to its original class', { before: before.target, after: undone.target });
const restoredFamily = undone.family.filter((f, i) => f && before.family[i] && f.kind === before.family[i].kind && f.type === before.family[i].type).length;
ok(restoredFamily === before.family.length,
  `8. every one of the ${before.family.length} spread objects was restored, not just the one that was clicked`,
  { restored: restoredFamily, expected: before.family.length });
ok(undone.memory === before.memory,
  '9. the stored corrections were withdrawn, so the reverted class will not return on Re-Analyze',
  { before: before.memory, afterUndo: undone.memory });
ok(undone.undoDepth === 0, '10. the undo entry was consumed', undone.undoDepth);

console.log(`\n${passed} passed, ${failed} failed`);
console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'clean');
await b.close();
process.exit(failed ? 1 : 0);
