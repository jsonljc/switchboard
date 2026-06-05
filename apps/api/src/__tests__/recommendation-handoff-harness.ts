/**
 * Shared harness for the Riley cron -> Mira handoff loop tests (extracted from
 * recommendation-handoff-cron-full-loop.test.ts so the approval-loop suite can
 * reuse it). Mirrors the production submit mechanism end to end: REAL
 * executeWeeklyAudit -> REAL PlatformIngress.submit -> REAL GovernanceGate with
 * the SEEDED allow + require_approval policies -> REAL workflow handlers over
 * the REAL ExecutionModeRegistry. The only synthetic inputs are the Meta
 * insight / ads-client / CRM providers and the recommendation emitter.
 */
import { vi } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  WorkflowMode,
  toDeploymentContext,
  type GovernanceGateDeps,
  type IntentRegistration,
  type WorkflowHandler,
  type WorkflowHandlerResult,
  type ChildWorkRequest,
  type CanonicalSubmitRequest,
  type DeploymentContext,
  type SubmitWorkResponse,
  type WorkUnit,
} from "@switchboard/core/platform";
import type { WorkTrace, WorkTraceStore, WorkTraceReadResult } from "@switchboard/core/platform";
import { evaluate, resolveIdentity, type ApprovalLifecycleService } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import type {
  CampaignInsightSchema as CampaignInsight,
  AccountSummarySchema as AccountSummary,
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
} from "@switchboard/schemas";
import {
  RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE,
  buildRecommendationHandoffApprovalPolicyInput,
  PrismaMiraCreativeReadModelReader,
} from "@switchboard/db";
import type {
  CronDependencies,
  AdsClientInterface,
  RecommendationHandoffSubmitter,
} from "@switchboard/ad-optimizer";
import {
  buildRecommendationHandoffSubmitRequest,
  type RecommendationHandoffSubmitInput,
} from "../services/workflows/recommendation-handoff-request.js";
import { buildRecommendationHandoffWorkflow } from "../services/workflows/recommendation-handoff-workflow.js";
import {
  buildCreativeConceptDraftWorkflow,
  type CreativeConceptDraftDeps,
} from "../services/workflows/creative-concept-draft-workflow.js";
import { synthesizeCreativeBrief } from "../services/workflows/creative-brief-synthesis.js";

export const ORG = "org_dev";
export const RILEY_DEPLOYMENT_ID = "dep-riley";
export const CREATIVE_DEPLOYMENT_ID = "dep-creative";
export const CREATIVE_LISTING_ID = "list-creative";

// ── Gate + ingress harness ──────────────────────────────────────────────────

export function systemSpec(): IdentitySpec {
  return {
    id: "spec-system",
    principalId: "system",
    organizationId: ORG,
    name: "System",
    description: "Seeded system principal",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

export function allowPolicy(): Policy {
  return {
    id: "policy_allow_handoff",
    name: "Allow handoff",
    description: "allow",
    organizationId: ORG,
    cartridgeId: null,
    priority: 50,
    active: true,
    rule: RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

export function approvalPolicy(): Policy {
  return {
    ...buildRecommendationHandoffApprovalPolicyInput(ORG),
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

export function buildGate(policies: Policy[]): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

export function inMemoryTraceStore(): WorkTraceStore {
  const traces: WorkTrace[] = [];
  return {
    claim: async () => ({ claimed: true }),
    persist: async (t: WorkTrace) => {
      traces.push(t);
    },
    getByWorkUnitId: async (id: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.workUnitId === id);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
    update: async (id: string, fields: Partial<WorkTrace>) => {
      const idx = traces.findIndex((t) => t.workUnitId === id);
      if (idx >= 0) traces[idx] = { ...traces[idx]!, ...fields };
      return { ok: true, trace: traces[idx >= 0 ? idx : 0] ?? ({} as never) };
    },
    getByIdempotencyKey: async () => null,
  } as unknown as WorkTraceStore;
}

export function deploymentResolver(): {
  resolve(req: CanonicalSubmitRequest): Promise<DeploymentContext>;
} {
  return {
    resolve: async (req) => {
      // Handoff carries targetHint.skillSlug="ad-optimizer"; the child draft has no
      // hint, so its intent prefix "creative" resolves the creative deployment.
      const slug = req.targetHint?.skillSlug ?? req.intent.split(".")[0] ?? "unknown";
      return toDeploymentContext({
        deploymentId: slug === "creative" ? CREATIVE_DEPLOYMENT_ID : RILEY_DEPLOYMENT_ID,
        listingId: slug === "creative" ? CREATIVE_LISTING_ID : "list-ad-optimizer",
        organizationId: req.organizationId,
        skillSlug: slug,
        trustScore: 0,
        trustLevel: "guided",
        persona: undefined,
        inputConfig: {},
        policyOverrides: undefined,
      });
    },
  };
}

export function handoffRegistration(): IntentRegistration {
  return {
    intent: "adoptimizer.recommendation.handoff",
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: "adoptimizer.recommendation.handoff" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["internal"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

// The child draft is system_auto_approved so it executes without a second approval —
// exactly the seam the handoff handler relies on after a human approves the parent.
export function creativeDraftRegistration(): IntentRegistration {
  return {
    ...handoffRegistration(),
    intent: "creative.concept.draft",
    executor: { mode: "workflow", workflowId: "creative.concept.draft" },
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
  };
}

// ── In-memory CreativeJob store + the REAL creative-draft handler deps ──

export interface CreativeJobRow {
  id: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
  productImages: string[];
  references: string[];
  pastPerformance: Record<string, unknown> | null;
  generateReferenceImages: boolean;
  currentStage: string;
  stageOutputs: Record<string, unknown>;
  mode: string;
  stoppedAt: Date | null;
  ugcPhase: string | null;
  ugcPhaseOutputs: Record<string, unknown> | null;
  ugcFailure: Record<string, unknown> | null;
  reviewDecision: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function buildCreativeStores(jobs: CreativeJobRow[]): CreativeConceptDraftDeps {
  const tasks: Array<{ id: string }> = [];
  return {
    taskStore: {
      create: async () => {
        const id = `task_${tasks.length + 1}`;
        tasks.push({ id });
        return { id };
      },
    },
    jobStore: {
      create: async (input) => {
        const id = `job_${jobs.length + 1}`;
        const now = new Date();
        // Materialize a full CreativeJob row with the Prisma defaults a fresh draft
        // gets: currentStage "trends" + empty stageOutputs => Mira status "in_progress".
        jobs.push({
          id,
          taskId: input.taskId,
          organizationId: input.organizationId,
          deploymentId: input.deploymentId,
          productDescription: input.productDescription,
          targetAudience: input.targetAudience,
          platforms: input.platforms,
          brandVoice: input.brandVoice,
          productImages: input.productImages,
          references: input.references,
          pastPerformance: input.pastPerformance,
          generateReferenceImages: input.generateReferenceImages,
          currentStage: "trends",
          stageOutputs: {},
          mode: "polished",
          stoppedAt: null,
          ugcPhase: null,
          ugcPhaseOutputs: null,
          ugcFailure: null,
          reviewDecision: null,
          createdAt: now,
          updatedAt: now,
        });
        return { id };
      },
    },
    deploymentStore: {
      findById: async (id) =>
        id === CREATIVE_DEPLOYMENT_ID
          ? { listingId: CREATIVE_LISTING_ID, organizationId: ORG }
          : null,
    },
    enablementStore: {
      // Mira is enabled for org_dev (seedMiraPilotOrgs).
      list: async () => [{ agentKey: "mira", status: "enabled" }],
    },
  };
}

export interface FullLoopHarness {
  ingress: PlatformIngress;
  submitChildWork: (req: ChildWorkRequest) => Promise<SubmitWorkResponse>;
  modeRegistry: ExecutionModeRegistry;
  jobs: CreativeJobRow[];
  traceStore: WorkTraceStore;
  /**
   * Sabotage switch for dispatch-failure tests: the NEXT handoff execute
   * returns outcome "failed"; subsequent calls delegate to the real handler.
   */
  breakHandoffHandlerOnce: () => void;
}

export function buildHarness(
  policies: Policy[],
  opts: { lifecycleService?: ApprovalLifecycleService } = {},
): FullLoopHarness {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(handoffRegistration());
  intentRegistry.register(creativeDraftRegistration());

  const jobs: CreativeJobRow[] = [];

  const ref: { ingress: PlatformIngress | null } = { ingress: null };
  // submitChildWork re-enters the SAME ingress (no parallel mutation path), so the
  // child re-runs governance (system_auto_approved -> execute).
  const submitChildWork = (request: ChildWorkRequest): Promise<SubmitWorkResponse> => {
    if (!ref.ingress) throw new Error("ingress not initialized");
    return ref.ingress.submit({
      organizationId: request.organizationId,
      actor: request.actor,
      intent: request.intent,
      parameters: request.parameters,
      parentWorkUnitId: request.parentWorkUnitId,
      idempotencyKey: request.idempotencyKey,
      trigger: "internal",
      surface: { surface: "api" },
    });
  };

  // Failure-injection wrapper around the REAL handoff handler.
  const realHandoffHandler = buildRecommendationHandoffWorkflow();
  const sabotage = { failNext: false };
  const wrappedHandoffHandler: WorkflowHandler = {
    async execute(workUnit: WorkUnit, services): Promise<WorkflowHandlerResult> {
      if (sabotage.failNext) {
        sabotage.failNext = false;
        return {
          outcome: "failed",
          summary: "synthetic dispatch failure",
          outputs: {},
          error: { code: "SYNTHETIC", message: "synthetic dispatch failure" },
        };
      }
      return realHandoffHandler.execute(workUnit, services);
    },
  };

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(
    new WorkflowMode({
      handlers: new Map<string, WorkflowHandler>([
        ["adoptimizer.recommendation.handoff", wrappedHandoffHandler],
        ["creative.concept.draft", buildCreativeConceptDraftWorkflow(buildCreativeStores(jobs))],
      ]),
      services: { submitChildWork },
    }),
  );

  const traceStore = inMemoryTraceStore();
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate(policies),
    deploymentResolver: deploymentResolver(),
    traceStore,
    lifecycleService: opts.lifecycleService,
  });
  ref.ingress = ingress;

  return {
    ingress,
    submitChildWork,
    modeRegistry,
    jobs,
    traceStore,
    breakHandoffHandlerOnce: () => {
      sabotage.failNext = true;
    },
  };
}

// ── Synthetic Meta insight that yields a refresh_creative recommendation ──
//
// current vs previous: clicks halve (CTR 2.0 -> 1.0, down + significant), frequency
// rises (2.0 -> 3.0, up + significant), impressions + spend flat (CPM stable, not
// significant), conversions flat at 50 (CPA stable; account conversions 50 >= 30 so
// the economic tier is "cpl", not "cpc" -> refresh_creative survives applyTier).
// Clicks halving (not flat) keeps measurementTrusted=true. => creative_fatigue
// diagnosis => refresh_creative (diagnostic evidence family, floor easily met).

export function makeInsight(overrides: Partial<CampaignInsight>): CampaignInsight {
  return {
    campaignId: "camp-1",
    campaignName: "Test Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 100_000,
    inlineLinkClicks: 2_000,
    spend: 5_000,
    conversions: 50,
    revenue: 15_000,
    frequency: 2.0,
    cpm: 50,
    inlineLinkClickCtr: 2.0,
    costPerInlineLinkClick: 2.5,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
    ...overrides,
  };
}

export function makeAccountSummary(): AccountSummary {
  return {
    accountId: "act-123",
    accountName: "Test Account",
    currency: "USD",
    totalSpend: 10_000,
    totalImpressions: 200_000,
    totalClicks: 4_000,
    activeCampaigns: 1,
  };
}

export function makeFunnelData(): CrmFunnelData {
  return {
    campaignIds: ["camp-1"],
    leads: 100,
    qualified: 40,
    opportunities: 50,
    bookings: 25,
    closed: 10,
    revenue: 30_000,
    rates: {
      leadToQualified: 0.4,
      qualifiedToBooking: 0.625,
      bookingToClosed: 0.4,
      leadToClosed: 0.1,
    },
    coverage: {
      attributedContacts: 100,
      contactsWithEmailOrPhone: 90,
      contactsWithOpportunity: 50,
      contactsWithBooking: 25,
      contactsWithRevenueEvent: 10,
    },
  };
}

export function makeCrmBenchmarks(): FunnelBenchmarks {
  return {
    leadToQualifiedRate: 0.4,
    qualifiedToBookingRate: 0.5,
    bookingToClosedRate: 0.25,
    leadToClosedRate: 0.06,
  };
}

export function syntheticAdsClient(): AdsClientInterface {
  const current = [makeInsight({ inlineLinkClicks: 1_000, frequency: 3.0 })];
  const previous = [makeInsight({ inlineLinkClicks: 2_000, frequency: 2.0 })];
  return {
    getCampaignInsights: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(previous),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
  };
}

export function syntheticInsightsProvider(): CampaignInsightsProvider {
  const learning: CampaignLearningInput = {
    effectiveStatus: "ACTIVE",
    learningPhase: false,
    lastModifiedDays: 14,
    optimizationEvents: 100,
  };
  const breach: TargetBreachResult = {
    periodsAboveTarget: 0,
    granularity: "daily",
    isApproximate: false,
  };
  return {
    getCampaignLearningData: vi.fn().mockResolvedValue(learning),
    getTargetBreachStatus: vi.fn().mockResolvedValue(breach),
  };
}

export function syntheticCrmProvider(): CrmDataProvider {
  return {
    getFunnelData: vi.fn().mockResolvedValue(makeFunnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(makeCrmBenchmarks()),
  };
}

// step.run just executes the step body inline (no Inngest durability in-test).
export const step = {
  run: async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> => fn(),
  sendEvent: async () => {},
};

export interface ParkedHandoff {
  req: CanonicalSubmitRequest;
  res: SubmitWorkResponse;
}

/**
 * Builds the CronDependencies whose recommendationHandoffSubmitter MIRRORS the
 * production submit MECHANISM (the inngest.ts closure + the contained-workflows
 * submitRecommendationHandoff closure): synthesizeCreativeBrief ->
 * buildRecommendationHandoffSubmitRequest -> REAL ingress.submit. Captures each
 * parked submit for assertion.
 *
 * synthesizeCreativeBrief(null) is exactly what org_dev yields in production: the
 * inngest closure calls synthesizeCreativeBrief(await businessFactsStore.get(orgId)),
 * and org_dev has no seeded BusinessFacts (only org_demo does), so that read returns
 * null and the medspa fallback brief is used.
 */
export function buildCronDeps(ingress: PlatformIngress, parked: ParkedHandoff[]): CronDependencies {
  const recommendationHandoffSubmitter: RecommendationHandoffSubmitter = async (candidate) => {
    const brief = synthesizeCreativeBrief(null);
    const input: RecommendationHandoffSubmitInput = {
      organizationId: candidate.organizationId,
      recommendationId: candidate.recommendationId,
      actionType: candidate.actionType,
      campaignId: candidate.campaignId,
      rationale: candidate.rationale,
      evidence: candidate.evidence,
      learningPhaseActive: candidate.learningPhaseActive,
      brief,
    };
    const req = buildRecommendationHandoffSubmitRequest(input, {
      deploymentId: candidate.deploymentId,
      skillSlug: "ad-optimizer",
    });
    if (!req) return;
    const res = await ingress.submit(req);
    parked.push({ req, res });
  };

  return {
    listActiveDeployments: async () => [
      { id: RILEY_DEPLOYMENT_ID, organizationId: ORG, inputConfig: {} },
    ],
    getDeploymentCredentials: async () => ({ accessToken: "tok", accountId: "act-123" }),
    createAdsClient: () => syntheticAdsClient(),
    createCrmProvider: () => syntheticCrmProvider(),
    createInsightsProvider: () => syntheticInsightsProvider(),
    saveAuditReport: async () => {},
    // Real-returning emitter: the same {surface,id} contract emitRecommendation
    // returns. The persisted Recommendation row itself is tested separately; the
    // handoff only consumes result.id + result.surface.
    recommendationEmitter: async (input) => ({ surface: "queue", id: `rec_${input.action}` }),
    recommendationHandoffSubmitter,
  };
}

export function readerFor(jobs: CreativeJobRow[]): PrismaMiraCreativeReadModelReader {
  const prisma = {
    creativeJob: {
      findMany: async (args: { where: { organizationId: string } }) =>
        jobs.filter((j) => j.organizationId === args.where.organizationId),
    },
  };
  return new PrismaMiraCreativeReadModelReader(
    prisma as unknown as ConstructorParameters<typeof PrismaMiraCreativeReadModelReader>[0],
  );
}
