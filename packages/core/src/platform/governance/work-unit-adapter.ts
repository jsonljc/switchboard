import type { ActionProposal } from "@switchboard/schemas";
import type { EvaluationContext } from "../../engine/rule-evaluator.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { MutationClass } from "../types.js";

const MUTATION_RISK_MAP: Record<MutationClass, string> = {
  read: "low",
  write: "medium",
  destructive: "high",
};

/**
 * Derives the cartridge ID from an action ID by taking the first segment.
 * E.g. "digital-ads.campaign.pause" → "digital-ads"
 */
function deriveCartridgeId(actionId: string): string {
  const dotIndex = actionId.indexOf(".");
  return dotIndex > 0 ? actionId.slice(0, dotIndex) : actionId;
}

export function toActionProposal(
  workUnit: WorkUnit,
  _registration: IntentRegistration,
): ActionProposal {
  return {
    id: workUnit.id,
    actionType: workUnit.intent,
    parameters: workUnit.parameters,
    evidence: "platform-governance",
    confidence: 1,
    originatingMessageId: workUnit.id,
  };
}

export function toEvaluationContext(
  workUnit: WorkUnit,
  registration: IntentRegistration,
): EvaluationContext {
  const rawId =
    registration.executor.mode === "cartridge" ? registration.executor.actionId : workUnit.intent;
  const cartridgeId = deriveCartridgeId(rawId);

  return {
    actionType: workUnit.intent,
    parameters: workUnit.parameters,
    principalId: workUnit.actor.id,
    organizationId: workUnit.organizationId,
    cartridgeId,
    riskCategory: MUTATION_RISK_MAP[registration.mutationClass],
    metadata: {
      workUnitId: workUnit.id,
      trigger: workUnit.trigger,
      mutationClass: registration.mutationClass,
      budgetClass: registration.budgetClass,
      approvalPolicy: registration.approvalPolicy,
    },
  };
}
