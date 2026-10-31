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
}
