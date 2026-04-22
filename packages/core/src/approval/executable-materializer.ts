import type { ApprovalRevision } from "@switchboard/schemas";
import type { MaterializeWorkUnitInput } from "./lifecycle-types.js";
import type { WorkUnit } from "../platform/work-unit.js";

export interface MaterializationParams {
  revision: ApprovalRevision;
  workUnit: WorkUnit;
  actionEnvelopeId: string;
  constraints: Record<string, unknown>;
  executableUntilMs: number;
}

export function buildMaterializationInput(params: MaterializationParams): MaterializeWorkUnitInput {
  const { revision, workUnit, actionEnvelopeId, constraints, executableUntilMs } = params;

  return {
    lifecycleId: revision.lifecycleId,
    approvalRevisionId: revision.id,
    actionEnvelopeId,
    frozenPayload: {
      intent: workUnit.intent,
      parameters: revision.parametersSnapshot,
      actor: workUnit.actor,
      organizationId: workUnit.organizationId,
      resolvedMode: workUnit.resolvedMode,
      traceId: workUnit.traceId,
    },
    frozenBinding: { ...workUnit.deployment },
    frozenExecutionPolicy: { ...constraints },
    executableUntil: new Date(Date.now() + executableUntilMs),
  };
}
