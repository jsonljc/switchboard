// ---------------------------------------------------------------------------
// Dead Letter Alerter — snapshots retryable items about to be swept,
// transitions them via sweepDeadLetters, and emits escalation events.
// ---------------------------------------------------------------------------

import type { DeliveryStore } from "./delivery-store.js";
import { DEFAULT_MAX_RETRIES } from "./delivery-store.js";
import { createEventEnvelope } from "./events.js";
import type { RoutedEventEnvelope } from "./events.js";

export interface DeadLetterAlerterConfig {
  store: DeliveryStore;
  onEscalation: (event: RoutedEventEnvelope) => void;
  maxRetries?: number;
}

export interface SweepResult {
  deadLettered: number;
}

export class DeadLetterAlerter {
  private store: DeliveryStore;
  private onEscalation: (event: RoutedEventEnvelope) => void;
  private maxRetries: number;

  constructor(config: DeadLetterAlerterConfig) {
    this.store = config.store;
    this.onEscalation = config.onEscalation;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async sweep(organizationId: string): Promise<SweepResult> {
    const retryable = await this.store.listRetryable();
    const willDeadLetter = retryable.filter((a) => a.attempts >= this.maxRetries);

    const count = await this.store.sweepDeadLetters(this.maxRetries);

    for (const attempt of willDeadLetter) {
      console.warn(
        `[dead-letter] eventId=${attempt.eventId} dest=${attempt.destinationId} ` +
          `attempts=${attempt.attempts} error=${attempt.error ?? "unknown"}`,
      );

      const event = createEventEnvelope({
        organizationId,
        eventType: "conversation.escalated",
        source: { type: "system", id: "dead-letter-alerter" },
        payload: {
          reason: "dead_letter",
          eventId: attempt.eventId,
          destinationId: attempt.destinationId,
          attempts: attempt.attempts,
          error: attempt.error ?? null,
        },
      });

      this.onEscalation(event);
    }

    return { deadLettered: count };
  }
}
