#!/usr/bin/env node
/**
 * selftest — proves the harness without spending a credit.
 *
 * Uses scripts/fake-bin/kane-cli, which answers with the same NDJSON contract
 * and decides pass/fail from the working tree. If bisect finds commit 17 here,
 * the git plumbing is correct and only the real kane-cli is missing.
 *
 *   node scripts/selftest.mjs
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demo = resolve(root, ".repro-demo");
const fakeBin = resolve(root, "scripts/fake-bin");
chmodSync(resolve(fakeBin, "kane-cli"), 0o755);

function step(label, r) {
  const ok = r.status === 0;
  console.log(`${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}`);
  if (!ok) {
    console.log((r.stdout ?? "").slice(-2000));
    console.log((r.stderr ?? "").slice(-2000));
  }
  return ok;
}

const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

if (!existsSync(demo)) {
  console.log("building demo repo first…");
  const mk = spawnSync("node", [resolve(root, "scripts/make-demo-repo.mjs")], { encoding: "utf8" });
  if (mk.status !== 0) {
    console.error(mk.stderr || mk.stdout);
    process.exit(1);
  }
}

let pass = true;

pass = step("doctor sees kane-cli", spawnSync("node", [resolve(root, "src/cli.mjs"), "doctor"], { cwd: demo, env, encoding: "utf8" })) && pass;

const from = spawnSync(
  "node",
  [
    resolve(root, "src/cli.mjs"),
    "from",
    "--url",
    "http://localhost:4173/checkout",
    "--out",
    ".repro/from-ticket_test.md",
    "--ticket",
    "Checkout fails on my saved card.\nSteps to reproduce:\n1. Open the checkout page\n2. Keep the saved card selected\n3. Click Pay $48.00\nExpected result: the payment confirmation appears\nActual: Payment failed. Payment provider rejected the token",
  ],
  { cwd: demo, env, encoding: "utf8" },
);
pass = step("from turns a ticket into a test", from) && pass;
if (from.status === 0) {
  const body = spawnSync("cat", [resolve(demo, ".repro/from-ticket_test.md")], { encoding: "utf8" }).stdout;
  const good = /Go to http:\/\/localhost:4173\/checkout/.test(body) && /no network request returned a 5xx/.test(body);
  console.log(`${good ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} objective contains the URL and the silent-failure assertions`);
  if (!good) console.log(body);
  pass = good && pass;
}

rmSync(resolve(demo, ".repro"), { recursive: true, force: true });
rmSync(resolve(demo, "repro-report.md"), { force: true });

const bisect = spawnSync(
  "node",
  [
    resolve(root, "src/cli.mjs"),
    "bisect",
    "--test",
    "tests/checkout_saved_card_test.md",
    "--good",
    "HEAD~19",
    "--bad",
    "HEAD",
    "--max-probes",
    "8",
  ],
  { cwd: demo, env, encoding: "utf8" },
);
pass = step("bisect runs", bisect) && pass;
const expected = spawnSync("git", ["log", "--format=%H %s"], { cwd: demo, encoding: "utf8" })
  .stdout.split("\n")
  .filter((l) => l.includes("drop the legacy tokenizer"))
  .map((l) => l.split(" ")[0])[0]
  ?.slice(0, 12);
if (bisect.status === 0) {
  console.log(bisect.stdout);
  const found = bisect.stdout.includes(expected);
  console.log(
    `${found ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} culprit is the commit that introduced the bug (${expected.slice(0, 7)})`,
  );
  pass = found && pass;
}

console.log(pass ? "\n\x1b[32mharness ok\x1b[0m" : "\n\x1b[31mharness failed\x1b[0m");
process.exit(pass ? 0 : 1);
