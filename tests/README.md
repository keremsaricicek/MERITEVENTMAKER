# Regression suite

```
npm install          # once — Playwright only; the app itself has no dependencies
npm test             # every fast suite (~2 minutes)
npm run test:all     # including the slow ones (real detection on the real plan)
npm run test:list    # what exists
node tests/run.mjs xlsx storage       # substring filter on suite name
node tests/run.mjs --tag=business     # everything tagged business
```

The runner serves the app itself on an ephemeral port and gives every suite a
fresh browser context, so nothing depends on a server someone remembered to
start, and IndexedDB written by one suite cannot reach the next. Exit code is 1
if any check failed, any suite threw, or any suite saw a page error.

## What is here

| suite | tags | what breaks if it goes red |
|---|---|---|
| `smoke` | business | the app does not boot, or a screen throws |
| `guest-and-seating-rules` | business | pax semantics, chair/capacity sync, the planning-vs-arrival split |
| `historical-immutability` | business | a completed event can be edited |
| `bulk-add-integrity` | business | the Turkish UI writes labels where identifiers belong |
| `undo-operations` | business | one of twelve destructive operations no longer round-trips |
| `live-door-keys` | business | the door keyboard flow checks in the wrong person |
| `xlsx-contract` | business, reports | the exported workbook's sheets, companion seats, or table numbering |
| `storage-provider` | storage | data does not reach IndexedDB, or does not survive a reload |
| `backup-restore` | storage | a bad backup file is accepted, or a good one does not restore |
| `venue-model` | storage | a published layout version is no longer frozen |
| `i18n` | ui | a raw translation key reaches the screen, or a language stops rendering |
| `plan-intelligence-contract` | intelligence, **slow** | the detector fabricates, or its scene graph points at objects that do not exist |
| `chair-families` | intelligence, **slow** | the detector can only describe one kind of chair again, or printed text gets in as the second kind |
| `plan-encoder` | intelligence | the browser forward pass drifts from the trainer's, the encoder's embeddings collapse, a provider hides whether it is a trained model, or shipping one starts implying a domain model is installed |
| `structural-objects` | intelligence, **slow** | a column grid is split by a size-bin edge, a column is thrown out for someone else's chair, or printed text starts being read as a column grid |
| `table-typing` | intelligence, **slow** | a table is typed bistro on its size alone, without evidence, or a plan of uniform tables starts producing bistros |
| `training-data-capture` | intelligence, **slow** | a human decision stops storing a real crop with its provenance, or a capture log starts calling itself a model |

## Environment

Everything is resolved, with the container's values as the last fallback, so
the same files run here and in CI:

| variable | what it overrides |
|---|---|
| `MERIT_PLAYWRIGHT` | module path to Playwright (default: a normal `playwright` import) |
| `MERIT_CHROMIUM` | Chromium executable (default: under `PLAYWRIGHT_BROWSERS_PATH`, else Playwright's own) |
| `MERIT_BASE_URL` | use an already-running server instead of starting one |
| `MERIT_TEST_ARTIFACTS` | where downloaded workbooks and backup fixtures are written |

The two pinned CDN engines (SheetJS, PDF.js) and Tesseract are served from
`.vendor-cache/` when it exists, which `node scripts/build-offline.mjs`
populates. Without it the tests still run wherever there is network, but a
sandbox with no outbound access boots the app with `XLSX` undefined — the
workbook export then produces nothing and looks fine. Run the offline build
once and the whole suite is hermetic.

## Writing a suite

A suite is a file in `suites/` named `*.test.mjs`:

```js
import { openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = { name: "my-suite", tags: ["business", "fast"], timeout: 90000 };

export default async function run({ page, checks, baseUrl, artifactDir, repoRoot }) {
  await openApp(page, baseUrl);
  checks.ok(condition, "what an operator would lose if this were false", detail);
  checks.require(condition, "…");   // aborts the suite instead of cascading
}
```

Add `downloads: true` to `meta` if the suite saves a file, and a `viewport` if
1920×1080 is wrong for it.

Two things this suite learned the hard way, both encoded in `lib/app-actions.mjs`:

- **Drive the real UI.** Nearly every domain function — `canMutate`,
  `setTableCapacity`, the seating logic — lives inside a closure and is not on
  `globalThis`. So do `state` and `ui`: they are top-level `let` bindings, so
  `state.events` works inside `page.evaluate` and `globalThis.state` is
  `undefined` on a perfectly healthy app.
- **Wait on state, never on a sleep.** `render()` rebuilds the screen from
  places a test cannot see, and a synthetic keystroke or fill that lands
  mid-render reaches a detached node. The helpers confirm what they typed
  actually reached `ui`, and read the data back before drawing any conclusion
  from it.
