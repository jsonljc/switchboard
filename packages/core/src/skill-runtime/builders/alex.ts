import type { BusinessFacts } from "@switchboard/schemas";
import type { ParameterBuilder } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";
import { renderBusinessFacts } from "../context-resolver.js";

export const alexBuilder: ParameterBuilder = async (ctx, config, stores) => {
  const contactId = config.contactId;
  const orgId = config.orgId;

  let opportunities = await stores.opportunityStore.findActiveByContact(orgId, contactId);

  // Auto-create Contact + Opportunity for new leads
  if (opportunities.length === 0) {
    let resolvedContactId = contactId;

    // Check if Contact exists; if not, create one
    const existingContact = await stores.contactStore.findById(orgId, contactId);
    if (!existingContact && stores.contactStore.create) {
      const phone = config.phone;
      const channel = config.channel ?? "whatsapp";
      const newContact = await stores.contactStore.create({
        organizationId: orgId,
        phone: phone ?? null,
        name: null,
        primaryChannel: channel as "whatsapp" | "telegram" | "dashboard",
        source: channel,
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

  const leadProfile = await stores.contactStore.findById(orgId, contactId);

  let BUSINESS_FACTS = "";
  if (stores.businessFactsStore) {
    const facts = (await stores.businessFactsStore.get(orgId)) as BusinessFacts | null;
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
