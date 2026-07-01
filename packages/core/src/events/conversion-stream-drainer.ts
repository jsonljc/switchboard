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
  /** Backoff after a REJECTED readGroup (outage). Defaults to {@link DEFAULT_READ_ERROR_BACKOFF_MS}. */
  readErrorBackoffMs?: number;
}

const DEFAULT_GROUP_NAME = "switchboard-conversion-consumers";
const DEFAULT_COUNT = 16;
// XREADGROUP BLOCK window. The loop can only observe a shutdown signal between
// reads, so this also bounds worst-case `stop()` latency. Modest by design:
// short enough to shut down promptly, long enough to avoid busy-looping Redis.
const DEFAULT_BLOCK_MS = 2000;
// Backoff applied after a readGroup that REJECTS (Redis down / connection
// refused), as opposed to an empty success. BLOCK only paces the empty-success
// path; a rejected command returns immediately, so without this explicit pause
// the loop would hot-spin at 100% CPU and flood logs for the whole outage.
// Overridable via options for tests; 1s is a deliberately modest default.
const DEFAULT_READ_ERROR_BACKOFF_MS = 1000;

/**
 * Background consumer for the Redis conversion stream.
 *
 * `RedisStreamConversionBus.emit` only XADDs to the stream (PRODUCE); without a
 * consumer the registered handlers (conversion record write, Meta CAPI delivery)
 * never run, so with `REDIS_URL` set those deliveries go dark. This drain loop is
 * that consumer: `ensureConsumerGroup` at start, then repeatedly `readGroup` →
 * `dispatch` each message to the registered handler(s) → `ack`. The structural
 * fix this lands is closing that dark-delivery gap: the stream is now consumed.
 *
 * Delivery semantics, stated precisely (this is narrower than blanket
 * "at-least-once"): a message is acked only AFTER `dispatch` resolves, and is
 * left unacked in the pending-entries list (PEL) if `dispatch` (or the ack)
 * REJECTS. So ack-after-success yields at-least-once ONLY for handlers that
 * PROPAGATE their failure. Today's subscribers (conversion record write + Meta
 * CAPI, in conversion-bus-bootstrap.ts) SWALLOW their own errors and resolve, so
 * a per-message handler failure is still acked: parity with the prior in-memory
 * bus, NOT redelivery. The unacked branch exists for future propagating handlers.
 * Downstream dedups on `event_id`, so redelivery, when it does occur, is safe
 * rather than double-counting.
 *
 * Full at-least-once + poison handling is a documented FOLLOW-UP. `readGroup` uses
 * `>` (never-delivered entries only), so an unacked entry is NOT re-read by this
 * live consumer, and is NOT recovered on restart either: a restart gets a fresh
 * consumer name and `>` never re-reads a defunct consumer's PEL. Recovery needs an
 * explicit XAUTOCLAIM pass (deferred), PLUS a max-deliveries / dead-letter guard
 * so a poison message can't redeliver forever.
 */
export class ConversionStreamDrainer {
  private readonly bus: DrainableConversionBus;
  private readonly groupName: string;
  private readonly consumerName: string;
  private readonly count: number;
  private readonly blockMs: number;
  private readonly readErrorBackoffMs: number;

  private running = false;
  private loop: Promise<void> | null = null;

  constructor(bus: DrainableConversionBus, options: ConversionStreamDrainerOptions = {}) {
    this.bus = bus;
    this.groupName = options.groupName ?? DEFAULT_GROUP_NAME;
    this.consumerName = options.consumerName ?? `consumer-${process.pid}`;
    this.count = options.count ?? DEFAULT_COUNT;
    this.blockMs = options.blockMs ?? DEFAULT_BLOCK_MS;
    this.readErrorBackoffMs = options.readErrorBackoffMs ?? DEFAULT_READ_ERROR_BACKOFF_MS;
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
        // Read REJECTED (e.g. Redis down / connection refused), not an empty
        // success. XREADGROUP BLOCK does NOT apply to a rejected command (it
        // returns immediately), so the explicit backoff below, not BLOCK, is what
        // covers the reject/outage path (BLOCK still paces the empty-success
        // path). Without it the loop would spin at 100% CPU and flood logs for the
        // whole outage. Never throw out of the loop, which would silently stop
        // draining.
        console.error("[ConversionStreamDrainer] readGroup failed; backing off:", err);
        await new Promise((resolve) => setTimeout(resolve, this.readErrorBackoffMs));
        continue;
      }

      // Drain the WHOLE already-read batch before honoring stop(). readGroup uses
      // ">", so this batch is already CLAIMED into this consumer's PEL; breaking
      // out mid-batch on !running would orphan the unprocessed tail (a fresh
      // consumer-${pid} + deferred XAUTOCLAIM never re-reads it) = silent
      // conversion / CAPI loss. The outer `while (this.running)` still governs
      // whether we read the NEXT batch, so stop() latency stays bounded by BLOCK.
      for (const { id, event } of messages) {
        try {
          await this.bus.dispatch(event);
          await this.bus.ack(this.groupName, id);
        } catch (err) {
          // `dispatch` (or the ack) REJECTED. Do NOT ack; leave the entry in the
          // PEL. NOTE: today's record + CAPI subscribers swallow their own errors,
          // so this branch only fires for handlers that propagate; a PEL entry is
          // recovered via a deferred XAUTOCLAIM pass, NOT on restart (a restart
          // gets a fresh consumer name and `>` never re-reads a defunct consumer's
          // PEL). Downstream dedups on event_id, so redelivery is safe.
          console.error(
            `[ConversionStreamDrainer] dispatch failed for message ${id}; left unacked (PEL), recover via XAUTOCLAIM:`,
            err,
          );
        }
      }
    }
  }
}
