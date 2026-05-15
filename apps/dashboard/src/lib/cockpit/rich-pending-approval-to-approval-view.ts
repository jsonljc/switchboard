// apps/dashboard/src/lib/cockpit/rich-pending-approval-to-approval-view.ts
//
// A.7c — Rich adapter from the PendingApproval wire shape (now carrying
// `kind`/`body`/`quote`/`quoteFrom` via the server-route projection) into
// the cockpit's `AlexApprovalView`. Reads `approval.kind` to pick the right
// urgency band + CTA copy per the umbrella spec's "Card variants (one per
// kind)" table.
//
// Spec reference: docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md
//   §"Card variants (one per kind)" — eyebrow + CTA per kind.
//   §"Card sort order" — immediate (refund/regulatory/safety-gate/escalation)
//                        → this_week (pricing/qualification).
//
// Fallback contract: when `approval.kind` is undefined (legacy approvals
// created pre-A.7c) the adapter delegates to `legacyPendingApprovalToApprovalView`,
// which yields `kind: "pricing"` with default "Accept"/"Decline" labels. The
// legacy adapter stays on disk during the cutover window (~24h) — a post-A.7c
// cleanup PR deletes it once all in-flight approvals have expired.

import type { PendingApproval } from "@/lib/api-client-types";
import type {
  AlexApprovalView,
  AlexApprovalKind,
  ApprovalUrgency,
} from "@/components/cockpit/types";
import { relativeAge } from "./relative-age";
import { legacyPendingApprovalToApprovalView } from "./legacy-pending-approval-to-approval-view";

/**
 * Kind-driven urgency. Per spec §"Card variants" + §"Card sort order":
 *   - refund / regulatory / safety-gate / escalation → immediate (red eyebrow)
 *   - pricing / qualification → urgency from risk (high/critical → immediate;
 *     otherwise this_week)
 */
function urgencyForKind(kind: AlexApprovalKind, risk: string): ApprovalUrgency {
  if (kind === "refund" || kind === "regulatory" || kind === "safety-gate" || kind === "escalation")
    return "immediate";
  // pricing + qualification — risk-driven within "this_week"/"immediate" band.
  if (risk === "critical" || risk === "high") return "immediate";
  return "this_week";
}

/**
 * Per-kind CTA copy. Direct transcription of spec §"Card variants" table:
 *   - pricing       → "Accept & send"           / "Decline"
 *   - refund        → "Open thread"             / "Decline"   (handoff intent)
 *   - qualification → "Confirm disqualification"/ "Decline"
 *   - regulatory    → "Edit reply"              / "Decline"
 *   - safety-gate   → "Edit reply"              / "Decline"
 *   - escalation    → "Open thread"             / "Decline"
 */
function ctaForKind(kind: AlexApprovalKind): { primary: string; secondary: string } {
  switch (kind) {
    case "refund":
      return { primary: "Open thread", secondary: "Decline" };
    case "qualification":
      return { primary: "Confirm disqualification", secondary: "Decline" };
    case "regulatory":
    case "safety-gate":
      return { primary: "Edit reply", secondary: "Decline" };
    case "escalation":
      return { primary: "Open thread", secondary: "Decline" };
    case "pricing":
    default:
      return { primary: "Accept & send", secondary: "Decline" };
  }
}

export function richPendingApprovalToApprovalView(
  approval: PendingApproval,
  now: Date = new Date(),
): AlexApprovalView {
  // Legacy fallback — no kind on the wire (pre-A.7c approval). Defer to the
  // A.1 adapter which yields kind="pricing" with default "Accept"/"Decline"
  // copy and risk-driven urgency.
  if (!approval.kind) {
    return legacyPendingApprovalToApprovalView(approval, now);
  }

  const kind = approval.kind;
  const created = new Date(approval.createdAt);
  const cta = ctaForKind(kind);

  return {
    id: approval.id,
    kind,
    urgency: urgencyForKind(kind, approval.riskCategory),
    askedAt: relativeAge(created, now),
    title: approval.summary,
    ...(approval.body ? { body: approval.body } : {}),
    ...(approval.quote ? { quote: approval.quote } : {}),
    ...(approval.quoteFrom ? { quoteFrom: approval.quoteFrom } : {}),
    presentation: { primaryLabel: cta.primary, dismissLabel: cta.secondary },
    primary: cta.primary,
    secondary: cta.secondary,
    primaryAction: { kind: "respond", bindingHash: approval.bindingHash, verdict: "accept" },
  };
}
