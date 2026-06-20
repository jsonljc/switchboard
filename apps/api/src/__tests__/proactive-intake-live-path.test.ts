/**
 * LIVE-PATH proof for the platform-initiated PROACTIVE + LEAD-INTAKE intent family. Drives the real
 * submit MECHANISM (REAL PlatformIngress -> REAL GovernanceGate with the REAL seeded allow policy
 * (buildProactiveIntakeAllowPolicyInput) + the seeded {id:"system"} principal) resolved through the
 * REAL production carve-out predicate (buildPlatformDirectIntentPredicate) + resolveAuthoritativeDeployment.
 *
 * This is the proof the whole family LACKED: every prior test bypasses ingress (handler.execute) or
 * wires resolveAuthoritativeDeployment(null) (which platform-directs everything, masking BOTH the
 * deployment_not_found throw AND the gate default-deny). It pins both layers:
 *   1. EXECUTE: each family intent resolves AND clears the gate (outcome "completed"), never deny/park.
 *   2. carve-out is LOAD-BEARING: WITHOUT it the SAME proactive submit returns deployment_not_found
 *      (slug conversation/meta/lead has no seeded deployment).
 *   3. allow policy is LOAD-BEARING: WITHOUT it the engine default-DENIES (no execute) even past the
 *      resolver — so the carve-out alone would only convert inert-by-throw into inert-by-deny.
 *   4. attribution: meta.lead.intake resolves the REAL Alex deployment (NOT platform-direct), so the
 *      deploymentId it threads into the ingested lead is the clinic's agent, not "platform-direct".
 * No Postgres (CI has none for apps/api).
 */
import { describe, it, expect } from "vitest";
import {
  GovernanceGate,
  PlatformIngress,
  IntentRegistry,
  ExecutionModeRegistry,
  WorkflowMode,
  type GovernanceGateDeps,
  type IntentRegistration,
  type WorkflowHandler,
  type DeploymentResolver,
  type DeploymentResolverResult,
  type CanonicalSubmitRequest,
  type WorkTrace,
  type WorkTraceStore,
  type WorkTraceReadResult,
} from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import { buildProactiveIntakeAllowPolicyInput } from "@switchboard/db";
import {
  resolveAuthoritativeDeployment,
  buildPlatformDirectIntentPredicate,
} from "../bootstrap/platform-deployment-resolver.js";

const ORG = "org-acme";

// The carve-out family (platform-direct) plus meta.lead.intake (resolves the real Alex deployment).
const PROACTIVE_INTENTS = [
  "conversation.reminder.send",
  "conversation.followup.send",
  "meta.lead.greeting.send",
  "meta.lead.inquiry.record",
  "lead.intake",
] as const;
const ALL_FAMILY_INTENTS = [...PROACTIVE_INTENTS, "meta.lead.intake"] as const;

// Per-intent fidelity so the test exercises the SAME trigger-gating the real path does (PlatformIngress
// validates trigger ∈ allowedTriggers, platform-ingress.ts). Each entry mirrors the real registration
// (contained-workflows.ts) + the trigger its real producer submits with + the actor type that producer
// runs as: reminder/follow-up = the schedule crons (system); greeting/inquiry = child work of
// meta.lead.intake (service, inherited actor); lead.intake = the InstantForm/CTWA adapter (system,
// hard-set in buildLeadIntakeIngressSubmitRequest); meta.lead.intake = the Meta webhook (api, service).
// actor.type is fidelity-only — the gate keys identity on actor.id, never .type.
type Trig = "schedule" | "api" | "internal";
const INTENT_META: Record<
  string,
  { triggers: Trig[]; trigger: Trig; actorType: "system" | "service" }
> = {
  "conversation.reminder.send": {
    triggers: ["schedule"],
    trigger: "schedule",
    actorType: "system",
  },
  "conversation.followup.send": {
    triggers: ["schedule"],
    trigger: "schedule",
    actorType: "system",
  },
  "meta.lead.greeting.send": { triggers: ["internal"], trigger: "internal", actorType: "service" },
  "meta.lead.inquiry.record": { triggers: ["internal"], trigger: "internal", actorType: "service" },
  "lead.intake": { triggers: ["internal", "api"], trigger: "internal", actorType: "system" },
  "meta.lead.intake": { triggers: ["internal", "api"], trigger: "api", actorType: "service" },
};

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
    ...buildProactiveIntakeAllowPolicyInput(ORG),
    cartridgeId: null,
    effect: "allow",
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

function inMemoryTraceStore(): { store: WorkTraceStore; traces: WorkTrace[] } {
  const traces: WorkTrace[] = [];
  const store = {
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
    getByIdempotencyKey: async (org: string, key: string): Promise<WorkTraceReadResult | null> => {
      const trace = traces.find((t) => t.organizationId === org && t.idempotencyKey === key);
      return trace ? { trace, integrity: { status: "ok" } } : null;
    },
  } as unknown as WorkTraceStore;
  return { store, traces };
}

function registration(intent: string): IntentRegistration {
  return {
    intent,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: intent },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "none",
    idempotent: false,
    allowedTriggers: INTENT_META[intent]!.triggers,
    timeoutMs: 300_000,
    retryable: true,
  };
}

function alexResult(): DeploymentResolverResult {
  return {
    deploymentId: "dep-alex",
    listingId: "list-alex",
    organizationId: ORG,
    skillSlug: "alex",
    trustLevel: "guided",
    trustScore: 0,
    inputConfig: {},
  } as DeploymentResolverResult;
}

// Production-faithful resolver: the org's real Alex deployment resolves (meta.lead.intake targets it),
// every other slug (conversation/meta/lead) THROWS deployment_not_found.
function aliasResolver(): DeploymentResolver {
  return {
    resolveByOrgAndSlug: async (_org: string, slug: string) => {
      if (slug === "alex") return alexResult();
      throw new Error(`No active deployment found for org=${ORG} slug=${slug}`);
    },
    resolveByDeploymentId: async () => {
      throw new Error("not used in this test");
    },
    resolveByChannelToken: async () => {
      throw new Error("not used in this test");
    },
  };
}

function buildIngress(
  policies: Policy[],
  carveOut: boolean,
): { ingress: PlatformIngress; traces: WorkTrace[] } {
  const intentRegistry = new IntentRegistry();
  for (const intent of ALL_FAMILY_INTENTS) intentRegistry.register(registration(intent));

  // Minimal success handler so an executed (gate-allowed) family intent yields outcome "completed";
  // a deny or a resolver throw never reaches it.
  const ran: WorkflowHandler = {
    async execute() {
      return { outcome: "completed", summary: "executed", outputs: { ran: true } };
    },
  };
  const handlers = new Map<string, WorkflowHandler>(
    ALL_FAMILY_INTENTS.map((intent) => [intent, ran]),
  );
  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(
    new WorkflowMode({
      handlers,
      services: {
        submitChildWork: async () => {
          throw new Error("no child work in this test");
        },
      },
    }),
  );

  const { store, traces } = inMemoryTraceStore();
  const ingress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: buildGate(policies),
    deploymentResolver: resolveAuthoritativeDeployment(aliasResolver(), {
      // The REAL production predicate — not an inline stand-in.
      isPlatformDirectIntent: carveOut
        ? buildPlatformDirectIntentPredicate(intentRegistry)
        : () => false,
    }),
    traceStore: store,
  });
  return { ingress, traces };
}

function submitReq(intent: string): CanonicalSubmitRequest {
  return {
    organizationId: ORG,
    actor: { id: "system", type: INTENT_META[intent]!.actorType },
    intent,
    parameters: {},
    trigger: INTENT_META[intent]!.trigger,
    surface: { surface: "api" },
    idempotencyKey: `live-${intent}`,
    // meta.lead.intake resolves the real Alex deployment (correct lead attribution); the rest are
    // platform-direct via the carve-out and need no targetHint.
    ...(intent === "meta.lead.intake" ? { targetHint: { skillSlug: "alex" } } : {}),
  } as CanonicalSubmitRequest;
}

describe("proactive + intake family (live path through real ingress + gate + seeded allow policy)", () => {
  it.each(ALL_FAMILY_INTENTS)(
    "%s resolves AND clears the gate (EXECUTE, not deny/park/deployment_not_found)",
    async (intent) => {
      const { ingress } = buildIngress([allowPolicy()], true);
      const res = await ingress.submit(submitReq(intent));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect("approvalRequired" in res && res.approvalRequired).not.toBe(true);
      expect(res.result.outcome).toBe("completed");
    },
  );

  it("attributes meta.lead.intake to the REAL Alex deployment, not platform-direct", async () => {
    const { ingress } = buildIngress([allowPolicy()], true);
    const res = await ingress.submit(submitReq("meta.lead.intake"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.workUnit?.deployment?.deploymentId).toBe("dep-alex");
  });

  it("resolves a carve-out send to platform-direct (no real deployment exists)", async () => {
    const { ingress } = buildIngress([allowPolicy()], true);
    const res = await ingress.submit(submitReq("conversation.reminder.send"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.workUnit?.deployment?.deploymentId).toBe("platform-direct");
  });

  it("WITHOUT the carve-out, a proactive send returns deployment_not_found (carve-out is load-bearing)", async () => {
    const { ingress } = buildIngress([allowPolicy()], false);
    const res = await ingress.submit(submitReq("conversation.reminder.send"));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.type).toBe("deployment_not_found");
  });

  it("WITHOUT the allow policy, the family default-DENIES even past the resolver (policy is load-bearing)", async () => {
    const { ingress } = buildIngress([], true); // carve-out resolves, but no allow policy seeded
    const res = await ingress.submit(submitReq("conversation.reminder.send"));
    const executed = res.ok && res.result.outcome === "completed";
    const parked = res.ok && "approvalRequired" in res && res.approvalRequired === true;
    expect(executed).toBe(false); // default-deny: carve-out alone is NOT enough
    expect(parked).toBe(false);
  });
});
