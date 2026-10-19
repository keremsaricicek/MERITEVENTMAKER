// A SCRIPTED stand-in for a vision-language model process on this machine — the
// OpenAI-compatible chat endpoint llama.cpp's llama-server speaks. NOT A MODEL:
// every answer is written by the suite that starts it. A pass against it proves
// the relay's local path (pinning, loopback, translation, checks, failures) and
// never how well any model reads a plan.
//
// script: one entry per POST /v1/chat/completions —
//   { content: "<text>", finish: "stop" | "length" } | { status: 500 } | { delayMs, ...either } | { hang: true }
// When the script runs out, `fallback(body)` answers (default: an empty review).
// serving: what GET /props and GET /lora-adapters report, as llama-server does —
//   { modelPath, nCtx, loras: [{ path, scale }] }; null (the default) answers 404,
//   a process that cannot say what it has loaded. `setServing()` changes it.
import http from "node:http";

export const FAKE_LOCAL_NOTICE = "SCRIPTED by tests/lib/fake-local-vlm.mjs — not a model";

export async function startFakeLocalVlm({ script = [], fallback, models = ["fake-local-vlm"], serving = null } = {}) {
  const requests = [];
  let served = serving;
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
      requests.push(rec);
      res.on("close", () => { if (!res.writableEnded) rec.aborted = true; });
      const send = (status, obj) => { if (res.destroyed) return; const text = JSON.stringify(obj); res.writeHead(status, { "content-type": "application/json" }); res.end(text); };
      if (req.method === "GET" && req.url === "/v1/models") return send(200, { object: "list", data: models.map((id) => ({ id, object: "model" })) });
      if (req.method === "GET" && req.url === "/props") return served ? send(200, { model_path: served.modelPath, default_generation_settings: { n_ctx: served.nCtx }, build_info: "fake" }) : send(404, { error: { message: "not found" } });
      if (req.method === "GET" && req.url === "/lora-adapters") return served ? send(200, (served.loras || []).map((l, id) => ({ id, path: l.path, scale: l.scale }))) : send(404, { error: { message: "not found" } });
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const step = queue.length ? queue.shift() : null;
        if (step && step.hang) { hanging.add(res); return; }
        if (step && step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
        if (step && step.status) return send(step.status, { error: { message: "scripted failure" } });
        const content = step ? step.content : fallback ? fallback(body) : JSON.stringify({ planSummary: "SCRIPTED", findings: [], regionsToInspect: [] });
        return send(200, { id: "chatcmpl-fake", object: "chat.completion", model: body && body.model,
          choices: [{ index: 0, finish_reason: (step && step.finish) || "stop", message: { role: "assistant", content } }],
          usage: { prompt_tokens: 1234, completion_tokens: 321 } });
      }
      send(404, { error: { message: "not found" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { baseURL: `http://127.0.0.1:${port}`, requests, chats: () => requests.filter((r) => r.path === "/v1/chat/completions"), setServing: (s) => { served = s; },
    close: () => new Promise((resolve) => { for (const r of hanging) r.destroy(); server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
