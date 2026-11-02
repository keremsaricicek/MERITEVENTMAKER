// GROUPS AND JUNKETS (owner 2026-11-02: "Junket resmi Kerem Sarıçiçek … hepsini aynı masaya al").
//
// A group is every guest of one event whose "Davet Eden" (guest.invitedBy) names the
// same host — folded, so "KEREM SARICICEK" and "Kerem Sarıçiçek" are one host. Pure:
// reads an event, writes nothing. The seating plan it proposes goes through the
// assistant's acting layer (MeritSeatAssignment), shown first and confirmed.
//
//   TOGETHER MEANS ONE TABLE when one table can take the whole party; otherwise the
//     fewest neighbouring tables (nearest to the first), never splitting one record.
//   A SEAT ALREADY TAKEN IS NEVER TAKEN: free room counts the guests sitting there.
//   AN UNAVAILABLE TABLE (table.availability) IS NEVER USED.
(function () {
  "use strict";
  const fold = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const pax = (g) => Math.max(1, Number(g.pax) || 1);
  const T = () => globalThis.MeritAssistantTools;
  // hosts named in this event, with their guests
  function hosts(event) {
    const m = new Map();
    for (const g of event.guests || []) {
      const k = fold(g.invitedBy);
      if (!k) continue;
      if (!m.has(k)) m.set(k, { host: String(g.invitedBy).trim(), guests: [] });
      m.get(k).guests.push(g);
    }
    return [...m.values()];
  }
  // the host a typed name means: same folded words, case endings and one slip forgiven
  function findHost(event, typed) {
    const q = fold(typed).split(" ").filter(Boolean);
    if (!q.length) return { none: true };
    const hit = hosts(event).filter((h) => { const w = fold(h.host).split(" "); return q.every((x) => w.some((y) => (T() && T().sameWord ? T().sameWord(x, y) : y.startsWith(x)))); });
    return hit.length === 1 ? { group: hit[0] } : hit.length ? { ambiguous: hit.map((h) => h.host) } : { none: true };
  }
  const usable = (t) => (Number(t.capacity) || 0) > 0 && t.availability !== "UNAVAILABLE";
  function freeAt(event, table, exceptIds) {
    const used = (event.guests || []).filter((g) => g.assignment && g.assignment.tableId === table.id && !exceptIds.has(g.id)).reduce((n, g) => n + pax(g), 0);
    return Math.max(0, (Number(table.capacity) || 0) - used);
  }
  // Where the whole group should sit: [{guestId, tableId}] or { ask } when there is no room.
  function plan(event, group, wantTable) {
    const ids = new Set(group.guests.map((g) => g.id)), need = group.guests.reduce((n, g) => n + pax(g), 0);
    const tables = (event.tables || []).filter(usable);
    if (wantTable) {
      const t = tables.find((x) => fold(x.number) === fold(wantTable));
      if (!t) return { ask: "table" };
      if (freeAt(event, t, ids) < need) return { ask: "room", need, free: freeAt(event, t, ids), table: t.number };
      return { steps: group.guests.map((g) => ({ guestId: g.id, tableId: t.id })), tables: [t.number] };
    }
    // one table: prefer the one most of the group already sits at, then the tightest fit
    const already = (t) => group.guests.filter((g) => g.assignment && g.assignment.tableId === t.id).reduce((n, g) => n + pax(g), 0);
    const one = tables.filter((t) => freeAt(event, t, ids) >= need).sort((a, b) => already(b) - already(a) || freeAt(event, a, ids) - freeAt(event, b, ids));
    if (one.length) return { steps: group.guests.map((g) => ({ guestId: g.id, tableId: one[0].id })), tables: [one[0].number] };
    // neighbouring tables: start at the roomiest, add the nearest until everyone fits (records kept whole)
    const pos = (t) => [Number(t.x) || 0, Number(t.y) || 0], dist = (a, b) => Math.hypot(pos(a)[0] - pos(b)[0], pos(a)[1] - pos(b)[1]);
    const start = tables.slice().sort((a, b) => freeAt(event, b, ids) - freeAt(event, a, ids))[0];
    if (!start) return { ask: "room", need, free: 0 };
    const order = tables.slice().sort((a, b) => dist(a, start) - dist(b, start));
    const room = new Map(order.map((t) => [t.id, freeAt(event, t, ids)])), steps = [], used = [];
    for (const g of group.guests.slice().sort((a, b) => pax(b) - pax(a))) {
      const t = order.find((x) => room.get(x.id) >= pax(g));
      if (!t) return { ask: "room", need, free: [...room.values()].reduce((a, b) => a + b, 0) };
      room.set(t.id, room.get(t.id) - pax(g)); steps.push({ guestId: g.id, tableId: t.id }); if (!used.includes(t.number)) used.push(t.number);
    }
    return { steps, tables: used };
  }
  // groups sitting at more than one table (for "bugün ne eksik" and the seating warning)
  function spread(event) {
    const out = [];
    for (const h of hosts(event)) {
      const at = new Map();
      for (const g of h.guests) if (g.assignment) { const t = (event.tables || []).find((x) => x.id === g.assignment.tableId); if (t) at.set(t.number, (at.get(t.number) || 0) + pax(g)); }
      if (at.size > 1) out.push({ host: h.host, tables: [...at.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n) });
    }
    return out;
  }
  // per host: expected and arrived people (the Live counter, the junket line in reports)
  function counts(event) {
    return hosts(event).map((h) => ({ host: h.host, expected: h.guests.reduce((n, g) => n + pax(g), 0),
      came: h.guests.filter((g) => g.arrivalStatus === "Checked In").reduce((n, g) => n + pax(g), 0),
      noShow: h.guests.filter((g) => g.arrivalStatus === "No Show").reduce((n, g) => n + pax(g), 0) })).sort((a, b) => b.expected - a.expected);
  }
  globalThis.MeritGuestGroups = Object.freeze({ hosts, findHost, plan, spread, counts });
})();
