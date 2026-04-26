import type { AgentContext } from "@switchboard/sdk";

export interface SkillStores {
  opportunityStore: {
    findActiveByContact(
      orgId: string,
      contactId: string,
    ): Promise<Array<{ id: string; stage: string; createdAt: Date }>>;
    create?(input: {
      organizationId: string;
      contactId: string;
      serviceId: string;
      serviceName: string;
    }): Promise<{ id: string; stage: string; createdAt: Date }>;
  };
  contactStore: {
    findById(orgId: string, contactId: string): Promise<unknown>;
    create?(input: {
      organizationId: string;
      phone?: string | null;
      name?: string | null;
      primaryChannel: "whatsapp" | "telegram" | "dashboard";
      source?: string | null;
    }): Promise<{ id: string }>;
  };
  activityStore: {
    listByDeployment(
      orgId: string,
      deploymentId: string,
      opts: { limit: number },
    ): Promise<unknown>;
  };
  businessFactsStore?: {
    get(organizationId: string): Promise<unknown>;
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
  config: {
    deploymentId: string;
    orgId: string;
    contactId: string;
    phone?: string;
    channel?: string;
  },
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
