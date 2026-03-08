// ---------------------------------------------------------------------------
// CAPI Dispatcher — Sends conversion events to Meta Conversions API
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { ConversionBus, ConversionEvent, ConversionEventType } from "@switchboard/core";
import type { CrmProvider, CrmContact } from "@switchboard/schemas";
import type { MetaAdsWriteProvider, ConversionEvent as CAPIEvent } from "../cartridge/types.js";

/**
 * Maps internal conversion types to Meta Conversions API event names.
 * See: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
 */
const EVENT_NAME_MAP: Record<ConversionEventType, string> = {
  inquiry: "Lead",
  qualified: "Lead",
  booked: "Schedule",
  purchased: "Purchase",
  completed: "Purchase",
};

/**
 * Configuration for the CAPI dispatcher.
 */
export interface CAPIDispatcherConfig {
  /** Meta ads write provider for sending events */
  adsProvider: MetaAdsWriteProvider;
  /** CRM provider for looking up contact details (email, phone for hashing) */
  crmProvider: CrmProvider;
  /** Meta pixel ID to send events to */
  pixelId: string;
  /** Currency code for conversion values (default: "USD") */
  currency?: string;
}

/**
 * Result of a CAPI dispatch attempt.
 */
export interface CAPIDispatchResult {
  sent: boolean;
  eventName?: string;
  reason?: string;
}

/**
 * SHA-256 hash a value for CAPI user data fields.
 * Meta requires lowercase, trimmed, SHA-256 hashed PII.
 */
function hashForCAPI(value: string): string {
  return createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}

/**
 * Build CAPI user_data from a CRM contact.
 * Only includes fields that have values.
 */
function buildUserData(contact: CrmContact): CAPIEvent["userData"] {
  const userData: CAPIEvent["userData"] = {};

  if (contact.email) {
    userData.em = [hashForCAPI(contact.email)];
  }
  if (contact.phone) {
    // Strip non-numeric chars except leading +
    const cleanPhone = contact.phone.replace(/[^\d+]/g, "");
    userData.ph = [hashForCAPI(cleanPhone)];
  }
  if (contact.firstName) {
    userData.fn = [hashForCAPI(contact.firstName)];
  }
  if (contact.lastName) {
    userData.ln = [hashForCAPI(contact.lastName)];
  }
  if (contact.externalId) {
    userData.externalId = [contact.externalId];
  }

  return userData;
}

/**
 * Dispatches conversion events to Meta Conversions API.
 *
 * When a conversion event fires (lead qualified, appointment booked, etc.),
 * the dispatcher:
 * 1. Looks up the CRM contact for attribution data
 * 2. Checks if the lead came from a Meta ad (sourceAdId present)
 * 3. Maps the conversion type to a Meta event name
 * 4. Builds a CAPI payload with hashed user data
 * 5. Sends via the Meta Marketing API client
 */
export class CAPIDispatcher {
  private readonly config: CAPIDispatcherConfig;
  private readonly currency: string;

  constructor(config: CAPIDispatcherConfig) {
    this.config = config;
    this.currency = config.currency ?? "USD";
  }

  /**
   * Register this dispatcher as a subscriber on the conversion bus.
   * Listens to all conversion events via wildcard.
   */
  register(bus: ConversionBus): void {
    bus.subscribe("*", (event) => {
      void this.handleEvent(event);
    });
  }

  /**
   * Handle a single conversion event.
   * Returns dispatch result for observability.
   */
  async handleEvent(event: ConversionEvent): Promise<CAPIDispatchResult> {
    // Step 1: Look up CRM contact
    let contact: CrmContact | null;
    try {
      contact = await this.config.crmProvider.getContact(event.contactId);
    } catch {
      return { sent: false, reason: "CRM lookup failed" };
    }

    if (!contact) {
      return { sent: false, reason: "Contact not found" };
    }

    // Step 2: Check for Meta attribution
    const sourceAdId = event.sourceAdId ?? contact.sourceAdId;
    if (!sourceAdId) {
      return { sent: false, reason: "No Meta ad attribution" };
    }

    // Step 3: Map conversion type to Meta event name
    const eventName = EVENT_NAME_MAP[event.type];

    // Step 4: Build CAPI payload
    const capiEvent: CAPIEvent = {
      eventName,
      eventTime: Math.floor(event.timestamp.getTime() / 1000),
      userData: buildUserData(contact),
      customData: {
        value: event.value,
        currency: this.currency,
        conversion_type: event.type,
        ...(event.sourceCampaignId ? { campaign_id: event.sourceCampaignId } : {}),
        ...event.metadata,
      },
      actionSource: "system_generated",
    };

    // Step 5: Send via Meta API
    try {
      const result = await this.config.adsProvider.sendConversionEvent(
        this.config.pixelId,
        capiEvent,
      );

      if (result.success) {
        return { sent: true, eventName };
      }
      return { sent: false, eventName, reason: "CAPI rejected event" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { sent: false, eventName, reason: `CAPI send failed: ${message}` };
    }
  }
}

// Export the hash utility for testing
export { hashForCAPI, buildUserData };
