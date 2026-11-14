// SEATING RULES (owner 2026-11-02): "şu iki kişi aynı masaya oturmasın", "VIP'ler önde".
//
// A rule is a note about this event's seating that WARNS — it never moves anybody and
// never blocks a seating (the owner decides). Kept on the event as `seatRules`
// (normalised on every load, like freezes). Pure: no DOM, no state.
//   apart     { kind:"apart", a, b }  — two guest ids that must not share a table
//   vipFront  { kind:"vipFront" }     — a VIP / VVIP guest sits at a VIP table while one has room
// A table is a VIP table when its zone or number says VIP.
(function () {
  "use strict";
  const pax = (g) => Math.max(1, Number(g.pax) || 1);
  const isVipGuest = (g) => /VIP/i.test(String(g.vip || ""));
  const isVipTable = (t) => /VIP/i.test(String(t.zone || "")) || /^VIP/i.test(String(t.number || ""));
  function normalizeAll(list) {
    const out = [], seen = new Set();
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || typeof r !== "object") continue;
      if (r.kind === "apart" && typeof r.a === "string" && typeof r.b === "string" && r.a !== r.b) {
        const k = "apart:" + [r.a, r.b].sort().join("|"); if (seen.has(k)) continue; seen.add(k);
        out.push({ id: typeof r.id === "string" ? r.id : k, kind: "apart", a: r.a, b: r.b });
      } else if (r.kind === "vipFront" && !seen.has("vipFront")) { seen.add("vipFront"); out.push({ id: "vipFront", kind: "vipFront" }); }
    }
    return out;
  }
  // every broken rule, worded by the caller from these facts
  function violations(event) {
    const out = [], guests = event.guests || [], tables = event.tables || [];
    const g = (id) => guests.find((x) => x.id === id), tb = (x) => x && x.assignment ? tables.find((t) => t.id === x.assignment.tableId) : null;
    for (const r of normalizeAll(event.seatRules)) {
      if (r.kind === "apart") { const A = g(r.a), B = g(r.b), ta = tb(A), tbb = tb(B); if (ta && tbb && ta.id === tbb.id) out.push({ kind: "apart", a: A.name, b: B.name, table: ta.number }); }
      if (r.kind === "vipFront") {
        const used = new Map();
        for (const x of guests) if (x.assignment) used.set(x.assignment.tableId, (used.get(x.assignment.tableId) || 0) + pax(x));
        const vipRoom = tables.some((t) => isVipTable(t) && (Number(t.capacity) || 0) - (used.get(t.id) || 0) > 0);
        for (const x of guests) { const t = tb(x); if (isVipGuest(x) && t && !isVipTable(t) && vipRoom) out.push({ kind: "vipFront", name: x.name, table: t.number }); }
      }
    }
    return out;
  }
  globalThis.MeritSeatingRules = Object.freeze({ normalizeAll, violations, isVipTable });
})();
