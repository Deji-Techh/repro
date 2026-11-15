#!/usr/bin/env node
/**
 * repro — turn a bug report into a failing browser test, the commit that broke
 * it, and a proven fix. Kane CLI is the definition of done.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { analyze, findEvidencePack, runKane, runObjective, runTest, routeResultCode } from "./kane.mjs";
import { objectiveFromTicket, testMdFromObjective } from "./objective.mjs";
import { bisect, withServer } from "./bisect.mjs";
import { loadTranscript, renderTranscript } from "./demo.mjs";
import { findChrome } from "./chrome.mjs";
import { writeReport } from "./report.mjs";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const HELP = `${C.bold("repro")} — Kane CLI is the definition of done.

${C.bold("Commands")}
  doctor                          check kane-cli, auth, Chrome, git, credits
  from --ticket <text>            turn a bug report into a _test.md draft
  verify --test <file>            replay a test and print the verdict
  verify --url <url> --objective  run a one-off objective
  analyze --condition <text>      live oracle: judge conditions, no test saved
  bisect --good <ref> --bad <ref> find the commit that broke the test
  fix --test <file>               feed the verdict to an agent, re-verify
  report                          print repro-report.md
  pr --comment                    post the report to the current PR (gh)
  demo --fixtures                 watch the recorded loop, zero credits

${C.bold("Common flags")}
  --url <url>          start URL                 --timeout <s>   hard cap (default 240)
  --headless           hide the browser           --json          machine-readable output
  --agent-cmd <cmd>    agent to run in fix (default: opencode run)
  --dry-run            write the prompt, don't call the agent
  --serve / --ready-url  start the app per attempt (so a patch is visible)
  --culprit <sha>      put the culprit diff in the agent's prompt

${C.dim("Docs: kane-cli run_end = { status, result_code, final_state, session_dir, test_url }")}
`;

function parse(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  const list = { condition: [], extra: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
    if (key === "condition") list.condition.push(value);
    else if (key === "extra") list.extra.push(value);
    else flags[key] = value;
  }
  return { cmd, flags, list };
}

function line(s = "") {
  process.stdout.write(s + "\n");
}

function verdictLine(v) {
  const tag = v.ok ? C.green("PASS") : v.exitKind === "not-started" ? C.yellow("NO-START") : C.red("FAIL");
  const bits = [
    `${tag}`,
    `exit ${v.exitCode}${v.exitKind !== "passed" ? ` (${v.exitKind})` : ""}`,
    v.resultCode != null ? `result_code ${v.resultCode}` : null,
    v.route?.band ? `band ${v.route.band} → ${v.route.action}` : null,
    v.bugVerdict ? `kane: ${v.bugVerdict.confirmed ? "confirmed product bug" : v.bugVerdict.family ?? "unconfirmed"}` : null,
    v.durationS != null ? `${v.durationS}s` : null,
    v.credits != null ? `${Math.round(v.credits)} credits` : null,
  ].filter(Boolean);
  line(bits.join("  ·  "));
  if (v.oneLiner) line(C.dim(`  ${v.oneLiner}`));
  if (v.route?.why) line(C.dim(`  why: ${v.route.why}`));
  if (v.failingStep) line(C.red(`  failed step ${v.failingStep.step}: ${v.failingStep.remark}`));
  if (v.finalState && Object.keys(v.finalState).length) line(C.dim(`  final_state: ${JSON.stringify(v.finalState)}`));
  if (v.evidencePack) line(C.dim(`  evidence: ${v.evidencePack}`));
  else if (v.sessionDir) line(C.dim(`  evidence: ${v.sessionDir}`));
  if (v.testUrl) line(C.dim(`  test: ${v.testUrl}`));
  if (v.exitKind === "not-started" && v.stderrTail) {
    line(C.yellow("  kane-cli did not start the run:"));
    for (const l of v.stderrTail.trim().split("\n").slice(-6)) line(C.dim("  | " + l));
  }
  if (v.warnings?.length) for (const w of v.warnings) line(C.yellow(`  warning: ${w.message ?? w.code}`));
}

function emit(flags, payload, human) {
  if (flags.json) line(JSON.stringify(payload, null, 2));
  else human();
}

async function cmdDoctor(flags) {  const checks = [];
  const has = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).status === 0;
  const out = (cmd) => spawnSync("sh", ["-c", cmd], { encoding: "utf8" });

  checks.push(["node", has("node") ? out("node -v").stdout.trim() : "missing", has("node")]);
  checks.push(["git", has("git") ? out("git --version").stdout.trim() : "missing", has("git")]);
  checks.push(["kane-cli", has("kane-cli") ? out("kane-cli --version").stdout.trim() : "not on PATH", has("kane-cli")]);

  const chrome = findChrome();
  checks.push([
    "google chrome",
    chrome.path ?? "not found — install Chrome, or set KANE_CLI_CHROME_PATH",
    Boolean(chrome.path),
  ]);

  if (has("kane-cli")) {
    const who = out("kane-cli whoami");
    const signedIn = who.status === 0 && !/not configured/i.test(who.stdout + who.stderr);
    checks.push(["kane-cli auth", signedIn ? "signed in" : "NOT signed in — run: kane-cli login", signedIn]);

    const bal = out("kane-cli balance");
    const m = (bal.stdout + bal.stderr).match(/([\d,.]+)\s*(credits)?/i);
    checks.push(["credits", bal.status === 0 ? (m ? m[1] : "ok") : "unavailable", bal.status === 0]);
  }

  line(C.bold("\nrepro doctor\n"));
  for (const [name, value, ok] of checks) {
    line(`  ${ok ? C.green("✓") : C.red("✗")} ${name.padEnd(16)} ${C.dim(String(value).trim())}`);
  }
  const ready = checks.every((c) => c[2]);
  line("");
  if (chrome.path && chrome.nonStandard) {
    line(C.dim("Chrome is not at the default path. repro injects KANE_CLI_CHROME_PATH for you."));
    line(C.dim(`  (only needed if you call kane-cli directly: export KANE_CLI_CHROME_PATH="${chrome.path}")`));
    line("");
  }
  line(ready ? C.green("Ready. Try: repro verify --test tests/your_test.md") : C.yellow("Not ready yet — fix the ✗ rows above."));
  line(C.dim("Hackathon: claim 10,000 credits with the same email → https://www.testmuai.com/kane-cli/#creditOffer"));
  return ready ? 0 : 1;
}

async function cmdFrom(flags) {
  const ticket = flags.ticket;
  if (!ticket) throw new Error("from needs --ticket \"<bug report text>\" [--url <url>]");
  const objective = objectiveFromTicket({ ticket: String(ticket), url: flags.url });
  const out = resolve(String(flags.out ?? "tests/repro_test.md"));
  const body = testMdFromObjective({ objective, url: flags.url, title: flags.title });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
  line(C.bold("\nObjective " + C.dim("(what Kane will try to do)")));
  line("  " + objective.replace(/\n/g, "\n  "));
  line(C.bold("\nWrote ") + out);
  line(C.dim("Next: repro verify --test " + out + " --url " + (flags.url ?? "<url>")));
  return 0;
}

async function cmdVerify(flags) {
  let v;
  const run = async () => {
    if (flags.test) {
      return runTest(String(flags.test), {
      url: flags.url,
      timeoutS: Number(flags.timeout ?? 240),
      headless: flags.headless !== false,
        extra: flags.extraFlags ? String(flags.extraFlags).split(" ") : [],
      });
    }
    if (flags.objective) {
      return runObjective(String(flags.objective), {
        url: flags.url,
        timeoutS: Number(flags.timeout ?? 240),
        headless: flags.headless !== false,
      });
    }
    throw new Error('verify needs --test <file> or --objective "..."');
  };

  // Restart the app around the run when asked, so a patch on disk is visible.
  v = await withServer(
    {
      serve: flags.serve ? String(flags.serve) : null,
      readyUrl: flags["ready-url"] ? String(flags["ready-url"]) : null,
    },
    run,
  );

  if (flags.out) writeFileSync(resolve(String(flags.out)), JSON.stringify(v, null, 2));
  emit(flags, v, () => {
    line("");
    verdictLine(v);
    line("");
  });
  return v.ok ? 0 : 1;
}

async function cmdAnalyze(flags, list) {
  if (!list.condition.length) throw new Error("analyze needs at least one --condition \"...\"");
  const v = await analyze(list.condition, { cdpEndpoint: flags.cdp, cwd: process.cwd() });
  emit(flags, v, () => {
    line("");
    line(C.bold("live oracle") + C.dim(`  ${list.condition.length} condition(s)`));
    const results = v.conditionResults ?? [];
    list.condition.forEach((c, i) => {
      const r = results[i];
      line(`  ${r === true ? C.green("TRUE ") : r === false ? C.red("FALSE") : C.yellow("?????")}  ${c}`);
    });
    line(C.dim(`  bands: exit ${v.exitCode} · ${v.exitKind} · judged ≠ passed`));
    line("");
  });
  // Exit 0 means "all judged", not "all true" — mirror that honestly.
  return v.exitCode === 0 ? 0 : 1;
}

async function cmdBisect(flags) {
  if (!flags.good || !flags.bad || (!flags.test && !flags.objective)) {
    throw new Error(
      'bisect needs --good <ref> --bad <ref> and either --test <file> or --objective "<text>"\n' +
        '  [--serve "cmd"] [--ready-url url] [--precheck] [--max-probes 8]',
    );
  }
  const result = await bisect({
    good: String(flags.good),
    bad: String(flags.bad),
    test: flags.test ? String(flags.test) : null,
    objective: flags.objective ? String(flags.objective) : null,
    precheck: Boolean(flags.precheck),
    url: flags.url,
    serve: flags.serve ? String(flags.serve) : null,
    readyUrl: flags["ready-url"] ? String(flags["ready-url"]) : null,
    maxProbes: Number(flags["max-probes"] ?? 12),
    timeoutS: Number(flags.timeout ?? 240),
    onLog: (s) => line(s),
  });
  emit(flags, result, () => {
    line("");
    if (result.culprit) {
      line(C.red(C.bold("culprit ")) + result.culprit.sha + "  " + result.culprit.subject);
      if (result.culprit.files?.length) line(C.dim("  files: " + result.culprit.files.join(", ")));
    } else {
      line(C.yellow("no culprit found — bisect was inconclusive"));
    }
    line(C.dim(`  probes: ${result.probes.length} · evidence: ${result.evidenceDir ?? "(none)"}`));
    line("");
  });
  return result.culprit ? 0 : 1;
}

async function cmdFix(flags) {
  if (!flags.test && !flags.objective) {
    throw new Error(
      'fix needs a way to check the flow: --test <file> or --objective "<text>"\n' +
        '  [--agent-cmd "..."] [--attempts 3] [--culprit <sha>] [--dry-run]',
    );
  }
  const attempts = Number(flags.attempts ?? 3);
  const history = [];
  let skipFinal = false;
  const label = flags.test ? String(flags.test) : "objective";

  // Authoring mode costs credits but does not depend on a recording replaying
  // cleanly. Test mode is cheaper. The verdict is the same shape either way.
  // Restart the app around every attempt. A dev server caches its modules:
  // without this, an agent's patch lands on disk and the running process keeps
  // serving the old code, so the re-verify lies.
  const verifyOnce = () =>
    withServer(
      { serve: flags.serve ? String(flags.serve) : null, readyUrl: flags["ready-url"] ? String(flags["ready-url"]) : null },
      () =>
        flags.objective
          ? runObjective(String(flags.objective), {
              url: flags.url,
              timeoutS: Number(flags.timeout ?? 240),
              headless: flags.headless !== false,
            })
          : runTest(String(flags.test), {
              url: flags.url,
              timeoutS: Number(flags.timeout ?? 240),
              headless: flags.headless !== false,
            }),
    );

  const culprit = flags.culprit ? readCulprit(String(flags.culprit)) : null;

  for (let i = 1; i <= attempts; i++) {
    line(C.bold(`\nattempt ${i}/${attempts} — verify`));
    const v = await verifyOnce();
    verdictLine(v);
    history.push({ attempt: i, action: "verify", verdict: v });

    if (v.ok) {
      line(C.green("\nclosed. Kane exits 0 — the fix is proven, not claimed."));
      writeReport({ test: label, mode: flags.objective ? "objective" : "test", objective: flags.objective, url: flags.url, history, ok: true, culprit });
      return 0;
    }
    if (v.route.action !== "fix-code") {
      line(C.yellow(`\nstopping: ${v.route.band} (${v.route.action}) is not a code fix.`));
      line(C.dim(`  ${v.route.why ?? "Kane did not confirm a product bug."}`));
      line(C.dim("Feed this to a human or fix the test/environment. Repro does not guess."));
      writeReport({ test: label, mode: flags.objective ? "objective" : "test", objective: flags.objective, url: flags.url, history, ok: false, culprit });
      return 1;
    }
    if (i === attempts) break;

    const prompt = buildFixPrompt({ verdict: v, test: label, attempt: i, culprit });
    const promptFile = resolve(".repro", `fix-prompt-${i}.md`);
    mkdirSync(dirname(promptFile), { recursive: true });
    writeFileSync(promptFile, prompt);
    line(C.dim(`  prompt → ${promptFile}`));

    if (flags["dry-run"]) {
      line(C.yellow("  --dry-run: not invoking an agent"));
      history.push({ attempt: i, action: "dry-run", promptFile });
      skipFinal = true;
      break;
    }

    line(C.bold(`  agent: ${flags["agent-cmd"] ?? "opencode (default)"}`));
    const code = await runAgent(flags["agent-cmd"], prompt);
    history.push({ attempt: i, action: "agent", agentExit: code, promptFile });
    if (code !== 0) line(C.yellow(`  agent exited ${code}; re-verifying anyway (the verdict is the judge)`));
  }

  if (skipFinal) {
    writeReport({ test: label, mode: flags.objective ? "objective" : "test", objective: flags.objective, url: flags.url, history, ok: false, culprit });
    line(C.yellow("\nstopped before the fix loop. Every attempt is in repro-report.md."));
    return 1;
  }

  const head = await verifyOnce();
  history.push({ attempt: "final", action: "final-verify", verdict: head });
  verdictLine(head);
  writeReport({ test: label, mode: flags.objective ? "objective" : "test", objective: flags.objective, url: flags.url, history, ok: head.ok, culprit });
  line(head.ok ? C.green("\nclosed.") : C.red("\nnot closed. Report written with every attempt."));
  return head.ok ? 0 : 1;
}

/** The culprit commit, as text an agent can act on. */
function readCulprit(sha) {
  const r = spawnSync("git", ["show", "--stat", "--patch", "--no-color", sha], { encoding: "utf8" });
  if (r.status !== 0) return { sha, diff: null };
  const files = spawnSync("git", ["show", "--name-only", "--pretty=format:", sha], { encoding: "utf8" })
    .stdout.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return { sha, diff: (r.stdout ?? "").slice(0, 12000), files };
}

function buildFixPrompt({ verdict, test, attempt, culprit }) {
  const step = verdict.failingStep;
  return `# Fix request (attempt ${attempt})

A browser test failed. Kane CLI ran it in real Chrome; this is the verdict, not an opinion.

- Flow: \`${test}\`
- Status: ${verdict.status} (exit ${verdict.exitCode})
- result_code: ${verdict.resultCode ?? "n/a"} (${verdict.reasonCode ?? "n/a"})
- Summary: ${verdict.oneLiner ?? verdict.summary ?? "n/a"}

## Failing step
${step ? `step ${step.step}: ${step.remark}` : "(no step-level failure reported)"}

## Kane's own triage
${
  verdict.bugVerdict
    ? `- confirmed product bug: ${verdict.bugVerdict.confirmed}
- family: ${verdict.bugVerdict.family ?? "n/a"} · category: ${verdict.bugVerdict.category ?? "n/a"}
- verdict: ${verdict.bugVerdict.one_liner ?? "n/a"}`
    : `- no bug verdict emitted (band: ${verdict.route?.band ?? "unknown"} → ${verdict.route?.action ?? "inspect"})`
}

## Evidence
${verdict.sessionDir ? `${verdict.sessionDir}\nView: kane-cli evidence serve <pack>` : "no evidence directory reported"}

## Final state
\`\`\`json
${JSON.stringify(verdict.finalState ?? {}, null, 2)}
\`\`\`

${
  culprit?.diff
    ? `## The commit that broke it
\`${culprit.sha}\`${culprit.files?.length ? ` — ${culprit.files.join(", ")}` : ""}

\`\`\`diff
${culprit.diff}
\`\`\`
`
    : ""
}
## Rules
1. Fix the application code. Do not weaken the test or drop the expected outcome.
2. Do not change the objective's wording to make it pass.
3. Make the smallest change that makes the user-visible behaviour correct.
4. Then stop. Repro re-runs the flow; only a Kane exit code of 0 closes this.
`;
}

function runAgent(agentCmd, prompt) {
  const cmd = agentCmd ?? "opencode run -m opencode-go/deepseek-v4.1-flash --auto --archived {prompt}";
  const [bin, ...rest] = splitCmd(cmd);
  const args = rest.map((a) => (a === "{prompt}" ? prompt : a));
  if (!rest.includes("{prompt}")) args.push(prompt);
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "inherit", env: process.env });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function splitCmd(s) {
  return s.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((p) => p.replace(/^["']|["']$/g, "")) ?? [];
}

async function cmdDemo(flags) {
  if (flags.fixtures || flags.recorded) {
    const t = loadTranscript();
    if (!t) {
      line(C.yellow("no fixtures/transcript.json in this checkout"));
      return 1;
    }
    line(renderTranscript(t));
    return 0;
  }
  line("");
  line(C.bold("  Live demo") + C.dim("  (spends credits)"));
  line("");
  line("  1. node scripts/make-demo-repo.mjs     # 20 commits, one real regression");
  line(C.dim("     (or, after npm link: repro …)"));
  line("  2. (cd .repro-demo && PORT=4173 node apps/demo-shop/server.mjs)");
  line('  3. repro verify --url http://localhost:4173/checkout --objective "…"');
  line(`  4. repro bisect --objective "…" --good <first> --bad <culprit> --precheck \
       --serve "PORT=4173 node apps/demo-shop/server.mjs" --ready-url http://localhost:4173/api/health`);
  line('  5. repro fix --objective "…" --culprit <sha> --serve "…" --ready-url …');
  line("");
  line(C.dim("  No credits? repro demo --fixtures"));
  line("");
  return 0;
}

async function cmdPr(flags) {
  const file = resolve("repro-report.md");
  if (!existsSync(file)) {
    line(C.yellow("no repro-report.md yet — run `repro fix` or `repro bisect` first"));
    return 1;
  }
  const body = readFileSync(file, "utf8");
  if (flags["dry-run"]) {
    line(C.dim("--dry-run: would post this as a PR comment\n"));
    line(body);
    return 0;
  }

  const repoArgs = flags.repo ? ["--repo", String(flags.repo)] : [];
  let pr = flags.pr ? String(flags.pr) : null;
  if (!pr) {
    const v = spawnSync("gh", ["pr", "view", "--json", "number", "-q", ".number", ...repoArgs], { encoding: "utf8" });
    if (v.status !== 0) {
      line(C.yellow("no pull request found for this branch."));
      line(C.dim((v.stderr || "").trim().split("\n").slice(-2).join("\n")));
      line(C.dim("Push the branch and open a PR, or pass --pr <number>."));
      return 1;
    }
    pr = v.stdout.trim();
  }

  const r = spawnSync("gh", ["pr", "comment", pr, "--body-file", file, ...repoArgs], { encoding: "utf8" });
  if (r.status !== 0) {
    line(C.red("gh could not comment:"));
    line((r.stderr || r.stdout || "").trim());
    return 1;
  }
  line(C.green(`commented on PR #${pr}`));
  line(C.dim((r.stdout || "").trim()));
  return 0;
}

async function cmdReport(flags) {
  const p = resolve("repro-report.md");
  if (!existsSync(p)) {
    line(C.yellow("no repro-report.md yet — run `repro fix` or `repro bisect` first"));
    return 1;
  }
  line(readFileSync(p, "utf8"));
  return 0;
}

/** Start a dev server for bisect, wait for readiness, and return a stop fn. */
export async function startServer({ cmd, readyUrl, timeoutMs = 20000 }) {
  if (!cmd) return { stop: async () => {} };
  const [bin, ...rest] = splitCmd(cmd);
  const child = spawn(bin, rest, { stdio: "ignore", env: process.env, detached: false });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!readyUrl) {
      await sleep(1200);
      break;
    }
    try {
      const res = await fetch(readyUrl, { method: "GET" });
      if (res.status < 500) break;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return {
    stop: async () => {
      child.kill("SIGTERM");
      await sleep(200);
      if (!child.killed) child.kill("SIGKILL");
    },
  };
}

async function main() {
  const { cmd, flags, list } = parse(process.argv.slice(2));
  try {
    switch (cmd) {
      case undefined:
      case "--help":
      case "-h":
      case "help":
        line(HELP);
        return 0;
      case "doctor":
        return await cmdDoctor(flags);
      case "from":
        return await cmdFrom(flags);
      case "verify":
        return await cmdVerify(flags);
      case "analyze":
        return await cmdAnalyze(flags, list);
      case "bisect":
        return await cmdBisect(flags);
      case "fix":
        return await cmdFix(flags);
      case "report":
        return await cmdReport(flags);
      case "pr":
        return await cmdPr(flags);
      case "demo":
        return await cmdDemo(flags);
      default:
        line(C.red(`unknown command: ${cmd}`));
        line(HELP);
        return 2;
    }
  } catch (err) {
    line(C.red("\n" + (err?.message ?? String(err))));
    return 1;
  }
}

main().then((code) => process.exit(code));
