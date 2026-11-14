// The F8 assistant's acting layer (src/assistant-actions.js) on the frozen
// fixture and command set (training/assistant/). Each command is given its
// RIGHT plan by hand; the suite checks the writer calls that come out, that an
// ambiguous or impossible command changes nothing and asks, that a past event
// is refused, and that one command is exactly one undo. (Whether a model writes
// that plan is measured separately.)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const meta = { name: "assistant-actions", tags: ["assistant", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  for (const f of ["src/assistant-tools.js", "src/assistant-actions.js"]) await import(pathToFileURL(path.join(repoRoot, f)).href);
  const fx = JSON.parse(fs.readFileSync(path.join(repoRoot, "training/assistant/fixture.json"), "utf8"));
  const C = Object.fromEntries(fs.readFileSync(path.join(repoRoot, "training/assistant/commands.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((c) => [c.id, c]));
  // a fresh copy of the data per command, fake writers that record their calls
  function harness() {
    const events = JSON.parse(JSON.stringify(fx.events)), calls = [], undos = [];
    const gala = () => events.find((e) => e.id === fx.current);
    const writers = {
      assign: (id, tableId, seats) => { calls.push(["assign", id, tableId, seats]); const g = gala().guests.find((x) => x.id === id); g.assignment = { tableId, seats: seats || [] }; },
      unassign: (id) => { calls.push(["unassign", id]); gala().guests.find((x) => x.id === id).assignment = null; },
      deleteGuest: (id) => { calls.push(["deleteGuest", id]); gala().guests = gala().guests.filter((x) => x.id !== id); },
      setPax: (id, pax) => { calls.push(["setPax", id, pax]); gala().guests.find((x) => x.id === id).pax = pax; },
      setVip: (id, vip) => { calls.push(["setVip", id, vip]); gala().guests.find((x) => x.id === id).vip = vip; },
      addGuest: (name, pax) => { calls.push(["addGuest", name, pax]); const id = "new1"; gala().guests.push({ id, name, pax, arrivalStatus: "Not Arrived", assignment: null }); return id; },
    };
    const A = globalThis.MeritAssistantActions.create({
      events: () => events, current: () => fx.current, today: () => fx.today,
      canMutate: (e) => e.date >= fx.today && e.status !== "Completed",
      writers, snapshot: (e) => JSON.stringify(e), registerUndo: (snap, lines) => undos.push({ snap, lines }),
    });
    return { A, calls, undos, events, gala };
  }
  const plans = {
    1: [{ op: "copySeat", guest: "Ahmet Yılmaz", from: "Sezen Aksu" }],
    2: [{ op: "copySeat", guest: "Ahmet", from: "son konser" }],
    3: [{ op: "assign", guest: "Zeynep Arslan", table: "VIP01" }],
    4: [{ op: "deleteGuest", guest: "Can Öztürk" }],
    5: [{ op: "addGuest", name: "Burak Şahin", pax: 2, table: "T05" }],
    6: [{ op: "assign", guest: "Mehmet Kaya", table: "T20" }],
    7: [{ op: "assign", guest: "Ahmet", table: "T01", event: "Tarkan" }],
    8: [{ op: "copySeat", guest: "Mehmet Kaya", from: "Mabel Matiz" }],
    9: [{ op: "unassign", guest: "Ayşe Demir" }],
    10: [{ op: "copySeat", guest: "Ayşe Demir", from: "Tarkan" }],
    11: [{ op: "assign", guest: "Selin Ak", table: "T03" }],
    12: [{ op: "copySeat", guest: "Zeynep", from: "Yılbaşı Galası" }],
    13: [{ op: "moveTable", fromTable: "T02", table: "T03" }],
    14: [{ op: "setPax", guest: "Mehmet Kaya", pax: 3 }],
    15: [{ op: "setVip", guest: "Can Öztürk", vip: "VIP" }],
  };
  for (const id of Object.keys(plans).map(Number)) {
    const c = C[id], h = harness(), r = h.A.run(plans[id]);
    if (c.calls) {
      const want = c.calls.map((x) => x[0] === "assign" && x[1] === "<new>" ? ["assign", "new1", x[2], x[3]] : x);
      checks.equal(h.calls, want, `C${id} "${c.text}": the writer calls`);
      checks.equal(h.undos.length, want.length ? 1 : 0, `C${id}: ${want.length ? "one undo for the whole command" : "nothing changed, no undo"}`);
    } else {
      checks.ok(h.calls.length === 0 && h.undos.length === 0, `C${id} "${c.text}": nothing is changed`, h.calls);
      checks.ok(c.ask ? !!r.ask : !!r.refuse, `C${id}: it ${c.ask ? "asks" : "refuses"}`, r);
    }
  }
  // one undo restores the whole command exactly
  const h = harness(), before = JSON.stringify(h.gala());
  h.A.run([{ op: "moveTable", fromTable: "T02", table: "T03" }, { op: "setPax", guest: "Mehmet Kaya", pax: 3 }]);
  checks.equal(h.undos.length, 1, "a two-step command is still one undo");
  checks.equal(h.undos[0].snap, before, "and that undo holds the event exactly as it was before the command");
}
