// NO ENGLISH ON A TURKISH SCREEN — AND THE PROOF IS NOT THE KEY SET.
//
// `.claude/skills/merit-localization-hardening/SKILL.md`: "Key integrity
// proves the keys are complete. It does not prove the strings went through
// keys at all." `i18n-key-integrity` checks every t() key; nothing checked
// the English written straight into a template. This suite does, two ways,
// because each misses what the other sees:
//
//   STATIC   every markup text node and user-facing attribute (aria-label,
//            title, placeholder, alt) written as a literal in the shell's
//            REACHABLE code. Reachability is computed, not assumed: a pre-v8
//            body is unreachable only if app-v8.js overrides it and never
//            calls it back through `original.NAME`, or if every reference to
//            it sits inside unreachable code (to a fixpoint). The first
//            version of this analysis treated every overridden name as dead
//            and missed the twelve that app-v8.js still calls.
//   RENDERED every screen and dialog walked in Turkish and again in English,
//            each from a fresh open. A string that does not change between
//            the two, and is not something the operator typed, is either an
//            identifier or a leak. This found what the static pass cannot:
//            an English aria-label in index.html's static dialog, a stored
//            VIP level shown as its raw value.
//
// Measured before the fixes (§18 in benchmarks/MASTER-PROGRAMME-STATE.md): 25
// static findings in live code, among them a Completed event's ENTIRE guest
// list in English with raw stored statuses as its labels, and Seating's
// filter banners; and "Yapay Zeka Destekli Tespit" — "AI-assisted detection"
// — for a classical-CV feature the honesty rule forbids calling AI.
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings } from "../lib/js-scan.mjs";
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "i18n-hardcoded-english", tags: ["localization", "fast"], timeout: 240000 };

// ---------------------------------------------------------------------------
// The allowlist. Short, and each entry says why it is not a leak.
// ---------------------------------------------------------------------------
const ALLOWED = [
  { text: "Language / Dil", why: "the language switch labels itself in BOTH languages, so a reader of either can find it" },
  { text: "· page", why: "part of the plan's NAME as stored (`plan.pdf · page 2`) — translating it would make a stored record depend on the UI language" },
  { text: "TOTAL GUEST:", why: "the printed table plan mirrors the workbook's TABLE PLAN card, whose wording the reports contract fixes" },
  { text: "MERIT ENTERTAINMENT ·", why: "the brand" },
];
// Strings that read the same in Turkish, or are identifiers the operator sees
// as-is (stored zone names, report sheet names fixed by the reports contract).
const SAME_IN_BOTH = new Set(["VIP", "VVIP", "VIP / VVIP", "Bar", "Bistro", "Excel", "PDF", "CSV", "EN", "TR", "M✦",
  "MERIT ENTERTAINMENT", "EVENT MAKER", "MERIT EVENT MAKER", "TABLE PLAN", "GUEST LIST", "UNASSIGNED",
  "VIP FRONT", "MAIN FLOOR", "BISTRO", "RESERVED", "Language / Dil",
  "KEREM SARICICEK"]);   // the example name in the guest dialog's placeholder: a name, not English

const SHELL = ["app-v8.js", "app.js", "app-guests.js"];

function staticFindings(repoRoot) {
  const dir = path.join(repoRoot, "src");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const SRC = {}, CODE = {};
  for (const f of files) { SRC[f] = fs.readFileSync(path.join(dir, f), "utf8"); CODE[f] = stripCommentsAndStrings(SRC[f]); }
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const v8 = CODE["app-v8.js"];
  const overridden = new Set([...v8.matchAll(/(?:^|[;{}\s])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g)].map((m) => m[1]));
  const calledBack = new Set([...v8.matchAll(/\boriginal\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const capStart = v8.search(/const\s+original\s*=\s*\{/), capEnd = capStart < 0 ? -1 : v8.indexOf("}", capStart);
  const defs = [];
  for (const f of ["app.js", "app-guests.js"]) {
    for (const m of CODE[f].matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      let d = 0;
      for (let q = CODE[f].indexOf("{", m.index); q < CODE[f].length; q++) {
        if (CODE[f][q] === "{") d++; else if (CODE[f][q] === "}" && --d === 0) { defs.push({ f, name: m[1], a: m.index, b: q }); break; }
      }
    }
  }
  const dead = new Set([...overridden].filter((n) => defs.some((d) => d.name === n) && !calledBack.has(n)));
  const inDead = (f, pos) => defs.some((d) => d.f === f && dead.has(d.name) && pos > d.a && pos < d.b);
  for (let changed = true; changed;) {
    changed = false;
    for (const d of defs) {
      if (dead.has(d.name) || calledBack.has(d.name) || new RegExp(`\\b${d.name}\\b`).test(html)) continue;
      let live = false;
      for (const f of files) {
        for (const m of CODE[f].matchAll(new RegExp(`(?<![\\w$.])${d.name}\\b`, "g"))) {
          if (f === d.f && m.index >= d.a && m.index <= d.b) continue;
          if (f === "app-v8.js" && m.index > capStart && m.index < capEnd) continue;
          if (!inDead(f, m.index)) { live = true; break; }
        }
        if (live) break;
      }
      if (!live) { dead.add(d.name); changed = true; }
    }
  }
  const found = [];
  for (const f of SHELL) {
    const src = SRC[f], code = CODE[f];
    const deadSpans = defs.filter((d) => d.f === f && dead.has(d.name));
    for (let i = 0; i < src.length;) {
      if (code[i] === src[i] || src[i] === " " || src[i] === "\n") { i++; continue; }
      let j = i; while (j < src.length && (code[j] !== src[j] || src[j] === " ")) j++;
      const run = src.slice(i, j), start = i; i = j;
      if (/^\s*\//.test(run)) continue;                                  // comment or regex
      if (deadSpans.some((d) => start > d.a && start < d.b)) continue;
      const before = code.slice(Math.max(code.lastIndexOf("\n", start) + 1, start - 300), start);
      if (/console\.\w+\([^)]*$|Error\([^)]*$/.test(before)) continue;
      // An interpolation edge bounds text like a tag edge does.
      const text = run.replace(/^[\s`'"]+|[\s`'"]+$/g, "").replace(/^\}/, ">").replace(/\$\{$/, "<");
      const pieces = [...text.matchAll(/>([^<>{}$]*[A-Za-z][^<>{}$]*)</g)].map((m) => m[1])
        .concat([...text.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"$]*[A-Za-z][^"$]*)"/g)].map((m) => m[1]));
      for (const p of pieces) {
        const s = p.trim();
        if (!/[A-Za-z]{3}/.test(s) || /["=;{}]/.test(s) || /^(px|%|deg|\))/.test(s) || /^&\w+;$/.test(s)) continue;
        if (/^(MERIT ENTERTAINMENT|EVENT MAKER|MERIT EVENT MAKER)$/.test(s)) continue;
        found.push({ where: `${f}:${src.slice(0, start).split("\n").length}`, text: s });
      }
    }
  }
  return { found, deadCount: dead.size, calledBack: [...calledBack].filter((n) => overridden.has(n)).length };
}

const COLLECT = () => {
  const out = new Set();
  const vis = (el) => { for (let n = el; n && n !== document; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === "none" || s.visibility === "hidden") return false; } return true; };
  const scope = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
  const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const p = n.parentElement; if (!p || /^(SCRIPT|STYLE)$/.test(p.tagName) || p.closest("svg,.toast-wrap")) continue;
    const s = n.textContent.replace(/\s+/g, " ").trim(); if (s && vis(p)) out.add(s);
  }
  for (const el of scope.querySelectorAll("[aria-label],[title],[placeholder],[alt]")) {
    if (!vis(el) || el.closest(".toast-wrap")) continue;
    for (const a of ["aria-label", "title", "placeholder", "alt"]) { const v = el.getAttribute(a); if (v && v.trim()) out.add(v.replace(/\s+/g, " ").trim()); }
  }
  return [...out];
};

export default async function run({ page, checks, baseUrl, repoRoot }) {
  // --- 1. static: no user-facing English literal in reachable shell code ---
  const { found, deadCount, calledBack } = staticFindings(repoRoot);
  checks.ok(deadCount > 40 && calledBack >= 10,
    `reachability was computed: ${deadCount} pre-v8 bodies proven unreachable, ${calledBack} overridden bodies still called back through original.*`,
    { deadCount, calledBack });
  const leaks = found.filter((x) => !ALLOWED.some((a) => a.text === x.text));
  checks.equal(leaks.map((x) => `${x.where} ${x.text}`), [],
    "no markup text, aria-label, title, placeholder or alt in reachable shell code is an English literal outside t()");
  checks.equal(ALLOWED.filter((a) => !found.some((x) => x.text === a.text)).map((a) => a.text), [],
    "and every allowlisted string still exists — the allowlist cannot outlive what it excuses");

  // --- 2. module findings are translated by CODE, and every code has a key --
  const doctor = fs.readFileSync(path.join(repoRoot, "src/plan-doctor.js"), "utf8");
  const codes = [...new Set([...doctor.matchAll(/code:\s*"(\w+)"/g)].map((m) => m[1]))]
    .filter((c) => c !== "planChecksDisagree");   // restated in the Self-Check's own words, doctorText()
  await openApp(page, baseUrl, { lang: "tr" });
  const missing = await page.evaluate((codes) => {
    const miss = [];
    for (const lang of ["tr", "en"]) { ui.lang = lang; for (const c of codes) if (t("doctor." + c) === "doctor." + c) miss.push(`${lang}:${c}`); }
    ui.lang = "tr";
    return miss;
  }, codes);
  checks.equal(missing, [], `every Plan Doctor finding code (${codes.length}) has its sentence in both languages — the module's English is for exports and suites, never the screen`);
  checks.ok(await page.evaluate(() => !/Yapay Zek/i.test(t("toolbar.assistedDetection"))),
    "Assisted Detection is never called AI in Turkish");

  // --- 3. rendered: walk everything in Turkish, then in English -------------
  await createBlankEvent(page, { name: "Gala Yemeği", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 6 });
  const data = await page.evaluate(() => {
    const e = activeEvent();
    ["Ayşe Demir", "Mehmet Yılmaz", "Zeynep Kaya", "Can Öztürk"].forEach((n, i) => e.guests.push({
      id: "g" + i, name: n, additionalGuests: i % 3, pax: 1 + (i % 3), planningStatus: i === 3 ? "Tentative" : "Confirmed",
      arrivalStatus: i === 2 ? "Checked In" : "Not Arrived", checkedInAt: i === 2 ? new Date().toISOString() : null,
      assignment: i < 2 ? { tableId: e.tables[i].id, seats: [0], locked: false } : null, vip: i === 0 ? "VIP" : "Standard",
      invitedBy: "Kerem Bey", notes: "Pencere kenarı", expectedArrival: "20:30", createdAt: new Date().toISOString() }));
    e.tables[5].number = e.tables[4].number;   // a Plan Doctor finding on the Command Center
    touchEvent(e); render();
    return [e.name, e.hotel, e.salon, ...e.guests.flatMap((g) => [g.name, g.invitedBy, g.notes]), ...e.tables.flatMap((t) => [t.number, t.zone, t.label])].filter(Boolean);
  });
  await page.evaluate(() => saveState());
  const tab = (name) => page.evaluate((n) => { ui.screen = "workspace"; ui.tab = n; render(); }, name);
  const STATES = [
    ["events", () => page.evaluate(() => { ui.screen = "events"; render(); })],
    ["command", () => tab("command")],
    ["floor", () => tab("floor")],
    ["floor/table", () => page.evaluate(() => { ui.selectedObjectId = activeEvent().tables[0].id; ui.selectedIds = [ui.selectedObjectId]; render(); })],
    ["guests", () => page.evaluate(() => { ui.selectedObjectId = null; ui.selectedIds = []; ui.tab = "guests"; render(); })],
    ["guests/dialog", async () => { await page.click('[data-guest-command="add"]'); await page.waitForTimeout(300); }],
    ["guests/wizard", async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(200); await page.click('[data-guest-command="import"]'); await page.waitForTimeout(300); }],
    ["seating", async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(200); await tab("seating"); }],
    ["seating/guest", () => page.evaluate(() => { ui.selectedGuestId = "g2"; ui.seatPreview = null; render(); })],
    ["seating/preview", async () => { const b = await page.$("[data-seat-preview]"); if (b) await b.click(); }],
    ["seating/table", () => page.evaluate(() => { ui.selectedGuestId = null; ui.seatPreview = null; ui.selectedTableId = activeEvent().tables[0].id; render(); })],
    ["seating/filter-empty", () => page.evaluate(() => { ui.selectedTableId = null; ui.seatingFilter = "empty"; render(); })],
    ["seating/filter-available", () => page.evaluate(() => { ui.seatingFilter = "available"; ui.operationalMode = true; render(); })],
    ["live", () => page.evaluate(() => { ui.seatingFilter = "all"; ui.operationalMode = false; ui.tab = "live"; render(); })],
    ["reports", () => tab("reports")],
    ["guide", async () => { await page.click('[data-action="help"]'); await page.waitForTimeout(400); }],
    ["history/guests", async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); await page.evaluate(() => { activeEvent().status = "Completed"; }); await tab("guests"); }],
    ["history/seating", () => tab("seating")],
    ["history/live", () => tab("live")],
    ["history/reports", () => tab("reports")],
    ["history/events", () => page.evaluate(() => { ui.screen = "events"; render(); })],
  ];
  const walk = async (lang) => {
    await page.evaluate((l) => { ui.lang = l; ui.screen = "workspace"; activeEvent().status = "Planning"; ui.tab = "command"; render(); }, lang);
    await settle(page);
    const seen = {};
    for (const [name, go] of STATES) { await go(); await settle(page); seen[name] = await page.evaluate(COLLECT); }
    await page.keyboard.press("Escape").catch(() => {});
    return seen;
  };
  const tr = await walk("tr");
  const en = await walk("en");
  const neutral = (s) => !/[A-Za-z]{3}/.test(s) || SAME_IN_BOTH.has(s) || /^(T ?\d+|S\d+)([ ·/0-9S–-]*)$/.test(s)
    || data.some((d) => s.includes(d) || d.includes(s)) || ALLOWED.some((a) => s.includes(a.text.replace(/ ·$/, "")));
  const english = [], turkish = [];
  for (const [state] of STATES) {
    const enSet = new Set(en[state]);
    for (const s of tr[state]) if (enSet.has(s) && !neutral(s) && !/[çğıöşüÇĞİÖŞÜ]/.test(s)) english.push(`${state}: ${s}`);
    for (const s of en[state]) if (/[çğıöşüÇĞİÖŞÜ]/.test(s) && !neutral(s)) turkish.push(`${state}: ${s}`);
  }
  checks.ok(Object.values(tr).every((v) => v.length > 5), "every state rendered something to compare", Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, v.length])));
  checks.equal(english, [], `walked ${STATES.length} states in Turkish and in English: nothing typed by a developer stays English on the Turkish screen`);
  checks.equal(turkish, [], "and nothing Turkish is left on the English screen");
  const vip = await page.evaluate(() => { activeEvent().status = "Planning"; ui.lang = "tr"; ui.screen = "workspace"; ui.tab = "guests"; render(); openGuestDialog(); const o = [...document.querySelectorAll('#guestForm select[name="vip"] option')].map((x) => [x.value, x.textContent]); document.getElementById("guestDialog").close(); return o; });
  checks.equal(vip, [["Standard", "Standart"], ["VIP", "VIP"], ["VVIP", "VVIP"]],
    "a stored VIP level keeps its stored VALUE; only the label the operator reads is Turkish");
}
