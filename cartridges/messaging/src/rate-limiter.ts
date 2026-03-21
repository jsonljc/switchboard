// ---------------------------------------------------------------------------
// WhatsApp Rate Limiter — queue-based throttling for outbound messages
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  messagesPerSecond?: number;
  dailyTemplateLimit?: number;
  queueWarningThreshold?: number;
  dispatch?: (item: QueueItem) => Promise<void>;
  onQueueWarning?: (depth: number) => void;
}

export interface QueueItem {
  contactId: string;
  message: string;
  isTemplate?: boolean;
}

export interface EnqueueResult {
  accepted: boolean;
  reason?: string;
}

export class WhatsAppRateLimiter {
  private queue: QueueItem[] = [];
  private messagesPerSecond: number;
  private dailyTemplateLimit: number;
  private templateCount = 0;
  private queueWarningThreshold: number;
  private dispatch: (item: QueueItem) => Promise<void>;
  private onQueueWarning?: (depth: number) => void;

  constructor(config: RateLimiterConfig = {}) {
    this.messagesPerSecond = config.messagesPerSecond ?? 80;
    this.dailyTemplateLimit = config.dailyTemplateLimit ?? 1000;
    this.queueWarningThreshold = config.queueWarningThreshold ?? 1000;
    this.dispatch = config.dispatch ?? (async () => {});
    this.onQueueWarning = config.onQueueWarning;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  async enqueue(item: QueueItem): Promise<EnqueueResult> {
    if (item.isTemplate) {
      if (this.templateCount >= this.dailyTemplateLimit) {
        return { accepted: false, reason: "daily_template_limit_exceeded" };
      }
      this.templateCount++;
    }

    this.queue.push(item);

    if (this.onQueueWarning && this.queue.length > this.queueWarningThreshold) {
      this.onQueueWarning(this.queue.length);
    }

    return { accepted: true };
  }

  async drain(): Promise<void> {
    const batchSize = this.messagesPerSecond;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, batchSize);
      await Promise.all(batch.map((item) => this.dispatch(item)));
    }
  }

  resetTemplateCount(): void {
    this.templateCount = 0;
  }
}
