import { Inngest } from "inngest";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { PurgeExpiredInput, PurgeExpiredResult } from "@switchboard/db";

const inngestClient = new Inngest({ id: "switchboard" });

const DEFAULT_SOFT_RETENTION_DAYS = 30;
const DEFAULT_HARD_RETENTION_DAYS = 90;
const SOFT_STATUSES = ["resolved", "exhausted"];
const BATCH_SIZE = 1000;
const MAX_BATCHES = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface DlqRetentionPurgeDeps {
  failure: AsyncFailureContext;
  purge: (input: PurgeExpiredInput) => Promise<PurgeExpiredResult>;
  now?: () => Date;
  softRetentionDays: number;
  hardRetentionDays: number;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}

/**
 * Parse the two retention-window env vars. Non-numeric / absent / non-positive
 * values fall back to defaults (Number.isFinite + `> 0` guard — a NaN-blind
 * comparison would purge nothing or everything). The hard cap is floored to the
 * soft window so a misconfiguration can never make the absolute cap tighter than
 * the soft one (which would delete still-actionable rows early).
 */
export function resolveRetentionWindows(
  softEnv: string | undefined,
  hardEnv: string | undefined,
): { soft: number; hard: number } {
  const parse = (v: string | undefined, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const soft = parse(softEnv, DEFAULT_SOFT_RETENTION_DAYS);
  const hard = Math.max(parse(hardEnv, DEFAULT_HARD_RETENTION_DAYS), soft);
  return { soft, hard };
}

export async function executeDlqRetentionPurge(
  step: StepTools,
  deps: DlqRetentionPurgeDeps,
): Promise<PurgeExpiredResult> {
  const now = (deps.now ?? (() => new Date()))();
  const softCutoff = new Date(now.getTime() - deps.softRetentionDays * DAY_MS);
  const hardCutoff = new Date(now.getTime() - deps.hardRetentionDays * DAY_MS);

  const result = await step.run("purge-expired-dlq", () =>
    deps.purge({
      softCutoff,
      hardCutoff,
      softStatuses: SOFT_STATUSES,
      batchSize: BATCH_SIZE,
      maxBatches: MAX_BATCHES,
    }),
  );

  deps.logger.info(
    `[dlq-retention-purge] purged=${result.purged} batches=${result.batches} ` +
      `softDays=${deps.softRetentionDays} hardDays=${deps.hardRetentionDays}`,
  );
  if (result.truncated) {
    deps.logger.warn(
      `[dlq-retention-purge] maxBatches (${MAX_BATCHES}) hit with rows remaining; ` +
        `next run continues. purged=${result.purged}`,
    );
  }
  return result;
}

export function createDlqRetentionPurgeCron(deps: DlqRetentionPurgeDeps) {
  return inngestClient.createFunction(
    {
      id: "dlq-retention-purge",
      name: "Dead-Letter Queue Retention Purge",
      retries: 2,
      triggers: [{ cron: "0 4 * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "dlq-retention-purge",
          riskCategory: "low",
          alert: false,
          emitEvent: false,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => {
      return executeDlqRetentionPurge(step as unknown as StepTools, deps);
    },
  );
}
