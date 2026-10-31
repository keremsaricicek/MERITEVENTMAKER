// Which source files make up the app, read from index.html rather than
// listed by hand.
//
// Both offline builders used to carry their own copy of the list. It drifted:
// src/plan-relationships.js and src/plan-memory.js were added to index.html
// in the Plan Intelligence 2.0 sprint and never reached either builder, so
// every offline artifact built after that shipped without the relationship
// engine and without plan memory, while both build scripts reported success.
// A hand-maintained mirror of a list that lives somewhere else will drift
// again, so it is not maintained any more: index.html IS the list.
//
// The order matters — these are classic scripts sharing one global scope, and
// app-v8.js reads globals the others define — so document order is preserved
// exactly as the browser would execute it.
import { readFileSync } from "node:fs";
import path from "node:path";

const LOCAL_SRC = /<script\s+src="(src\/[^"]+\.js)"\s*>\s*<\/script>/g;

export function appSourceFiles(root) {
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const files = [];
  for (const m of html.matchAll(LOCAL_SRC)) files.push(m[1]);
  if (!files.length) {
    throw new Error("app-sources: found no local <script src=\"src/...\"> tags in index.html");
  }
  // The entry point has to be last, because everything else is a global it
  // reads on load. If a future edit moves it, the concatenated build would
  // still "succeed" and then throw in the browser, so it is checked here.
  if (files[files.length - 1] !== "src/app-v8.js") {
    throw new Error(`app-sources: expected src/app-v8.js to be the last script in index.html, got ${files[files.length - 1]}`);
  }
  return files;
}

export function readAppSources(root) {
  const files = appSourceFiles(root);
  return {
    files,
    code: files.map((f) => readFileSync(path.join(root, f), "utf8")).join("\n"),
  };
}
