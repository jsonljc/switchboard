export interface OrgConcurrencyLimiterConfig {
  maxConcurrent?: number;
  queueTimeoutMs?: number;
}

interface OrgState {
  active: number;
  queue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

export class OrgConcurrencyLimiter {
  private orgs = new Map<string, OrgState>();
  private maxConcurrent: number;
  private queueTimeoutMs: number;

  constructor(config: OrgConcurrencyLimiterConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? 5;
    this.queueTimeoutMs = config.queueTimeoutMs ?? 30_000;
  }

  async acquire(orgId: string): Promise<() => void> {
    let state = this.orgs.get(orgId);
    if (!state) {
      state = { active: 0, queue: [] };
      this.orgs.set(orgId, state);
    }

    if (state.active < this.maxConcurrent) {
      state.active++;
      return () => this.release(orgId);
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = state!.queue.findIndex((q) => q.resolve === resolve);
        if (idx !== -1) state!.queue.splice(idx, 1);
        reject(new Error("queue timeout"));
      }, this.queueTimeoutMs);

      state!.queue.push({ resolve, reject, timer });
    });
  }

  private release(orgId: string): void {
    const state = this.orgs.get(orgId);
    if (!state) return;

    const next = state.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(() => this.release(orgId));
    } else {
      state.active--;
      if (state.active === 0) {
        this.orgs.delete(orgId);
      }
    }
  }
}
