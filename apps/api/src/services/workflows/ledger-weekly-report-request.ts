// apps/api/src/services/workflows/ledger-weekly-report-request.ts
// ---------------------------------------------------------------------------
// Canonical submit for the weekly owner-report delivery. Cron-initiated work is a
// TRACE ROOT and carries the seeded system principal VERBATIM (a bespoke
// system:<x> id has no IdentitySpec and hard-denies at the GovernanceGate). The
// intent is registered with allowedTriggers ["schedule", "api"], so trigger
// "schedule" passes the ingress trigger gate.
//
// NOTE (deployment resolution): this request carries NO targetHint, so the
// authoritative resolver derives skillSlug from the intent prefix ("ledger").
// See the deployment-resolution risk noted in the slice plan and the cron module.
// ---------------------------------------------------------------------------
import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import { DELIVER_WEEKLY_REPORT_INTENT } from "../../bootstrap/operator-intents/shared.js";

export interface DeliverWeeklyReportSubmitInput {
  organizationId: string;
  idempotencyKey: string;
}

export function buildDeliverWeeklyReportSubmitRequest(
  input: DeliverWeeklyReportSubmitInput,
): CanonicalSubmitRequest {
  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: DELIVER_WEEKLY_REPORT_INTENT,
    parameters: {},
    trigger: "schedule",
    surface: { surface: "api" },
    idempotencyKey: input.idempotencyKey,
  };
}
