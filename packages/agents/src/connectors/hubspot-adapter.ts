// ---------------------------------------------------------------------------
// HubSpot Connector Adapter — maps agent events to HubSpot CRM API calls
// ---------------------------------------------------------------------------

import type { CrmProvider } from "@switchboard/schemas";
import type { RoutedEventEnvelope } from "../events.js";
import type { ConnectorAdapter } from "./connector-port.js";

type EventPayload = Record<string, unknown>;

export class HubSpotConnectorAdapter implements ConnectorAdapter {
  readonly connectorType = "hubspot";
  readonly supportedEvents = [
    "lead.received",
    "lead.qualified",
    "stage.advanced",
    "revenue.recorded",
  ];

  constructor(private crm: CrmProvider) {}

  async handleEvent(event: RoutedEventEnvelope): Promise<{ success: boolean; error?: string }> {
    if (!this.supportedEvents.includes(event.eventType)) {
      return { success: false, error: `Event type unsupported: ${event.eventType}` };
    }

    try {
      const payload = event.payload as EventPayload;

      switch (event.eventType) {
        case "lead.received":
          await this.handleLeadReceived(payload);
          break;
        case "lead.qualified":
          await this.handleLeadQualified(payload);
          break;
        case "stage.advanced":
          await this.handleStageAdvanced(payload);
          break;
        case "revenue.recorded":
          await this.handleRevenueRecorded(payload);
          break;
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleLeadReceived(payload: EventPayload): Promise<void> {
    await this.crm.createContact({
      externalId: payload.contactId as string | undefined,
      email: payload.email as string | undefined,
      firstName: payload.firstName as string | undefined,
      lastName: payload.lastName as string | undefined,
      phone: payload.phone as string | undefined,
      sourceAdId: payload.sourceAdId as string | undefined,
      sourceCampaignId: payload.sourceCampaignId as string | undefined,
    });
  }

  private async handleLeadQualified(payload: EventPayload): Promise<void> {
    const contactId = payload.contactId as string;
    await this.crm.createDeal({
      name: `Lead ${contactId}`,
      stage: "qualified",
      contactIds: [contactId],
    });
  }

  private async handleStageAdvanced(payload: EventPayload): Promise<void> {
    const contactId = payload.contactId as string;
    const stage = payload.stage as string | undefined;
    await this.crm.logActivity({
      type: "note",
      subject: `Stage advanced to ${stage ?? "next"}`,
      body: `Contact ${contactId} advanced to stage: ${stage ?? "next"}`,
      contactIds: [contactId],
    });
  }

  private async handleRevenueRecorded(payload: EventPayload): Promise<void> {
    const contactId = payload.contactId as string;
    await this.crm.logActivity({
      type: "note",
      subject: `Revenue recorded: ${payload.amount}`,
      body: `Revenue of ${payload.amount} recorded for contact ${contactId}. Type: ${payload.type}`,
      contactIds: [contactId],
    });
  }
}
