import { createHash } from "node:crypto";
import type { ConversionBus, ConversionEvent } from "@switchboard/core";
import type Redis from "ioredis";
import type { PrismaDbClient } from "@switchboard/db";
import type { ConversionPipelineMetrics } from "../metrics.js";
import { subscribeOutcomeDispatcher, type LifecycleEventBus } from "./outcome-wiring.js";

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

      // Wire OutcomeDispatcher (Task 11): forwards lifecycle stage transitions
      // (qualified, booked, paid) to Meta CAPI with deterministic event_ids
      // so Inngest retries dedupe at Meta's side.
      const { OutcomeDispatcher } = await import("@switchboard/ad-optimizer");
      const { PrismaContactReader } = await import("@switchboard/db");

      const contactReader = new PrismaContactReader(prisma);

      // Adapter: OutcomeDispatcher's CapiLike contract (eventName/actionSource/
      // attribution/value/currency) → Meta CAPI HTTP. We post directly rather
      // than reuse MetaCAPIDispatcher because that dispatcher derives the Meta
      // event_name from a different ConversionStage map (e.g. qualified→
      // QualifiedLead) than OutcomeDispatcher uses (qualified→Lead).
      const capiAdapter = {
        async dispatch(input: {
          eventName: string;
          actionSource: string;
          attribution: Record<string, unknown>;
          value?: number;
          currency?: string;
        }): Promise<{ ok: boolean }> {
          const eventTime = Math.floor(Date.now() / 1000);
          // Deterministic event_id: dedupes Inngest at-least-once retries at
          // Meta's CAPI dedup boundary (1-hour window keyed on event_id).
          const eventId = createHash("sha256")
            .update(
              [
                input.eventName,
                input.actionSource,
                JSON.stringify(input.attribution),
                eventTime.toString(),
              ].join(":"),
            )
            .digest("hex");

          const userData: Record<string, unknown> = {};
          const leadId = input.attribution["lead_id"] ?? input.attribution["leadgen_id"];
          if (leadId) userData["lead_id"] = leadId;
          const ctwaClid = input.attribution["ctwa_clid"];
          if (ctwaClid) userData["ctwa_clid"] = ctwaClid;
          const fbclid = input.attribution["fbclid"];
          if (fbclid) userData["fbc"] = `fb.1.${Date.now()}.${fbclid}`;

          const customData =
            input.value != null && input.currency
              ? { value: input.value, currency: input.currency }
              : undefined;

          const url = `https://graph.facebook.com/v21.0/${metaPixelId}/events`;
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${metaCapiToken}`,
              },
              body: JSON.stringify({
                data: [
                  {
                    event_name: input.eventName,
                    event_time: eventTime,
                    event_id: eventId,
                    action_source: input.actionSource,
                    user_data: userData,
                    ...(customData ? { custom_data: customData } : {}),
                  },
                ],
              }),
            });
            if (!response.ok) {
              const text = await response.text();
              console.warn(
                `[OutcomeDispatcher] CAPI rejected event ${eventId}: HTTP ${response.status} ${text}`,
              );
              return { ok: false };
            }
            return { ok: true };
          } catch (err) {
            console.error(`[OutcomeDispatcher] CAPI dispatch failed for ${eventId}:`, err);
            return { ok: false };
          }
        },
      };

      const outcomeDispatcher = new OutcomeDispatcher({
        capi: capiAdapter,
        store: contactReader,
      });

      // Adapter: ConversionBus (typed by ConversionStage) → LifecycleEventBus
      // (string lifecycle.* keys). Mapping: qualified→qualified, booked→booked,
      // purchased|completed→paid. ConversionStage has no `showed`, so the
      // showed lifecycle event has no upstream emitter today.
      const lifecycleBus: LifecycleEventBus = {
        subscribe(event, handler) {
          const STAGE_FOR_LIFECYCLE: Record<string, ConversionEvent["type"][]> = {
            "lifecycle.qualified": ["qualified"],
            "lifecycle.booked": ["booked"],
            "lifecycle.paid": ["purchased", "completed"],
            "lifecycle.showed": [],
          };
          const stages = STAGE_FOR_LIFECYCLE[event] ?? [];
          for (const stage of stages) {
            bus.subscribe(stage, async (ev: ConversionEvent) => {
              await handler({
                contactId: ev.contactId,
                value: ev.value,
                currency: ev.currency,
              });
            });
          }
        },
      };

      subscribeOutcomeDispatcher({ bus: lifecycleBus, dispatcher: outcomeDispatcher });
      logger.info("ConversionBus: OutcomeDispatcher wired for lifecycle.* outcomes");
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
