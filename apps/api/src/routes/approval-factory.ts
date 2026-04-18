import { randomUUID } from "node:crypto";
import type { ApprovalRequest, RiskCategory } from "@switchboard/schemas";
import type { WorkUnit } from "@switchboard/core/platform";
import type { StorageContext } from "@switchboard/core";
import {
  computeBindingHash,
  hashObject,
  routeApproval,
  createApprovalState,
  resolveIdentity,
} from "@switchboard/core";
import type { ApprovalRoutingConfig } from "@switchboard/core/approval";

export async function createApprovalForWorkUnit(params: {
  workUnit: WorkUnit;
  storageContext: StorageContext;
  routingConfig: ApprovalRoutingConfig;
  riskCategory?: RiskCategory;
}): Promise<{ approvalId: string; bindingHash: string }> {
  const { workUnit, storageContext, routingConfig } = params;

  const identitySpec = await storageContext.identity.getSpecByPrincipalId(workUnit.actor.id);
  if (!identitySpec) {
    throw new Error("Identity spec not found for actor");
  }
  const overlays = await storageContext.identity.listOverlaysBySpecId(identitySpec.id);
  const cartridgeId = workUnit.intent.split(".")[0] ?? workUnit.intent;
  const resolvedId = resolveIdentity(identitySpec, overlays, { cartridgeId });

  let riskCategory: RiskCategory = params.riskCategory ?? "medium";
  const cartridge = storageContext.cartridges.get(cartridgeId);
  if (cartridge && !params.riskCategory) {
    try {
      const riskInput = await cartridge.getRiskInput(workUnit.intent, workUnit.parameters, {});
      riskCategory = riskInput.baseRisk;
    } catch {
      // Fall through with default
    }
  }

  const routing = routeApproval(riskCategory, resolvedId, routingConfig);
  const now = new Date();

  const bindingHash = computeBindingHash({
    envelopeId: workUnit.id,
    envelopeVersion: 1,
    actionId: `prop_${workUnit.id}`,
    parameters: workUnit.parameters,
    decisionTraceHash: hashObject({ intent: workUnit.intent }),
    contextSnapshotHash: hashObject({ actor: workUnit.actor.id }),
  });

  const approvalId = `appr_${randomUUID()}`;
  const expiresAt = new Date(now.getTime() + routing.expiresInMs);

  const approvalRequest: ApprovalRequest = {
    id: approvalId,
    actionId: `prop_${workUnit.id}`,
    envelopeId: workUnit.id,
    conversationId: null,
    summary: `${workUnit.intent} (requested by ${workUnit.actor.id})`,
    riskCategory,
    bindingHash,
    evidenceBundle: {
      decisionTrace: null,
      contextSnapshot: {},
      identitySnapshot: {},
    },
    suggestedButtons: [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: routing.approvers,
    fallbackApprover: routing.fallbackApprover,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt,
    expiredBehavior: routing.expiredBehavior,
    createdAt: now,
    quorum: null,
  };

  const approvalState = createApprovalState(expiresAt);
  await storageContext.approvals.save({
    request: approvalRequest,
    state: approvalState,
    envelopeId: workUnit.id,
    organizationId: workUnit.organizationId,
  });

  return { approvalId, bindingHash };
}
