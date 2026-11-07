// A GUEST'S NAME DOES NOT GO TO THE CONSOLE, EVEN WHEN THE RECORD IS BROKEN.
//
// `.claude/skills/merit-security-hardening/SKILL.md`, Privacy: "Guest names,
// notes and contact-like fields must not appear in console logs, error
// messages, or telemetry of any kind."
//
// Nothing in this product logs a guest on purpose. The leak is structural:
// every storage failure is logged with its Error, and a `SyntaxError` from
// JSON.parse QUOTES the text it failed on — `Unexpected token 'x', "...GUEST
// NAME", x}]}" is not valid JSON`. So a stored record corrupted anywhere near
// a name hands a fragment of the guest list to the console, and from there to
// any screenshot, bug report or support session that captures it.
//
// This suite corrupts each record the boot path reads — the primary record,
// the legacy localStorage key and the automatic recovery snapshot — with a
// guest name next to the damage, boots, and reads EVERY console message,
// including the full text and stack of every Error passed to it.
//
// MEASURED BEFORE THE FIX, which is this suite's mutation proof: three
// warnings on one boot — the primary-record load, the legacy restore and the
// recovery snapshot — each carrying `"name": ZEYNEP KAY` in its message and
// again in its stack. `loggableError()` in app-v8.js now withholds a
// SyntaxError's excerpt; every other error is still logged whole.
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "privacy-logs", tags: ["security", "storage", "fast"], timeout: 60000 };

const MARKER = "ZEYNEP KAYA PRIVATE";
// A name that lost its opening quote — the ordinary hand-editing mistake.
// Chromium quotes about ten characters either side of an unexpected token,
// so the excerpt carries the start of the name. (Most other corruptions are
// reported by position only; the fixture uses the one that is not, because a
// log line is only safe if it is safe for every kind of damage.)
const CORRUPT = `{"schemaVersion":9,"events":[{"id":"e1","name":"Gala","date":"2031-01-01","guests":[{"id":"g1","name": ${MARKER}", "pax":1}]}]}`;

export default async function run({ page, checks, baseUrl }) {
  const seen = [];
  page.on("console", async (msg) => {
    const parts = [msg.text()];
    for (const a of msg.args()) {
      try {
        parts.push(await a.evaluate((v) => v instanceof Error ? `${v.name}: ${v.message}\n${v.stack}` : typeof v === "object" ? JSON.stringify(v) : String(v)));
      } catch { /* a handle from a navigated-away page */ }
    }
    seen.push({ type: msg.type(), text: parts.join(" | ") });
  });
  page.on("pageerror", (e) => seen.push({ type: "pageerror", text: `${e.message}\n${e.stack}` }));

  await openApp(page, baseUrl, { lang: "en" });

  // The control: the parser really does quote the name. If this ever stops
  // being true the suite below would pass for the wrong reason.
  const quoted = await page.evaluate((c) => { try { JSON.parse(c); return null; } catch (e) { return e.message; } }, CORRUPT);
  checks.ok(quoted && quoted.includes("ZEYNEP"),
    "the fixture is real: Chromium's JSON.parse error message quotes the guest name next to the damage", quoted);

  // Corrupt all three boot-time records — from a same-origin page that does
  // NOT run the app, so nothing can save a good copy over them before boot.
  // (The first version wrote them from inside the running app and saw no
  // warning at all: the corruption never reached the next load.)
  await page.route(`${baseUrl}/__blank.html`, (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>blank</title>" }));
  await page.goto(`${baseUrl}/__blank.html`);
  await page.evaluate(async (c) => {
    localStorage.setItem("meritEventMaker.v8", c);
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("meritEventMaker");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put(c, "root");
        tx.objectStore("state").put([{ at: new Date().toISOString(), payload: c }], "autosnapshots");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, CORRUPT);

  seen.length = 0;
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { try { return Array.isArray(state.events); } catch { return false; } }, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const leaks = seen.filter((m) => m.text.includes("ZEYNEP"));
  checks.ok(seen.some((m) => /restore|load|snapshot|recover/i.test(m.text)),
    "the boot really went through the failure paths — their warnings are in the log", seen.map((m) => m.text.slice(0, 80)));
  checks.equal(leaks.map((m) => `${m.type}: ${m.text.slice(0, 160)}`), [],
    "and not one console message, Error message or stack carries the guest's name");
  const booted = await page.evaluate(() => ({ events: state.events.length, screen: ui.screen }));
  checks.ok(booted.events === 0 && booted.screen === "events",
    "the app still boots — to an empty install, since every copy was unreadable — rather than dying on the corruption", booted);
}
