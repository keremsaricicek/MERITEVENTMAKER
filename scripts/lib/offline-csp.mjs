// THE OFFLINE PACKAGES' CONTENT-SECURITY-POLICY.
//
// Both offline builds inline their scripts and their stylesheet, so their
// policy cannot be index.html's (which allows 'self' and the CDN). Each inline
// block is allowed by the SHA-256 of its exact text and nothing else: no
// 'unsafe-inline' for script, no eval. A script the build did not write — or
// one changed after it was hashed — does not run.
//
// Build each block's text ONCE, hash it here, and insert that same string:
// a hash of anything else is a policy that blocks the package's own code
// (verify-offline-package opens both packages and fails on any violation).
import crypto from "node:crypto";

const hash = (text) => `'sha256-${crypto.createHash("sha256").update(text, "utf8").digest("base64")}'`;

export function offlineCspMeta({ scripts, styles, scriptSelf = false }) {
  const policy = [
    "default-src 'none'",
    // blob: — opened from disk, PDF.js cannot start its module worker and
    // falls back to importing the worker code from a blob: URL the page made
    // itself. A blob: script can only be created by code already running
    // here, so it opens no path for content to become script.
    `script-src ${scriptSelf ? "'self' " : ""}${scripts.map(hash).join(" ")} blob: 'wasm-unsafe-eval'`,
    "worker-src blob:",
    "connect-src data: blob:",
    "img-src 'self' data: blob:",
    `style-src ${styles.map(hash).join(" ")}`,
    "style-src-attr 'unsafe-inline'",
    "font-src data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}
