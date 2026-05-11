import type { RevocationKeywordEntry } from "./types.js";

/**
 * SG-specific revocation phrasing. Includes Malay phrases used colloquially
 * in SG conversations and SG-register English phrases.
 */
export const sgRevocationKeywords: ReadonlyArray<RevocationKeywordEntry> = [
  {
    id: "sg_jangan_hubungi",
    patterns: [/\bjangan hubungi\b/i],
    jurisdiction: "SG",
    notes: "Malay 'don't contact' — used colloquially by SG residents.",
  },
  {
    id: "sg_cancel_messages",
    patterns: [/\bcancel\b.*\b(messages?|whatsapp|sms)\b/i],
    jurisdiction: "SG",
  },
];
