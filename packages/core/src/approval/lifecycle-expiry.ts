import type { ApprovalLifecycleStore } from "./lifecycle-types.js";
import type { ApprovalLifecycleService } from "./lifecycle-service.js";

export interface ExpirySweepResult {
  expired: number;
  failed: number;
  errors: Array<{ lifecycleId: string; error: string }>;
}

export async function sweepExpiredLifecycles(
  store: ApprovalLifecycleStore,
  service: ApprovalLifecycleService,
  now?: Date,
): Promise<ExpirySweepResult> {
  const expiredLifecycles = await store.listExpiredPendingLifecycles(now);

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
