/**
 * Operator-facing short form of the confirmation code.
 * `0x2f1a08…1a9` — first 6 + ellipsis + last 3.
 * Used on the approve commit line, ack checkbox, and CTA so the operator
 * pattern-matches the same chunk across the page.
 */
export function shortHash(value: string | undefined | null): string {
  if (!value) return "";
  if (value.length <= 9) return value;
  return `${value.slice(0, 6)}…${value.slice(-3)}`;
}
