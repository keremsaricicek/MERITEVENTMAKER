// A small, honest JavaScript scanner for structural tests.
//
// Several code-health suites need to ask "does this file REALLY reference X
// in code?" — and grep cannot answer that, because this codebase is full of
// comments and strings that legitimately mention the very identifiers the
// rules forbid. `seating-freeze.js` says "that is its resting state" in a
// comment; `table-availability.js` says "neither reads the other's state".
// A grep-based rule fires on those, gets called noisy, and gets disabled —
// which is worse than having no rule.
//
// So: strip comments and string/template/regex literals first, then search
// what is left. This is a character scanner, not a parser. It is chosen
// deliberately over a real AST because the repo has no parser dependency and
// adding one to run a lint rule would be a build-step decision, which the
// project forbids without approval.
//
// WHAT IT HANDLES: line comments, block comments, '…', "…", `…` including
// ${} interpolation (whose contents are kept, because code inside a template
// IS code), NESTED templates to any depth, and regex literals distinguished
// from division by the preceding significant token.
//
// Nesting is not a nicety here. This codebase builds its markup from
// templates inside templates — `${rows.map(r => `<li>${esc(label(r))}</li>`)}`
// is the ordinary shape of a render function. A first version of this file
// blanked the inner backtick as if it opened a plain string, which erased
// the `esc(label(r))` call with it. Measured against app-v8.js that made
// FOURTEEN live functions look like they had no caller at all — every one of
// them reachable, every one of them only ever called from inside a nested
// template. A scanner that silently loses code is worse than grep, because
// grep is not believed. So the template handling is a real stack.
//
// WHAT IT DOES NOT: it does not understand ASI edge cases well enough to be
// a linter, and a pathological regex/division ambiguity could mis-slice. It
// preserves newlines so reported line numbers stay true, and every consumer
// reports file + line so a human can check the claim. Treat a finding as a
// pointer to look, not as proof on its own.

const RE_ALLOWED_BEFORE = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";",
  "+", "-", "*", "%", "<", ">", "~", "^",
]);
const RE_ALLOWED_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await",
]);

/**
 * Replace every comment and string/regex literal with spaces, preserving
 * newlines and total length so line/column numbers stay accurate.
 */
export function stripCommentsAndStrings(source) {
  const out = new Array(source.length);
  for (let i = 0; i < source.length; i++) out[i] = source[i];

  const blank = (from, to, keepNewlines = true) => {
    for (let i = from; i < to && i < source.length; i++) {
      out[i] = keepNewlines && source[i] === "\n" ? "\n" : " ";
    }
  };

  // The last significant (non-space, non-comment) character emitted so far,
  // plus the word before it — together these decide regex vs division.
  let lastSignificant = "";
  let lastWord = "";

  // Template nesting. Each entry is either a template's literal text or an
  // open ${…} interpolation with its brace depth.
  const stack = [];

  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    const top = stack[stack.length - 1];

    // ---- inside a template's literal text ---------------------------------
    // Handled FIRST, because in here a backtick closes rather than opens and
    // a // is two slashes of text, not a comment.
    if (top && top.kind === "template") {
      if (c === "\\") { blank(i, i + 2); i += 2; continue; }
      if (c === "`") {
        blank(i, i + 1);
        stack.pop();
        lastSignificant = "`";
        lastWord = "";
        i++;
        continue;
      }
      if (c === "$" && next === "{") {
        blank(i, i + 2);
        stack.push({ kind: "interp", depth: 1 });
        lastSignificant = "{";
        lastWord = "";
        i += 2;
        continue;
      }
      blank(i, i + 1);
      i++;
      continue;
    }

    // ---- inside a ${…} interpolation: ordinary code, braces counted -------
    // Only the brace bookkeeping happens here; everything else falls through
    // to the normal rules below, which is the whole point of the stack.
    if (top && top.kind === "interp") {
      if (c === "{") top.depth++;
      else if (c === "}") {
        top.depth--;
        if (top.depth === 0) {
          blank(i, i + 1);
          stack.pop();
          lastSignificant = "`";
          lastWord = "";
          i++;
          continue;
        }
      }
    }

    // ---- line comment -----------------------------------------------------
    if (c === "/" && next === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }

    // ---- block comment ----------------------------------------------------
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < source.length && !(source[j] === "*" && source[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, source.length));
      i = j + 2;
      continue;
    }

    // ---- quoted strings ---------------------------------------------------
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === c) break;
        if (source[j] === "\n") break;          // unterminated; stop at EOL
        j++;
      }
      blank(i, Math.min(j + 1, source.length));
      lastSignificant = "'";
      lastWord = "";
      i = j + 1;
      continue;
    }

    // ---- template literals (keep ${...} contents: that is real code) ------
    //
    // A stack, not a scan-to-the-matching-quote. Entering `${` returns to
    // ORDINARY CODE handling, so a nested template, string, comment or regex
    // inside an interpolation is processed by the same rules as anything
    // else — to any depth. The alternative (blanking to the next backtick)
    // erases real calls; see the header.
    if (c === "`") {
      blank(i, i + 1);
      stack.push({ kind: "template" });
      lastSignificant = "`";
      lastWord = "";
      i++;
      continue;
    }

    // ---- regex literal vs division ---------------------------------------
    if (c === "/") {
      const regexAllowed =
        lastSignificant === "" ||
        RE_ALLOWED_BEFORE.has(lastSignificant) ||
        RE_ALLOWED_KEYWORDS.has(lastWord);
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        let terminated = false;
        while (j < source.length) {
          const d = source[j];
          if (d === "\\") { j += 2; continue; }
          if (d === "\n") break;                 // not a regex after all
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) { terminated = true; break; }
          j++;
        }
        if (terminated) {
          let k = j + 1;
          while (k < source.length && /[a-z]/.test(source[k])) k++;   // flags
          blank(i, k);
          lastSignificant = "/";
          lastWord = "";
          i = k;
          continue;
        }
      }
    }

    // ---- ordinary code ----------------------------------------------------
    if (!/\s/.test(c)) {
      lastSignificant = c;
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
        lastWord = source.slice(i, j);
        for (let k = i; k < j; k++) out[k] = source[k];
        lastSignificant = source[j - 1];
        i = j;
        continue;
      }
      lastWord = "";
    }
    i++;
  }

  return out.join("");
}

/** Every 1-indexed line of `code` matching `re`, as {line, text}. */
export function matchLines(code, re) {
  const found = [];
  code.split("\n").forEach((text, idx) => {
    re.lastIndex = 0;
    if (re.test(text)) found.push({ line: idx + 1, text: text.trim().slice(0, 120) });
  });
  return found;
}
