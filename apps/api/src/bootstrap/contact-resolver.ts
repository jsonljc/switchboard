import type { ContactLifecycleService } from "@switchboard/core";
import {
  TERMINAL_OPPORTUNITY_STAGES,
  type Contact,
  type Opportunity,
  type OpportunityStage,
} from "@switchboard/schemas";

export interface ResolveMessageInput {
  channelContactId: string;
  channel: string;
  organizationId: string;
  attribution?: Record<string, unknown> | null;
}

export interface ResolvedContact {
  contact: Contact;
  opportunity: Opportunity;
  isNewContact: boolean;
}

export class ContactResolver {
  constructor(private lifecycleService: ContactLifecycleService) {}

  async resolveForMessage(input: ResolveMessageInput): Promise<ResolvedContact> {
    const { channelContactId, channel, organizationId, attribution } = input;
    const primaryChannel = this.normalizeChannel(channel);

    // 1. Find existing contact by phone/channel ID
    let contact = await this.lifecycleService.findContactByPhone(organizationId, channelContactId);
    const isNewContact = !contact;

    // 2. Create contact if not found
    if (!contact) {
      contact = await this.lifecycleService.createContact({
        organizationId,
        phone: channelContactId,
        primaryChannel,
        firstTouchChannel: channel,
        source: this.extractSource(attribution),
        attribution: attribution ?? null,
        roles: ["lead"],
      });
    }

    // 3. Find active opportunity or create one
    const opportunity = await this.findOrCreateOpportunity(contact, organizationId);

    return { contact, opportunity, isNewContact };
  }

  private async findOrCreateOpportunity(
    contact: Contact,
    organizationId: string,
  ): Promise<Opportunity> {
    const detail = await this.lifecycleService.getContactWithOpportunities(
      organizationId,
      contact.id,
    );

    if (detail) {
      const activeOpp = detail.opportunities.find(
        (o) => !TERMINAL_OPPORTUNITY_STAGES.includes(o.stage as OpportunityStage),
      );
      if (activeOpp) return activeOpp;
    }

    return this.lifecycleService.createOpportunity({
      organizationId,
      contactId: contact.id,
      serviceId: "general-inquiry",
      serviceName: "General Inquiry",
      assignedAgent: "lead-responder",
    });
  }

  private normalizeChannel(channel: string): "whatsapp" | "telegram" | "dashboard" {
    if (channel === "telegram") return "telegram";
    if (channel === "dashboard") return "dashboard";
    return "whatsapp";
  }

  private extractSource(attribution?: Record<string, unknown> | null): string | null {
    if (!attribution) return null;
    return (attribution.utmSource as string) ?? null;
  }
}
