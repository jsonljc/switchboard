import type { ConversionBus, ConversionEvent } from "@switchboard/core";
import type Redis from "ioredis";
import type { PrismaDbClient } from "@switchboard/db";
import type { ConversionPipelineMetrics } from "../metrics.js";

export interface ConversionBusHandle {
  bus: ConversionBus;
  start(): void;
  stop(): void;
}

export async function bootstrapConversionBus(opts: {
  redis: Redis | null;
  prisma: PrismaDbClient | null;
  logger: { info(msg: string): void; warn(msg: string): void };
  metrics?: ConversionPipelineMetrics | null;
  pollIntervalMs?: number;
}): Promise<ConversionBusHandle> {
  const { redis, prisma, logger, metrics, pollIntervalMs = 1000 } = opts;

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
      try {
        await conversionRecordStore.record(event);
        metrics?.conversionRecordWriteSuccess.inc({ event_type: event.type });
      } catch (err) {
        metrics?.conversionRecordWriteFailure.inc({ event_type: event.type });
        console.error("[ConversionBus] Record write failed:", err);
      }
    });

    // Wire MetaCAPIDispatcher if Meta CAPI credentials are configured
    const metaPixelId = process.env["META_PIXEL_ID"];
    const metaCapiToken = process.env["META_CAPI_ACCESS_TOKEN"];

    if (metaPixelId && metaCapiToken) {
      const { MetaCAPIDispatcher } = await import("@switchboard/ad-optimizer");
      const capiDispatcher = new MetaCAPIDispatcher({
        pixelId: metaPixelId,
        accessToken: metaCapiToken,
      });

      bus.subscribe("*", async (event: ConversionEvent) => {
        if (!capiDispatcher.canDispatch(event)) return;
        try {
          const result = await capiDispatcher.dispatch(event);
          if (!result.accepted) {
            console.warn(
              `[ConversionBus] MetaCAPI dispatch rejected: ${result.errorMessage}`,
              event.eventId,
            );
          }
        } catch (err) {
          console.error("[ConversionBus] MetaCAPI dispatch failed:", err);
        }
      });

      logger.info("ConversionBus: MetaCAPIDispatcher wired for Meta Conversions API");

      // OutcomeDispatcher subscription intentionally absent — see TODO in
      // `outcome-wiring.ts`. The active CAPI path is `MetaCAPIDispatcher` above;
      // running both would double-fire one business event into two governed CAPI
      // decisions, violating doctrine. The OutcomeDispatcher implementation and
      // its `subscribeOutcomeDispatcher` helper remain as building blocks for the
      // post-wedge migration once the event_name dependency audit ships.
    }

    // Instrument the bus passed to the publisher to track publish metrics
    const instrumentedBus: ConversionBus = {
      subscribe: bus.subscribe.bind(bus),
      unsubscribe: bus.unsubscribe.bind(bus),
      emit(event: ConversionEvent) {
        metrics?.outboxPublishSuccess.inc({ event_type: event.type });
        return bus.emit(event);
      },
    };

    // Wrap store to track publish failures
    const instrumentedStore = {
      fetchPending: outboxStore.fetchPending.bind(outboxStore),
      markPublished: outboxStore.markPublished.bind(outboxStore),
      recordFailure: async (id: string, attempts: number) => {
        metrics?.outboxPublishFailure.inc({ event_type: "unknown" });
        await outboxStore.recordFailure(id, attempts);
      },
    };

    publisher = new OutboxPublisher(
      instrumentedStore as unknown as ConstructorParameters<typeof OutboxPublisher>[0],
      instrumentedBus,
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
