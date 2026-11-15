/**
 * demo.mjs — show the loop without spending a credit.
 *
 * `repro demo --fixtures` replays a recorded, real run: same verdicts, same
 * numbers, same commit, and the two sealed evidence packs that were produced
 * at the time. Nothing here is simulated.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fixturesPath() {
  return join(root, "fixtures", "transcript.json");
}

function verdictLine(v) {
  const tag = v.status === "passed" ? C.green("PASS") : C.red("FAIL");
  const bits = [
    tag,
    `exit ${v.exitCode}`,
    v.resultCode != null ? `result_code ${v.resultCode}` : null,
    `band ${v.band} → ${v.action}`,
    `${v.durationS}s`,
    `${v.credits} credits`,
  ].filter(Boolean);
  return `  ${bits.join("  ·  ")}`;
}

export function renderTranscript(t) {
  const out = [];
  const p = (s = "") => out.push(s);

  p();
  p(C.bold("  repro — a recorded run") + C.dim(`  (real, ${t.recorded}, kane-cli ${t.kaneCli}, Chrome ${t.chrome})`));
  p(C.dim("  " + t.note));
  p();

  // Act 1
  p(C.bold("  ACT 1 — reproduce"));
  p(C.dim(`  $ ${t.act1.command}`));
  p(verdictLine(t.act1.verdict));
  p(C.dim(`    ${t.act1.verdict.oneLiner}`));
  p(C.red(`    failed step ${t.act1.verdict.failingStep.step}: ${t.act1.verdict.failingStep.remark}`));
  p(C.dim(`    evidence: ${t.act1.evidence}`));
  p();

  // Act 2
  p(C.bold("  ACT 2 — blame"));
  p(C.dim(`  $ ${t.act2.command}`));
  p(C.dim(`  precheck: ${t.act2.precheck}`));
  for (const [i, probe] of t.act2.probes.entries()) {
    p(`    probe ${i + 1}  ${probe.sha}  ${probe.subject}  ${C.green("good")}`);
  }
  p(
    C.red(`  culprit `) +
      `${t.act2.culprit.sha.slice(0, 12)}  ${t.act2.culprit.subject}` +
      C.dim(`  (${t.act2.culprit.files.join(", ")})`),
  );
  p(C.dim(`    ${t.act2.probesRun} probes · ~${t.act2.wallMinutes} min · ${t.act2.credits} credits`));
  p();

  // Act 3
  p(C.bold("  ACT 3 — close"));
  const [first, agent, last] = t.act3.attempts;
  p(C.dim("  attempt 1"));
  p(verdictLine(first.verdict));
  p(C.red(`    failed step ${first.verdict.failingStep.step}: ${first.verdict.failingStep.remark}`));
  p(C.dim(`  prompt → the failing step + the culprit diff`));
  p(C.dim(`  agent: ${agent.note}`));
  p(C.dim(`    ${agent.result}`));
  p(C.dim("  attempt 2"));
  p(verdictLine(last.verdict));
  p(C.green(`    closed. Kane exits 0 — the fix is proven, not claimed.`));
  p(C.dim(`    final_state: ${JSON.stringify(last.verdict.finalState)}`));
  p(C.dim(`    evidence: ${t.act3.evidence}`));
  p();

  p(C.bold("  What is bundled here"));
  p(C.dim("    two sealed .evidence packs from those exact runs (per-step screenshots,"));
  p(C.dim("    annotated action shots, console + network logs, failure records)"));
  p();
  p(C.dim("  Run it live (spends credits):  node scripts/make-demo-repo.mjs && node src/cli.mjs doctor"));
  p();
  return out.join("\n");
}

export function loadTranscript() {
  const p = fixturesPath();
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}
