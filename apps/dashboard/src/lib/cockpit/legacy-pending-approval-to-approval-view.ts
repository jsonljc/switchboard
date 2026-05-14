// apps/dashboard/src/lib/cockpit/legacy-pending-approval-to-approval-view.ts
import type { PendingApproval } from "@/lib/api-client-types";
import type {
  AlexApprovalView,
  AlexApprovalKind,
  ApprovalUrgency,
} from "@/components/cockpit/types.js";
import { relativeAge } from "./relative-age.js";

function urgencyForRisk(risk: string): ApprovalUrgency {
  if (risk === "critical" || risk === "high") return "immediate";
  return "this_week";
}

// A.1 only renders the wire-level shape from /api/dashboard/approvals.
// Richer kind classification (refund / regulatory / safety-gate / escalation)
// requires Approval.payload.kind which lands at A.5 with the schema additions.
// Until then, every wire approval surfaces as kind = "pricing".
function inferKind(_: PendingApproval): AlexApprovalKind {
  return "pricing";
}

/**
 * Adapter from the pre-schema-extension `PendingApproval` wire shape into the
 * cockpit's `AlexApprovalView`. The `legacy` prefix is intentional: A.5 ships
 * `Approval.payload.kind` + `body` + `quote` + `quoteFrom`, at which point a
 * sibling adapter (e.g. `richApprovalToApprovalView`) reads those fields and
 * surfaces the full set of approval kinds. This function is the A.1 bridge —
 * keep it until the schema-aware adapter is the only one called.
 */
export function legacyPendingApprovalToApprovalView(
  approval: PendingApproval,
  now: Date = new Date(),
): AlexApprovalView {
  const created = new Date(approval.createdAt);
  return {
    id: approval.id,
    kind: inferKind(approval),
    urgency: urgencyForRisk(approval.riskCategory),
    askedAt: relativeAge(created, now),
    title: approval.summary,
    presentation: { primaryLabel: "Accept", dismissLabel: "Decline" },
    primary: "Accept",
    secondary: "Decline",
    primaryAction: { kind: "respond", bindingHash: approval.bindingHash, verdict: "accept" },
  };
}
