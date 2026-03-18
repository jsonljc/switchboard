// ---------------------------------------------------------------------------
// Delivery Store — per-destination delivery attempt tracking
// ---------------------------------------------------------------------------

export type DeliveryStatus =
  | "pending"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "retrying"
  | "dead_letter";

export interface DeliveryAttempt {
  eventId: string;
  destinationId: string;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt?: string;
  error?: string;
}

export interface DeliveryStore {
  record(attempt: DeliveryAttempt): Promise<void>;
  update(
    eventId: string,
    destinationId: string,
    updates: Partial<Pick<DeliveryAttempt, "status" | "attempts" | "error" | "lastAttemptAt">>,
  ): Promise<void>;
  getByEvent(eventId: string): Promise<DeliveryAttempt[]>;
  listRetryable(): Promise<DeliveryAttempt[]>;
}

export class InMemoryDeliveryStore implements DeliveryStore {
  private attempts = new Map<string, DeliveryAttempt>();

  private key(eventId: string, destinationId: string): string {
    return `${eventId}::${destinationId}`;
  }

  async record(attempt: DeliveryAttempt): Promise<void> {
    this.attempts.set(this.key(attempt.eventId, attempt.destinationId), { ...attempt });
  }

  async update(
    eventId: string,
    destinationId: string,
    updates: Partial<Pick<DeliveryAttempt, "status" | "attempts" | "error" | "lastAttemptAt">>,
  ): Promise<void> {
    const existing = this.attempts.get(this.key(eventId, destinationId));
    if (existing) {
      Object.assign(existing, updates);
    }
  }

  async getByEvent(eventId: string): Promise<DeliveryAttempt[]> {
    const results: DeliveryAttempt[] = [];
    for (const [key, attempt] of this.attempts) {
      if (key.startsWith(`${eventId}::`)) {
        results.push({ ...attempt });
      }
    }
    return results;
  }

  async listRetryable(): Promise<DeliveryAttempt[]> {
    const results: DeliveryAttempt[] = [];
    for (const attempt of this.attempts.values()) {
      if (attempt.status === "failed" || attempt.status === "retrying") {
        results.push({ ...attempt });
      }
    }
    return results;
  }
}
