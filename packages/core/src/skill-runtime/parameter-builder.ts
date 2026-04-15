import type { AgentContext } from "@switchboard/sdk";

export interface SkillStores {
  opportunityStore: {
    findActiveByContact(
      orgId: string,
      contactId: string,
    ): Promise<Array<{ id: string; stage: string; createdAt: Date }>>;
  };
  contactStore: {
    findById(orgId: string, contactId: string): Promise<unknown>;
  };
  activityStore: {
    listByDeployment(
      orgId: string,
      deploymentId: string,
      opts: { limit: number },
    ): Promise<unknown>;
  };
}

/**
 * A ParameterBuilder resolves runtime context into skill parameters.
 *
 * BOUNDARY RULE: Builders only resolve and normalize inputs.
 * All decision-making belongs in the skill. Builders must NOT:
 * - Contain business logic
 * - Make decisions about what the skill should do
 * - Call unrelated services
 * - Perform side effects
 */
export type ParameterBuilder = (
  ctx: AgentContext,
  config: { deploymentId: string; orgId: string; contactId: string },
  stores: SkillStores,
) => Promise<Record<string, unknown>>;

export class ParameterResolutionError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "ParameterResolutionError";
  }
}

export function validateBuilderRegistration(
  deployments: Array<{ skillSlug: string | null }>,
  builders: Map<string, ParameterBuilder>,
): void {
  for (const d of deployments) {
    if (d.skillSlug && !builders.has(d.skillSlug)) {
      throw new Error(
        `Deployment references skill "${d.skillSlug}" but no ParameterBuilder is registered`,
      );
    }
  }
}
