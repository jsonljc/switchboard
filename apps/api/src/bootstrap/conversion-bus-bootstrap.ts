import type { ConversionBus, ConversionEvent } from "@switchboard/core";
import type { Redis } from "ioredis";
import type { PrismaDbClient } from "@switchboard/db";
import type { ConversionPipelineMetrics } from "../metrics.js";

export interface ConversionBusHandle {
  bus: ConversionBus;
  start(): void;
  stop(): Promise<void>;
}

export async function bootstrapConversionBus(opts: {
  redis: Redis | null;
  prisma: PrismaDbClient | null;
  logger: { info(msg: string): void; warn(msg: string): void };
  metrics?: ConversionPipelineMetrics | null;
  pollIntervalMs?: number;
}): Promise<ConversionBusHandle> {
  const { redis, prisma, logger, metrics, pollIntervalMs = 1000 } = opts;

  const {
    InMemoryConversionBus,
    RedisStreamConversionBus,
    OutboxPublisher,
    ConversionStreamDrainer,
  } = await import("@switchboard/core");

  // RedisStreamConversionBus expects a narrower interface than ioredis exposes;
  // the cast is safe because ioredis implements all required methods.
  const redisBus = redis
    ? new RedisStreamConversionBus(
        redis as unknown as ConstructorParameters<typeof RedisStreamConversionBus>[0],
      )
    : null;
  const bus: ConversionBus = redisBus ?? new InMemoryConversionBus();

  logger.info(
    redis ? "ConversionBus: using Redis Streams" : "ConversionBus: using in-memory (no Redis)",
  );

  let publisher: InstanceType<typeof OutboxPublisher> | null = null;
  let drainer: InstanceType<typeof ConversionStreamDrainer> | null = null;

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

      // Like the record-write subscriber above, this handler SWALLOWS its failures
      // and resolves, so the drainer acks the message even when CAPI delivery
      // actually failed: parity with the prior in-memory bus, NOT redelivery.
      // Two honesty gaps, both tracked by the at-least-once follow-up (XAUTOCLAIM
      // PEL recovery + dead-letter + max-deliveries):
      //   1. CAPI failure is currently only LOGGED, not metered; there is no
      //      capiDispatchFailure counter yet. TODO: add one with the follow-up
      //      (a new counter touches all 3 metric registries, so out of scope here).
      //   2. Real redelivery would require this handler to PROPAGATE instead of
      //      swallow, which is only safe once PEL recovery + poison handling land.
      bus.subscribe("*", async (event: ConversionEvent) => {
        if (!capiDispatcher.canDispatch(event)) return;
        try {
          const result = await capiDispatcher.dispatch(event);
          if (!result.accepted) {
            // TODO(at-least-once follow-up): meter this rejection (capiDispatchFailure).
            console.warn(
              `[ConversionBus] MetaCAPI dispatch rejected: ${result.errorMessage}`,
              event.eventId,
            );
          }
        } catch (err) {
          // TODO(at-least-once follow-up): meter this failure (capiDispatchFailure).
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

    // Wire the CONSUME side. `RedisStreamConversionBus.emit` only XADDs to the
    // stream; without a drainer the subscribers above (record write + Meta CAPI)
    // never fire, so with REDIS_URL set those deliveries go dark. The in-memory
    // bus dispatches in-process on emit and needs no drainer. Co-gated on prisma
    // because the subscribers — the only consumers — are wired in this block;
    // draining with zero handlers would ack-drop messages.
    if (redisBus) {
      drainer = new ConversionStreamDrainer(redisBus);
      logger.info("ConversionBus: stream drainer wired (Redis consumer)");
    }
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
      if (drainer) {
        // Non-blocking: ensures the consumer group then runs the drain loop in the
        // background. Errors during startup are logged, not thrown, mirroring the
        // producer's fire-and-forget start.
        void drainer.start().catch((err) => {
          console.error("[ConversionBus] drain loop failed to start:", err);
        });
        logger.info("ConversionBus: stream drainer started (Redis consumer)");
      }
    },
    async stop() {
      if (publisher) {
        publisher.stop();
      }
      // Await the drain loop's exit before the caller tears down Redis, so an
      // in-flight readGroup never races a closing connection.
      if (drainer) {
        await drainer.stop();
      }
    },
  };
}
