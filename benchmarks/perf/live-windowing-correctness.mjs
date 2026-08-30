// GATE 20 guard: the Live list is windowed, and windowing must not change a
// single thing an operator relies on.
//
// The window caps DOM rows only. The filter, the arrival sort, the metric
// counts and liveVisibleIds (which arms Enter-to-check-in) all still run over
// every guest. If any of those started reading the window instead, Enter could
// fire on the wrong person and the counts would silently under-report -- both
// worse than a slow screen.
//
// Usage: node benchmarks/perf/live-windowing-correctness.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
let passed = 0, failed = 0;
const ok = (c, l, d) => { if (c) { passed++; console.log('OK: ' + l); } else { failed++; console.log('FAIL: ' + l + (d !== undefined ? ' :: ' + JSON.stringify(d) : '')); } };

await p.goto('http://localhost:8000/index.html'); await p.waitForLoadState('networkidle');
await p.click('.appbar [data-action="create-event"]'); await p.waitForTimeout(300);
await p.fill('input[name="name"]', 'LiveWin'); await p.fill('input[name="hotel"]', 'M');
await p.fill('input[name="date"]', '2026-12-31');
await p.click('button[data-setup="blank"]'); await p.waitForTimeout(700);

const built = await p.evaluate(() => {
  const e = state.events[0];
  e.tables = Array.from({ length: 50 }, (_, i) => ({
    id: 't' + i, number: 'T' + String(i + 1).padStart(2, '0'), type: 'round',
    x: 0, y: 0, w: 100, h: 100, capacity: 10, zone: 'M', rotation: 0, locked: false, z: 10,
    hasPhysicalSeats: true,
    chairs: Array.from({ length: 10 }, (_, s) => ({ id: 'c' + i + '_' + s, parentTableId: 't' + i, seatNumber: s + 1, x: 50, y: 50, rotation: 0, occupancy: null })),
  }));
  const arr = ['Not Arrived', 'Checked In', 'No Show'];
  e.guests = Array.from({ length: 900 }, (_, i) => ({
    id: 'g' + i, name: 'GUEST ' + String(i + 1).padStart(4, '0'), additionalGuests: 0, pax: 1,
    planningStatus: 'Confirmed', vip: 'Standard', arrivalStatus: arr[i % 3],
    invitedBy: 'H', notes: '', assignment: null, createdAt: new Date().toISOString(),
  }));
  ui.tab = 'live'; ui.liveQuery = ''; render();
  const counts = { notArrived: e.guests.filter(g => g.arrivalStatus === 'Not Arrived').length,
    checked: e.guests.filter(g => g.arrivalStatus === 'Checked In').length,
    noShow: e.guests.filter(g => g.arrivalStatus === 'No Show').length };
  return { total: e.guests.length, counts };
});
await p.waitForTimeout(400);

const first = await p.evaluate(() => ({
  rows: document.querySelectorAll('.arrival-row').length,
  hasMore: !!document.getElementById('liveMore'),
  metricValues: [...document.querySelectorAll('.mx-metric-value')].map(n => n.textContent.trim()),
}));
ok(first.rows > 0 && first.rows < 900, `1. the list is windowed (${first.rows} rows mounted of 900)`, first.rows);
ok(first.hasMore, '2. the screen says more rows exist and offers a way to them');

// --- counts must reflect ALL guests, not the window ------------------------
ok(first.metricValues.includes(String(built.counts.checked)),
  `3. Arrived metric counts every guest (${built.counts.checked}), not just mounted rows`, first.metricValues);
ok(first.metricValues.includes(String(built.counts.notArrived)),
  `4. Still Expected counts every guest (${built.counts.notArrived})`, first.metricValues);
ok(first.metricValues.includes(String(built.counts.noShow)),
  `5. No Show counts every guest (${built.counts.noShow})`, first.metricValues);

// --- arrival sort must be global, not per-window --------------------------
const order = await p.evaluate(() =>
  [...document.querySelectorAll('.arrival-row')].slice(0, 40)
    .map(r => r.className.includes('is-in') ? 'in' : r.className.includes('is-no') ? 'no' : 'not'));
ok(order.every(v => v === 'not'),
  '6. Not Arrived still sort first — the window takes the top of the SORTED list', order.slice(0, 8));

// --- Enter-to-check-in arms on the full match set -------------------------
// A guest far beyond the window must still be reachable and checkable.
const deep = await p.evaluate(() => {
  const e = state.events[0];
  const target = e.guests.find(g => g.name === 'GUEST 0850' && g.arrivalStatus !== 'Checked In')
    || e.guests[849];
  target.arrivalStatus = 'Not Arrived';
  return { name: target.name, id: target.id };
});
await p.fill('#liveSearch', deep.name);
await p.waitForTimeout(500);
const armed = await p.evaluate(() => ({
  rows: document.querySelectorAll('.arrival-row').length,
  armed: document.querySelectorAll('.arrival-row.is-armed').length,
  hasMore: !!document.getElementById('liveMore'),
}));
ok(armed.rows === 1, '7. a guest far past the window is still findable by search', armed);
ok(armed.armed === 1, '8. Enter is armed for that single match', armed);
ok(!armed.hasMore, '9. no "show more" when the whole match set fits');

await p.press('#liveSearch', 'Enter');
await p.waitForTimeout(500);
const afterEnter = await p.evaluate(id => {
  const g = state.events[0].guests.find(x => x.id === id);
  return { status: g.arrivalStatus, query: ui.liveQuery, focused: document.activeElement?.id };
}, deep.id);
ok(afterEnter.status === 'Checked In', '10. Enter checked in the RIGHT guest', afterEnter);
ok(afterEnter.query === '', '11. the query cleared for the next guest', afterEnter);
ok(afterEnter.focused === 'liveSearch', '12. focus returned to the search field', afterEnter);

// --- the window resets when the query changes -----------------------------
const reset = await p.evaluate(() => ({ window: ui.liveWindow, rows: document.querySelectorAll('.arrival-row').length }));
ok(reset.rows < 900, '13. clearing the search returns to a windowed list', reset);

// --- growing the window keeps everything consistent -----------------------
const grown = await p.evaluate(async () => {
  const before = document.querySelectorAll('.arrival-row').length;
  document.querySelector("[data-live-action='show-more']")?.click();
  await new Promise(r => setTimeout(r, 400));
  return { before, after: document.querySelectorAll('.arrival-row').length,
    stillSorted: [...document.querySelectorAll('.arrival-row')].slice(0, 30)
      .every(r => !r.className.includes('is-in') && !r.className.includes('is-no')) };
});
ok(grown.after > grown.before, `14. Show more mounts additional rows (${grown.before} -> ${grown.after})`, grown);
ok(grown.stillSorted, '15. the sort still holds after growing', grown);

// --- No Show from a windowed row still behaves ----------------------------
const noShow = await p.evaluate(async () => {
  const btn = document.querySelector('[data-arrival="No Show"]');
  const id = btn?.dataset.liveGuest;
  const before = state.events[0].guests.find(g => g.id === id);
  const planBefore = before?.planningStatus, assignBefore = before?.assignment;
  btn?.click();
  await new Promise(r => setTimeout(r, 400));
  const g = state.events[0].guests.find(x => x.id === id);
  return { arrival: g.arrivalStatus, planningUnchanged: g.planningStatus === planBefore,
    assignmentUnchanged: JSON.stringify(g.assignment) === JSON.stringify(assignBefore) };
});
ok(noShow.arrival === 'No Show', '16. No Show works from a windowed row', noShow);
ok(noShow.planningUnchanged && noShow.assignmentUnchanged,
  '17. No Show still leaves planning status and the planned seat untouched', noShow);

console.log(`\n${passed} passed, ${failed} failed`);
console.log('ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 'clean');
await b.close();
process.exit(failed ? 1 : 0);
