# MERIT Entertainment — Event Maker

Internal event operations tool for Merit Entertainment: build a venue floor
plan, manage the guest list (including Excel import), assign seats, track
day-of arrivals live, and export the table plan and guest workbook.

No backend. Everything (events, floor plans, guests, seat assignments) is
stored in the browser via `localStorage`; nothing is uploaded anywhere.

## Running it

```
python3 -m http.server 8000   # or any static file server
# open http://localhost:8000
```

`index.html` loads the SheetJS (Excel import/export) and PDF.js (PDF floor
plan import) engines from jsDelivr, pinned to the exact versions this app
was built against:

- `xlsx@0.18.5`
- `pdfjs-dist@5.7.284`

Opening `index.html` directly as a `file://` URL will **not** work for the
PDF import feature — browsers block ES module script loads over `file://`.
Serve it over HTTP (any static server, including just double-clicking
through VS Code's Live Server or similar) and everything works, including
offline once the page has loaded once (nothing else is fetched at runtime).

### Fully offline build

For a venue laptop or network with no CDN access at all, build a single
self-contained HTML file with both vendor engines inlined:

```
node scripts/build-offline.mjs
# -> dist/index-offline.html — double-click to open, works with zero network
```

This downloads the two pinned npm packages once (cached in
`.vendor-cache/`) and inlines them into `dist/index-offline.html`, mirroring
how earlier versions of this app shipped as a single email-able file.

## Project structure

```
index.html          Page shell — dialogs, containers, vendor <script> tags
src/styles.css       Full design system (tokens, components, both UI layers)
src/app.js           Base app: events, floor plan editor, canvas interactions
src/app-guests.js     Guests, Excel import wizard, seating, live, reports, guide
src/app-v8.js         "V8" layer: overrides/extends the base app
scripts/build-offline.mjs   Produces the single-file offline build
```

The three `src/*.js` files are loaded as classic (non-module) scripts, in
that order, and share one global scope by design — `src/app-v8.js` is a
layer that overrides and extends functions defined in the first two
(card-based event home screen, guided event setup, assisted floor-plan
detection from an uploaded image, live operational mode). This mirrors how
the app was actually built and shipped, so it's kept as-is rather than
restructured into modules. Load order matters; don't reorder the `<script>`
tags in `index.html`.

## Design system

Dark, information-dense "operations tool" UI (Merit brand, not a generic
admin template): dark chrome shell, a warm paper-toned canvas for the floor
plan itself, and a blue/green/amber/red status language.

`src/styles.css` defines the system as CSS custom properties — spacing,
radius, elevation/shadow, and motion scales, plus color tokens — and every
interactive element (buttons, tabs, table rows, cards, canvas objects)
gets consistent hover/active/focus-visible states, transitions that respect
`prefers-reduced-motion`, and a themed scrollbar. Layout-critical values
(canvas world size, grid columns, seat/chair geometry) are untouched from
the original build, since the app's interaction logic depends on them.

## Why CDN instead of vendoring the libraries in the repo

Earlier builds of this app embedded SheetJS and PDF.js inline in the HTML
(~3.9 MB of vendor code) so it could be distributed as one offline file.
That's still available via `scripts/build-offline.mjs` above — but it isn't
vendored in this git repository, deliberately: 4 MB of third-party minified
code in source control has no diff value and bloats every clone. Pinned CDN
references (or the offline build script) cover both the normal case (online,
small repo) and the venue/no-network case, without carrying that weight in
git history.
