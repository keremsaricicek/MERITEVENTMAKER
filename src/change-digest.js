// WHAT CHANGED SINCE THE LAST WORKING DAY (owner 2026-11-02: F8 "dünden beri ne değişti").
//
// The audit trail records decisions, not every seat change, so the answer is a
// comparison: a small picture of the event (who, which table, how many, VIP,
// arrived; which tables, how many seats) taken at the first open of each day,
// compared with the event now. Pure: no storage, no DOM — the shell keeps the
// pictures (localStorage, one per event: today's first and the previous day's).
// Names stay on this machine; nothing is sent anywhere.
(function () {
  "use strict";
  const pax = (g) => Math.max(1, Number(g.pax) || 1);
  function snapshot(event, at) {
    const tables = {}, guests = {};
    for (const t of event.tables || []) tables[t.id] = { n: String(t.number), c: Number(t.capacity) || 0 };
    for (const g of event.guests || []) guests[g.id] = { n: String(g.name || ""), t: g.assignment ? g.assignment.tableId : null, p: pax(g), v: String(g.vip || ""), a: g.arrivalStatus || "" };
    return { at: at || new Date().toISOString(), tables, guests };
  }
  // The day's pictures, kept as { day, cur, prevDay, prev }: the first picture of a new day
  // moves the old one to `prev`. Returns the record to store (unchanged when today already has one).
  function roll(rec, event, today) {
    if (rec && rec.day === today) return rec;
    const snap = snapshot(event);
    return rec && rec.cur ? { day: today, cur: snap, prevDay: rec.day, prev: rec.cur } : { day: today, cur: snap, prevDay: null, prev: null };
  }
  function diff(before, event) {
    const now = snapshot(event), tno = (snap, id) => (id && snap.tables[id] ? snap.tables[id].n : null);
    const out = { added: [], removed: [], moved: [], pax: [], vip: [], arrived: 0, tablesAdded: [], tablesRemoved: [], capacity: [] };
    if (!before) return null;
    for (const [id, g] of Object.entries(now.guests)) {
      const b = before.guests[id];
      if (!b) { out.added.push(g.n); continue; }
      const from = tno(before, b.t), to = tno(now, g.t);
      if ((b.t || null) !== (g.t || null) || from !== to) out.moved.push({ name: g.n, from, to });
      if (b.p !== g.p) out.pax.push({ name: g.n, from: b.p, to: g.p });
      if (b.v !== g.v) out.vip.push({ name: g.n, from: b.v, to: g.v });
      if (b.a !== "Checked In" && g.a === "Checked In") out.arrived++;
    }
    for (const [id, g] of Object.entries(before.guests)) if (!now.guests[id]) out.removed.push(g.n);
    for (const [id, t] of Object.entries(now.tables)) { const b = before.tables[id]; if (!b) out.tablesAdded.push(t.n); else if (b.c !== t.c) out.capacity.push({ number: t.n, from: b.c, to: t.c }); }
    for (const [id, t] of Object.entries(before.tables)) if (!now.tables[id]) out.tablesRemoved.push(t.n);
    out.count = out.added.length + out.removed.length + out.moved.length + out.pax.length + out.vip.length + out.tablesAdded.length + out.tablesRemoved.length + out.capacity.length;
    return out;
  }
  globalThis.MeritChangeDigest = Object.freeze({ snapshot, roll, diff });
})();
