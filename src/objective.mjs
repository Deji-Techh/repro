/**
 * objective.mjs — the translation layer.
 *
 * Kane needs a clean objective. Humans give you noise: a bug report, a ticket,
 * a Slack message, half a stack trace. This turns the noise into something
 * kane-cli can run, and is explicit about what it could not infer.
 *
 * Deterministic on purpose: no hidden model call, no surprise cost. Pass
 * `--agent-cmd` to a fix agent afterwards if you want the LLM to refine it.
 */

const NOISE = [
  /^(hi|hey|hello)[,!.\s]/i,
  /^(thanks|thank you)[!.\s]*$/i,
  /^(fyi|btw)[,:]?\s*/i,
  /^(bug|issue|ticket)\s*[:#-]\s*/i,
  /^(steps to reproduce|repro steps|expected( result)?|actual( result)?|environment)\s*:?\s*/i,
];

/** @param {{ ticket: string, url?: string }} input */
export function objectiveFromTicket({ ticket, url }) {
  const text = String(ticket ?? "").trim();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !NOISE.some((re) => re.test(l)));

  const start = url ?? extractUrl(text);
  if (!start) {
    throw new Error(
      "No URL found in the ticket. Pass --url https://… (Kane needs a start URL; a non-interactive run with none refuses to start.)",
    );
  }

  const expected = pickExpected(lines) ?? "the flow completes without an error";
  const actions = pickActions(lines);
  const errorish = pickError(lines);

  const parts = [`Go to ${start}`];
  if (actions.length) parts.push(...actions.map((a) => ensureSentence(a)));
  else parts.push("Reproduce the reported flow described in the ticket.");
  if (errorish) parts.push(`Reproduce the reported failure: ${ensureSentence(errorish)}`);
  parts.push(`Verify ${ensureSentence(expected)}`);
  parts.push("Assert: no network request returned a 5xx status.");
  parts.push("Assert: there are no console errors.");

  return parts.join("\n");
}

function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s)\]"'<>]+/);
  return m ? m[0].replace(/[.,;:]+$/, "") : null;
}

function pickExpected(lines) {
  const idx = lines.findIndex((l) => /^expected\b/i.test(l));
  if (idx >= 0) {
    const inline = lines[idx].replace(/^expected\s*(result)?\s*:?\s*/i, "").trim();
    if (inline) return inline;
    if (lines[idx + 1]) return lines[idx + 1];
  }
  const want = lines.find((l) => /\bshould\b/i.test(l));
  return want ? want.replace(/^.*?\bshould\b\s*/i, "it should ") : null;
}

function pickActions(lines) {
  const idx = lines.findIndex((l) => /^(steps to reproduce|repro steps)\s*:?/i.test(l));
  const numbered = lines
    .map((l) => l.match(/^(?:\d+[.)]|[-*])\s+(.*)$/))
    .filter(Boolean)
    .map((m) => m[1]);
  if (idx >= 0) {
    const slice = lines.slice(idx + 1).filter((l) => /^(?:\d+[.)]|[-*])\s+/.test(l) || l.length < 120);
    const fromSlice = slice
      .map((l) => l.match(/^(?:\d+[.)]|[-*])\s+(.*)$/)?.[1])
      .filter(Boolean);
    if (fromSlice.length) return fromSlice;
  }
  return numbered;
}

function pickError(lines) {
  const idx = lines.findIndex((l) => /^(actual|error|observed)\b/i.test(l));
  if (idx >= 0) return lines[idx].replace(/^(actual|error|observed)\s*:?\s*/i, "");
  return null;
}

function ensureSentence(s) {
  const t = String(s).trim().replace(/[.]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

/** @param {{ objective: string, url?: string, title?: string }} input */
export function testMdFromObjective({ objective, url, title }) {
  const slug = (title ?? firstAction(objective)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  const front = [
    "---",
    "mode: testing",
    "tags: [repro]",
    ...(url ? [`url: ${url}`] : []),
    "---",
    "",
    `# ${name}`,
    "",
    "## Reproduce",
    objective,
    "",
  ].join("\n");
  return front;
}

function firstAction(objective) {
  const lines = objective.split("\n");
  const action = lines.find((l) => /^(click|open|type|select|add|remove|check|choose|enter|submit|toggle)/i.test(l));
  return action ?? "repro flow";
}
