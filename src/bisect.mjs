/**
 * bisect.mjs — which commit broke the user flow?
 *
 * Replays a saved _test.md at each probe. Replay is cached, so a 5-probe
 * bisect over 30 commits costs a fraction of authoring the flow five times.
 *
 * The honest part: the app must be running *at that commit*, so each probe
 * checks out the commit, restarts the app, waits for readiness, runs Kane,
 * and always resets the repo afterwards.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { runObjective, runTest } from "./kane.mjs";

const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });

function mustGit(args, cwd) {
  const r = git(args, cwd);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

function splitCmd(s) {
  return s.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((p) => p.replace(/^["']|["']$/g, "")) ?? [];
}

export async function withServer({ serve, readyUrl, timeoutMs = 25000 }, fn) {
  if (!serve) return fn();
  const { spawn } = await import("node:child_process");
  // Run through a shell so `PORT=4173 node app.mjs` and other env prefixes work,
  // and detach so we can kill the whole process group afterwards.
  const proc = spawn("sh", ["-c", serve], { stdio: "ignore", env: process.env, detached: true });
  proc.on("error", () => {});
  const stop = async () => {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await sleep(300);
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  };
  try {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!readyUrl) {
        await sleep(1500);
        break;
      }
      try {
        const res = await fetch(readyUrl);
        if (res.status < 500) break;
      } catch {
        /* keep waiting */
      }
      await sleep(250);
    }
    return await fn();
  } finally {
    await stop();
  }
}

/**
 * @param {{
 *  good: string, bad: string, test: string, url?: string, serve?: string|null,
 *  readyUrl?: string|null, maxProbes?: number, timeoutS?: number,
 *  onLog?: (s: string) => void, cwd?: string
 * }} o
 */
export async function bisect(o) {
  const cwd = o.cwd ?? process.cwd();
  const log = o.onLog ?? (() => {});

  const inside = git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inside.status !== 0) throw new Error("not a git repository");

  const dirty = git(["status", "--porcelain"], cwd).stdout.trim();
  if (dirty) {
    const blocking = dirty
      .split("\n")
      .filter((l) => !/^\?\?\s+\.repro\//.test(l))
      .filter(Boolean);
    if (blocking.length) {
      throw new Error(
        "working tree is dirty — commit or stash first. Bisect checks out other commits.\n" +
          blocking.slice(0, 5).join("\n"),
      );
    }
  }

  const testPath = o.test ? resolve(cwd, o.test) : null;
  const evidenceDir = resolve(cwd, ".repro", `bisect-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(evidenceDir, { recursive: true });

  const goodSha = mustGit(["rev-parse", "--short", o.good], cwd);
  const badSha = mustGit(["rev-parse", "--short", o.bad], cwd);
  log(`bisect  good ${goodSha}  bad ${badSha}  probe ${o.objective ? "objective" : o.test}`);

  const probes = [];
  let culprit = null;

  const probeOnce = async () => {
    const verdict = await withServer({ serve: o.serve ?? null, readyUrl: o.readyUrl ?? null }, () =>
      o.objective
        ? // Authoring mode: slower and it costs credits, but it does not depend
          // on a recording that may not replay cleanly.
          runObjective(o.objective, { cwd, url: o.url, timeoutS: o.timeoutS ?? 240, headless: true })
        : runTest(testPath, {
            cwd,
            url: o.url,
            timeoutS: o.timeoutS ?? 240,
            headless: true,
            // Deterministic probes: no adaptive healing mid-bisect. Healing
            // re-authors failed steps, which is both costly and would blur the
            // pass/fail signal we are binary-searching on.
            extra: ["--no-adaptive-heal"],
          }),
    );
    return verdict;
  };

  if (o.precheck) {
    log("precheck: does the range actually bracket the bug?");
    mustGit(["checkout", "-q", o.good], cwd);
    const g = await probeOnce();
    mustGit(["checkout", "-q", o.bad], cwd);
    const b = await probeOnce();
    if (!g.ok) {
      throw new Error(
        `precheck failed: 'good' (${o.good}) does not pass, so the range is wrong.\n` +
          `  ${g.failingStep?.remark ?? g.oneLiner ?? g.status}\n` +
          `  ${g.route?.band ? `route: ${g.route.band} → ${g.route.action}` : ""}` +
          `\nFix the test or pick a different good ref.`,
      );
    }
    if (b.ok) {
      throw new Error(`precheck failed: 'bad' (${o.bad}) passes, so nothing regressed in this range.`);
    }
    log(`  good passes (${g.durationS}s) · bad fails (${b.durationS}s, ${b.route?.band ?? b.status}) — range is valid`);
  }

  mustGit(["bisect", "start"], cwd);
  try {
    mustGit(["bisect", "bad", o.bad], cwd);
    const afterGood = mustGit(["bisect", "good", o.good], cwd);
    log(afterGood.split("\n")[0] ?? "");

    for (let i = 0; i < (o.maxProbes ?? 12); i++) {
      const sha = mustGit(["rev-parse", "--short", "HEAD"], cwd);
      const subject = mustGit(["log", "-1", "--pretty=%s"], cwd);

      const hasTest = !o.objective
        ? git(["cat-file", "-e", `HEAD:${toRepoRel(cwd, testPath)}`], cwd).status === 0
        : true;
      if (!hasTest && !existsSync(testPath)) {
        log(`  ! ${sha} does not contain the test file and it is not on disk — nothing to replay`);
        break;
      }
      if (!hasTest) log(`  note: test is untracked; replaying the working-tree copy at each commit`);

      log(`  probe ${probes.length + 1}  ${sha}  ${subject}`);
      const started = Date.now();
      const verdict = await probeOnce();


      const record = {
        sha,
        subject,
        ok: verdict.ok,
        exitCode: verdict.exitCode,
        resultCode: verdict.resultCode,
        failingStep: verdict.failingStep,
        durationS: verdict.durationS,
        credits: verdict.credits,
        sessionDir: verdict.sessionDir,
        wallMs: Date.now() - started,
      };
      probes.push(record);
      writeFileSync(resolve(evidenceDir, `${sha}.json`), JSON.stringify({ record, verdict }, null, 2));
      log(
        `    ${verdict.ok ? "good" : "BAD "}  exit ${verdict.exitCode}` +
          (verdict.failingStep ? `  step ${verdict.failingStep.step}: ${verdict.failingStep.remark}` : ""),
      );

      const step = mustGit(["bisect", verdict.ok ? "good" : "bad"], cwd);
      const firstBad = step.match(/^([0-9a-f]{7,40})(?:\.\.\.)? is the first bad commit/im);
      if (firstBad) {
        culprit = describe(cwd, firstBad[1]);
        break;
      }
      // git prints "Bisecting: N revisions left" while it still needs marks.
      // It keeps asking until it can name the first bad commit, so loop on that.
      if (!/^Bisecting:/m.test(step)) break;
    }

    if (!culprit) {
      // Fallback: the first "bad" probe whose parent was a passing probe.
      const bad = [...probes].reverse().find((p) => !p.ok);
      if (bad) {
        const parent = mustGit(["rev-parse", "--short", `${bad.sha}^`], cwd);
        const parentWasGood = probes.some((p) => p.ok && (p.sha === parent || p.sha.startsWith(parent)));
        const logOut = git(["bisect", "log"], cwd).stdout.trim();
        const first = logOut.split("\n").find((l) => /^commit\s+[0-9a-f]{7,40}/.test(l));
        if (parentWasGood) culprit = describe(cwd, bad.sha);
        else if (first) culprit = describe(cwd, first.replace(/^commit\s+/, "").trim());
      }
    }
  } finally {
    git(["bisect", "reset"], cwd);
  }

  const summary = {
    good: o.good,
    bad: o.bad,
    test: o.test,
    culprit,
    probes,
    evidenceDir,
  };
  writeFileSync(resolve(evidenceDir, "bisect.json"), JSON.stringify(summary, null, 2));
  return summary;
}

function toRepoRel(cwd, abs) {
  const root = mustGit(["rev-parse", "--show-toplevel"], cwd);
  return abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs;
}

function describe(cwd, sha) {
  const full = mustGit(["rev-parse", sha], cwd);
  const subject = mustGit(["log", "-1", "--pretty=%s", sha], cwd);
  const body = git(["log", "-1", "--pretty=%b", sha], cwd).stdout.trim();
  const files = git(["show", "--name-only", "--pretty=format:", sha], cwd)
    .stdout.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return { sha: full.slice(0, 12), subject, body, files };
}
