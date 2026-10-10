// The model reading on the review screen (src/screen-vlm.js, src/plan-vlm-review.js),
// end to end through the real relay — with a SCRIPTED upstream.
//
// NO MODEL RUNS HERE. tests/lib/fake-anthropic.mjs answers every request with
// findings this file wrote, built from the boxes the page sent. A pass proves
// the product's path from a button to a decision; it says nothing about how
// well any model reads a plan.
//
// What this pins:
//   THE PERSON STARTS IT. Opening the panel sends nothing; the free connection
//     check sends no plan; the plan goes only after a confirmation that names
//     what is sent and what is not, with the relay's spend caps.
//   ONLY THE PLAN LEAVES. With guests, notes and an inviter in the event, no
//     request to the upstream carries any of them, nor the event's name.
//   THE KEY NEVER REACHES THE BROWSER: not in a relay reply, the page, or storage.
//   WHOLE PLAN, THEN CLOSE-UPS, ON THE SAME MAP. The overview's findings and a
//     region's findings land in plan coordinates exactly where the model put
//     them (a region's box is mapped back through its own frame), as marks on
//     the review map and rows in the panel.
//   NOTHING CHANGES UNTIL A PERSON ACCEPTS, and then exactly one object, through
//     the writer a person's own click uses: a missed object is added (confirmed,
//     model's box, training example); "not an object" rejects one candidate; a
//     type correction changes ONE object and not its family; a seat count is
//     the typed-count write. A printed number and a note are never applied; a
//     finding about an object a person already decided is not offered.
//   MODEL TEXT IS TEXT: markup in its summary or evidence renders as characters.
//   AN ANSWER FOR AN OLDER ANALYSIS IS DROPPED, and the run is cancelled.
//   CANCEL STOPS THE REQUEST IN FLIGHT; NO BALANCE IS SAID, AND STAYS SAID.
//   FINDINGS SURVIVE A RELOAD with their decisions; a historical event refuses.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeAnthropic, messageReply, ERRORS } from "../lib/fake-anthropic.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate, gotoTab, addGuest } from "../lib/app-actions.mjs";

export const meta = { name: "vlm-reading", tags: ["intelligence", "security", "ui"], timeout: 360000, viewport: { width: 1920, height: 1080 } };

const KEY = "sk-ant-readingtest-fake-9876543210";
const HOSTILE_EVIDENCE = '<img src=x onerror="window.__vlmXss=1">';

// The scripted answer: built from what the page sent, so refs are real.
function scripted(body) {
  const text = body.messages[0].content[1].text, data = JSON.parse(text.split("\n").pop());
  const objs = data.detectorObjects, W = data.image.width, H = data.image.height;
  const overview = text.startsWith("This is the WHOLE plan");
  if (!overview) return messageReply({ text: JSON.stringify({ planSummary: "", regionsToInspect: [], findings: [
    { kind: "missing", ref: null, type: "square", box: [Math.round(W * 0.40), Math.round(H * 0.40), Math.round(W * 0.60), Math.round(H * 0.60)], value: null, confidence: "high", evidence: "SCRIPTED close-up finding" },
  ] }) });
  const tables = objs.filter((o) => o.kind === "table" && o.status === "unreviewed");
  const decided = objs.find((o) => o.status === "confirmed");
  const venue = objs.find((o) => o.kind === "venue" && o.status === "unreviewed");
  return messageReply({ text: JSON.stringify({
    planSummary: "SCRIPTED — not a model. <script>window.__vlmXss=2</script>",
    regionsToInspect: [{ box: [Math.round(W * 0.10), Math.round(H * 0.60), Math.round(W * 0.30), Math.round(H * 0.85)], reason: "SCRIPTED region" }],
    findings: [
      { kind: "missing", ref: null, type: "round", box: [Math.round(W * 0.47), Math.round(H * 0.02), Math.round(W * 0.50), Math.round(H * 0.06)], value: null, confidence: "medium", evidence: "SCRIPTED missing" },
      { kind: "notAnObject", ref: tables[0].ref, type: null, box: null, value: null, confidence: "low", evidence: "SCRIPTED reject" },
      { kind: "wrongType", ref: tables[1].ref, type: "bistro", box: null, value: null, confidence: "medium", evidence: "SCRIPTED retype" },
      venue && { kind: "seatCount", ref: venue.ref, type: null, box: null, value: 4, confidence: "low", evidence: "SCRIPTED seats" },
      { kind: "printedNumber", ref: tables[2].ref, type: null, box: null, value: 12, confidence: "high", evidence: "SCRIPTED number" },
      { kind: "note", ref: null, type: null, box: null, value: null, confidence: "high", evidence: HOSTILE_EVIDENCE },
      decided && { kind: "wrongType", ref: decided.ref, type: "square", box: null, value: null, confidence: "high", evidence: "SCRIPTED about a decided object" },
    ].filter(Boolean),
  }) });
}

export default async function run({ page, context, checks, baseUrl, repoRoot }) {
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-vlm-reading-"));
  const fake = await startFakeAnthropic({ fallback: scripted });
  const config = core.configFromEnv({ ANTHROPIC_API_KEY: KEY, VLM_UPSTREAM_BASE_URL: fake.baseURL, VLM_DATA_DIR: tmp, PORT: "0" }, { repoRoot });
  const relayLog = [];
  const relay = await startRelay({ config, log: { log: (l) => relayLog.push(l), error: (l) => relayLog.push(l) } });
  const relayBodies = [];
  page.on("response", async (res) => { if (res.url().includes("/vlm-relay/")) relayBodies.push(await res.text().catch(() => "")); });
  const vlm = () => page.evaluate(() => { const a = state.events[0].analysis; return a && a.vlm ? JSON.parse(JSON.stringify(a.vlm)) : null; });
  const waitRun = () => page.waitForFunction(() => { const v = state.events[0].analysis && state.events[0].analysis.vlm; return v && v.status !== "running"; }, null, { timeout: 60000 });
  const until = async (cond, ms = 20000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 50)); } };
  const send = async () => {
    await page.click('[data-vlm-action="start"]');
    await page.waitForSelector("#meritAskTitle", { state: "visible" });
    const dialog = await page.evaluate(() => ({ title: document.querySelector("#meritAskTitle").textContent, body: document.querySelector("#meritAskBody").textContent }));
    await page.click('[data-ask="confirm"]');
    return dialog;
  };

  try {
    // ---- an event with guests that must never leave -------------------------------
    await openApp(page, relay.baseUrl, { lang: "en" });
    await createBlankEvent(page, { name: "Gala of Secret Names", date: futureDate() });
    await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64"));
    await runDetection(page);
    await gotoTab(page, "guests");
    await addGuest(page, { name: "Zerrin Gizlisoyad", additionalGuests: 2, vip: "VIP" });
    await page.evaluate(() => { const g = state.events[0].guests[0]; g.invitedBy = "Murat Davetkar"; g.notes = "allergic-note-private"; saveState(); });
    // One object a person has decided before the model is asked.
    const decidedId = await page.evaluate(() => {
      const ev = state.events[0], c = ev.analysis.candidates.filter((x) => x.kind === "table" && x.status === "unreviewed").pop();
      decideReview(ev, { kind: "confirm", candidateId: c.id }); return c.id;
    });
    await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = null; render(); });
    await page.waitForTimeout(300);

    // ---- opening the panel sends nothing -------------------------------------------
    checks.require(await page.locator('[data-vlm-action="toggle"]').count() === 1, "the review header carries the Model reading control");
    await page.click('[data-vlm-action="toggle"]');
    await page.waitForSelector(".vlm-panel .vlm-state.ok");
    checks.ok(fake.requests.length === 0, "opening the panel asks the relay what it is and sends nothing upstream", fake.requests.length);
    await page.click('[data-vlm-action="check"]');
    await page.waitForFunction(() => /Key and model accepted/.test((document.querySelector(".vlm-panel") || {}).textContent || ""));
    checks.ok(fake.requests.length === 1 && fake.requests[0].method === "GET" && fake.requests[0].body === null,
      "the free connection check asks for the model and sends no plan", fake.requests.map((r) => r.method + " " + r.path));

    // ---- the confirmation names what goes and what does not ---------------------------
    const snapshot = () => page.evaluate(() => JSON.stringify(state.events[0].analysis.candidates.map((c) => [c.id, c.kind, c.type, c.status, c.seats ?? null, c.x, c.y])));
    const beforeSend = await snapshot();
    const dialog = await send();
    checks.ok(/Send this plan to the model\?/.test(dialog.title) && /Sent: the plan image \(\d+×\d+ px\)/.test(dialog.body) && /Not sent: guests, notes, inviters, seating, the event's name/.test(dialog.body)
      && /at most \$1\.50 for this reading/.test(dialog.body) && /claude-opus-5-5/.test(dialog.body),
      "the confirmation states the image size, what is NOT sent, the model and the spend caps", dialog);
    await waitRun();
    const r1 = await vlm();
    const posts = fake.requests.filter((r) => r.method === "POST");
    checks.ok(r1.status === "done" && posts.length === 2 && r1.regions.length === 1 && r1.regions[0].state === "done",
      "the whole plan went first, then the one close-up the model asked for", { status: r1.status, code: r1.code, posts: posts.length, regions: r1.regions });

    checks.ok(await snapshot() === beforeSend, "a finished reading has changed no object: every finding is waiting for a person");

    // ---- only the plan left -------------------------------------------------------------
    const upstream = JSON.stringify(posts.map((r) => r.body));
    const leaked = ["Zerrin", "Gizlisoyad", "Murat", "Davetkar", "allergic", "Gala of Secret Names"].filter((s) => upstream.includes(s));
    checks.equal(leaked, [], "no guest name, inviter, note or event name reached the upstream");
    const img = posts[0].body.messages[0].content[0].source, regionImg = posts[1].body.messages[0].content[0].source;
    const overviewData = JSON.parse(posts[0].body.messages[0].content[1].text.split("\n").pop());
    checks.ok(img.type === "base64" && /^image\/(png|jpeg)$/.test(img.media_type) && overviewData.image.width * overviewData.image.height <= 4784 * 750 && Math.max(overviewData.image.width, overviewData.image.height) <= 2576,
      "the plan image is sent within both API limits, so the model's pixels are the plan's pixels", overviewData.image);
    checks.ok(regionImg.data !== img.data && posts[1].body.messages[0].content[1].text.startsWith("This is a ZOOMED REGION"), "the close-up is its own crop, sent as a region step");

    // ---- the key never reaches the browser ------------------------------------------------
    const pageSide = await page.evaluate(() => document.documentElement.outerHTML + JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
    checks.ok(relayBodies.length >= 3 && !relayBodies.join("\n").includes(KEY) && !pageSide.includes(KEY) && !relayLog.join("\n").includes(KEY),
      "the key appears in no relay reply, nowhere in the page or its storage, and not in the relay's log", { replies: relayBodies.length });

    // ---- findings on the map, in plan coordinates --------------------------------------------
    const marks = await page.locator(".vlm-mark").count(), rows = await page.locator(".vlm-finding").count();
    const withPlace = r1.findings.filter((f) => f.box || f.candidateId).length;
    checks.ok(rows === r1.findings.length && marks === withPlace && rows >= 7, "every finding is a row in the panel, and every finding with a place is a mark on the map", { rows, marks, withPlace });
    const overviewMissing = r1.findings.find((f) => f.kind === "missing" && f.step === "overview");
    const regionMissing = r1.findings.find((f) => f.kind === "missing" && f.step === "region");
    const fr = r1.regions[0].frame;
    const expectX = fr.x + 0.40 * fr.w, expectW = 0.20 * fr.w;
    checks.ok(Math.abs(overviewMissing.box.x - 47) < 0.2 && Math.abs(overviewMissing.box.y - 2) < 0.3,
      "a whole-plan box lands where the model put it (47% across, 2% down)", overviewMissing.box);
    checks.ok(Math.abs(regionMissing.box.x - expectX) < 0.2 && Math.abs(regionMissing.box.w - expectW) < 0.2 && regionMissing.box.x >= fr.x && regionMissing.box.x + regionMissing.box.w <= fr.x + fr.w + 0.01,
      "a close-up's box is mapped back through its own frame onto the plan", { box: regionMissing.box, frame: fr });

    // ---- model text is text -------------------------------------------------------------
    const xss = await page.evaluate(() => ({ flag: window.__vlmXss || null, imgs: document.querySelectorAll(".vlm-panel img, .vlm-panel script").length, shown: (document.querySelector(".vlm-panel") || {}).textContent.includes('<img src=x onerror="window.__vlmXss=1">') }));
    checks.equal(xss, { flag: null, imgs: 0, shown: true }, "markup in the model's summary or evidence is shown as characters and runs nothing");

    // ---- nothing has changed yet ----------------------------------------------------------------
    const before = await page.evaluate(() => JSON.stringify(state.events[0].analysis.candidates.map((c) => [c.id, c.kind, c.type, c.status, c.seats ?? null])));
    const find = (kind) => r1.findings.find((f) => f.kind === kind && f.evidence !== "SCRIPTED about a decided object" && (kind !== "missing" || f.step === "overview"));
    const aboutDecided = r1.findings.find((f) => f.evidence === "SCRIPTED about a decided object");
    const accept = async (f) => { await page.click(`[data-vlm-action="accept"][data-vlm-finding="${f.id}"]`); await page.waitForTimeout(250); };

    // a type correction changes ONE object, never its family
    const retype = find("wrongType");
    const family = await page.evaluate((id) => {
      const a = state.events[0].analysis, c = a.candidates.find((x) => x.id === id);
      return a.candidates.filter((x) => x.id !== id && x.kind === c.kind && x.type === c.type && x.status === "unreviewed").map((x) => x.id);
    }, retype.candidateId);
    await accept(retype);
    const afterRetype = await page.evaluate(({ id, family }) => {
      const a = state.events[0].analysis, c = a.candidates.find((x) => x.id === id);
      return { type: c.type, status: c.status, familyTypes: [...new Set(family.map((f) => a.candidates.find((x) => x.id === f).type))], familyStatus: [...new Set(family.map((f) => a.candidates.find((x) => x.id === f).status))],
        audit: (state.events[0].audit || state.events[0].auditLog || []).slice(-3).map((e) => e.action || e.type) };
    }, { id: retype.candidateId, family });
    checks.ok(afterRetype.type === "bistro" && afterRetype.status === "confirmed" && family.length > 0 && afterRetype.familyTypes.length === 1 && afterRetype.familyTypes[0] !== "bistro" && afterRetype.familyStatus.join() === "unreviewed",
      `accepting a type correction changes that one object; its ${family.length} unreviewed look-alikes are untouched`, afterRetype);

    // "not an object" rejects one candidate
    const reject = find("notAnObject");
    await accept(reject);
    checks.equal(await page.evaluate((id) => state.events[0].analysis.candidates.find((x) => x.id === id).status, reject.candidateId), "rejected", "accepting \"not an object\" rejects that candidate");

    // a missed object is added, confirmed, with the model's box and a training example
    const examplesBefore = await page.evaluate(() => (state.trainingData || []).length);
    await accept(overviewMissing);
    await page.waitForTimeout(500);
    const added = await page.evaluate((fid) => {
      const a = state.events[0].analysis, c = a.candidates.find((x) => x.evidence && x.evidence.finding === fid);
      return c ? { kind: c.kind, type: c.type, status: c.status, geometry: c.evidence.geometry, inMissed: a.missed.includes(c.id), x: c.x, examples: (state.trainingData || []).length } : null;
    }, overviewMissing.id);
    checks.ok(added && added.kind === "table" && added.type === "round" && added.status === "confirmed" && added.geometry === "vlm-suggestion" && added.inMissed && Math.abs(added.x - overviewMissing.box.x) < 0.01 && added.examples === examplesBefore + 1,
      "accepting a missed object adds ONE confirmed object at the model's box, marked as a model suggestion, with a training example", added);

    // a seat count is the typed-count write
    const seats = find("seatCount");
    if (seats) {
      await accept(seats);
      checks.equal(await page.evaluate((id) => { const c = state.events[0].analysis.candidates.find((x) => x.id === id); return [c.seats, c.seatsConfidence]; }, seats.candidateId), [4, "verified"],
        "accepting a seat count writes it as a person's verified count");
    }

    // never applied: a printed number, a note, and anything about a decided object
    const disabled = await page.evaluate((ids) => ids.map((id) => {
      const b = document.querySelector(`[data-vlm-action="accept"][data-vlm-finding="${id}"]`), row = document.querySelector(`[data-vlm-row="${id}"]`);
      return { disabled: !!(b && b.disabled), reason: row ? (row.querySelector(".vlm-reason") || {}).textContent || "" : "" };
    }), [find("printedNumber").id, find("note").id, aboutDecided.id]);
    checks.ok(disabled[0].disabled && /not taken from a model/.test(disabled[0].reason) && disabled[1].disabled && /Information only/.test(disabled[1].reason)
      && disabled[2].disabled && /already decided this object/.test(disabled[2].reason) && aboutDecided.candidateId === decidedId,
      "a printed number, a note and a finding about an object a person decided cannot be accepted — each says why on the control", disabled);
    await page.click(`[data-vlm-action="dismiss"][data-vlm-finding="${find("note").id}"]`);
    await page.waitForTimeout(200);

    // exactly the accepted objects changed
    const after = await page.evaluate(() => state.events[0].analysis.candidates.map((c) => [c.id, c.kind, c.type, c.status, c.seats ?? null]));
    const beforeMap = new Map(JSON.parse(before).map((r) => [r[0], JSON.stringify(r)]));
    const changed = after.filter((r) => beforeMap.get(r[0]) !== JSON.stringify(r)).map((r) => r[0]).sort();
    const expected = [retype.candidateId, reject.candidateId, ...(seats ? [seats.candidateId] : [])].sort();
    const newOnes = after.filter((r) => !beforeMap.has(r[0])).length;
    checks.ok(JSON.stringify(changed.filter((id) => beforeMap.has(id))) === JSON.stringify(expected) && newOnes === 1,
      "after four accepts and a dismissal, exactly the accepted objects changed and one object was added", { changed, expected, newOnes });
    const states = (await vlm()).findings.reduce((m, f) => (m[f.state] = (m[f.state] || 0) + 1, m), {});
    checks.ok(states.accepted === expected.length + 1 && states.dismissed === 1, "the panel keeps each decision on its finding", states);

    // ---- a reload keeps the findings and their decisions ------------------------------------
    await page.evaluate(() => saveState());
    const statesBefore = (await vlm()).findings.map((f) => f.state);
    await page.reload();
    await page.waitForFunction(() => { try { return state.events.length === 1; } catch { return false; } }, null, { timeout: 15000 });
    await page.evaluate(() => openEvent(state.events[0].id));
    await page.waitForTimeout(300);
    await page.evaluate(() => { ui.lang = "en"; ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = null; ui.vlmPanelOpen = false; render(); });
    await page.click('[data-vlm-action="toggle"]');
    await page.waitForSelector('.vlm-panel [data-vlm-action="start"]');
    const reloaded = await vlm();
    checks.ok(reloaded && reloaded.findings.length === r1.findings.length && JSON.stringify(reloaded.findings.map((f) => f.state)) === JSON.stringify(statesBefore)
      && reloaded.findings.filter((f) => f.state === "accepted").length === states.accepted && await page.locator(".vlm-finding").count() === r1.findings.length,
      "after a reload the reading, its findings and their decisions are all still there", reloaded && reloaded.findings.length);

    // ---- an answer for an older analysis is dropped -------------------------------------------
    fake.push({ delayMs: 2500, reply: scripted });
    const posted = fake.requests.length;
    await send();
    await until(() => fake.requests.length > posted);
    // What a re-analysis does to the event: a NEW analysis object with a new id.
    await page.evaluate(() => { const e = state.events[0]; e.analysis = { ...JSON.parse(JSON.stringify(e.analysis)), id: "analysis_replaced_by_reanalysis" }; delete e.analysis.vlm; render(); });
    await page.waitForFunction(() => !document.querySelector('[data-vlm-action="cancel"]'), null, { timeout: 30000 });
    await page.waitForTimeout(300);
    const staleState = await page.evaluate(() => ({ vlm: state.events[0].analysis.vlm || null, toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ") }));
    const cancelSent = relayLog.some((l) => /cancelled by the operator/.test(l));
    checks.ok(staleState.vlm === null && /belonged to an earlier analysis and was discarded/.test(staleState.toast) && cancelSent,
      "an answer that arrives after the analysis changed is discarded, the new analysis gets nothing, and the reading is cancelled at the relay", { vlm: staleState.vlm, toast: staleState.toast, cancelSent });

    // ---- cancel stops the request in flight -----------------------------------------------------
    await page.evaluate(() => { ui.vlmPanelOpen = true; render(); });
    await page.waitForSelector('[data-vlm-action="start"]');
    fake.push({ hang: true });
    const hangIndex = fake.requests.length;
    await send();
    await until(() => fake.requests.length > hangIndex);
    await page.waitForSelector('[data-vlm-action="cancel"]');
    await page.click('[data-vlm-action="cancel"]');
    await waitRun();
    await page.waitForTimeout(300);
    const cancelled = await vlm();
    await until(() => fake.requests[hangIndex].aborted === true, 5000).catch(() => {});
    checks.ok(cancelled.status === "cancelled" && fake.requests[hangIndex] && fake.requests[hangIndex].aborted === true && await page.locator('[data-vlm-action="cancel"]').count() === 0,
      "Cancel stops the reading and the request in flight, upstream included", { status: cancelled.status, aborted: fake.requests[hangIndex] && fake.requests[hangIndex].aborted });

    // ---- no balance is said, and stays said ----------------------------------------------------
    fake.push({ error: ERRORS.creditBalance() });
    await send();
    await waitRun();
    await page.waitForTimeout(300);
    const noBalance = await vlm();
    const panelText = await page.evaluate(() => document.querySelector(".vlm-panel .vlm-run .vlm-state").textContent);
    checks.ok(noBalance.status === "failed" && noBalance.code === "NO_BALANCE" && /Reading failed/.test(panelText) && /no credit balance/.test(panelText) && noBalance.findings.length === 0,
      "an empty balance is named in the panel's status line, where it stays after the toast has gone", { code: noBalance.code, panelText });

    // ---- in Turkish ------------------------------------------------------------------------------
    await page.evaluate(() => { ui.lang = "tr"; render(); });
    const tr = await page.evaluate(() => ({ button: (document.querySelector('[data-vlm-action="toggle"]') || {}).textContent || "", panel: document.querySelector(".vlm-panel").textContent }));
    checks.ok(/Model okuması/.test(tr.button) && /API hesabında bakiye yok/.test(tr.panel) && /MODEL AKTARICISI HAZIR/.test(tr.panel), "the control, the relay state and the failure read in Turkish", tr.panel.slice(0, 160));
    await page.evaluate(() => { ui.lang = "en"; render(); });

    // ---- a historical event refuses -------------------------------------------------------------
    const callsBefore = fake.requests.length;
    // The screen leaves a historical event for Guests, so its button is gone
    // after a render; this presses the one still on screen at the moment the
    // event became historical, which is the domain check (canMutate) and not
    // the hidden control doing the refusing.
    const priorStatus = await page.evaluate(() => { const s = state.events[0].status; state.events[0].status = "Completed"; return s; });
    const startShown = await page.locator('[data-vlm-action="start"]').count();
    if (startShown) await page.click('[data-vlm-action="start"]');
    await page.waitForTimeout(600);
    checks.ok(startShown === 1 && fake.requests.length === callsBefore && !(await page.locator("#meritAskTitle:visible").count()) && (await vlm()).status === "failed",
      "on a historical event pressing Send starts nothing: no question, no request, the analysis untouched", { startShown, calls: fake.requests.length - callsBefore, status: (await vlm()).status });
    await page.evaluate((s) => { state.events[0].status = s; render(); }, priorStatus);

    // ---- without a relay, the page says so and sends nothing --------------------------------------
    const plain = await context.newPage();
    await openApp(plain, baseUrl, { lang: "en" });
    await createBlankEvent(plain, { name: "No relay", date: futureDate() });
    await importPlan(plain, "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64"));
    await runDetection(plain);
    await plain.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
    const plainHasButton = await plain.locator('[data-vlm-action="toggle"]').count();
    let plainText = "";
    if (plainHasButton) {
      await plain.click('[data-vlm-action="toggle"]');
      await plain.waitForSelector(".vlm-panel .vlm-state.warn");
      plainText = await plain.evaluate(() => document.querySelector(".vlm-panel").textContent);
    }
    checks.ok(plainHasButton === 1 && /No model relay on this page/.test(plainText) && !/Send plan/.test(plainText),
      "served without the relay, the panel says there is no relay and offers no send", plainText.slice(0, 160));
    await plain.close();
  } finally {
    await relay.close().catch(() => {});
    await fake.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
