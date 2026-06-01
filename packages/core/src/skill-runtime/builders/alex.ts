import type { AgentContext } from "@switchboard/sdk";
import type { BusinessFacts } from "@switchboard/schemas";
import type { SkillServices, SkillStores } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";
import { renderBusinessFacts } from "../context-resolver.js";
import { sanitizeContactForPrompt } from "../pii.js";

/**
 * PR-3.2c: alex returns parameters AND the surfaced pattern IDs so they
 * can be threaded to WorkTrace at finalize. Other builders that don't call
 * ContextBuilder use the flat `ParameterBuilder` return shape.
 */
export interface AlexBuilderResult {
  parameters: Record<string, unknown>;
  injectedPatternIds: string[];
}

export const alexBuilder = async (
  ctx: AgentContext,
  config: {
    deploymentId: string;
    orgId: string;
    contactId: string;
    phone?: string;
    channel?: string;
    message?: string;
    // PR-3.2e: resolved from
    // AgentDeployment.inputConfig.outcomePatterns.pilotMode at the caller
    // (skill-mode.ts) via resolveOutcomePatternsConfig(). When true,
    // ContextBuilder surfaces patterns at the relaxed pilot bar.
    pilotMode?: boolean;
  },
  stores: SkillStores,
  services?: SkillServices,
): Promise<AlexBuilderResult> => {
  const contactId = config.contactId;
  const orgId = config.orgId;
  let resolvedContactId = contactId;

  let opportunities = await stores.opportunityStore.findActiveByContact(orgId, contactId);

  // Auto-create Contact + Opportunity for new leads
  if (opportunities.length === 0) {
    // Check if Contact exists; if not, create one
    const existingContact = await stores.contactStore.findById(orgId, contactId);
    if (!existingContact && stores.contactStore.create) {
      const phone = config.phone;
      const channel = config.channel ?? "whatsapp";
      const isWhatsApp = channel === "whatsapp";
      const newContact = await stores.contactStore.create({
        organizationId: orgId,
        phone: phone ?? null,
        name: null,
        primaryChannel: channel as "whatsapp" | "telegram" | "dashboard",
        source: channel,
        ...(isWhatsApp
          ? { messagingOptIn: true, messagingOptInSource: "organic_inbound" as const }
          : {}),
      });
      resolvedContactId = newContact.id;
    } else if (existingContact) {
      resolvedContactId = (existingContact as { id: string }).id;
    }

    // Auto-create Opportunity
    if (stores.opportunityStore.create) {
      const newOpp = await stores.opportunityStore.create({
        organizationId: orgId,
        contactId: resolvedContactId,
        serviceId: "general-inquiry",
        serviceName: "General Inquiry",
      });
      opportunities = [newOpp];
    }

    if (opportunities.length === 0) {
      throw new ParameterResolutionError(
        "no-active-opportunity",
        "I'd like to help, but there's no active deal found for this conversation. " +
          "Let me connect you with the team to get things started.",
      );
    }
  }

  const opportunity = opportunities.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;

  // Guard: NEVER call findById with an undefined id. If no contact resolved
  // (config.contactId absent AND no mint), LEAD_PROFILE is null; the existing
  // no-opportunity ParameterResolutionError still escalates.
  const leadProfile = resolvedContactId
    ? await stores.contactStore.findById(orgId, resolvedContactId)
    : null;

  let BUSINESS_FACTS = "";
  if (stores.businessFactsStore) {
    const facts = (await stores.businessFactsStore.get(orgId)) as BusinessFacts | null;
    if (facts) {
      BUSINESS_FACTS = renderBusinessFacts(facts);
    }
  }

  // Resolve outcome-informed patterns from ContextBuilder when available.
  // Empty string when no services or no high-confidence patterns have surfaced yet —
  // {{OUTCOME_PATTERNS}} in the template renders as a clean blank line in that case.
  // query comes from the inbound message (config.message); OUTCOME_PATTERNS itself
  // originates from listHighConfidence (pattern memory), not retrieval chunks, but
  // passing the real query avoids firing an empty-query retrieval round-trip.
  let OUTCOME_PATTERNS = "";
  let injectedPatternIds: string[] = [];
  if (services?.contextBuilder) {
    const builtCtx = await services.contextBuilder.build({
      organizationId: config.orgId,
      agentId: "alex",
      deploymentId: config.deploymentId,
      query: config.message ?? "",
      contactId: resolvedContactId,
      pilotMode: config.pilotMode ?? false,
    });
    OUTCOME_PATTERNS = builtCtx.outcomePatternContext;
    injectedPatternIds = builtCtx.injectedPatternIds;
  }

  const parameters = {
    BUSINESS_NAME: ctx.persona.businessName,
    OPPORTUNITY_ID: opportunity.id,
    LEAD_PROFILE: sanitizeContactForPrompt(leadProfile),
    BUSINESS_FACTS,
    OUTCOME_PATTERNS,
    PERSONA_CONFIG: {
      tone: ctx.persona.tone,
      qualificationCriteria: ctx.persona.qualificationCriteria,
      disqualificationCriteria: ctx.persona.disqualificationCriteria,
      escalationRules: ctx.persona.escalationRules,
      bookingLink: ctx.persona.bookingLink ?? "",
      customInstructions: ctx.persona.customInstructions ?? "",
    },
    // trusted runtime value read by composeSkillRequestContext, not a prompt token
    contactId: resolvedContactId,
  };

  return {
    parameters,
    injectedPatternIds,
  };
};
