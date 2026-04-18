import type {
  ConversionBus,
  ConversionEvent,
  ConversionEventHandler,
  ConversionEventType,
} from "./conversion-bus.js";

const STREAM_KEY = "switchboard:conversions";
const MAX_LEN = "10000";

interface RedisClient {
  xadd(...args: (string | number)[]): Promise<string>;
  xgroup(...args: (string | number)[]): Promise<string>;
  xreadgroup(
    ...args: (string | number)[]
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>;
  xack(stream: string, group: string, id: string): Promise<number>;
}

export class RedisStreamConversionBus implements ConversionBus {
  private handlers = new Map<string, Set<ConversionEventHandler>>();
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  subscribe(type: ConversionEventType | "*", handler: ConversionEventHandler): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
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

  async emit(event: ConversionEvent): Promise<void> {
    const data = JSON.stringify({
      eventId: event.eventId,
      type: event.type,
      contactId: event.contactId,
      organizationId: event.organizationId,
      value: event.value,
      sourceAdId: event.sourceAdId,
      sourceCampaignId: event.sourceCampaignId,
      occurredAt: event.occurredAt.toISOString(),
      source: event.source,
      causationId: event.causationId,
      workTraceId: event.workTraceId,
      metadata: event.metadata,
    });

    await this.redis.xadd(STREAM_KEY, "MAXLEN", "~", MAX_LEN, "*", "data", data);
  }

  async ensureConsumerGroup(groupName: string): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", STREAM_KEY, groupName, "0", "MKSTREAM");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("BUSYGROUP")) throw err;
    }
  }

  async readGroup(
    groupName: string,
    consumerName: string,
    count: number,
    blockMs: number,
  ): Promise<Array<{ id: string; event: ConversionEvent }>> {
    const result = await this.redis.xreadgroup(
      "GROUP",
      groupName,
      consumerName,
      "BLOCK",
      blockMs,
      "COUNT",
      count,
      "STREAMS",
      STREAM_KEY,
      ">",
    );

    if (!result) return [];

    const events: Array<{ id: string; event: ConversionEvent }> = [];
    for (const [_stream, entries] of result) {
      for (const [messageId, fields] of entries) {
        const dataIndex = fields.indexOf("data");
        if (dataIndex === -1) continue;
        const raw = JSON.parse(fields[dataIndex + 1]!);
        events.push({
          id: messageId,
          event: {
            ...raw,
            occurredAt: new Date(raw.occurredAt as string),
          },
        });
      }
    }

    return events;
  }

  async ack(groupName: string, messageId: string): Promise<void> {
    await this.redis.xack(STREAM_KEY, groupName, messageId);
  }

  handlerCount(): number {
    let count = 0;
    for (const set of this.handlers.values()) {
      count += set.size;
    }
    return count;
  }
}
