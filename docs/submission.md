# Submission — paste-ready copy

Form: https://www.kaneclihack.sh (log in → My submission). Deadline **Thu 19 Nov, 11:59 PM IST = 19:29 CET**. Submit by 17:00 CET.

---

## 01 · Your project

### Project name

> **repro**

⚠️ The field currently says `Ayodeji Alade` — that is your name, not the project.

### One-liner (limit 170)

> repro turns a bug report into a failing browser test, finds the commit that broke it, and won't call the fix done until Kane CLI exits 0.

### Project details (limit 1500)

> repro is a CLI that closes the loop between a coding agent and Kane CLI.
>
> You give it a bug report in plain English. It drafts a Kane objective — with network and console assertions, not just pixels — runs it in a real browser, and returns a typed verdict: pass or fail, result_code, the failing step, and the evidence pack.
>
> It then bisects the repository with git, replaying the flow at each probe, to name the exact commit that broke it. That commit's diff, Kane's failing step and the evidence path go into the agent's prompt. Nothing is paraphrased. The agent patches, Kane re-runs, and the loop only closes on exit 0.
>
> Who it is for: teams shipping with AI agents, where "done" is a claim rather than a fact. It is agent-agnostic — OpenCode by default, Claude Code or Codex with one flag.
>
> What Kane CLI does in the flow: it is the oracle at every step — executing the objective, producing the failure that starts the fix, replaying the flow for the bisect, and proving the fix at the end. Its result_code bands decide whether the agent may touch product code at all: an automation bug means fix the test, not the app.

### Anything else to add (optional)

> How the agent and Kane talk: repro spawns kane-cli with --agent and parses the NDJSON. It trusts exactly two things — the process exit code and the completion event (run_end for one-shot runs, test_md_done for saved tests). The fix prompt carries Kane's failing step remark, the evidence path and the culprit diff; the loop terminates on an exit code, never on the agent saying it is finished.
>
> What Kane caught: a saved-card checkout returned 500 while the page still rendered correctly — invisible to a screenshot test. Kane's network assertion caught it, and replay plus git bisect found the tokenizer refactor that had removed the saved-card branch.
>
> How to run it: `npx github:Deji-Techh/repro demo --fixtures` replays the recorded real run with zero credits and no login. The live loop is documented in the README: build the 20-commit demo repo, then doctor, verify, bisect --precheck, fix.
>
> What is next: PR comments from live runs (already working), MCP tools so any agent gets verify and bisect natively, and a coverage view on top of Kane's assurance commands.

### Attachments (optional, max 8 × 25 MB)

Suggested: a screenshot of the PR comment on pull/1, and this file. Both are optional; skip if time is short.

### Agent used

> OpenCode (opencode-go/deepseek-v4.1-flash). Kane CLI is the verification layer; Codex CLI is also supported as the fix agent.

---

## 02 · Show it

| Field | Value |
|---|---|
| YouTube demo video (3–5 min) | **NOT RECORDED YET** — shot list in [docs/launch.md](launch.md) |
| GitHub URL (public) | `https://github.com/Deji-Techh/repro` |
| Live URL (optional) | leave empty — there is no hosted app, and the demo needs no server |

---

## 03 · Launch buzz (required, ≥2 posts)

Paste **post links**, not profile links. One per field, comma-separated if several.

| Platform | Status |
|---|---|
| X | not posted yet |
| LinkedIn | not posted yet |
| Hacker News | optional third |
| Reddit | optional |
| Anywhere else | optional; extra posts earn brownie points |

Drafts: [docs/launch.md](launch.md).

---

## Pre-submit checklist

- [ ] Project name changed from `Ayodeji Alade` to `repro`
- [ ] One-liner pasted (≤170)
- [ ] Project details pasted (≤1500)
- [ ] Agent used filled
- [ ] YouTube link (3–5 min, public or unlisted)
- [ ] GitHub URL: https://github.com/Deji-Techh/repro
- [ ] At least 2 post URLs pasted
- [ ] Repo public and green: https://github.com/Deji-Techh/repro/actions
- [ ] No pushes to the repo after the deadline

## Facts to quote if asked

- Kane CLI **0.10.4**, Chrome 157, macOS arm64.
- Real runs: authoring 38–135 s (10–20 credits), replay 43–45 s (3 credits), bisect 4 probes (~6 min, ~30 credits), fix fail+pass 135 s + 63 s (16 credits).
- Credits spent for the whole build: ~300 of 11,200.
- Culprit commit in the demo: `8da72f8` "refactor: drop the legacy tokenizer".
- CI: harness self-test on every push, green in ~12 s, no credits — https://github.com/Deji-Techh/repro/actions/workflows/ci.yml
