// MERIT Event Maker — when Mimar (F8) asks the second reader, and what it says
// about it (MeritAssistantSecondReader).
//
// The second reader is the pinned chat model on THIS machine
// (tools/local-chat/manifests/*.json, served by llama-server, reached only
// through the relay's POST /vlm-relay/read — server/assistant-reader.mjs checks
// that the running process is the measured one before every reading). This
// module holds the panel's policy around it, and nothing else:
//
//   RULES FIRST. The rules (src/assistant-parse.js) answer first. Only where
//     they are unsure — they read nothing ("unknown") — is the sentence sent to
//     the model. A sentence the rules read never leaves the page.
//   A READING IS A PROPOSAL. Whatever the model read is SHOWN first and waits
//     for the operator's Uygula, however sure the model is; Uygula carries it
//     out through the app's writers as ONE undo (Geri al). The only change made
//     without Uygula is a door check-in the RULES read (a plain statement).
//   HONEST WHEN MISSING. No relay, no pinned model, a model that does not
//     answer or is not the measured server: the panel says which, in words, and
//     keeps working with the rules alone. A missing model is never shown as
//     "did not understand".
//   NOTHING ELSE LEAVES. The request is the sentence only ({ text }), to a
//     same-origin path the local relay serves; never a guest list, an event, a
//     key, or a provider's URL.
//
// Pure: no state, ui, render() or DOM; the shell hands it what it needs.
(function () {
  "use strict";

  const ENDPOINT = "/vlm-relay/read";
  const MAX_TEXT = 400;   // = server/assistant-reader.mjs MAX_TEXT
  // the relay refused because no reader is set up on this machine
  const OFF_CODES = Object.freeze(["CHAT_OFF", "CHAT_NO_URL", "CHAT_NOT_LOOPBACK", "CHAT_NOT_PINNED", "CHAT_MANIFEST_INVALID", "CHAT_MODEL_MISSING", "CHAT_MODEL_INTEGRITY"]);

  // Are the rules unsure, so the model is asked?
  function needsModel(rules) {
    return !!rules && rules.kind === "unknown";
  }

  // The one request body: the sentence, trimmed; null when there is nothing to send.
  function request(text) {
    const s = typeof text === "string" ? text.trim() : "";
    if (!s || s.length > MAX_TEXT) return null;
    return { text: s };
  }

  const missing = (why, code) => ({ state: "missing", why, code: code || null });

  // What the relay's reply means for the panel.
  //   reply: { relay: false }               no relay serves this page
  //          { error: name }                the request did not complete
  //          { http: status, body: json }   the relay answered
  // → { state: "reading", reading, sure } | { state: "none" } | { state: "missing", why: "norelay"|"off"|"down", code }
  function outcome(reply) {
    if (!reply || reply.relay === false) return missing("norelay", null);
    if (reply.error) return missing("down", "CHAT_NOT_RUNNING");
    const b = reply.body && typeof reply.body === "object" ? reply.body : null;
    if (reply.http === 404 || reply.http === 405) return missing("norelay", null);
    if (reply.http === 200 && b && b.ok === true) {
      return b.reading && typeof b.reading === "object" ? { state: "reading", reading: b.reading, sure: !!b.sure } : { state: "none" };
    }
    const code = b && typeof b.code === "string" ? b.code : "HTTP_" + reply.http;
    if (OFF_CODES.indexOf(code) >= 0) return missing("off", code);
    // BUSY, a mismatched or silent process, a timeout: there is a model, it did not read now
    return missing("down", code);
  }

  // The relay's GET /vlm-relay/status, read for the panel's head:
  // → { state: "on", name } | { state: "missing", why, code }
  function fromStatus(relayHere, status) {
    if (!relayHere || !status || status.ok !== true) return missing("norelay", null);
    const r = status.reader;
    if (!r || r.configured !== true) return missing("off", (r && r.reasonCode) || "CHAT_OFF");
    if (r.serving && r.serving !== "verified") return missing("down", r.serving);
    return { state: "on", name: typeof r.name === "string" ? r.name : null };
  }

  // Must this change be shown first and wait for Uygula?
  function mustShow(plan, byModel) {
    if (byModel) return true;
    return !(Array.isArray(plan) && plan.length && plan.every((st) => st && st.op === "arrive"));
  }

  // The words for a missing model: an i18n key and its values.
  function notice(o) {
    if (!o || o.state !== "missing") return null;
    if (o.why === "norelay") return { key: "assistant.modelNoRelay", params: {} };
    if (o.why === "off") return { key: "assistant.modelOff", params: { code: o.code || "" } };
    return { key: "assistant.modelDown", params: { code: o.code || "" } };
  }

  globalThis.MeritAssistantSecondReader = Object.freeze({ ENDPOINT, MAX_TEXT, OFF_CODES, needsModel, request, outcome, fromStatus, mustShow, notice });
})();
