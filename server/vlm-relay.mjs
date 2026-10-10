#!/usr/bin/env node
// MERIT Event Maker — the vision-language relay.
//
//   npm run serve:vlm          (ANTHROPIC_API_KEY in the server's environment)
//
// One small Node process that does two things on ONE origin, so the page's
// Content-Security-Policy (connect-src 'self') needs no exception:
//
//   1. serves the app itself — index.html and src/, nothing else on the disk;
//   2. answers /vlm-relay/*, the only door through which a plan image reaches a
//      vision-language model. The page never holds the key and never talks to
//      Anthropic; it sends this process a plan image and the detector's boxes,
//      and this process builds the request from a fixed template
//      (server/vlm-core.mjs), spends the key it was started with, and returns a
//      checked answer.
//
//   GET  /vlm-relay/status   configured or not and why, model, prices, limits, today's spend.
//   POST /vlm-relay/check    is the key accepted and the model reachable? (models.retrieve —
//                            free; it does NOT prove there is a balance)
//   POST /vlm-relay/run      one step of a reading: the whole plan, or one region.
//   POST /vlm-relay/cancel   stop a run: its in-flight request is aborted, its next step refused.
//
// What it refuses, before anything is sent: a POST from another site (Origin,
// Sec-Fetch-Site and a header a cross-site form cannot set), a Host it was not
// started for (DNS rebinding), a second request while one is in flight, a
// payload outside the closed shape, and any request whose WORST-CASE cost
// would carry the run or the day over its cap.
//
// The key is read once (vlm-core configFromEnv) and goes nowhere but the
// x-api-key header of a request to the upstream API: not to status, not to a
// reply, not to the log (every line passes redact()), not to disk (usage.json
// holds aggregates only).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "./vlm-core.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RELAY_VERSION = 1;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2",
};
const CHECK_INTERVAL_MS = 5000;
const RUN_TTL_MS = 60 * 60 * 1000;
const RETRY_WAITS_MS = [2000, 6000];

// The SDK reads a handful of variables at construction (extra headers, a log
// level). The relay's own process may have been started from a shell that sets
// them for other tools; none of them may shape the product's requests.
const SDK_ENV_SHADOWED = ["ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_LOG", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"];

export async function makeClient(config, { log } = {}) {
  if (!config.configured) return null;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const saved = {};
  for (const k of SDK_ENV_SHADOWED) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    const say = (level) => (...args) => (log || console)[level === "error" ? "error" : "log"](core.redact(args.map(String).join(" "), config));
    return new Anthropic({
      apiKey: config.apiKey,
      authToken: null,
      baseURL: config.upstreamBaseURL,
      maxRetries: 0,                       // the relay retries itself, and counts every attempt
      timeout: config.limits.timeoutMs,
      logLevel: "warn",
      logger: { error: say("error"), warn: say("warn"), info: say("info"), debug: say("debug") },
    });
  } finally {
    for (const k of SDK_ENV_SHADOWED) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
}

// Which Host names this relay answers to. Loopback always; a GitHub Codespace's
// own forwarded name when the relay runs in one; anything in VLM_ALLOWED_HOSTS
// ("name" or "*.suffix"). A page served from any other name — a DNS-rebinding
// page that resolved to 127.0.0.1 — is refused before it can spend anything.
export function allowedHostsFrom(env, port) {
  const list = ["127.0.0.1", "localhost", "[::1]"];
  if (env.CODESPACE_NAME && env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN)
    list.push(`${env.CODESPACE_NAME}-${port}.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`.toLowerCase());
  for (const h of String(env.VLM_ALLOWED_HOSTS || "").split(",")) if (/^(\*\.)?[A-Za-z0-9.-]{1,200}$/.test(h.trim())) list.push(h.trim().toLowerCase());
  return list;
}
const hostAllowed = (hostname, allowed) => {
  const h = String(hostname || "").toLowerCase();
  return !!h && allowed.some(a => a.startsWith("*.") ? h.endsWith(a.slice(1)) && h.length > a.length - 1 : h === a);
};
const hostnameOf = (hostHeader) => { try { return new URL(`http://${hostHeader}`).hostname; } catch { return null; } };

export function createRelay({ config, client, root = REPO_ROOT, allowedHosts, log = console, now = Date.now } = {}) {
  const usage = new core.UsageStore(config.dataDir);
  const runs = new Map();            // runId -> { analysisId, planHash, steps, usd, cancelled, controller, at }
  let inFlight = null;               // { runId, controller }
  let lastCheckAt = 0;
  const hosts = allowedHosts || allowedHostsFrom({}, config.port);
  const say = (line) => log.log(core.redact(`[vlm-relay] ${line}`, config));

  const json = (res, code, body) => {
    const text = core.redact(JSON.stringify(body), config);
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": Buffer.byteLength(text) });
    res.end(text);
  };
  const snapshotRun = (r) => r ? { steps: r.steps, usd: Math.round(r.usd * 1e6) / 1e6, cancelled: r.cancelled } : null;

  function pruneRuns() { const t = now(); for (const [id, r] of runs) if (t - r.at > RUN_TTL_MS && !r.controller) runs.delete(id); }

  // A POST must come from a page this relay served, on a name it was started for.
  function refuseCrossSite(req) {
    if (!hostAllowed(hostnameOf(req.headers.host), hosts)) return "HOST_NOT_ALLOWED";
    if (req.headers["x-merit-relay"] !== "1") return "CROSS_SITE";
    if (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"])) return "CROSS_SITE";
    const origin = req.headers.origin;
    if (origin != null) { let o; try { o = new URL(origin); } catch { return "CROSS_SITE"; } if (!hostAllowed(o.hostname, hosts)) return "CROSS_SITE"; }
    return null;
  }

  function readJson(req, limit) {
    return new Promise((resolve) => {
      if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) { req.resume(); resolve({ error: "BAD_PAYLOAD" }); return; }
      const chunks = []; let size = 0, over = false;
      req.on("data", (c) => { size += c.length; if (size > limit) { over = true; req.destroy(); resolve({ error: "PAYLOAD_TOO_LARGE" }); } else chunks.push(c); });
      req.on("end", () => { if (over) return; try { resolve({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); } catch { resolve({ error: "BAD_PAYLOAD" }); } });
      req.on("error", () => resolve({ error: "BAD_PAYLOAD" }));
    });
  }

  function serveStatic(req, res, pathname) {
    let rel = pathname === "/" ? "/index.html" : pathname;
    // index.html and src/ only: the relay's own directory, the data directory,
    // node_modules and everything else on the disk are not the app.
    if (!(rel === "/index.html" || /^\/src\/[A-Za-z0-9._/-]+$/.test(rel)) || rel.includes("..")) { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
    const target = path.join(root, rel);
    if (!target.startsWith(path.join(root, path.sep)) && target !== path.join(root, "index.html")) { res.writeHead(403).end(); return; }
    fs.stat(target, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream", "content-length": st.size,
        "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      fs.createReadStream(target).pipe(res);
    });
  }

  async function handleCheck(req, res) {
    if (!config.configured) return json(res, 503, { ok: false, code: config.reasonCode });
    if (now() - lastCheckAt < CHECK_INTERVAL_MS) return json(res, 429, { ok: false, code: "CHECK_TOO_SOON" });
    lastCheckAt = now();
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const info = await client.models.retrieve(config.model, {}, { signal: controller.signal, timeout: 15000 });
      say(`check: key accepted, model ${config.model} reachable`);
      return json(res, 200, { ok: true, model: info && info.id || config.model, displayName: info && info.display_name || null,
        note: "the key and the model were accepted; a balance is not checked by this call" });
    } catch (err) {
      const m = core.mapUpstreamError(err);
      say(`check: ${m.code}${err && err.requestID ? ` request-id ${err.requestID}` : ""}`);
      return json(res, m.http, { ok: false, code: m.code });
    }
  }

  async function handleCancel(req, res) {
    const { body, error } = await readJson(req, 4096);
    if (error || !body || typeof body.runId !== "string") return json(res, 400, { ok: false, code: error || "BAD_PAYLOAD" });
    const r = runs.get(body.runId);
    if (!r) return json(res, 200, { ok: true, aborted: false, known: false });
    r.cancelled = true;
    const aborted = !!r.controller;
    if (r.controller) r.controller.abort();
    say(`run ${body.runId.slice(0, 12)}: cancelled by the operator${aborted ? " (in-flight request aborted)" : ""}`);
    return json(res, 200, { ok: true, aborted, known: true, run: snapshotRun(r) });
  }

  async function handleRun(req, res) {
    if (!config.configured) { req.resume(); return json(res, 503, { ok: false, code: config.reasonCode }); }
    if (inFlight) { req.resume(); return json(res, 409, { ok: false, code: "BUSY" }); }
    const { body, error } = await readJson(req, config.limits.maxBodyBytes);
    if (error) return json(res, error === "PAYLOAD_TOO_LARGE" ? 413 : 400, { ok: false, code: error });
    const v = core.validateRunPayload(body, config);
    if (!v.ok) return json(res, v.code === "IMAGE_TOO_LARGE" ? 413 : 400, { ok: false, code: v.code, field: v.field });
    const p = v.payload;
    if (inFlight) return json(res, 409, { ok: false, code: "BUSY" });
    pruneRuns();
    let run = runs.get(p.runId);
    if (!run) {
      if (p.step !== "overview") return json(res, 400, { ok: false, code: "RUN_UNKNOWN" });
      run = { analysisId: p.analysisId, planHash: p.planHash, steps: 0, usd: 0, cancelled: false, controller: null, at: now() };
      runs.set(p.runId, run);
    }
    if (run.analysisId !== p.analysisId || run.planHash !== p.planHash) return json(res, 409, { ok: false, code: "RUN_MISMATCH" });
    if (run.cancelled) return json(res, 409, { ok: false, code: "CANCELLED", run: snapshotRun(run) });
    const estimate = core.estimateCost(p, config);
    const refusal = core.limitRefusal({ day: usage.snapshot(), run, reserve: estimate.maxUsd, config });
    if (refusal) {
      say(`run ${p.runId.slice(0, 12)} ${p.step}: refused before sending — ${refusal} (worst case $${estimate.maxUsd})`);
      return json(res, 429, { ok: false, code: refusal, estimate, usage: usage.snapshot(), run: snapshotRun(run) });
    }

    // Hold the worst case against the day and the run BEFORE anything leaves.
    usage.reserve(estimate.maxUsd);
    run.steps++; run.usd += estimate.maxUsd; run.at = now();
    const controller = new AbortController();
    run.controller = controller; inFlight = { runId: p.runId, controller };
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", onClose);
    const started = now(), deadline = started + config.limits.timeoutMs;
    const params = core.buildMessagesRequest(p, config);
    let message = null, failure = null;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          message = await client.beta.messages.create(params, { signal: controller.signal, timeout: Math.max(1000, deadline - now()) });
          break;
        } catch (err) {
          const m = core.mapUpstreamError(err);
          const wait = RETRY_WAITS_MS[attempt];
          const retryAfter = Number(err && err.headers && typeof err.headers.get === "function" && err.headers.get("retry-after"));
          const pause = Math.min(20000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait || 0);
          const dayNow = usage.snapshot();
          if (m.retryable && wait != null && !controller.signal.aborted && deadline - now() > pause + 5000 && dayNow.requests < config.limits.maxRequestsPerDay) {
            say(`run ${p.runId.slice(0, 12)} ${p.step}: ${m.code}, retrying in ${Math.round(pause / 1000)}s`);
            await sleep(pause, controller.signal);
            if (controller.signal.aborted) { failure = { code: "CANCELLED", http: 499, billed: false, retryable: false }; break; }
            usage.noteRetry();
            continue;
          }
          failure = m; failure.requestID = err && err.requestID;
          break;
        }
      }
    } finally {
      res.off("close", onClose);
      run.controller = null; inFlight = null;
    }

    const secs = ((now() - started) / 1000).toFixed(1);
    if (failure) {
      usage.settle(estimate.maxUsd, { billed: failure.billed });
      if (failure.billed === false) run.usd = Math.max(0, run.usd - estimate.maxUsd);
      say(`run ${p.runId.slice(0, 12)} ${p.step}: ${failure.code} after ${secs}s${failure.requestID ? ` request-id ${failure.requestID}` : ""}${failure.billed === null ? " (spend unknown: the worst case stays held)" : ""}`);
      if (res.writableEnded || res.destroyed) return;
      return json(res, failure.http, { ok: false, code: failure.code, billed: failure.billed, retryable: failure.retryable, usage: usage.snapshot(), run: snapshotRun(run) });
    }

    const cost = core.actualCost(message, config);
    usage.settle(estimate.maxUsd, { cost });
    run.usd = Math.max(0, run.usd - estimate.maxUsd + cost.usd);
    const head = `run ${p.runId.slice(0, 12)} ${p.step}: ${cost.inputTokens} in / ${cost.outputTokens} out, $${cost.usd} on ${cost.servedBy}${cost.fellBack ? " (fallback)" : ""}, ${secs}s`;
    const echo = { runId: p.runId, step: p.step, analysisId: p.analysisId, planHash: p.planHash, cost, estimate, usage: usage.snapshot(), run: snapshotRun(run) };
    if (message.stop_reason === "refusal") { say(`${head} — the model declined`); return json(res, 200, { ok: false, code: "MODEL_DECLINED", ...echo }); }
    if (message.stop_reason === "max_tokens") { say(`${head} — the answer was cut off`); return json(res, 200, { ok: false, code: "OUTPUT_TRUNCATED", ...echo }); }
    const text = (message.content || []).filter(b => b && b.type === "text").map(b => b.text).join("");
    const out = core.validateModelOutput(text, p);
    if (!out.ok) { say(`${head} — the answer did not fit the schema`); return json(res, 200, { ok: false, code: out.code, ...echo }); }
    say(`${head} — ${out.result.findings.length} finding(s), ${out.result.regionsToInspect.length} region(s), ${out.result.dropped} dropped`);
    if (res.writableEnded || res.destroyed) return;
    return json(res, 200, { ok: true, result: out.result, ...echo });
  }

  async function handler(req, res) {
    let pathname;
    try { pathname = new URL(req.url, "http://relay").pathname; } catch { res.writeHead(400).end(); return; }
    try {
      if (!pathname.startsWith("/vlm-relay/")) {
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
        if (!hostAllowed(hostnameOf(req.headers.host), hosts)) { res.writeHead(421, { "content-type": "text/plain" }).end("host not allowed"); return; }
        return serveStatic(req, res, pathname);
      }
      if (pathname === "/vlm-relay/status" && req.method === "GET") {
        if (!hostAllowed(hostnameOf(req.headers.host), hosts)) return json(res, 421, { ok: false, code: "HOST_NOT_ALLOWED" });
        return json(res, 200, { ok: true, version: RELAY_VERSION, busy: !!inFlight, ...core.status(config, usage.snapshot()) });
      }
      if (req.method !== "POST") return json(res, 405, { ok: false, code: "METHOD" });
      const cross = refuseCrossSite(req);
      if (cross) { req.resume(); return json(res, 403, { ok: false, code: cross }); }
      if (pathname === "/vlm-relay/check") { req.resume(); return await handleCheck(req, res); }
      if (pathname === "/vlm-relay/run") return await handleRun(req, res);
      if (pathname === "/vlm-relay/cancel") return await handleCancel(req, res);
      return json(res, 404, { ok: false, code: "NOT_FOUND" });
    } catch (err) {
      say(`internal error: ${err && err.name}`);
      if (!res.headersSent) json(res, 500, { ok: false, code: "RELAY_ERROR" });
    }
  }

  return { handler, usage, runs, get busy() { return !!inFlight; } };
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal && signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export async function startRelay({ config, client, root = REPO_ROOT, allowedHosts, log = console } = {}) {
  const c = client === undefined ? await makeClient(config, { log }) : client;
  const relay = createRelay({ config, client: c, root, allowedHosts, log });
  const server = http.createServer((req, res) => { relay.handler(req, res); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
  const { port } = server.address();
  const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  return { relay, server, port, baseUrl: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

// ---- command line ------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = core.configFromEnv(process.env, { repoRoot: REPO_ROOT });
  const allowedHosts = allowedHostsFrom(process.env, config.port);
  const started = await startRelay({ config, allowedHosts });
  const s = core.status(config, started.relay.usage.snapshot());
  console.log("MERIT EVENT MAKER — app + vision-language relay");
  console.log(`  open        ${started.baseUrl}/index.html`);
  console.log(`  relay       ${s.configured ? "CONFIGURED" : `NOT CONFIGURED (${s.reasonCode === "NO_KEY" ? "ANTHROPIC_API_KEY is not set in this process's environment" : "no price is known for " + s.model})`}`);
  console.log(`  model       ${s.model}   effort ${s.effort}   fallbacks ${s.fallbacks}`);
  if (s.prices) console.log(`  prices      $${s.prices.inputPerMTok} in / $${s.prices.outputPerMTok} out per million tokens (${s.prices.source})`);
  console.log(`  limits      $${s.limits.maxUsdPerRun}/run  $${s.limits.maxUsdPerDay}/day  ${s.limits.maxRequestsPerDay} requests/day  ${s.limits.maxStepsPerRun} steps/run  ${s.limits.timeoutMs / 1000}s/request`);
  console.log(`  today       ${s.usage.requests} request(s), $${s.usage.usd} held or spent   (${config.dataDir})`);
  console.log(`  hosts       ${allowedHosts.join(", ")}`);
  console.log("  (ctrl-c to stop)");
}
