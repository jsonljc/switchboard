// ---------------------------------------------------------------------------
// SLA Monitor — tracks handoff SLA breaches
// ---------------------------------------------------------------------------

import type { HandoffStore, HandoffPackage } from "./types.js";

export interface SlaMonitorConfig {
  handoffStore: HandoffStore;
  onBreach: (pkg: HandoffPackage) => Promise<void>;
  checkIntervalMs?: number;
}

export class SlaMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: SlaMonitorConfig;

  constructor(config: SlaMonitorConfig) {
    this.config = config;
  }

  start(): void {
    const intervalMs = this.config.checkIntervalMs ?? 60_000;
    this.timer = setInterval(() => {
      this.checkBreaches().catch((err) => console.error("[SlaMonitor] Check error:", err));
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkBreaches(): Promise<HandoffPackage[]> {
    // This is designed to be called by a BullMQ worker in production.
    // The in-process timer is a fallback for non-Redis deployments.
    const breached: HandoffPackage[] = [];

    // We'd need to scan all orgs in production; for now this is
    // called per-org from the job runner.
    return breached;
  }

  async checkOrgBreaches(organizationId: string): Promise<void> {
    const pending = await this.config.handoffStore.listPending(organizationId);
    const now = Date.now();

    for (const pkg of pending) {
      if (pkg.slaDeadlineAt.getTime() <= now) {
        await this.config.onBreach(pkg);
      }
    }
  }
}
