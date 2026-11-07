// Scores src/help-topics.js match() on training/help/howto-test.jsonl (held out).
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
for (const f of ["assistant-tools.js", "help-topics.js"]) await import(pathToFileURL(path.join(root, "src", f)).href);
const H = globalThis.MeritHelpTopics, rows = fs.readFileSync(path.join(root, "training/help/howto-test.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const by = {}, miss = [];
for (const r of rows) { const m = H.match(r.q), ok = !!m && m.topic.id === r.topic; (by[r.lang] ||= { n: 0, right: 0 }).n++; if (ok) by[r.lang].right++; else miss.push([r.lang, r.topic, r.q, m ? m.topic.id : null]); }
for (const k in by) by[k].rate = +(by[k].right / by[k].n).toFixed(3);
console.log(JSON.stringify(by)); if (process.argv.includes("--misses")) for (const m of miss) console.log(m.join(" | "));
