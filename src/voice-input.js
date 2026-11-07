// VOICE COMMAND FOR THE F8 ASSISTANT (Mimar) — speech to text, on this machine.
//
// NOT LOADED BY index.html YET. Groundwork: the assistant panel that will hold
// the microphone button is being rewritten; this module records and transcribes,
// and touches nothing else.
//
//   const rec = MeritVoiceInput.createRecorder({ lang: "tr" });
//   await rec.start();               // a person pressed the button: the browser asks for the microphone
//   const r = await rec.stop();      // { ok:true, text } → put text INTO THE BOX; the person presses Enter
//
// The rules, structural:
//   WORDS INTO THE BOX, NOTHING ELSE. The module returns text. It never sends a
//     command, never calls the assistant, never changes the event: the person
//     reads what was heard and decides, so a misheard word costs a re-say.
//   THIS MACHINE ONLY. The clip goes to the relay that served the page
//     (POST /vlm-relay/listen, same origin), which runs a pinned local engine
//     (server/voice-listener.mjs). No speech service, no network.
//   NOTHING KEPT. The recording lives in memory until it is sent, the microphone
//     is released at stop/cancel, and nothing is written to storage.
//   ONE SHAPE. 16 kHz mono 16-bit WAV, at most 30 s (the relay refuses anything else).
(function () {
  "use strict";
  const RATE = 16000, MAX_SECONDS = 30;

  // Float samples (any rate, one channel) → 16 kHz. Box-average when shrinking
  // (a cheap low-pass), linear when growing. Pure; the browser path prefers
  // OfflineAudioContext when it exists.
  function resample(samples, fromRate, toRate = RATE) {
    if (fromRate === toRate) return Float32Array.from(samples);
    const n = Math.max(1, Math.round(samples.length * toRate / fromRate)), out = new Float32Array(n), ratio = fromRate / toRate;
    for (let i = 0; i < n; i++) {
      if (ratio > 1) {
        const a = Math.floor(i * ratio), b = Math.min(samples.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
        let s = 0; for (let k = a; k < b; k++) s += samples[k]; out[i] = s / (b - a);
      } else {
        const x = i * ratio, a = Math.floor(x), b = Math.min(samples.length - 1, a + 1), f = x - a;
        out[i] = samples[a] * (1 - f) + samples[b] * f;
      }
    }
    return out;
  }

  // Mono float samples → a RIFF/WAVE PCM 16-bit file (ArrayBuffer).
  function encodeWav(samples, rate = RATE) {
    const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
    const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    text(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
    text(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    text(36, "data"); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i] || 0)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return buf;
  }

  // One decoded AudioBuffer → 16 kHz mono float samples.
  async function toMono16k(audioBuffer, OfflineCtx) {
    const secs = Math.min(audioBuffer.duration, MAX_SECONDS);
    if (OfflineCtx) {
      try {
        const ctx = new OfflineCtx(1, Math.max(1, Math.ceil(secs * RATE)), RATE);
        const src = ctx.createBufferSource(); src.buffer = audioBuffer; src.connect(ctx.destination); src.start();
        return (await ctx.startRendering()).getChannelData(0);
      } catch { /* the pure path below */ }
    }
    const ch = audioBuffer.numberOfChannels, len = Math.min(audioBuffer.length, Math.ceil(secs * audioBuffer.sampleRate)), mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) { const d = audioBuffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
    return resample(mono, audioBuffer.sampleRate, RATE);
  }

  // The clip to the relay; { ok, text } or { ok:false, code }.
  async function transcribe(wav, lang, { fetchImpl = (typeof fetch === "function" ? fetch : null), signal } = {}) {
    if (!fetchImpl) return { ok: false, code: "NO_RELAY" };
    if (lang !== "tr" && lang !== "en") return { ok: false, code: "BAD_LANGUAGE" };
    let r;
    try { r = await fetchImpl("/vlm-relay/listen?lang=" + lang, { method: "POST", headers: { "content-type": "audio/wav", "x-merit-relay": "1" }, body: wav, cache: "no-store", credentials: "same-origin", signal }); }
    catch { return { ok: false, code: "NO_RELAY" }; }
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (!j || typeof j !== "object") return { ok: false, code: "NO_RELAY" };
    return j.ok && typeof j.text === "string" ? { ok: true, text: j.text } : { ok: false, code: String(j.code || "VOICE_ERROR") };
  }

  // A recorder for one utterance at a time. Every browser object is injectable for tests.
  function createRecorder({ lang = "tr", maxSeconds = MAX_SECONDS, env = globalThis, fetchImpl } = {}) {
    const media = env.navigator && env.navigator.mediaDevices, Recorder = env.MediaRecorder;
    const Ctx = env.AudioContext || env.webkitAudioContext, OfflineCtx = env.OfflineAudioContext || env.webkitOfflineAudioContext;
    let stream = null, rec = null, chunks = [], timer = null, state = "idle", stopped = null;
    const release = () => { if (timer) clearTimeout(timer); timer = null; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };

    async function start() {
      if (state !== "idle") return { ok: false, code: "BUSY" };
      if (!media || typeof media.getUserMedia !== "function" || !Recorder || !Ctx) return { ok: false, code: "MIC_UNSUPPORTED" };
      try { stream = await media.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
      catch (e) { return { ok: false, code: e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "MIC_DENIED" : "MIC_MISSING" }; }
      chunks = []; rec = new Recorder(stream);
      stopped = new Promise((resolve) => { rec.onstop = resolve; });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start();
      state = "recording";
      timer = setTimeout(() => { if (state === "recording") rec.stop(); }, maxSeconds * 1000);
      return { ok: true };
    }

    async function stop({ signal } = {}) {
      if (state !== "recording") return { ok: false, code: "NOT_RECORDING" };
      state = "working";
      try {
        if (rec.state !== "inactive") rec.stop();
        await stopped;
        release();
        const blob = new env.Blob(chunks, { type: chunks[0] && chunks[0].type || "audio/webm" });
        chunks = [];
        const ctx = new Ctx();
        let decoded;
        try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); } catch { return { ok: false, code: "BAD_AUDIO" }; } finally { ctx.close && ctx.close(); }
        const wav = encodeWav(await toMono16k(decoded, OfflineCtx), RATE);
        return await transcribe(wav, lang, { fetchImpl: fetchImpl || (typeof env.fetch === "function" ? env.fetch.bind(env) : null), signal });
      } finally { release(); state = "idle"; }
    }

    function cancel() { if (rec && rec.state !== "inactive") { rec.onstop = null; try { rec.stop(); } catch { /* already */ } } chunks = []; release(); state = "idle"; }

    return { start, stop, cancel, get state() { return state; } };
  }

  globalThis.MeritVoiceInput = { version: 1, RATE, MAX_SECONDS, resample, encodeWav, toMono16k, transcribe, createRecorder };
})();
