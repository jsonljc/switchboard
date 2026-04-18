import type { ConversionBus, ConversionEvent } from "@switchboard/core";
import type Redis from "ioredis";
import type { PrismaDbClient } from "@switchboard/db";

export interface ConversionBusHandle {
  bus: ConversionBus;
  start(): void;
  stop(): void;
}

export async function bootstrapConversionBus(opts: {
  redis: Redis | null;
  prisma: PrismaDbClient | null;
  logger: { info(msg: string): void; warn(msg: string): void };
  pollIntervalMs?: number;
}): Promise<ConversionBusHandle> {
  const { redis, prisma, logger, pollIntervalMs = 1000 } = opts;

  const { InMemoryConversionBus, RedisStreamConversionBus, OutboxPublisher } =
    await import("@switchboard/core");

  // RedisStreamConversionBus expects a narrower interface than ioredis exposes;
  // the cast is safe because ioredis implements all required methods.
  const bus: ConversionBus = redis
    ? new RedisStreamConversionBus(
        redis as unknown as ConstructorParameters<typeof RedisStreamConversionBus>[0],
      )
    : new InMemoryConversionBus();

  logger.info(
    redis ? "ConversionBus: using Redis Streams" : "ConversionBus: using in-memory (no Redis)",
  );

  let publisher: InstanceType<typeof OutboxPublisher> | null = null;

  if (prisma) {
    const { PrismaOutboxStore, PrismaConversionRecordStore } = await import("@switchboard/db");
    const outboxStore = new PrismaOutboxStore(prisma);
    const conversionRecordStore = new PrismaConversionRecordStore(prisma);

    bus.subscribe("*", async (event: ConversionEvent) => {
      await conversionRecordStore.record(event);
    });

    // OutboxPublisher.OutboxStoreSubset expects payload as Record<string, unknown>;
    // Prisma returns JsonValue which is structurally compatible at runtime.
    publisher = new OutboxPublisher(
      outboxStore as unknown as ConstructorParameters<typeof OutboxPublisher>[0],
      bus,
    );

    logger.info("ConversionBus: OutboxPublisher + ConversionRecordStore wired");
  } else {
    logger.warn("ConversionBus: no Prisma client — OutboxPublisher and subscribers not wired");
  }

  return {
    bus,
    start() {
      if (publisher) {
        publisher.start(pollIntervalMs);
        logger.info(`ConversionBus: OutboxPublisher polling every ${pollIntervalMs}ms`);
      }
    },
    stop() {
      if (publisher) {
        publisher.stop();
      }
    },
  };
}
