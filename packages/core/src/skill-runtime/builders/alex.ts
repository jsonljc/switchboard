import type { BusinessFacts } from "@switchboard/schemas";
import type { ParameterBuilder } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";
import { renderBusinessFacts } from "../context-resolver.js";

export const alexBuilder: ParameterBuilder = async (ctx, config, stores) => {
  const contactId = config.contactId;

  const opportunities = await stores.opportunityStore.findActiveByContact(config.orgId, contactId);

  if (opportunities.length === 0) {
    throw new ParameterResolutionError(
      "no-active-opportunity",
      "I'd like to help, but there's no active deal found for this conversation. " +
        "Let me connect you with the team to get things started.",
    );
  }

  const opportunity = opportunities.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;

  const leadProfile = await stores.contactStore.findById(config.orgId, contactId);

  let BUSINESS_FACTS = "";
  if (stores.businessFactsStore) {
    const facts = (await stores.businessFactsStore.get(config.orgId)) as BusinessFacts | null;
    if (facts) {
      BUSINESS_FACTS = renderBusinessFacts(facts);
    }
  }

  return {
    BUSINESS_NAME: ctx.persona.businessName,
    OPPORTUNITY_ID: opportunity.id,
    LEAD_PROFILE: leadProfile,
    BUSINESS_FACTS,
    PERSONA_CONFIG: {
      tone: ctx.persona.tone,
      qualificationCriteria: ctx.persona.qualificationCriteria,
      disqualificationCriteria: ctx.persona.disqualificationCriteria,
      escalationRules: ctx.persona.escalationRules,
      bookingLink: ctx.persona.bookingLink ?? "",
      customInstructions: ctx.persona.customInstructions ?? "",
    },
  };
};
