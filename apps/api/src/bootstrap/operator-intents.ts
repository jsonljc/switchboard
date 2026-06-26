// apps/api/src/bootstrap/operator-intents.ts
// ---------------------------------------------------------------------------
// Wires operator-direct intents (Wave 2 Phase 1b migrations) into the
// `IntentRegistry` and registers `OperatorMutationMode` in the
// `ExecutionModeRegistry`.
//
// Self-contained: does not share the `WorkflowMode` handlers Map with
// `bootstrap/contained-workflows.ts`. Each mode owns its own handler set.
//
// See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
// Amendment 2.
//
// Phase 1b.4 review-followup #1 — handler factories live in
// `./operator-intents/` split by domain (consent / opportunity / recommendation
// / disqualification). This file is the public surface (barrel + bootstrap).
// ---------------------------------------------------------------------------
import type {
  ConsentService,
  DisqualificationResolutionHook,
  OpportunityStore,
  RecommendationStore,
  RevenueStore,
} from "@switchboard/core";
import {
  OperatorMutationMode,
  type ExecutionModeRegistry,
  type IntentRegistry,
  type OperatorMutationHandler,
  type Trigger,
} from "@switchboard/core/platform";

import {
  ACT_ON_RECOMMENDATION_INTENT,
  CLEAR_CONSENT_INTENT,
  CONFIRM_DISQUALIFICATION_INTENT,
  DELIVER_WEEKLY_REPORT_INTENT,
  DISMISS_DISQUALIFICATION_INTENT,
  ERASE_CONTACT_INTENT,
  GOVERNANCE_SET_GATE_MODE_INTENT,
  GOVERNANCE_SET_MARKET_INTENT,
  GRANT_CONSENT_INTENT,
  MEMORY_WRITE_INTENT,
  RECONCILE_BOOKING_INTENT,
  RECORD_ATTENDANCE_INTENT,
  RECORD_REVENUE_INTENT,
  REVOKE_CONSENT_INTENT,
  TRANSITION_OPPORTUNITY_STAGE_INTENT,
} from "./operator-intents/shared.js";
import {
  buildRecordAttendanceHandler,
  type BookingAttendanceWriter,
  type ReceiptHeldPromoter,
} from "./operator-intents/attendance.js";
import { buildTransitionOpportunityStageHandler } from "./operator-intents/opportunity.js";
import {
  buildReconcileBookingHandler,
  type ReconcileBookingWriter,
} from "./operator-intents/reconcile-booking.js";
import {
  buildRecordRevenueHandler,
  type OutboxWriter,
  type RunInTransaction,
} from "./operator-intents/revenue.js";
import {
  buildRecordVerifiedPaymentHandler,
  RECORD_VERIFIED_PAYMENT_INTENT,
  type ReceiptWriter,
  type PaymentVerifier,
} from "./operator-intents/record-verified-payment.js";
import { buildActOnRecommendationHandler } from "./operator-intents/recommendation.js";
import {
  buildConfirmDisqualificationHandler,
  buildDismissDisqualificationHandler,
} from "./operator-intents/disqualification.js";
import {
  buildClearConsentHandler,
  buildGrantConsentHandler,
  buildRevokeConsentHandler,
} from "./operator-intents/consent.js";
import {
  buildDeliverWeeklyReportHandler,
  type WeeklyReportDeliveryWriter,
} from "./operator-intents/deliver-weekly-report.js";
import {
  buildEraseContactHandler,
  type OperatorContactEraser,
} from "./operator-intents/erase-contact.js";
import { buildMemoryWriteHandler, type MemoryWriteStore } from "./operator-intents/memory-write.js";
import {
  buildGovernanceSetGateModeHandler,
  type GovernanceSetGateModeDeps,
} from "./operator-intents/governance-set-gate-mode.js";
import {
  buildGovernanceSetMarketHandler,
  type GovernanceSetMarketDeps,
} from "./operator-intents/governance-set-market.js";

// Re-export every public symbol the rest of the codebase imports from
// "../bootstrap/operator-intents.js" so existing import paths stay valid.
export {
  ACT_ON_RECOMMENDATION_INTENT,
  CLEAR_CONSENT_INTENT,
  CONFIRM_DISQUALIFICATION_INTENT,
  DELIVER_WEEKLY_REPORT_INTENT,
  DISMISS_DISQUALIFICATION_INTENT,
  ERASE_CONTACT_INTENT,
  GOVERNANCE_SET_GATE_MODE_INTENT,
  GOVERNANCE_SET_MARKET_INTENT,
  GRANT_CONSENT_INTENT,
  MEMORY_WRITE_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
  RECONCILE_BOOKING_INTENT,
  RECORD_ATTENDANCE_INTENT,
  RECORD_REVENUE_INTENT,
  REVOKE_CONSENT_INTENT,
  TRANSITION_OPPORTUNITY_STAGE_INTENT,
} from "./operator-intents/shared.js";
export { buildEraseContactHandler } from "./operator-intents/erase-contact.js";
export type { OperatorContactEraser } from "./operator-intents/erase-contact.js";
export { buildMemoryWriteHandler } from "./operator-intents/memory-write.js";
export type { MemoryWriteStore } from "./operator-intents/memory-write.js";
export { buildGovernanceSetGateModeHandler } from "./operator-intents/governance-set-gate-mode.js";
export type { GovernanceSetGateModeDeps } from "./operator-intents/governance-set-gate-mode.js";
export { buildGovernanceSetMarketHandler } from "./operator-intents/governance-set-market.js";
export type { GovernanceSetMarketDeps } from "./operator-intents/governance-set-market.js";
export { buildDeliverWeeklyReportHandler } from "./operator-intents/deliver-weekly-report.js";
export type { WeeklyReportDeliveryWriter } from "./operator-intents/deliver-weekly-report.js";
export { buildTransitionOpportunityStageHandler } from "./operator-intents/opportunity.js";
export { buildReconcileBookingHandler } from "./operator-intents/reconcile-booking.js";
export { buildRecordRevenueHandler } from "./operator-intents/revenue.js";
export {
  buildRecordVerifiedPaymentHandler,
  RECORD_VERIFIED_PAYMENT_INTENT,
} from "./operator-intents/record-verified-payment.js";
export { buildActOnRecommendationHandler } from "./operator-intents/recommendation.js";
export {
  buildConfirmDisqualificationHandler,
  buildDismissDisqualificationHandler,
} from "./operator-intents/disqualification.js";
export {
  buildClearConsentHandler,
  buildGrantConsentHandler,
  buildRevokeConsentHandler,
} from "./operator-intents/consent.js";

interface OperatorIntentsBootstrapDeps {
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  /** Optional: handler+intent only registered when provided. */
  opportunityStore?: OpportunityStore;
  recommendationStore?: RecommendationStore;
  disqualificationHook?: Pick<DisqualificationResolutionHook, "confirm" | "dismiss">;
  consentService?: ConsentService;
  revenueStore?: RevenueStore;
  outboxWriter?: OutboxWriter;
  runInTransaction?: RunInTransaction;
  /** Required (with revenueStore+outboxWriter+runInTransaction+paymentVerifier) to
   *  register the payment.record_verified intent. Writes the verified payment Receipt. */
  receiptWriter?: ReceiptWriter;
  /** Required (with receiptWriter+revenueStore+outboxWriter+runInTransaction) to
   *  register payment.record_verified. The server-side PSP fetch-back that anchors
   *  `verified` to a real settled charge (F3) — never the caller-supplied provider. */
  paymentVerifier?: PaymentVerifier;
  /** Optional: registers the booking.record_attendance intent + handler when provided. */
  bookingAttendanceWriter?: BookingAttendanceWriter;
  /** Optional: when provided alongside bookingAttendanceWriter, an "attended" outcome promotes
   *  the booking's calendar receipt booked -> held. */
  receiptHeldPromoter?: ReceiptHeldPromoter;
  /** Optional: registers the receipt.reconcile_booking intent + handler when provided. */
  reconcileBookingWriter?: ReconcileBookingWriter;
  /** Optional: registers the ledger.deliver_weekly_report intent + handler when provided. */
  weeklyReportDeliveryWriter?: WeeklyReportDeliveryWriter;
  /** Optional: registers the operator.erase_contact intent + handler when provided. Runs the full
   *  PDPA delete cascade (eraseContactFully), org-scoped + fail-closed cross-tenant. */
  contactEraser?: OperatorContactEraser;
  /** Optional: registers the memory.write intent + handler when provided (S8b). The governed,
   *  non-conversation DeploymentMemory write path. */
  memoryWriteStore?: MemoryWriteStore;
  /** Optional: registers the governance.set_gate_mode intent + handler when provided (enforce-flip
   *  slice 3). The readiness-guarded per-gate observe<->enforce flip. */
  governanceSetGateMode?: GovernanceSetGateModeDeps;
  /** Optional: registers the governance.set_market intent + handler when provided (P2-B slice 2).
   *  The org's jurisdiction + clinicType declaration (drives currency); no readiness gate. */
  governanceSetMarket?: GovernanceSetMarketDeps;
  logger?: { info(msg: string): void };
}

/**
 * Shared registration shape for every system_auto_approved operator intent.
 * `allowedTriggers` defaults to ["api"] (the operator-direct route surface);
 * pass an explicit list for an intent that is also driven by a cron, e.g.
 * ["schedule", "api"] for the weekly report delivery. The hardcoded ["api"]
 * default keeps every existing caller unchanged.
 *
 * `revenueRecording` (A22) defaults to false; pass true only for an intent that
 * records already-settled INBOUND revenue (e.g. payment.record_verified) so the
 * entitlement gate in PlatformIngress carves it out instead of blocking it: the
 * proof of money that already moved must be recorded even for a non-entitled org.
 */
function registerOperatorIntent(
  intentRegistry: IntentRegistry,
  intent: string,
  allowedTriggers: Trigger[] = ["api"],
  revenueRecording = false,
): void {
  intentRegistry.register({
    intent,
    defaultMode: "operator_mutation",
    allowedModes: ["operator_mutation"],
    executor: { mode: "operator_mutation" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
    idempotent: true,
    allowedTriggers,
    timeoutMs: 30_000,
    retryable: false,
    revenueRecording,
  });
}

export function bootstrapOperatorIntents(deps: OperatorIntentsBootstrapDeps): void {
  const {
    intentRegistry,
    modeRegistry,
    opportunityStore,
    recommendationStore,
    disqualificationHook,
    consentService,
    revenueStore,
    outboxWriter,
    runInTransaction,
    receiptWriter,
    paymentVerifier,
    bookingAttendanceWriter,
    receiptHeldPromoter,
    reconcileBookingWriter,
    weeklyReportDeliveryWriter,
    contactEraser,
    memoryWriteStore,
    governanceSetGateMode,
    governanceSetMarket,
    logger,
  } = deps;

  const handlers = new Map<string, OperatorMutationHandler>();

  if (opportunityStore) {
    handlers.set(
      TRANSITION_OPPORTUNITY_STAGE_INTENT,
      buildTransitionOpportunityStageHandler(opportunityStore),
    );
  }

  if (recommendationStore) {
    handlers.set(
      ACT_ON_RECOMMENDATION_INTENT,
      buildActOnRecommendationHandler(recommendationStore),
    );
  }

  if (disqualificationHook) {
    handlers.set(
      CONFIRM_DISQUALIFICATION_INTENT,
      buildConfirmDisqualificationHandler(disqualificationHook),
    );
    handlers.set(
      DISMISS_DISQUALIFICATION_INTENT,
      buildDismissDisqualificationHandler(disqualificationHook),
    );
  }

  if (consentService) {
    handlers.set(GRANT_CONSENT_INTENT, buildGrantConsentHandler(consentService));
    handlers.set(REVOKE_CONSENT_INTENT, buildRevokeConsentHandler(consentService));
    handlers.set(CLEAR_CONSENT_INTENT, buildClearConsentHandler(consentService));
  }

  if (revenueStore && outboxWriter && runInTransaction) {
    handlers.set(
      RECORD_REVENUE_INTENT,
      buildRecordRevenueHandler(revenueStore, outboxWriter, runInTransaction),
    );
  }

  if (receiptWriter && revenueStore && outboxWriter && runInTransaction && paymentVerifier) {
    handlers.set(
      RECORD_VERIFIED_PAYMENT_INTENT,
      buildRecordVerifiedPaymentHandler(
        receiptWriter,
        revenueStore,
        outboxWriter,
        runInTransaction,
        paymentVerifier,
      ),
    );
  }

  if (bookingAttendanceWriter) {
    handlers.set(
      RECORD_ATTENDANCE_INTENT,
      buildRecordAttendanceHandler(bookingAttendanceWriter, receiptHeldPromoter),
    );
  }

  if (reconcileBookingWriter) {
    handlers.set(RECONCILE_BOOKING_INTENT, buildReconcileBookingHandler(reconcileBookingWriter));
  }

  if (weeklyReportDeliveryWriter) {
    handlers.set(
      DELIVER_WEEKLY_REPORT_INTENT,
      buildDeliverWeeklyReportHandler(weeklyReportDeliveryWriter),
    );
  }

  if (contactEraser) {
    handlers.set(ERASE_CONTACT_INTENT, buildEraseContactHandler(contactEraser));
  }

  if (memoryWriteStore) {
    handlers.set(MEMORY_WRITE_INTENT, buildMemoryWriteHandler(memoryWriteStore));
  }

  if (governanceSetGateMode) {
    handlers.set(
      GOVERNANCE_SET_GATE_MODE_INTENT,
      buildGovernanceSetGateModeHandler(governanceSetGateMode),
    );
  }

  if (governanceSetMarket) {
    handlers.set(
      GOVERNANCE_SET_MARKET_INTENT,
      buildGovernanceSetMarketHandler(governanceSetMarket),
    );
  }

  modeRegistry.register(new OperatorMutationMode({ handlers }));

  if (opportunityStore) {
    registerOperatorIntent(intentRegistry, TRANSITION_OPPORTUNITY_STAGE_INTENT);
  }
  if (recommendationStore) {
    registerOperatorIntent(intentRegistry, ACT_ON_RECOMMENDATION_INTENT);
  }
  if (disqualificationHook) {
    registerOperatorIntent(intentRegistry, CONFIRM_DISQUALIFICATION_INTENT);
    registerOperatorIntent(intentRegistry, DISMISS_DISQUALIFICATION_INTENT);
  }
  if (consentService) {
    for (const intent of [GRANT_CONSENT_INTENT, REVOKE_CONSENT_INTENT, CLEAR_CONSENT_INTENT]) {
      registerOperatorIntent(intentRegistry, intent);
    }
  }
  if (revenueStore && outboxWriter && runInTransaction) {
    registerOperatorIntent(intentRegistry, RECORD_REVENUE_INTENT);
  }
  if (receiptWriter && revenueStore && outboxWriter && runInTransaction && paymentVerifier) {
    // A22: revenueRecording=true marks a PSP-verified, already-settled deposit recorded
    // even for a non-entitled org (entitlement gates outbound spend, not inbound proof).
    registerOperatorIntent(intentRegistry, RECORD_VERIFIED_PAYMENT_INTENT, ["api"], true);
  }
  if (bookingAttendanceWriter) {
    registerOperatorIntent(intentRegistry, RECORD_ATTENDANCE_INTENT);
  }
  if (reconcileBookingWriter) {
    registerOperatorIntent(intentRegistry, RECONCILE_BOOKING_INTENT);
  }
  if (weeklyReportDeliveryWriter) {
    // schedule + api: the weekly cron submits with trigger "schedule"; api kept for an
    // operator-triggered manual resend. The shared default-["api"] helper would block the
    // schedule leg, so this is the one intent that passes an explicit trigger list.
    registerOperatorIntent(intentRegistry, DELIVER_WEEKLY_REPORT_INTENT, ["schedule", "api"]);
  }
  if (contactEraser) {
    registerOperatorIntent(intentRegistry, ERASE_CONTACT_INTENT);
  }
  if (memoryWriteStore) {
    // internal + schedule: S8c reroutes the conversation-compounding writer (trigger "internal") and
    // the decay cron (trigger "schedule") to submit through this intent. No "api" leg: there is no
    // operator-direct route for a learned memory write (the owner-correction route is separate, T4).
    registerOperatorIntent(intentRegistry, MEMORY_WRITE_INTENT, ["internal", "schedule"]);
  }
  if (governanceSetGateMode) {
    // api only: an operator flips a gate from the dashboard. Default system_auto_approved +
    // the handler's server-side readiness REFUSE is the safety gate (not a second approver).
    registerOperatorIntent(intentRegistry, GOVERNANCE_SET_GATE_MODE_INTENT);
  }
  if (governanceSetMarket) {
    // api only: an operator sets the org's market at onboarding/settings. system_auto_approved;
    // market is the org's declaration of its clinic + jurisdiction, so no readiness gate.
    registerOperatorIntent(intentRegistry, GOVERNANCE_SET_MARKET_INTENT);
  }

  const intentCount =
    (opportunityStore ? 1 : 0) +
    (recommendationStore ? 1 : 0) +
    (disqualificationHook ? 2 : 0) +
    (consentService ? 3 : 0) +
    (revenueStore && outboxWriter && runInTransaction ? 1 : 0) +
    (receiptWriter && revenueStore && outboxWriter && runInTransaction && paymentVerifier ? 1 : 0) +
    (bookingAttendanceWriter ? 1 : 0) +
    (reconcileBookingWriter ? 1 : 0) +
    (weeklyReportDeliveryWriter ? 1 : 0) +
    (contactEraser ? 1 : 0) +
    (memoryWriteStore ? 1 : 0) +
    (governanceSetGateMode ? 1 : 0) +
    (governanceSetMarket ? 1 : 0);
  logger?.info(
    `Operator mutation mode registered with ${intentCount} operator intent${intentCount === 1 ? "" : "s"}`,
  );
}
