import type { ConversionBus, ConversionEvent } from "./conversion-bus.js";

interface OutboxStoreSubset {
  fetchPending(limit: number): Promise<
    Array<{
      id: string;
      eventId: string;
      type: string;
      payload: Record<string, unknown>;
      status: string;
      attempts: number;
    }>
  >;
  markPublished(id: string): Promise<unknown>;
  recordFailure(id: string, attempts: number): Promise<unknown>;
}

export class OutboxPublisher {
  private readonly store: OutboxStoreSubset;
  private readonly bus: ConversionBus;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: OutboxStoreSubset, bus: ConversionBus) {
    this.store = store;
    this.bus = bus;
  }

  async publishBatch(batchSize = 50): Promise<void> {
    const pending = await this.store.fetchPending(batchSize);

    for (const row of pending) {
      const event: ConversionEvent = {
        eventId: row.eventId,
        type: row.payload.type as ConversionEvent["type"],
        contactId: row.payload.contactId as string,
        organizationId: row.payload.organizationId as string,
        value: (row.payload.value as number) ?? 0,
        // Payload currency may now be null (calendar-book abstains when the market is
        // unresolvable); normalize to undefined to match ConversionEvent.currency.
        currency: (row.payload.currency as string | null) ?? undefined,
        sourceAdId: row.payload.sourceAdId as string | undefined,
        sourceCampaignId: row.payload.sourceCampaignId as string | undefined,
        occurredAt: new Date(row.payload.occurredAt as string),
        source: (row.payload.source as string) ?? "outbox",
        causationId: row.payload.causationId as string | undefined,
        workTraceId: row.payload.workTraceId as string | undefined,
        accountId: row.payload.accountId as string | undefined,
        actionSource: row.payload.actionSource as ConversionEvent["actionSource"],
        customer: row.payload.customer as ConversionEvent["customer"],
        attribution: row.payload.attribution as ConversionEvent["attribution"],
        metadata: (row.payload.metadata as Record<string, unknown>) ?? {},
      };

      try {
        await this.bus.emit(event);
        await this.store.markPublished(row.id);
      } catch {
        await this.store.recordFailure(row.id, row.attempts + 1);
      }
    }
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.publishBatch().catch((err) => {
        console.error("[OutboxPublisher] batch error:", err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
