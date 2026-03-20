// ---------------------------------------------------------------------------
// ConversionBus-to-Agent-Event-Pipeline Bridge
// ---------------------------------------------------------------------------
// Subscribes to the legacy ConversionBus (wildcard) and emits
// RoutedEventEnvelopes into the new agent event pipeline.
// ---------------------------------------------------------------------------

import type { ConversionBus, ConversionEvent, ConversionEventType } from "@switchboard/core";

import {
  createEventEnvelope,
  type AgentEventType,
  type AttributionChain,
  type RoutedEventEnvelope,
} from "../events.js";

/** Maps legacy ConversionEventType to canonical AgentEventType. */
const CONVERSION_TO_AGENT_EVENT: Record<ConversionEventType, AgentEventType> = {
  inquiry: "lead.received",
  qualified: "lead.qualified",
  booked: "stage.advanced",
  purchased: "revenue.recorded",
  completed: "revenue.recorded",
};

export interface ConversionBusBridgeOptions {
  onEvent: (envelope: RoutedEventEnvelope) => void;
}

/**
 * Bridge that subscribes to a ConversionBus and re-emits each
 * ConversionEvent as a RoutedEventEnvelope for the agent pipeline.
 */
export class ConversionBusBridge {
  private readonly onEvent: (envelope: RoutedEventEnvelope) => void;

  constructor(options: ConversionBusBridgeOptions) {
    this.onEvent = options.onEvent;
  }

  /**
   * Register this bridge on a ConversionBus by subscribing to all events.
   */
  register(bus: ConversionBus): void {
    bus.subscribe("*", (event: ConversionEvent) => {
      try {
        this.handleConversionEvent(event);
      } catch {
        // agent pipeline errors must not propagate into the ConversionBus
      }
    });
  }

  private handleConversionEvent(event: ConversionEvent): void {
    const agentEventType = CONVERSION_TO_AGENT_EVENT[event.type];

    if (agentEventType === undefined) {
      console.warn(
        `[ConversionBusBridge] Unmapped conversion type "${event.type}" – skipping event`,
      );
      return;
    }

    const attribution: AttributionChain = {
      fbclid: extractString(event.metadata, "fbclid"),
      gclid: null,
      ttclid: null,
      sourceCampaignId: event.sourceCampaignId ?? null,
      sourceAdId: event.sourceAdId ?? null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    };

    const envelope = createEventEnvelope({
      organizationId: event.organizationId,
      eventType: agentEventType,
      source: { type: "system", id: "conversion-bus-bridge" },
      attribution,
      payload: {
        contactId: event.contactId,
        value: event.value,
        originalType: event.type,
      },
      metadata: event.metadata,
    });

    this.onEvent(envelope);
  }
}

/** Safely extract a string value from metadata. */
function extractString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}
