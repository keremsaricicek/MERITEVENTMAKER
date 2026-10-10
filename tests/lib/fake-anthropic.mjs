// A stand-in for the Anthropic API, for the relay's key-less tests.
//
// NOTHING HERE IS A MODEL. Every answer this server gives is SCRIPTED by the
// test that started it — a fixed JSON reply, a scripted refusal, a scripted
// error — so that the relay's plumbing (key handling, limits, cancellation,
// error mapping, stale-answer rejection) can be exercised without a key and
// without spending anything. A suite that passes against this server proves
// the plumbing; it proves nothing about how well a real model reads a plan,
// and no report may present it as if it did.
//
// It records every request it receives (method, path, headers, parsed body) —
// `requests` for messages and models, `counts` for the free count_tokens —
// so a suite can assert what actually left the relay: which header carried
// the key, that no guest field travelled, that plan text was quoted data.
import http from "node:http";

export const FAKE_NOTICE = "SCRIPTED by tests/lib/fake-anthropic.mjs — not a model";

export function messageReply({ text, model = "claude-opus-5-5", stop_reason = "end_turn", usage = { input_tokens: 4200, output_tokens: 900 } } = {}) {
  return { id: "msg_fake_0001", type: "message", role: "assistant", model, stop_reason, stop_sequence: null,
    content: text == null ? [] : [{ type: "text", text }], usage };
}

export function errorReply(status, type, message) {
  return { status, body: { type: "error", error: { type, message } }, headers: { "request-id": `req_fake_${status}` } };
}

// The errors the relay must name, as the API states them.
export const ERRORS = Object.freeze({
  authentication: () => errorReply(401, "authentication_error", "invalid x-api-key"),
  creditBalance: () => errorReply(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."),
  billing: () => errorReply(402, "billing_error", "billing error"),
  permission: () => errorReply(403, "permission_error", "Your API key does not have permission to use the specified resource."),
  notFound: () => errorReply(404, "not_found_error", "model: not-a-model"),
  rateLimit: () => ({ ...errorReply(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"), headers: { "request-id": "req_fake_429", "retry-after": "1" } }),
  overloaded: () => errorReply(529, "overloaded_error", "Overloaded"),
  server: () => errorReply(500, "api_error", "Internal server error"),
});

// script: an array consumed one entry per /v1/messages request; each entry is
//   { reply: <message object> } | { error: <errorReply> } | { delayMs, ...either } | { hang: true }
//   | { destroy: true }   (the connection is cut before any reply: the client sees a connection error)
// When the script runs out, `fallback(body)` answers (default: an empty review).
// count_tokens answers `countTokens` (a number, or a function of the body);
// it is free upstream, and never consumes a script step.
export async function startFakeAnthropic({ script = [], fallback, countTokens = 4000 } = {}) {
  const requests = [], counts = [];
  const queue = [...script];
  const hanging = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = { unparsed: raw.slice(0, 200) }; }
      const rec = { method: req.method, path: req.url, headers: { ...req.headers }, body, at: Date.now(), aborted: false };
      // Free token counts are kept apart from the calls that can cost or check.
      (req.url.startsWith("/v1/messages/count_tokens") ? counts : requests).push(rec);
      res.on("close", () => { if (!res.writableEnded) rec.aborted = true; });
      const send = (status, obj, headers = {}) => {
        if (res.destroyed) return;
        const text = JSON.stringify(obj);
        res.writeHead(status, { "content-type": "application/json", "request-id": "req_fake_ok", ...headers });
        res.end(text);
      };
      if (req.method === "GET" && /^\/v1\/models\/[^/?]+/.test(req.url)) {
        const step = queue[0] && queue[0].models ? queue.shift() : null;
        if (step && step.error) return send(step.error.status, step.error.body, step.error.headers);
        const id = decodeURIComponent(req.url.split("/")[3].split("?")[0]);
        return send(200, { type: "model", id, display_name: `${id} (fake)`, created_at: "2026-01-01T00:00:00Z" });
      }
      if (req.method === "POST" && req.url.startsWith("/v1/messages/count_tokens")) {
        const nTok = typeof countTokens === "function" ? countTokens(body) : countTokens;
        if (nTok instanceof Error || (nTok && nTok.status)) return send(nTok.status || 500, nTok.body || { type: "error", error: { type: "api_error", message: "count failed" } });
        return send(200, { input_tokens: nTok });
      }
      if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
        const step = queue.length && !queue[0].models ? queue.shift() : null;
        if (step && step.hang) { hanging.add(res); return; }
        if (step && step.destroy) { req.socket.destroy(); return; }
        if (step && step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
        if (res.destroyed) return;
        if (step && step.error) return send(step.error.status, step.error.body, step.error.headers);
        if (step && step.reply) return send(200, typeof step.reply === "function" ? step.reply(body) : step.reply);
        return send(200, fallback ? fallback(body) : messageReply({ text: JSON.stringify({ planSummary: "", findings: [], regionsToInspect: [] }) }));
      }
      send(404, { type: "error", error: { type: "not_found_error", message: "fake: unknown route" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseURL: `http://127.0.0.1:${port}`,
    requests,
    counts,
    push: (...steps) => queue.push(...steps),
    pending: () => queue.length,
    close: () => new Promise((resolve) => { for (const r of hanging) r.destroy(); server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
