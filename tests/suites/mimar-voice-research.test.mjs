// Mimar (F8) groundwork: VOICE COMMAND (server/voice-listener.mjs, POST
// /vlm-relay/listen, src/voice-input.js) and OPT-IN WEB RESEARCH
// (server/web-research.mjs, POST /vlm-relay/search, src/web-research.js).
//
// SCRIPTED. No speech engine and no search provider runs here: the engine is a
// shell script that prints a fixed sentence, the provider is a fake fetch. A pass
// proves the plumbing and the privacy rules, NEVER how well anything hears or
// searches (that is training/README.md "Voice command" on real clips). Any
// network request to a non-loopback host during this suite fails it.
//
// What this pins:
//   VOICE — off without a manifest; the engine and model pinned (size, sha256);
//     only a 16 kHz mono 16-bit WAV of 0.3–30 s; the engine run with a stripped
//     environment and the clip deleted after; words back, tags removed; the words
//     never logged; the same doors as every relay POST. The page's recorder makes
//     exactly the WAV the relay accepts, posts it to the same origin, releases the
//     microphone, and returns text — it calls nothing else.
//   RESEARCH — off by default even with a key in the environment; without a key it
//     says so; guest names, phones, e-mails, IDs never leave (removed on the page,
//     refused at the relay); only { query } is sent, to the provider's one host,
//     redirects refused; the key appears in no reply, status or log; results are
//     plain text, at most five, http(s) links only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const meta = { name: "mimar-voice-research", tags: ["assistant", "security", "privacy", "fast"], timeout: 60000 };

const SAID = "Ayşe'yi 5 numaralı masaya oturt";
const KEY = "test-search-key-" + crypto.randomBytes(6).toString("hex");

export default async function run({ checks, repoRoot }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-mimar-"));
  const realFetch = globalThis.fetch, outside = [];
  globalThis.fetch = async (u, init) => {           // the tripwire: loopback only, ever
    const h = new URL(String(u)).hostname;
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(h)) { outside.push(h); throw new Error("network refused in this suite"); }
    return realFetch(u, init);
  };
  try {
    const V = await import(path.join(repoRoot, "server/voice-listener.mjs"));
    const W = await import(path.join(repoRoot, "server/web-research.mjs"));
    const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
    const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
    await import(pathToFileURL(path.join(repoRoot, "src/voice-input.js")).href);
    await import(pathToFileURL(path.join(repoRoot, "src/web-research.js")).href);
    const VI = globalThis.MeritVoiceInput, WR = globalThis.MeritWebResearch;

    // ---- voice: the manifest ------------------------------------------------
    const vdir = path.join(tmp, "voice"); fs.mkdirSync(vdir);
    const seen = path.join(tmp, "engine-saw.txt");
    // the fake engine: proves it got the clip and a stripped environment, then says a fixed sentence
    fs.writeFileSync(path.join(vdir, "whisper-cli"), `#!/bin/sh\nf=""; while [ $# -gt 0 ]; do [ "$1" = "-f" ] && f="$2"; shift; done\n[ -s "$f" ] || exit 3\necho "clip=$f proxy=[$HTTPS_PROXY$HTTP_PROXY] path=[$PATH]" > "${seen}"\necho " ${SAID} [BLANK_AUDIO]"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(vdir, "model.bin"), crypto.randomBytes(2048));
    const pin = (p) => { const b = fs.readFileSync(path.join(vdir, p)); return { path: p, bytes: b.length, sha256: crypto.createHash("sha256").update(b).digest("hex") }; };
    const manifest = { format: V.VOICE_MANIFEST_FORMAT, id: "whisper-test", name: "Fake engine", version: "0", licence: "test", source: "this suite", evidence: "scripted — not a measurement",
      files: [pin("whisper-cli"), pin("model.bin")], serve: { engine: "whisper-cli", model: "model.bin", languages: ["tr", "en"], threads: 2 } };
    const mfile = path.join(vdir, "voice.json");
    fs.writeFileSync(mfile, JSON.stringify(manifest));
    checks.equal(V.listenerFromEnv({}).reasonCode, "VOICE_OFF", "voice is off unless a manifest is named");
    const voice = V.listenerFromEnv({ MERIT_VOICE_MANIFEST: mfile });
    checks.require(voice.configured, "a pinned engine + model configures the listener", voice);
    const altered = { ...manifest, files: [manifest.files[0], { ...manifest.files[1], sha256: "0".repeat(64) }] };
    fs.writeFileSync(path.join(vdir, "bad.json"), JSON.stringify(altered));
    checks.equal(V.readVoiceManifest(path.join(vdir, "bad.json")).code, "VOICE_MODEL_INTEGRITY", "a model that is not the pinned bytes is refused");
    fs.writeFileSync(path.join(vdir, "esc.json"), JSON.stringify({ ...manifest, files: [manifest.files[0], { ...manifest.files[1], path: "../model.bin" }] }));
    checks.equal(V.readVoiceManifest(path.join(vdir, "esc.json")).code, "VOICE_MANIFEST_INVALID", "a file outside the manifest's folder is refused");
    fs.writeFileSync(path.join(vdir, "gone.json"), JSON.stringify({ ...manifest, files: [manifest.files[0], { ...manifest.files[1], path: "missing.bin" }], serve: { ...manifest.serve, model: "missing.bin" } }));
    checks.equal(V.readVoiceManifest(path.join(vdir, "gone.json")).code, "VOICE_MODEL_MISSING", "a missing model file is refused");

    // ---- voice: the page's WAV is the relay's WAV --------------------------------
    const tone = (secs, rate) => Float32Array.from({ length: Math.round(secs * rate) }, (_, i) => 0.3 * Math.sin(i / 10));
    const wav1 = Buffer.from(VI.encodeWav(tone(1, 16000)));
    checks.ok(V.checkWav(wav1).ok && Math.abs(V.checkWav(wav1).seconds - 1) < 1e-6, "the page's encoder makes the one shape the relay accepts", V.checkWav(wav1));
    checks.equal(VI.resample(tone(1, 48000), 48000).length, 16000, "48 kHz → 16 kHz keeps the length in time");
    const stereo = Buffer.from(wav1); stereo.writeUInt16LE(2, 22);
    const cd = Buffer.from(wav1); cd.writeUInt32LE(44100, 24);
    checks.equal([V.checkWav(stereo).code, V.checkWav(cd).code, V.checkWav(Buffer.from(VI.encodeWav(tone(0.1, 16000)))).code, V.checkWav(Buffer.from("RIFFxxxxWAVEjunk".padEnd(64, "x"))).code],
      ["BAD_AUDIO", "BAD_AUDIO", "AUDIO_TOO_SHORT", "BAD_AUDIO"], "stereo, another rate, a too-short clip and a non-WAV are refused");
    checks.equal(V.checkWav(Buffer.from(VI.encodeWav(tone(31, 16000)))).code, "AUDIO_TOO_LONG", "more than 30 s is refused");
    checks.equal(V.cleanTranscript(" [BLANK_AUDIO] (müzik) merhaba‮  dünya *alkış* "), "merhaba dünya", "non-speech tags and control characters are not words");

    // ---- research: the configuration -----------------------------------------
    checks.equal(W.researchFromEnv({}).reasonCode, "SEARCH_OFF", "web research is off by default");
    checks.equal(W.researchFromEnv({ MERIT_SEARCH_PROVIDER: "brave", MERIT_SEARCH_KEY: KEY }).reasonCode, "SEARCH_OFF", "a key in the environment does not turn it on by itself");
    checks.equal(W.researchFromEnv({ MERIT_WEB_RESEARCH: "on", MERIT_SEARCH_PROVIDER: "brave" }).reasonCode, "SEARCH_NO_KEY", "on without a key says so");
    checks.equal(W.researchFromEnv({ MERIT_WEB_RESEARCH: "on", MERIT_SEARCH_PROVIDER: "elsewhere", MERIT_SEARCH_KEY: KEY }).reasonCode, "SEARCH_NO_PROVIDER", "an unknown provider is not guessed");
    const research = W.researchFromEnv({ MERIT_WEB_RESEARCH: "on", MERIT_SEARCH_PROVIDER: "tavily", MERIT_SEARCH_KEY: KEY, MERIT_SEARCH_MAX_PER_DAY: "3" });
    checks.require(research.configured && research.maxPerDay === 3, "on + provider + key configures it", { ...research, key: "(hidden)" });
    checks.ok(!JSON.stringify(W.publicStatus(research)).includes(KEY), "the public status never carries the key");

    // ---- research: the page's rule --------------------------------------------
    const prep = WR.prepare("Ayşe Yılmaz'ın masası için Harbiye Açıkhava 12.11.2026 kapasitesi? +90 532 123 45 67 ayse@ornek.com TC 12345678901", { guestNames: ["Ayşe Yılmaz", "Can Ak"] });
    checks.ok(prep.ok && !/ayşe|yılmaz|532|ornek|12345678901/i.test(prep.query) && /Harbiye Açıkhava 12\.11\.2026 kapasitesi/.test(prep.query), "guest names, phone, e-mail and ID are removed; the question and its date stay", prep);
    checks.equal(WR.privateDataIn(prep.query), [], "what prepare() leaves passes the relay's check");
    checks.ok(/canlı müzik/.test(WR.prepare("Can için canlı müzik", { guestNames: ["Can Ak"] }).query), "a short name does not eat an ordinary word");

    // ---- research: the provider, scripted ----------------------------------------
    const sent = [];
    let reply = { status: 200, body: { results: [
      { title: "<b>Harbiye</b> Cemil Topuzlu &amp; Açıkhava", url: "https://example.org/harbiye", content: `<script>x</script>Kapasite bilgisi ${KEY}` },
      { title: "bad link", url: "javascript:alert(1)", content: "dropped" },
      ...Array.from({ length: 6 }, (_, i) => ({ title: `r${i}`, url: `https://example.org/${i}`, content: "s" })),
    ] } };
    const fakeFetch = async (u, init) => { sent.push({ u: String(u), init }); return { ok: reply.status < 300, status: reply.status, json: async () => reply.body }; };
    let clock = Date.UTC(2026, 10, 7, 10);
    const R = W.makeResearcher(research, { fetchImpl: fakeFetch, now: () => clock });
    const r1 = await R.search(prep.query);
    checks.require(r1.ok, "a clean question is searched", r1);
    const req1 = sent[0];
    checks.ok(new URL(req1.u).hostname === "api.tavily.com" && req1.init.redirect === "error" && req1.init.credentials === "omit", "one fixed host, redirects refused, no credentials", req1.u);
    checks.equal(Object.keys(JSON.parse(req1.init.body)).filter((k) => !["max_results", "search_depth", "include_answer", "include_raw_content", "include_images"].includes(k)), ["query"], "the body carries the question and nothing of the event");
    checks.equal(JSON.parse(req1.init.body).query, prep.query, "exactly the words the person was shown");
    checks.ok(req1.init.headers.authorization === `Bearer ${KEY}` && !req1.u.includes(KEY), "the key goes only into the auth header");
    checks.ok(r1.results.length === 5 && r1.results.every((x) => /^https:/.test(x.url)) && r1.results[0].title === "Harbiye Cemil Topuzlu & Açıkhava" && !/script|<|>/.test(r1.results[0].snippet), "≤5 results, http(s) links only, plain text", r1.results[0]);
    checks.ok(!JSON.stringify(r1).includes(KEY), "a provider that echoes the key does not bring it into a reply");
    const n = sent.length;
    checks.equal((await R.search("Ayşe'nin numarası 0532 123 45 67")).code, "PRIVATE_DATA", "a query still carrying a phone is refused");
    checks.equal(sent.length, n, "…and nothing is sent");
    reply = { status: 401, body: { detail: `bad key ${KEY}` } };
    const r401 = await R.search("Zorlu PSM kapasite");
    checks.ok(r401.code === "SEARCH_KEY_REFUSED" && !JSON.stringify(r401).includes(KEY), "a refused key is a code, never the provider's text", r401);
    await R.search("Zorlu PSM kapasite");          // the third sent today
    checks.equal((await R.search("Zorlu PSM kapasite")).code, "DAY_LIMIT", "the day's cap holds (3 sent; a refused one was not counted)");
    clock += 24 * 3600 * 1000; reply = { status: 200, body: { web: { results: [] } } };
    const brave = W.makeResearcher({ ...research, provider: "brave" }, { fetchImpl: fakeFetch, now: () => clock });
    await brave.search("İstanbul düğün mekanları");
    const bu = new URL(sent.at(-1).u);
    checks.ok(bu.hostname === "api.search.brave.com" && bu.searchParams.get("q") === "İstanbul düğün mekanları" && sent.at(-1).init.headers["x-subscription-token"] === KEY, "Brave: the question in q, the key in its header", bu.href);

    // ---- the relay: both doors ---------------------------------------------------
    const lines = [], log = { log: (l) => lines.push(String(l)), error: (l) => lines.push(String(l)) };
    const tmpRoot = path.join(tmp, "clips"); fs.mkdirSync(tmpRoot);
    const config = core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "relay"), PORT: "0" }, { repoRoot });
    const relay = await startRelay({ config, client: null, log, voice, listenerImpl: V.makeListener(voice, { tmpRoot }), research, researcherImpl: W.makeResearcher(research, { fetchImpl: fakeFetch }) });
    const off = await startRelay({ config: core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "relay-off"), PORT: "0" }, { repoRoot }), client: null, log });
    const post = (base, p, body, headers) => new Promise((resolve) => {
      const u = new URL(base + p);
      const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers: { "content-length": body.length, ...headers } }, (res) => {
        const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => { let j = null; try { j = JSON.parse(Buffer.concat(c).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, j }); });
      });
      rq.end(body);
    });
    const AH = { "content-type": "audio/wav", "x-merit-relay": "1" }, JH = { "content-type": "application/json", "x-merit-relay": "1" };
    try {
      reply = { status: 200, body: { results: [{ title: "t", url: "https://example.org/", content: "c" }] } };
      const l1 = await post(relay.baseUrl, "/vlm-relay/listen?lang=tr", wav1, AH);
      checks.ok(l1.status === 200 && l1.j.text === SAID, "a clip comes back as its words, tags removed", l1);
      const saw = fs.readFileSync(seen, "utf8");
      checks.ok(/proxy=\[\]/.test(saw) && /path=\[\]/.test(saw), "the engine runs with a stripped environment (no proxy, no PATH)", saw);
      checks.equal(fs.readdirSync(tmpRoot), [], "the clip is deleted after it is heard");
      checks.equal((await post(relay.baseUrl, "/vlm-relay/listen?lang=de", wav1, AH)).j.code, "BAD_LANGUAGE", "only the pinned languages");
      checks.equal((await post(relay.baseUrl, "/vlm-relay/listen?lang=tr", wav1, { ...AH, "x-merit-relay": "0" })).status, 403, "the relay's cross-site door holds for voice");
      checks.equal((await post(relay.baseUrl, "/vlm-relay/listen?lang=tr", wav1, { ...JH })).j.code, "BAD_PAYLOAD", "only audio/wav");
      checks.equal((await post(relay.baseUrl, "/vlm-relay/listen?lang=tr", Buffer.alloc(V.MAX_BYTES + 10), AH)).status, 413, "an oversized clip is refused before it is read");
      checks.equal((await post(off.baseUrl, "/vlm-relay/listen?lang=tr", wav1, AH)).j.code, "VOICE_OFF", "a relay without a manifest does not listen");

      const s1 = await post(relay.baseUrl, "/vlm-relay/search", Buffer.from(JSON.stringify({ query: "Harbiye Açıkhava kapasitesi" })), JH);
      checks.ok(s1.status === 200 && s1.j.results.length === 1 && s1.j.provider === "tavily", "a search through the relay", s1);
      checks.equal((await post(relay.baseUrl, "/vlm-relay/search", Buffer.from(JSON.stringify({ query: "x y", event: { guests: [] } })), JH)).j.code, "UNKNOWN_FIELD", "only { query } — no room to send the event");
      checks.equal((await post(relay.baseUrl, "/vlm-relay/search", Buffer.from(JSON.stringify({ query: "mail ayse@ornek.com" })), JH)).j.code, "PRIVATE_DATA", "the relay refuses private data the page missed");
      checks.equal((await post(off.baseUrl, "/vlm-relay/search", Buffer.from(JSON.stringify({ query: "Harbiye" })), JH)).j.code, "SEARCH_OFF", "a relay started without it does not search");
      const status = await realFetch(relay.baseUrl + "/vlm-relay/status").then((r) => r.text());
      const st = JSON.parse(status);
      checks.ok(st.voice.configured && st.research.configured && st.research.provider === "tavily" && !status.includes(KEY) && !status.includes(vdir), "status names both, without the key or a file path", st.research);
      const all = lines.join("\n");
      checks.ok(!all.includes(KEY) && !/Ayşe|numaralı|Harbiye|ornek/.test(all), "the log carries outcomes only: no words heard, no question, no key", lines);
    } finally { await relay.close(); await off.close(); }

    // ---- the page's recorder, with a fake browser --------------------------------------
    let stoppedTracks = 0, posted = null;
    class FakeRec { constructor() { this.state = "inactive"; } start() { this.state = "recording"; } stop() { this.state = "inactive"; this.ondataavailable({ data: { size: 3, type: "audio/webm" } }); this.onstop(); } }
    const fakeBuffer = { duration: 1, sampleRate: 48000, numberOfChannels: 2, length: 48000, getChannelData: () => tone(1, 48000) };
    const env = {
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stoppedTracks++ }] }) } },
      MediaRecorder: FakeRec, AudioContext: class { async decodeAudioData() { return fakeBuffer; } close() {} },
      Blob: class { constructor(parts, o) { this.type = o.type; } async arrayBuffer() { return new ArrayBuffer(3); } },
      fetch: async (u, init) => { posted = { u, init }; return { json: async () => ({ ok: true, text: SAID }) }; },
    };
    const rec = VI.createRecorder({ lang: "tr", env });
    checks.ok((await rec.start()).ok && rec.state === "recording", "the recorder starts on request");
    const out = await rec.stop();
    checks.ok(out.ok && out.text === SAID, "stop returns the words — and only returns them", out);
    checks.ok(posted && posted.u === "/vlm-relay/listen?lang=tr" && posted.init.headers["content-type"] === "audio/wav" && V.checkWav(Buffer.from(posted.init.body)).ok, "it posts the relay's WAV shape to the same origin", posted && posted.u);
    checks.ok(stoppedTracks === 1 && rec.state === "idle", "the microphone is released after the clip");
    const denied = VI.createRecorder({ env: { ...env, navigator: { mediaDevices: { getUserMedia: async () => { const e = new Error("no"); e.name = "NotAllowedError"; throw e; } } } } });
    checks.equal((await denied.start()).code, "MIC_DENIED", "a refused microphone is said, not retried");
    checks.equal(outside, [], "no request left this machine during the suite");
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
