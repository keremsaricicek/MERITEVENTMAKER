// The F8 assistant panel in the real app (src/screen-assistant.js).
//
//   F8 OPENS IT, ESCAPE CLOSES IT, A RENDER DOES NOT WIPE IT. The panel is its
//   own <aside> beside the screen; the conversation survives the app redrawing.
//
//   A QUESTION IS ANSWERED FROM THE DATA. "Where did Ahmet sit last time?" is
//   read off the stored past event — table and seat as recorded.
//
//   A COMMAND IS SHOWN FIRST, THEN ONE UNDO (SPEC-v4, owner 2026-11-07). "Seat
//   Ahmet where he sat last time" is shown as a sentence with the table
//   highlighted on the plan; "Uygula" seats him at the SAME table number through
//   the app's own writer; one "Geri al" takes it back. A past event is never
//   changed. (Door check-ins stay immediate: a plain statement at the door.)
//
//   THE STRIP WORKS ONLY WHILE IT WORKS. The owner's thinking strip (2026-10-27)
//   sits under the chat box's title bar, shows while Mimar thinks and is gone
//   when the answer is there; under reduced motion it is still.
//
//   MIMAR IS A CHAT BOX (SPEC-v4): bottom-right like a classic chat, title bar
//   "Mimar" in a warm off-grey (never blue), – minimises, a disabled "yakında"
//   microphone, and "Gönder" fully inside the box at 1440 px.
//
// Mutation proof, recorded 2026-11-07: against the step-1 panel the chat-box,
// strip-position and shown-first checks fail; with showFirst forced false the
// "nothing changes before Uygula" check fails.
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  checks.ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "assistantInput"), "F8 opens the panel with the cursor in its box");

  // the chat box
  const box = await page.evaluate(() => {
    const p = document.getElementById("assistantPanel"), r = (sel) => { const n = p.querySelector(sel); return n ? n.getBoundingClientRect().toJSON() : null; };
    const head = p.querySelector(".assistant-head"), rgb = getComputedStyle(head).backgroundColor.match(/[\d.]+/g).map(Number);
    const mic = p.querySelector(".assistant-mic");
    return { panel: p.getBoundingClientRect().toJSON(), vh: innerHeight, vw: innerWidth, head: r(".assistant-head"), strip: r(".assistant-strip"), send: r(".assistant-send"), input: r(".assistant-input"),
      title: p.querySelector(".assistant-title")?.textContent.trim(), rgb, ink: getComputedStyle(head).color,
      mic: mic ? { disabled: mic.disabled, text: mic.textContent.trim() } : null, idleStrip: ((cs) => cs.backgroundImage + " " + cs.backgroundColor)(getComputedStyle(p.querySelector(".assistant-strip"))) };
  });
  checks.equal(box.title, "Mimar", "the box is titled Mimar", box.title);
  checks.ok(Math.abs(box.panel.bottom - box.vh) <= 1 && box.vw - box.panel.right >= 12 && box.vw - box.panel.right <= 32, "it sits at the bottom right like a classic chat box", box.panel);
  const [hr, hg, hb] = box.rgb;
  checks.ok(hb <= hr && hr - hb <= 24 && Math.abs(hr - hg) <= 16, "the title bar is a warm off-grey, never blue", box.rgb);
  checks.ok(box.strip && box.head && box.strip.top >= box.head.bottom - 1, "the thinking strip runs under the title bar", { strip: box.strip, head: box.head });
  checks.equal(box.idleStrip, "none rgba(0, 0, 0, 0)", "and is not shown while Mimar is idle", box.idleStrip);
  checks.ok(box.mic && box.mic.disabled && /yakında/.test(box.mic.text), "the microphone is there, disabled, \"yakında\"", box.mic);
  checks.ok(box.send && box.send.right <= box.panel.right - 4 && box.send.left >= box.input.right && box.send.width >= 56, "Gönder is fully inside the box at 1440 px, not clipped", { send: box.send, panel: box.panel });
  await page.click(".assistant-min");
  checks.ok(await page.evaluate(() => { const p = document.getElementById("assistantPanel"); return p.classList.contains("is-min") && p.querySelector(".assistant-log").offsetHeight === 0; }), "– minimises the box to its title bar");
  await page.click(".assistant-head .assistant-title");
  checks.ok(await page.evaluate(() => !document.getElementById("assistantPanel").classList.contains("is-min")), "and the title bar brings it back");
  await page.focus("#assistantInput");
  const say = async (text) => {
    await page.fill("#assistantInput", text);
    await page.press("#assistantInput", "Enter");
    const working = await page.evaluate(() => { const p = document.getElementById("assistantPanel"); return p.classList.contains("is-working") && /gradient/.test(getComputedStyle(p.querySelector(".assistant-strip")).backgroundImage); });
    await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 5000 });
    await settle(page);
    return { working, last: await page.evaluate(() => { const t = [...document.querySelectorAll(".assistant-turn.assistant")].pop(); return t ? t.innerText : ""; }) };
  };

  let r = await say("Ahmet Yılmaz Sezen Aksu konserinde nerede oturuyordu?");
  checks.ok(r.working, "the strip runs while the assistant works");
  checks.ok(/T12/.test(r.last) && /koltuk 4/.test(r.last) && /geldi/.test(r.last), "a question is answered from the stored past event: table, seat, came", r.last);
  checks.ok(await page.evaluate(() => { const p = document.getElementById("assistantPanel"); return !p.classList.contains("is-working") && getComputedStyle(p.querySelector(".assistant-strip")).backgroundImage === "none"; }), "and is gone once the answer is there");

  r = await say("Ahmet Yılmaz'ı Sezen Aksu konserindeki yerine oturt");
  const shownFirst = await page.evaluate(() => ({ seated: !!activeEvent().guests.find((x) => x.id === "gg1").assignment, hl: ui.highlightId,
    apply: [...document.querySelectorAll(".assistant-turn.assistant:last-child .assistant-confirm")].map((b) => b.textContent.trim()) }));
  checks.ok(!shownFirst.seated && /T12/.test(r.last) && shownFirst.apply[0] === "Uygula", "the command is SHOWN first, with Uygula — nothing changes yet", { shownFirst, reply: r.last });
  checks.equal(shownFirst.hl, "t12", "and the table it names is highlighted on the plan", shownFirst.hl);
  await page.locator(".assistant-confirm").last().click();
  await settle(page);
  r = { last: await page.evaluate(() => [...document.querySelectorAll(".assistant-turn.assistant")].pop().innerText) };
  const seated = await page.evaluate(() => { const g = activeEvent().guests.find((x) => x.id === "gg1"); return g.assignment && { table: g.assignment.tableId, seats: g.assignment.seats }; });
  checks.ok(seated && seated.table === "t12" && seated.seats.includes(3), "Uygula seats him at the SAME table number here, same seat", { seated, reply: r.last });
  checks.ok(/T12/.test(r.last), "and says what changed", r.last);

  // a render of the screen does not wipe the conversation
  await page.evaluate(() => render());
  checks.equal(await page.locator(".assistant-turn").count(), 5, "a render of the app leaves the conversation in place");

  // one undo takes the whole command back
  await page.click(".assistant-undo");
  await settle(page);
  checks.equal(await page.evaluate(() => activeEvent().guests.find((x) => x.id === "gg1").assignment), null, "one Geri al takes the command back exactly");

  // a past event is refused and nothing changes
  const before = await page.evaluate(() => JSON.stringify(state.events.find((e) => e.id === "past1").guests));
  r = await say("Sezen Aksu konserinde Ahmet Yılmaz'ı T05'e taşı");
  const after = await page.evaluate(() => JSON.stringify(state.events.find((e) => e.id === "past1").guests));
  checks.ok(before === after && /geçmiş/.test(r.last), "a command on a past event is refused and changes nothing", r.last);

  // two jobs in one sentence, and no second reader on this page: asked back, nothing changed
  const beforeTwo = await page.evaluate(() => JSON.stringify(activeEvent().guests));
  r = await say("Ahmet Yılmaz'ı sil ve yerine Selin Ak'ı T05'e ekle");
  checks.ok(/tek tek/i.test(r.last) && beforeTwo === await page.evaluate(() => JSON.stringify(activeEvent().guests)), "a sentence with two jobs is asked back and changes nothing", r.last);

  // something it cannot place comes back as a question, not a guess
  r = await say("Selin Ak'ı T05'e oturt");
  checks.ok(/yok/.test(r.last), "an unknown guest is asked about, never invented", r.last);

  // a deletion is shown first and waits: Vazgeç changes nothing, Onayla deletes, Geri al restores
  const guestsNow = () => page.evaluate(() => JSON.stringify(activeEvent().guests));
  const g0 = await guestsNow();
  r = await say("Ahmet Yılmaz'ı sil");
  checks.ok(/Ahmet Yılmaz/.test(r.last) && /silinecek/.test(r.last) && g0 === await guestsNow(), "a deletion is shown first and nothing changes yet", r.last);
  await page.locator(".assistant-cancel").last().click();
  await settle(page);
  const cancelled = await page.evaluate(() => [...document.querySelectorAll(".assistant-turn.assistant")].pop().innerText);
  checks.ok(g0 === await guestsNow() && /hiçbir şey değiştirmedim/i.test(cancelled), "Vazgeç changes nothing and says so", cancelled);
  r = await say("Ahmet Yılmaz'ı sil");
  await page.locator(".assistant-confirm").last().click();
  await settle(page);
  checks.ok(await page.evaluate(() => !activeEvent().guests.some((x) => x.id === "gg1")), "Uygula deletes the one guest shown");
  await page.locator(".assistant-undo").last().click();
  await settle(page);
  checks.ok(await page.evaluate(() => activeEvent().guests.some((x) => x.id === "gg1")), "and one Geri al brings the guest back");

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

  // --- WIRING PASS (b): web research behind ⋯ → Ayarlar (OFF by default) and the
  // microphone only with a voice engine. No real network call: fetch is stubbed and
  // the relay is played by page.route on this page's own origin. Mutation proof,
  // recorded 2026-11-08: with the guest-name removal skipped the "never leaves"
  // check fails; with the mic enabled unconditionally the "yakında" check fails.
  await page.keyboard.press("Escape");
  const web0 = await page.evaluate(() => { try { return localStorage.getItem("merit.webResearch.v1"); } catch { return "x"; } });
  // CHANGED 2026-11-12 by the spec (SPEC-v4: no settings in the bar menu): the switch lives on the Ayarlar page.
  await page.click("header.shell-top [data-shell-settings]");
  const sw = await page.evaluate(() => ({ off: document.querySelector('#settingsPage [data-set="research"][aria-checked="true"]')?.dataset.value === "off" ? "false" : "true", privacy: document.getElementById("settingsPage")?.textContent || "" }));
  checks.ok(web0 === null && sw.off === "false" && /misafir adları/.test(sw.privacy), "web research is OFF by default, with the privacy text on Ayarlar", sw);
  await page.click('#settingsPage [data-set="research"][data-value="on"]'); await settle(page);
  await page.keyboard.press("Escape");
  checks.equal(await page.evaluate(() => localStorage.getItem("merit.webResearch.v1")), "on", "the switch turns it on and is remembered");
  await page.evaluate(() => { window.__sent = []; window.__fetch0 = window.fetch; window.fetch = async (url, init) => { window.__sent.push({ url: String(url), body: init && init.body }); return new Response(JSON.stringify({ ok: true, provider: "scripted", results: [{ title: "Merit Royal", url: "https://example.test/x", snippet: "<b>Kapasite</b> 1200" }] }), { headers: { "content-type": "application/json" } }); }; });
  await page.keyboard.press("F8");
  await page.fill("#assistantInput", "web: Merit Royal balo salonu kapasitesi Ahmet Yılmaz 0532 111 22 33"); await page.press("#assistantInput", "Enter"); await settle(page);
  const pre = await page.evaluate(() => ({ text: [...document.querySelectorAll(".assistant-turn.assistant")].pop().innerText, sent: window.__sent.length }));
  checks.ok(!/Ahmet|0532/.test(pre.text) && /Merit Royal/.test(pre.text) && pre.sent === 0, "the exact words are shown first, guest name and phone removed; nothing sent yet", pre);
  await page.locator(".assistant-search").last().click(); await settle(page);
  const sent = await page.evaluate(() => { const r = { sent: window.__sent, shown: [...document.querySelectorAll(".assistant-web li")].map((l) => l.textContent) }; window.fetch = window.__fetch0; return r; });
  const body = sent.sent[0] && JSON.parse(sent.sent[0].body || "{}");
  checks.ok(sent.sent.length === 1 && /\/vlm-relay\/search$/.test(sent.sent[0].url) && Object.keys(body).join() === "query" && !/Ahmet|0532/.test(body.query), "one click, one search: only { query } goes to the relay, never a guest name", { sent: sent.sent, body });
  checks.ok(sent.shown.length === 1 && /Kapasite/.test(sent.shown[0]) && /example\.test/.test(sent.shown[0]), "results are shown as text, marked as from the web", sent.shown);
  await page.keyboard.press("Escape");
  // the microphone: live only when the relay reports a voice engine
  const url = page.url();
  await page.route(url, async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, headers: { ...r.headers(), "server-timing": "merit-relay" } }); });
  await page.route("**/vlm-relay/status", (route) => route.fulfill({ json: { ok: true, voice: { configured: true, languages: ["tr", "en"] }, research: { configured: false } } }));
  await page.route("**/merit-backup/**", (route) => route.fulfill({ json: { ok: false, code: "OFF" } }));   // the relay-served page also asks the disk backup; played as off
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { try { return Array.isArray(state.events); } catch { return false; } });
  await page.evaluate(() => { globalThis.MeritVoiceInput.createRecorder = () => ({ start: async () => {}, stop: async () => ({ ok: true, text: "Ahmet Yılmaz'ı T05'e oturt" }) }); });
  await page.keyboard.press("F8");
  await page.waitForFunction(() => { const m = document.querySelector(".assistant-mic"); return m && !m.disabled; }, null, { timeout: 5000 }).catch(() => {});
  const turnsBefore = await page.locator(".assistant-turn").count();
  const live = await page.evaluate(() => { const m = document.querySelector(".assistant-mic"); return { disabled: m.disabled, text: m.textContent.trim() }; });
  checks.ok(!live.disabled && !/yakında/.test(live.text), "with a voice engine on the relay the microphone is live", live);
  await page.click(".assistant-mic"); await page.click(".assistant-mic"); await settle(page);
  const heard = await page.evaluate(() => document.getElementById("assistantInput").value);
  checks.ok(heard === "Ahmet Yılmaz'ı T05'e oturt" && await page.locator(".assistant-turn").count() === turnsBefore, "the words go INTO THE BOX; nothing is sent by voice", heard);
  await page.unroute(url); await page.unroute("**/vlm-relay/status"); await page.unroute("**/merit-backup/**");
}
