import type { RevocationKeywordEntry } from "./types.js";

/**
 * MY-specific revocation phrasing in Bahasa Malaysia. Patterns are
 * intentionally contextualized to require messaging/contact-related nouns
 * after generic verbs like 'berhenti' (stop). This avoids false-positive
 * revoke on benign phrases like 'berhenti makan ubat' (stop taking medicine).
 * Conservative seed — false-positive revoke is worse than missed revoke;
 * 1b-1 escalation triggers catch nuanced complaints as a fallback.
 */
export const myRevocationKeywords: ReadonlyArray<RevocationKeywordEntry> = [
  {
    id: "my_berhenti_messaging",
    patterns: [
      /\bberhenti\b.*\b(hantar|pesanan|mesej|whatsapp|sms|hubung)/i,
      /\bberhenti hantar\b/i,
    ],
    jurisdiction: "MY",
    notes:
      "Bahasa 'stop' contextualized to messaging/contact actions. Excludes 'berhenti makan ubat' and similar non-messaging usage.",
  },
  {
    id: "my_tarik_balik",
    patterns: [/\btarik balik\b/i],
    jurisdiction: "MY",
    notes: "Bahasa 'withdraw'.",
  },
  {
    id: "my_jangan_hantar",
    patterns: [/\bjangan hantar\b/i],
    jurisdiction: "MY",
    notes: "Bahasa 'don't send'.",
  },
];
