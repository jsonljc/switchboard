import type { RevocationKeywordEntry } from "./types.js";

/**
 * Jurisdiction-agnostic baseline. English revocation phrases that apply
 * equally in SG and MY. Conservative: false-positive revoke is worse than
 * missed revoke (1b-1 escalation triggers catch nuanced complaints anyway).
 */
export const commonRevocationKeywords: ReadonlyArray<RevocationKeywordEntry> = [
  {
    id: "stop_baseline",
    patterns: [/\bSTOP\b/i],
    jurisdiction: "both",
    notes: "Universal opt-out keyword across WhatsApp / SMS conventions.",
  },
  {
    id: "unsubscribe",
    patterns: [/\bunsubscribe\b/i],
    jurisdiction: "both",
  },
  {
    id: "remove_me",
    patterns: [/remove me/i],
    jurisdiction: "both",
  },
  {
    id: "dont_contact_me",
    patterns: [/don't (contact|message) me/i, /do not (contact|message) me/i],
    jurisdiction: "both",
  },
  {
    id: "opt_out",
    patterns: [/opt[- ]?out/i],
    jurisdiction: "both",
  },
];
