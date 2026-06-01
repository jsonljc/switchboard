import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import type { FollowUpSendSubmitInput } from "../cron/scheduled-follow-up-dispatch.js";

/**
 * Build the canonical submit request for a scheduled follow-up send. The actor
 * is the SEEDED "system" principal (ensureSystemIdentity → "default" IdentitySpec)
 * — NOT a bespoke "system:..." id, which would have no IdentitySpec and hard-deny
 * at the governance gate. Cron-initiated work is a trace root (no parentWorkUnitId).
 */
export function buildFollowUpSendSubmitRequest(
  input: FollowUpSendSubmitInput,
  deployment: { deploymentId: string; skillSlug: string } | null,
): CanonicalSubmitRequest {
  return {
    organizationId: input.organizationId,
    // principal "system" → seeded "default" IdentitySpec (ensureSystemIdentity)
    actor: { id: "system", type: "service" },
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
