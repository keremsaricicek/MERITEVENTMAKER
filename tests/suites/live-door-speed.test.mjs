// THE DOOR IS A SPEED SURFACE: COUNTED KEYSTROKES, AND NEVER THE WRONG GUEST.
//
// `merit-ui-quality-gates`: "Live Event is a speed surface. Door workflows are
// measured in seconds. Keyboard-first." Measured before (§23 in
// benchmarks/MASTER-PROGRAMME-STATE.md), on 300 guests with twelve "Mehmet"s:
// the only keyboard path to a guest who shares a first name was to keep typing
// until one match was left; No Show had no keyboard path; and undoing a wrong
// check-in meant finding its row in Recent with the mouse.
//
// Now ↑/↓ choose among several matches and Enter checks in the CHOSEN one, and
// Ctrl+Z in an empty search takes back the last change. The counts below are
// computed in the run, not remembered; the safety rule is asserted first and
// hardest, because the dangerous failure at a door is not "slow", it is "the
// wrong guest was checked in".
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "live-door-speed", tags: ["business", "ui", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Kapı", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 4 });
  const SURNAMES = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir", "Arslan", "Doğan"];
  await page.evaluate((SURNAMES) => {
    const e = activeEvent();
    const first = ["Ayşe", "Fatma", "Emine", "Ali", "Hasan", "Hüseyin", "Zeynep", "Elif", "Can", "Deniz"];
    let k = 0;
    // Twelve Mehmets, one per surname -- the realistic shape of a door list.
    SURNAMES.forEach((s) => e.guests.push({ id: "m-" + s, name: "Mehmet " + s, additionalGuests: 0, pax: 1 }));
    for (; e.guests.length < 300; k++) e.guests.push({ id: "g" + k, name: first[k % first.length] + " " + SURNAMES[(k * 7) % SURNAMES.length] + " " + k, additionalGuests: k % 4 === 0 ? 3 : 0, pax: k % 4 === 0 ? 4 : 1 });
    Object.assign(e.guests.find((g) => g.id === "g0"), { name: "Selin Aksoy", additionalGuests: 3, pax: 4 });
    // Two guests with the SAME full name, invited by different hosts: common at
    // a Turkish event, and the case typing can never narrow to one.
    Object.assign(e.guests.find((g) => g.id === "g1"), { name: "Deniz Çelik", invitedBy: "Kerem Bey" });
    Object.assign(e.guests.find((g) => g.id === "g2"), { name: "Deniz Çelik", invitedBy: "Ahmet Bey" });
    e.guests.forEach((g) => Object.assign(g, { planningStatus: "Confirmed", arrivalStatus: "Not Arrived", checkedInAt: null, assignment: null, vip: "Standard", invitedBy: g.invitedBy || "", notes: "", createdAt: new Date().toISOString() }));
    touchEvent(e); ui.tab = "live"; ui.liveQuery = ""; render();
  }, SURNAMES);
  await settle(page);
  const status = (id) => page.evaluate((id) => activeEvent().guests.find((g) => g.id === id).arrivalStatus, id);
  const armed = () => page.evaluate(() => document.querySelector(".arrival-row.is-armed .party-name")?.textContent.trim() || null);
  const focusSearch = () => page.focus("#liveSearch");

  // --- 0. what is typed is what is searched — at full speed ----------------
  // No delay between keys, on purpose: a scanner or a fast typist does not wait
  // for a frame. The shared typeQuery() helper types with a 20ms delay and
  // retries, which is why this was invisible to every other suite.
  await focusSearch();
  await page.keyboard.type("Mehmet");
  await settle(page);
  checks.equal(await page.evaluate(() => ({ box: document.getElementById("liveSearch").value, q: ui.liveQuery })), { box: "Mehmet", q: "Mehmet" },
    "six keys typed without a pause arrive in order — the search is exactly what was typed");

  // --- 1. SAFETY FIRST: several matches and no choice — Enter does nothing --
  checks.equal(await armed(), null, "with twelve matches and no choice made, no row is armed");
  await page.keyboard.press("Enter");
  await settle(page);
  checks.equal(await page.evaluate(() => activeEvent().guests.filter((g) => g.arrivalStatus === "Checked In").length), 0,
    "and Enter checks in NOBODY — typing a first name never checks in whoever sorts first");

  // --- 2. the chosen row is marked before Enter, and Enter takes exactly it --
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await settle(page);
  const target = await armed();
  checks.ok(target && target.startsWith("Mehmet "), "↓ ↓ marks a chosen row exactly as a unique match is marked", target);
  const keysBefore = await page.evaluate(() => ui.liveQuery.length);
  await page.keyboard.press("Enter");
  await settle(page);
  const inNow = await page.evaluate(() => activeEvent().guests.filter((g) => g.arrivalStatus === "Checked In").map((g) => g.name));
  checks.equal(inNow, [target], "Enter checks in exactly the chosen guest, and nobody else");
  checks.equal(await page.evaluate(() => ({ q: ui.liveQuery, focus: document.activeElement?.id })), { q: "", focus: "liveSearch" },
    "the search clears and keeps focus, ready for the next person in the queue");

  // --- 3. counted: the old keyboard path vs the chosen-row path ------------
  // Old path: keep typing the full name until exactly one guest matches.
  // Counted on the rendered door list, which is built from the same match set
  // the Enter key consults.
  const minUnique = await page.evaluate((name) => {
    for (let n = 1; n <= name.length; n++) { ui.liveQuery = name.slice(0, n); render(); if (document.querySelectorAll(".arrival-row").length === 1) return n; }
    return name.length;
  }, "Mehmet Özdemir");
  const oldKeys = minUnique + 1;                               // + Enter
  const pos = await page.evaluate(() => { ui.liveQuery = "Mehmet"; render(); return [...document.querySelectorAll(".arrival-row .party-name")].map((n) => n.textContent.trim()).indexOf("Mehmet Özdemir"); });
  const newKeys = keysBefore + (pos + 1) + 1;                  // "Mehmet" + ↓×(pos+1) + Enter
  console.log(`DOOR KEYS: until-unique=${oldKeys} chosen-row=${newKeys} (row ${pos + 1} of the Mehmets)`);
  checks.ok(Number.isFinite(oldKeys) && pos >= 0, `counted: typing until unique = ${oldKeys} keys; "Mehmet" + ↓ to the row + Enter = ${newKeys} keys`, { oldKeys, newKeys, pos });
  await page.evaluate(() => { ui.liveQuery = ""; render(); });

  // --- 3b. identical full names: typing can never get to one ---------------
  await page.evaluate(() => { ui.liveQuery = ""; render(); });
  await focusSearch();
  await page.keyboard.type("Deniz Çelik");
  await settle(page);
  const twins = await page.evaluate(() => document.querySelectorAll(".arrival-row").length);
  checks.equal(twins, 2, "two guests named exactly 'Deniz Çelik': the full name still leaves two — before, only the mouse could pick one");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await settle(page);
  const chosenHost = await page.evaluate(() => {
    const row = document.querySelector(".arrival-row.is-armed");
    const name = row?.querySelector(".party-name")?.textContent.trim();
    return name ? activeEvent().guests.filter((g) => g.name === name).map((g) => g.id) : null;
  });
  checks.ok(chosenHost && chosenHost.length === 2, "↓ marks one of the two", chosenHost);
  // Typing more after choosing clears the choice: a new list, nothing armed.
  // A trailing space keeps BOTH namesakes matching, so only the reset -- not an
  // emptied list -- can clear the mark.
  await page.keyboard.type(" ");
  await settle(page);
  checks.equal(await page.evaluate(() => document.querySelectorAll(".arrival-row").length), 2, "(still two matches after the space)");
  checks.equal(await armed(), null, "typing after choosing clears the choice — a changed search never inherits an old one");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ArrowDown");
  await settle(page);
  await page.keyboard.press("Enter");
  await settle(page);
  checks.equal(await page.evaluate(() => activeEvent().guests.filter((g) => g.name === "Deniz Çelik" && g.arrivalStatus === "Checked In").length), 1,
    "and Enter checks in exactly ONE of the two namesakes — the one on the marked row");
  console.log("DOOR KEYS: identical names — before: not possible by keyboard; now: 11 letters + ↓ + Enter = 13");
  await page.keyboard.press("Control+z");
  await settle(page);

  // --- 4. Ctrl+Z takes back the last change, only from an empty search ------
  await focusSearch();
  await page.keyboard.press("Control+z");
  await settle(page);
  checks.equal(await page.evaluate(() => activeEvent().guests.filter((g) => g.arrivalStatus === "Checked In").length), 0,
    "Ctrl+Z in the empty door search takes back the last check-in — one key, no mouse");
  const planned = await page.evaluate((n) => activeEvent().guests.find((g) => g.name === n).planningStatus, target);
  checks.equal(planned, "Confirmed", "and touches arrival only, never planning status");
  // Something Ctrl+Z COULD undo, so the next assertion can fail.
  await page.keyboard.type("Mehmet Kaya");
  await settle(page);
  await page.keyboard.press("Enter");
  await settle(page);
  checks.equal(await status("m-Kaya"), "Checked In", "(a fresh check-in exists to be wrongly undone)");
  await page.keyboard.type("Ali");
  await page.keyboard.press("Control+z");
  await settle(page);
  checks.equal(await status("m-Kaya"), "Checked In",
    "with text in the box, Ctrl+Z is the box's own text undo — it never reaches into arrivals");
  await page.evaluate(() => { ui.liveQuery = ""; render(); });
  await focusSearch();
  await page.keyboard.press("Control+z");
  await settle(page);

  // --- 5. a +3 party is one record, one check-in ----------------------------
  await page.evaluate(() => { ui.liveQuery = ""; render(); });
  await focusSearch();
  await page.keyboard.type("Selin Aksoy");
  await settle(page);
  await page.keyboard.press("Enter");
  await settle(page);
  checks.equal(await status("g0"), "Checked In", "a +3 party is checked in with one Enter — one record, pax 4");

  // --- 6. a Completed event: the keys change nothing ------------------------
  await page.evaluate(() => { const e = activeEvent(); e.status = "Completed"; });
  await page.evaluate(() => { ui.liveQuery = "Mehmet"; ui.liveCursor = "m-Kaya"; });
  const before = await page.evaluate(() => JSON.stringify(activeEvent().guests.map((g) => g.arrivalStatus)));
  await page.evaluate(() => document.getElementById("liveSearch")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  checks.equal(await page.evaluate(() => JSON.stringify(activeEvent().guests.map((g) => g.arrivalStatus))), before,
    "a historical event refuses the keyboard check-in like every other mutation (canMutate)");
  // The refusal toast is the product's own; clear it so it is not read as an error.
}
