import { describe, it, expect, vi } from "vitest";
import type { LeadIntake } from "@switchboard/schemas";
import { LeadIntakeHandler, type LeadIntakeStore } from "./lead-intake-handler.js";
import {
  buildLeadIntakeWorkflow,
  buildLeadIntakeWorkflowFromStore,
} from "./lead-intake-workflow.js";
import { PlatformIngress } from "../platform/platform-ingress.js";
import { IntentRegistry } from "../platform/intent-registry.js";
import { ExecutionModeRegistry } from "../platform/execution-mode-registry.js";
import { WorkflowMode, type WorkflowHandler } from "../platform/modes/workflow-mode.js";
import type { GovernanceGateInterface } from "../platform/platform-ingress.js";
import type { CanonicalSubmitRequest } from "../platform/canonical-request.js";
import type { GovernanceDecision, ExecutionConstraints } from "../platform/governance-types.js";
import type { WorkUnit } from "../platform/work-unit.js";

const intake: LeadIntake = {
  source: "ctwa",
  organizationId: "org-1",
  deploymentId: "dep-1",
  contact: { phone: "+6591234567", channel: "whatsapp" },
  attribution: { ctwa_clid: "abc", capturedAt: "2026-04-26T00:00:00Z" },
  idempotencyKey: "+6591234567:abc",
};

function makeStore(): LeadIntakeStore & {
  upsertContact: ReturnType<typeof vi.fn>;
  createActivity: ReturnType<typeof vi.fn>;
  findContactByIdempotency: ReturnType<typeof vi.fn>;
} {
  return {
    upsertContact: vi.fn().mockResolvedValue({ id: "contact_1" }),
    createActivity: vi.fn().mockResolvedValue({ id: "act_1" }),
    findContactByIdempotency: vi.fn().mockResolvedValue(null),
  };
}

describe("buildLeadIntakeWorkflow (unit)", () => {
  it("invokes the handler and returns completed outcome with contactId", async () => {
    const store = makeStore();
    const handler = new LeadIntakeHandler({ store });
    const wf = buildLeadIntakeWorkflow(handler);
    const workUnit = { parameters: intake } as unknown as WorkUnit;

    const result = await wf.execute(workUnit, {
      submitChildWork: vi.fn(),
    });

    expect(store.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", sourceType: "ctwa" }),
    );
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toEqual({ contactId: "contact_1", duplicate: false });
  });

  it("returns failed outcome on invalid payload", async () => {
    const wf = buildLeadIntakeWorkflowFromStore(makeStore());
    const workUnit = { parameters: { bogus: true } } as unknown as WorkUnit;

    const result = await wf.execute(workUnit, { submitChildWork: vi.fn() });

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
  });
});

describe("lead.intake via PlatformIngress (integration)", () => {
  it("routes lead.intake through the workflow front door to LeadIntakeHandler", async () => {
    const store = makeStore();
    const handler = buildLeadIntakeWorkflowFromStore(store);

    const handlers = new Map<string, WorkflowHandler>([["lead.intake", handler]]);
    const modeRegistry = new ExecutionModeRegistry();
    modeRegistry.register(new WorkflowMode({ handlers, services: { submitChildWork: vi.fn() } }));

    const intentRegistry = new IntentRegistry();
    intentRegistry.register({
      intent: "lead.intake",
      defaultMode: "workflow",
      allowedModes: ["workflow"],
      executor: { mode: "workflow", workflowId: "lead.intake" },
      parameterSchema: {},
      mutationClass: "write",
      budgetClass: "standard",
      approvalPolicy: "none",
      idempotent: true,
      allowedTriggers: ["api", "internal"],
      timeoutMs: 30_000,
      retryable: true,
    });

    const constraints: ExecutionConstraints = {
      allowedModelTiers: ["default"],
      maxToolCalls: 1,
      maxLlmTurns: 1,
      maxTotalTokens: 1000,
      maxRuntimeMs: 5000,
      maxWritesPerExecution: 5,
      trustLevel: "guided",
    };
    const decision: GovernanceDecision = {
      outcome: "execute",
      riskScore: 0.1,
      budgetProfile: "standard",
      constraints,
      matchedPolicies: [],
    };
    const governanceGate: GovernanceGateInterface = {
      evaluate: vi.fn().mockResolvedValue(decision),
    };

    const ingress = new PlatformIngress({
      intentRegistry,
      modeRegistry,
      governanceGate,
      deploymentResolver: {
        resolve: vi.fn().mockResolvedValue({
          deploymentId: "dep-1",
          skillSlug: "lead-intake",
          trustLevel: "guided",
          trustScore: 50,
        }),
      },
    });

    const request: CanonicalSubmitRequest = {
      organizationId: "org-1",
      actor: { id: "system", type: "system" },
      intent: "lead.intake",
      parameters: intake as unknown as Record<string, unknown>,
      trigger: "api",
      surface: { surface: "api", requestId: "req-1" },
    };

    const response = await ingress.submit(request);

    expect(response.ok).toBe(true);
    if (response.ok && "result" in response) {
      expect(response.result.outcome).toBe("completed");
      expect(response.result.outputs).toMatchObject({ contactId: "contact_1" });
    }
    // Doctrine proof: the Contact upsert happened via the ingress -> workflow -> handler chain
    expect(store.upsertContact).toHaveBeenCalledTimes(1);
    expect(store.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "lead_received" }),
    );
  });
});
