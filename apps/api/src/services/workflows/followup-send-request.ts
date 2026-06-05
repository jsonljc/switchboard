import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import type { FollowUpSendSubmitInput } from "../cron/scheduled-follow-up-dispatch.js";

/**
 * Build the canonical submit request for a scheduled follow-up send.
 *
 * Cron-initiated work is a TRACE ROOT (no parentWorkUnitId), so it must carry a
 * resolvable seeded actor itself — unlike child work (e.g. meta.lead.greeting.send)
 * which inherits the parent's identity via submitChildWork. A bespoke `system:<x>`
 * id has no seeded IdentitySpec → GovernanceGate.loadIdentitySpec throws → hard-deny.
 * Use the seeded `system` principal (ensureSystemIdentity → "default" IdentitySpec).
 */
export function buildFollowUpSendSubmitRequest(
  input: FollowUpSendSubmitInput,
  deployment: { deploymentId: string; skillSlug: string } | null,
): CanonicalSubmitRequest {
  return {
    organizationId: input.organizationId,
    // principal "system" → seeded "default" IdentitySpec (ensureSystemIdentity)
    actor: { id: "system", type: "system" },
    intent: "conversation.followup.send",
    parameters: {
      contactId: input.contactId,
      conversationThreadId: input.conversationThreadId,
      channel: input.channel,
      templateIntentClass: input.templateIntentClass,
      reason: input.reason,
      followUpId: input.followUpId,
    },
    trigger: "schedule",
    surface: { surface: "api" },
    idempotencyKey: `followup-send:${input.followUpId}`,
    targetHint: deployment
      ? { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug }
      : undefined,
  };
}
