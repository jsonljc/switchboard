/**
 * LIVE-PATH integration proof for the Riley cron -> agent handoff wiring.
 *
 * Drives the REAL seam the cron now fires: the extracted submit step
 * (buildRecommendationHandoffSubmitRequest, the SAME builder the bootstrap closure
 * uses) -> a REAL PlatformIngress -> the REAL GovernanceGate with the seeded allow +
 * require_approval(mandatory) policies and the seeded { id:"system" } principal.
 *
 * Proves (the #1 anti-"built-but-unwired" requirement):
 *   - an eligible handoff PARKS at mandatory (never system_auto_approved),
 *   - on approval the handler creates a Mira creative.concept.draft CHILD through the
 *     SAME real ingress (system_auto_approved -> executes -> draft row),
 *   - Riley's abstention short-circuits the submit (builder returns null),
 *   - an un-seeded org default-DENIES (fail safe, no phantom success).
 *
 * Mirrors recommendation-handoff-gate.test.ts (the proven real-gate harness) + the
 * convergence-e2e PlatformIngress harness. No Postgres (CI has none for apps/api).
 */
import { describe, it, expect } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  WorkflowMode,
  toDeploymentContext,
  type GovernanceGateDeps,
  type WorkUnit,
  type IntentRegistration,
  type WorkflowHandler,
  type ChildWorkRequest,
  type CanonicalSubmitRequest,
  type DeploymentContext,
  type SubmitWorkResponse,
} from "@switchboard/core/platform";
import type { WorkTrace, WorkTraceStore, WorkTraceReadResult } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE,
  buildRecommendationHandoffApprovalPolicyInput,
} from "@switchboard/db";
import {
  buildRecommendationHandoffSubmitRequest,
  type RecommendationHandoffSubmitInput,
} from "../services/workflows/recommendation-handoff-request.js";
import { buildRecommendationHandoffWorkflow } from "../services/workflows/recommendation-handoff-workflow.js";

const ORG = "org-acme";
const RILEY_DEPLOYMENT = { deploymentId: "dep-riley", skillSlug: "ad-optimizer" };

function systemSpec(): IdentitySpec {
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

function allowPolicy(): Policy {
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

function approvalPolicy(): Policy {
  return {
    ...buildRecommendationHandoffApprovalPolicyInput(ORG),
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function buildGate(policies: Policy[]): GovernanceGate {
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

function inMemoryTraceStore(): WorkTraceStore {
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

function deploymentResolver(): {
  resolve(req: CanonicalSubmitRequest): Promise<DeploymentContext>;
} {
  return {
    resolve: async (req) => {
      // Handoff carries targetHint.skillSlug="ad-optimizer"; the child draft has no
      // hint, so its intent prefix "creative" resolves the creative deployment.
      const slug = req.targetHint?.skillSlug ?? req.intent.split(".")[0] ?? "unknown";
      return toDeploymentContext({
        deploymentId: slug === "creative" ? "dep-creative" : "dep-riley",
        listingId: `list-${slug}`,
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

function handoffRegistration(): IntentRegistration {
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
function creativeDraftRegistration(): IntentRegistration {
  return {
    ...handoffRegistration(),
    intent: "creative.concept.draft",
    executor: { mode: "workflow", workflowId: "creative.concept.draft" },
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
  };
}

interface Harness {
  ingress: PlatformIngress;
  submitChildWork: (req: ChildWorkRequest) => Promise<SubmitWorkResponse>;
  createdDrafts: Array<{ organizationId: string; parameters: unknown }>;
}

function buildHarness(policies: Policy[]): Harness {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register(handoffRegistration());
  intentRegistry.register(creativeDraftRegistration());

  const createdDrafts: Array<{ organizationId: string; parameters: unknown }> = [];
  const creativeDraftHandler: WorkflowHandler = {
    async execute(workUnit) {
      createdDrafts.push({
        organizationId: workUnit.organizationId,
        parameters: workUnit.parameters,
      });
      return {
        outcome: "completed",
        summary: "draft created",
        outputs: { jobId: `job_${createdDrafts.length}` },
      };
    },
  };

  // Mutable holder so submitChildWork can close over the ingress that is constructed
  // after it (the WorkflowMode needs submitChildWork, the ingress needs the mode).
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

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(
    new WorkflowMode({
      handlers: new Map<string, WorkflowHandler>([
        [
          "adoptimizer.recommendation.handoff",
          buildRecommendationHandoffWorkflow({
            markRecommendationActed: async () => ({ transitioned: true }),
          }),
        ],
        ["creative.concept.draft", creativeDraftHandler],
      ]),
      services: { submitChildWork },
    }),
  );

  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate(policies),
    deploymentResolver: deploymentResolver(),
    traceStore: inMemoryTraceStore(),
  });
  ref.ingress = ingress;

  return { ingress, submitChildWork, createdDrafts };
}

const goodInput: RecommendationHandoffSubmitInput = {
  organizationId: ORG,
  recommendationId: "rec_1",
  actionType: "refresh_creative",
  campaignId: "camp_1",
  rationale: "creative fatigue",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
  learningPhaseActive: false,
  brief: { productDescription: "Botox refresh", targetAudience: "women 30-45" },
};

describe("Riley cron -> agent handoff (live path through real ingress + gate)", () => {
  it("PARKS at mandatory with the seeded policies + system principal (never auto-approved)", async () => {
    const { ingress } = buildHarness([allowPolicy(), approvalPolicy()]);
    const req = buildRecommendationHandoffSubmitRequest(goodInput, RILEY_DEPLOYMENT);
    expect(req).not.toBeNull();
    const res = await ingress.submit(req!);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("approvalRequired" in res && res.approvalRequired).toBe(true);
    expect(res.result.outcome).toBe("pending_approval");
    // The cron uses the seeded system principal verbatim (a bespoke id hard-denies).
    expect(res.workUnit?.actor).toEqual({ id: "system", type: "system" });
    // Deterministic idempotency key (the ingress claim-first guard dedups a retry).
    expect(req!.idempotencyKey).toBe("handoff:riley:rec_1:refresh_creative");
  });

  it("on approval, the handler creates a Mira creative.concept.draft child through the same ingress", async () => {
    const h = buildHarness([allowPolicy(), approvalPolicy()]);
    const req = buildRecommendationHandoffSubmitRequest(goodInput, RILEY_DEPLOYMENT)!;
    const parked = await h.ingress.submit(req);
    expect(parked.ok && "approvalRequired" in parked && parked.approvalRequired).toBe(true);

    // Approval is owned by the lifecycle; post-approval it dispatches the parked
    // WorkUnit to the handler. Drive that handler with the parked parameters and the
    // REAL ingress-backed submitChildWork — proving the child draft is created.
    const parkedWorkUnit = {
      id: "wu-handoff",
      organizationId: ORG,
      actor: req.actor,
      intent: req.intent,
      parameters: req.parameters,
      trigger: "internal",
      priority: "normal",
    } as WorkUnit;
    const result = await buildRecommendationHandoffWorkflow({
      markRecommendationActed: async () => ({ transitioned: true }),
    }).execute(parkedWorkUnit, {
      submitChildWork: h.submitChildWork,
    });

    expect(result.outcome).toBe("completed");
    expect((result.outputs as { jobId?: string }).jobId).toBeDefined();
    expect(h.createdDrafts).toHaveLength(1);
    // The synthesized brief flowed through to the child draft.
    expect(
      (h.createdDrafts[0]!.parameters as { brief: { productDescription: string } }).brief,
    ).toMatchObject({ productDescription: "Botox refresh" });
  });

  it("does NOT submit when Riley abstains (below the evidence floor) — builder returns null", () => {
    const req = buildRecommendationHandoffSubmitRequest(
      { ...goodInput, evidence: { clicks: 1, conversions: 0, days: 1 } },
      RILEY_DEPLOYMENT,
    );
    expect(req).toBeNull();
  });

  it("default-DENIES on an un-seeded org (no allow policy) — fail safe, no phantom success", async () => {
    const { ingress } = buildHarness([]); // no policies seeded
    const req = buildRecommendationHandoffSubmitRequest(goodInput, RILEY_DEPLOYMENT)!;
    const res = await ingress.submit(req);
    const parked = res.ok && "approvalRequired" in res && res.approvalRequired === true;
    const completed = res.ok && res.result.outcome === "completed";
    expect(parked).toBe(false);
    expect(completed).toBe(false);
  });
});
