/**
 * chrome.mjs — find Chrome the way kane-cli does, plus the messy reality of
 * real laptops (e.g. "Google Chrome 2.app"). repro injects the result into
 * every kane-cli child process so nobody has to remember an export.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** @returns {{ path: string|null, nonStandard: boolean }} */
export function findChrome() {
  const env = process.env.KANE_CLI_CHROME_PATH;
  if (env && existsSync(env)) return { path: env, nonStandard: false };

  const standard =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "win32"
        ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];

  for (const p of standard) if (existsSync(p)) return { path: p, nonStandard: false };

  if (process.platform === "darwin") {
    const r = spawnSync("sh", ["-c", 'ls -d "/Applications/Google Chrome"*.app 2>/dev/null'], { encoding: "utf8" });
    const first = (r.stdout ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (first) {
      const bin = join(first, "Contents/MacOS/Google Chrome");
      if (existsSync(bin)) return { path: bin, nonStandard: true };
    }
  }
  return { path: null, nonStandard: false };
}

/** The env kane-cli needs, without clobbering an explicit setting. */
export function kaneEnv(extra = {}) {
  const found = findChrome();
  return {
    ...(found.path && !process.env.KANE_CLI_CHROME_PATH ? { KANE_CLI_CHROME_PATH: found.path } : {}),
    ...extra,
  };
}
