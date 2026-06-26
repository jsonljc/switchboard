import type { ConversionEvent } from "./conversion-bus.js";

/**
 * The narrow surface the drainer needs from a Redis-backed conversion bus.
 * `RedisStreamConversionBus` satisfies this structurally; an in-memory bus does
 * not (and needs no drainer — it dispatches in-process on `emit`).
 */
export interface DrainableConversionBus {
  ensureConsumerGroup(groupName: string): Promise<void>;
  readGroup(
    groupName: string,
    consumerName: string,
    count: number,
    blockMs: number,
  ): Promise<Array<{ id: string; event: ConversionEvent }>>;
  ack(groupName: string, messageId: string): Promise<void>;
  dispatch(event: ConversionEvent): Promise<void>;
}

export interface ConversionStreamDrainerOptions {
  groupName?: string;
  consumerName?: string;
  count?: number;
  blockMs?: number;
}

const DEFAULT_GROUP_NAME = "switchboard-conversion-consumers";
const DEFAULT_COUNT = 16;
// XREADGROUP BLOCK window. The loop can only observe a shutdown signal between
// reads, so this also bounds worst-case `stop()` latency. Modest by design:
// short enough to shut down promptly, long enough to avoid busy-looping Redis.
const DEFAULT_BLOCK_MS = 2000;

/**
 * Background consumer for the Redis conversion stream.
 *
 * `RedisStreamConversionBus.emit` only XADDs to the stream (PRODUCE); without a
 * consumer the registered handlers (conversion record write, Meta CAPI delivery)
 * never run, so with `REDIS_URL` set those deliveries go dark. This drain loop is
 * that consumer: `ensureConsumerGroup` at start, then repeatedly `readGroup` →
 * `dispatch` each message to the registered handler(s) → `ack`.
 *
 * Delivery is AT-LEAST-ONCE: a message is acked only AFTER its dispatch resolves
 * successfully. If dispatch (or the ack) throws, the message is left in the
 * pending-entries list (PEL) — never silently dropped. Downstream dedups on
 * `event_id`, so redelivery is safe whereas at-most-once would risk losing a
 * conversion.
 *
 * NOTE: `readGroup` uses `>` (never-delivered entries only), so an unacked entry
 * is recovered on consumer restart / via XAUTOCLAIM rather than re-read by the
 * same live consumer. A future enhancement should add PEL recovery PLUS a
 * max-deliveries / dead-letter guard so a poison message can't redeliver forever.
 */
export class ConversionStreamDrainer {
  private readonly bus: DrainableConversionBus;
  private readonly groupName: string;
  private readonly consumerName: string;
  private readonly count: number;
  private readonly blockMs: number;

  private running = false;
  private loop: Promise<void> | null = null;

  constructor(bus: DrainableConversionBus, options: ConversionStreamDrainerOptions = {}) {
    this.bus = bus;
    this.groupName = options.groupName ?? DEFAULT_GROUP_NAME;
    this.consumerName = options.consumerName ?? `consumer-${process.pid}`;
    this.count = options.count ?? DEFAULT_COUNT;
    this.blockMs = options.blockMs ?? DEFAULT_BLOCK_MS;
  }

  /**
   * Ensure the consumer group exists, then launch the background drain loop.
   * Non-blocking: resolves once the group is ensured and the loop is scheduled.
   * Idempotent — a second call while already running is a no-op.
   */
  async start(): Promise<void> {
    if (this.running) return;
    // Set intent BEFORE the await so a stop() that interleaves during
    // ensureConsumerGroup is observed below and we never start an orphan loop
    // that stop() couldn't await.
    this.running = true;
    await this.bus.ensureConsumerGroup(this.groupName);
    if (!this.running) return; // stop() was called while ensuring the group
    this.loop = this.runLoop();
  }

  /** Signal shutdown and await the background loop to exit. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.loop) {
      await this.loop;
      this.loop = null;
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      let messages: Array<{ id: string; event: ConversionEvent }>;
      try {
        messages = await this.bus.readGroup(
          this.groupName,
          this.consumerName,
          this.count,
          this.blockMs,
        );
      } catch (err) {
        // Transient read failure (e.g. a Redis blip). Log and retry; the BLOCK
        // window on the next read provides natural backoff. Never throw out of
        // the loop — that would silently stop draining.
        console.error("[ConversionStreamDrainer] readGroup failed:", err);
        continue;
      }

      for (const { id, event } of messages) {
        if (!this.running) break;
        try {
          await this.bus.dispatch(event);
          await this.bus.ack(this.groupName, id);
        } catch (err) {
          // At-least-once: a handler (or the ack) failed. Do NOT ack — leave the
          // entry in the PEL for redelivery. Downstream dedups on event_id, so
          // re-delivery is safe; dropping would lose a conversion.
          console.error(
            `[ConversionStreamDrainer] dispatch failed for message ${id}; leaving unacked for redelivery:`,
            err,
          );
        }
      }
    }
  }
}
