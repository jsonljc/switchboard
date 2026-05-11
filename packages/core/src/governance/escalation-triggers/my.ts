import type { EscalationTriggerEntry } from "./types.js";

export const MY_ESCALATION_TRIGGERS: ReadonlyArray<EscalationTriggerEntry> = [
  {
    id: "my_kkm_complaint",
    category: "prior_complaint",
    patterns: [/\b(KKM|MoH|ministry of health) complaint\b/i],
  },
];
