import type { CanonicalSubmitRequest } from "@switchboard/core/platform";

export interface ReminderSendSubmitInput {
  organizationId: string;
  contactId: string;
  bookingId: string;
  startsAt: string; // ISO
  timezone: string;
  channel: string;
  reminderId: string;
}

/**
 * Build the canonical submit request for an appointment reminder. Cron-initiated
 * work is a TRACE ROOT, so it carries the seeded `system` principal directly
 * (bare "system" id → "default" IdentitySpec via ensureSystemIdentity). A bespoke
 * `system:<x>` id would hard-deny — use the seeded one verbatim.
 */
export function buildReminderSendSubmitRequest(
  input: ReminderSendSubmitInput,
  deployment: { deploymentId: string; skillSlug: string } | null,
): CanonicalSubmitRequest {
  return {
    organizationId: input.organizationId,
    // principal "system" → seeded "default" IdentitySpec (ensureSystemIdentity)
    actor: { id: "system", type: "system" },
    intent: "conversation.reminder.send",
    parameters: {
      contactId: input.contactId,
      bookingId: input.bookingId,
      startsAt: input.startsAt,
      timezone: input.timezone,
      channel: input.channel,
      reminderId: input.reminderId,
    },
    trigger: "schedule",
    surface: { surface: "api" },
    idempotencyKey: `reminder-send:${input.reminderId}`,
    targetHint: deployment
      ? { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug }
      : undefined,
  };
}
