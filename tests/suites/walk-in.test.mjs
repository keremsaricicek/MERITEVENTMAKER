// WALK-IN AT THE DOOR — somebody who is not on the list.
//
// Pure module (src/walk-in.js), loaded straight into a vm context with the
// modules it reads. What this suite guards, in the operator's words:
//
//   ONE RECORD. "Ali Kaya +2" at the door is one guest record with pax 3, in
//     the same shape the guest dialog writes (saveGuestRecord's `data`), marked
//     walkIn with the moment they were registered. The record carries no id,
//     arrival status, check-in moment or assignment: those belong to their one
//     writers (saveGuestRecord, setArrival, MeritSeatAssignment).
//   A FINISHED EVENT IS NOT A DOOR. A historical event refuses (canMutate rule).
//   TONIGHT'S ROOM, NOT THE PLAN'S. Seats a No Show left are free tonight
//     (liveUsedIndexes) and are counted — but the No Show keeps the planned
//     seat, so a table that only fits thanks to a No Show is NOT assignable
//     through the existing writer, and says so.
//   VIP TABLES ONLY FOR VIP. Unavailable and frozen tables are never offered.
//   NOTHING MOVES. Suggesting changes no record.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const meta = { name: "walk-in", tags: ["business", "fast"], timeout: 30000 };

const DEPS = ["seat-model", "event-rules", "occupancy", "table-availability", "seating-freeze", "assistant-tools", "walk-in"];
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA");

export default async function run({ checks, repoRoot }) {
  const ctx = vm.createContext({});
  for (const f of DEPS) {
    const p = path.join(repoRoot, "src", `${f}.js`);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: p });
  }
  const W = ctx.MeritWalkIn;
  checks.require(!!W && typeof W.buildWalkIn === "function" && typeof W.suggestSeats === "function",
    "MeritWalkIn loads outside the browser with buildWalkIn and suggestSeats");

  const table = (id, number, capacity, extra = {}) => ({ id, number, capacity, zone: "", chairs: [], hasPhysicalSeats: false, ...extra });
  const guest = (id, name, pax, extra = {}) => ({ id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "", notes: "",
    planningStatus: "Confirmed", arrivalStatus: "Not Arrived", checkedInAt: null, expectedArrival: null, assignment: null, ...extra });
  const event = (extra = {}) => ({
    id: "ev1", name: "Gala", date: day(10), status: "Planning",
    tables: [
      table("t1", "T01", 4),                          // 2 planned (Not Arrived) -> 2 free
      table("t2", "T02", 4),                          // 4 planned, 3 of them a No Show -> 3 free tonight, 0 in the plan
      table("t3", "VIP1", 6, { zone: "VIP FRONT" }),  // empty VIP table
      table("t4", "T04", 8, { availability: "UNAVAILABLE", unavailableReason: "DAMAGED" }),
      table("t5", "T05", 8),                          // frozen below
      table("t6", "T06", 0),                          // cannot seat
    ],
    guests: [
      guest("g1", "Ayşe Demir", 2, { assignment: { tableId: "t1", seats: [0, 1] } }),
      guest("g2", "Burak Şahin", 3, { assignment: { tableId: "t2", seats: [0, 1, 2] }, arrivalStatus: "No Show" }),
      guest("g3", "Can Öztürk", 1, { assignment: { tableId: "t2", seats: [3] }, arrivalStatus: "Checked In", checkedInAt: "2026-01-01T20:00:00.000Z" }),
      guest("g4", "Ahmet Kaya", 3, { phone: "0532 111 22 33" }),
    ],
    freezes: [{ id: "f1", scope: "TABLE", tableId: "t5", reason: "VIP_AREA" }],
    ...extra,
  });

  // ---- 1. the record ------------------------------------------------------------
  const now = "2026-11-07T21:14:00.000Z";
  const ev = event();
  const before = JSON.stringify(ev);
  const r = W.buildWalkIn(ev, { name: "  Ali Kaya +2 ", invitedBy: " Kerem S. ", vip: "VIP" }, now);
  checks.equal(r.refused || null, null, "a walk-in on a future event is accepted", r);
  const d = r.data || {};
  checks.equal([d.name, d.additionalGuests, d.pax], ["Ali Kaya", 2, 3], "\"Ali Kaya +2\" is ONE record: name without the +2, two companions, pax 3");
  checks.equal([d.walkIn, d.walkInAt], [true, now], "the record is marked walk-in, with the moment it was registered at the door");
  checks.equal([d.vip, d.invitedBy, d.planningStatus, d.expectedArrival], ["VIP", "Kerem S.", "Confirmed", null], "VIP level, host (trimmed), the dialog's planning default, no stated arrival window");
  checks.equal(["id", "arrivalStatus", "checkedInAt", "assignment"].filter((k) => k in d), [],
    "the record carries no id, arrival status, check-in moment or seat — each has its own writer");
  checks.equal(r.then, { arrival: "Checked In", source: "walk-in" }, "the caller is told to check them in through setArrival (the one arrival writer)");
  checks.equal(W.buildWalkIn(ev, { name: "Deniz", additionalGuests: 3 }, now).data.pax, 4, "an explicit companion count makes pax 1 + N");
  checks.equal(W.buildWalkIn(ev, { name: "Deniz +3", additionalGuests: 1 }, now).data.additionalGuests, 1,
    "an explicit count wins over a typed +N (the guest dialog's rule)");
  checks.equal(W.buildWalkIn(ev, { name: "Deniz", additionalGuests: -4, vip: "KING" }, now).data.additionalGuests, 0, "a negative count is no companions");
  checks.equal(W.buildWalkIn(ev, { name: "Deniz", vip: "KING" }, now).data.vip, "Standard", "an unknown VIP level is Standard");
  checks.equal(W.buildWalkIn(ev, { name: "Deniz" }, now).data.invitedBy, "", "the host is optional");
  checks.equal(W.buildWalkIn(ev, { name: "  +2 " }, now).refused, "NAME_REQUIRED", "a walk-in with no name is refused");
  const dup = W.buildWalkIn(ev, { name: "Ahmet Kaya" }, now);
  checks.equal((dup.alreadyListed || []).map((x) => x.guestId), ["g4"], "a name that IS on the list is reported (the door may be about to make a duplicate)");
  checks.equal(W.buildWalkIn(ev, { name: "Ahmet Kaya", phone: "0555 999 88 77" }, now).alreadyListed, [],
    "the same name with a different phone is a different person (the existing phone rule)");
  checks.equal(JSON.stringify(ev), before, "building a walk-in changes nothing in the event");

  // ---- 2. historical --------------------------------------------------------------
  checks.equal(W.buildWalkIn(event({ status: "Completed" }), { name: "Ali" }, now).refused, "HISTORICAL", "a Completed event refuses a walk-in");
  checks.equal(W.buildWalkIn(event({ date: day(-3) }), { name: "Ali" }, now).refused, "HISTORICAL", "a past-dated event refuses a walk-in");
  checks.equal(W.suggestSeats(event({ status: "Completed" }), 2).refused, "HISTORICAL", "a historical event suggests no seats");
  checks.equal(W.buildWalkIn(null, { name: "Ali" }, now).refused, "NO_EVENT", "no event, no walk-in");

  // ---- 3. tonight's free seats ---------------------------------------------------
  const s2 = W.suggestSeats(ev, 2, { vip: "Standard" });
  const opt = (s, id) => (s.options || []).find((o) => o.tableId === id);
  const why = (s, id) => ((s.blocked || []).find((b) => b.tableId === id) || {}).why || null;
  checks.equal(opt(s2, "t1") && [opt(s2, "t1").liveFree, opt(s2, "t1").plannedFree, opt(s2, "t1").assignable], [2, 2, true],
    "a table with two empty seats offers them to a party of two, assignable through the existing writer");
  checks.equal(opt(s2, "t2") && [opt(s2, "t2").liveFree, opt(s2, "t2").plannedFree, opt(s2, "t2").freedByNoShow, opt(s2, "t2").assignable], [3, 0, 3, false],
    "seats a No Show left are free TONIGHT (3), but the plan still holds them (0), so the table is not assignable without touching the No Show's seat");
  checks.equal(why(s2, "t3"), "VIP_ONLY", "a Standard walk-in is not offered a VIP table");
  checks.equal(why(s2, "t4"), "UNAVAILABLE", "an unavailable table is never offered");
  checks.equal(why(s2, "t5"), "FROZEN", "a frozen table is never offered");
  checks.equal(why(s2, "t6"), "NO_SEATS", "a table with no logical seats is never offered");
  checks.equal(s2.options[0].tableId, "t1", "an assignable table comes before one that only fits thanks to a No Show");
  checks.equal(opt(s2, "t1").seats, [2, 3], "an assignable option names the plan's free seat indexes");
  checks.equal(s2.mutated, false, "the answer says nothing has changed");

  const s3 = W.suggestSeats(ev, 3, { vip: "Standard" });
  checks.equal(why(s3, "t1"), "NOT_ENOUGH_SEATS", "a party of three is never split over a two-seat gap (one record, one table)");
  checks.ok(!!opt(s3, "t2"), "the No Show's three freed seats take a party of three tonight", s3);

  const v = W.suggestSeats(ev, 2, { vip: "VVIP" });
  checks.equal(v.options[0] && v.options[0].tableId, "t3", "a VVIP walk-in is offered the VIP table first");
  checks.equal(opt(v, "t3") && opt(v, "t3").vipTable, true, "and the option says it is a VIP table");

  checks.equal(JSON.stringify(ev), before, "suggesting seats moves nobody: planned seats, No Show assignments and arrivals are byte-identical");
  checks.equal(ev.guests[1].assignment, { tableId: "t2", seats: [0, 1, 2] }, "the No Show still holds the planned seats");

  // ---- 4. a No Show's freed seat, after a confirmation (owner 2026-11-08) ----------
  // A LIVE placement only: guest.livePlacement, written by ONE writer
  // (MeritOccupancy.placeLive), counted by liveUsedIndexes; the No Show keeps
  // guest.assignment and the plan (occupiedSeatIndexes) never sees the walk-in.
  const o2 = opt(s2, "t2");
  checks.equal(o2 && [o2.livePlaceable, o2.liveSeats, (o2.noShows || []).map((x) => [x.guestId, x.name])], [true, [0, 1], [["g2", "Burak Şahin"]]],
    "a table that fits only thanks to a No Show is offered as a LIVE placement: the No Show's freed seats, and whose place it is (for the question)");
  checks.equal([opt(s2, "t1").livePlaceable, opt(s2, "t1").liveSeats], [false, []], "a table with free planned seats is not a live placement — it goes through the assignment writer");

  const O = ctx.MeritOccupancy;
  checks.require(typeof O.placeLive === "function", "MeritOccupancy.placeLive is the one writer of a live placement");
  const evL = event();
  const walker = guest("w1", "Ali Kaya", 2, { walkIn: true, walkInAt: now, arrivalStatus: "Checked In", checkedInAt: now });
  evL.guests.push(walker);
  const others = (e) => JSON.stringify(e.guests.filter((g) => g.id !== "w1").map((g) => [g.id, g.assignment, g.arrivalStatus]));
  const planBefore = others(evL);
  const place = { tableId: "t2", seats: [0, 1] };
  checks.equal(O.placeLive(evL, walker, place, { now }).refused, "CONFIRM_REQUIRED", "no live placement without the confirmation");
  checks.equal("livePlacement" in walker, false, "a refused placement writes nothing");
  checks.equal(O.placeLive(event({ status: "Completed", guests: [walker] }), walker, place, { confirmed: true, now }).refused, "HISTORICAL", "a historical event refuses a live placement");
  checks.equal(O.placeLive(evL, evL.guests[3], place, { confirmed: true, now }).refused, "NOT_A_WALK_IN", "only a walk-in is placed live");
  checks.equal(O.placeLive(evL, walker, { tableId: "t2", seats: [3, 0] }, { confirmed: true, now }).refused, "SEATS_NOT_FREE", "a seat somebody uses tonight is refused");
  checks.equal(O.placeLive(evL, walker, { tableId: "t2", seats: [0] }, { confirmed: true, now }).refused, "SEATS_NOT_FREE", "the whole party sits: one seat for a party of two is refused");
  checks.equal(O.placeLive(evL, walker, { tableId: "t1", seats: [2, 3] }, { confirmed: true, now }).refused, "NOT_A_NO_SHOW_SEAT", "plan-free seats are not a live placement (the assignment writer seats them)");
  checks.equal(O.placeLive(evL, guest("w2", "Zeynep", 1, { walkIn: true, arrivalStatus: "Checked In" }), { tableId: "t2", seats: [0] }, { confirmed: true, now }).refused, "NO_GUEST",
    "a guest not in this event is refused");
  const ok = O.placeLive(evL, walker, place, { confirmed: true, now });
  checks.equal([ok.ok, walker.livePlacement], [true, { tableId: "t2", seats: [0, 1], noShowGuestIds: ["g2"], at: now }],
    "confirmed: the walk-in sits tonight in the No Show's freed seats, and the record says whose place it was");
  checks.equal(walker.assignment, null, "the walk-in has NO planned seat: GUEST LIST/UNASSIGNED read the plan, which did not change");
  checks.equal(others(evL), planBefore, "the No Show keeps guest.assignment and arrival status; nobody else moved");
  checks.equal([...O.liveUsedIndexes(evL, "t2")].sort(), [0, 1, 3], "tonight the seats are used again (live occupancy counts the placement)");
  const after = opt(W.suggestSeats(evL, 1), "t2");
  checks.equal(after && [after.liveFree, after.plannedFree], [1, 0], "the next walk-in sees one free seat at that table tonight, and the plan still none");

  // ONE writer: nothing else in src/ assigns guest.livePlacement.
  const offenders = [];
  for (const file of fs.readdirSync(path.join(repoRoot, "src")).filter((f) => f.endsWith(".js") && f !== "occupancy.js")) {
    const src = fs.readFileSync(path.join(repoRoot, "src", file), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const m of src.matchAll(/\.livePlacement\s*=(?!=)|\blivePlacement\s*:/g)) offenders.push(`${file}: ${m[0]}`);
  }
  checks.equal(offenders, [], "MeritOccupancy.placeLive is the only code in src/ that writes guest.livePlacement");
}
