// apps/api/src/services/cron/lifecycle-stalled-sweep.ts
// ---------------------------------------------------------------------------
// Phase 3a lifecycle.stalled-sweep Inngest cron
// ---------------------------------------------------------------------------
// Hourly sweep that transitions `active` ConversationLifecycleSnapshot rows to
// `stalled` when ≥24h have passed since the last Alex outbound and no inbound
// has arrived since. The cron is inert until the per-org governance config
// flag flips lifecycleTagging.mechanical to "on" — `readMode` returning "off"
// short-circuits inside runStalledSweep().
//
// Schedule: top of every hour (`0 * * * *`). The cron walks at most 1000
// active snapshots per run, scoped to those updated within the
// CRON_LOOKBACK_HOURS window (7 days) — bounds the candidate set so the cron
// doesn't fan-out unbounded on long-lived deployments.
// ---------------------------------------------------------------------------

import {
  CRON_LOOKBACK_HOURS,
  runStalledSweep,
  type LifecycleWriter,
  type MessageHistoryReader,
} from "@switchboard/core";
import { inngestClient } from "@switchboard/creative-pipeline";
import type { PrismaClient } from "@switchboard/db";

export interface LifecycleStalledSweepDeps {
  prisma: PrismaClient;
  writer: LifecycleWriter;
  history: MessageHistoryReader;
  readMode: (orgId: string) => Promise<"on" | "off">;
}

export function createLifecycleStalledSweepCron(deps: LifecycleStalledSweepDeps) {
  return inngestClient.createFunction(
    {
      id: "lifecycle-stalled-sweep-hourly",
      name: "Lifecycle Stalled Sweep",
      retries: 2,
      triggers: [{ cron: "0 * * * *" }],
    },
    async ({ step }) => {
      const now = new Date();
      const lookbackMs = CRON_LOOKBACK_HOURS * 60 * 60 * 1000;
      const lookbackCutoff = new Date(now.getTime() - lookbackMs);
      // Only consider snapshots whose lastEvaluatedAt is older than one hour
      // — anything more recent has either just been touched or is irrelevant
      // for stalled detection.
      const evaluatedBefore = new Date(now.getTime() - 60 * 60 * 1000);

      const rows = await step.run("fetch-active-snapshots", async () => {
        return deps.prisma.conversationLifecycleSnapshot.findMany({
          where: {
            currentState: "active",
            lastEvaluatedAt: { lt: evaluatedBefore },
            updatedAt: { gte: lookbackCutoff },
          },
          select: {
            conversationThreadId: true,
            organizationId: true,
            contactId: true,
            currentState: true,
          },
          take: 1000,
        });
      });

      await step.run("run-sweep", async () => {
        await runStalledSweep({
          writer: deps.writer,
          listNonTerminalSnapshots: async () =>
            rows.map((r) => ({
              conversationThreadId: r.conversationThreadId,
              organizationId: r.organizationId,
              contactId: r.contactId,
              currentState: r.currentState,
            })),
          history: deps.history,
          readMode: deps.readMode,
          now,
        });
      });

      return { candidates: rows.length };
    },
  );
}
