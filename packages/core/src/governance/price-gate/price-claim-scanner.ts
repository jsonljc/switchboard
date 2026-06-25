// ---------------------------------------------------------------------------
// Deterministic price-claim scanner (P1-D).
//
// Detects currency-MARKED monetary amounts in an outbound reply and flags those
// not present in the operator-approved price set (the playbook's service prices).
// A currency marker (symbol, ISO code, or the words dollars/ringgit) is REQUIRED,
// so bare numbers — times, ages, counts, durations — are never flagged.
//
// The bias is deliberate: an over-match blocks a legitimate reply (recoverable —
// it routes to a human), while an under-match lets a fabricated price reach the
// lead (the integrity failure this gate exists to prevent).
// ---------------------------------------------------------------------------

export interface PriceClaim {
  /** The matched substring, e.g. "$1,200" or "SGD 50". */
  raw: string;
  /** The numeric major-unit amount, e.g. 1200 or 50. */
  amount: number;
}

// A monetary number: digits, optional thousands separators, optional 1-2 decimals.
const NUM = String.raw`\d[\d,]*(?:\.\d{1,2})?`;

// Leading marker (symbol or ISO code) then number, OR number then trailing code/word.
// RM appears on BOTH branches so the MY ringgit reads "RM150" (leading) and
// "150 RM" (trailing) — a missed trailing RM would be a false NEGATIVE (a leaked
// price). Case-insensitive so "sgd", "Dollars" etc. match.
const PRICE_RE = new RegExp(
  String.raw`(?:US\$|S\$|\$|RM|SGD|MYR|USD)\s?(${NUM})|(${NUM})\s?(?:SGD|MYR|USD|RM|dollars?|ringgit)`,
  "gi",
);

// Floating-point equality tolerance (prices are major units; covers "50" vs "50.00").
const EPSILON = 0.005;

function parseAmount(numStr: string): number {
  return parseFloat(numStr.replace(/,/g, ""));
}

/**
 * Extract every currency-marked monetary amount from `text`, in occurrence order.
 */
export function extractPriceClaims(text: string): PriceClaim[] {
  const claims: PriceClaim[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const numStr = m[1] ?? m[2];
    if (numStr === undefined) continue;
    const amount = parseAmount(numStr);
    if (Number.isFinite(amount)) {
      claims.push({ raw: m[0], amount });
    }
  }
  return claims;
}

/**
 * Return the price claims in `text` whose amount is NOT in `approvedPrices`.
 *
 * Fail-closed by construction: when `approvedPrices` is empty (the org has no
 * operator-approved service prices), EVERY price claim is unsubstantiated.
 */
export function findUnsubstantiatedPriceClaims(
  text: string,
  approvedPrices: readonly number[],
): PriceClaim[] {
  return extractPriceClaims(text).filter(
    (claim) => !approvedPrices.some((p) => Math.abs(p - claim.amount) <= EPSILON),
  );
}
