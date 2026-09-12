// WHERE COULD THIS PARTY SIT, AND WHAT WOULD IT COST?
//
// A recommender, and nothing else. This module cannot seat anybody: it takes a
// copy of the room and returns options with reasons, and the only thing that
// ever writes an assignment is the existing assignGuestToTable(), driven by a
// person pressing Apply. That separation is the point of the file, not an
// implementation detail — "smart seating" is precisely where a product starts
// quietly moving guests because it was sure, and this one structurally cannot.
//
// Four rules shaped it:
//
//   EVERY OPTION CARRIES ITS REASONS, AND THEY ARE NAMED. Not a score. "Table 58
//   — 4 seats free, the party stays together, same zone as the rest of their
//   host's guests" is a thing an operator can disagree with; "Table 58 (0.87)"
//   is not. The reasons are enum values a screen translates, so they can be
//   argued with in either language.
//
//   A CONSTRAINT THAT CANNOT BE EVALUATED SAYS SO. Reporting "not frozen"
//   would be a claim about a feature that has never run, so an unimplemented
//   constraint reports NOT_CONFIGURED — and the day it arrives the same slot
//   carries a real answer. Freeze Zones has now arrived: when the caller
//   passes a resolved `frozen` list the constraint moves out of `unevaluated`
//   and into `constraints` with a real state, and a frozen table is removed
//   from the options with FROZEN as the reason. Unavailable tables have not
//   arrived and still say so. The advisor never learns the freeze RULES — it
//   consumes the resolved outcome, so freeze policy lives in exactly one file.
//
//   THE PREVIEW IS COMPUTED, NOT PROMISED. previewMove() derives every
//   before/after figure from the same inputs the recommender used, WITHOUT
//   touching them — it deep-reads and never writes. An operator who presses
//   Apply gets exactly the arithmetic they were shown.
//
//   A PARTY IS ONE RECORD. "Name +3" needs four adjacent seats at one table, not
//   four seats anywhere. Splitting a party to make the numbers work is the
//   optimisation this must never make.
(function () {
  "use strict";

  // Why an option is offered, or why it is not. Named rather than scored.
  const REASON = {
    SEATS_AVAILABLE: "SEATS_AVAILABLE",           // enough free seats for the whole party
    PARTY_TOGETHER: "PARTY_TOGETHER",             // all of them at this one table
    SAME_ZONE_AS_HOST: "SAME_ZONE_AS_HOST",       // where this host's other guests already are
    VIP_ZONE: "VIP_ZONE",                         // a VIP guest in a VIP zone
    FILLS_TABLE: "FILLS_TABLE",                   // completes a table rather than scattering
    KEEPS_RESERVE: "KEEPS_RESERVE",               // leaves spare seats elsewhere intact
    EMPTY_TABLE: "EMPTY_TABLE",                   // opens a table that was unused
  };

  // Why an option is NOT offered. An operator who expected a table to appear
  // deserves to know which rule removed it.
  const BLOCKED = {
    NOT_ENOUGH_SEATS: "NOT_ENOUGH_SEATS",
    ALREADY_THERE: "ALREADY_THERE",
    NO_PHYSICAL_SEATS: "NO_PHYSICAL_SEATS",
    LOCKED_ASSIGNMENT: "LOCKED_ASSIGNMENT",
    FROZEN: "FROZEN",
  };

  // Constraints the programme names. A constraint with no implementation is
  // reported as unanswered rather than answered favourably.
  const NOT_CONFIGURED = "NOT_CONFIGURED";
  const OPEN = "OPEN";
  const FROZEN = "FROZEN";
  const CONSTRAINT = {
    FREEZE_ZONES: "FREEZE_ZONES",
    UNAVAILABLE_TABLES: "UNAVAILABLE_TABLES",
  };

  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

  // The caller's resolved freeze answer, indexed. `undefined` means the caller
  // did not evaluate freezes at all, which is NOT the same as "nothing is
  // frozen" — an empty array says that, and this distinction is the whole
  // reason NOT_CONFIGURED exists.
  function freezeIndex(frozen) {
    if (!Array.isArray(frozen)) return null;
    const map = new Map();
    for (const f of frozen) {
      if (!f || !f.tableId) continue;
      if (!map.has(f.tableId)) map.set(f.tableId, []);
      map.get(f.tableId).push({ freezeId: f.freezeId || null, reason: f.reason || null });
    }
    return map;
  }
  // What a single option can say about the constraints, given what the caller
  // supplied. Built once per call rather than inlined, so the recommendation
  // and the preview cannot drift into answering the same question differently.
  function constraintRows(index, tableId) {
    const answered = [], unevaluated = [
      { constraint: CONSTRAINT.UNAVAILABLE_TABLES, state: NOT_CONFIGURED },
    ];
    if (index) answered.push({ constraint: CONSTRAINT.FREEZE_ZONES,
      state: index.has(tableId) ? FROZEN : OPEN,
      freezes: index.get(tableId) || [] });
    else unevaluated.unshift({ constraint: CONSTRAINT.FREEZE_ZONES, state: NOT_CONFIGURED });
    return { constraints: answered, unevaluated };
  }

  function seatsTaken(guests, tableId, exceptGuestId) {
    const used = new Set();
    for (const g of guests) {
      if (!g || g.id === exceptGuestId) continue;
      if (!g.assignment || g.assignment.tableId !== tableId) continue;
      for (const s of g.assignment.seats || []) used.add(Number(s));
    }
    return used;
  }

  const seatable = (t) => t && t.hasPhysicalSeats !== false && num(t.capacity) > 0;

  // ---------------------------------------------------------------------------

  // Options for ONE guest record, ranked, each with the reasons it earned. The
  // caller passes the room; this reads it and returns.
  function recommend(input) {
    const inp = input || {};
    const guest = inp.guest;
    const tables = Array.isArray(inp.tables) ? inp.tables : [];
    const guests = Array.isArray(inp.guests) ? inp.guests : [];
    const limit = num(inp.limit) || 4;
    const frozen = freezeIndex(inp.frozen);
    if (!guest) return empty("no guest was given");

    const pax = paxOf(guest);
    const currentTableId = guest.assignment ? guest.assignment.tableId : null;
    // A locked assignment is a human-confirmed constraint, and it outranks every
    // arrangement this module could propose. Nothing is recommended at all.
    if (guest.assignment && guest.assignment.locked) {
      return { ...empty("the assignment is locked"), locked: true,
        blocked: tables.map((t) => ({ tableId: t.id, number: String(t.number), why: BLOCKED.LOCKED_ASSIGNMENT })) };
    }

    // Where this host's other guests already sit. Party cohesion in this data
    // model is the host, because a guest's own companions are inside the record.
    const host = String(guest.invitedBy || "").trim();
    const hostZones = new Map();
    if (host) {
      for (const g of guests) {
        if (g.id === guest.id || String(g.invitedBy || "").trim() !== host) continue;
        if (!g.assignment) continue;
        const t = tables.find((x) => x.id === g.assignment.tableId);
        if (t && t.zone) hostZones.set(t.zone, (hostZones.get(t.zone) || 0) + 1);
      }
    }
    const preferredZone = [...hostZones.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const isVip = guest.vip === "VIP" || guest.vip === "VVIP";

    const options = [], blocked = [];
    for (const t of tables) {
      const number = String(t.number);
      if (!seatable(t)) { blocked.push({ tableId: t.id, number, why: BLOCKED.NO_PHYSICAL_SEATS }); continue; }
      if (t.id === currentTableId) { blocked.push({ tableId: t.id, number, why: BLOCKED.ALREADY_THERE }); continue; }
      // A frozen table is never RECOMMENDED. A person may still choose to seat
      // there and be challenged for a supervisor override, but this layer
      // proposing it would be the product quietly routing around a rule a
      // person set — the exact behaviour freezes exist to prevent.
      if (frozen && frozen.has(t.id)) {
        blocked.push({ tableId: t.id, number, why: BLOCKED.FROZEN, freezes: frozen.get(t.id) });
        continue;
      }
      const used = seatsTaken(guests, t.id, guest.id);
      const free = num(t.capacity) - used.size;
      // The party is one record and sits at one table. A table with room for
      // three of a four-pax record is not an option that "nearly works".
      if (free < pax) { blocked.push({ tableId: t.id, number, why: BLOCKED.NOT_ENOUGH_SEATS, free, needed: pax }); continue; }

      const reasons = [REASON.SEATS_AVAILABLE, REASON.PARTY_TOGETHER];
      const zone = t.zone || null;
      if (preferredZone && zone === preferredZone) reasons.push(REASON.SAME_ZONE_AS_HOST);
      if (isVip && /VIP/i.test(String(zone || ""))) reasons.push(REASON.VIP_ZONE);
      if (free === pax) reasons.push(REASON.FILLS_TABLE);
      else if (used.size === 0) reasons.push(REASON.EMPTY_TABLE);
      else reasons.push(REASON.KEEPS_RESERVE);

      options.push({
        tableId: t.id, number, zone, capacity: num(t.capacity),
        occupied: used.size, free, pax,
        freeAfter: free - pax,
        reasons,
        // Constraints, split by whether this build can answer them. Anything
        // it cannot is named rather than omitted, so the UI says "not set up"
        // instead of implying a clean bill of health.
        ...constraintRows(frozen, t.id),
        // Ordering only. Deliberately NOT shown to an operator and not a
        // confidence: it decides which four rows appear, and the reasons are
        // what justify them.
        rank: reasons.length * 100 - (free - pax),
      });
    }

    options.sort((a, b) => b.rank - a.rank || a.number.localeCompare(b.number, "tr"));
    return {
      version: 1, guestId: guest.id, pax, preferredZone, isVip,
      options: options.slice(0, limit),
      considered: tables.length,
      offered: options.length,
      blocked,
      statement: "recommendations only; nothing here seats anybody",
    };
  }

  function empty(why) {
    return { version: 1, options: [], considered: 0, offered: 0, blocked: [], why,
      statement: "recommendations only; nothing here seats anybody" };
  }

  // WHAT WOULD CHANGE. Computed from the same room the recommendation read, and
  // it writes nothing — every figure below is arithmetic over the inputs. The
  // operator sees this BEFORE anything moves, which is the whole of §10.
  function previewMove(input) {
    const inp = input || {};
    const guest = inp.guest;
    const tables = Array.isArray(inp.tables) ? inp.tables : [];
    const guests = Array.isArray(inp.guests) ? inp.guests : [];
    const to = tables.find((t) => t.id === inp.toTableId) || null;
    const frozen = freezeIndex(inp.frozen);
    if (!guest || !to) return null;

    const pax = paxOf(guest);
    const fromId = guest.assignment ? guest.assignment.tableId : null;
    const from = fromId ? tables.find((t) => t.id === fromId) || null : null;

    const occupancy = (t) => {
      if (!t) return null;
      const before = seatsTaken(guests, t.id, null).size;
      let after = before;
      if (from && t.id === from.id) after = before - pax;
      if (t.id === to.id) after = before + (from && from.id === to.id ? 0 : pax);
      return { number: String(t.number), capacity: num(t.capacity), before, after };
    };

    // Reserve is spare seats across every seatable table, which is what an
    // operator means by "how much room have we got left".
    const chairs = tables.filter(seatable).reduce((n, t) => n + num(t.capacity), 0);
    const seatedNow = guests.reduce((n, g) => n + (g.assignment ? paxOf(g) : 0), 0);
    const seatedAfter = seatedNow + (guest.assignment ? 0 : pax);

    // Does the host's group end up more together or less? Stated as a count,
    // not as a verdict, because "together" is the operator's judgement.
    const host = String(guest.invitedBy || "").trim();
    const hostAtTarget = host
      ? guests.filter((g) => g.id !== guest.id && String(g.invitedBy || "").trim() === host
        && g.assignment && g.assignment.tableId === to.id).length
      : 0;

    return {
      version: 1,
      guest: { id: guest.id, name: guest.name, pax },
      from: occupancy(from),
      to: occupancy(to),
      reserve: { before: chairs - seatedNow, after: chairs - seatedAfter, chairs },
      affectedGuests: 1,
      affectedPax: pax,
      hostGuestsAlreadyAtTarget: hostAtTarget,
      ...constraintRows(frozen, to.id),
      // Said in the object itself so no caller can present this as done.
      mutated: false,
      statement: "nothing has changed; this is what would change",
    };
  }

  globalThis.MeritSeatingAdvisor = {
    version: 1, REASON, BLOCKED, CONSTRAINT, NOT_CONFIGURED, OPEN, FROZEN,
    recommend, previewMove,
  };
})();
