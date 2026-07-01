import type { EscalationTriggerEntry } from "./types.js";
import type { Vertical } from "../../vertical.js";

export const MY_ESCALATION_TRIGGERS: ReadonlyArray<EscalationTriggerEntry> = [
  {
    id: "my_kkm_complaint",
    category: "prior_complaint",
    patterns: [/\b(KKM|MoH|ministry of health) complaint\b/i],
  },
];

/**
 * Vertical-keyed view of the MY jurisdiction table. `medspa` is the seed
 * vertical; a vertical absent here inherits the medspa MY floor in the loader.
 */
export const MY_ESCALATION_TRIGGERS_BY_VERTICAL: Partial<
  Record<Vertical, ReadonlyArray<EscalationTriggerEntry>>
> = {
  medspa: MY_ESCALATION_TRIGGERS,
};
