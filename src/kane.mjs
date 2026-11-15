/**
 * kane.mjs — the only file that touches kane-cli.
 *
 * Contract:
 *   - spawn `kane-cli ... --agent`
 *   - read stdout as NDJSON (ignore anything that is not JSON)
 *   - check the PROCESS EXIT CODE first, then the last `run_end`
 *   - return a Verdict that the rest of the tool (and the fix agent) consumes
 *
 * Docs: a run refused before it starts can exit 2 with no run_end at all.
 * That is why exit code comes first.
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const EXIT = {
  0: { kind: "passed", label: "passed" },
  1: { kind: "failed", label: "ran-and-did-not-pass" }, // or upload failed
  2: { kind: "not-started", label: "did-not-start" },
  3: { kind: "timeout", label: "timeout-or-cancelled" },
};

/** Result-code bands. This routing is what keeps the loop from thrashing. */
export function routeResultCode(code) {
  if (code == null) return { band: "unknown", action: "inspect" };
  if (code >= 100 && code < 200) return { band: "success", action: "stop" };
  if (code >= 200 && code < 300) return { band: "cancelled", action: "stop" };
  if (code >= 300 && code < 400) return { band: "stuck", action: "fix-test" };
  if (code >= 400 && code < 500) return { band: "agent-error", action: "retry" };
  if (code >= 500 && code < 600) return { band: "infra", action: "fix-env" };
  if (code >= 600 && code < 700) return { band: "blocker", action: "fix-env" };
  if (code >= 700 && code < 800) return { band: "assertion", action: "fix-code" };
  return { band: "unknown", action: "inspect" };
}

/**
 * Kane's own triage beats our guesswork.
 *
 * `test_md_bug_verdict` is emitted by testmd runs and says whether the failure
 * is a confirmed product bug or an automation/test problem. If it is there, it
 * decides whether the agent is allowed to touch product code at all.
 * @param {{ resultCode?: number|null, bugVerdict?: any }} input
 */
export function routeVerdict({ resultCode, bugVerdict }) {
  if (bugVerdict && typeof bugVerdict === "object") {
    const family = String(bugVerdict.family ?? "");
    const category = String(bugVerdict.category ?? "");
    if (bugVerdict.confirmed === true) {
      return { band: "product-bug", action: "fix-code", why: bugVerdict.one_liner ?? category ?? family };
    }
    if (/automation|test|config|infra|environment|flaky/i.test(`${family} ${category}`)) {
      return { band: "test-bug", action: "fix-test", why: bugVerdict.one_liner ?? `${family}/${category}` };
    }
  }
  return routeResultCode(resultCode);
}

/**
 * Spawn kane-cli and stream/parse its NDJSON.
 * @param {string[]} args
 * @param {{ cwd?: string, onStep?: (step: any) => void, onEvent?: (ev: any) => void, env?: Record<string,string> }} [opts]
 * @returns {Promise<Verdict>}
 */
export function runKane(args, opts = {}) {
  const composed = [...args];
  if (!composed.includes("--agent")) composed.push("--agent");

  return new Promise((resolve, reject) => {
    const child = spawn("kane-cli", composed, {
      cwd: opts.cwd ?? process.cwd(),
      env: {
        ...process.env,
        // Attribute runs to this tool (documented env var).
        KANE_CLI_USER_AGENT: process.env.KANE_CLI_USER_AGENT ?? "repro",
        ...(opts.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    /** @type {any[]} */
    const events = [];
    const steps = [];
    let buf = "";

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return; // skip non-JSON
      }
      if (typeof ev !== "object" || ev === null) return;

      // Untyped step progress lines: they have `step` and no `type`.
      if (!ev.type && typeof ev.step === "number") {
        if (ev.status === "running") return opts.onStep?.(ev);
        steps.push(ev);
        opts.onStep?.(ev);
        return;
      }
      events.push(ev);
      opts.onEvent?.(ev);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });

    let stderrTail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      // Keep only the tail so we can explain failures without flooding.
      stderrTail = (stderrTail + chunk).slice(-6000);
    });

    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "kane-cli not found on PATH. Install it first:\n" +
              "  npm install -g @testmuai/kane-cli\n" +
              "  kane-cli login",
          ),
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (buf.trim()) handleLine(buf);

      // Surface-aware completion. `run` ends with run_end; `testmd` ends with
      // test_md_done and also emits step-level run_end events, which are NOT
      // the verdict for the file.
      const surface = composed[0];
      const isTestMd = surface === "testmd";
      const last = (type) => [...events].reverse().find((e) => e.type === type) ?? null;
      const completion = isTestMd ? last("test_md_done") ?? last("test_md_summary") : last("run_end");
      const nestedRunEnd = last("run_end");
      const bugVerdict = last("test_md_bug_verdict");
      const stepEnds = events.filter((e) => e.type === "test_md_step_end");
      const failedStepEnd = stepEnds.find((s) => s.status === "failed") ?? null;

      const status = completion?.overall_status ?? completion?.status ?? "not-started";
      const resultCode = completion?.result_code ?? nestedRunEnd?.result_code ?? null;
      const route = routeVerdict({ resultCode, bugVerdict });
      const exit = EXIT[code] ?? { kind: "unknown", label: `exit-${code}` };

      const variablesOut = nestedRunEnd?.variables_out ?? null;
      const finalState =
        completion?.final_state ??
        nestedRunEnd?.final_state ??
        (variablesOut
          ? Object.fromEntries(
              Object.entries(variablesOut).map(([k, v]) => [k, v && typeof v === "object" ? v.value : v]),
            )
          : null);

      const failingStep = isTestMd
        ? failedStepEnd
          ? {
              step: failedStepEnd.step_index,
              status: "failed",
              remark: nestedRunEnd?.reason ?? nestedRunEnd?.summary ?? "step failed",
            }
          : null
        : steps.find((s) => s.status === "failed") ?? null;

      /** @type {Verdict} */
      const verdict = {
        ok: code === 0 && status === "passed",
        exitCode: code,
        exitKind: exit.kind,
        exitLabel: exit.label,
        surface,
        status,
        resultCode,
        reasonCode: completion?.reason_code ?? nestedRunEnd?.reason_code ?? null,
        route,
        bugVerdict,
        summary: nestedRunEnd?.summary ?? completion?.summary ?? null,
        oneLiner: nestedRunEnd?.one_liner ?? bugVerdict?.one_liner ?? null,
        reason: nestedRunEnd?.reason ?? completion?.reason ?? null,
        durationS: completion?.duration_s ?? nestedRunEnd?.duration ?? null,
        credits: completion?.credits_consumed ?? nestedRunEnd?.credits_consumed ?? nestedRunEnd?.credits ?? null,
        finalState,
        testUrl: nestedRunEnd?.test_url ?? completion?.share_url ?? null,
        sessionDir:
          nestedRunEnd?.session_dir ??
          (completion?.session_id
            ? join(homedir(), ".testmuai/kaneai/sessions", completion.session_id, "evidence")
            : null),
        sessionId: completion?.session_id ?? null,
        conditionResults: completion?.condition_results ?? null,
        totals: completion?.steps ?? null,
        failingStep,
        steps: isTestMd ? stepEnds : steps,
        events,
        warnings: events.filter((e) => e.type === "warning"),
        stderrTail,
        argv: composed,
      };
      resolve(verdict);
    });
  });
}

/**
 * Objective runner (one-shot).
 * @param {string} objective
 * @param {{ url?: string, test?: boolean, timeoutS?: number, headless?: boolean, extra?: string[], cwd?: string }} [o]
 */
export function runObjective(objective, o = {}) {
  const args = ["run", objective];
  if (o.url) args.push("--url", o.url);
  if (o.headless !== false) args.push("--headless");
  if (o.timeoutS) args.push("--timeout", String(o.timeoutS));
  if (o.extra?.length) args.push(...o.extra);
  return runKane(args, { cwd: o.cwd });
}

/**
 * Replay a saved _test.md (cheap: cached steps do not re-author).
 * @param {string} file
 * @param {{ url?: string, timeoutS?: number, headless?: boolean, extra?: string[], cwd?: string }} [o]
 */
export function runTest(file, o = {}) {
  const args = ["testmd", "run", file];
  if (o.url) args.push("--url", o.url);
  if (o.headless !== false) args.push("--headless");
  if (o.timeoutS) args.push("--timeout", String(o.timeoutS));
  if (o.extra?.length) args.push(...o.extra);
  return runKane(args, { cwd: o.cwd });
}

/**
 * The live oracle: judge conditions against the current page. No objective,
 * no saved test, no upload.
 * @param {string[]} conditions
 * @param {{ cdpEndpoint?: string, cwd?: string, extra?: string[] }} [o]
 */
export function analyze(conditions, o = {}) {
  const args = ["run", "--analyzer-only"];
  for (const c of conditions) args.push("--condition", c);
  if (o.cdpEndpoint) args.push("--cdp-endpoint", o.cdpEndpoint);
  if (o.extra?.length) args.push(...o.extra);
  return runKane(args, { cwd: o.cwd });
}

/** @typedef {ReturnType<typeof buildVerdictType>} Verdict */

// JSDoc-only shape helper (no runtime effect).
function buildVerdictType() {
  return {
    ok: false,
    exitCode: 0,
    exitKind: "",
    exitLabel: "",
    surface: "",
    status: "",
    resultCode: null,
    reasonCode: null,
    route: { band: "", action: "", why: "" },
    bugVerdict: null,
    summary: null,
    oneLiner: null,
    reason: null,
    durationS: null,
    credits: null,
    finalState: null,
    testUrl: null,
    sessionDir: null,
    sessionId: null,
    conditionResults: null,
    totals: null,
    failingStep: null,
    steps: [],
    events: [],
    warnings: [],
    stderrTail: "",
    argv: [],
  };
}
