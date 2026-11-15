# Launch kit — everything that is yours to do

Deadline: **Thu 19 Nov, 11:59 PM IST = 19:29 CET**. Submit by 17:00 CET with a buffer.

---

## 1. Video shot list (3:30, record Wed)

Record at 1440p if you can; terminal font 16pt minimum; hide notifications.

| Time | Say | Show |
|---|---|---|
| 0:00 | "An AI agent told me checkout was done. It wasn't." | The agent's "done" message, then the broken checkout |
| 0:20 | "Kane CLI runs a real browser and gives a verdict. Repro is the loop around it." | `node src/cli.mjs doctor` → 6 green rows |
| 0:35 | "Here's a real bug report." | Paste the ticket, run `repro from …`, then the generated test file |
| 0:50 | "Kane runs it. This is the verdict, not an opinion." | `repro verify …` → FAIL 740, step 5, evidence path |
| 1:15 | "The page looks fine. The network isn't." | Open the evidence pack: annotated screenshot + the 500 on `/api/pay` |
| 1:40 | "24 commits. Which one?" | `repro bisect --precheck …` → 4 probes → culprit `8da72f8` |
| 2:15 | "The agent never sees a paraphrase. It gets Kane's failing step and that diff." | `repro fix … --culprit …` → prompt file contents |
| 2:40 | "Codex patches it. Kane decides when we're done." | Codex edits `cart.mjs`, second verify → PASS 100, `final_state` |
| 3:05 | "That's the report a reviewer gets." | `repro-report.md`, before/after, Test Manager link |
| 3:20 | "Kane isn't the test runner. It's the definition of done." | Repo URL + `repro demo --fixtures` |

Backup: if Codex flakes on camera, cut to `repro demo --fixtures` (recorded real run, zero credits) and say so.

---

## 2. Posts (need 2; three is better)

### X / Twitter

> Every coding agent now says "done". None of them can prove it.
>
> So I built **repro**: a bug report becomes a failing browser test, Kane CLI bisects to the commit that broke it, the agent gets Kane's failing step + the culprit diff, and the loop only closes on `exit 0`.
>
> Real numbers from the demo: 4 probes to find the culprit, 42s to prove the fix.
>
> `npx github:Deji-Techh/repro demo --fixtures` ← watch it with zero credits
>
> Built for the @TestMuAI Kane CLI hackathon.

### LinkedIn

> The most expensive sentence in AI coding right now is "it should work".
>
> Agents write code fast and cannot check their own work. Kane CLI closes that gap — it drives a real browser and returns a verdict backed by evidence. But the loop around it was still manual: write the objective, read the failure, find the regression, prompt the agent, run it again.
>
> I built **repro** for the KaneCLI Online Hackathon:
>
> 1. A bug report becomes a runnable browser test
> 2. Kane's cheap replay bisects to the exact commit that broke the flow
> 3. The agent's prompt carries Kane's failing step, the evidence pack and that commit's diff
> 4. Nothing is "done" until Kane exits 0
>
> Two details that mattered: Kane triages its own failures (it will tell you "automation bug, don't touch product code"), and a patched file is invisible to a running dev server — so repro restarts your app around every attempt.
>
> Demo runs on recorded evidence, no account needed: github.com/Deji-Techh/repro

### Show HN

Title: `Show HN: Repro – a bug report becomes a failing browser test and the commit that broke it`

Body: what it does, the 3-act loop, the two findings above, one command to watch the recorded run, honest note that it is 4 days old and built on Kane CLI. Answer every comment for 2 hours.

---

## 3. Submission checklist

- [ ] Public repo: https://github.com/Deji-Techh/repro
- [ ] About text (paste, 120 words):

> Repro turns a plain-English bug report into a replayable browser test, uses Kane CLI's cached replay to bisect to the exact commit that broke the flow, hands the coding agent Kane's failing step, evidence pack and the culprit diff, and refuses to call the job finished until a fresh Kane run exits 0. Kane's own bug verdict decides whether the agent may touch product code at all, so an automation bug never gets "fixed" by weakening the app. Built with Codex as the fix agent, Claude/any CLI can be swapped in with one flag. Demo mode replays a recorded real run with zero credits.

- [ ] YouTube demo (3–5 min, unlisted-then-public is fine)
- [ ] Live URL — optional; skip unless it is trivial
- [ ] Two posts live (link them in the form)
- [ ] Submit before **17:00 CET Thu 19 Nov**
- [ ] No pushes after 19:29 CET

---

## 4. One command to sanity-check before you record

```bash
cd .repro-demo
PORT=4173 node apps/demo-shop/server.mjs &        # leave running
node ../src/cli.mjs demo --fixtures                # what the loop looks like
node ../src/cli.mjs doctor                         # 6 green rows
```
