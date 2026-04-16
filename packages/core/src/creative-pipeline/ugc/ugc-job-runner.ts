// packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts
import { inngestClient } from "../inngest-client.js";
import { shouldRequireApproval, UGC_PHASE_ORDER } from "./approval-config.js";
import type { UgcPhase } from "./approval-config.js";
import type {
  CreativeJob,
  CreatorIdentity,
  FunnelFriction,
  ProviderCapabilityProfile,
} from "@switchboard/schemas";
import { executePlanningPhase } from "./phases/planning.js";
import { translateFrictions } from "./funnel-friction-translator.js";

// ── Interfaces ──

interface UgcJobEventData {
  jobId: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
}

interface UgcStepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string; match: string; if?: string },
  ) => Promise<{ data: { action: string; phase?: string } } | null>;
  sendEvent: (id: string, event: { name: string; data: Record<string, unknown> }) => Promise<void>;
}

interface UgcJobStore {
  findById(id: string): Promise<CreativeJob | null>;
  updateUgcPhase(id: string, phase: string, outputs: Record<string, unknown>): Promise<CreativeJob>;
  stopUgc(id: string, phase: string): Promise<CreativeJob>;
  failUgc(id: string, phase: string, error: Record<string, unknown>): Promise<CreativeJob>;
}

interface CreatorStore {
  findByDeployment(deploymentId: string): Promise<unknown[]>;
}

interface DeploymentStore {
  findById(id: string): Promise<{ listing?: { trustScore?: number }; type?: string } | null>;
}

interface UgcPipelineDeps {
  jobStore: UgcJobStore;
  creatorStore: CreatorStore;
  deploymentStore: DeploymentStore;
  llmConfig?: { apiKey: string };
  klingClient?: unknown;
  assetStore?: unknown;
}

interface UgcPipelineContext {
  creatorPool: unknown[];
  trustLevel: number;
  deploymentType: string;
  funnelFrictions: unknown[];
  providerCapabilities: unknown[];
  creativeWeights: unknown;
  apiKey: string;
  klingClient: unknown;
  assetStore: unknown;
}

// ── Phase execution (no-op stubs for SP2) ──
// SP3-SP5 replace these with real implementations.
// SP3+ must also add try/catch with error classification per spec Section 5.10.

interface UgcBriefInput {
  productDescription?: string;
  targetAudience?: string;
  platforms?: string[];
  creatorPoolIds?: string[];
  ugcFormat?: string;
  productImages?: string[];
  references?: string[];
  generateReferenceImages?: boolean;
  brandVoice?: string | null;
}

async function executePhase(
  phase: UgcPhase,
  ctx: {
    job: CreativeJob;
    context: UgcPipelineContext;
    previousPhaseOutputs: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  switch (phase) {
    case "planning": {
      const ugcConfig = (ctx.job.ugcConfig ?? {}) as Record<string, unknown>;
      const brief = (ugcConfig.brief ?? {}) as UgcBriefInput;
      const result = executePlanningPhase({
        brief: {
          productDescription: brief.productDescription ?? "",
          targetAudience: brief.targetAudience ?? "",
          platforms: brief.platforms ?? [],
          creatorPoolIds: brief.creatorPoolIds ?? [],
          ugcFormat: brief.ugcFormat ?? "talking_head",
          productImages: brief.productImages ?? [],
          references: brief.references ?? [],
          generateReferenceImages: brief.generateReferenceImages ?? false,
        },
        creatorPool: ctx.context.creatorPool as CreatorIdentity[],
        funnelFrictions: ctx.context.funnelFrictions as FunnelFriction[],
        performanceMemory: { structureHistory: {}, creatorHistory: {} },
        providerCapabilities: ctx.context.providerCapabilities as ProviderCapabilityProfile[],
      });
      return result as unknown as Record<string, unknown>;
    }
    case "scripting": {
      const planningOutput = ctx.previousPhaseOutputs.planning as Record<string, unknown>;
      const ugcConfig = (ctx.job.ugcConfig ?? {}) as Record<string, unknown>;
      const brief = (ugcConfig.brief ?? {}) as UgcBriefInput;
      const { executeScriptingPhase } = await import("./phases/scripting.js");
      type StructureSelection = import("./structure-engine.js").StructureSelection;
      type CastingAssignment = import("./scene-caster.js").CastingAssignment;
      type IdentityPlan = import("@switchboard/schemas").IdentityPlan;
      const result = await executeScriptingPhase({
        planningOutput: {
          structures: (planningOutput.structures ?? []) as StructureSelection[],
          castingAssignments: (planningOutput.castingAssignments ?? []) as CastingAssignment[],
          identityPlans: (planningOutput.identityPlans ?? []) as IdentityPlan[],
        },
        brief: {
          productDescription: brief.productDescription ?? "",
          targetAudience: brief.targetAudience ?? "",
          platforms: brief.platforms ?? [],
          creatorPoolIds: brief.creatorPoolIds ?? [],
          ugcFormat: brief.ugcFormat ?? "talking_head",
          brandVoice: brief.brandVoice ?? null,
        },
        creatorPool: ctx.context.creatorPool as CreatorIdentity[],
        creativeWeights: (ctx.context.creativeWeights as {
          structurePriorities: Record<string, number>;
          motivatorPriorities: Record<string, number>;
          scriptConstraints: string[];
          hookDirectives: string[];
        }) ?? {
          structurePriorities: {},
          motivatorPriorities: {},
          scriptConstraints: [],
          hookDirectives: [],
        },
        apiKey: ctx.context.apiKey,
      });
      return result as unknown as Record<string, unknown>;
    }
    case "production": {
      const scriptingOutput = ctx.previousPhaseOutputs.scripting as Record<string, unknown>;
      const specs = (scriptingOutput.specs ?? []) as Array<Record<string, unknown>>;
      const specsWithJobId = specs.map((s: Record<string, unknown>) => ({
        ...s,
        jobId: ctx.job.id,
      }));
      const ugcConfig = (ctx.job.ugcConfig ?? {}) as Record<string, unknown>;
      const budgetConfig = (ugcConfig.budget as Record<string, unknown>) ?? {};
      const { executeProductionPhase } = await import("./phases/production.js");
      type ProductionInput = import("./phases/production.js").ProductionInput;
      const productionInput: ProductionInput = {
        specs: specsWithJobId as unknown as ProductionInput["specs"],
        providerRegistry: ctx.context.providerCapabilities as ProviderCapabilityProfile[],
        retryConfig: { maxAttempts: 3, maxProviderFallbacks: 2 },
        budget: {
          totalJobBudget: (budgetConfig.totalJobBudget as number) ?? 50,
          costAuthority: "estimated",
        },
        deps: {
          providerClients: { klingClient: ctx.context.klingClient },
          assetStore: ctx.context.assetStore as ProductionInput["deps"]["assetStore"],
          apiKey: ctx.context.apiKey,
        },
      };
      return (await executeProductionPhase(productionInput)) as unknown as Record<string, unknown>;
    }
    default:
      // SP5+ replace remaining phases
      return { phase, status: "no-op", completedAt: new Date().toISOString() };
  }
}

function getNextPhase(phase: UgcPhase): string {
  const idx = UGC_PHASE_ORDER.indexOf(phase);
  if (idx === UGC_PHASE_ORDER.length - 1) return "complete";
  return UGC_PHASE_ORDER[idx + 1] as string;
}

// ── Preload context ──

async function preloadContext(
  job: CreativeJob,
  deps: UgcPipelineDeps,
): Promise<UgcPipelineContext> {
  const [creatorPool, deployment] = await Promise.all([
    deps.creatorStore.findByDeployment(job.deploymentId),
    deps.deploymentStore.findById(job.deploymentId),
  ]);

  return {
    creatorPool,
    trustLevel: deployment?.listing?.trustScore ?? 0,
    deploymentType: deployment?.type ?? "standard",
    funnelFrictions: [], // SP8 adds real friction store
    providerCapabilities: [], // SP5 adds real provider registry
    creativeWeights: translateFrictions([] as FunnelFriction[]),
    apiKey: deps.llmConfig?.apiKey ?? "",
    klingClient: deps.klingClient,
    assetStore: deps.assetStore,
  };
}

// ── Core pipeline logic ──

const APPROVAL_TIMEOUT = "24h";

export async function executeUgcPipeline(
  eventData: UgcJobEventData,
  step: UgcStepTools,
  deps: UgcPipelineDeps,
): Promise<void> {
  const job = await step.run("load-job", () => deps.jobStore.findById(eventData.jobId));
  if (!job) throw new Error(`UGC job not found: ${eventData.jobId}`);

  const context = await step.run("preload-context", () => preloadContext(job, deps));

  let phaseOutputs: Record<string, unknown> = (job.ugcPhaseOutputs ?? {}) as Record<
    string,
    unknown
  >;

  // Resume from last completed phase
  const startPhase = (job.ugcPhase as UgcPhase) ?? "planning";
  const startIdx = UGC_PHASE_ORDER.indexOf(startPhase);

  for (let i = startIdx; i < UGC_PHASE_ORDER.length; i++) {
    const phase = UGC_PHASE_ORDER[i];
    const startedAt = Date.now();

    // Execute phase with error classification
    let output: Record<string, unknown>;
    try {
      output = await step.run(`phase-${phase}`, () =>
        executePhase(phase as UgcPhase, { job, context, previousPhaseOutputs: phaseOutputs }),
      );
    } catch (err) {
      // Terminal error — persist failure and emit event
      const phaseError = {
        kind: "terminal",
        phase,
        code: "PHASE_EXECUTION_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
      await step.run(`fail-${phase}`, () =>
        deps.jobStore.failUgc(job.id, phase as string, phaseError),
      );
      await step.sendEvent("emit-failure", {
        name: "creative-pipeline/ugc.failed",
        data: { jobId: job.id, phase: phase as string, error: phaseError },
      });
      return;
    }

    const durationMs = Date.now() - startedAt;

    // Persist
    const phaseKey: string = phase as string;
    phaseOutputs = { ...phaseOutputs, [phaseKey]: output };
    const nextPhase = getNextPhase(phase as UgcPhase);

    await step.run(`save-${phase}`, () =>
      deps.jobStore.updateUgcPhase(job.id, nextPhase, phaseOutputs),
    );

    // Emit phase completion event
    await step.sendEvent(`emit-${phase}-complete`, {
      name: "creative-pipeline/ugc-phase.completed",
      data: {
        jobId: job.id,
        phase,
        durationMs,
        substagesCompleted: [],
        resultSummary: {},
      },
    });

    // Approval gate
    if (
      shouldRequireApproval({
        phase: phase as UgcPhase,
        trustLevel: context.trustLevel,
        deploymentType: context.deploymentType,
      })
    ) {
      const approval = await step.waitForEvent(`wait-approval-${phase}`, {
        event: "creative-pipeline/ugc-phase.approved",
        timeout: APPROVAL_TIMEOUT,
        match: "data.jobId",
        if: `async.data.phase == '${phase}'`,
      });

      if (!approval || approval.data.action === "stop") {
        await step.run(`stop-at-${phase}`, () => deps.jobStore.stopUgc(job.id, phase as string));

        await step.sendEvent("emit-stopped", {
          name: "creative-pipeline/ugc.stopped",
          data: { jobId: job.id, stoppedAtPhase: phase as string },
        });
        return;
      }
    }

    if (nextPhase === "complete") break;
  }

  // Read production results for completion event
  const productionOutput = phaseOutputs.production as Record<string, unknown> | undefined;
  const assets = (productionOutput?.assets as unknown[]) ?? [];
  const failedSpecsList = (productionOutput?.failedSpecs as unknown[]) ?? [];

  await step.sendEvent("emit-completed", {
    name: "creative-pipeline/ugc.completed",
    data: {
      jobId: job.id,
      assetsProduced: assets.length,
      failed: failedSpecsList.length,
    },
  });
}

// ── Inngest function definition ──

export function createUgcJobRunner(deps: UgcPipelineDeps) {
  return inngestClient.createFunction(
    {
      id: "ugc-job-runner",
      name: "UGC Pipeline Job Runner",
      retries: 3,
      triggers: [{ event: "creative-pipeline/ugc.submitted" }],
    },
    async ({ event, step }: { event: { data: UgcJobEventData }; step: UgcStepTools }) => {
      await executeUgcPipeline(event.data, step, deps);
    },
  );
}
