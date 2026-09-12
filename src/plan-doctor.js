// CAN THIS EVENT SAFELY PROCEED?
//
// The Plan Doctor is a pre-flight check, not a detector. It reads nothing off
// the drawing, measures no pixels and calls no engine: everything below is a
// comparison between facts other layers already concluded — the tables in the
// event, the guests, where they are sitting, what the plan reader made of the
// drawing, and what the Self-Check, Number Integrity, Confidence Budget and
// Teach Area said about that reading.
//
// Three rules shaped it, and each one exists because the opposite is easy:
//
//   A READING IS NOT AN OPERATIONAL FACT. Two tables that a person numbered
//   the same are a BLOCKING problem: a guest will be sent to the wrong table
//   tonight. Two tables that OCR *read* as the same number are NEEDS REVIEW:
//   the room may be perfectly fine and the reader wrong. The same disagreement
//   sits at two different levels depending on where the number came from, and
//   collapsing them would either cry wolf or bury a real conflict.
//
//   NO DEAD-END ROWS. Every finding carries what it affects and where to go,
//   and the target is resolved from live data — a row about table T05 carries
//   T05's id, not a sentence mentioning it. A finding that cannot say where to
//   go is a finding this layer has no business raising.
//
//   NOTHING IS REMEMBERED. The report is derived from current state on every
//   call, so a resolved problem disappears by itself. There is no stored list
//   of findings to go stale, and no "dismissed" flag that could hide a problem
//   that has since come back.
//
// Language: the sentences here are English and are DATA — they are what the
// exported report and the regression suites read. Each finding also carries a
// stable `code` and a `params` object holding the same fact structurally, and
// a product screen renders those in the operator's language. Nothing here
// should ever be printed raw into the UI except as a last-resort fallback.
(function () {
  "use strict";

  const LEVEL = {
    BLOCKING: "BLOCKING",
    NEEDS_REVIEW: "NEEDS_REVIEW",
    INFORMATION: "INFORMATION",
  };

  // Where a fact came from. Named rather than described, for the same reason
  // the Self-Check grew `origin` alongside its English `source` sentence: a
  // screen can translate a name and cannot translate a sentence.
  const SOURCE = {
    GUEST_RECORDS: "GUEST_RECORDS",       // the guest list itself
    SEATING: "SEATING",                   // assignments of guests to seats
    FLOOR_PLAN: "FLOOR_PLAN",             // the tables and chairs in the event
    DRAWING: "DRAWING",                   // what the plan itself prints
    ASSISTED_DETECTION: "ASSISTED_DETECTION",
    NUMBER_READING: "NUMBER_READING",     // per-table printed numbers
    SELF_CHECK: "SELF_CHECK",
    RELATIONSHIPS: "RELATIONSHIPS",       // the scene graph's edges
    TEACH_AREA: "TEACH_AREA",
    OPERATOR: "OPERATOR",               // a person stood behind the figure
  };

  // What is at stake. This is the "WHAT IT AFFECTS" of a finding, and it is a
  // small closed set on purpose: an operator is deciding whether to act now,
  // and "this affects tonight's arrivals" is the useful shape of that.
  const AFFECTS = {
    SEATING: "SEATING",
    ARRIVALS: "ARRIVALS",
    REPORTS: "REPORTS",
    CAPACITY: "CAPACITY",
    PLAN_READING: "PLAN_READING",
  };

  // Where a row takes the operator. The names are screens, not functions, so
  // the routing layer stays a lookup rather than a second opinion.
  const GO = {
    SEATING: "SEATING",
    GUESTS: "GUESTS",
    FLOOR: "FLOOR",
    REVIEW: "REVIEW",               // Floor Plan in review mode, at an object
    REVIEW_CENTER: "REVIEW_CENTER", // Floor Plan in review mode, budget open
  };

  // The answer to the question in the title. Three named states, never a score:
  // there is no honest weighting of "one duplicate table number" against
  // "twelve unseated guests", so the product says which situation it is in.
  const VERDICT = {
    YES: "YES",                 // nothing blocking, nothing to review
    WITH_REVIEW: "WITH_REVIEW", // nothing blocking, but open questions
    NO: "NO",                   // something would go wrong tonight
  };

  // planIssues() rules the Doctor expresses itself, with more evidence and a
  // real target. Anything NOT in this list still reaches the report, mapped by
  // its level — so a rule added to planIssues tomorrow is surfaced rather than
  // silently dropped, and the day the Doctor learns to say it properly its
  // code moves into this list.
  const EXPRESSED_NATIVELY = new Set(["duplicateTable", "capacityExceeded", "unassigned", "blankPlan"]);

  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  const plural = (n, one, many) => (n === 1 ? one : many);

  // ---------------------------------------------------------------------------

  function run(input) {
    const inp = input || {};
    const tables = Array.isArray(inp.tables) ? inp.tables : [];
    const guests = Array.isArray(inp.guests) ? inp.guests : [];
    const analysis = inp.analysis || null;
    const phase = inp.phase || "ready";
    // Which tables a person has frozen, resolved by the caller. The Doctor
    // does not evaluate freeze RULES — that is seating-freeze.js's single job
    // — it only reports what a freeze does to the room's arithmetic.
    const frozenIds = new Set(Array.isArray(inp.frozenTableIds) ? inp.frozenTableIds : []);
    const findings = [];

    const add = (f) => { findings.push(f); return f; };

    const byId = new Map(tables.map((t) => [t.id, t]));
    const seated = guests.filter((g) => g && g.assignment && g.assignment.tableId);
    const totalPax = guests.reduce((n, g) => n + paxOf(g), 0);
    // Chairs that can actually hold somebody. A table marked as having no
    // physical seats is a symbol on a drawing, not a place to sit, and counting
    // it would turn "we are 30 chairs short" into "we have room".
    const physical = tables.filter((t) => t.hasPhysicalSeats !== false && num(t.capacity) > 0);
    const chairs = physical.reduce((n, t) => n + num(t.capacity), 0);

    // ---- BLOCKING: what would actually go wrong tonight ---------------------

    // A guest holding a seat at a table that is not in the plan. This is the
    // one failure nobody sees coming: the guest list looks complete, the guest
    // looks seated, and the table plan simply has no such table.
    const orphans = seated.filter((g) => !byId.has(g.assignment.tableId));
    if (orphans.length) {
      const pax = orphans.reduce((n, g) => n + paxOf(g), 0);
      add({
        code: "guestAtMissingTable", level: LEVEL.BLOCKING,
        params: { n: orphans.length, guests: orphans.length, pax },
        what: `${orphans.length} guest ${plural(orphans.length, "record holds", "records hold")} a seat at a table that is not in this plan (${pax} pax)`,
        why: "the assignment names a table the floor plan no longer contains — the table was deleted or replaced after the guests were seated",
        sources: [SOURCE.SEATING, SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.SEATING, AFFECTS.ARRIVALS, AFFECTS.REPORTS],
        action: { go: GO.SEATING, guestIds: orphans.map((g) => g.id) },
        weight: pax,
      });
    }

    // More people at a table than it has chairs.
    const over = [];
    for (const t of tables) {
      const at = seated.filter((g) => g.assignment.tableId === t.id);
      const pax = at.reduce((n, g) => n + paxOf(g), 0);
      if (pax > num(t.capacity)) over.push({ table: t, pax, capacity: num(t.capacity), guests: at });
    }
    if (over.length) {
      over.sort((a, b) => (b.pax - b.capacity) - (a.pax - a.capacity));
      const worst = over[0];
      add({
        code: "tableOverCapacity", level: LEVEL.BLOCKING,
        params: { n: over.length, tables: over.length, number: String(worst.table.number), pax: worst.pax, capacity: worst.capacity },
        what: `${over.length} ${plural(over.length, "table holds", "tables hold")} more guests than chairs — ${worst.table.number} has ${worst.pax} pax on ${worst.capacity} chairs`,
        why: "the pax assigned to the table is compared against the chairs the table actually carries; capacity was reduced, or a party was seated over it",
        sources: [SOURCE.SEATING, SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.SEATING, AFFECTS.ARRIVALS],
        action: { go: GO.SEATING, tableId: worst.table.id, tableIds: over.map((o) => o.table.id) },
        weight: over.reduce((n, o) => n + (o.pax - o.capacity), 0),
      });
    }

    // The same chair promised to two people. Two guests arrive, one chair.
    const clashes = [];
    for (const t of tables) {
      const holders = new Map();
      for (const g of seated) {
        if (g.assignment.tableId !== t.id) continue;
        for (const s of g.assignment.seats || []) {
          const k = Number(s);
          if (!holders.has(k)) holders.set(k, []);
          holders.get(k).push(g.id);
        }
      }
      const doubled = [...holders.values()].filter((ids) => ids.length > 1);
      if (doubled.length) clashes.push({ table: t, seats: doubled.length });
    }
    if (clashes.length) {
      const seats = clashes.reduce((n, c) => n + c.seats, 0);
      add({
        code: "seatHeldTwice", level: LEVEL.BLOCKING,
        params: { n: seats, tables: clashes.length, seats, number: String(clashes[0].table.number) },
        what: `${seats} ${plural(seats, "chair is", "chairs are")} assigned to more than one guest, across ${clashes.length} ${plural(clashes.length, "table", "tables")}`,
        why: "two guest records name the same seat number at the same table",
        sources: [SOURCE.SEATING],
        affects: [AFFECTS.SEATING, AFFECTS.ARRIVALS],
        action: { go: GO.SEATING, tableId: clashes[0].table.id, tableIds: clashes.map((c) => c.table.id) },
        weight: seats,
      });
    }

    // A seat number the table does not have. The chair was removed under a
    // guest who is still holding it — the guest reads as seated and there is
    // nothing to sit on.
    const beyond = [];
    for (const g of seated) {
      const t = byId.get(g.assignment.tableId);
      if (!t) continue; // already reported as an orphan
      const bad = (g.assignment.seats || []).filter((s) => Number(s) < 0 || Number(s) >= num(t.capacity));
      if (bad.length) beyond.push({ guest: g, table: t, seats: bad.length });
    }
    if (beyond.length) {
      add({
        code: "seatBeyondTheTable", level: LEVEL.BLOCKING,
        params: { n: beyond.length, guests: beyond.length, number: String(beyond[0].table.number) },
        what: `${beyond.length} guest ${plural(beyond.length, "record holds a seat number", "records hold seat numbers")} the table does not have`,
        why: "the table's capacity was reduced after the guest was seated, so the seat it refers to no longer exists",
        sources: [SOURCE.SEATING, SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.SEATING, AFFECTS.REPORTS],
        action: { go: GO.SEATING, tableId: beyond[0].table.id, guestIds: beyond.map((b) => b.guest.id) },
        weight: beyond.length,
      });
    }

    // Two tables carrying the same number IN THE PLAN. This is operational
    // identity, not a reading: a guest told "table 12" has two places to go,
    // and the workbook prints two cards with one name. Contrast with
    // `duplicateNumberReading` below, which is the same shape of disagreement
    // arrived at by OCR and is deliberately NOT blocking.
    const numbers = new Map();
    for (const t of tables) {
      const k = String(t.number);
      if (!numbers.has(k)) numbers.set(k, []);
      numbers.get(k).push(t);
    }
    const dupes = [...numbers.entries()].filter(([, ts]) => ts.length > 1);
    if (dupes.length) {
      add({
        code: "duplicateTableNumber", level: LEVEL.BLOCKING,
        params: { n: dupes.length, numbers: dupes.length, number: String(dupes[0][0]) },
        what: `${dupes.length} table ${plural(dupes.length, "number is", "numbers are")} used more than once in this plan (${dupes.map(([n]) => n).join(", ")})`,
        why: "two tables in the floor plan carry the same printed number, so the number no longer identifies one place in the room",
        sources: [SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.SEATING, AFFECTS.ARRIVALS, AFFECTS.REPORTS],
        action: { go: GO.FLOOR, tableId: dupes[0][1][1].id },
        weight: dupes.length,
      });
    }

    // Guests, but nowhere to put them.
    if (totalPax > 0 && chairs === 0) {
      add({
        code: "guestsButNoSeating", level: LEVEL.BLOCKING,
        params: { n: totalPax, pax: totalPax },
        what: `${totalPax} pax are expected and the plan carries no usable seating`,
        why: "the event has guest records but no table in the floor plan has a chair to offer",
        sources: [SOURCE.GUEST_RECORDS, SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.SEATING, AFFECTS.CAPACITY, AFFECTS.ARRIVALS],
        action: { go: GO.FLOOR },
        weight: totalPax,
      });
    } else if (totalPax > chairs && chairs > 0) {
      add({
        code: "moreGuestsThanChairs", level: LEVEL.BLOCKING,
        params: { n: totalPax, pax: totalPax, chairs, over: totalPax - chairs },
        what: `${totalPax} pax are expected and the plan carries ${chairs} chairs — ${totalPax - chairs} short`,
        why: "total pax across every guest record is compared against the chairs on tables that can seat somebody",
        sources: [SOURCE.GUEST_RECORDS, SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.CAPACITY, AFFECTS.SEATING],
        action: { go: GO.FLOOR },
        weight: totalPax - chairs,
      });
    }

    // ---- NEEDS REVIEW: open questions that should be settled before the door

    // A VIP with no table is the seating gap that costs the most to discover
    // at the door, so it is stated separately from the general unassigned
    // count rather than buried inside it.
    const vipUnseated = guests.filter((g) => !(g && g.assignment) && (g.vip === "VIP" || g.vip === "VVIP"));
    if (vipUnseated.length) {
      const pax = vipUnseated.reduce((n, g) => n + paxOf(g), 0);
      add({
        code: "vipWithoutATable", level: LEVEL.NEEDS_REVIEW,
        params: { n: vipUnseated.length, guests: vipUnseated.length, pax },
        what: `${vipUnseated.length} VIP ${plural(vipUnseated.length, "guest record has", "guest records have")} no table (${pax} pax)`,
        why: "the guest record is marked VIP or VVIP and carries no seat assignment",
        sources: [SOURCE.GUEST_RECORDS, SOURCE.SEATING],
        affects: [AFFECTS.SEATING, AFFECTS.ARRIVALS],
        action: { go: GO.SEATING, guestIds: vipUnseated.map((g) => g.id) },
        weight: pax,
      });
    }

    const unassignedPax = guests.filter((g) => !(g && g.assignment)).reduce((n, g) => n + paxOf(g), 0);
    const vipPax = vipUnseated.reduce((n, g) => n + paxOf(g), 0);
    // Counted net of the VIP row above, so one guest is not reported twice.
    if (unassignedPax - vipPax > 0) {
      const rest = unassignedPax - vipPax;
      add({
        code: "guestsWithoutATable", level: LEVEL.NEEDS_REVIEW,
        params: { n: rest, pax: rest },
        what: `${rest} pax have no table yet`,
        why: "the guest record carries no seat assignment",
        sources: [SOURCE.GUEST_RECORDS, SOURCE.SEATING],
        affects: [AFFECTS.SEATING, AFFECTS.REPORTS],
        action: { go: GO.SEATING },
        weight: rest,
      });
    }

    // A freeze is a person's decision and never a problem in itself. It
    // becomes a question only when the room cannot seat the people who are
    // waiting WITHOUT it — "40 pax and 12 open chairs" reads as a capacity
    // disaster until you know 60 chairs are being held on purpose, and the
    // operator needs to be told which of those two evenings they are in.
    const frozenSeatable = physical.filter((t) => frozenIds.has(t.id));
    const heldChairs = frozenSeatable.reduce((n, t) => n + num(t.capacity), 0);
    const heldSeated = seated.filter((g) => frozenIds.has(g.assignment.tableId))
      .reduce((n, g) => n + paxOf(g), 0);
    const heldOpen = Math.max(0, heldChairs - heldSeated);
    const openOutside = Math.max(0, (chairs - heldChairs)
      - (seated.filter((g) => byId.has(g.assignment.tableId) && !frozenIds.has(g.assignment.tableId))
        .reduce((n, g) => n + paxOf(g), 0)));
    if (heldOpen > 0 && unassignedPax > openOutside) {
      add({
        code: "frozenCapacityNeeded", level: LEVEL.NEEDS_REVIEW,
        params: { n: unassignedPax, pax: unassignedPax, open: openOutside,
          held: heldOpen, tables: frozenSeatable.length },
        what: `${unassignedPax} pax still need a table and only ${openOutside} ${plural(openOutside, "chair is", "chairs are")} open outside the frozen area — ${heldOpen} held ${plural(heldOpen, "chair", "chairs")} would cover the difference`,
        why: "a freeze holds part of the room on purpose; the chairs exist and are being kept back, so this is a decision to take rather than a shortage to fix",
        sources: [SOURCE.OPERATOR, SOURCE.SEATING, SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.SEATING, AFFECTS.CAPACITY],
        action: { go: GO.SEATING, tableIds: frozenSeatable.map((t) => t.id) },
        weight: unassignedPax - openOutside,
      });
    }

    if (!tables.length) {
      add({
        code: "noTablesInPlan", level: LEVEL.NEEDS_REVIEW,
        params: {},
        what: "this event has no tables yet",
        why: "the floor plan is empty — nothing has been drawn, imported or confirmed from a drawing",
        sources: [SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.SEATING, AFFECTS.CAPACITY],
        action: { go: GO.FLOOR },
        weight: 0,
      });
    }

    addPlanReadingFindings(add, analysis);

    // ---- INFORMATION: worth knowing, nothing to fix -------------------------

    const assignedPax = seated.reduce((n, g) => n + paxOf(g), 0);
    if (chairs > assignedPax) {
      add({
        code: "spareCapacity", level: LEVEL.INFORMATION,
        params: { n: chairs - assignedPax, spare: chairs - assignedPax, chairs, assigned: assignedPax },
        what: `${chairs - assignedPax} of ${chairs} chairs are unassigned`,
        why: "chairs on seatable tables, less the pax already seated on them",
        sources: [SOURCE.FLOOR_PLAN, SOURCE.SEATING],
        affects: [AFFECTS.CAPACITY],
        action: { go: GO.SEATING, filter: "empty" },
        weight: chairs - assignedPax,
      });
    }

    // What the freeze is holding, stated once whether or not it is in the way.
    // The spare-capacity row above counts every chair in the room, and an
    // operator reading "60 chairs are unassigned" without this line would go
    // looking for 60 chairs they are not allowed to use.
    if (heldChairs > 0) {
      add({
        code: "capacityHeldByFreeze", level: LEVEL.INFORMATION,
        params: { n: heldChairs, chairs: heldChairs, tables: frozenSeatable.length,
          open: heldOpen, seated: heldSeated },
        what: `${heldChairs} ${plural(heldChairs, "chair is", "chairs are")} held by a freeze across ${frozenSeatable.length} ${plural(frozenSeatable.length, "table", "tables")} — ${heldOpen} of them empty`,
        why: "a person froze part of the room; these chairs are deliberately not offered to the seating process",
        sources: [SOURCE.OPERATOR, SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.CAPACITY, AFFECTS.SEATING],
        action: { go: GO.SEATING, tableIds: frozenSeatable.map((t) => t.id) },
        weight: heldChairs,
      });
    }

    // ---- anything planIssues() knows that this layer does not ---------------
    for (const issue of (inp.planIssues || [])) {
      if (!issue || EXPRESSED_NATIVELY.has(issue.code)) continue;
      add({
        code: issue.code || "planIssue",
        level: issue.level === "blocker" ? LEVEL.BLOCKING : LEVEL.NEEDS_REVIEW,
        params: {},
        // A rule this layer does not model still gets a row, using the words
        // planIssues() already wrote for it. Its `fix` field is where that rule
        // has always sent people, so the row is not a dead end either.
        what: issue.title || "",
        why: issue.text || "",
        sources: [SOURCE.FLOOR_PLAN],
        affects: [AFFECTS.SEATING],
        action: { go: issue.fix === "floor" ? GO.FLOOR : GO.SEATING },
        passthrough: true,
        weight: 0,
      });
    }

    return report(findings, phase);
  }

  // Everything the Doctor says about how the drawing was read. Split out
  // because it all shares one precondition — a plan was actually analysed —
  // and because none of it is ever BLOCKING on its own: an uncertain reading
  // is a reason to look, not a reason to stop. It becomes operational truth
  // only once a person confirms it, and at that point it is in the floor plan
  // and the checks above are what see it.
  function addPlanReadingFindings(add, analysis) {
    if (!analysis) return;
    const integrity = analysis.numberIntegrity || null;
    const selfCheck = analysis.selfCheck || null;
    const budget = analysis.confidenceBudget || null;
    const teach = analysis.teachArea || null;
    const pi = analysis.planIntelligence || null;

    if (integrity) {
      const find = (kind) => (integrity.findings || []).find((f) => f.kind === kind);

      const disagrees = find("tableCountDisagreesWithTheDrawing");
      if (disagrees) {
        add({
          code: "tablesUnaccountedFor", level: LEVEL.NEEDS_REVIEW,
          params: { stated: disagrees.stated, found: disagrees.found, difference: disagrees.difference },
          what: `the drawing states ${disagrees.stated} tables and ${disagrees.found} were accounted for`,
          why: "a capacity rule printed on the drawing gives a table count; the plan reader accounted for a different number",
          sources: [SOURCE.DRAWING, SOURCE.ASSISTED_DETECTION],
          affects: [AFFECTS.PLAN_READING, AFFECTS.CAPACITY],
          action: { go: GO.REVIEW_CENTER },
          weight: disagrees.difference,
        });
      }

      const dupe = find("duplicateNumber");
      if (dupe) {
        add({
          code: "duplicateNumberReading", level: LEVEL.NEEDS_REVIEW,
          params: { n: (dupe.tableIds || []).length, number: dupe.number, tables: (dupe.tableIds || []).length },
          // Deliberately not BLOCKING. Nothing in the room is wrong yet: two
          // crops were read as the same number and at most one of them is
          // right. It becomes `duplicateTableNumber` — and blocking — only if
          // a person confirms both readings into the floor plan.
          what: `${(dupe.tableIds || []).length} tables were each read as number ${dupe.number}`,
          why: "the number was read off each table's own symbol, and two tables produced the same one — at most one of those readings is right",
          sources: [SOURCE.NUMBER_READING],
          affects: [AFFECTS.PLAN_READING],
          action: { go: GO.REVIEW, candidateIds: dupe.tableIds || [] },
          weight: (dupe.tableIds || []).length,
        });
      }

      const unread = find("tablesWithoutAConfidentNumber");
      if (unread) {
        add({
          code: "unresolvedTableNumbers", level: LEVEL.NEEDS_REVIEW,
          params: { n: unread.count, count: unread.count, needsReview: unread.needsReview, unknown: unread.unknown },
          what: `${unread.count} tables have no confident number (${unread.needsReview} need a look, ${unread.unknown} could not be read)`,
          why: "a number is accepted only where two different crops of the same table agreed; these did not",
          sources: [SOURCE.NUMBER_READING],
          affects: [AFFECTS.PLAN_READING],
          action: { go: GO.REVIEW_CENTER },
          weight: unread.count,
        });
      }
    }

    // Each disagreement the plan's own arithmetic found. One row per check
    // rather than one row for all of them: they are different disagreements
    // between different figures, and an operator settles them separately.
    for (const c of (selfCheck && selfCheck.checks) || []) {
      if (c.verdict !== "INCONSISTENT") continue;
      add({
        code: "planChecksDisagree", level: LEVEL.NEEDS_REVIEW,
        checkId: c.id,
        params: { ...(c.params || {}), check: String(c.id).split(":")[0] },
        what: c.statement || "the plan's own figures disagree",
        why: c.detail || "two figures that should describe the same room do not match",
        sources: [SOURCE.SELF_CHECK, ...checkOrigins(c)],
        affects: [AFFECTS.PLAN_READING, AFFECTS.CAPACITY],
        action: { go: GO.REVIEW_CENTER },
        weight: 1,
      });
    }

    if (budget && budget.counts && budget.counts.shown) {
      add({
        code: "decisionsWaiting", level: LEVEL.NEEDS_REVIEW,
        params: { n: budget.counts.shown, claims: budget.counts.shown, objects: num(budget.counts.distinctThingsTheseClaimsCover) },
        what: `${budget.counts.shown} ${plural(budget.counts.shown, "question is", "questions are")} waiting for a decision about this plan`,
        why: "the Confidence Budget ranked every uncertain fact by how much of the plan one decision settles, and these are the ones worth an operator's time",
        sources: [SOURCE.ASSISTED_DETECTION],
        affects: [AFFECTS.PLAN_READING],
        action: { go: GO.REVIEW_CENTER },
        weight: budget.counts.shown,
      });
    }

    if (teach && teach.summary && teach.summary.ambiguous) {
      add({
        code: "teachAreaAmbiguous", level: LEVEL.NEEDS_REVIEW,
        params: { n: teach.summary.ambiguous, count: teach.summary.ambiguous },
        what: `${teach.summary.ambiguous} ${plural(teach.summary.ambiguous, "note applies", "notes apply")} to nothing on this plan because more than one object fits`,
        why: "a note is applied only where exactly one object matches it; where several match equally well, nothing is touched",
        sources: [SOURCE.TEACH_AREA],
        affects: [AFFECTS.PLAN_READING],
        action: { go: GO.REVIEW_CENTER },
        weight: teach.summary.ambiguous,
      });
    }

    // Chairs standing in the room that no table claims. This is the scene
    // graph speaking: every chair that belongs somewhere has an edge saying
    // so, and these have none. Information, not a problem — spare seating
    // along a wall looks exactly like this, and so does a table the reader
    // missed, and this layer cannot tell them apart.
    const loose = pi && pi.planSummary ? num(pi.planSummary.unassociatedChairs) : 0;
    if (loose) {
      add({
        code: "chairsNoTableClaims", level: LEVEL.INFORMATION,
        params: { n: loose, chairs: loose },
        what: `${loose} chairs were found that no table claims`,
        why: "a chair is tied to a table by a relationship the plan reader can argue for; these have none — they are spare seating, or a table that was not read",
        sources: [SOURCE.RELATIONSHIPS, SOURCE.ASSISTED_DETECTION],
        affects: [AFFECTS.PLAN_READING, AFFECTS.CAPACITY],
        action: { go: GO.REVIEW_CENTER },
        weight: loose,
      });
    }

    // A symbolic drawing does not draw seats, so the arithmetic that compares
    // a printed pax figure against counted chairs has nothing to compare. Said
    // out loud, because silence here reads as "checked and fine".
    const notCheckable = ((selfCheck && selfCheck.checks) || []).filter((c) => c.verdict === "NOT_CHECKABLE");
    if (notCheckable.length) {
      add({
        code: "someChecksNotPossible", level: LEVEL.INFORMATION,
        params: { n: notCheckable.length, count: notCheckable.length },
        what: `${notCheckable.length} of the plan's own checks could not be run on this drawing`,
        why: "this drawing shows its tables as symbols rather than drawing the seats, so there is nothing to count against the figure it prints",
        sources: [SOURCE.SELF_CHECK, SOURCE.DRAWING],
        affects: [AFFECTS.PLAN_READING],
        action: { go: GO.REVIEW_CENTER },
        weight: 0,
      });
    }

    const below = budget && budget.counts
      ? num(budget.counts.deferred) + num(budget.counts.nothingMeasurableDependsOnThem) + num(budget.counts.notAnswerableFromTheDrawing)
      : 0;
    if (below) {
      add({
        code: "uncertaintyBelowTheLine", level: LEVEL.INFORMATION,
        params: {
          n: below, count: below,
          deferred: num(budget.counts.deferred),
          nothingDepends: num(budget.counts.nothingMeasurableDependsOnThem),
          notAnswerable: num(budget.counts.notAnswerableFromTheDrawing),
        },
        what: `${below} further uncertainties were ranked below the line and are reported rather than raised`,
        why: "each one either settles too little to be worth a decision, or cannot be answered from this drawing at all",
        sources: [SOURCE.ASSISTED_DETECTION],
        affects: [AFFECTS.PLAN_READING],
        action: { go: GO.REVIEW_CENTER },
        weight: 0,
      });
    }
  }

  // A self-check's own inputs already say where each figure came from. Those
  // names are plan-self-check.js's ORIGINS, and they are read from the module
  // rather than written out here: the values are words like
  // "printedOnTheDrawing", not the key names, and a copy of them in this file
  // would be one rename away from silently matching nothing. Which is exactly
  // what happened — the first version of this compared against "PRINTED" and
  // "DETECTED" and therefore never matched, so a finding that had traceable
  // provenance reported none. Rendering it is what showed that.
  function checkOrigins(check) {
    const O = (globalThis.MeritSelfCheck && globalThis.MeritSelfCheck.ORIGINS) || {};
    const bySource = new Map([
      [O.PRINTED, SOURCE.DRAWING],
      [O.DERIVED, SOURCE.SELF_CHECK],
      [O.DETECTED, SOURCE.ASSISTED_DETECTION],
      [O.PERSON, SOURCE.OPERATOR],
      [O.SYSTEM, SOURCE.SELF_CHECK],
    ]);
    const seen = new Set((check.inputs || []).map((i) => i && i.origin).filter(Boolean));
    // An origin this map does not know contributes nothing rather than being
    // guessed at: a wrong provenance is worse than a missing one.
    return [...seen].map((o) => bySource.get(o)).filter(Boolean);
  }

  function report(findings, phase) {
    const of = (level) => findings.filter((f) => f.level === level)
      // Biggest consequence first inside each level; the code breaks ties so
      // the order is stable between renders rather than depending on the order
      // the checks happened to run in.
      .sort((a, b) => (b.weight - a.weight) || a.code.localeCompare(b.code));

    const blocking = of(LEVEL.BLOCKING);
    const needsReview = of(LEVEL.NEEDS_REVIEW);
    const information = of(LEVEL.INFORMATION);
    const verdict = blocking.length ? VERDICT.NO : needsReview.length ? VERDICT.WITH_REVIEW : VERDICT.YES;

    return {
      version: 1,
      verdict, phase,
      blocking, needsReview, information,
      counts: { blocking: blocking.length, needsReview: needsReview.length, information: information.length },
      // Every finding, in the order they would be worked. Consumers that want
      // one list (the exported report, a regression suite) read this rather
      // than re-concatenating the three and getting the order wrong.
      all: [...blocking, ...needsReview, ...information],
      // What this layer did NOT do, stated so nothing downstream can imply it
      // did. No detector ran, no pixel was read, no model was consulted.
      provenance: {
        engine: "PRE_FLIGHT_AGGREGATION",
        trainedModel: false,
        derivedFrom: "the event's own tables, guests and assignments, and the conclusions already reached by the plan reader",
        recomputed: "on every read — no finding is stored, so a resolved one disappears by itself",
      },
    };
  }

  globalThis.MeritPlanDoctor = { version: 1, LEVEL, SOURCE, AFFECTS, GO, VERDICT, run };
})();
