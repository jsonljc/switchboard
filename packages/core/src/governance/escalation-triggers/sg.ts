import type { EscalationTriggerEntry } from "./types.js";

export const SG_ESCALATION_TRIGGERS: ReadonlyArray<EscalationTriggerEntry> = [
  {
    id: "sg_competitor_negative_named",
    category: "competitor_negative",
    patterns: [/\b(scared|warned) (about|of)\b[^.!?]*\b(clinic|spa|aesthetic)\b/i],
  },
];
