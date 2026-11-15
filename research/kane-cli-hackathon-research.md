# KaneCLI Online Hackathon — research + build options

Research date: **Sun 15 Nov 2026** · Sources: kaneclihack.sh, testmuai.com/docs (Kane CLI), Kane CLI cookbook, LambdaTest/kane-cli GitHub, `llms.txt`, `AGENTS.md`, npm registry (latest `@testmuai/kane-cli` = **0.10.4**).

---

## 1. Snapshot: what this event actually is

| | |
|---|---|
| Event | KaneCLI Online Hackathon, by TestMu AI (formerly LambdaTest) |
| Window | Thu 12 Nov → **Thu 19 Nov, 11:59 PM IST** |
| Deadline in your clock | 18:29 UTC = **10:29 AM PT** = **19:29 CET** (if you're on CET) |
| Time left from this doc | **~4 days 6 hours** |
| Prize pool | $3,000 cash — $1,500 / $1,000 / $500, each **+ $250 OpenAI credits** |
| Winners also get | 1:1 with founders, 3 months Kane CLI Pro, featured blog post |
| Everyone who ships | "Verified with Kane CLI" badge · everyone who submits: certificate |
| Team | Solo or up to 4 |
| Location | Anywhere |
| Credits | 10,000 free, claim with the **same email** as your TestMu AI account, valid 30 days |
| Repo rule | Repo must be **initialized on/after 12 Nov** — yours is 15 Nov, so you're clean |

**Submission = 5 things**

1. Public GitHub URL (no pushes after the deadline)
2. "About your app" — what you built, which agent, what Kane does
3. YouTube demo, **3–5 minutes**
4. Live URL — optional
5. **Launch buzz (required + bonus):** at least 2 public posts (HN, X, Reddit, LinkedIn)

> Practical read: this is a **4-day sprint with a video deadline**, not a 7-day one. The video and the two posts are pass/fail items that people forget until the last hour. Budget them.

---

## 2. The scoring function, decoded

Three **bars** must be cleared before anything else is scored:

1. It works end to end — not slides.
2. Kane CLI caught **or proved** something meaningful.
3. Your agent and Kane CLI **talked to each other**.

Then four dimensions, **25% each, averaged**:

| Dimension | What the judges are actually asking | How to win it |
|---|---|---|
| **Ships** 25% | Is there a real flow? | One command a stranger can run. A demo app. No manual setup steps in the video. |
| **Verified** 25% | Did Kane catch something real? | Show a **failure with evidence** (annotated screenshot, console/network proof), not just a green check. |
| **Closed loop** 25% | Does Kane's result drive the agent? | The agent's *next prompt* must contain Kane's failing step / `remark` / evidence path, and the loop must **terminate on a Kane exit code**. |
| **Craft** 25% | Would a dev install it tonight? | `npx` install, good README with a 30-second quickstart, typed errors, no "works on my machine", a demo mode that doesn't burn credits. |

**Tie-break order: Verified → Closed loop.** So when in doubt, make the *failure* the hero of the demo, and make the feedback loop explicit and visible on screen.

The event thesis, in their words: *"Agents write code fast but can't check their own work. Kane CLI closes that loop."* Anything that is a **wrapper around one green test** misses the point. The product must be **the loop itself**.

---

## 3. What Kane CLI actually is (the 5 primitives)

Forget the marketing. Functionally it is:

```
objective (plain English + URL)
   → drive real Chrome / iOS Simulator / Android Emulator / real device
   → step-by-step actions + assertions (DOM, network, console, cookies, storage, perf)
   → verdict: pass/fail + result_code + per-step remarks
   → sealed evidence pack (.evidence zip: screenshots incl. annotated, logs, failures)
   → optional upload to Test Manager (test_url)
```

And on top of that, five primitives you can compose:

| # | Primitive | Command surface | Why it matters for a hackathon |
|---|---|---|---|
| 1 | **One-shot run** | `run "<objective>" --agent` | The atom. NDJSON out, exit 0/1/2/3. |
| 2 | **Saved, replayable test** | `testmd run x_test.md` | Replays from cache in seconds, **no LLM cost**. Markdown, `@import`, tags, adaptive healing. |
| 3 | **Suite runner** | `testrun run --parallel N --tags …` | Many tests, one verdict, **one evidence pack**, local or `--remote` grid. |
| 4 | **Evidence** | `evidence serve / validate / merge` | The artifact. Screenshots + annotated screenshots + per-step console & network logs + failure records. |
| 5 | **Authoring / assurance** | `generate`, `context ingest/extract/review`, `design tests`, `cover`, `maintain reconcile` | Requirements → use-cases → acceptance criteria → scenarios → `_test.md`, plus **coverage: proven vs owed**. |

### The one detail most teams will miss: `--analyzer-only`

```
kane-cli run --analyzer-only --condition "the cart shows 3 items" \
                        --condition "no request returned 5xx" --agent
→ run_end.condition_results = [true, false]
```

No objective, no actions, **no saved test**, no upload. You get a boolean per condition, judged against the **current desktop browser page**. Exit 0 means *all conditions were judged*, not that they're true — so read the array, not the exit code.

This is a **live oracle**. It is the cheapest possible "is this true right now?" primitive, and almost nobody at a hackathon will build on it. (One unverified caveat — see §9: whether it can attach to an already-running Chrome via `--cdp-endpoint`. Spike it before betting on it.)

### Other under-used levers

- `--bug-detection continue` → confirmed **product bugs** arrive as `result_code 740` with a `verdict` object. That is "Kane caught a real bug" as **machine-readable data**, not a red X.
- `result_code` bands: `1xx` success, `3xx` stuck, `4xx` agent error, `5xx` infra, `6xx` blocker (captcha/paywall), `7xx` assertion error. **You can distinguish "the app is broken" from "the agent got stuck"** — that's the single most important thing for a feedback loop that doesn't thrash.
- `run_end.final_state` → values via the `store ... as 'x'` pattern. Extraction without scraping.
- `--variables`, `{{smart.random_email}}`, `{{secrets.*}}`, `{{totp.*}}` → real auth flows.
- `KANE_CLI_USER_AGENT=my-tool` → attribute runs to your tool. Free craft points.
- `testmd` replay is cheap → **anything that runs Kane many times is economically viable**.

---

## 4. What the docs imply but don't ship (your product surface)

These are gaps, not features:

1. **Nothing turns unstructured input into objectives.** Bug reports, support tickets, PR descriptions, docs, QA spreadsheets — all human noise. Kane needs a clean objective. *That translation layer doesn't exist as a product.*
2. **Nothing runs Kane at commit granularity.** `testmd` replay is fast and cheap; a bisect across 30 commits is ~5 runs. Nobody has packaged "which commit broke the user flow?"
3. **Nothing decides whether an agent's "done" is true.** Agents self-report success. `--analyzer-only` is a truth primitive with no consumer.
4. **Evidence is a file, not a workflow.** Packs are beautiful (annotated screenshots, per-step network logs) but you have to know to open them. Turning a pack into the *thing a human or agent acts on* is unbuilt.
5. **Coverage exists but is invisible.** `cover` reports proven-vs-owed per acceptance criterion. No UI, no PR surface, no agent loop around it.
6. **Failure → fix is manual.** The loop is documented as a human procedure ("read the failing step, fix, re-run"). Nothing enforces an attempt budget, captures the trajectory, or proves the fix.
7. **Cross-cutting regression is unowned.** If you change a prompt or a shared component, which of your 20 saved flows regressed? `testrun --parallel` can answer it; no tool asks it.

### What is already built — do **not** rebuild

- **Official GitHub Action** (`integrations/github-action/kane-cli-browser-run`): runs committed tests on PRs, posts a verdict comment with evidence.
- **Official agent skill** (`npx @testmuai/kane-cli-skill`) + `AGENTS.md` for Cursor/Copilot. It already teaches an agent the verify-and-fix loop.
- **Official how-tos**: verify-a-change, reproduce-a-bug, save-a-test, gate-ci.
- **`generate`** already writes test cases from one sentence.
- **Claude Code status strip** already shows live step progress.

So: a plain "PR bot with a Kane comment" is redundant, and "AI writes your tests" is redundant. Build **above** those.

---

## 5. Idea catalog (scored)

Scores are 0–5. `Feas.` = can *you* ship it reliably in ~3.5 build days, solo/duo. `Nov.` = novelty vs. the ideas the judges already listed on the page.

| # | Idea | Ships | Verified | Loop | Craft | Feas. | Nov. | Total |
|---|---|---|---|---|---|---|---|---|
| **1** | **Repro** — bug report → failing Kane test → culprit commit → agent fix → proof | 5 | 5 | 5 | 5 | 4 | 4 | **28** |
| **2** | **Truth Server** — MCP/HTTP oracle over `--analyzer-only`, so any browser agent can ask "is this true?" | 4 | 5 | 5 | 5 | 2 | 5 | **26** |
| **3** | **Claimcheck** — assurance ledger: agent claims → ACs → proofs, proven vs owed | 4 | 5 | 4 | 5 | 3 | 4 | **25** |
| **4** | **Hydra Arena** — fault injector + Kane referee + agent fixer, live MTTR dashboard | 5 | 5 | 4 | 4 | 3 | 2 | **23** |
| **5** | **Blame** — pure `git bisect` on autopilot (subset of #1) | 5 | 4 | 4 | 4 | 5 | 2 | **24** |
| **6** | **Parity** — one objective, web + iOS sim + Android emulator, same verdict | 4 | 4 | 3 | 5 | 2 | 3 | **21** |
| **7** | **X-ray** — silent-failure scanner (console/network/cookies/storage/perf) across routes | 5 | 4 | 2 | 4 | 5 | 2 | **22** |
| **8** | **Docs Lie Detector** — run the README/spec, report false claims | 4 | 4 | 3 | 4 | 4 | 3 | **22** |
| **9** | **Prompt Regress** — change a prompt/system, find which saved flows regressed | 4 | 4 | 3 | 4 | 4 | 4 | **23** |

Why the top three sit on top:

- **Repro** has a deterministic spine (git + replay), a failure-first demo, and three distinct "Kane caught something" moments. Its weakness is that "bisect" is on the judges' suggested list — fix that by making the *report* the product, not the bisect.
- **Truth Server** has the highest ceiling and the best narrative ("agents lie about being done"), but it depends on one unverified technical assumption. Highest risk, highest reward.
- **Claimcheck** is the most judge-aligned (TestMu engineers built `cover`; nobody will demo it well), but LLM claim extraction is the flakiest core.

Skip #5 as a standalone — it's Act 2 of #1. Skip #4 unless your demo app already exists. #7 is a great 60-second *segment* inside another project, not a project.

---

## 6. Primary recommendation: **Repro**

> **One line:** paste a bug report, get a failing browser test, the commit that broke it, a fix from your agent, and a proof it's fixed.

Working name options: `repro`, `casefile`, `blame`, `regress`.

### Why this one

- **It is literally the event thesis.** "Agents can't check their own work" → Repro is the checker.
- **Three acts, three Kane proofs.** Each act has a visible failure and a visible piece of evidence. The video writes itself.
- **Cheap.** Act 2 uses `testmd` replay (cache, no LLM cost). Act 1/3 author only when needed.
- **Deterministic core.** Bisect is arithmetic; the only nondeterminism is the agent's patch, which is bounded by an attempt budget.
- **Installable tonight.** `npx repro init` in any repo; works on any web app; doesn't require a specific framework.
- **Not a duplicate** of the official GitHub Action: the Action runs tests you already committed. Repro **manufactures** the test from prose, finds the culprit, and closes the loop.

### The three acts (this is also the video)

```
ACT 1 — REPRODUCE
  $ repro from "Checkout shows 'Payment failed' when I use a saved card on Safari"
  → drafts objective + writes tests/checkout_saved_card_test.md
  → kane-cli run "<objective>" --name checkout_saved_card --agent
  → FAIL (exit 1, result_code 7xx) + evidence pack
  → "Reproduced. 1 failing step, annotated screenshot, 1 network 500."

ACT 2 — BLAME
  $ repro bisect --good v1.4.0 --bad HEAD --test tests/checkout_saved_card_test.md
  → 24 commits, 5 runs, replaying from cache
  → culprit: 9f3c2a1  "refactor: card tokenizer"
  → per-commit evidence, one pack per probe

ACT 3 — CLOSE
  $ repro fix --agent claude
  → agent gets: failing step remark + annotated screenshot path + culprit diff
  → patch → testmd re-run → PASS
  → writes report.md, PR comment with before/after, evidence links
  → exit 0 only when Kane says 0
```

### The loop contract (make this explicit — it's the 25%)

Define one typed object that only Kane can produce, and make it the agent's input:

```ts
type Verdict = {
  status: "passed" | "failed";
  result_code: number;        // 1xx..7xx
  failing_step?: { index: number; remark: string };
  evidence: string;           // path to .evidence
  test_url?: string;
  final_state?: Record<string, string>;
  credits: number;
};
```

Rules that prove "closed loop" to a judge:

1. The fix prompt **always** contains `failing_step.remark` + `evidence` + the culprit diff. No hand-written hints.
2. The loop stops on **exit code**, never on the agent saying "done".
3. Distinguish `7xx` (product genuinely broken → fix code) from `3xx/4xx/5xx/6xx` (test/agent/infra problem → fix the test, don't "fix" the app). Print that decision. This one rule is the difference between a toy and a tool.
4. Cap attempts (3). On failure, emit a report that says *what was tried* — judges respect honesty more than infinite retries.

### Architecture (boring on purpose)

```
repro/
  cli.ts            # commander: init | from | verify | bisect | fix | report | demo | mcp
  kane.ts           # spawn kane-cli, parse NDJSON, typed Verdict, exit-code mapping
  agent.ts          # headless claude/codex adapter + prompt template
  bisect.ts         # git bisect run wrapper, per-probe evidence dir
  report.ts         # report.md + PR comment via gh + evidence serve links
  fixtures/         # recorded NDJSON + evidence packs for --demo (no credits)
```

- Node 24 is already installed; Chrome is present; `kane-cli` is **not installed yet** (see §8).
- `kane.ts` is the whole product. Get it right: stream lines, ignore unknown fields, take the last `run_end`, check process exit first.
- **`repro demo --fixtures`** replays recorded NDJSON and bundled `.evidence` packs. Judges can evaluate with **zero credits and zero login**. That is a craft 5/5 move.

### Stretch (only if Act 1–3 are solid by Wed noon)

- `repro mcp` — expose `verify(objective)`, `bisect(test, good)`, `evidence(run)` as MCP tools so any agent gets the loop natively.
- `--bug-detection continue` in Act 1 so the report carries Kane's `verdict` object (`result_code 740`).
- Coverage line in the report via `kane-cli cover` if you have a `context` graph.

---

## 7. Four-day plan (deadline 19 Nov 19:29 CET)

**Today, Sun 15 — setup + decision (≈4h). Do not write product code before this.**

- [ ] Register TestMu AI + claim 10,000 credits (**same email**), then `npm i -g @testmuai/kane-cli`, `kane-cli login`, `kane-cli whoami`, `kane-cli balance`.
- [ ] Run the five spikes in §8. Time each one and record credits per run.
- [ ] Create the demo app + a **deliberately broken commit** (a real bug in a real flow).
- [ ] Decide: Repro vs Truth Server (only switch if the analyzer spike is spectacular).
- [ ] Add `.gitignore` (`.testmuai/`, `node_modules`), `AGENTS.md` (curl the official one), README skeleton with the pitch.

**Mon 16 — Act 1 + the spine.** `kane.ts` (NDJSON → `Verdict`), `repro from`, `repro verify`, failing test on screen, evidence opens. Cut Act 2 entirely for the day if needed.

**Tue 17 — Act 2 + Act 3.** `bisect` (5–7 probes, per-probe evidence), agent adapter, attempt budget, `report.md`. First full run of all three acts end to end.

**Wed 18 — craft + assets.** README quickstart, `--demo` fixtures, PR comment, error messages, `KANE_CLI_USER_AGENT=repro`. **Record the video Wednesday night** — do not leave it for Thursday. Write both posts.

**Thu 19 — submit early.** Final verification run, push, submit by **17:00 CET** (2.5h buffer), then publish posts. No pushes after 19:29 CET.

---

## 8. Day-0 spikes (each < 20 min, in this order)

| # | Spike | Command | What you're proving |
|---|---|---|---|
| 1 | Auth + credits | `kane-cli login` → `whoami` → `balance` | You are not blocked by the "upgrade to unlock" gate in your screenshot |
| 2 | The atom | `kane-cli run "Go to <demo> and …" --agent --headless` | NDJSON parses; `run_end` shape; exit code; **credit cost** |
| 3 | Replay cost/speed | `--name flow` → `testmd run` twice | Second run is fast & ~free — this is what makes bisect viable |
| 4 | **Analyzer oracle** | open page in Chrome → `run --analyzer-only --condition "…" --agent`; repeat with `--cdp-endpoint http://localhost:9222` | Whether it judges the **live** page or a fresh one. Gate for the Truth Server idea |
| 5 | Evidence | `kane-cli evidence serve <pack>` | The pack is as good as advertised; you can link it in a report |

Also check in Slack: *"Do I need a paid Kane CLI plan to run the CLI during the hackathon?"* — the page has that FAQ but the answer is collapsed, and your screenshot shows a lock. Resolve it on day 0, not day 3.

---

## 9. Risks and how to defuse them

| Risk | Reality | Defuse |
|---|---|---|
| **CLI locked behind a plan** | Your screenshot shows "Book a demo or upgrade your plan to unlock Kane CLI" with 1K credits | Claim the 10k offer; ask in Slack immediately; have basic-auth (`--username/--access-key`) ready for CI |
| **Credits burn** | ~10–50 credits per authored run; 10k ≈ 200–500 runs | Replay (`testmd`) for anything repeated; bisect on replay; cache `run_end` for the demo |
| **Agent nondeterminism** | The fix may not land on attempt 1 | Bounded attempts, honest report, and a demo app with a *solvable* bug. Record the video on a run that worked |
| **Judge can't run it** | No credits, no login, no Chrome | `repro demo --fixtures` — recorded NDJSON + bundled packs, no network |
| **"You just wrapped Kane"** | Fair criticism | The value is the loop contract: typed verdict, result_code routing, attempt budget, culprit attribution. Show the code that *decides* |
| **Analyzer oracle doesn't attach to live Chrome** | Unverified | Spike #4. If it fails, Truth Server becomes "verify after the fact", which is just `run` — pick Repro instead |
| **Video crunch** | 3–5 min, must show a failure | Record Wed. Script in §10. Two takes minimum |

---

## 10. Demo video storyboard (3:30)

| Time | Beat | On screen |
|---|---|---|
| 0:00 | Hook | "An AI agent told me checkout was done. It wasn't." Show the green agent message, then the bug. |
| 0:25 | Setup | `npx repro init` in a real repo. One command. |
| 0:45 | Act 1 | Paste the bug report → test file appears → Kane runs visibly → **FAIL** → open the annotated screenshot + the 500 in the network log. Say the exit code and `result_code`. |
| 1:30 | Act 2 | `repro bisect` → 24 commits → 5 probes → culprit commit with the diff. Show that each probe produced a pack. |
| 2:15 | Act 3 | Agent receives the failing step + evidence + diff → patch → re-run → **PASS**. Show the `run_end` line and `test_url`. |
| 2:50 | Proof | `report.md` + PR comment, before/after, evidence links. Mention `--demo` (no credits needed). |
| 3:10 | Why it matters | "Kane isn't the test runner here. It's the definition of done." |
| 3:20 | Close | Repo URL, install line, the two Kane features you leaned on. |

---

## 11. Launch buzz (required)

Minimum: 2 public posts. Best mix: **X (with the 60s clip) + LinkedIn (the story) + HN Show HN (the tool)** — 3 posts, 2 platforms, one link.

- Post the *failure* frame, not the green check. "My agent said done. Kane said no." Screenshots of the annotated evidence pack travel further than terminal output.
- Tag @TestMuAI / LambdaTest and use the event hashtag if there is one.
- HN title: `Show HN: Repro – turn a bug report into a failing browser test and the commit that broke it`. Be in the thread for the first 2 hours.

---

## 12. Open decisions

1. **Team size / who does what?** (video + posts are ~half a day of work)
2. **Demo app:** build a fresh checkout app (full control, ~4h) or use an existing OSS app (faster, less control over the bug)?
3. **Which agent in the loop?** Claude Code headless / Codex CLI / your own harness — whichever you can spawn unattended and demo live.
4. **Repro vs Truth Server?** Decided by spike #4 tonight.

---

## 13. One-paragraph elevator pitch (for the submission form)

> Every coding agent now claims "done". None of them can prove it. **Repro** turns a plain-English bug report into a replayable browser test, uses Kane CLI's cheap replay to bisect to the exact commit that broke the flow, hands the agent Kane's failing step, annotated screenshot and per-step network log, and refuses to call the job finished until a fresh Kane run exits 0. Kane isn't our test runner — it's our definition of done.

---

## Appendix: spike log, 15 Nov (what actually happened)

Real runs, real chrome, kane-cli **0.10.4**, ~220 credits of the 10,000 burned on the whole spike.

| Spike | Result |
|---|---|
| Install | `npm i -g @testmuai/kane-cli` **failed** the first time (10 min, `TAR_ENTRY_ERROR` on the darwin-arm64 optional package, left the package dir empty). A retry with `--force` worked in 2 min. Budget for one retry. |
| Chrome | Not at `/Applications/Google Chrome.app` on this machine — it's `Google Chrome 2.app`. Kane needs `KANE_CLI_CHROME_PATH=/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome`. `repro doctor` detects and prints this. |
| Auth | `kane-cli login --oauth` completed in-browser, auto-selected a Test Manager project + folder, no plan gate. Balance: **11,200 credits**. |
| `run` | Works. NDJSON as documented. Real `result_code`s seen: **740** (bug-ish) and **750** (`assertion_error.step_not_achievable`) — **750 is not in the published code table**, a good reminder to handle unknown codes by band. |
| `testmd` | Different contract: `test_md_done` / `test_md_summary` / `test_md_step_end` / `test_md_bug_verdict`, plus *step-level* `run_end` events with no `result_code`. Treating the last `run_end` as the file verdict is wrong. |
| Replay cost | **3 credits, ~45 s** vs 10–20 credits / 40–140 s for authoring. The economics hold. |
| Replay reliability | One recorded checkout flow reported failure at step 8 **while its own captured checks passed**; Kane triaged it itself as `family: automation_bug, confirmed: false`. Useful signal, but it means replay is not always a trustworthy bisect probe. |
| `bisect` | With authoring-mode probes + `--precheck`: 6 runs, ~6 min, found the exact commit (`refactor: drop the legacy tokenizer`) and the file (`apps/demo-shop/cart.mjs`). |
| `fix` | Not closed on the first attempt for a non-obvious reason: the dev server keeps the old module in memory, so a patch on disk is invisible to the re-verify. **Restart the app around every attempt.** After that fix: attempt 1 fails (135 s, 10 cr) → agent reverses the culprit diff → attempt 2 passes (42 s, 6 cr), `final_state` = `{payment_confirmation_visible: true, network_request_5xx_status: false, console_errors: false}`. |
| `--analyzer-only` | Not spiked in depth yet. Still the highest-ceiling primitive if it can attach to a long-lived Chrome via `--cdp-endpoint`; verify before choosing the Truth Server idea. |

**Net:** the loop from §6 is not a plan any more — it runs. What's left is packaging: PR comment, fixture-based demo mode, and the video.

### Spike log addendum (same day, later)

- **`--analyzer-only` works against a live browser.** Launched Chrome with `--remote-debugging-port=9222`, pointed `run --analyzer-only --cdp-endpoint http://localhost:9222` at it, and got `condition_results` for the page that was already open: `[true, null, true]`. No objective, no saved test, no upload. This is the live-oracle primitive, and it means the **Truth Server** idea is technically viable. Note: a condition the judge cannot decide comes back missing (exit `1`), not `false` — so consumers must distinguish *false* from *unknown*.
- **Codex CLI install is fragile.** `npm i -g @openai/codex` reported success but skipped the `@openai/codex-darwin-arm64` optional package (twice), because the platform builds are published as *versions* of the same package (`0.169.0-darwin-arm64`), not as separate names. Fix: fetch that tarball and drop it at `@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/<triple>/bin/codex`.
- **Kane's bug verdict is not stable run to run.** Identical failing flow → `automation_bug` once, `confirmed product bug` (740) the next time. Use `result_code` as the primary router; use the bug verdict only as a veto.
- **Tracked replay output dirties the tree on every run.** `output-<stem>/Result.md` and `.internal/*` are rewritten by each replay, which blocks `git checkout` and `bisect`. Either commit them after runs or untrack them (the demo repo now does the latter).
