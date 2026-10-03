// IS THE DETECTOR'S OUTPUT BYTE-FOR-BYTE WHAT IT WAS?
//
// The detection baseline (`benchmarks/BASELINE.json`) compares guarded METRICS
// per plan — recall, precision, F1, typing, association. That is the right
// gate for a change MEANT to alter the detector. A STRUCTURAL change — moving
// a helper group or a stage out of `detect()` (Split A / Split B of
// `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`) — promises something stronger:
// no output change at all. A move that shifted one candidate by a pixel, or
// swapped two candidates' order, can leave every metric equal.
//
// This runs real detection, through the real app and the pinned OCR, on every
// plan the repository has — the six benchmark plans, the nine adversarial
// fixtures and the fifteen robustness variants — and hashes the WHOLE analysis
// per plan: every candidate, every chair, every diagnostic and the plan
// intelligence built on them. Only what cannot be the same twice is removed:
// random ids (renamed in order of first appearance, so references between
// objects still have to agree) and wall-clock timings.
//
//   node benchmarks/detector-fingerprint.mjs --record   # before the move
//   node benchmarks/detector-fingerprint.mjs --compare  # after it; exit 1 on any difference
//
// INFO for CI (a detector change is expected to change it); a RELEASE GATE for
// a structural detector commit, which must report every plan IDENTICAL.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../tests/lib/env.mjs";
import { serveApp } from "../tests/lib/server.mjs";
import { futureDate } from "../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const STORE = path.join(HERE, "reports", "detector-fingerprint.json");
const mode = process.argv.includes("--record") ? "record" : process.argv.includes("--compare") ? "compare" : "print";
const argAt = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = argAt("--only"), DUMP = argAt("--dump");

function plans() {
  const out = [];
  for (const f of fs.readdirSync(path.join(HERE, "annotations")).filter((x) => x.endsWith(".json")).sort()) {
    const a = JSON.parse(fs.readFileSync(path.join(HERE, "annotations", f), "utf8"));
    out.push({ name: f.replace(/\.json$/, ""), file: path.join(HERE, a.source.file) });
  }
  for (const dir of ["adversarial/fixtures", "robustness/variants"])
    for (const f of fs.readdirSync(path.join(HERE, dir)).filter((x) => x.endsWith(".png")).sort())
      out.push({ name: `${dir.split("/")[0]}/${f.replace(/\.png$/, "")}`, file: path.join(HERE, dir, f) });
  return out;
}

// Wall-clock values: every timing ends in Ms and every timestamp in At.
const DROP = /^(at|ms|timings)$|Ms$|At$/;
function normalize(analysis) {
  const ids = new Map();
  const rename = (s) => s.replace(/\b([a-z][a-zA-Z]*)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-z]{6,})\b/g, (m) => {
    if (!ids.has(m)) ids.set(m, `#${ids.size}`);
    return ids.get(m);
  });
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) if (!DROP.test(k)) o[rename(k)] = walk(v[k]);
      return o;
    }
    return typeof v === "string" ? rename(v) : v;
  };
  return walk(analysis);
}

async function detect(browser, baseUrl, file) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  // Randomness is SEEDED, the same way every run: ids are drawn from
  // crypto.randomUUID, and some structures are ordered by id, so with real
  // randomness the same detection serializes in a different order each time
  // (measured: two runs of unchanged code, every plan different). A
  // structural move does not change how many ids are drawn or in what order,
  // so a seeded run is the same run.
  await page.addInitScript(() => {
    let s = 0x9e3779b9;
    const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    Math.random = rnd;
    const hex = () => Math.floor(rnd() * 16).toString(16);
    if (globalThis.crypto) crypto.randomUUID = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, hex);
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Fingerprint");
  await page.fill('input[name="hotel"]', "Fingerprint");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(700);
  const b64 = fs.readFileSync(file).toString("base64");
  await page.evaluate((src) => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, `data:image/png;base64,${b64}`);
  await page.waitForTimeout(400);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 180000 });
  await page.waitForTimeout(400);
  const analysis = await page.evaluate(() => JSON.parse(JSON.stringify(state.events[0].analysis)));
  await page.close();
  return { analysis, errors };
}

const app = await serveApp();
const browser = await launchChromium();
const result = {};
try {
  for (const p of plans().filter((x) => !ONLY || x.name.includes(ONLY))) {
    const { analysis, errors } = await detect(browser, app.baseUrl, p.file);
    const body = JSON.stringify(normalize(analysis));
    const hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
    if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, p.name.replace(/\//g, "__") + ".json"), JSON.stringify(JSON.parse(body), null, 1)); }
    result[p.name] = { hash, candidates: (analysis.candidates || []).length, bytes: body.length, pageErrors: errors.length };
    console.log(`${p.name.padEnd(42)} ${hash}  candidates=${result[p.name].candidates}  pageErrors=${errors.length}`);
  }
} finally {
  await browser.close();
  await app.close();
}

if (mode === "record") {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify({ recordedAt: new Date().toISOString(), plans: result }, null, 2) + "\n");
  console.log(`\nrecorded ${Object.keys(result).length} plans → ${path.relative(ROOT, STORE)}`);
} else if (mode === "compare") {
  const stored = JSON.parse(fs.readFileSync(STORE, "utf8")).plans;
  // With --only, judge the plans that ran; a full run judges every recorded plan.
  const names = ONLY ? Object.keys(result) : [...new Set([...Object.keys(stored), ...Object.keys(result)])];
  const differ = names.filter((n) => !stored[n] || !result[n] || stored[n].hash !== result[n].hash);
  const errored = names.filter((n) => result[n] && result[n].pageErrors);
  console.log(`\n${names.length - differ.length} of ${names.length} plans IDENTICAL to the recorded fingerprint.`);
  for (const n of differ) console.log(`  DIFFERENT  ${n}: ${stored[n]?.hash || "(not recorded)"} → ${result[n]?.hash || "(not run)"}`);
  for (const n of errored) console.log(`  PAGE ERRORS  ${n}: ${result[n].pageErrors}`);
  process.exit(differ.length || errored.length ? 1 : 0);
}
