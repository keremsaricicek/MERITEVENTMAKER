// WEB RESEARCH FOR THE F8 ASSISTANT (Mimar) — opt-in, one search per click.
//
// NOT LOADED BY index.html YET. Groundwork: the panel that offers it is being
// rewritten; this module is the one place the privacy rule lives, so the page
// and the relay (server/web-research.mjs) apply the SAME rule.
//
// The rule, structural:
//   OFF BY DEFAULT. The relay has no provider until its operator sets one in the
//     relay's own environment (MERIT_WEB_RESEARCH=on + provider + key); without
//     a key it says so (SEARCH_NO_KEY) and nothing is sent.
//   A PERSON STARTS EACH SEARCH. prepare() shows the exact words that would leave
//     the machine; send() is called from that person's click, with those words,
//     once. Nothing searches by itself, in the background, or on a schedule.
//   NO GUEST DATA LEAVES. Only the person's question goes — never the event, the
//     guest list or the plan. prepare() removes every guest name it is given and
//     every phone number, e-mail address, Turkish ID / IBAN and long digit run;
//     the relay refuses (PRIVATE_DATA) a query that still carries one of those
//     patterns, rather than sending it.
//   WHAT COMES BACK IS SOMEONE ELSE'S TEXT. Titles, links and snippets are plain
//     strings for display as text (never as HTML), marked as from the web, and
//     never written into the event by this module.
(function () {
  "use strict";
  const MAX_QUERY = 200;

  const PATTERNS = [
    ["emails", /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu],
    ["ibans", /\bTR\s?\d{2}(?:\s?[0-9A-Z]{4}){5}\s?[0-9A-Z]{0,2}\b/gi],
    ["phones", /(?:\+|00)?\(?\d[\d\s().-]{8,}\d/g], // counted only with ≥10 digits: +90 532 123 45 67, (0212) 555 44 33 — not a date
    ["numbers", /\d{7,}/g],                              // TC kimlik (11), card, account, any long run
  ];

  const digits = (m) => (m.match(/\d/g) || []).length;
  const counts = (kind, m) => kind !== "phones" || digits(m) >= 10;
  const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/İ/g, "I").replace(/ı/g, "i").toLowerCase();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Which private patterns are still in this text? [] = none. The relay's check.
  function privateDataIn(text) {
    const s = String(text || ""), found = [];
    for (const [kind, re] of PATTERNS) if ((s.match(re) || []).some((m) => counts(kind, m))) found.push(kind);
    return found;
  }

  // The words that would leave the machine, from what the person typed or said.
  // guestNames: every guest name of the open event (and companions' primary
  // names) — each one present is removed, whole words, accent- and case-blind.
  function prepare(question, { guestNames = [] } = {}) {
    let q = String(question || "").replace(/[\u0000-\u001f\u007f]/g, " ");
    const removed = { names: 0, emails: 0, ibans: 0, phones: 0, numbers: 0 };
    for (const [kind, re] of PATTERNS) q = q.replace(re, (m) => { if (!counts(kind, m)) return m; removed[kind]++; return " "; });
    // longest names first, so "Ayşe Nur Kaya" goes before "Ayşe"
    const names = [...new Set(guestNames.map((n) => String(n || "").trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
    if (names.length) {
      const words = q.split(/(\s+)/);
      const folded = words.map(fold);
      for (const name of names) {
        const parts = fold(name).split(/\s+/).filter(Boolean);
        for (const part of parts) {
          if (part.length < 2) continue;
          // a Turkish case ending, with or without the apostrophe ("Yılmaz'ın", "Yılmazın"); on a
          // name part shorter than 4 letters only with the apostrophe ("Can" must not take "Canlı")
          const tail = part.length >= 4 ? "(?:['’]?\\p{L}{1,4})?" : "(?:['’]\\p{L}{1,5})?";
          const re = new RegExp(`^${esc(part)}${tail}[.,;:!?]*$`, "u");
          for (let i = 0; i < words.length; i++) if (folded[i] && re.test(folded[i])) { words[i] = " "; folded[i] = ""; removed.names++; }
        }
      }
      q = words.join("");
    }
    q = q.replace(/(^|\s)[,;:]+(?=\s|$)/g, " ").replace(/\s+([,;:.!?])/g, "$1").replace(/\s+/g, " ").trim();
    if (q.length > MAX_QUERY) q = q.slice(0, MAX_QUERY).replace(/\s+\S*$/, "");
    const anyRemoved = Object.values(removed).some((n) => n > 0);
    return { ok: q.length >= 2, query: q, removed, anyRemoved };
  }

  // One search, started by a person's click, with the words prepare() showed.
  async function send(query, { fetchImpl = (typeof fetch === "function" ? fetch : null), signal } = {}) {
    if (!fetchImpl) return { ok: false, code: "NO_RELAY" };
    const q = String(query || "").trim();
    if (q.length < 2 || q.length > MAX_QUERY) return { ok: false, code: "BAD_QUERY" };
    if (privateDataIn(q).length) return { ok: false, code: "PRIVATE_DATA" };
    let r;
    try {
      r = await fetchImpl("/vlm-relay/search", { method: "POST", headers: { "content-type": "application/json", "x-merit-relay": "1" }, body: JSON.stringify({ query: q }), cache: "no-store", credentials: "same-origin", signal });
    } catch { return { ok: false, code: "NO_RELAY" }; }
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (!j || typeof j !== "object") return { ok: false, code: "NO_RELAY" };
    if (!j.ok) return { ok: false, code: String(j.code || "SEARCH_ERROR") };
    const results = Array.isArray(j.results) ? j.results.slice(0, 5).map((x) => ({ title: String(x.title || ""), url: String(x.url || ""), snippet: String(x.snippet || ""), fromWeb: true })) : [];
    return { ok: true, provider: String(j.provider || ""), results };
  }

  globalThis.MeritWebResearch = { version: 1, MAX_QUERY, privateDataIn, prepare, send };
})();
