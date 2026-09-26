// The assertion collector and page setup every suite shares.
//
// Deliberately tiny: no test framework, no matchers library, no watch mode.
// The value here is that a failing check prints what it actually saw, and that
// the process exit code is trustworthy -- the scratchpad originals mostly
// printed and exited 0 whatever happened, which meant a red run looked exactly
// like a green one to anything except a human reading the scrollback.

export class Checks {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.passed = 0;
    this.failures = [];
    this.lines = [];
  }

  ok(condition, label, detail) {
    if (condition) {
      this.passed++;
      this.lines.push({ status: "ok", label });
    } else {
      const shown = detail === undefined ? "" : " :: " + safeJson(detail);
      this.failures.push(label + shown);
      this.lines.push({ status: "fail", label, detail: shown });
    }
    return !!condition;
  }

  equal(actual, expected, label) {
    return this.ok(
      Object.is(actual, expected) || safeJson(actual) === safeJson(expected),
      label,
      { expected, actual }
    );
  }

  // For a condition that must hold for the rest of the suite to mean anything
  // (the app booted, the event was created). Stops the suite instead of
  // letting fifty downstream checks fail for one upstream reason.
  require(condition, label, detail) {
    if (!this.ok(condition, label, detail)) {
      throw new SuiteAborted(label + (detail === undefined ? "" : " :: " + safeJson(detail)));
    }
  }
}

export class SuiteAborted extends Error {}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Console and page errors are a result, not decoration: the project's QA rule
// is that every pass checks the browser console.
//
// The filtering is deliberately narrow. Only a *network* failure for a URL the
// app did not serve itself is dropped, because a sandbox with no outbound
// access is an environment fact rather than a defect. A failed request for a
// same-origin file -- a missing src/*.js, a 404 on a stylesheet -- is exactly
// the breakage this project has shipped before and is always reported.
export function watchForErrors(page, { baseUrl } = {}) {
  const errors = [];
  const isForeign = url => !!baseUrl && !!url && !url.startsWith(baseUrl);

  page.on("pageerror", err => errors.push("pageerror: " + err.message));
  page.on("requestfailed", req => {
    if (isForeign(req.url())) return;
    errors.push(`request failed: ${req.url()} (${req.failure()?.errorText || "unknown"})`);
  });
  page.on("response", res => {
    if (res.status() < 400 || isForeign(res.url())) return;
    errors.push(`http ${res.status()}: ${res.url()}`);
  });
  page.on("console", msg => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Chromium logs one of these per failed subresource; the requestfailed and
    // response listeners above already decide whether that failure matters.
    if (/Failed to load resource/i.test(text)) return;
    if (/net::ERR_/i.test(text) && isForeign(msg.location()?.url)) return;
    errors.push("console: " + text);
  });
  return errors;
}
