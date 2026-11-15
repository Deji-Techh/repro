/**
 * Creates .repro-demo/ — a throwaway git repo with 20 commits where commit 17
 * introduces a real, screenshot-invisible payment regression.
 *
 * Why a separate repo: `repro bisect` checks out other commits. You do not want
 * that happening in the repo you are actively building.
 *
 *   node scripts/make-demo-repo.mjs
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demo = resolve(root, ".repro-demo");
const BUG_AT = 17;

const git = (args, env = {}) =>
  spawnSync("git", args, {
    cwd: demo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Demo Dev",
      GIT_AUTHOR_EMAIL: "demo@northwind.test",
      GIT_COMMITTER_NAME: "Demo Dev",
      GIT_COMMITTER_EMAIL: "demo@northwind.test",
      ...env,
    },
    encoding: "utf8",
  });

const must = (r, label) => {
  if (r.status !== 0) throw new Error(`${label}: ${r.stderr || r.stdout}`);
  return r.stdout;
};

rmSync(demo, { recursive: true, force: true });
mkdirSync(demo, { recursive: true });
must(git(["init", "-q", "-b", "main"]), "git init");
must(git(["config", "commit.gpgsign", "false"]), "gpg off");

cpSync(resolve(root, "apps/demo-shop"), resolve(demo, "apps/demo-shop"), { recursive: true });
mkdirSync(resolve(demo, "tests"), { recursive: true });
mkdirSync(resolve(demo, "docs"), { recursive: true });

writeFileSync(
  resolve(demo, "package.json"),
  JSON.stringify(
    {
      name: "northwind-demo",
      private: true,
      type: "module",
      scripts: { start: "node apps/demo-shop/server.mjs" },
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  resolve(demo, "tests/checkout_saved_card_test.md"),
  `---
mode: testing
tags: [smoke, checkout]
url: http://localhost:4173/checkout
---

# Checkout with a saved card

## Pay with the saved card
Click "Pay $48.00" with the saved card selected.
Verify the payment confirmation is visible and shows an order number.
Assert: no network request returned a 5xx status.
Assert: there are no console errors.
`,
);

// The regression: the tokenizer loses its saved-card branch. Everything still
// renders; only the POST /api/pay response is wrong.
const buggyCart = `/**
 * cart.mjs — payment tokenization.
 */

const LIVE_PREFIX = "tok_live_";

/** @param {{ method: "saved"|"new", savedCard?: boolean, cardNumber?: string }} input */
export function tokenizeCard(input) {
  const digits = String(input?.cardNumber ?? "").replace(/\\D/g, "");
  if (digits.length < 12) return null;
  return LIVE_PREFIX + digits.slice(-4);
}

/** Subtotal helper (kept small on purpose). */
export function subtotal(items) {
  return items.reduce((sum, item) => sum + Number(item.price ?? 0), 0);
}
`;

const messages = [
  "chore: scaffold the demo shop",
  "docs: add run notes",
  "feat: add product grid",
  "style: spacing pass on the grid",
  "chore: tidy imports",
  "feat: add checkout page",
  "fix: keep the cart across navigation",
  "docs: note the saved-card test",
  "chore: bump node version note",
  "feat: add order id format",
  "refactor: extract subtotal helper",
  "style: tighten error banner",
  "docs: add troubleshooting section",
  "chore: remove unused styles",
  "fix: correct expiry placeholder",
  "docs: changelog for the release",
  "refactor: drop the legacy tokenizer", // <- BUG_AT
  "test: add smoke tags",
  "chore: release notes",
  "docs: link the test in the readme",
];

let d = new Date("2026-11-10T09:00:00Z");
for (let i = 1; i <= messages.length; i++) {
  d = new Date(d.getTime() + 3600_000);

  if (i === BUG_AT) {
    writeFileSync(resolve(demo, "apps/demo-shop/cart.mjs"), buggyCart);
  } else if (i > 1) {
    // Every other commit is a believable, harmless change.
    const notes = resolve(demo, "CHANGELOG.md");
    const prev = i > 2 ? spawnSync("cat", [notes], { encoding: "utf8" }).stdout : "# Changelog\n";
    writeFileSync(
      notes,
      `${prev}\n- (${String(i).padStart(2, "0")}) ${messages[i - 1]}\n`,
    );
    if (i % 4 === 0) {
      writeFileSync(
        resolve(demo, `docs/note-${i}.md`),
        `# Note ${i}\n\n${messages[i - 1]}\n`,
      );
    }
  }

  must(git(["add", "-A"]), "git add");
  const env = {
    GIT_AUTHOR_DATE: d.toISOString(),
    GIT_COMMITTER_DATE: d.toISOString(),
  };
  must(git(["commit", "-q", "-m", messages[i - 1]], env), `commit ${i}`);
}

const log = must(git(["log", "--oneline", "--reverse"], {}), "git log");
const culprit = must(git(["log", "--oneline", "-1", `HEAD~${messages.length - BUG_AT}`], {}), "culprit");

console.log(`\nCreated ${demo}`);
console.log(`  ${messages.length} commits, regression at commit ${BUG_AT}\n`);
console.log(log.split("\n").slice(0, 3).join("\n") + "\n...");
console.log(`\nKnown-bad commit: ${culprit.trim()}`);
console.log(`
Next steps:
  1. Start the shop:      (cd .repro-demo && PORT=4173 node apps/demo-shop/server.mjs)
  2. Author the test once (needs kane-cli login + credits):
       cd .repro-demo
       kane-cli run "Go to http://localhost:4173/checkout, click 'Pay $48.00' with the saved card,
                     then verify the payment confirmation is visible.
                     Assert: no network request returned a 5xx status.
                     Assert: there are no console errors." --name checkout_saved_card --agent
     Keep .testmuai/tests/checkout_saved_card_test.md and its output-<name>/ folder,
     move them to tests/, and commit:
       git add tests && git commit -m "test: author the saved-card repro"
  3. Bisect from this repo:
       cd .repro-demo
       repro bisect --test tests/checkout_saved_card_test.md \\
         --good HEAD~19 --bad HEAD \\
         --serve "PORT=4173 node apps/demo-shop/server.mjs" \\
         --ready-url http://localhost:4173/api/health
`);
