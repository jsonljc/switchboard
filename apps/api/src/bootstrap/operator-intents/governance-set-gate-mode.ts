// governance.set_gate_mode handler (enforce-flip slice 3). The governed, audited path for an
// operator to flip an Alex governance gate observe <-> enforce (or off), through PlatformIngress:
// operator_mutation + system_auto_approved + non-financial. The AUTHORITATIVE safety gate lives
// HERE, server-side: an enforce flip is REFUSED when the gate's producer is empty (it would
// over-block legitimate replies). Rollback to observe/off is never readiness-gated. Both the
// refused attempt and the applied flip are recorded in WorkTrace by the surrounding ingress.
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { evaluateGateEnforceReadiness, type GateProducerSignals } from "@switchboard/core";
import { DeploymentNotFoundError, GovernanceConfigInvalidError } from "@switchboard/db";
import {
  GovernanceSetGateModeParametersSchema,
  type GovernanceGateUnit,
  type GovernanceMode,
} from "@switchboard/schemas";
import { GOVERNANCE_SET_GATE_MODE_INTENT, OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

export { GOVERNANCE_SET_GATE_MODE_INTENT };

/** The store-write port the handler depends on (PrismaGovernanceGateModeWriter satisfies it). */
export interface GovernanceGateModeWriterPort {
  setGateMode(input: {
    organizationId: string;
    deploymentId: string;
    unit: GovernanceGateUnit;
    mode: GovernanceMode;
  }): Promise<{ id: string }>;
}

export interface GovernanceSetGateModeDeps {
  writer: GovernanceGateModeWriterPort;
  probeProducers: (orgId: string, deploymentId: string) => Promise<GateProducerSignals>;
}

export function buildGovernanceSetGateModeHandler(
  deps: GovernanceSetGateModeDeps,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = GovernanceSetGateModeParametersSchema.parse(workUnit.parameters);

      // Readiness REFUSE applies ONLY to an enforce target. Rollback (observe/off) is
      // unconditional — disarming a gate must always be fast — so we skip the probe entirely.
      if (params.mode === "enforce") {
        const signals = await deps.probeProducers(workUnit.organizationId, params.deploymentId);
        const readiness = evaluateGateEnforceReadiness(params.unit, signals);
        if (!readiness.ready) {
          return {
            outcome: "failed" as const,
            summary: `Refused enforce flip for ${params.unit}: gate not ready`,
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.GATE_NOT_ENFORCE_READY,
              message: readiness.blockingReason ?? "Gate is not ready to enforce.",
            },
          };
        }
      }

      try {
        await deps.writer.setGateMode({
          organizationId: workUnit.organizationId,
          deploymentId: params.deploymentId,
          unit: params.unit,
          mode: params.mode,
        });
      } catch (err) {
        if (err instanceof DeploymentNotFoundError) {
          return {
            outcome: "failed" as const,
            summary: "Deployment not found",
            error: { code: OPERATOR_INTENT_ERROR_CODES.DEPLOYMENT_NOT_FOUND, message: err.message },
          };
        }
        if (err instanceof GovernanceConfigInvalidError) {
          return {
            outcome: "failed" as const,
            summary: "Stored governance config invalid",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.GOVERNANCE_CONFIG_INVALID,
              message: err.message,
            },
          };
        }
        throw err; // unexpected infra error -> 500 via ingress
      }

      return {
        outcome: "completed" as const,
        summary: `Set ${params.unit} gate to ${params.mode}`,
        outputs: { unit: params.unit, mode: params.mode, deploymentId: params.deploymentId },
      };
    },
  };
}
