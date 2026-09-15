// WHAT MAY NOT BE SEATED, AND WHO SAID SO.
//
// A freeze is a person's decision that part of the room is not available to
// the seating process: the VIP area until the host confirms it, the head
// tables, the sponsor block, a management hold, seats kept back for late
// arrivals. It is not a lock on one guest's chair (guest.assignment.locked
// already does that) — it is a rule about a PLACE, and it applies to whoever
// happens to be there.
//
// Four rules shaped this module:
//
//   THE FREEZE IS A RULE, NOT A LIST OF TABLES. A zone freeze covers the zone,
//   so a table moved into VIP tomorrow is frozen tomorrow; a range freeze
//   covers T01–T10, so a T07 created later is frozen the moment it exists.
//   Resolving to table ids at creation time would have produced a rule that
//   silently stopped covering the thing it was written about.
//
//   THREE STATES, AND THE THIRD IS ABOUT AN OPERATION. A table is OPEN or
//   FROZEN — that is its resting state. SUPERVISOR OVERRIDE REQUIRED is not a
//   fourth kind of table: it is the state an OPERATION is in when it would
//   cross a freeze. Naming it as a table state would imply some tables are
//   pre-authorised, and none are.
//
//   AN OVERRIDE AUTHORISES ONE OPERATION AND NEVER LIFTS THE FREEZE. After a
//   supervisor overrides one move, the area is still frozen and the next move
//   is challenged again. "Never silently unlock" is structural here: this
//   module has no function that clears a freeze as a side effect of anything.
//
//   NOTHING HERE MUTATES. Same discipline as the seating advisor: this reads
//   the room and returns a report. The caller decides what to do with it, and
//   the only thing that writes an assignment is still assignGuestToTable().
//
// Language: the strings in this file are names and English fallbacks, and are
// DATA. Every operator-facing sentence is rendered from the enum by the screen.
(function () {
  "use strict";

  // What a freeze is written about. Three shapes, because an operator says
  // "the VIP area", "tables 1 to 10" or "that table" and means three different
  // things that age differently as the room changes.
  const SCOPE = {
    ZONE: "ZONE",               // every table carrying this zone name
    TABLE_GROUP: "TABLE_GROUP", // a printed-number range, e.g. T01–T10
    TABLE: "TABLE",             // one table, by id
  };

  // The three states the programme names. OPEN and FROZEN describe a table;
  // OVERRIDE_REQUIRED describes an operation that would cross a freeze.
  const STATE = {
    OPEN: "OPEN",
    FROZEN: "FROZEN",
    OVERRIDE_REQUIRED: "OVERRIDE_REQUIRED",
  };

  // Why the area is held. A closed set, because "why" has to survive a
  // handover to somebody who was not in the room when it was decided, and a
  // free-text note alone does not. The note is kept as well, not instead.
  const REASON = {
    VIP_AREA: "VIP_AREA",
    HEAD_TABLES: "HEAD_TABLES",
    SPONSOR_TABLES: "SPONSOR_TABLES",
    MANAGEMENT_HOLD: "MANAGEMENT_HOLD",
    LATE_ARRIVAL_RESERVE: "LATE_ARRIVAL_RESERVE",
    OTHER: "OTHER",
  };

  // Which way the operation crosses the freeze. Both directions count: filling
  // a held area breaks the hold, and emptying a frozen head table breaks the
  // arrangement the freeze was protecting.
  const DIRECTION = { INTO: "INTO", OUT_OF: "OUT_OF" };

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);
  const upper = (s) => String(s == null ? "" : s).trim().toLocaleUpperCase("tr");
  const seatable = (t) => t && t.hasPhysicalSeats !== false && num(t.capacity) > 0;

  // "T01" -> { prefix:"T", n:1 }. The same shape the table numbering uses
  // everywhere else in the product (letters then digits, leading zeros
  // insignificant), so a range an operator types matches what they read on
  // the plan.
  const NUMBER_RE = /^\s*([A-Za-zÇĞİÖŞÜçğıöşü]*)\s*0*(\d+)\s*$/;
  function parseTableNumber(value) {
    const m = NUMBER_RE.exec(String(value == null ? "" : value));
    return m ? { prefix: m[1].toLocaleUpperCase("tr"), n: Number(m[2]) } : null;
  }

  // ---------------------------------------------------------------------------

  // A stored freeze, cleaned. Returns null for anything that could not be a
  // rule — a freeze that covers nothing definable is worse than no freeze,
  // because the UI would show a held area that holds nothing.
  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const scope = SCOPE[raw.scope] || null;
    const id = String(raw.id || "").trim();
    if (!scope || !id) return null;
    const f = {
      id, scope,
      reason: REASON[raw.reason] || REASON.OTHER,
      note: String(raw.note == null ? "" : raw.note).slice(0, 400),
      createdAt: raw.createdAt || null,
      createdBy: String(raw.createdBy == null ? "" : raw.createdBy).slice(0, 120),
    };
    if (scope === SCOPE.ZONE) {
      f.zone = String(raw.zone == null ? "" : raw.zone).trim();
      if (!f.zone) return null;
    } else if (scope === SCOPE.TABLE) {
      f.tableId = String(raw.tableId || "").trim();
      if (!f.tableId) return null;
    } else {
      f.prefix = upper(raw.prefix);
      const from = Math.max(0, Math.round(Number(raw.from)));
      const to = Math.max(0, Math.round(Number(raw.to)));
      if (!isFinite(from) || !isFinite(to)) return null;
      f.from = Math.min(from, to);
      f.to = Math.max(from, to);
    }
    return f;
  }

  const normalizeAll = (list) =>
    (Array.isArray(list) ? list : []).map(normalize).filter(Boolean);

  // Does this rule cover this table? Evaluated against the table as it is NOW,
  // which is the whole point of storing a rule rather than a resolved list.
  function covers(freeze, table) {
    if (!freeze || !table) return false;
    if (freeze.scope === SCOPE.TABLE) return table.id === freeze.tableId;
    if (freeze.scope === SCOPE.ZONE) return upper(table.zone) === upper(freeze.zone);
    const parsed = parseTableNumber(table.number);
    return !!parsed && parsed.prefix === freeze.prefix
      && parsed.n >= freeze.from && parsed.n <= freeze.to;
  }

  const freezesOnTable = (freezes, table) =>
    normalizeAll(freezes).filter((f) => covers(f, table));

  const tablesCovered = (freeze, tables) => {
    const f = normalize(freeze);
    return f ? (tables || []).filter((t) => covers(f, t)) : [];
  };

  // OPEN or FROZEN. Never OVERRIDE_REQUIRED — that is an operation's state.
  function tableState(freezes, table) {
    return freezesOnTable(freezes, table).length ? STATE.FROZEN : STATE.OPEN;
  }

  // The resolved answer the seating advisor consumes. It is deliberately a
  // plain list of { tableId, freezeId, reason } rather than the freeze objects:
  // the advisor must not learn the freeze RULES, only their outcome, so freeze
  // policy stays in exactly one file.
  function resolve(freezes, tables) {
    const rules = normalizeAll(freezes), out = [];
    for (const t of tables || []) {
      for (const f of rules) {
        if (covers(f, t)) out.push({ tableId: t.id, freezeId: f.id, reason: f.reason });
      }
    }
    return out;
  }

  const frozenTableIds = (freezes, tables) =>
    new Set(resolve(freezes, tables).map((r) => r.tableId));

  // How much of the room a freeze is holding. An operator who cannot seat 40
  // pax needs to know whether the chairs exist and are held, or do not exist —
  // those are two completely different evenings.
  function heldCapacity(freezes, tables, guests) {
    const frozen = frozenTableIds(freezes, tables);
    const held = (tables || []).filter((t) => seatable(t) && frozen.has(t.id));
    const chairs = held.reduce((n, t) => n + num(t.capacity), 0);
    const seated = (guests || []).reduce(
      (n, g) => n + (g && g.assignment && frozen.has(g.assignment.tableId) ? paxOf(g) : 0), 0);
    return { tables: held.length, chairs, seated, open: Math.max(0, chairs - seated) };
  }

  // Chairs the seating process may actually use right now: seatable, not
  // frozen, not already sat on.
  function openCapacityOutsideFreeze(freezes, tables, guests) {
    const frozen = frozenTableIds(freezes, tables);
    const usable = (tables || []).filter((t) => seatable(t) && !frozen.has(t.id));
    const usableIds = new Set(usable.map((t) => t.id));
    const chairs = usable.reduce((n, t) => n + num(t.capacity), 0);
    // Guests at a table that no longer exists are NOT counted as occupying an
    // open chair — the Plan Doctor reports them as orphans, and counting them
    // here would hide chairs that are genuinely free.
    const seated = (guests || []).reduce(
      (n, g) => n + (g && g.assignment && usableIds.has(g.assignment.tableId) ? paxOf(g) : 0), 0);
    return { tables: usable.length, chairs, seated, open: Math.max(0, chairs - seated) };
  }

  // ---------------------------------------------------------------------------

  // WOULD THIS OPERATION CROSS A FREEZE, AND WHAT WOULD IT COST?
  //
  // Returns OPEN when nothing is in the way, and OVERRIDE_REQUIRED with the
  // complete case for the decision when something is: what is frozen, why,
  // which guests and tables it touches, and what the numbers become. The
  // caller must not act on OVERRIDE_REQUIRED without a person.
  function evaluateOperation(input) {
    const inp = input || {};
    const rules = normalizeAll(inp.freezes);
    const tables = Array.isArray(inp.tables) ? inp.tables : [];
    const guests = Array.isArray(inp.guests) ? inp.guests : [];
    const byId = new Map(tables.map((t) => [t.id, t]));
    const moving = (Array.isArray(inp.guestIds) ? inp.guestIds : [])
      .map((id) => guests.find((g) => g && g.id === id)).filter(Boolean);
    const to = inp.toTableId ? byId.get(inp.toTableId) || null : null;

    // freeze id -> what it is being crossed for
    const hits = new Map();
    const touch = (f, direction, tableId) => {
      if (!hits.has(f.id)) hits.set(f.id, { freeze: f, directions: new Set(), tableIds: new Set() });
      const h = hits.get(f.id);
      h.directions.add(direction);
      h.tableIds.add(tableId);
    };

    if (to) for (const f of rules) if (covers(f, to)) touch(f, DIRECTION.INTO, to.id);
    for (const g of moving) {
      const fromId = g.assignment ? g.assignment.tableId : null;
      const from = fromId ? byId.get(fromId) : null;
      // Re-seating inside the same table is not a crossing.
      if (!from || (to && from.id === to.id)) continue;
      for (const f of rules) if (covers(f, from)) touch(f, DIRECTION.OUT_OF, from.id);
    }

    if (!hits.size) {
      return {
        version: 1, state: STATE.OPEN, freezes: [], directions: [],
        movingRecords: moving.length,
        movingPax: moving.reduce((n, g) => n + paxOf(g), 0),
        tables: [], guestsInArea: 0, paxInArea: 0, held: heldCapacity(rules, tables, guests),
        mutated: false,
        statement: "no freeze is crossed by this operation",
      };
    }

    const touchedIds = new Set();
    for (const h of hits.values()) for (const id of h.tableIds) touchedIds.add(id);
    const movingIds = new Set(moving.map((g) => g.id));
    const pax = moving.reduce((n, g) => n + paxOf(g), 0);

    // People already sitting inside the frozen AREA — every table the crossed
    // rules cover, not only the one table being touched. A zone freeze is about
    // the zone: seating into one VIP table affects the VIP arrangement, and an
    // operator deciding whether to break it needs to know how many people that
    // arrangement already holds. They are not being moved, and they are exactly
    // who a head-table or sponsor freeze protects, so they are reported
    // separately from the records being moved and never summed with them into
    // one misleading "affected" number.
    const areaIds = new Set();
    for (const h of hits.values()) {
      for (const t of tablesCovered(h.freeze, tables)) areaIds.add(t.id);
    }
    const inArea = guests.filter((g) => g && g.assignment && !movingIds.has(g.id)
      && areaIds.has(g.assignment.tableId));

    const occupancy = (t) => {
      const before = guests.reduce(
        (n, g) => n + (g && g.assignment && g.assignment.tableId === t.id ? paxOf(g) : 0), 0);
      let after = before;
      for (const g of moving) {
        const fromId = g.assignment ? g.assignment.tableId : null;
        if (fromId === t.id && (!to || to.id !== t.id)) after -= paxOf(g);
        if (to && to.id === t.id && fromId !== t.id) after += paxOf(g);
      }
      return { id: t.id, number: String(t.number), capacity: num(t.capacity), before, after };
    };

    const held = heldCapacity(rules, tables, guests);
    const heldAfter = { ...held };
    // Only the held area's own occupancy moves; the chairs it holds do not.
    const frozenIds = frozenTableIds(rules, tables);
    for (const t of tables) {
      if (!frozenIds.has(t.id) || !seatable(t)) continue;
      const o = occupancy(t);
      heldAfter.seated += o.after - o.before;
    }
    heldAfter.seated = Math.max(0, heldAfter.seated);
    heldAfter.open = Math.max(0, heldAfter.chairs - heldAfter.seated);

    const directions = new Set();
    for (const h of hits.values()) for (const d of h.directions) directions.add(d);

    return {
      version: 1,
      state: STATE.OVERRIDE_REQUIRED,
      directions: [...directions],
      freezes: [...hits.values()].map((h) => ({
        id: h.freeze.id, scope: h.freeze.scope, reason: h.freeze.reason, note: h.freeze.note,
        zone: h.freeze.zone || null, prefix: h.freeze.prefix || null,
        from: h.freeze.from ?? null, to: h.freeze.to ?? null,
        directions: [...h.directions],
        tables: [...h.tableIds].map((id) => byId.get(id)).filter(Boolean)
          .map((t) => ({ id: t.id, number: String(t.number) })),
        covers: tablesCovered(h.freeze, tables).length,
      })),
      movingRecords: moving.length,
      movingPax: pax,
      movingGuestIds: [...movingIds],
      // Every frozen table this operation touches, with what its occupancy
      // becomes. Computed, not promised — the same discipline as previewMove().
      tables: [...touchedIds].map((id) => byId.get(id)).filter(Boolean).map(occupancy),
      // How big the held area is, so the card can say "3 of the 12 tables this
      // freeze covers" without listing twelve rows nobody will read.
      areaTables: areaIds.size,
      guestsInArea: inArea.length,
      paxInArea: inArea.reduce((n, g) => n + paxOf(g), 0),
      held, heldAfter,
      // Said in the object so no caller can present an evaluation as a decision.
      mutated: false,
      statement: "nothing has changed; a supervisor must authorise this",
    };
  }

  globalThis.MeritSeatingFreeze = {
    version: 1,
    SCOPE, STATE, REASON, DIRECTION,
    normalize, normalizeAll, covers, freezesOnTable, tablesCovered,
    tableState, resolve, frozenTableIds,
    heldCapacity, openCapacityOutsideFreeze,
    evaluateOperation, parseTableNumber,
  };
})();
