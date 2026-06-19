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
  // The cron run time; the idempotency cadence anchor (ISO-week), decoupled from the scan window so a
  // change to the lookback window cannot change the dedup cadence.
  asOf: Date;
  candidates: RecoveryCandidateInput[]; // Date-based (the read/filter output)
}

/**
 * The UTC ISO-week start (Monday) of `date` as YYYY-MM-DD. The idempotency cadence bucket: two cron
 * runs in the same Mon..Sun week yield the same key, so re-runs dedup to one parked campaign per org
 * per ISO-week. Monday-anchored UTC date avoids ISO week-number/year-boundary edge cases.
 */
function isoWeekStartUtc(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const mondayOffset = (d.getUTCDay() + 6) % 7; // days since Monday (getUTCDay: 0=Sun..6=Sat)
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the canonical submit request for one no-show recovery campaign. Mirrors
 * buildRileyBudgetSubmitRequest: the seeded `{ id: "system", type: "system" }` principal verbatim
 * (a bespoke system:<x> hard-denies), trigger "schedule", a deterministic per-org-per-ISO-week
 * idempotency key (so re-runs within a week dedup to one parked campaign). Accepts the Date-based
 * filter output and serializes startsAt to ISO at the
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
  const weekKey = isoWeekStartUtc(input.asOf);
  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: ROBIN_RECOVERY_SEND_INTENT,
    parameters: parsed.data,
    trigger: "schedule",
    surface: { surface: "api" },
    idempotencyKey: `mutate:robin:${input.organizationId}:${weekKey}:recovery`,
  };
}
