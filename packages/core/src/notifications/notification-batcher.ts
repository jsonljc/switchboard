// ---------------------------------------------------------------------------
// Notification Batcher — accumulates T2 events, flushes on count or timer
// ---------------------------------------------------------------------------

import type { NotificationEvent } from "./notification-classifier.js";

export interface NotificationBatcherConfig {
  /** Called when a batch flushes. Receives deploymentId and accumulated events. */
  onFlush: (deploymentId: string, events: NotificationEvent[]) => void | Promise<void>;
  /** Flush interval in ms (default: 20 minutes). */
  flushIntervalMs?: number;
  /** Max events per deployment before flush (default: 3). */
  maxBatchSize?: number;
}

export class NotificationBatcher {
  private batches = new Map<string, NotificationEvent[]>();
  private onFlush: NotificationBatcherConfig["onFlush"];
  private maxBatchSize: number;
  private timer: ReturnType<typeof setInterval>;

  constructor(config: NotificationBatcherConfig) {
    this.onFlush = config.onFlush;
    this.maxBatchSize = config.maxBatchSize ?? 3;
    const intervalMs = config.flushIntervalMs ?? 20 * 60 * 1000;
    this.timer = setInterval(() => this.flushAll(), intervalMs);
  }

  add(event: NotificationEvent): void {
    const batch = this.batches.get(event.deploymentId) ?? [];
    batch.push(event);
    this.batches.set(event.deploymentId, batch);

    if (batch.length >= this.maxBatchSize) {
      this.flush(event.deploymentId);
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.batches.clear();
  }

  private flush(deploymentId: string): void {
    const batch = this.batches.get(deploymentId);
    if (!batch || batch.length === 0) return;

    this.batches.delete(deploymentId);
    this.onFlush(deploymentId, batch);
  }

  private flushAll(): void {
    for (const deploymentId of [...this.batches.keys()]) {
      this.flush(deploymentId);
    }
  }
}
