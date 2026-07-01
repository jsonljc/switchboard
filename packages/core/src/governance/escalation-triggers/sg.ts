import type { EscalationTriggerEntry } from "./types.js";
import type { Vertical } from "../../vertical.js";

export const SG_ESCALATION_TRIGGERS: ReadonlyArray<EscalationTriggerEntry> = [
  {
    id: "sg_competitor_negative_named",
    category: "competitor_negative",
    patterns: [/\b(scared|warned) (about|of)\b[^.!?]*\b(clinic|spa|aesthetic)\b/i],
  },
];

/**
 * Vertical-keyed view of the SG jurisdiction table. `medspa` is the seed
 * vertical; a vertical absent here inherits the medspa SG floor in the loader.
 */
export const SG_ESCALATION_TRIGGERS_BY_VERTICAL: Partial<
  Record<Vertical, ReadonlyArray<EscalationTriggerEntry>>
> = {
  medspa: SG_ESCALATION_TRIGGERS,
};
