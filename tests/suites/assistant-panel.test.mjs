// The F8 assistant panel in the real app (src/screen-assistant.js).
//
//   F8 OPENS IT, ESCAPE CLOSES IT, A RENDER DOES NOT WIPE IT. The panel is its
//   own <aside> beside the screen; the conversation survives the app redrawing.
//
//   A QUESTION IS ANSWERED FROM THE DATA. "Where did Ahmet sit last time?" is
//   read off the stored past event — table and seat as recorded.
//
//   A COMMAND IS DONE AT ONCE, AND IS ONE UNDO. "Seat Ahmet where he sat last
//   time" seats him at the SAME table number in this event through the app's
//   own writer; one "Geri al" takes it back. A past event is never changed.
//
//   THE STRIP WORKS ONLY WHILE IT WORKS. The coloured strip runs while the
//   assistant thinks and stops when the answer is there.
import { openApp, createBlankEvent, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "assistant-panel", tags: ["assistant", "ui", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Yılbaşı Galası", date: futureDate() });
  await page.evaluate(() => {
    const table = (id, number) => ({ id, number, shape: "round", capacity: 10, chairs: [], x: 100, y: 100, w: 80, h: 80, rotation: 0 });
    const guest = (id, name, assignment, arrival) => ({ id, name, additionalGuests: 0, pax: 1, planningStatus: "Confirmed", vip: "Standard", invitedBy: "", notes: "",
      arrivalStatus: arrival || "Not Arrived", checkedInAt: null, assignment, createdAt: new Date().toISOString() });
    const now = activeEvent();
    now.tables.push(table("t05", "T05"), table("t12", "T12"));
    now.guests.push(guest("gg1", "Ahmet Yılmaz", null));
    const past = JSON.parse(JSON.stringify(now));
    Object.assign(past, { id: "past1", name: "Sezen Aksu Konseri", date: "2026-03-15", status: "Completed" });
    past.tables = [table("p05", "T05"), table("p12", "T12")];
    past.guests = [guest("pg1", "Ahmet Yılmaz", { tableId: "p12", seats: [3] }, "Checked In")];
    state.events.push(past);
    render();
  });
  await settle(page);

  // F8 opens it, focus in the box
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  checks.ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "assistantInput"), "F8 opens the panel with the cursor in its box");
  const say = async (text) => {
    await page.fill("#assistantInput", text);
    await page.press("#assistantInput", "Enter");
    const working = await page.evaluate(() => document.getElementById("assistantPanel").classList.contains("is-working"));
    await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 5000 });
    await settle(page);
    return { working, last: await page.evaluate(() => { const t = [...document.querySelectorAll(".assistant-turn.assistant")].pop(); return t ? t.innerText : ""; }) };
  };

  let r = await say("Ahmet Yılmaz Sezen Aksu konserinde nerede oturuyordu?");
  checks.ok(r.working, "the strip runs while the assistant works");
  checks.ok(/T12/.test(r.last) && /koltuk 4/.test(r.last) && /geldi/.test(r.last), "a question is answered from the stored past event: table, seat, came", r.last);
  checks.ok(await page.evaluate(() => !document.getElementById("assistantPanel").classList.contains("is-working")), "and stops once the answer is there");

  r = await say("Ahmet Yılmaz'ı Sezen Aksu konserindeki yerine oturt");
  const seated = await page.evaluate(() => { const g = activeEvent().guests.find((x) => x.id === "gg1"); return g.assignment && { table: g.assignment.tableId, seats: g.assignment.seats }; });
  checks.ok(seated && seated.table === "t12" && seated.seats.includes(3), "the command seats him at the SAME table number here, same seat, at once", { seated, reply: r.last });
  checks.ok(/T12/.test(r.last), "and says what changed", r.last);

  // a render of the screen does not wipe the conversation
  await page.evaluate(() => render());
  checks.equal(await page.locator(".assistant-turn").count(), 4, "a render of the app leaves the conversation in place");

  // one undo takes the whole command back
  await page.click(".assistant-undo");
  await settle(page);
  checks.equal(await page.evaluate(() => activeEvent().guests.find((x) => x.id === "gg1").assignment), null, "one Geri al takes the command back exactly");

  // a past event is refused and nothing changes
  const before = await page.evaluate(() => JSON.stringify(state.events.find((e) => e.id === "past1").guests));
  r = await say("Sezen Aksu konserinde Ahmet Yılmaz'ı T05'e taşı");
  const after = await page.evaluate(() => JSON.stringify(state.events.find((e) => e.id === "past1").guests));
  checks.ok(before === after && /geçmiş/.test(r.last), "a command on a past event is refused and changes nothing", r.last);

  // something it cannot place comes back as a question, not a guess
  r = await say("Selin Ak'ı T05'e oturt");
  checks.ok(/yok/.test(r.last), "an unknown guest is asked about, never invented", r.last);

  // a brief becomes arrangements; Uygula draws real tables, one Geri al removes them all
  const tablesBefore = await page.evaluate(() => activeEvent().tables.length);
  r = await say("Salon 20x30 metre, 300 kişilik gala, 180'lik yuvarlak masa");
  checks.ok(await page.locator(".assistant-option").count() >= 1 && /masa/.test(r.last) && /kişilik/.test(r.last), "a brief comes back as arrangements with their numbers", r.last);
  const cap = await page.evaluate(() => { const o = [...document.querySelectorAll(".assistant-option-title")][0].textContent; return Number((o.match(/(\d+) masa/) || [])[1]); });
  await page.click(".assistant-option .assistant-apply");
  await settle(page);
  const added = await page.evaluate((n) => activeEvent().tables.length - n, tablesBefore);
  checks.equal(added, cap, "Uygula draws exactly the tables the option showed", { added, cap });
  const overlapping = await page.evaluate(() => { const ts = activeEvent().tables.slice(2); let n = 0; for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const a = ts[i], b = ts[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++; } return n; });
  checks.equal(overlapping, 0, "no two drawn tables overlap");
  await page.locator(".assistant-undo").last().click();
  await settle(page);
  checks.equal(await page.evaluate(() => activeEvent().tables.length), tablesBefore, "one Geri al takes the whole arrangement back");

  // Escape closes it
  await page.focus("#assistantInput");
  await page.keyboard.press("Escape");
  checks.ok(await page.evaluate(() => document.getElementById("assistantPanel").hidden), "Escape closes the panel");
  await page.keyboard.press("F8");
  checks.ok(await page.evaluate(() => !document.getElementById("assistantPanel").hidden), "and F8 brings it back with the conversation");
  checks.equal(pageErrors, [], "no page errors");
}
