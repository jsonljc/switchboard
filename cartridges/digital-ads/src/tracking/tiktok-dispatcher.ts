// ---------------------------------------------------------------------------
// TikTok Events API Dispatcher — Sends conversion events to TikTok
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { ConversionBus, ConversionEvent, ConversionEventType } from "@switchboard/core";
import type { CrmContact } from "@switchboard/schemas";

const EVENT_NAME_MAP: Record<ConversionEventType, string> = {
  inquiry: "SubmitForm",
  qualified: "Contact",
  booked: "Schedule",
  purchased: "CompletePayment",
  completed: "CompletePayment",
};

interface TikTokEventPayload {
  event: string;
  event_id: string;
  timestamp: string;
  context: {
    user: {
      ttclid?: string;
      email?: string;
      phone_number?: string;
      external_id?: string;
    };
  };
  properties: {
    value?: number;
    currency?: string;
  };
}

export interface TikTokDispatcherConfig {
  sendEvent: (pixelId: string, event: TikTokEventPayload) => Promise<{ success: boolean }>;
  crmProvider: { getContact(contactId: string): Promise<CrmContact | null> };
  pixelId: string;
  currency?: string;
}

function hashForTikTok(value: string): string {
  return createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}

function generateEventId(contactId: string, eventType: string, timestamp: Date): string {
  return createHash("sha256")
    .update(`${contactId}:${eventType}:${timestamp.getTime()}`)
    .digest("hex");
}

export class TikTokDispatcher {
  private readonly config: TikTokDispatcherConfig;
  private readonly currency: string;

  constructor(config: TikTokDispatcherConfig) {
    this.config = config;
    this.currency = config.currency ?? "MYR";
  }

  register(bus: ConversionBus): void {
    bus.subscribe("*", (event) => {
      void this.handleEvent(event);
    });
  }

  async handleEvent(event: ConversionEvent): Promise<void> {
    let contact: CrmContact | null;
    try {
      contact = await this.config.crmProvider.getContact(event.contactId);
    } catch (err) {
      console.warn("[TikTokDispatcher] CRM lookup failed for contact", event.contactId, err);
      return;
    }

    if (!contact) return;

    // Need ttclid or PII to send
    const hasTtclid = !!contact.ttclid;
    const hasPII = !!contact.email || !!contact.phone;
    if (!hasTtclid && !hasPII) return;

    const user: TikTokEventPayload["context"]["user"] = {};
    if (contact.ttclid) user.ttclid = contact.ttclid;
    if (contact.email) user.email = hashForTikTok(contact.email);
    if (contact.phone) {
      const cleanPhone = contact.phone.replace(/[^\d+]/g, "");
      user.phone_number = hashForTikTok(cleanPhone);
    }
    if (contact.externalId) user.external_id = contact.externalId;

    const payload: TikTokEventPayload = {
      event: EVENT_NAME_MAP[event.type],
      event_id: generateEventId(event.contactId, event.type, event.timestamp),
      timestamp: event.timestamp.toISOString(),
      context: { user },
      properties: {
        value: event.value,
        currency: this.currency,
      },
    };

    try {
      await this.config.sendEvent(this.config.pixelId, payload);
    } catch (err) {
      console.warn(
        "[TikTokDispatcher] Failed to send event to TikTok",
        { pixelId: this.config.pixelId, event: payload.event, contactId: event.contactId },
        err,
      );
    }
  }
}
