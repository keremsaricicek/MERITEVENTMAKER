// THE ASSISTANT'S LANGUAGE MODEL THAT SHIPS (owner 2026-11-01: the small model,
// behind ask-when-unsure; the 2B was too slow).
//
// NO MODEL RUNS HERE. This pins what the package carries and how it starts it:
//   THE MANIFEST IS VALID. tools/local-chat/manifests/<id>.json passes the
//     relay's own check (server/assistant-reader.mjs readChatManifest), serves
//     the short prompt the model was trained and measured with, and acts by
//     itself only at the confidence the race set (θ 0.91, training/README.md).
//   THE ADAPTER IS THE MEASURED ONE. models/local-chat/<id>/adapter.gguf has
//     the manifest's pinned size and sha256 (the base model is not in the
//     repository; the package builder checks it against the same manifest).
//   THE LAUNCHER LOADS IT. MERIT-Baslat.cmd starts the chat server WITH the
//     adapter: without it the base model answers, which nothing measured.
// Mutation proof, recorded 2026-11-01: before this change there was no chat
// manifest and the launcher started the chat server with no --lora → 3 fails.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const meta = { name: "chat-model-pinned", tags: ["assistant", "fast"], timeout: 60000 };

const ID = "qwen3.5-0.8b-merit-chat-r2";

export default async function run({ checks, repoRoot }) {
  const RD = await import(path.join(repoRoot, "server/assistant-reader.mjs"));
  const mf = path.join(repoRoot, "tools/local-chat/manifests", ID + ".json");
  checks.require(fs.existsSync(mf), "the shipped chat manifest exists", mf);
  const r = RD.readChatManifest(mf, { verify: false });
  checks.ok(r.ok, "it passes the relay's own manifest check", r);
  const m = JSON.parse(fs.readFileSync(mf, "utf8"));
  checks.equal(m.id, ID, "its id is the file's name");
  checks.equal(m.serve && m.serve.prompt, "short", "it serves the short prompt it was trained and measured with");
  checks.equal(m.serve && m.serve.actAt, 0.91, "it acts by itself only at the race's confidence (θ 0.91)");
  const lora = (m.serve.lora || [])[0];
  checks.ok(!!lora, "it names its adapter");
  const pin = lora && m.files.find((f) => f.path === lora.path);
  const ad = path.join(repoRoot, "models/local-chat", ID, lora ? lora.path : "adapter.gguf");
  const bytes = fs.existsSync(ad) ? fs.readFileSync(ad) : null;
  checks.ok(!!(bytes && pin && bytes.length === pin.bytes && crypto.createHash("sha256").update(bytes).digest("hex") === pin.sha256),
    "the committed adapter is the pinned one (size and sha256)", { exists: !!bytes, pin });

  const cmd = fs.readFileSync(path.join(repoRoot, "tools/local-vlm/windows/MERIT-Baslat.cmd"), "utf8");
  const chatStart = cmd.split(/\r?\n/).find((l) => /--port %CHAT_PORT%/.test(l)) || "";
  checks.ok(/@CHAT_LORA_ARG@/.test(chatStart), "the launcher starts the chat server with the manifest's adapter", chatStart);
  const build = fs.readFileSync(path.join(repoRoot, "tools/local-vlm/windows/build-package.sh"), "utf8");
  checks.ok(/@CHAT_LORA_ARG@/.test(build), "the package builder fills the adapter in from the chat manifest");

  // THE WATCHDOG (2026-11-02): the launcher keeps every server alive — three missed health
  // checks and it is started again with the very command it started with.
  const watch = cmd.slice(cmd.indexOf(":watch"));
  checks.ok(cmd.includes(":watch") && /goto watch/.test(watch), "the launcher ends in a watch loop, not a sleep", watch.slice(0, 80));
  for (const [what, port] of [["plan model", "%MODEL_PORT%/health"], ["chat model", "%ASSISTANT_CHAT_URL%/health"], ["app server", "%PORT%/index.html"]])
    checks.ok(watch.includes(port), `the watch loop checks the ${what}`);
  const startLines = (txt) => txt.split(/\r?\n/).filter((l) => /start "" \/b "%SERVER%"/.test(l)).map((l) => l.slice(l.indexOf('start ""'), l.indexOf(">nul")));
  const first = startLines(cmd.slice(0, cmd.indexOf(":keep"))), again = startLines(watch);
  checks.ok(again.length === 2 && again.every((a) => first.includes(a)), "each server is restarted with the same command it was started with", { first, again });
}
