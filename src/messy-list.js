// A GUEST LIST PASTED FROM ANYWHERE (owner 2026-11-02: "dağınık liste" — WhatsApp, e-mail, notes).
//
// parse(text, existing) reads one guest per line (or per comma when the paste is a
// single line): the name, the party size ("+2", "3 kişi", "eşiyle", "and his wife",
// "ve 2 arkadaşı"), a phone, and a host after " - " ("Ahmet Yılmaz +1 - Kerem").
// Titles (Bey, Hanım, Mr, Dr …) and list marks (1., -, •) come off. Nothing is added
// here: the rows are shown first; the person ticks and adds them through the app's
// own guest writer. A row that looks like a guest already on the list is said so and
// left unticked. Pure: no DOM, no state.
(function () {
  "use strict";
  const T = () => globalThis.MeritAssistantTools;
  const fold = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
  const NUM = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, one: 1, two: 2, three: 3, four: 4, five: 5 };
  const TITLES = /^(bey|beyefendi|hanim|hanimefendi|bay|bayan|sayin|mr|mrs|ms|dr|prof)$/;
  function lineOf(raw) {
    let s = String(raw || "").replace(/^\s*(?:\d+[.)]|[-–•*·])\s*/, "").trim();
    if (!s || !/\p{L}/u.test(s)) return null;
    let phone = null, host = null, pax = 1;
    const ph = s.match(/(?:\+?90\s*)?0?\s*5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/);
    if (ph) { phone = ph[0].replace(/\D+/g, "").replace(/^90/, "").replace(/^(?!0)/, "0"); s = s.replace(ph[0], " "); }
    const hs = s.match(/\s[-–—/]\s+([^\d+()]{2,40})$/) || s.match(/\(\s*(?:davet(?:\s*eden)?|host|junket)\s*:?\s*([^)]+)\)/i);
    if (hs) { host = hs[1].trim(); s = s.replace(hs[0], " "); }
    const f = fold(s);
    let m;
    if ((m = s.match(/\+\s*(\d{1,2})/))) { pax = 1 + Number(m[1]); s = s.replace(m[0], " "); }
    else if ((m = f.match(/\(?\s*(\d{1,2}|bir|iki|uc|dort|bes|alti|one|two|three|four|five)\s*(kisi|kisilik|people|pax|persons?)\s*\)?/))) { pax = Number(m[1]) || NUM[m[1]] || 1; s = s.slice(0, f.indexOf(m[0])) + " " + s.slice(f.indexOf(m[0]) + m[0].length); }
    else if ((m = f.match(/\b(ve|ile|and|with|\+)\s+(\d{1,2}|bir|iki|uc|dort|bes|one|two|three|four)\s+(arkadas\w*|misafir\w*|kisi\w*|friends?|guests?|kids?|cocu\w*)/))) { pax = 1 + (Number(m[2]) || NUM[m[2]] || 1); s = s.slice(0, f.indexOf(m[0])) + " " + s.slice(f.indexOf(m[0]) + m[0].length); }
    else if ((m = f.match(/\s*(?:ve\s+|ile\s+)?(esi(?:yle|ile)?|esi ile|karisi(?:yla)?|kocasi(?:yla)?|and (?:his|her) (?:wife|husband|partner)|with (?:his|her) (?:wife|husband|partner)|\+ ?es)\b/))) { pax = 2; s = s.slice(0, f.indexOf(m[0])) + " " + s.slice(f.indexOf(m[0]) + m[0].length); }
    const name = s.replace(/[()[\]{}:;,.]+/g, " ").split(/\s+/).filter((w) => w && !TITLES.test(fold(w))).join(" ").trim();
    if (!name || /\d/.test(name) || name.split(" ").length > 5) return { raw: String(raw).trim(), problem: "unreadable" };
    return { raw: String(raw).trim(), name, pax: Math.min(pax, 99), phone, host };
  }
  function parse(text, existing) {
    const t = String(text || "").replace(/\r/g, "");
    let parts = t.split("\n");
    if (parts.filter((x) => x.trim()).length === 1 && /,/.test(t)) parts = t.split(",");
    const rows = parts.map(lineOf).filter(Boolean);
    const ex = existing || [];
    for (const r of rows) {
      if (r.problem) continue;
      const hit = ex.find((g) => {
        if (r.phone && g.phone && String(g.phone).replace(/\D+/g, "").endsWith(r.phone.slice(-7))) return true;
        const a = fold(g.name).split(/\s+/), b = fold(r.name).split(/\s+/);
        return a.length === b.length && b.every((w, i) => (T() && T().sameWord ? T().sameWord(w, a[i]) : w === a[i]));
      });
      if (hit) r.duplicateOf = hit.name;
    }
    return rows;
  }
  globalThis.MeritMessyList = Object.freeze({ parse });
})();
