import type { AgentContext } from "@switchboard/sdk";
import type { ContextBuilder } from "../memory/context-builder.js";
import type { MiraCreativeReadModelReader } from "../creative-read-model/types.js";
import type { FrontlineConversionLedgerReader } from "./builders/frontline-conversion.js";
import type { PlaybookReader } from "../conversation-lifecycle/qualification/types.js";

/**
 * The DeploymentMemory subset the mira builder reads (slice-4 spec 3.3).
 * PrismaDeploymentMemoryStore satisfies this structurally.
 */
export interface DeploymentMemoryHighConfidenceReader {
  listHighConfidence(
    organizationId: string,
    deploymentId: string,
    minConfidence: number,
    minSourceCount: number,
  ): Promise<
    Array<{
      id: string;
      category: string;
      canonicalKey: string | null;
      sourceCount: number;
      confidence: number;
    }>
  >;
}

export interface SkillServices {
  /**
   * Outcome-informed context builder. When provided, builders may call
   * `contextBuilder.build()` to surface high-confidence patterns and
   * learned facts for injection into the skill prompt.
   */
  contextBuilder?: ContextBuilder;
}

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
      messagingOptIn?: boolean;
      messagingOptInSource?: "ctwa" | "organic_inbound" | "web_form" | "manual";
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
  /**
   * D3-1: OPTIONAL org playbook reader. When provided, alexBuilder renders the
   * playbook's bookable service NAMES into BOOKABLE_SERVICES so Alex emits a
   * `service` the booked-value resolver matches. Optional for back-compat: absent
   * -> BOOKABLE_SERVICES renders "" and Alex falls back to free text (the resolver
   * abstains, the safe default).
   */
  playbookReader?: PlaybookReader;
  /** Slice-4 mira brain: taste + revenue-proven memory read at brief time. */
  deploymentMemoryReader?: DeploymentMemoryHighConfidenceReader;
  /** Slice-4 mira brain: measured performance + pipeline counts at brief time. */
  miraReadModelReader?: MiraCreativeReadModelReader;
  /**
   * Alex -> Mira frontline conversion feed: which treatments the booking agent
   * actually books (F5 org-scoped booking-outcome ledger). Optional for
   * back-compat; absent -> the builder renders an empty signal.
   */
  bookingOutcomeLedgerReader?: FrontlineConversionLedgerReader;
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
    /** The inbound message text, threaded from workUnit.parameters._message. Used as
     * the retrieval query when ContextBuilder is wired. Optional — older call sites
     * that don't pass it fall back to an empty-string query. */
    message?: string;
  },
  stores: SkillStores,
  services?: SkillServices,
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
