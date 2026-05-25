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
} from "@switchboard/core/platform";

import {
  ACT_ON_RECOMMENDATION_INTENT,
  CLEAR_CONSENT_INTENT,
  CONFIRM_DISQUALIFICATION_INTENT,
  DISMISS_DISQUALIFICATION_INTENT,
  GRANT_CONSENT_INTENT,
  RECORD_REVENUE_INTENT,
  REVOKE_CONSENT_INTENT,
  TRANSITION_OPPORTUNITY_STAGE_INTENT,
} from "./operator-intents/shared.js";
import { buildTransitionOpportunityStageHandler } from "./operator-intents/opportunity.js";
import {
  buildRecordRevenueHandler,
  type OutboxWriter,
  type RunInTransaction,
} from "./operator-intents/revenue.js";
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

// Re-export every public symbol the rest of the codebase imports from
// "../bootstrap/operator-intents.js" so existing import paths stay valid.
export {
  ACT_ON_RECOMMENDATION_INTENT,
  CLEAR_CONSENT_INTENT,
  CONFIRM_DISQUALIFICATION_INTENT,
  DISMISS_DISQUALIFICATION_INTENT,
  GRANT_CONSENT_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
  RECORD_REVENUE_INTENT,
  REVOKE_CONSENT_INTENT,
  TRANSITION_OPPORTUNITY_STAGE_INTENT,
} from "./operator-intents/shared.js";
export { buildTransitionOpportunityStageHandler } from "./operator-intents/opportunity.js";
export { buildRecordRevenueHandler } from "./operator-intents/revenue.js";
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
  logger?: { info(msg: string): void };
}

/** Shared registration shape for every system_auto_approved operator intent. */
function registerOperatorIntent(intentRegistry: IntentRegistry, intent: string): void {
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
    allowedTriggers: ["api"],
    timeoutMs: 30_000,
    retryable: false,
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

  const intentCount =
    (opportunityStore ? 1 : 0) +
    (recommendationStore ? 1 : 0) +
    (disqualificationHook ? 2 : 0) +
    (consentService ? 3 : 0) +
    (revenueStore && outboxWriter && runInTransaction ? 1 : 0);
  logger?.info(
    `Operator mutation mode registered with ${intentCount} operator intent${intentCount === 1 ? "" : "s"}`,
  );
}
