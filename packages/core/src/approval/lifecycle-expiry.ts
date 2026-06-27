import type { ApprovalLifecycleStore } from "./lifecycle-types.js";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";

export interface ExpirySweepResult {
  expired: number;
  failed: number;
  errors: Array<{ lifecycleId: string; error: string }>;
}

/**
 * Default per-sweep cap on how many expired pending lifecycles a single run ages
 * out, so a mass-expiry batch can never load the full pending table in one pass
 * (BUG-11 / SPINE-11). The next sweep drains the remainder oldest-expired first.
 */
export const DEFAULT_EXPIRY_SWEEP_LIMIT = 1000;

export async function sweepExpiredLifecycles(
  store: ApprovalLifecycleStore,
  service: ApprovalLifecycleService,
  now?: Date,
  limit: number = DEFAULT_EXPIRY_SWEEP_LIMIT,
): Promise<ExpirySweepResult> {
  const expiredLifecycles = await store.listExpiredPendingLifecycles(now, limit);

  let expired = 0;
  let failed = 0;
  const errors: ExpirySweepResult["errors"] = [];

  for (const lc of expiredLifecycles) {
    try {
      await service.expireLifecycle(lc.id);
      expired++;
    } catch (err) {
      failed++;
      errors.push({
        lifecycleId: lc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { expired, failed, errors };
}
