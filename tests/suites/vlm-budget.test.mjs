// The relay's spend accounting (server/vlm-core.mjs UsageStore, estimateCost,
// actualCost, mapUpstreamError; server/vlm-relay.mjs), with no key and no
// network. Written against the audit of 602ba27 (ACCEPTANCE-602ba27.md A1–A8)
// BEFORE the fix, and red on that commit.
//
// What this pins:
//   EVERY BILLABLE ATTEMPT IS RESERVED. With a fallback chain, a declined
//     attempt and its fallback can both be billed (Anthropic, "How refusals are
//     billed"), so the hold covers every hop at that hop's price. An unbounded
//     chain ("default") cannot be bounded, so it is refused as configuration.
//   AN ESTIMATE SAYS IT IS ONE. Input tokens come from the free count_tokens
//     endpoint (itself documented as an estimate, so a margin is added); when
//     it is unavailable the heuristic is labelled heuristic, never "exact".
//   UNKNOWN IS NOT FREE. A connection failure or a 5xx may have been processed:
//     its hold stays. A retry is a new attempt with its own reservation.
//   A RESERVATION HAS AN IDENTITY AND A DAY. It settles against the day it was
//     made, across UTC midnight, exactly once.
//   A LEDGER THAT CANNOT BE READ STOPS PAID WORK. It is never reopened as zero,
//     never overwritten; a second relay on the same ledger is refused; a crash
//     between reserve and settle leaves the hold in place.
//   PRICES ARE THE OFFICIAL TABLE, WITH ITS TIERS. Haiku 5.5 over 100K prompt
//     tokens is priced at its higher tier; an unpriced model is not a budget.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeAnthropic, messageReply, ERRORS } from "../lib/fake-anthropic.mjs";

export const meta = { name: "vlm-budget", tags: ["security", "intelligence", "fast"], timeout: 120000 };

const KEY = "sk-ant-budgettest-fake-0123456789";
const PNG64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const body = (over = {}) => ({ runId: "run_budget001", step: "overview", analysisId: "analysis_b", planHash: "h", lang: "en",
  image: { mediaType: "image/png", data: PNG64, width: 800, height: 600 }, candidates: [], printedText: [], ...over });
const DAY = 24 * 3600 * 1000;

export default async function run({ checks, repoRoot }) {
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const relayMod = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-vlm-budget-"));
  let n = 0;
  const dir = () => path.join(tmp, "d" + (++n));
  const quiet = { log() {}, error() {} };
  const opened = [];
  try {
    // ---- A8: the official price table, with its tiers --------------------------------
    checks.ok(/2026-10-10/.test(core.PRICES_AS_OF) && /platform\.claude\.com\/docs\/en\/about-claude\/pricing/.test(core.PRICES_SOURCE || ""),
      "the price table names the day it was checked and the official page it was checked against", { asOf: core.PRICES_AS_OF, src: core.PRICES_SOURCE });
    const haiku = core.configFromEnv({ ANTHROPIC_API_KEY: KEY, VLM_MODEL: "claude-haiku-5-5" }, { repoRoot });
    const small = core.priceFor ? core.priceFor("claude-haiku-5-5", 50000, haiku) : null;
    const large = core.priceFor ? core.priceFor("claude-haiku-5-5", 150000, haiku) : null;
    checks.ok(small && large && small.in === 0.1 && small.out === 0.5 && large.in === 0.5 && large.out === 2.5,
      "Haiku 5.5 prompts over 100,000 tokens are priced at the higher tier ($0.50 / $2.50)", { small, large });
    const unpricedChain = core.configFromEnv({ ANTHROPIC_API_KEY: KEY, VLM_FALLBACK_MODELS: "claude-not-a-real-model" }, { repoRoot });
    const unbounded = core.configFromEnv({ ANTHROPIC_API_KEY: KEY, VLM_FALLBACKS: "default" }, { repoRoot });
    const plain = core.configFromEnv({ ANTHROPIC_API_KEY: KEY }, { repoRoot });
    checks.ok(!unpricedChain.configured && unpricedChain.reasonCode === "UNKNOWN_PRICE" && !unbounded.configured && unbounded.reasonCode === "UNBOUNDED_FALLBACK"
      && plain.configured && Array.isArray(plain.fallbackChain) && plain.fallbackChain.length === 0,
      "fallbacks are off by default; an unpriced fallback model or an open-ended chain is refused as configuration", { a: unpricedChain.reasonCode, b: unbounded.reasonCode, chain: plain.fallbackChain });

    // ---- A1: one hold per billable attempt -----------------------------------------------
    const chain = core.configFromEnv({ ANTHROPIC_API_KEY: KEY, VLM_FALLBACK_MODELS: "claude-opus-5" }, { repoRoot });
    const p = core.validateRunPayload(body(), chain).payload;
    const est = core.estimateCost(p, chain, { counted: { "claude-opus-5-5": 5000, "claude-opus-5": 5000 } });
    const twoHops = { model: "claude-opus-5", usage: { input_tokens: 5000, output_tokens: chain.maxOutputTokens, iterations: [
      { type: "message", model: "claude-opus-5-5", input_tokens: 5000, output_tokens: chain.maxOutputTokens },
      { type: "fallback_message", model: "claude-opus-5", input_tokens: 5000, output_tokens: chain.maxOutputTokens } ] } };
    const spent = core.actualCost(twoHops, chain);
    checks.ok(est.maxUsd >= spent.usd && est.hops === 2 && spent.usd > 0,
      "with a fallback chain, the reservation covers a full-length declined attempt AND a full-length fallback, each at its own price", { est, spent });
    const req = core.buildMessagesRequest(p, chain);
    checks.ok(Array.isArray(req.fallbacks) && req.fallbacks.length === 1 && req.fallbacks[0].model === "claude-opus-5" && req.betas.includes("server-side-fallback-2026-06-01")
      && !("fallbacks" in core.buildMessagesRequest(p, plain)),
      "an explicit chain is sent as the bounded array form; no chain, no fallbacks field", { fallbacks: req.fallbacks, betas: req.betas });

    // ---- A2: an estimate says what it is ------------------------------------------------------
    const counted = core.estimateCost(p, plain, { counted: { "claude-opus-5-5": 4321 } });
    const guessed = core.estimateCost(p, plain, {});
    checks.ok(counted.inputBasis === "counted" && counted.inputTokens >= 4321 && guessed.inputBasis === "heuristic" && guessed.inputTokens > 0,
      "input tokens come from count_tokens (plus a margin) and say so; without a count the figure is labelled heuristic", { counted, guessed });

    // ---- A3: unknown is not free ----------------------------------------------------------------
    const conn = new Error("Connection error."); Object.defineProperty(conn, "constructor", { value: { name: "APIConnectionError" } });
    const five = Object.assign(new Error("500 api_error"), { status: 500 });
    checks.ok(core.mapUpstreamError(conn).billed !== false && core.mapUpstreamError(five).billed !== false
      && core.mapUpstreamError(Object.assign(new Error("429"), { status: 429 })).billed === false,
      "a connection failure or a 5xx may have been processed, so its hold is kept; a 429 was refused before processing", { conn: core.mapUpstreamError(conn), five: core.mapUpstreamError(five) });

    // ---- A4 / A5: identity and day ---------------------------------------------------------------
    {
      const d = dir();
      const s = new core.UsageStore(d, { lock: false });
      const t0 = Date.UTC(2026, 9, 10, 23, 59, 50), t1 = t0 + 20000;
      const id = s.reserve(1.0, { runId: "r", now: t0 });
      const before = s.snapshot(t1);
      s.settle(id, { cost: { usd: 0.25, inputTokens: 10, outputTokens: 5 } }, t1);
      const dayA = s.snapshot(t0), dayB = s.snapshot(t1);
      const again = (() => { try { s.settle(id, { cost: { usd: 0.25, inputTokens: 1, outputTokens: 1 } }, t1); return "accepted"; } catch (e) { return e.code || e.message; } })();
      checks.ok(typeof id === "string" && id.length >= 8 && dayA.usd === 0.25 && dayB.usd === 0 && before.usd === 0 && dayA.requests === 1 && again !== "accepted",
        "a request reserved before UTC midnight and finished after it settles against the day it was reserved in, once", { dayA, dayB, again });
    }

    // ---- A6: an unreadable ledger stops paid work -------------------------------------------------
    {
      const d = dir();
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "usage.json"), '{"version":2,"days":{"2026-10-10":{"usd":4.9');
      const s = new core.UsageStore(d, { lock: false });
      const refused = (() => { try { s.reserve(0.1); return null; } catch (e) { return e.code; } })();
      const still = fs.readFileSync(path.join(d, "usage.json"), "utf8");
      checks.ok(s.state === "CORRUPT" && refused === "LEDGER_CORRUPT" && still.startsWith('{"version":2,"days":{"2026-10-10":{"usd":4.9'),
        "a ledger that cannot be read is not reopened as zero spend: paid work stops and the file is left as it was", { state: s.state, refused });
      const f = await startFakeAnthropic();
      const config = core.configFromEnv({ ANTHROPIC_API_KEY: KEY, VLM_UPSTREAM_BASE_URL: f.baseURL, VLM_DATA_DIR: d, PORT: "0" }, { repoRoot });
      const r = await relayMod.startRelay({ config, log: quiet }); opened.push(r);
      const st = await (await fetch(r.baseUrl + "/vlm-relay/status")).json();
      const res = await fetch(r.baseUrl + "/vlm-relay/run", { method: "POST", headers: { "content-type": "application/json", "x-merit-relay": "1" }, body: JSON.stringify(body()) }).then((x) => x.json());
      checks.ok(st.ledger && st.ledger.state === "CORRUPT" && res.code === "LEDGER_CORRUPT" && f.requests.length === 0,
        "the relay says its ledger is unreadable and refuses to send", { ledger: st.ledger, code: res.code, calls: f.requests.length });
      await f.close();
    }

    // ---- A7: one writer, and a crash keeps the hold -------------------------------------------------
    {
      const d = dir();
      const a = new core.UsageStore(d);
      const b = new core.UsageStore(d);
      const refusedSecond = (() => { try { b.reserve(0.1); return null; } catch (e) { return e.code; } })();
      const id = a.reserve(0.7);
      // a crash: the process dies between reserve and settle, and never releases its lock
      const reopened = new core.UsageStore(d, { lock: false });
      const snap = reopened.snapshot();
      checks.ok(b.state === "LOCKED" && refusedSecond === "LEDGER_LOCKED" && snap.usd === 0.7 && reopened.openReservations().length === 1 && reopened.openReservations()[0].id === id,
        "a second relay on the same ledger is refused, and a hold whose request never settled is still held after a restart", { second: b.state, snap, open: reopened.openReservations().length });
      a.close();
      const leftovers = fs.readdirSync(d).filter((x) => x.endsWith(".tmp"));
      checks.equal(leftovers, [], "writes leave no temporary file behind");
    }

    // ---- the relay: count, reserve per attempt, keep unknown holds ------------------------------------
    {
      const f = await startFakeAnthropic({ script: [{ destroy: true }, { reply: messageReply({ text: JSON.stringify({ planSummary: "", findings: [], regionsToInspect: [] }) }) }], countTokens: 3000 });
      const d = dir();
      const config = core.configFromEnv({ ANTHROPIC_API_KEY: KEY, VLM_UPSTREAM_BASE_URL: f.baseURL, VLM_DATA_DIR: d, PORT: "0" }, { repoRoot });
      const r = await relayMod.startRelay({ config, log: quiet }); opened.push(r);
      const res = await fetch(r.baseUrl + "/vlm-relay/run", { method: "POST", headers: { "content-type": "application/json", "x-merit-relay": "1" }, body: JSON.stringify(body()) }).then((x) => x.json());
      const st = await (await fetch(r.baseUrl + "/vlm-relay/status")).json();
      const counts = f.counts.length;
      const sends = f.requests.filter((q) => q.method === "POST").length;
      checks.ok(res.ok && counts >= 1 && sends === 2 && st.usage.requests === 2 && st.usage.unknownSpendRequests === 1 && res.estimate.inputBasis === "counted",
        "the relay counts input tokens first (free), gives each attempt its own hold, and keeps the hold of an attempt whose connection broke", { ok: res.ok, code: res.code, counts, sends, usage: st.usage, basis: res.estimate && res.estimate.inputBasis });
      await f.close();
    }
  } finally {
    for (const r of opened) await r.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
