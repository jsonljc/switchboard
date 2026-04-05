// ---------------------------------------------------------------------------
// Scheduler Deps Factory — stubbed after domain code removal
// ---------------------------------------------------------------------------
// The BullMQ scheduler infrastructure was removed with domain-specific code.
// This stub preserves the interface so app.ts compiles without changes.
// ---------------------------------------------------------------------------

export interface SchedulerDeps {
  service: import("@switchboard/core").SchedulerService;
  triggerHandler: (job: { data: Record<string, unknown> }) => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Build scheduler deps — currently returns null as the BullMQ scheduler
 * infrastructure has been removed.
 */
export function buildSchedulerDeps(
  _prisma: unknown,
  _redisUrl: string,
  _workflowEngine: unknown,
): SchedulerDeps | null {
  return null;
}
