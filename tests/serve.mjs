#!/usr/bin/env node
// `npm run serve` — the app on a fixed port for manual review, using the same
// static server the tests use so there is only one thing to keep working.
import { startStaticServer, REPO_ROOT } from "./lib/server.mjs";

const port = Number(process.env.PORT || 8000);
const server = await startStaticServer({ port });
console.log(`MERIT EVENT MAKER — ${server.baseUrl}/index.html`);
console.log(`serving ${REPO_ROOT}   (ctrl-c to stop)`);
