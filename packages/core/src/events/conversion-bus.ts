// ---------------------------------------------------------------------------
// Conversion Event Bus — Internal pub/sub for CRM-to-ads feedback loop
// ---------------------------------------------------------------------------

import type { ConversionStage } from "@switchboard/schemas";

/**
 * Conversion event types that flow through the feedback loop.
 * Ordered by funnel depth — each subsequent type represents deeper engagement.
 * @deprecated Use ConversionStage from @switchboard/schemas instead.
 */
export type ConversionEventType = ConversionStage;

/**
 * A conversion event emitted when a meaningful business outcome occurs.
 * Bridges CRM/customer-engagement events to the Meta CAPI feedback loop.
 */
export interface ConversionEvent {
  /** Unique application-level event ID for deduplication */
  eventId: string;
  /** Conversion type (funnel stage) */
  type: ConversionStage;
  /** CRM contact ID */
  contactId: string;
  /** Organization this event belongs to */
  organizationId: string;
  /** Dollar value of this conversion (0 if unknown) */
  value: number;
  /** Attribution: originating ad ID (from CRM contact.sourceAdId) */
  sourceAdId?: string;
  /** Attribution: originating campaign ID */
  sourceCampaignId?: string;
  /** When the conversion occurred */
  occurredAt: Date;
  /** Source system/component that emitted this event */
  source: string;
  /** ID of the triggering action/request (for causation tracking) */
  causationId?: string;
  /** ID linking related work across the system (for distributed tracing) */
  workTraceId?: string;
  /** Arbitrary metadata (deal stage, appointment details, etc.) */
  metadata: Record<string, unknown>;
}

/**
 * Callback signature for conversion event subscribers.
 */
export type ConversionEventHandler = (event: ConversionEvent) => void | Promise<void>;

/**
 * Typed event bus for conversion events.
 * Cartridges emit events; feedback systems (CAPI dispatcher, outcome tracker) subscribe.
 */
export interface ConversionBus {
  /** Subscribe to a specific conversion type (or all types with "*"). */
  subscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void;
  /** Unsubscribe a previously registered handler. */
  unsubscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void;
  /** Emit a conversion event. Handlers are invoked asynchronously. */
  emit(event: ConversionEvent): void | Promise<void>;
}

/**
 * In-memory conversion event bus.
 * Suitable for single-process deployments. For multi-process, swap with a
 * Redis/NATS-backed implementation that implements the same ConversionBus interface.
 */
export class InMemoryConversionBus implements ConversionBus {
  private handlers = new Map<string, Set<ConversionEventHandler>>();

  subscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void {
    const key = type;
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
  }

  unsubscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(type);
    }
  }

  emit(event: ConversionEvent): void {
    // Fire type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        this.safeInvoke(handler, event);
      }
    }

    // Fire wildcard handlers
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        this.safeInvoke(handler, event);
      }
    }
  }

  private safeInvoke(handler: ConversionEventHandler, event: ConversionEvent): void {
    try {
      const result = handler(event);
      // If the handler returns a promise, catch errors from it
      if (result && typeof result === "object" && "catch" in result) {
        (result as Promise<void>).catch((err: unknown) => {
          console.error("[ConversionBus] Async handler error:", err);
        });
      }
    } catch (err) {
      console.error("[ConversionBus] Handler error:", err);
    }
  }
}
