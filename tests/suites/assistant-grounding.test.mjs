// THE MODEL'S READING IS PUT BACK TO WHAT THE PERSON TYPED (2026-11-02,
// training/README.md "Grounding").
//
// The small model cuts and bends names ("rıza oktayı" → "okta", "mehmet
// kayanin" → "mehmet kayan"). The product does not trust the model's spelling:
//   A GUEST TYPED WITH A CASE ENDING IS STILL THE GUEST. "kayanin", "ozturku",
//     "arslani" find Mehmet Kaya, Can Öztürk, Zeynep Arslan (no apostrophe).
//   A NEW GUEST'S NAME IS THE ONE IN THE SENTENCE. A cut or slipped name is
//     put back from the sentence, a dropped first name is taken back, a typed
//     case ending comes off — and the reading is then LOOSE: never carried out
//     by itself, shown first for Onayla.
//   AN EVENT THE SENTENCE NEVER NAMED IS NOT ASKED ABOUT. "son konser" read into
//     "Can Öztürk nerede oturuyor" is dropped: the open event is meant.
//   CLEAN READINGS STAY CLEAN. A name typed exactly as read is grounded.
// Mutation proof, recorded 2026-11-02: on the code before this change the suite
// fails (no sentence was consulted; findPerson took prefixes only).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const meta = { name: "assistant-grounding", tags: ["assistant", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  for (const f of ["assistant-tools.js", "assistant-parse.js", "assistant-reading.js"]) await import(pathToFileURL(path.join(repoRoot, "src", f)).href);
  const T = globalThis.MeritAssistantTools, R = globalThis.MeritAssistantReading;
  const fx = JSON.parse(fs.readFileSync(path.join(repoRoot, "training/assistant/fixture.json"), "utf8"));
  const E = fx.events, gala = [E.find((e) => e.id === fx.current)];
  const who = (q) => { const r = T.findPerson(gala, q); return r.people.length === 1 ? r.people[0].name : r.people.length; };
  checks.equal(who("mehmet kayanin"), "Mehmet Kaya", "a genitive typed on finds the guest");
  checks.equal(who("ozturku"), "Can Öztürk", "an accusative typed on finds the guest");
  checks.equal(who("zeynep arslani"), "Zeynep Arslan", "a full name with a case ending finds the guest");
  checks.equal(who("zeynep arsaln"), "Zeynep Arslan", "two swapped letters still find the guest");
  checks.equal(who("Kaplan"), 0, "a different name does not");

  const cmd = (steps) => ({ kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null,
    steps: steps.map((s) => Object.assign({ op: null, guest: null, table: null, from: null, other: null, name: null, pax: null, fromTable: null }, s)) });
  let p = R.toParse(cmd([{ op: "addGuest", name: "okta", pax: 1 }]), E, fx.today, "listeye rıza oktayı da yaz");
  checks.equal(p.plan[0].name, "Rıza Oktay", "a cut name is put back from the sentence, its case ending off");
  checks.ok(p.loose && !R.grounded(p, "", E, fx.current), "…and it is loose: shown first, never carried out by itself");
  p = R.toParse(cmd([{ op: "addGuest", name: "burbu tan", pax: 1 }]), E, fx.today, "bir misafir daha burcu tan");
  checks.equal(p.plan[0].name, "Burcu Tan", "a slipped letter is put back from the sentence");
  p = R.toParse(cmd([{ op: "addGuest", name: "Ergin", pax: 1 }, { op: "assign", guest: "Ergin", table: "T03" }]), E, fx.today, "Oya Ergin'i listeye yaz, T03'e oturt");
  checks.equal(p.plan[0].name, "Oya Ergin", "a dropped first name is taken back");
  p = R.toParse(cmd([{ op: "addGuest", name: "Orhan Ekşi", pax: 1 }]), E, fx.today, "Galaya bir isim daha: Orhan Ekşi");
  checks.equal(p.plan[0].name, "Orhan Ekşi", "a name ending like a case ending at the end of the sentence is kept whole");
  checks.ok(!p.loose, "…and a name read exactly as typed is not loose");
  p = R.toParse(cmd([{ op: "assign", guest: "Mehmet Kaya", table: "T11" }]), E, fx.today, "Mehmet Kaya T11'e geçsin");
  checks.ok(R.grounded(p, "", E, fx.current), "a clean reading of one guest of the open event is grounded");

  const q = { kind: "question", intent: "seatAt", person: "Can Öztürk", phone: null, event: "son konser", many: false, table: null, steps: [] };
  checks.equal(R.toParse(q, E, fx.today, "Can Öztürk nerede oturuyor").event, "", "an event the sentence never named is dropped");
  checks.equal(R.toParse(Object.assign({}, q, { event: "hazir" }), E, fx.today, "haziranda hangi konser vardi").event, "haziranda", "a cut event word is put back");

  // A QUESTION IS NOT A COMMAND; THE GUEST THE SENTENCE NAMES; "Y'nin masasına" is next to Y
  // (2026-11-02, from typo7's errors — measured on fresh8/typo8).
  checks.equal(R.toParse(cmd([{ op: "setPax", guest: "mehmet kaya", pax: 1 }]), E, fx.today, "mehmet kaya hep ayni masdami oturuyo", fx.current).kind, "unknown",
    "a sentence that ends asking and orders nothing is never read as a change");
  p = R.toParse(cmd([{ op: "deleteGuest", guest: "mehmet kayi" }]), E, fx.today, "mehmet kayayi listeden sil", fx.current);
  checks.ok(T.fold(p.plan[0].guest) === "mehmet kaya" && p.loose, "a guest the model bent is taken from the sentence — and shown first", p);
  p = R.toParse(cmd([{ op: "copySeat", guest: "ahmet yilmaz", from: "can ozturkun" }]), E, fx.today, "ahmet yilmazi can ozturkun masasina oturt", fx.current);
  checks.ok(p.plan[0].op === "nextTo" && /ozturk/.test(p.plan[0].other) && p.loose, "a copy 'from' a guest is a seat next to that guest — shown first", p);
}
