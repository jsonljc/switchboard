import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import type { RecoveryCandidateInput } from "@switchboard/core";
import { RobinRecoveryCampaignParamsSchema } from "@switchboard/schemas";

// Robin v1 no-show recovery campaign. Registered in bootstrap/contained-workflows.ts (workflow
// mode, NOT system_auto_approved so it PARKS), gated by the seeded allow + require_approval policy
// pair (packages/db/src/seed/robin-recovery-governance.ts), and resolved to platform-direct by the
// carve-out in app.ts (Robin has no deployment). The executor is a fail-closed placeholder until
// the consent-gated send slice; the cron initiator lands then too. Non-financial (no spend).
export const ROBIN_RECOVERY_SEND_INTENT = "robin.recovery_campaign.send";

export interface RecoveryCampaignSubmitInput {
  organizationId: string;
  windowFrom: Date;
  windowTo: Date;
  candidates: RecoveryCandidateInput[]; // Date-based (the read/filter output)
}

/**
 * Build the canonical submit request for one no-show recovery campaign. Mirrors
 * buildRileyBudgetSubmitRequest: the seeded `{ id: "system", type: "system" }` principal verbatim
 * (a bespoke system:<x> hard-denies), trigger "schedule", a deterministic per-org-per-window
 * idempotency key. Accepts the Date-based filter output and serializes startsAt to ISO at the
 * payload boundary (the frozen cohort is JSON). Returns NULL on an empty cohort (defense in depth:
 * an empty campaign must never park). NO targetHint: Robin has no deployment, so the ingress
 * resolver derives slug "robin" and the platform-direct carve-out (app.ts) resolves it. The frozen
 * `candidates` is exactly what the human approves and the bindingHash content-binds; the executor
 * re-validates consent per recipient at dispatch (the send slice), never bypassing it.
 */
export function buildRecoveryCampaignSubmitRequest(
  input: RecoveryCampaignSubmitInput,
): CanonicalSubmitRequest | null {
  if (input.candidates.length === 0) return null;
  const candidates = input.candidates.map((c) => ({
    bookingId: c.bookingId,
    contactId: c.contactId,
    service: c.service,
    startsAt: c.startsAt.toISOString(),
    attendeeName: c.attendeeName ?? null,
  }));
  const parameters = {
    windowFrom: input.windowFrom.toISOString(),
    windowTo: input.windowTo.toISOString(),
    candidates,
    recipientCount: candidates.length,
  };
  const parsed = RobinRecoveryCampaignParamsSchema.safeParse(parameters);
  if (!parsed.success) return null;
  const windowDay = input.windowFrom.toISOString().slice(0, 10);
  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: ROBIN_RECOVERY_SEND_INTENT,
    parameters: parsed.data,
    trigger: "schedule",
    surface: { surface: "api" },
    idempotencyKey: `mutate:robin:${input.organizationId}:${windowDay}:recovery`,
  };
}
