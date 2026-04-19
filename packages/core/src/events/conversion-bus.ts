// Re-export contracts from schemas for backwards compatibility
export type {
  ConversionEventType,
  ConversionEvent,
  ConversionEventHandler,
  ConversionBus,
} from "@switchboard/schemas";

import type {
  ConversionEvent,
  ConversionEventHandler,
  ConversionEventType,
} from "@switchboard/schemas";

/**
 * In-memory conversion event bus.
 * Suitable for single-process deployments. For multi-process, swap with a
 * Redis/NATS-backed implementation that implements the same ConversionBus interface.
 */
export class InMemoryConversionBus {
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
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        this.safeInvoke(handler, event);
      }
    }

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
