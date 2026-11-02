// F8 "BUGÜN NE EKSİK" AND "DÜNDEN BERİ NE DEĞİŞTİ" (owner 2026-11-02).
//
//   MISSING IS THE COMMAND CENTER'S OWN LIST (eventReadiness → Plan Doctor): one source, so
//     F8 and the Command Center can never disagree.
//   CHANGES ARE A COMPARISON with the day's first picture (src/change-digest.js): added, removed,
//     moved (from → to), party size, VIP, tables, seats, arrivals.
//   BOTH ARE READ-ONLY and never go to the model.
// Mutation proof, recorded 2026-11-02: before the change neither sentence was understood → every check fails.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openApp, createBlankEvent, futureDate, settle, addTables } from "../lib/app-actions.mjs";

export const meta = { name: "assistant-status", tags: ["assistant", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  for (const f of ["assistant-tools.js", "assistant-parse.js", "change-digest.js"]) await import(pathToFileURL(path.join(repoRoot, "src", f)).href);
  const P = globalThis.MeritAssistantParse, D = globalThis.MeritChangeDigest;
  const k = (x) => { const r = P.parse(x, [], "2020-03-02"); return r.kind === "status" ? r.what + ":" + (r.since || "") : r.kind; };
  checks.equal(["bugun ne eksik", "hazır mıyız", "dünden beri ne değişti", "bugun neler degisti", "what changed", "what's missing"].map(k),
    ["missing:", "missing:", "changes:lastDay", "changes:today", "changes:lastDay", "missing:"], "the status questions are read, in both languages");
  const ev = { tables: [{ id: "t1", number: "T01", capacity: 8 }, { id: "t2", number: "T02", capacity: 8 }],
    guests: [{ id: "a", name: "Ahmet", pax: 2, assignment: { tableId: "t1" } }, { id: "b", name: "Ayşe", pax: 1, assignment: null }] };
  const before = D.snapshot(ev);
  ev.guests[0].assignment = { tableId: "t2" }; ev.guests[0].pax = 3; ev.guests.splice(1, 1); ev.guests.push({ id: "c", name: "Can", pax: 1, arrivalStatus: "Checked In" });
  ev.tables[1].capacity = 10;
  const d = D.diff(before, ev);
  checks.ok(d.moved[0].from === "T01" && d.moved[0].to === "T02" && d.pax[0].to === 3 && d.removed[0] === "Ayşe" && d.added[0] === "Can" && d.capacity[0].to === 10 && d.count === 5,
    "the comparison names who moved where, who came and went, party sizes and seats", d);
  const r1 = D.roll(null, ev, "2020-03-01"), r2 = D.roll(r1, ev, "2020-03-01"), r3 = D.roll(r2, ev, "2020-03-02");
  checks.ok(r1 === r2 && r3.prevDay === "2020-03-01" && r3.prev === r1.cur, "one picture a day; a new day keeps yesterday's as the base");

  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Durum Testi", date: futureDate() });
  await addTables(page, { quantity: 2 });
  // yesterday's picture: one guest who has since moved
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests = [{ id: "g1", name: "Mehmet Kaya", additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: { tableId: e.tables[0].id, seats: [0], locked: false }, createdAt: "" }];
    const D = globalThis.MeritChangeDigest, prev = D.snapshot(e);
    e.guests[0].assignment = { tableId: e.tables[1].id, seats: [0], locked: false };
    localStorage.setItem("merit.dayDigest.v1", JSON.stringify({ [e.id]: { day: new Date().toLocaleDateString("en-CA"), cur: D.snapshot(e), prevDay: "2020-03-01", prev } }));
    touchEvent(e); render();
  });
  const before2 = await page.evaluate(() => JSON.stringify(state.events));
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  const say = async (text) => {
    await page.fill("#assistantInput", text); await page.press("#assistantInput", "Enter");
    await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
    await settle(page);
    return page.evaluate(() => [...document.querySelectorAll(".assistant-turn.assistant")].pop().textContent);
  };
  const ch = await say("dunden beri ne degisti");
  checks.ok(/1 değişiklik/.test(ch) && /Mehmet Kaya: T ?01 → T ?02/.test(ch), "F8 says what changed since the last day, who moved where", ch);
  const ms = await say("bugün ne eksik");
  checks.ok(/Açık \d+ konu var|etkinlik hazır görünüyor/.test(ms), "F8 answers what is missing from the Command Center's list", ms);
  checks.equal(await page.evaluate(() => JSON.stringify(state.events)), before2, "asking changes nothing");
}
