export interface ContactMutexConfig {
  timeoutMs?: number;
}

export class ContactMutex {
  private locks = new Map<
    string,
    { queue: Array<() => void>; timer?: ReturnType<typeof setTimeout> }
  >();
  private timeoutMs: number;

  constructor(config: ContactMutexConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async acquire(orgId: string, contactId: string): Promise<() => void> {
    const key = `${orgId}:${contactId}`;
    const existing = this.locks.get(key);

    if (!existing) {
      const entry = {
        queue: [] as Array<() => void>,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      this.locks.set(key, entry);
      return this.createRelease(key);
    }

    return new Promise<() => void>((resolve) => {
      existing.queue.push(() => resolve(this.createRelease(key)));
    });
  }

  private createRelease(key: string): () => void {
    const timer = setTimeout(() => this.release(key), this.timeoutMs);
    const entry = this.locks.get(key);
    if (entry) entry.timer = timer;

    return () => {
      clearTimeout(timer);
      this.release(key);
    };
  }

  private release(key: string): void {
    const entry = this.locks.get(key);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);

    const next = entry.queue.shift();
    if (next) {
      next();
    } else {
      this.locks.delete(key);
    }
  }
}

export interface LoopDetectorConfig {
  windowMs?: number;
  maxRepeats?: number;
}

interface LoopEntry {
  count: number;
  firstSeen: number;
}

export class LoopDetector {
  private entries = new Map<string, LoopEntry>();
  private windowMs: number;
  private maxRepeats: number;

  constructor(config: LoopDetectorConfig = {}) {
    this.windowMs = config.windowMs ?? 5000;
    this.maxRepeats = config.maxRepeats ?? 3;
  }

  isLoop(orgId: string, contactId: string, eventType: string, contentHash: string): boolean {
    const key = `${orgId}:${contactId}:${eventType}:${contentHash}`;
    const now = Date.now();
    const existing = this.entries.get(key);

    if (!existing || now - existing.firstSeen > this.windowMs) {
      this.entries.set(key, { count: 1, firstSeen: now });
      return false;
    }

    existing.count++;
    return existing.count >= this.maxRepeats;
  }

  static contentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(36);
  }
}
