// packages/creative-pipeline/src/creative-job-runner.ts
import { inngestClient } from "./inngest-client.js";
import { runStage, getNextStage, STAGE_ORDER } from "./stages/run-stage.js";
import { CreativePerformanceHistorySchema } from "@switchboard/schemas";
import type { CreativeJob, VideoProducerOutput } from "@switchboard/schemas";
import { DalleImageGenerator } from "./stages/image-generator.js";
import type { ImageGenerator } from "./stages/image-generator.js";
import type { AssetStorageClient, KlingLike } from "./stages/video-producer.js";
import type { CreativeMemoryProvider } from "./creative-memory.js";

// 24-hour timeout for buyer approval between stages
const APPROVAL_TIMEOUT = "24h";

interface LLMConfig {
  apiKey: string;
  /** Optional Claude model override; threaded to every stage. Absent = call-claude DEFAULT_MODEL. */
  model?: string;
}

interface ImageConfig {
  openaiApiKey?: string;
}

interface JobStore {
  findById(id: string): Promise<CreativeJob | null>;
  updateStage(
    organizationId: string,
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
  ): Promise<CreativeJob>;
  stop(organizationId: string, id: string, stoppedAt: string): Promise<CreativeJob>;
  setDurableAsset(organizationId: string, id: string, url: string): Promise<CreativeJob>;
  /**
   * F13: write the stage flip (to "complete") AND the durable asset URL in ONE
   * row update. The production tail previously issued two un-atomic step.run
   * writes (save-${stage} flipping to "complete", then save-durable-asset), so a
   * crash between them left a job marked complete with no durable asset. This
   * combined write removes that window entirely.
   */
  completeWithAsset(
    organizationId: string,
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
    durableAssetUrl: string,
  ): Promise<CreativeJob>;
}

interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string; match: string },
  ) => Promise<{ data: { action: string } } | null>;
}

interface JobEventData {
  jobId: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
}

/**
 * Terminal AgentTask statuses the runner can hand its spawned task. The full
 * AgentTaskStatus enum lives in @switchboard/schemas, but the runner only ever
 * reaches these two terminal values, so a narrow union keeps this Layer-2 module
 * decoupled from the marketplace types and makes the call sites self-documenting.
 */
type TerminalTaskStatus = "completed" | "cancelled";

/**
 * Best-effort updater for the AgentTask the creative-job-submit workflow spawned.
 * The actual store write lives in @switchboard/db (Layer 4); creative-pipeline is
 * Layer 2 and must not import it, so the apps/api bootstrap injects this closure
 * (wired to PrismaAgentTaskStore.updateStatus). Optional so existing positional
 * call sites (and tests) that do not care about the task lifecycle stay valid.
 */
type TaskStatusUpdater = (
  organizationId: string,
  taskId: string,
  status: TerminalTaskStatus,
) => Promise<void>;

/**
 * Terminal-lifecycle check for replay / duplicate-delivery safety (D5-F2).
 * Mirrors the canonical terminal set in @switchboard/core's status-mapper
 * (mapCreativeJobToMiraStatus: draft_ready / stopped / failed => canContinue
 * false) but stays schemas-only; creative-pipeline is Layer 2 and must not
 * import core. The status-mapper's derived "failed" rule
 * (productionErrorsWithoutVideo) is subsumed by the "complete" check: production
 * is the last stage, so a job that trips it already advanced currentStage to
 * "complete". The stage loop always restarts at STAGE_ORDER[0], so a fresh
 * duplicate invocation against a terminal job would otherwise re-run the trends
 * stage (LLM spend) and overwrite currentStage.
 */
function isPolishedJobTerminal(job: CreativeJob): boolean {
  return job.currentStage === "complete" || job.stoppedAt != null || job.stageFailure != null;
}

/**
 * Core pipeline logic extracted for testability.
 * Called by the Inngest function handler with real step tools,
 * or by tests with mocked step tools.
 */
export async function executeCreativePipeline(
  eventData: JobEventData,
  step: StepTools,
  jobStore: JobStore,
  llmConfig: LLMConfig,
  imageConfig?: ImageConfig,
  assetStorage?: AssetStorageClient,
  creativeMemoryProvider?: CreativeMemoryProvider,
  klingClient?: KlingLike,
  updateTaskStatus?: TaskStatusUpdater,
): Promise<void> {
  // Transition the spawned AgentTask to a terminal status so it stops lingering
  // as "pending" (polluting the open-task work-log + metrics). Best-effort: a
  // task-store hiccup must never throw out of the runner (an Inngest retry would
  // re-run every paid stage), and the status flip is wrapped in its own named
  // step so the write is memoized + not re-issued on replay. Routed through the
  // injected updater because the AgentTask store is Layer 4 (apps/api wires it).
  const settleTask = async (status: TerminalTaskStatus): Promise<void> => {
    if (!updateTaskStatus) return;
    try {
      await step.run(`task-status-${status}`, () =>
        updateTaskStatus(eventData.organizationId, eventData.taskId, status),
      );
    } catch (err) {
      console.warn(
        `[creative-job-runner] failed to mark AgentTask ${eventData.taskId} ${status} ` +
          `for job ${eventData.jobId}: ${String(err)}`,
      );
    }
  };

  const job = await step.run("load-job", () => jobStore.findById(eventData.jobId));

  if (!job) {
    throw new Error(`Creative job not found: ${eventData.jobId}`);
  }

  // D5-F2: a re-delivered or operator-replayed polished.submitted against a
  // terminal (complete / stopped / failed) job must be a clean no-op: no
  // lifecycle mutation, no paid stage re-run, no approval park, no throw. The
  // stage loop below restarts at STAGE_ORDER[0] on every fresh invocation, so
  // without this guard a duplicate event re-runs the trends stage (LLM spend)
  // and overwrites currentStage "complete" => "hooks", parking at the trends
  // gate (canContinue) one operator Continue away from a full paid re-run.
  if (isPolishedJobTerminal(job)) {
    console.warn(
      `[creative-job-runner] skipping terminal job ${job.id} ` +
        `(currentStage=${String(job.currentStage)}, stopped=${job.stoppedAt != null}, ` +
        `failed=${job.stageFailure != null}); replayed/duplicate polished.submitted is a no-op`,
    );
    return;
  }

  // Create image generator if configured and job requests it
  let imageGenerator: ImageGenerator | undefined;
  if (imageConfig?.openaiApiKey && job.generateReferenceImages) {
    imageGenerator = new DalleImageGenerator(imageConfig.openaiApiKey);
  }

  // Slice-2 feed-back (spec 3.8). Measured channel: a performance_history row
  // (written by submit enrichment) parses and threads into the stage brief; a
  // measured_performance row or legacy payload fails the parse and feeds
  // nothing (parse-don't-cast). Taste channel: resolved once per pipeline via
  // the injected provider; a memory read must never fail a render, so errors
  // degrade to no block.
  const historyParse = CreativePerformanceHistorySchema.safeParse(job.pastPerformance);
  const pastPerformance = historyParse.success ? historyParse.data : undefined;
  let tasteContext: string[] | undefined;
  if (creativeMemoryProvider) {
    // The step returns [] (never undefined): step output is JSON-memoized for
    // replay and undefined does not round-trip. Normalized after the step.
    const lines = await step.run("load-taste-context", async () => {
      try {
        return await creativeMemoryProvider.getTasteContext(
          eventData.organizationId,
          eventData.deploymentId,
        );
      } catch (err) {
        console.warn(`creative taste context unavailable for job ${eventData.jobId}:`, err);
        return [];
      }
    });
    tasteContext = lines.length > 0 ? lines : undefined;
  }

  let stageOutputs: Record<string, unknown> = (job.stageOutputs ?? {}) as Record<string, unknown>;

  for (const stage of STAGE_ORDER) {
    // production is the only consumer of productionTier and the only stage gated
    // on the operator's tier choice. That choice is written by the storyboard-gate
    // decision (creative-job-decision-workflow) AFTER the load-job snapshot above
    // is captured, and Inngest memoizes load-job across replays, so reading
    // job.productionTier here always yields basic: the pro assembly path never
    // runs, durableAssetUrl is never set, and polished publish always fails its
    // CREATIVE_ASSET_NOT_DURABLE precondition. Re-read the persisted tier in a
    // fresh, distinctly-named step the first time we reach production (after the
    // storyboard-gate wait has resolved); the string result is JSON-memoized for
    // later replays. This heals new and not-yet-rendered runs, not a run whose
    // stage-production step already memoized a basic output.
    const productionTier =
      stage === "production"
        ? await step.run("load-production-tier", async () => {
            const current = await jobStore.findById(eventData.jobId);
            return current?.productionTier ?? "basic";
          })
        : undefined;

    // Run the stage
    const output = await step.run(`stage-${stage}`, () =>
      runStage(stage, {
        jobId: job.id,
        brief: {
          productDescription: job.productDescription,
          targetAudience: job.targetAudience,
          platforms: job.platforms,
          brandVoice: job.brandVoice,
          references: job.references,
          productImages: job.productImages,
          pastPerformance,
          tasteContext,
        },
        previousOutputs: stageOutputs,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        openaiApiKey: imageConfig?.openaiApiKey,
        generateReferenceImages: job.generateReferenceImages,
        imageGenerator,
        ...(productionTier ? { productionTier } : {}),
        assetStorage,
        klingClient,
      }),
    );

    // Persist output
    stageOutputs = { ...stageOutputs, [stage]: output };
    const nextStage = getNextStage(stage);

    // F13: production is the terminal stage, so save-${stage} flips currentStage
    // to "complete". When production also assembled a durable asset, the
    // completion flag and the durable URL MUST land in one row update; two
    // separate step.run writes (the old save-${stage} then save-durable-asset)
    // left a crash window where the job read "complete" with no durable asset,
    // an inconsistent state the publish precondition (assertPublishable) would
    // otherwise have to defend against. The combined write removes the window.
    // Non-production stages, and a production run that produced no durable asset,
    // keep the plain stage save (no durableAssetUrl column write to clobber).
    const productionDurableAssetUrl =
      stage === "production" ? (output as VideoProducerOutput).durableAssetUrl : undefined;

    if (productionDurableAssetUrl) {
      await step.run(`save-${stage}`, () =>
        jobStore.completeWithAsset(
          eventData.organizationId,
          job.id,
          nextStage,
          stageOutputs,
          productionDurableAssetUrl,
        ),
      );
    } else {
      await step.run(`save-${stage}`, () =>
        jobStore.updateStage(eventData.organizationId, job.id, nextStage, stageOutputs),
      );
    }

    // After the last stage, no approval needed
    if (nextStage === "complete") {
      // Terminal "complete" branch: the spawned AgentTask is done.
      await settleTask("completed");
      break;
    }

    // Wait for buyer approval before proceeding
    const approval = await step.waitForEvent(`wait-approval-${stage}`, {
      event: "creative-pipeline/stage.approved",
      timeout: APPROVAL_TIMEOUT,
      match: "data.jobId",
    });

    // Timeout or explicit stop → halt pipeline
    if (!approval || approval.data.action === "stop") {
      await step.run(`stop-at-${stage}`, () =>
        jobStore.stop(eventData.organizationId, job.id, stage),
      );
      // Terminal halt (explicit stop OR 24h approval timeout): the AgentTask did
      // not run to completion, so it is cancelled rather than completed.
      await settleTask("cancelled");
      return;
    }
  }
}

/**
 * Inngest function definition. Wired into the serve handler in apps/api.
 * The jobStore and llmConfig dependencies are injected at registration time.
 */
export function createCreativeJobRunner(
  jobStore: JobStore,
  llmConfig: LLMConfig,
  imageConfig?: ImageConfig,
  assetStorage?: AssetStorageClient,
  onFailure?: (arg: unknown) => Promise<void>,
  creativeMemoryProvider?: CreativeMemoryProvider,
  klingClient?: KlingLike,
  updateTaskStatus?: TaskStatusUpdater,
) {
  return inngestClient.createFunction(
    {
      id: "creative-job-runner",
      name: "Creative Pipeline Job Runner",
      retries: 3,
      triggers: [{ event: "creative-pipeline/polished.submitted" }],
      // D5-F2: dedupe a re-delivered/replayed polished.submitted (Inngest 24h
      // window; per-function-scoped) so even a mid-flight job is safe from a
      // concurrent duplicate run. Defense-in-depth behind the terminal entry
      // guard; concurrency was unfit (a run parked on waitForEvent releases its
      // slot, so a limit of 1 would not serialize across an approval wait).
      idempotency: "event.data.jobId",
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ event, step }: { event: { data: JobEventData }; step: StepTools }) => {
      await executeCreativePipeline(
        event.data,
        step,
        jobStore,
        llmConfig,
        imageConfig,
        assetStorage,
        creativeMemoryProvider,
        klingClient,
        updateTaskStatus,
      );
    },
  );
}
