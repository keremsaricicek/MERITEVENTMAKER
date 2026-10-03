// WHICH GUESTS DOES THIS QUERY MEAN? — the one guest-matching engine.
// Ownership area A10, moved out of app-v8.js (benchmarks/APP-V8-OWNERSHIP-MAP.md,
// "extract the matching engine only").
//
// Every search surface in the product — the Global Finder's dropdown and Live's
// door search — must agree on WHICH guests a query matches, over the same
// haystack and the same term-AND-narrowing ("yilmaz vip" narrows, never
// widens). Two independently-written filters is exactly how a query finds
// someone in the appbar and finds nobody at the door. Ranking, limiting and
// presentation are left to the caller because those legitimately differ (a
// 12-row typeahead vs a full, arrival-sorted door list) — neither is a second
// engine.
//
// SPEED IS AN INDEX, NOT A PROMISE. The old search ran a table lookup INSIDE
// the filter, so every keystroke cost O(guests x tables) — on a 4,000-seat
// event that is millions of comparisons per character typed. One lowercase
// haystack per guest is built once per change to the event and scanned
// linearly after that. `guest-finder` measures it rather than asserting it.
//
// Pure: reads no shell state and writes none — "nothing it offers moves a
// guest" is the finder's contract, and this half of it cannot even see a
// control. The table-number format is the shell's (`formatTableNumber` in
// app.js) and is INJECTED, so the haystack carries the same "T 07" the
// operator reads on screen. Characterized by `guest-finder` and
// `live-door-keys`.
(() => {
  "use strict";

  // One engine per caller, each with its own cached index.
  function create({ formatNumber }) {
    let cache = null;
    function index(event) {
      // touchEvent() stamps lastModified on every mutation, so it is the
      // cheapest honest invalidation signal there is. The lengths are in the
      // key too, because an import can add guests inside one millisecond.
      const sig = `${event.id}|${event.lastModified}|${event.guests.length}|${event.tables.length}`;
      if (cache && cache.sig === sig) return cache;
      const tables = new Map(event.tables.map((t) => [t.id, t]));
      const rows = event.guests.map((g) => {
        const table = g.assignment ? tables.get(g.assignment.tableId) || null : null;
        return { guest: g, table,
          name: String(g.name || "").toLocaleLowerCase("tr"),
          // Everything the phase asks to search by: names, the host or company
          // that brought them, VIP level, planning and arrival status, the
          // table number and its zone. `invitedBy` is where this data model
          // keeps both the host and the company — there is no separate company
          // field, and inventing one would be a field nobody fills in.
          hay: [g.name, g.vip, g.invitedBy, g.notes, g.planningStatus, g.arrivalStatus,
            table ? table.number : "", table ? formatNumber(table.number) : "", table ? table.zone : ""]
            .filter(Boolean).join(" ").toLocaleLowerCase("tr") };
      });
      cache = { sig, rows, tables };
      return cache;
    }
    // Every guest the query matches, and the terms it was split into.
    function matchRows(event, query) {
      const q = String(query || "").trim().toLocaleLowerCase("tr");
      if (!q) return { rows: [], terms: [] };
      const terms = q.split(/\s+/).filter(Boolean);
      return { rows: index(event).rows.filter((row) => terms.every((term) => row.hay.includes(term))), terms };
    }
    // The typeahead's ranking: by how the name matched, then alphabetically,
    // so the order is stable between keystrokes rather than depending on
    // record order.
    function findGuests(event, query, limit = 12) {
      const { rows: matched, terms } = matchRows(event, query);
      if (!terms.length) return { rows: [], total: 0 };
      const hits = matched.map((row) => ({ row,
        rank: row.name.startsWith(terms[0]) ? 0 : row.name.includes(terms[0]) ? 1 : 2 }));
      hits.sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name, "tr"));
      return { rows: hits.slice(0, limit).map((h) => h.row), total: hits.length };
    }
    return { index, matchRows, findGuests };
  }

  // The party is the people the same host brought. It is NOT the guest's own
  // companions — those are already inside the record as pax, and a "party" of
  // one record showing itself tells an operator nothing. `invitedBy` is the
  // only grouping in this data that survives a guest not being seated yet.
  function partyOf(event, guest) {
    const host = String(guest.invitedBy || "").trim();
    if (!host) return [];
    return event.guests.filter((g) => String(g.invitedBy || "").trim() === host);
  }

  globalThis.MeritGuestSearch = { version: 1, create, partyOf };
})();
