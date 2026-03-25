import type {
  Contact,
  Opportunity,
  OpportunityStage,
  LifecycleRevenueEvent,
  PipelineSnapshot,
} from "@switchboard/schemas";
import type { ContactStore, CreateContactInput } from "./contact-store.js";
import type { OpportunityStore, CreateOpportunityInput } from "./opportunity-store.js";
import type { RevenueStore, RecordRevenueInput } from "./revenue-store.js";
import type { OwnerTaskStore } from "./owner-task-store.js";
import { validateTransition } from "./transition-validator.js";
import { deriveContactStage } from "./contact-stage-deriver.js";
import type {
  StageAdvancementResult,
  RevenueRecordedData,
  ContactDetail,
} from "./lifecycle-types.js";

export interface ContactLifecycleServiceConfig {
  contactStore: ContactStore;
  opportunityStore: OpportunityStore;
  revenueStore: RevenueStore;
  ownerTaskStore: OwnerTaskStore;
  defaultDormancyThresholdDays?: number;
  defaultReopenWindowDays?: number;
}

export class ContactLifecycleService {
  private contactStore: ContactStore;
  private opportunityStore: OpportunityStore;
  private revenueStore: RevenueStore;
  private dormancyThresholdDays: number;
  private reopenWindowDays: number;

  constructor(config: ContactLifecycleServiceConfig) {
    this.contactStore = config.contactStore;
    this.opportunityStore = config.opportunityStore;
    this.revenueStore = config.revenueStore;
    // ownerTaskStore reserved for future use (fallback task automation)
    this.dormancyThresholdDays = config.defaultDormancyThresholdDays ?? 30;
    this.reopenWindowDays = config.defaultReopenWindowDays ?? 90;
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    return this.contactStore.create(input);
  }

  async getContact(orgId: string, contactId: string): Promise<Contact | null> {
    return this.contactStore.findById(orgId, contactId);
  }

  async findContactByPhone(orgId: string, phone: string): Promise<Contact | null> {
    return this.contactStore.findByPhone(orgId, phone);
  }

  async refreshContactStage(orgId: string, contactId: string): Promise<Contact> {
    const contact = await this.contactStore.findById(orgId, contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);

    const opportunities = await this.opportunityStore.findByContact(orgId, contactId);
    const newStage = deriveContactStage(
      opportunities,
      contact.lastActivityAt,
      this.dormancyThresholdDays,
    );

    if (newStage !== contact.stage) {
      return this.contactStore.updateStage(orgId, contactId, newStage);
    }
    return contact;
  }

  async createOpportunity(input: CreateOpportunityInput): Promise<Opportunity> {
    const opportunity = await this.opportunityStore.create(input);
    await this.contactStore.updateLastActivity(input.organizationId, input.contactId);
    await this.refreshContactStage(input.organizationId, input.contactId);
    return opportunity;
  }

  async advanceOpportunityStage(
    orgId: string,
    opportunityId: string,
    toStage: OpportunityStage,
    advancedBy: string,
  ): Promise<StageAdvancementResult> {
    const opportunity = await this.opportunityStore.findById(orgId, opportunityId);
    if (!opportunity) throw new Error(`Opportunity not found: ${opportunityId}`);

    const result = validateTransition(opportunity.stage as OpportunityStage, toStage);
    if (!result.valid) {
      throw new Error(result.reason);
    }

    const closedAt = toStage === "won" || toStage === "lost" ? new Date() : undefined;
    const updated = await this.opportunityStore.updateStage(
      orgId,
      opportunityId,
      toStage,
      closedAt,
    );
    await this.contactStore.updateLastActivity(orgId, opportunity.contactId);
    await this.refreshContactStage(orgId, opportunity.contactId);

    return {
      opportunity: updated,
      advancementData: {
        contactId: opportunity.contactId,
        opportunityId,
        previousStage: opportunity.stage as OpportunityStage,
        newStage: toStage,
        serviceName: opportunity.serviceName,
        advancedBy,
      },
    };
  }

  async reopenOpportunity(
    orgId: string,
    opportunityId: string,
    toStage: "interested" | "qualified",
  ): Promise<Opportunity> {
    const opportunity = await this.opportunityStore.findById(orgId, opportunityId);
    if (!opportunity) throw new Error(`Opportunity not found: ${opportunityId}`);

    if (opportunity.stage !== "lost") {
      throw new Error(`Can only reopen lost opportunities, current stage: ${opportunity.stage}`);
    }

    if (opportunity.closedAt) {
      const daysSinceClosed =
        (Date.now() - new Date(opportunity.closedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceClosed > this.reopenWindowDays) {
        throw new Error(
          `Reopen window expired (${Math.floor(daysSinceClosed)} days > ${this.reopenWindowDays} day limit). Create a new opportunity instead.`,
        );
      }
    }

    const result = validateTransition("lost", toStage);
    if (!result.valid) throw new Error(result.reason);

    const updated = await this.opportunityStore.updateStage(orgId, opportunityId, toStage, null);
    await this.refreshContactStage(orgId, opportunity.contactId);
    return updated;
  }

  async recordRevenue(input: RecordRevenueInput): Promise<{
    revenueEvent: LifecycleRevenueEvent;
    revenueData: RevenueRecordedData;
    stageAdvancement: StageAdvancementResult | null;
  }> {
    const opportunity = await this.opportunityStore.findById(
      input.organizationId,
      input.opportunityId,
    );
    if (!opportunity) throw new Error(`Opportunity not found: ${input.opportunityId}`);

    const revenueEvent = await this.revenueStore.record(input);
    await this.opportunityStore.updateRevenueTotal(input.organizationId, input.opportunityId);

    // Auto-advance showed → won on revenue recording
    let stageAdvancement: StageAdvancementResult | null = null;
    if (opportunity.stage === "showed") {
      stageAdvancement = await this.advanceOpportunityStage(
        input.organizationId,
        input.opportunityId,
        "won",
        "system",
      );
    }

    await this.contactStore.updateLastActivity(input.organizationId, input.contactId);
    await this.refreshContactStage(input.organizationId, input.contactId);

    const revenueData: RevenueRecordedData = {
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      amount: input.amount,
      currency: input.currency ?? "SGD",
      type: input.type,
      sourceCampaignId: input.sourceCampaignId ?? null,
      sourceAdId: input.sourceAdId ?? null,
    };

    return { revenueEvent, revenueData, stageAdvancement };
  }

  async getPipeline(orgId: string): Promise<PipelineSnapshot> {
    const stageCounts = await this.opportunityStore.countByStage(orgId);
    const revenue = await this.revenueStore.sumByOrg(orgId);

    return {
      organizationId: orgId,
      stages: stageCounts.map((s) => ({
        stage: s.stage,
        count: s.count,
        totalValue: s.totalValue,
      })),
      totalContacts: stageCounts.reduce((sum, s) => sum + s.count, 0),
      totalRevenue: revenue.totalAmount,
      generatedAt: new Date(),
    };
  }

  async getContactWithOpportunities(
    orgId: string,
    contactId: string,
  ): Promise<ContactDetail | null> {
    const contact = await this.contactStore.findById(orgId, contactId);
    if (!contact) return null;
    const opportunities = await this.opportunityStore.findByContact(orgId, contactId);
    return { contact, opportunities };
  }
}
