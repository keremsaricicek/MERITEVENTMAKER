// PDF.js for the served build, as a module FILE rather than inline: the page's
// Content-Security-Policy allows no inline script. The offline builds ship
// their own bridge (scripts/build-offline*.mjs) and do not load this file.
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs";
globalThis.MeritPdf = { getDocument: pdfjsLib.getDocument, GlobalWorkerOptions: pdfjsLib.GlobalWorkerOptions };
globalThis.dispatchEvent(new CustomEvent("merit-pdf-ready"));
