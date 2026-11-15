#!/usr/bin/env node
/**
 * demo-agent — a stand-in for a coding agent, used in the demo so the loop can
 * be shown end to end without a specific agent CLI installed.
 *
 * It is deliberately dumb and honest: it reads the `repro` fix prompt, takes the
 * culprit diff that Kane's bisect found, and reverses it. No hardcoded file
 * contents, no knowledge of the bug beyond what the prompt carries.
 *
 * In real use, swap it for your agent:
 *   repro fix --objective "…" --agent-cmd 'claude -p {prompt}'
 *   repro fix --objective "…" --agent-cmd 'codex exec {prompt}'
 *
 * Usage (repro does this for you):
 *   node scripts/demo-agent.mjs "<prompt text>"
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const prompt = process.argv.slice(2).join(" ");
if (!prompt) {
  console.error("demo-agent: no prompt");
  process.exit(2);
}

const diff = prompt.match(/```diff\n([\s\S]*?)\n```/);
if (!diff) {
  console.error("demo-agent: the prompt carries no culprit diff, so there is nothing to reverse");
  process.exit(3);
}

/**
 * The culprit commit removed the saved-card branch. Reversing the patch is the
 * smallest correct change, and it is derived only from what repro handed over.
 */
const patch = diff[1].endsWith("\n") ? diff[1] : diff[1] + "\n";

mkdirSync(resolve(".repro"), { recursive: true });
const patchFile = resolve(".repro", "demo-agent.patch");
writeFileSync(patchFile, patch);

const applied = spawnSync("git", ["apply", "-R", "--whitespace=nowarn", patchFile], { encoding: "utf8" });
if (applied.status !== 0) {
  console.error("demo-agent: could not apply the reverse patch");
  console.error(applied.stderr || applied.stdout);
  process.exit(4);
}

console.log("demo-agent: reversed the culprit diff");
console.log(spawnSync("git", ["diff", "--stat"], { encoding: "utf8" }).stdout.trim());
process.exit(0);
