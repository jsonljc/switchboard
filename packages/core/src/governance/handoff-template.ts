import type { GovernanceVerdictReason } from "@switchboard/schemas";

export interface HandoffTemplateInput {
  jurisdiction: "SG" | "MY";
  reasonCode: GovernanceVerdictReason;
}

const SG_TEMPLATE =
  "Thanks for sharing that — this is something the clinic team should advise on directly. " +
  "I'll get them to follow up with you shortly.";

const MY_TEMPLATE =
  "Thanks for sharing that — this is something the clinic team should advise on directly. " +
  "I'll have them follow up with you shortly.";

/**
 * Returns a deterministic per-jurisdiction handoff string. The reasonCode
 * parameter is reserved for 1b-2's per-reason specialization; in 1b-1 it
 * does not affect output.
 */
export function renderHandoffTemplate(input: HandoffTemplateInput): string {
  return input.jurisdiction === "SG" ? SG_TEMPLATE : MY_TEMPLATE;
}
