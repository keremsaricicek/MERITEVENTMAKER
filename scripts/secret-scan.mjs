// NO CREDENTIAL IN THE TREE.
//
// The product's one secret is the vision-language API key, and it lives only
// in the relay's process environment (`.claude/rules/ai.md`). This scans every
// file git tracks (or, with --all, every file under the root that git would
// not ignore) for the shapes real credentials have, and exits 1 on any.
//
//   node scripts/secret-scan.mjs            # tracked files; exit 1 on a finding
//   node scripts/secret-scan.mjs --json     # the result as JSON
//
// The shapes are the providers' own formats, with the full length a real key
// has: the test suites' fake keys (`sk-ant-relaytest-fake-0123…`) are short on
// purpose and are not credentials. A finding prints the file, line and kind,
// and never the value — a scanner that echoes what it found leaks it into the
// CI log it was meant to protect.
//
// A deliberate exception would go in ALLOW below with its reason; there is
// none.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PATTERNS = [
  { kind: "Anthropic API key", re: /sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/g },
  { kind: "OpenAI API key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20}T3BlbkFJ[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{80,}/g },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{70,}/g },
  { kind: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{20,}/g },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { kind: "Stripe live key", re: /\b[rs]k_live_[A-Za-z0-9]{24,}/g },
  // An env-style assignment of the relay's key with a real-looking value.
  { kind: "API key assignment", re: /\bANTHROPIC_API_KEY\s*=\s*["']?(?!sk-ant-[a-z]+-(?:fake|test))[A-Za-z0-9_-]{40,}/g },
];

// { file, kind, why } — a reviewed exception. None today.
export const ALLOW = [];

const MAX_BYTES = 25 * 1024 * 1024;

export function scanText(text, file = "<text>") {
  const out = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (ALLOW.some((a) => a.file === file && a.kind === kind)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      out.push({ file, line, kind, length: m[0].length });
    }
  }
  return out;
}

export function trackedFiles(root) {
  const raw = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return raw.toString("utf8").split("\0").filter(Boolean);
}

export function scanTree(root, files = trackedFiles(root)) {
  const findings = [], skipped = [];
  let scanned = 0;
  for (const rel of files) {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { continue; } // listed but deleted in the working tree
    if (!st.isFile()) continue;
    // A tracked env file is a finding by itself, whatever it holds.
    if (/(^|\/)\.env(\.[\w-]+)?$/.test(rel) && !/\.env\.(example|sample|template)$/.test(rel)) findings.push({ file: rel, line: 0, kind: "tracked .env file", length: 0 });
    if (st.size > MAX_BYTES) { skipped.push({ file: rel, why: `larger than ${MAX_BYTES / 1048576} MB` }); continue; }
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8192).includes(0)) continue; // binary: images, model weights, workbooks
    scanned++;
    findings.push(...scanText(buf.toString("utf8"), rel));
  }
  return { scanned, findings, skipped };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = scanTree(root);
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`secret scan: ${result.scanned} text files scanned, ${result.findings.length} finding(s), ${result.skipped.length} skipped as too large`);
    for (const f of result.findings) console.log(`  FOUND ${f.kind} at ${f.file}:${f.line} (${f.length} characters; value not printed)`);
    for (const s of result.skipped) console.log(`  skipped ${s.file}: ${s.why}`);
  }
  process.exit(result.findings.length ? 1 : 0);
}
