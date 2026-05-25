import { Inngest } from "inngest";
import {
  makeOnFailureHandler,
  runRileyOutcomeAttribution,
  type AsyncFailureContext,
  type AttributableRecommendationStore,
  type MetaInsightsProvider,
  type RecommendationOutcomeStore,
  type RileyOutcomeRunSummary,
} from "@switchboard/core";

// Local Inngest client. All function registrations in apps/api share the same
// switchboard id — they fan out to the single serve handler in bootstrap/inngest.ts.
const inngestClient = new Inngest({ id: "switchboard" });

export interface RileyOutcomeAttributionWorkerDeps {
  failure: AsyncFailureContext;
  runRileyOutcomeAttribution: (args: {
    orgId: string;
    now: Date;
  }) => Promise<RileyOutcomeRunSummary>;
  readEnabledFlag: () => boolean;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface WorkerStepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

/**
 * Pure handler extracted from the Inngest wrapper so it can be unit-tested
 * without an Inngest client. Called by createRileyOutcomeAttributionWorker.
 */
export async function executeRileyOutcomeAttributionWorker(
  deps: RileyOutcomeAttributionWorkerDeps,
  event: { data: unknown; name: string },
): Promise<RileyOutcomeRunSummary | { skipped: "disabled" }> {
  const orgId = (event.data as { orgId?: string } | undefined)?.orgId;
  if (!orgId) {
    deps.logger.error({ msg: "riley-outcome-attribution: missing orgId in event payload" });
    throw new Error("missing orgId");
  }
  if (!deps.readEnabledFlag()) {
    deps.logger.info({ msg: "riley-outcome-attribution", skipped: "disabled", orgId });
    return { skipped: "disabled" as const };
  }
  const summary = await deps.runRileyOutcomeAttribution({ orgId, now: new Date() });
  deps.logger.info({ msg: "riley-outcome-attribution-summary", ...summary });
  return summary;
}

/**
 * Inngest per-org worker that runs the Riley outcome attribution orchestrator
 * for a single org. Triggered by "riley.outcome.attribute" events emitted by
 * the dispatch cron (createRileyOutcomeAttributionDispatch).
 *
 * Kill-switch: if readEnabledFlag() returns false the function short-circuits
 * immediately — no Meta calls, no DB writes.
 */
export function createRileyOutcomeAttributionWorker(deps: RileyOutcomeAttributionWorkerDeps) {
  return inngestClient.createFunction(
    {
      id: "riley-outcome-attribution-worker",
      retries: 2,
      triggers: [{ event: "riley.outcome.attribute" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "riley-outcome-attribution-worker",
          eventDomain: "riley.outcome-attribution",
          riskCategory: "medium",
          alert: false,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ event }) => executeRileyOutcomeAttributionWorker(deps, event),
  );
}

export interface BindRileyOutcomeOrchestratorDeps {
  recommendationStore: AttributableRecommendationStore;
  /** Factory invoked once per worker call (per orgId) to build a credentials-aware provider. */
  createInsightsProvider: (orgId: string) => MetaInsightsProvider;
  outcomeStore: RecommendationOutcomeStore;
}

/**
 * Wire helper: given the concrete stores + insights-provider factory, returns a
 * closure that apps/api can hand to createRileyOutcomeAttributionWorker as
 * runRileyOutcomeAttribution.
 *
 * The factory pattern is required because MetaInsightsProvider.getWindowMetrics
 * does not carry org context in its query — credentials must be embedded at
 * construction time. The factory is called once per orgId per worker invocation.
 */
export function bindRileyOutcomeOrchestrator(deps: BindRileyOutcomeOrchestratorDeps) {
  return (args: { orgId: string; now: Date }) =>
    runRileyOutcomeAttribution({
      recommendationStore: deps.recommendationStore,
      insightsProvider: deps.createInsightsProvider(args.orgId),
      outcomeStore: deps.outcomeStore,
      orgId: args.orgId,
      now: args.now,
    });
}
