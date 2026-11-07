// MERIT Event Maker — opt-in web research for the F8 assistant (Mimar), through this relay only.
//
//   MERIT_WEB_RESEARCH=on MERIT_SEARCH_PROVIDER=brave|tavily MERIT_SEARCH_KEY=… npm run serve:vlm
//
// POST /vlm-relay/search { query } → { ok, provider, results: [{ title, url, snippet }] ≤ 5 }.
//
// What is structural, not promised:
//   OFF BY DEFAULT. Three things must all be set in THIS process's environment:
//     MERIT_WEB_RESEARCH=on, a provider this file knows, and that provider's key.
//     Missing any → { configured:false, reasonCode } and nothing is ever sent.
//   THE KEY STAYS HERE. It is read once from the environment and goes only into the
//     provider's auth header: never into status, a reply, a log line or a file.
//     Provider errors come back as codes, never as the provider's text.
//   ONLY THE QUESTION LEAVES. The body is { query } and nothing else; the query is
//     checked with the page's own rule (src/web-research.js privateDataIn) and
//     REFUSED (PRIVATE_DATA) if it still carries a phone, e-mail, ID/IBAN or long
//     number. No event, guest, plan, cookie or referrer is sent; the request goes
//     to the provider's one fixed host, redirects refused.
//   COUNTED. One search at a time; at most MERIT_SEARCH_MAX_PER_DAY (default 30) a
//     day, counted in memory; the provider may charge per search (its plan).
//   NOTHING LOGGED BUT THE OUTCOME. The question may still be personal: logs carry
//     the result count and seconds, never the words.
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import(pathToFileURL(path.join(REPO_ROOT, "src/web-research.js")).href);
export const RULE = globalThis.MeritWebResearch;

export const PROVIDERS = {
  brave: {
    name: "Brave Search API", host: "api.search.brave.com",
    request: (q, key) => ({ url: `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: "5", safesearch: "moderate" })}`,
      init: { method: "GET", headers: { accept: "application/json", "x-subscription-token": key } } }),
    results: (j) => (j && j.web && Array.isArray(j.web.results) ? j.web.results : []).map((r) => ({ title: r.title, url: r.url, snippet: r.description })),
  },
  tavily: {
    name: "Tavily Search API", host: "api.tavily.com",
    request: (q, key) => ({ url: "https://api.tavily.com/search",
      init: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ query: q, max_results: 5, search_depth: "basic", include_answer: false, include_raw_content: false, include_images: false }) } }),
    results: (j) => (j && Array.isArray(j.results) ? j.results : []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
  },
};

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

// The researcher's configuration, or why there is none. Never throws; never returns the key to a caller that prints.
export function researchFromEnv(env) {
  if (String(env.MERIT_WEB_RESEARCH || "").toLowerCase() !== "on") return { configured: false, reasonCode: "SEARCH_OFF" };
  const id = String(env.MERIT_SEARCH_PROVIDER || "").toLowerCase();
  if (!PROVIDERS[id]) return { configured: false, reasonCode: "SEARCH_NO_PROVIDER" };
  const key = String(env.MERIT_SEARCH_KEY || "").trim();
  if (!key) return { configured: false, reasonCode: "SEARCH_NO_KEY", provider: id };
  const max = Number(env.MERIT_SEARCH_MAX_PER_DAY);
  return { configured: true, reasonCode: null, provider: id, maxPerDay: Number.isInteger(max) && max > 0 && max <= 1000 ? max : 30, key };
}

// What /vlm-relay/status may show about it: no key, ever.
export const publicStatus = (cfg, today = 0) => cfg.configured
  ? { configured: true, provider: cfg.provider, providerName: PROVIDERS[cfg.provider].name, maxPerDay: cfg.maxPerDay, today }
  : { configured: false, reasonCode: cfg.reasonCode, ...(cfg.provider ? { provider: cfg.provider } : {}) };

const plain = (s, max) => String(s == null ? "" : s)
  .replace(/<[^>]{0,200}>/g, " ")
  .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " }[e]))
  .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
  .replace(/\s+/g, " ").trim().slice(0, max);
const safeUrl = (u) => { try { const x = new URL(String(u)); return (x.protocol === "https:" || x.protocol === "http:") && !x.username && !x.password && x.href.length <= 500 ? x.href : null; } catch { return null; } };

export function makeResearcher(cfg, { fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15000 } = {}) {
  const p = PROVIDERS[cfg.provider];
  let day = { key: null, n: 0 };
  const today = () => (day.key === dayKey(now()) ? day.n : 0);
  const scrub = (s) => (cfg.key ? String(s).split(cfg.key).join("[redacted]") : String(s));

  async function search(query, { signal } = {}) {
    const q = typeof query === "string" ? query.replace(/\s+/g, " ").trim() : "";
    if (q.length < 2 || q.length > RULE.MAX_QUERY) return { ok: false, code: "BAD_QUERY" };
    if (RULE.privateDataIn(q).length) return { ok: false, code: "PRIVATE_DATA" };
    if (today() >= cfg.maxPerDay) return { ok: false, code: "DAY_LIMIT" };
    const { url, init } = p.request(q, cfg.key);
    if (new URL(url).hostname !== p.host) return { ok: false, code: "SEARCH_ERROR" };
    const k = dayKey(now()); day = { key: k, n: today() + 1 };       // counted when sent, success or not
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      const r = await fetchImpl(url, { ...init, redirect: "error", referrerPolicy: "no-referrer", credentials: "omit", signal: ctrl.signal });
      if (r.status === 401 || r.status === 403) return { ok: false, code: "SEARCH_KEY_REFUSED" };
      if (r.status === 402) return { ok: false, code: "SEARCH_NO_CREDIT" };
      if (r.status === 429) return { ok: false, code: "SEARCH_RATE_LIMITED" };
      if (!r.ok) return { ok: false, code: "SEARCH_ERROR" };
      let j;
      try { j = await r.json(); } catch { return { ok: false, code: "SEARCH_ERROR" }; }
      const results = [];
      for (const x of p.results(j)) {
        const u = safeUrl(x && x.url);
        if (!u) continue;
        results.push({ title: scrub(plain(x.title, 200)), url: scrub(u), snippet: scrub(plain(x.snippet, 400)) });
        if (results.length === 5) break;
      }
      return { ok: true, provider: cfg.provider, results };
    } catch { return { ok: false, code: ctrl.signal.aborted ? "SEARCH_TIMEOUT" : "SEARCH_UNREACHABLE" }; }
    finally { clearTimeout(t); }
  }
  return { search, today };
}
