# Offline package verification

```
node scripts/build-offline.mjs        # dist/index-offline.html (single file)
node scripts/build-offline-full.mjs   # dist/merit-offline/     (folder, with OCR)
node benchmarks/offline/verify-offline-package.mjs
```

Exits non-zero on any failure. Run it after touching either build script,
`index.html`, or anything in `src/`.

## Why this exists

`src/plan-ocr.js` used to carry the sentence "Verified with Playwright network
blocking during development." When that claim was actually checked, it was
false — and not marginally:

`build-offline-full.mjs` located the end of `index.html`'s body markup with
`shell.indexOf("<!--")`, i.e. the first HTML comment. index.html has carried
an explanatory comment above the dialogs for a long time, so the slice ended
early and `#guestDialog` never reached the package. `app-guests.js` runs
`document.getElementById("guestForm").elements` at load, which threw on
`null`. Because the build concatenates all eight sources into **one**
`<script>` element, that single throw killed everything after it: `i18n.js`,
`plan-ocr.js`, `plan-intelligence.js` and `app-v8.js` never executed. The
shipped "fully offline venue package" booted to a dead shell, and the OCR it
exists to provide was not broken but absent.

`build-offline.mjs` had already been fixed for the identical bug (it cuts at
`<script` and asserts the required element IDs). `build-offline-full.mjs`
never received that fix. Both now cut at `<script` and assert the same eight
IDs, so a truncated body is a build failure rather than a silent one.

The deeper lesson is the one this directory encodes: **"the build succeeded"
is not evidence.** Both builds reported success the entire time. Only running
the built artifact catches this class of defect.

## What the verifier checks

It serves `dist/merit-offline/` over loopback and installs a route handler
that **aborts every request that is not same-origin, `data:`, `blob:` or
`file:`**. That is stricter than a CDN allowlist: a silent fetch to any
outside host is recorded as an attempt and fails the run, rather than passing
unnoticed.

Against the folder build:

- every one of the eight source files actually executed (one global per file,
  in load order, so a throw is located rather than merely detected)
- all eight required dialogs / hidden inputs are present in the markup
- Tesseract and SheetJS resolved from local assets, with OCR paths pointing at
  `./assets/ocr/...`
- real OCR runs on a generated plan crop and returns per-word boxes with
  confidences
- the capacity auditor parses a stated total out of that real OCR text — not
  out of hand-written clean text
- zero off-origin requests were attempted
- no page errors

Against the single-file build (`file://`, the way it is really opened):

- every source file executed, all dialogs present, SheetJS inlined
- OCR reports itself **unavailable** rather than faking a result — an honest
  "unavailable" is the passing state here, because this build deliberately
  ships without the ~20MB of language data
- still zero off-origin requests

## Measured results

Folder build, headless Chromium, all non-local requests aborted:

| | |
| --- | --- |
| OCR | available |
| time | ~2.1–5.3s for a 1000×420 plan crop |
| off-origin requests attempted | none |
| read correctly | `TOTAL 124 PAX`, `114 pax seating`, `10 pax bistro`, `SAHNE` (Turkish) |
| confidence on those | 91–97 |
| capacity auditor | parsed stated total = 124 from the real OCR text |

### Known limitation, reported not asserted

Alphanumeric table labels are misread: `T01 T02 T03` comes back as
`TO1 TO02 TO3` — letter O for digit 0 — at confidence 57–89, against 95–97
for the capacity text.

The verifier prints this every run and does **not** assert on it. Two reasons.
It is a genuine engine characteristic, and tuning until a fixture passes is
the kind of number-fitting this project forbids. And the architecture already
says OCR is supporting evidence that never defines object identity or
geometry by itself — so the correct response is to write the limitation down
where the next person will find it (`MERIT_OCR_STATUS.offlineVerification`)
rather than to build table-number recognition on a signal measured to be
unreliable for exactly that.
