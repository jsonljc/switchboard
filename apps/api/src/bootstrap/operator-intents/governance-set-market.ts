// governance.set_market handler (P2-B slice 2). The governed, audited path for an operator
// (onboarding or settings) to set an Alex deployment's market — jurisdiction + clinicType —
// through PlatformIngress: operator_mutation + system_auto_approved + non-financial. Market is
// the org's DECLARATION of its clinic + jurisdiction, so there is NO readiness probe (unlike the
// enforce flip): it drives currency (currencyForJurisdiction) and the org-level baseline for
// per-lead jurisdiction. Both the applied write and any failure are recorded in WorkTrace by the
// surrounding ingress. The org is taken from the authenticated work unit, never a param.
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { DeploymentNotFoundError, GovernanceConfigInvalidError } from "@switchboard/db";
import {
  GovernanceSetMarketParametersSchema,
  type Jurisdiction,
  type ClinicType,
} from "@switchboard/schemas";
import { GOVERNANCE_SET_MARKET_INTENT, OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

export { GOVERNANCE_SET_MARKET_INTENT };

/** The store-write port the handler depends on (PrismaGovernanceMarketWriter satisfies it). */
export interface GovernanceMarketWriterPort {
  setMarket(input: {
    organizationId: string;
    deploymentId: string;
    jurisdiction: Jurisdiction;
    clinicType: ClinicType;
  }): Promise<{ id: string }>;
}

export interface GovernanceSetMarketDeps {
  writer: GovernanceMarketWriterPort;
}

export function buildGovernanceSetMarketHandler(
  deps: GovernanceSetMarketDeps,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = GovernanceSetMarketParametersSchema.parse(workUnit.parameters);

      try {
        await deps.writer.setMarket({
          organizationId: workUnit.organizationId,
          deploymentId: params.deploymentId,
          jurisdiction: params.jurisdiction,
          clinicType: params.clinicType,
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
        summary: `Set market to ${params.jurisdiction}/${params.clinicType}`,
        outputs: {
          deploymentId: params.deploymentId,
          jurisdiction: params.jurisdiction,
          clinicType: params.clinicType,
        },
      };
    },
  };
}
