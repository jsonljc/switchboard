/**
 * Normalize a RegExp at loader boundary: always case-insensitive, never
 * stateful (no `g` flag). Loaded patterns are scanned repeatedly across
 * different inputs; a global flag would persist `lastIndex` and cause
 * subtle correctness bugs.
 */
export function normalizeRegex(p: RegExp): RegExp {
  const flags = p.flags.replace(/g/g, "");
  return new RegExp(p.source, flags.includes("i") ? flags : flags + "i");
}
