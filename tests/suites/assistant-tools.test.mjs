// The F8 assistant's read-only tools (src/assistant-tools.js), on the frozen
// fixture and question set in training/assistant/. This suite runs the RIGHT
// tool chain for each question by hand and checks that the tools return exactly
// the facts the answer must carry. Whether a model picks that chain is measured
// separately; if the tools themselves were wrong, no model could be right.
//
//   TWO PHONES, TWO PEOPLE. "Ayşe Demir" is two people in the fixture; the
//   tool must say ambiguous, never merge them into one attendance history.
//
//   CAME = CHECKED IN. A No Show keeps its planned seat and is never counted
//   as attended.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const meta = { name: "assistant-tools", tags: ["assistant", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  await import(pathToFileURL(path.join(repoRoot, "src/assistant-tools.js")).href);
  const T = globalThis.MeritAssistantTools;
  const fx = JSON.parse(fs.readFileSync(path.join(repoRoot, "training/assistant/fixture.json"), "utf8"));
  const E = fx.events, today = fx.today;
  const Q = Object.fromEntries(fs.readFileSync(path.join(repoRoot, "training/assistant/questions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((q) => [q.id, q]));
  const one = (name, opts) => { const r = T.findPerson(E, name, opts); return r.people.length === 1 ? r.people[0] : null; };
  const ev = (q) => T.findEvent(E, q, today).events;
  const want = (id) => Q[id].answer;

  let a = T.seatOf(E, one("Ahmet Yılmaz"), ev("Sezen Aksu konseri")[0].id);
  checks.equal({ event: a.event, table: a.table, seats: a.seats, arrival: a.arrival }, want(1), "Q1 seat at a named concert");
  let h = T.eventsOf(E, one("Ahmet Yılmaz"), today);
  checks.equal({ checkedIn: h.checkedIn, noShow: h.noShow, count: h.checkedIn.length }, want(2), "Q2 how many concerts he came to (a No Show is not one)");
  const ay = T.findPerson(E, "Ayşe Demir");
  checks.ok(ay.ambiguous && ay.people.length === 2, "Q3 two people share the name → ambiguous, asked", ay);
  a = T.seatOf(E, one("Ayşe Demir", { phone: "0544 999 99 99" }), ev("Tarkan")[0].id);
  checks.equal({ event: a.event, table: a.table, seats: a.seats }, want(4), "Q4 the phone picks the person");
  a = T.seatOf(E, one("Mehmet Kaya"), ev("Sezen Aksu")[0].id);
  checks.equal({ event: a.event, pax: a.pax, arrival: a.arrival }, want(5), "Q5 a +2 party is pax 3");
  let f = T.eventFacts(E, ev("Tarkan konseri")[0].id);
  checks.equal({ event: f.event, checkedInPax: f.checkedInPax }, want(6), "Q6 people at a concert = checked-in pax");
  f = T.eventFacts(E, ev("Yılbaşı galası")[0].id);
  checks.equal({ event: f.event, unassigned: f.unassigned }, want(7), "Q7 who has no table yet");
  h = T.eventsOf(E, one("Can Öztürk"), today);
  checks.equal(h.checkedIn.length, 0, "Q8 invited only to an event not held yet → came to none");
  checks.ok(T.findPerson(E, "Selin Ak").none, "Q9 no record → none (kayıt yok)");
  const last = ev("son konser")[0];
  a = T.seatOf(E, one("Ahmet"), last.id);
  checks.equal({ event: a.event, table: a.table, seats: a.seats, arrival: a.arrival }, want(10), "Q10 'the last concert' is the latest past event; the planned seat of a No Show");
  a = T.seatOf(E, one("Elif Şen"), ev("Sezen Aksu")[0].id);
  checks.equal({ event: a.event, arrival: a.arrival, table: a.table }, want(11), "Q11 did she come → No Show");
  const harbiye = ev("Harbiye").map((e) => e.id), elif = one("Elif Şen");
  checks.equal(Object.fromEntries(harbiye.map((id) => { const s = T.seatOf(E, elif, id); return [id, [s.table, s.seats, s.arrival]]; })), want(12).seats, "Q12 seats at every concert at a venue");
  h = T.eventsOf(E, one("Zeynep Arslan"), today);
  checks.ok(h.events.some((x) => x.event === "c4" && x.table === "VIP01"), "Q13 sat at a VIP table before");
  checks.equal(T.eventFacts(E, ev("Mabel Matiz")[0].id).noShow, want(14).noShow, "Q14 who did not come");
  const best = E.filter((e) => e.date < today).map((e) => T.eventFacts(E, e.id)).sort((x, y) => y.checkedInPax - x.checkedInPax)[0];
  checks.equal({ event: best.event, checkedInPax: best.checkedInPax }, want(15), "Q15 the concert with the most people");
  checks.equal(ev("Haziranda hangi etkinlik").map((e) => e.id), [want(16).event], "Q16 a month name finds the event");
  h = T.eventsOf(E, one("Mehmet Kaya"), today);
  checks.equal(Object.fromEntries(h.events.filter((x) => x.past).map((x) => [x.event, x.table])), want(17).tables, "Q17 same table every time");
  a = T.seatOf(E, one("ahmet yilmaz"), ev("tarkanda")[0].id);
  checks.equal({ event: a.event, table: a.table, seats: a.seats }, want(18), "Q18 without Turkish letters and with a suffix");
  checks.equal(T.eventFacts(E, "gala").byTable.T07, want(19).guests, "Q19 who is at a table");
  checks.ok(!ev("geçen yılbaşı").some((e) => /yilbasi/.test(T.fold(e.name)) && e.date < today), "Q20 no earlier New Year event → kayıt yok, not this year's gala");
}
