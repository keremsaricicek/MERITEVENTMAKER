// THE PANELS A SCREEN WALK DOES NOT OPEN, AND THE ASSISTANT THAT TALKS BACK.
//
// `hostile-input` walks every tab with a payload in every typed, imported and
// OCR-read field. What it does not open is what only appears on request: the
// F8 assistant (whose replies echo guest names, the sentence typed, and text a
// language model wrote), the Plan Doctor, the plan reading and its text list,
// the Review Center, the operator report, the model-reading panel with a local
// second look's answers, the freeze form typed into, the freeze and service
// layers, and the printable table plan. Each is opened here with the same
// payload in reach, and judged the same way:
//
//   NOTHING RAN           `window.__pwned` stays empty.
//   NOTHING BECAME MARKUP no `on*` attribute, `javascript:` URL or script built
//                        from the payload anywhere in the document.
//   IT IS STILL THERE     where the panel shows the hostile text, it shows it AS
//                        TEXT (escaping that deletes a name would pass the
//                        first two and lose the guest).
//
// THE MODEL HERE IS SCRIPTED (a fake chat process on this machine, as in
// `assistant-reader`): its reading and the chat reply it would give are chosen to
// carry the payload; since 2026-11-14 Mimar never shows a chat reply (one fixed
// answer, suite assistant-offtopic). Nothing here measures a model.
//
// MUTATION PROOF, recorded 2026-11-01:
//   P1  the assistant's `el()` writing `innerHTML` instead of `textContent` →
//       the first F8 reply fails (payload elements in the panel).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { click, openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, autoAnswer } from "../lib/app-actions.mjs";

export const meta = { name: "hostile-input-panels", tags: ["security", "ui", "assistant", "fast"], timeout: 300000 };

const PAYLOAD = [
  `<img src=x onerror="window.__pwned.push('img')">`,
  `"><svg onload="window.__pwned.push('svg')">`,
  `'><script>window.__pwned.push('script')</script>`,
  `" autofocus onfocus="window.__pwned.push('attr')" x="`,
  `javascript:window.__pwned.push('js')`,
].join(" ");
const tagged = (f) => `F:${f}|${PAYLOAD}`;
const mark = (f) => `F:${f}|<img src=x onerror=`;

async function audit(page, where, checks, mustShow = []) {
  const r = await page.evaluate((mustShow) => {
    const handlerAttrs = [], jsUrls = [], scripts = [];
    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) {
        if (/^on/i.test(a.name) && /__pwned/.test(a.value)) handlerAttrs.push(`${el.tagName}.${a.name}`);
        if (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) jsUrls.push(`${el.tagName}.${a.name}`);
      }
      if (el.tagName === "SCRIPT" && /__pwned/.test(el.textContent)) scripts.push("SCRIPT");
    }
    const text = document.body.textContent + "\n" + [...document.querySelectorAll("input,textarea")].map((i) => i.value).join("\n");
    // Case-blind: the printed plan and the workbook write names in capitals.
    const low = text.toLowerCase();
    return { pwned: [...window.__pwned], handlerAttrs, jsUrls, scripts, missing: mustShow.filter((m) => !low.includes(m.toLowerCase())) };
  }, mustShow);
  checks.equal(r.pwned, [], `${where}: nothing in the payload RAN`, r.pwned);
  checks.ok(!r.handlerAttrs.length && !r.jsUrls.length && !r.scripts.length,
    `${where}: nothing in the payload BECAME MARKUP`, { handlerAttrs: r.handlerAttrs.slice(0, 5), jsUrls: r.jsUrls.slice(0, 5), scripts: r.scripts.length });
  if (mustShow.length) checks.equal(r.missing, [], `${where}: and the hostile text is shown as text`, r.missing);
}

export default async function run({ page, checks, repoRoot }) {
  // ---- a relay serving the app, with a scripted chat process behind it ------
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const RD = await import(path.join(repoRoot, "server/assistant-reader.mjs"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-hostile-panels-"));
  const weights = crypto.randomBytes(4096);
  fs.writeFileSync(path.join(tmp, "chat.gguf"), weights);
  fs.writeFileSync(path.join(tmp, "chat.json"), JSON.stringify({ format: "merit-local-chat/1", id: "fake-chat", name: "Scripted chat", version: "0-test",
    licence: "test", source: "tests/suites/hostile-input-panels.test.mjs", evidence: "scripted", serve: { model: "chat.gguf", lora: [], ctx: 4096, actAt: 0.9 },
    files: [{ path: "chat.gguf", bytes: weights.length, sha256: crypto.createHash("sha256").update(weights).digest("hex") }] }));
  let reading = null, chatReply = "";
  const props = { model_path: fs.realpathSync(path.join(tmp, "chat.gguf")), default_generation_settings: { n_ctx: 4096 } };
  const fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/props") return res.end(JSON.stringify(props));
      if (req.url === "/lora-adapters") return res.end("[]");
      if (req.url === "/v1/chat/completions") {
        const b = JSON.parse(body);
        const content = b.response_format ? JSON.stringify(reading) : chatReply;
        return res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const reader = RD.readerFromEnv({ ASSISTANT_CHAT_URL: `http://127.0.0.1:${fake.address().port}`, ASSISTANT_CHAT_MANIFEST: path.join(tmp, "chat.json") });
  checks.require(reader.configured, "the scripted chat reader is configured", reader);
  const config = core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "data"), PORT: "0" }, { repoRoot });
  const relay = await startRelay({ config, client: { models: {}, beta: { messages: {} } }, log: { log: () => {}, error: () => {} }, reader });

  try {
    await page.addInitScript(() => { window.__pwned = []; });
    // The OCR engine "reads" the payload off the drawing (as in hostile-input).
    await page.addInitScript((P) => {
      Object.defineProperty(globalThis, "runPlanOCR", {
        configurable: true,
        get: () => async () => ({ available: true, text: P,
          words: P.split(" ").map((w, i) => ({ text: w, confidence: 90, bbox: { x0: 20 + i * 90, y0: 20 + (i % 7) * 120, x1: 100 + i * 90, y1: 60 + (i % 7) * 120 } })) }),
        set: () => {},
      });
    }, `F:ocr|${PAYLOAD} 12 T07`);
    page.on("dialog", (d) => d.accept());
    await autoAnswer(page);
    await openApp(page, relay.baseUrl, { lang: "en" });

    // ---- an event with the payload in every field a panel shows ------------------
    await createBlankEvent(page, { name: "Hostile Panels", hotel: "Merit Royal", date: futureDate() });
    await addTables(page, { quantity: 3 });
    const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/adversarial/fixtures/a1-chair-under-table.png"));
    await page.evaluate(({ T, src }) => {
      const e = state.events[0], t = (f) => T.replace("__F__", f), now = new Date().toISOString();
      e.name = t("eventName"); e.hotel = t("hotel"); e.salon = t("salon");
      e.tables[0].number = "T01"; e.tables[0].zone = t("zone"); e.tables[0].capacity = 6;
      e.tables[1].number = "T02"; e.tables[1].zone = t("zone"); e.tables[1].capacity = 6;
      e.tables[2].number = "T03"; e.tables[2].capacity = 6; e.tables[2].availability = "UNAVAILABLE"; e.tables[2].unavailableReason = "OTHER"; e.tables[2].unavailableNote = t("unavailableNote");
      const g = (id, name, extra) => Object.assign({ id, name, additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: t("invitedBy"), notes: t("notes"),
        planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: null, createdAt: now, expectedArrival: null }, extra);
      e.guests = [
        g("g_seated", t("guestName"), { additionalGuests: 2, pax: 3, vip: "VIP", assignment: { tableId: e.tables[0].id, seats: [0, 1, 2], locked: false } }),
        g("g_free", t("unseated")),
      ];
      e.freezes = [{ id: "f_h", scope: "ZONE", zone: t("zone"), reason: "OTHER", note: t("freezeNote").slice(0, 400), createdAt: now }];
      e.handoverNotes = [{ id: "h_h", text: t("handover").slice(0, 500), by: t("by").slice(0, 120), at: now }];
      e.background = { src, name: t("planName"), opacity: 1, visible: true, locked: false, scale: 100 };
      // A finished evening with the same guest, for the assistant's "last time".
      const past = JSON.parse(JSON.stringify(e));
      Object.assign(past, { id: "past_h", name: t("pastEvent"), date: "2026-03-15", status: "Completed", analysis: null });
      past.tables = past.tables.map((x, i) => Object.assign(x, { id: "pt" + i }));
      past.guests = [Object.assign(past.guests[0], { id: "pg", assignment: { tableId: "pt1", seats: [0], locked: false }, arrivalStatus: "Checked In" })];
      past.freezes = [];
      state.events.push(past);
      ui.tab = "floor"; touchEvent(e); render();
    }, { T: tagged("__F__"), src: "data:image/png;base64," + plan.toString("base64") });
    await settle(page);

    // ---- the analysis, read with the payload as the plan's own text --------------
    await click(page, '[data-v8-action="detect"]');
    await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 180000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
    await settle(page);
    await audit(page, "Plan review", checks);

    for (const [flag, where] of [["readingOpen", "Plan reading"], ["readingTextsOpen", "Plan reading, its texts listed"], ["reviewCenterOpen", "Review Center"], ["operatorReportOpen", "Operator report"]]) {
      await page.evaluate((f) => { ui[f] = true; render(); }, flag);
      await settle(page);
      await audit(page, where, checks);
    }
    await page.evaluate(() => { ui.readingOpen = false; ui.readingTextsOpen = false; ui.reviewCenterOpen = false; ui.operatorReportOpen = false; render(); });

    // ---- the model-reading panel: a local second look's answers ---------------
    // Planted the way a stored run is kept: the answer words, the evidence and
    // the summary are the model's text, so each carries the payload.
    await page.evaluate((T) => {
      const a = state.events[0].analysis, c = a.candidates[0], t = (f) => T.replace("__F__", f);
      a.vlm = { runId: "run_h", mode: "check", status: "done", model: t("vlmModel"), steps: 2, spentUsd: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        planSummary: t("planSummary"), tiles: [], regions: [], checks: [], setAside: null,
        findings: [
          { id: "vf1", kind: "note", step: "check", state: "open", confidence: "medium", candidateId: c.id, evidence: t("evidence"),
            check: { question: "chairs", answer: t("checkAnswer"), detector: t("checkDetector"), printed: null } },
          { id: "vf2", kind: "printedNumber", step: "overview", state: "open", confidence: "high", candidateId: c.id, value: t("printedValue"), evidence: t("evidence2") },
        ] };
      ui.vlmPanelOpen = true; render();
    }, tagged("__F__"));
    await settle(page);
    await audit(page, "Model reading panel, a second look's answers", checks, [mark("planSummary"), mark("evidence")]);
    await page.evaluate(() => { ui.vlmPanelOpen = false; ui.planMode = null; render(); });

    // ---- the Command Center's Plan Doctor ------------------------------------------
    await gotoTab(page, "command"); await settle(page);
    await page.evaluate(() => { ui.doctorOpen = true; render(); });
    await settle(page);
    await audit(page, "Plan Doctor", checks, [mark("handover")]);
    await page.evaluate(() => { ui.waveVip = !ui.waveVip; render(); });
    await settle(page);
    await audit(page, "Command Center, arrival wave toggled", checks);

    // ---- a freeze typed with the payload, and the two plan layers ---------------
    await gotoTab(page, "seating"); await settle(page);
    await click(page, "[data-freeze-action='open-form']");
    await page.selectOption("[data-freeze-field='scope']", "TABLE_GROUP").catch(() => {});
    await page.fill("[data-freeze-field='prefix']", "T").catch(() => {});
    await page.fill("[data-freeze-field='from']", "1").catch(() => {});
    await page.fill("[data-freeze-field='to']", "2").catch(() => {});
    await page.fill("[data-freeze-field='note']", tagged("typedFreeze").slice(0, 300));
    await audit(page, "Seating, freeze form being typed", checks);
    await click(page, "[data-freeze-action='create']");
    await settle(page);
    const typedFreeze = await page.evaluate(() => state.events[0].freezes.some((f) => String(f.note || "").startsWith("F:typedFreeze|")));
    checks.ok(typedFreeze, "the typed freeze note was saved as typed");
    await audit(page, "Seating, after a freeze typed with the payload", checks, [mark("typedFreeze")]);
    await gotoTab(page, "floor"); await settle(page);
    for (const [flag, where] of [["freezeLayer", "Floor Plan, freeze layer"], ["loadLayer", "Floor Plan, service-load layer"]]) {
      await page.evaluate((f) => { ui[f] = true; render(); }, flag);
      await settle(page);
      await audit(page, where, checks);
      await page.evaluate((f) => { ui[f] = false; render(); }, flag);
    }

    // ---- the printable table plan --------------------------------------------------
    await gotoTab(page, "reports"); await settle(page);
    await page.evaluate(() => { window.print = () => {}; });
    await click(page, "[data-report='print']");
    await page.waitForTimeout(300);
    await audit(page, "Printable table plan", checks, [mark("guestName")]);

    // ---- the F8 assistant ----------------------------------------------------------
    await gotoTab(page, "guests"); await settle(page);
    await page.keyboard.press("F8");
    await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
    const say = async (text) => {
      await page.fill("#assistantInput", text);
      await page.press("#assistantInput", "Enter");
      await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
      await settle(page);
      return page.evaluate(() => { const t = [...document.querySelectorAll(".assistant-turn.assistant")].pop(); return t ? t.textContent : ""; });
    };
    const unknown = { kind: "unknown", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [] };

    // The typed sentence itself is echoed back as the person's turn.
    reading = unknown; chatReply = tagged("chatReply");
    const said = await say(tagged("typedQuestion").slice(0, 380));
    await audit(page, "F8, a typed sentence carrying the payload, answered by the fixed reply", checks, [mark("typedQuestion")]);
    checks.ok(!said.includes(mark("chatReply")) && /event work|etkinlik işlerinde/.test(said), "a model reply carrying the payload is never shown; the fixed answer is", said.slice(0, 120));

    // A question about the hostile guest, answered from the records by the rules.
    reading = unknown; chatReply = "";
    await say("F:guestName nerede oturuyor?");
    await audit(page, "F8, a question answered from the records", checks);
    await say("Who is at T01?");
    await audit(page, "F8, a table's guests listed", checks);

    // A command the model read, naming a new guest with the payload: shown first.
    reading = { kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null,
      steps: [{ op: "addGuest", guest: null, table: null, from: null, other: null, name: tagged("modelName").slice(0, 120), pax: 2, fromTable: null }] };
    const shownCmd = await say("xyzzy plugh frobnicate");
    await audit(page, "F8, a command the model read, waiting for Onayla", checks, [mark("modelName")]);
    if (await page.locator(".assistant-confirm").count()) {
      await page.locator(".assistant-confirm").last().click();
      await settle(page);
    }
    const afterConfirm = await page.evaluate(() => { const t = [...document.querySelectorAll(".assistant-turn.assistant")].pop(); return t ? t.textContent : ""; });
    const added = await page.evaluate(() => state.events[0].guests.some((g) => g.name.startsWith("F:modelName|")));
    checks.ok(added, "confirmed, the guest is added with exactly the name the model read — markup and all, as text", { shown: shownCmd.slice(0, 200), after: afterConfirm.slice(0, 200) });
    await audit(page, "F8, after the model-read guest was added", checks, [mark("modelName")]);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { ui.guestQuery = ""; render(); });
    await settle(page);
    await audit(page, "Guests, with the model-read guest in the list", checks, [mark("modelName")]);
  } finally {
    await relay.close();
    await new Promise((r) => fake.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
