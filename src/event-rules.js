// EVENT RULES — what every screen asks before it changes an event, and the
// physical chairs a table carries. Ownership area A02, moved out of
// app-v8.js as step 3b of benchmarks/MODULARIZATION-ORDER.md.
//
// Pure: reads no shell state, calls no render, shows no message. The DECISION
// that a change is refused lives here; what the operator is told, and in which
// language, stays with the shell's canMutate(), which owns the toast.
// Characterized by tests/suites/event-rules.test.mjs.
(() => {
  // The calendar day in the operator's own time zone, as YYYY-MM-DD.
  const todayKey = () => new Date().toLocaleDateString("en-CA");
  // Same id shape as the shell's uid() — `chair_<uuid>` — so a chair made here
  // is indistinguishable from one made anywhere else.
  const uid = (p) => `${p}_${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))}`;

  // A completed or past-dated event is a record of what happened. An event
  // dated TODAY is tonight's event and stays editable.
  function isHistorical(event) {
    return !!event && (event.status === "Completed" || (!!event.date && event.date < todayKey()));
  }
  // null when the change may go ahead; otherwise why it may not.
  function mutationRefusal(event) {
    if (!event) return "NO_EVENT";
    if (isHistorical(event)) return "HISTORICAL";
    return null;
  }

  function chairGeometry(table, count = Math.max(1, Number(table.capacity) || 1)) {
    const out = [];
    if (table.type === "round" || table.type === "bistro") {
      const rx = table.type === "bistro" ? 43 : 45, ry = table.type === "bistro" ? 43 : 46;
      for (let i = 0; i < count; i++) { const a = -Math.PI / 2 + i / count * Math.PI * 2; out.push({ x: 50 + Math.cos(a) * rx, y: 50 + Math.sin(a) * ry, rotation: a * 180 / Math.PI + 90 }); }
    } else if (table.type === "square") {
      for (let i = 0; i < count; i++) {
        const u = i / count * 4;
        if (u < 1) out.push({ x: 15 + u * 70, y: 7, rotation: 0 });
        else if (u < 2) out.push({ x: 93, y: 15 + (u - 1) * 70, rotation: 90 });
        else if (u < 3) out.push({ x: 85 - (u - 2) * 70, y: 93, rotation: 180 });
        else out.push({ x: 7, y: 85 - (u - 3) * 70, rotation: 270 });
      }
    } else {
      const top = Math.ceil(count / 2), bottom = count - top;
      for (let i = 0; i < top; i++) out.push({ x: top === 1 ? 50 : 12 + i * 76 / (top - 1), y: 8, rotation: 0 });
      for (let i = 0; i < bottom; i++) out.push({ x: bottom === 1 ? 50 : 88 - i * 76 / (bottom - 1), y: 92, rotation: 180 });
    }
    return out;
  }

  // THREE QUANTITIES, AND THEY ARE NOT THE SAME NUMBER.
  //
  //   LOGICAL SEATS -- `table.capacity`. The assignment index space: seats
  //   0..capacity-1. Every guest assignment, seat number, report row and
  //   pax check indexes into this and nothing else. It exists whether or
  //   not anybody ever drew a chair.
  //
  //   PHYSICAL CHAIRS -- `table.chairs`. Objects with real coordinates,
  //   existing ONLY where the plan genuinely drew a chair, Assisted
  //   Detection found one, or a person placed one. When none of those
  //   happened the array is EMPTY -- not a ring of invented positions
  //   wearing a `physical:false` label.
  //
  //   OPERATIONAL CAPACITY -- MeritSeatModel.seatingCapacity(): what the
  //   room can seat tonight, summed from logical seats.
  //
  // This function used to fabricate one chair object per capacity slot for
  // every table, symbolic or not, and mark the fake ones `physical:false`.
  // A 420-table symbolic plan therefore stored 4,200 chairs at coordinates
  // nothing had ever observed, re-derived and re-persisted on every single
  // save. A flag saying "this coordinate is not real" is not the same as
  // not writing the coordinate: the contract's rule is that no physical
  // chair is ever synthesised from a capacity number, and that is now
  // structural rather than annotated.
  //
  // `hasPhysicalSeats` decides WHETHER physical chairs exist; capacity
  // decides HOW MANY, when they do. Coordinates already on a chair survive
  // (Assisted Detection writes detected positions verbatim, and those must
  // never be regenerated into a synthetic ring) -- only the count follows
  // capacity.
  function syncTableChairs(table, count = table.capacity) {
    count = Math.max(1, Math.min(99, Number(count) || 1));
    table.capacity = count;
    if (table.hasPhysicalSeats === false) { table.chairs = []; return table; }
    const old = Array.isArray(table.chairs) ? table.chairs : [], geometry = chairGeometry({ ...table, capacity: count }, count);
    table.chairs = geometry.map((p, index) => ({
      id: old[index]?.id || uid("chair"), parentTableId: table.id, seatNumber: index + 1,
      x: Number.isFinite(old[index]?.x) ? old[index].x : p.x, y: Number.isFinite(old[index]?.y) ? old[index].y : p.y,
      rotation: Number.isFinite(old[index]?.rotation) ? old[index].rotation : p.rotation, occupancy: null,
    }));
    return table;
  }

  function refreshChairOccupancy(event) {
    for (const table of event.tables || []) syncTableChairs(table).chairs.forEach((chair) => { chair.occupancy = null; });
    // `continue`, not `return`: this used to abort the whole loop at the first
    // unassigned guest, leaving every later guest's chairs marked unoccupied.
    for (const guest of event.guests || []) {
      if (!guest.assignment) continue;
      const table = event.tables.find((x) => x.id === guest.assignment.tableId);
      if (!table) continue;
      (guest.assignment.seats || []).forEach((seatIndex, partyIndex) => {
        const chair = table.chairs[Number(seatIndex)];
        if (chair) chair.occupancy = { guestId: guest.id, partyIndex, planned: true };
      });
    }
  }

  globalThis.MeritEventRules = { version: 1, todayKey, isHistorical, mutationRefusal, chairGeometry, syncTableChairs, refreshChairOccupancy };
})();
