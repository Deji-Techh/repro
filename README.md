# repro

**Turn a bug report into a failing browser test, the commit that broke it, and a proven fix.**

Kane CLI is the oracle. An agent is the hands. `repro` is the loop between them.

```
bug report ──► failing _test.md ──► commit that broke it ──► agent patch ──► Kane exit 0
    ▲                                                                          │
    └──────────────────────── evidence, not opinions ─────────────────────────┘
```

---

## Why

Every coding agent now says "done". None of them can prove it. Kane CLI can test anything in a real browser and it emits a sealed evidence pack — but somebody still has to write the objective, run it, read the failure, find the regression, prompt the agent, and run it again.

`repro` is that loop, as a command:

- it **manufactures** the test from noisy human input (a ticket, a Slack message, a bug report)
- it **bisects** using cached replays, so finding the guilty commit is cheap
- it hands the agent **Kane's own failure** — step remark, annotated screenshot, network log — not a paraphrase
- it refuses to declare victory until `kane-cli` exits `0`

## Quickstart

```bash
# 1. once per machine
npm install -g @testmuai/kane-cli
kane-cli login          # OAuth in your browser
kane-cli balance        # runs cost credits; replays are cheap

# 2. check everything (no install, straight from the repo)
npx github:Deji-Techh/repro doctor
#    or, from a clone: node src/cli.mjs doctor

# 3. a bug report becomes a runnable test
repro from --url http://localhost:3000/checkout --ticket "$(cat bug.md)" --out tests/checkout_test.md

# 4. run it. this is the verdict.
repro verify --test tests/checkout_test.md

# 5. which commit did it?
repro bisect --test tests/checkout_test.md \
  --good v1.4.0 --bad HEAD --precheck \
  --serve "npm run dev" --ready-url http://localhost:3000

# 6. let the agent fix it, with the culprit diff in hand, and prove the fix
repro fix --test tests/checkout_test.md \
  --culprit "$(git rev-parse HEAD)" \
  --serve "npm run dev" --ready-url http://localhost:3000 \
  --agent-cmd 'claude -p {prompt}'
```

No Kane credits yet? Run the harness self-test — it exercises the exact same code paths against a stand-in runner:

```bash
node scripts/make-demo-repo.mjs
node scripts/selftest.mjs
```

## What the verdict looks like

```
FAIL  ·  exit 1 (failed)  ·  result_code 720  ·  band assertion → fix-code  ·  41.2s  ·  23 credits
   Saved-card checkout fails with a 500
   failed step 2: assert: no network request returned a 5xx status — POST /api/pay returned 500
   evidence: ~/.testmuai/kaneai/sessions/1a2b…/evidence
```

`repro` reads `kane-cli`'s contract exactly as documented:

| Kane output | How repro uses it |
|---|---|
| process exit `0/1/2/3` | the only thing that can close a loop (`2` = nothing ran, so it never counts as a pass) |
| `run_end.result_code` | routes the next action: `7xx` → fix code · `3xx` → fix the test · `4xx` → retry · `5xx/6xx` → fix the environment |
| `run_end.failing_step.remark` | goes into the agent's prompt verbatim |
| `run_end.session_dir` | linked as evidence in the report and the PR comment |
| `run_end.test_url` | linked for humans |
| `testmd` replay | makes bisect cheap: unchanged steps replay from cache |

The `7xx` vs `3xx` split is the difference between a tool and a slot machine: it means the agent is not asked to "fix the code" when the real problem is a wrong selector, a missing login, or a captcha.

## Commands

| Command | What it does |
|---|---|
| `repro doctor` | node, git, kane-cli, Chrome (including non-standard paths), auth, credits |
| `repro from --ticket … --url …` | drafts an objective + `_test.md`, with silent-failure assertions baked in |
| `repro verify --test …` | replay a saved test, print the verdict, `--json` for machines |
| `repro verify --url … --objective …` | one-off run, no test file |
| `repro analyze --condition …` | live oracle via `--analyzer-only`: booleans for the current page, no test saved |
| `repro bisect --good … --bad … --test …` | binary search with per-probe evidence; restarts your dev server per commit |
| `repro fix --test …` | verify → prompt the agent → re-verify, with an attempt budget and an honest report |
| `repro report` | prints `repro-report.md` |

## The loop contract

A fix is only accepted when all of this is true:

1. the prompt contains Kane's failing step, evidence path and the culprit diff — nothing hand-written
2. the loop terminates on the **process exit code**, never on the agent's message
3. attempts are capped (default 3); a failed loop still produces a report of everything tried
4. a non-`7xx` failure stops the loop instead of "fixing" the app to satisfy a bad test

## Demo

```bash
node scripts/make-demo-repo.mjs     # 20 commits, one real regression at commit 17
cd .repro-demo
node apps/demo-shop/server.mjs      # http://localhost:4173
```

The regression is narrow on purpose: paying with a **new** card still works, paying with the **saved** card returns `500`. Nothing in the UI looks broken — the confirmation simply never appears. That is the class of bug a screenshot test cannot see, and the reason the objective asserts on the network and console, not just the pixels.

## Measured, on this machine

Not estimates — this is the actual demo, run against real Kane CLI 0.10.4 in real Chrome.

| Step | Wall clock | Credits |
|---|---|---|
| author the flow (`run`, passes) | 38 s | 13 |
| author the flow (`run`, fails on the regression) | 135 s | 10 |
| replay a saved `_test.md` | 43–45 s | 3 |
| `bisect` with `--precheck` (6 runs total) | ~6 min | ~30 |
| `fix` — failing verify + patched verify | 135 s + 42 s | 16 |

The whole demo costs less than 1% of the 10,000 hackathon credits.

Two findings worth knowing before you build on this:

1. **Replay triage is real, and it is useful.** On a failing replay, Kane emits `test_md_bug_verdict`. If it says `confirmed: false, family: automation_bug`, the *test* is wrong, not the app — so `repro fix` refuses to touch product code and tells you to fix the test instead.
2. **Replay is not always a trustworthy probe.** One recorded checkout flow reported failure at step 8 while its own captured checks said the confirmation appeared and no 5xx was seen. That is why `bisect` supports authoring mode (`--objective`) as well as replay mode, and why `--precheck` exists: it runs both ends of the range first and refuses to bisect a range that does not actually bracket the bug.

## Status

Working today, verified against real Kane runs: `doctor`, `from`, `verify`, `analyze`, `bisect` (replay or authoring mode, with `--precheck`), `fix` (server restart per attempt, bug-verdict routing, culprit diff in the prompt), `report`, self-test, demo repo + demo shop.

Next, in order:

- a PR comment with before/after evidence links (`gh pr comment`)
- `--bug-detection continue` in Act 1, so the report carries Kane's confirmed-bug `verdict` even when a step passes
- `repro demo --fixtures` — replay recorded NDJSON so judges can evaluate with zero credits
- `repro mcp` — expose `verify`, `bisect`, `evidence` as MCP tools so any agent gets the loop natively

## Notes

- Chrome at a non-standard path? `export KANE_CLI_CHROME_PATH="/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome"`. `repro doctor` detects this for you.
- `repro` never stores credentials. Sign-in is `kane-cli`'s job.
- Runs are attributed with `KANE_CLI_USER_AGENT=repro`.
- Repo built during the KaneCLI Online Hackathon (Nov 2026). See [research/kane-cli-hackathon-research.md](research/kane-cli-hackathon-research.md).

MIT.
