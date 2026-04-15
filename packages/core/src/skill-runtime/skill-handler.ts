import type { AgentHandler, AgentContext } from "@switchboard/sdk";
import type { SkillDefinition, SkillExecutor } from "./types.js";

interface OpportunityStoreSubset {
  findActiveByContact(
    orgId: string,
    contactId: string,
  ): Promise<Array<{ id: string; stage: string; createdAt: Date }>>;
}

interface ContactStoreSubset {
  findById(orgId: string, contactId: string): Promise<unknown>;
}

interface SkillHandlerStores {
  opportunityStore: OpportunityStoreSubset;
  contactStore: ContactStoreSubset;
}

interface SkillHandlerConfig {
  deploymentId: string;
  orgId: string;
  contactId: string;
}

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
    private stores: SkillHandlerStores,
    private config: SkillHandlerConfig,
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    const opportunities = await this.stores.opportunityStore.findActiveByContact(
      this.config.orgId,
      this.config.contactId,
    );

    if (opportunities.length === 0) {
      await ctx.chat.send(
        "I'd like to help, but there's no active deal found for this conversation. " +
          "Let me connect you with the team to get things started.",
      );
      return;
    }

    const opportunity = opportunities.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0]!;

    const leadProfile = await this.stores.contactStore.findById(
      this.config.orgId,
      this.config.contactId,
    );

    const parameters: Record<string, unknown> = {
      BUSINESS_NAME: ctx.persona.businessName,
      PIPELINE_STAGE: opportunity.stage,
      OPPORTUNITY_ID: opportunity.id,
      LEAD_PROFILE: leadProfile,
      PERSONA_CONFIG: {
        tone: ctx.persona.tone,
        qualificationCriteria: ctx.persona.qualificationCriteria,
        disqualificationCriteria: ctx.persona.disqualificationCriteria,
        escalationRules: ctx.persona.escalationRules,
        bookingLink: ctx.persona.bookingLink ?? "",
        customInstructions: ctx.persona.customInstructions ?? "",
      },
    };

    const messages = (ctx.conversation?.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const result = await this.executor.execute({
      skill: this.skill,
      parameters,
      messages,
      deploymentId: this.config.deploymentId,
      orgId: this.config.orgId,
      trustScore: ctx.trust.score,
      trustLevel: ctx.trust.level,
    });

    await ctx.chat.send(result.response);
  }
}
