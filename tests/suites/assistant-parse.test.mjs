// The F8 assistant's rule reader (src/assistant-parse.js) end to end on the
// frozen fixture: every question in training/assistant/questions.jsonl is
// parsed and answered from the data, every command in commands.jsonl is parsed
// and carried out through the acting layer with recording writers.
//
// HONEST LIMIT: the rules and these sets were written by the same hand, so a
// pass here is DEVELOPER-SEEN, not a measure of how the assistant understands
// people. The real test is sentences written by the owner afterwards
// (training/assistant/README.md).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const meta = { name: "assistant-parse", tags: ["assistant", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  for (const f of ["src/assistant-tools.js", "src/assistant-actions.js", "src/assistant-parse.js"]) await import(pathToFileURL(path.join(repoRoot, f)).href);
  const P = globalThis.MeritAssistantParse;
  const fx = JSON.parse(fs.readFileSync(path.join(repoRoot, "training/assistant/fixture.json"), "utf8"));
  const lines = (f) => fs.readFileSync(path.join(repoRoot, "training/assistant", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // what the answer text must carry for each question (the facts, as the data holds them)
  const must = {
    1: ["T12", "koltuk 4", "geldi"], 2: ["2 etkinliğimize", "Sezen Aksu", "Tarkan", "Mabel Matiz"], 3: ["2 kişi var", "Hangisi"], 4: ["T07", "koltuk 3"],
    5: ["3 kişi", "geldi"], 6: ["4 kişi geldi"], 7: ["Ahmet Yılmaz", "Zeynep Arslan", "Mehmet Kaya"], 8: ["0 etkinliğimize"], 9: ["kayıt yok"],
    10: ["Mabel Matiz", "T12", "gelmedi"], 11: ["T08", "gelmedi"], 12: ["T08", "T02"], 13: ["Evet", "VIP01"], 14: ["Ahmet Yılmaz"],
    15: ["Sezen Aksu", "5 kişi"], 16: ["Tarkan"], 17: ["Evet", "T08"], 18: ["T05", "koltuk 2"], 19: ["Ayşe Demir"], 20: ["kayıtlarda yok"],
  };
  for (const q of lines("questions.jsonl")) {
    const r = P.parse(q.q, fx.events, fx.today);
    const a = r.kind === "question" ? P.answer(r, fx.events, fx.today, fx.current) : { text: "" };
    checks.ok(must[q.id].every((w) => a.text.includes(w)), `Q${q.id} "${q.q}" → the answer carries the data's facts`, { parsed: r, answer: a.text });
  }
  // A sentence with two jobs in it is never half done by the rules: the rules
  // read ONE command, so a second verb sends the whole sentence on (to the
  // second reader, or back as a question) and nothing changes. Found 2026-10-28:
  // "X'i çıkar ve yerine Y'yi T05'e ekle" seated X at T05.
  for (const t of ["Mehmet Kaya'yı sil ve Can Öztürk'ü T04'e oturt", "Zeynep Arslan'ı VIP yap, sonra T02'ye taşı",
    "Ayşe Demir'i masasından kaldır ve yerine Elif Şen'i koy", "T01'deki herkesi T06'ya taşı, Can Öztürk'ü de sil"]) {
    const r = P.parse(t, fx.events, fx.today);
    checks.equal([r.kind, r.compound], ["unknown", true], `"${t}" — two jobs: the rules change nothing and pass it on`, r);
  }
  for (const c of lines("commands.jsonl")) {
    const events = JSON.parse(JSON.stringify(fx.events)), calls = [];
    const gala = () => events.find((e) => e.id === fx.current);
    const rec = (name) => (...a) => { calls.push([name, ...a]); if (name === "addGuest") { gala().guests.push({ id: "new1", name: a[0], pax: a[1], assignment: null }); return "new1"; } };
    const A = globalThis.MeritAssistantActions.create({ events: () => events, current: () => fx.current, today: () => fx.today,
      canMutate: (e) => e.date >= fx.today && e.status !== "Completed",
      writers: { assign: rec("assign"), unassign: rec("unassign"), deleteGuest: rec("deleteGuest"), setPax: rec("setPax"), setVip: rec("setVip"), addGuest: rec("addGuest") },
      snapshot: () => null, registerUndo: () => {} });
    const r = P.parse(c.text, fx.events, fx.today);
    const out = r.kind === "command" ? A.run(r.plan) : { ask: "not understood" };
    if (c.calls) {
      const want = c.calls.map((x) => x[0] === "assign" && x[1] === "<new>" ? ["assign", "new1", x[2], x[3]] : x);
      checks.equal(calls, want, `C${c.id} "${c.text}" → the right writer calls`, { parsed: r, out });
    } else checks.ok(calls.length === 0 && (c.ask ? !!out.ask : !!out.refuse), `C${c.id} "${c.text}" → nothing changed, it ${c.ask ? "asks" : "refuses"}`, { parsed: r, out });
  }

  // THE OPEN EVENT. A question that names no event is about the event that is open
  // (found by the UX task tests, 2026-11-01: "Can Öztürk nerede oturuyor?" answered
  // "Bu etkinlik kayıtlarda yok."). A NAMED event the records lack is still refused.
  for (const t of ["Can Öztürk nerede oturuyor?", "Can Öztürk hangi masada", "Zeynep Arslan nerede oturacak", "can ozturk nerde"]) {
    const r = P.parse(t, fx.events, fx.today);
    const a = r.kind === "question" ? P.answer(r, fx.events, fx.today, fx.current) : { text: "" };
    checks.ok(/Yılbaşı Galası/.test(a.text), `"${t}" — no event named: answered about the open event`, { parsed: r, answer: a.text });
  }
  const viaModel = P.answer({ kind: "question", intent: "seatAt", person: "Can Öztürk", phone: null, event: null, many: false, table: null, steps: [] }, fx.events, fx.today, fx.current);
  checks.ok(/Yılbaşı Galası/.test(viaModel.text), "a model reading with no event: answered about the open event", viaModel.text);
  const named = P.answer({ kind: "question", intent: "seatAt", person: "Can Öztürk", phone: null, event: "kenan doğulu konseri", many: false, table: null, steps: [] }, fx.events, fx.today, fx.current);
  checks.ok(/kayıtlarda yok/.test(named.text), "a named event the records lack is still refused, never swapped for the open one", named.text);

  // ENGLISH UI, ENGLISH ANSWERS (owner 2026-11-02: the program is fully Turkish and fully English).
  // The same facts, worded in English; Turkish stays the default. Fails before the change (Turkish only).
  const q = { kind: "question", intent: "seatAt", person: "Ahmet Yılmaz", phone: null, event: "tarkan", many: false, table: null, steps: [] };
  const enA = P.answer(q, fx.events, fx.today, fx.current, "en").text, trA = P.answer(q, fx.events, fx.today, fx.current).text;
  checks.ok(/20 June 2026/.test(enA) && /came\./.test(enA) && !/geldi|Haziran/.test(enA), "an English UI gets the answer in English", enA);
  checks.ok(/20 Haziran 2026/.test(trA) && /geldi\./.test(trA), "Turkish stays the default", trA);
  const unq = P.answer({ kind: "question", intent: "unassigned", person: null, phone: null, event: null, many: false, table: null, steps: [] }, fx.events, fx.today, fx.current, "en").text;
  checks.ok(/^No table yet: /.test(unq), "an English list answer", unq);
  const Aen = globalThis.MeritAssistantActions.create({ events: () => JSON.parse(JSON.stringify(fx.events)), current: () => fx.current, today: () => fx.today, lang: () => "en",
    canMutate: () => true, writers: {}, snapshot: () => null, registerUndo: () => {} });
  const miss = Aen.resolve([{ op: "assign", guest: "Kenan Kaplan", table: "T03" }]);
  checks.ok(/is not in this event/.test(miss.ask || ""), "an English UI gets the command's question in English", miss);

  // AT THE DOOR (owner 2026-11-02): a statement that a guest came checks them in, through the
  // arrival axis's one writer; "geldi mi" stays a question; an arrived guest is not checked in twice.
  const door = (x) => { const r = P.parse(x, fx.events, fx.today); return r.kind === "command" && r.plan[0].op === "arrive" ? r.plan[0].guest : r.kind; };
  checks.equal(["ahmet yilmaz geldi", "Mehmet Kaya +1 geldi", "Zeynep Arslan ve eşi geldi", "Can Öztürk arrived", "Mehmet Kaya'lar geldi"].map(door),
    ["ahmet yilmaz", "Mehmet Kaya", "Zeynep Arslan", "Can Öztürk", "Mehmet Kaya"], "a guest who came is read as a check-in, party words dropped");
  checks.ok(door("ahmet yilmaz geldi mi") !== "ahmet yilmaz" && door("Ahmet Yılmaz geldi?") !== "Ahmet Yılmaz", "\"geldi mi\" stays a question");
  checks.ok(["zeynep arslan bize kac kez geldi", "Mabel Matiz'e toplam kaç kişi geldi", "Elif Şen Tarkan'da kaç kişiyle geldi"].every((x) => P.parse(x, fx.events, fx.today).kind !== "command"),
    "a question about who or how many came is never a check-in");
  const evs = JSON.parse(JSON.stringify(fx.events)), arrived = [];
  const Ad = globalThis.MeritAssistantActions.create({ events: () => evs, current: () => fx.current, today: () => fx.today, canMutate: () => true, snapshot: () => null, registerUndo: () => {},
    writers: { setArrival: (id, st) => { const g = evs.find((e) => e.id === fx.current).guests.find((x) => x.id === id); arrived.push([g.name, st]); g.arrivalStatus = st; return { to: st }; } } });
  const out1 = Ad.run([{ op: "arrive", guest: "can ozturku" }]);
  checks.ok(arrived.length === 1 && arrived[0][0] === "Can Öztürk" && arrived[0][1] === "Checked In" && /T02/.test(out1.lines.join(" ")), "the guest is checked in, and told where they sit", { arrived, lines: out1.lines });
  const out2 = Ad.run([{ op: "arrive", guest: "Can Öztürk" }]);
  checks.ok(arrived.length === 1 && /zaten geldi/.test((out2.lines || []).join(" ")), "an arrived guest is not checked in twice", out2);
}
