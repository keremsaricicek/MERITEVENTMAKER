// GUEST MEMORY — "has this person been with us before?"
//
// Pure module (src/guest-memory.js) over the stored events. What it guards:
//
//   THE EXISTING MATCHER, NOT A NEW ONE. The same person across events is
//     MeritAssistantTools.findPerson: folded name (ı/i, ş/s), and a phone that
//     disagrees makes two people. Same name, two phones, and no phone on the
//     record asked about is AMBIGUOUS — reported, never merged into one history.
//   "CAME" MEANS CHECKED IN. A No Show is a No Show, a past event with neither
//     is "not recorded", a future one is "upcoming" — never guessed.
//   READ-ONLY. Nothing in any event changes, and nothing is copied between events.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const meta = { name: "guest-memory", tags: ["business", "fast"], timeout: 30000 };

const DEPS = ["event-rules", "assistant-tools", "guest-memory"];
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA");

export default async function run({ checks, repoRoot }) {
  const ctx = vm.createContext({});
  for (const f of DEPS) {
    const p = path.join(repoRoot, "src", `${f}.js`);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: p });
  }
  const M = ctx.MeritGuestMemory;
  checks.require(!!M && typeof M.recall === "function", "MeritGuestMemory loads outside the browser with recall()");

  const g = (id, name, extra = {}) => ({ id, name, additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "",
    planningStatus: "Confirmed", arrivalStatus: "Not Arrived", checkedInAt: null, assignment: null, ...extra });
  const events = [
    { id: "e1", name: "Yaz Galası", date: day(-200), status: "Completed",
      tables: [{ id: "a1", number: "T07", capacity: 8 }],
      guests: [g("x1", "Ahmet Yılmaz", { phone: "+90 532 111 22 33", vip: "VIP", notes: "Sahne önü", invitedBy: "Kerem Sarıçiçek",
        pax: 3, additionalGuests: 2, arrivalStatus: "Checked In", assignment: { tableId: "a1", seats: [0, 1, 2] } }),
               g("x2", "Mehmet Demir", { arrivalStatus: "Checked In" })] },
    { id: "e2", name: "Kış Konseri", date: day(-60), status: "Planning",
      tables: [{ id: "b1", number: "VIP2", capacity: 6 }],
      guests: [g("y1", "AHMET YILMAZ", { vip: "VVIP", arrivalStatus: "No Show", invitedBy: "Kerem S.", assignment: { tableId: "b1", seats: [0] } })] },
    { id: "e3", name: "Bahar", date: day(-30), status: "Completed", tables: [],
      guests: [g("z1", "Ahmet Yilmaz", { phone: "0532 111 22 33" })] },
    { id: "e4", name: "Yılbaşı", date: day(20), status: "Planning", tables: [],
      guests: [g("w1", "Ahmet Yılmaz", { phone: "0532 111 22 33", walkIn: true })] },
    { id: "e5", name: "Başka", date: day(-10), status: "Completed", tables: [],
      guests: [g("v1", "Ahmet Yılmaz", { phone: "0505 999 88 77", arrivalStatus: "Checked In" }), g("v2", "Ahmet Yılmazer")] },
  ];
  const before = JSON.stringify(events);

  const r = M.recall(events, events[3].guests[0], { exceptEventId: "e4" });
  checks.equal(r.ambiguous || false, false, "a guest with a phone is one person", r);
  checks.equal((r.history || []).map((h) => h.eventId), ["e3", "e2", "e1"],
    "the history is the same person's other events, newest first, the current event left out — folded name (ı/i, upper case) matched, e5's different phone is a different person");
  const at = (id) => (r.history || []).find((h) => h.eventId === id) || {};
  checks.equal([at("e1").outcome, at("e2").outcome, at("e3").outcome], ["CAME", "NO_SHOW", "NOT_RECORDED"],
    "checked in = came, No Show = no show, a past event with neither = not recorded (never guessed)");
  checks.equal([at("e1").table, at("e2").table, at("e3").table], ["T07", "VIP2", null], "previous tables by their number; none where none was assigned");
  checks.equal([at("e1").vip, at("e1").notes, at("e1").host, at("e1").pax], ["VIP", "Sahne önü", "Kerem Sarıçiçek", 3], "VIP mark, notes, host and party size per event");
  checks.equal([at("e1").matchedBy, at("e2").matchedBy], ["name+phone", "name"],
    "each entry says whether a phone confirmed it or only the name did (e2 carries no phone)");
  checks.equal(r.summary, { events: 3, came: 1, noShow: 1, notRecorded: 1, upcoming: 0, vipMarks: ["VVIP", "VIP"], hosts: ["Kerem S.", "Kerem Sarıçiçek"], tables: ["VIP2", "T07"] },
    "the short summary counts what the records say");
  checks.ok(!(r.history || []).some((h) => h.eventId === "e5"), "the same name with a different phone is NOT this person's history");

  const up = M.recall(events, events[2].guests[0], { exceptEventId: "e3" });
  checks.equal(((up.history || []).find((h) => h.eventId === "e4") || {}).outcome, "UPCOMING", "a future event is upcoming, not a no-show");
  checks.equal(((up.history || []).find((h) => h.eventId === "e4") || {}).walkIn, true, "a walk-in record says so in the history");

  const amb = M.recall(events, { name: "Ahmet Yılmaz" }, {});
  checks.equal(amb.ambiguous, true, "the same name under two different phones, asked without a phone, is ambiguous");
  checks.equal((amb.history || []).length, 0, "and no history is built by merging them");
  checks.ok((amb.people || []).length >= 2, "both candidates are listed for a person to choose", amb.people);

  const none = M.recall(events, { name: "Zeynep Koç" }, {});
  checks.equal([none.none, (none.history || []).length], [true, 0], "a person never seen before has no history");
  checks.ok(!(r.history || []).some((h) => h.eventId === "e5"), "\"Ahmet Yılmazer\" is not \"Ahmet Yılmaz\"");

  checks.equal(JSON.stringify(events), before, "recall changes nothing in any event and copies nothing between them");
}
