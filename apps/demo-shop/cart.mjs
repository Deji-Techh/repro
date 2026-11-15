/**
 * cart.mjs — payment tokenization.
 *
 * The demo regression lives here. Commit 17 ("refactor: drop the legacy
 * tokenizer") simplifies this function and, in doing so, returns null for
 * saved cards. The page still renders. The cart still works. Only the
 * network response is wrong — which is exactly the class of bug a screenshot
 * cannot see and a browser assertion can.
 */

const LIVE_PREFIX = "tok_live_";

/** @param {{ method: "saved"|"new", savedCard?: boolean, cardNumber?: string }} input */
export function tokenizeCard(input) {
  const saved = input?.method === "saved" || input?.savedCard === true;

  if (saved) {
    // Saved cards are already tokenized by the provider; we only re-confirm.
    return LIVE_PREFIX + "saved_4242";
  }

  const digits = String(input?.cardNumber ?? "4242424242424242").replace(/\D/g, "");
  if (digits.length < 12) return null;
  return LIVE_PREFIX + digits.slice(-4);
}

/** Subtotal helper (kept small on purpose). */
export function subtotal(items) {
  return items.reduce((sum, item) => sum + Number(item.price ?? 0), 0);
}
