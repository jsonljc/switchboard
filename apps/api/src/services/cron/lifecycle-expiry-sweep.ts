// apps/api/src/services/cron/lifecycle-expiry-sweep.ts
// ---------------------------------------------------------------------------
// Approval-lifecycle expiry sweep Inngest cron (BUG-11 / SPINE-11)
// ---------------------------------------------------------------------------
// Hourly sweep that ages `pending` ApprovalLifecycle rows past their expiresAt
// to `expired` through the lifecycle service. sweepExpiredLifecycles is bounded
// (DEFAULT_EXPIRY_SWEEP_LIMIT, oldest-expired first), so a mass-expiry batch
// never loads the full pending table in one pass; the next run drains the
// remainder. expireLifecycle is idempotent (a non-pending row is a no-op), so a
// step retry / Inngest replay can never double-act.
//
// Schedule: top of every hour (`0 * * * *`). Registered alongside the other
// crons in apps/api/src/bootstrap/inngest.ts using a PrismaLifecycleStore +
// ApprovalLifecycleService constructed there.
// ---------------------------------------------------------------------------

import {
  sweepExpiredLifecycles,
  makeOnFailureHandler,
  type AsyncFailureContext,
  type ApprovalLifecycleService,
  type ApprovalLifecycleStore,
} from "@switchboard/core";
import { inngestClient } from "@switchboard/creative-pipeline";

export interface LifecycleExpirySweepDeps {
  failure: AsyncFailureContext;
  store: ApprovalLifecycleStore;
  service: ApprovalLifecycleService;
  logger?: { warn: (msg: string) => void };
}

export function createLifecycleExpirySweepCron(deps: LifecycleExpirySweepDeps) {
  return inngestClient.createFunction(
    {
      id: "approval-lifecycle-expiry-sweep-hourly",
      name: "Approval Lifecycle Expiry Sweep",
      retries: 2,
      triggers: [{ cron: "0 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "approval-lifecycle-expiry-sweep-hourly",
          riskCategory: "low",
          alert: false,
          emitEvent: false,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => {
      const result = await step.run("sweep-expired-lifecycles", () =>
        sweepExpiredLifecycles(deps.store, deps.service, new Date()),
      );
      if (result.failed > 0) {
        deps.logger?.warn(
          `[lifecycle-expiry-sweep] ${result.failed} lifecycle(s) failed to expire (expired=${result.expired})`,
        );
      }
      return result;
    },
  );
}
