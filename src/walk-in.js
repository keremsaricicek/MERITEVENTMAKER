// WALK-IN AT THE DOOR — somebody who is not on the list (owner-approved 2026-11-07).
//
// Pure: reads only its arguments and the published Merit* definitions; writes
// nothing. Two answers:
//
//   buildWalkIn(event, input, now) — the `data` the guest dialog's writer
//     (saveGuestRecord) takes for a NEW record: one record, pax = 1 + N, marked
//     `walkIn: true` with `walkInAt` (when the door registered them). It carries
//     no id, arrival status, check-in moment or seat: saveGuestRecord gives the
//     id and "Not Arrived", setArrival() is the one arrival writer (the caller is
//     told to check them in through it, so the audit trail records it), and
//     MeritSeatAssignment is the one seat writer. Planning and arrival stay two
//     axes: the planning default is the dialog's ("Confirmed") and nothing here
//     derives one from the other. A name already on the list is REPORTED
//     (MeritAssistantTools.findPerson — the existing name + phone matcher), never
//     merged.
//
//   suggestSeats(event, pax, { vip }) — tables with room TONIGHT for the whole
//     party at one table. Tonight's room is the live occupancy
//     (MeritOccupancy.liveUsedIndexes): a No Show's seats are free. The plan is
//     untouched: a No Show keeps `guest.assignment`, and the existing writer
//     (assignGuestToTable) counts PLANNED seats, so an option that only fits
//     because of a No Show says `assignable: false` instead of pretending the
//     Apply button would work. Such a table is `livePlaceable` (owner decision
//     2026-11-08): `liveSeats` (the No Show's freed seats first) and `noShows`
//     (whose place it is) feed the confirmation, and only after it
//     MeritOccupancy.placeLive seats the walk-in TONIGHT — the No Show's
//     planned seat and assignment untouched. VIP tables only for VIP/VVIP; unavailable,
//     frozen and seatless tables are never offered. Moves nobody.
//
// A historical event (Completed or past) refuses both — the canMutate rule.
(function () {
  "use strict";

  const SEATS = () => globalThis.MeritSeatModel;
  const RULES = () => globalThis.MeritEventRules;
  const OCC = () => globalThis.MeritOccupancy;
  const AVAIL = () => globalThis.MeritTableAvailability;
  const FREEZE = () => globalThis.MeritSeatingFreeze;
  const TOOLS = () => globalThis.MeritAssistantTools;

  const VIP_LEVELS = ["Standard", "VIP", "VVIP"];
  const BLOCKED = { NO_SEATS: "NO_SEATS", UNAVAILABLE: "UNAVAILABLE", FROZEN: "FROZEN", VIP_ONLY: "VIP_ONLY", NOT_ENOUGH_SEATS: "NOT_ENOUGH_SEATS" };

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const paxOf = (g) => Math.max(1, num(g && g.pax) || 1);

  // The guest dialog's "Name +3" rule (parseCompactName, app-guests.js), the
  // same regular expression: a trailing +N is N companions.
  function parseName(value) {
    const raw = String(value == null ? "" : value).trim();
    const m = raw.match(/^(.*?)\s*\+\s*(\d+)\s*$/);
    return m ? { name: m[1].trim(), additionalGuests: Number(m[2]), detected: true } : { name: raw, additionalGuests: 0, detected: false };
  }

  function refusal(event) {
    if (!event) return "NO_EVENT";
    const R = RULES();
    if (R && R.mutationRefusal) return R.mutationRefusal(event);
    return event.status === "Completed" ? "HISTORICAL" : null;
  }

  function buildWalkIn(event, input, now) {
    const refused = refusal(event);
    if (refused) return { refused };
    const inp = input || {};
    const compact = parseName(inp.name);
    if (!compact.name) return { refused: "NAME_REQUIRED" };
    let additional = Math.max(0, Math.floor(num(inp.additionalGuests)));
    if (compact.detected && additional === 0) additional = compact.additionalGuests;
    const data = {
      name: compact.name,
      additionalGuests: additional,
      pax: 1 + additional,
      planningStatus: "Confirmed",
      vip: VIP_LEVELS.includes(inp.vip) ? inp.vip : "Standard",
      invitedBy: String(inp.invitedBy == null ? "" : inp.invitedBy).trim().slice(0, 120),
      notes: String(inp.notes == null ? "" : inp.notes).trim(),
      expectedArrival: null,
      walkIn: true,
      walkInAt: now || null,
    };
    const phone = String(inp.phone == null ? "" : inp.phone).trim().slice(0, 30);
    if (phone) data.phone = phone;
    return { data, alreadyListed: alreadyListed(event, data.name, phone), then: { arrival: "Checked In", source: "walk-in" } };
  }

  // Records in THIS event that the existing matcher calls the same person.
  function alreadyListed(event, name, phone) {
    const T = TOOLS();
    if (!T || !T.findPerson) return [];
    const key = T.fold(name);
    const found = T.findPerson([event], name, phone ? { phone } : undefined);
    const out = [];
    for (const p of found.people) {
      if (T.fold(p.name) !== key) continue;
      for (const r of p.records) {
        const g = (event.guests || []).find((x) => x.id === r.guestId);
        if (g) out.push({ guestId: g.id, name: g.name, pax: paxOf(g) });
      }
    }
    return out;
  }

  const isVipGuest = (vip) => vip === "VIP" || vip === "VVIP";
  const isVipTable = (t) => /VIP/i.test(String(t.zone || "")) || /^\s*VIP/i.test(String(t.number || ""));
  const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), "en", { numeric: true });

  // Planned seat indexes at a table: every assignment, a No Show's included
  // (the plan keeps it) — the same set occupiedSeatIndexes (app.js) builds.
  function plannedUsed(event, tableId) {
    const used = new Set();
    for (const g of event.guests || []) if (g.assignment && g.assignment.tableId === tableId) (g.assignment.seats || []).forEach((s) => used.add(Number(s)));
    return used;
  }
  function liveUsed(event, tableId) {
    const O = OCC();
    if (O && O.liveUsedIndexes) return O.liveUsedIndexes(event, tableId);
    const used = new Set();
    for (const g of event.guests || []) if (g.arrivalStatus !== "No Show" && g.assignment && g.assignment.tableId === tableId) (g.assignment.seats || []).forEach((s) => used.add(Number(s)));
    return used;   // fallback without MeritOccupancy: it cannot see live placements, and none can exist without it
  }

  function suggestSeats(event, pax, opts) {
    const refused = refusal(event);
    if (refused) return { refused, mutated: false };
    const need = Math.max(1, Math.floor(num(pax)) || 1);
    const vip = isVipGuest(opts && opts.vip);
    const tables = event.tables || [];
    const A = AVAIL(), F = FREEZE();
    const unavailable = A ? A.unavailableTableIds(tables) : new Set(tables.filter((t) => t.availability === "UNAVAILABLE").map((t) => t.id));
    const frozen = F ? F.frozenTableIds(event.freezes, tables) : new Set();
    const S = SEATS();
    const options = [], blocked = [];
    for (const t of tables) {
      const number = String(t.number);
      const cap = S ? S.logicalSeatCount(t) : Math.max(0, Math.trunc(num(t.capacity)));
      if (!(S ? S.canSeat(t) : cap > 0)) { blocked.push({ tableId: t.id, number, why: BLOCKED.NO_SEATS }); continue; }
      if (unavailable.has(t.id)) { blocked.push({ tableId: t.id, number, why: BLOCKED.UNAVAILABLE }); continue; }
      if (frozen.has(t.id)) { blocked.push({ tableId: t.id, number, why: BLOCKED.FROZEN }); continue; }
      const vipTable = isVipTable(t);
      if (vipTable && !vip) { blocked.push({ tableId: t.id, number, why: BLOCKED.VIP_ONLY }); continue; }
      const live = liveUsed(event, t.id), planned = plannedUsed(event, t.id);
      const index = Array.from({ length: cap }, (_, i) => i);
      const liveFreeIdx = index.filter((i) => !live.has(i));
      const plannedFreeIdx = index.filter((i) => !planned.has(i));
      const liveFree = liveFreeIdx.length, plannedFree = plannedFreeIdx.length;
      if (liveFree < need) { blocked.push({ tableId: t.id, number, why: BLOCKED.NOT_ENOUGH_SEATS, liveFree, needed: need }); continue; }
      const assignable = plannedFree >= need;
      const freed = liveFreeIdx.filter((i) => planned.has(i));
      const livePlaceable = !assignable && freed.length > 0;
      const liveSeats = livePlaceable ? freed.concat(liveFreeIdx.filter((i) => !planned.has(i))).slice(0, need) : [];
      const noShows = livePlaceable ? (event.guests || []).filter((g) => g.arrivalStatus === "No Show" && g.assignment && g.assignment.tableId === t.id
        && (g.assignment.seats || []).some((x) => liveSeats.includes(Number(x)))).map((g) => ({ guestId: g.id, name: g.name })) : [];
      options.push({
        tableId: t.id, number, zone: t.zone || null, vipTable,
        capacity: cap, liveFree, plannedFree,
        freedByNoShow: liveFreeIdx.filter((i) => planned.has(i)).length,
        assignable,
        seats: assignable ? plannedFreeIdx.slice(0, need) : [],
        livePlaceable, liveSeats, noShows,
      });
    }
    options.sort((a, b) => (b.assignable - a.assignable)
      || (vip ? b.vipTable - a.vipTable : 0)
      || ((a.liveFree - need) - (b.liveFree - need))
      || byNumber(a, b));
    return { pax: need, options, blocked, mutated: false };
  }

  globalThis.MeritWalkIn = Object.freeze({ version: 1, BLOCKED, parseName, buildWalkIn, suggestSeats, isVipTable });
})();
