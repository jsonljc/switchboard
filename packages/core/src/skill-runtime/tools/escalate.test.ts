import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEscalateToolFactory } from "./escalate.js";
import { getToolGovernanceDecision } from "../governance.js";
import { GovernanceHook } from "../hooks/governance-hook.js";
import type { HandoffReason } from "../../handoff/types.js";
import type { SkillRequestContext } from "../types.js";

function makeBaseDeps() {
  return {
    assembler: {
      assemble: vi.fn().mockReturnValue({
        id: "handoff_123",
        sessionId: "sess_1",
        organizationId: "org_1",
        reason: "missing_knowledge" as HandoffReason,
        status: "pending" as const,
        leadSnapshot: { channel: "whatsapp" },
        qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
        conversationSummary: {
          turnCount: 3,
          keyTopics: [],
          objectionHistory: [],
          sentiment: "neutral",
        },
        slaDeadlineAt: new Date(),
        createdAt: new Date(),
      }),
    },
    handoffStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getBySessionId: vi.fn().mockResolvedValue(null),
    },
    notifier: {
      notify: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const TEST_CONTEXT: SkillRequestContext = {
  sessionId: "sess_1",
  orgId: "org_1",
  deploymentId: "deploy_1",
  traceId: "trace_1",
  surface: "chat",
};

describe("escalate tool factory", () => {
  let baseDeps: ReturnType<typeof makeBaseDeps>;

  beforeEach(() => {
    baseDeps = makeBaseDeps();
  });

  it("factory returns a tool with id 'escalate'", () => {
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    expect(tool.id).toBe("escalate");
  });

  it("has handoff.create operation with effectCategory write", () => {
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    expect(tool.operations["handoff.create"]).toBeDefined();
    expect(tool.operations["handoff.create"]!.effectCategory).toBe("write");
  });

  it("creates a handoff package using request context IDs", async () => {
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    const result = await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "Customer asked about parking, no data available",
      customerSentiment: "neutral",
    });

    expect(baseDeps.assembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        organizationId: "org_1",
        reason: "missing_knowledge",
      }),
    );
    expect(baseDeps.handoffStore.getBySessionId).toHaveBeenCalledWith("org_1", "sess_1");
    expect(baseDeps.handoffStore.save).toHaveBeenCalled();
    expect(baseDeps.notifier.notify).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        data: { handoffId: "handoff_123", status: "pending" },
      }),
    );
  });

  it("uses different IDs for different request contexts", async () => {
    const factory = createEscalateToolFactory(baseDeps);

    const ctx2: SkillRequestContext = {
      sessionId: "sess_2",
      orgId: "org_2",
      deploymentId: "deploy_2",
    };

    const tool = factory(ctx2);
    await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "test",
    });

    expect(baseDeps.assembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_2",
        organizationId: "org_2",
      }),
    );
    expect(baseDeps.handoffStore.getBySessionId).toHaveBeenCalledWith("org_2", "sess_2");
  });

  it("returns existing handoff if one is pending for same session (duplicate guard)", async () => {
    baseDeps.handoffStore.getBySessionId.mockResolvedValue({
      id: "handoff_existing",
      status: "pending",
    });
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    const result = await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "duplicate attempt",
    });

    expect(baseDeps.assembler.assemble).not.toHaveBeenCalled();
    expect(baseDeps.handoffStore.save).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        data: { handoffId: "handoff_existing", status: "already_pending" },
      }),
    );
  });

  it("offers medical_safety as an escalation reason", () => {
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    const schema = tool.operations["handoff.create"]!.inputSchema as {
      properties: { reason: { enum: string[] } };
    };
    expect(schema.properties.reason.enum).toContain("medical_safety");
  });

  it("passes a medical_safety reason through to the assembler", async () => {
    const factory = createEscalateToolFactory(baseDeps);
    const tool = factory(TEST_CONTEXT);
    await tool.operations["handoff.create"]!.execute({
      reason: "medical_safety",
      summary: "Lead reports a changing mole and wants it lasered",
    });
    expect(baseDeps.assembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "medical_safety" }),
    );
  });
});

// P1-A SAFETY-VALVE REGRESSION: escalation is the human safety valve — it must
// never itself be gated behind approval. A freshly onboarded real org resolves to
// "supervised" trust (ensureAlexListingForOrg seeds trustScore:0, no override). At
// supervised, escalate's "write" effect maps to require-approval, and the in-skill
// GovernanceHook short-circuits with proceed:false / pending_approval BEFORE
// execute() runs — so handoffStore.save + notifier.notify never fire. The handoff
// (incl. a medical_safety red flag or an angry customer) is silently swallowed
// while Alex still tells the lead "someone will reach out". A scoped
// governanceOverride auto-approves the escalation so the human handoff is assembled
// + notified at the DEFAULT trust. Mirrors calendar-book.booking.create.
describe("escalation is a safety valve — never gated behind approval (P1-A)", () => {
  let baseDeps: ReturnType<typeof makeBaseDeps>;

  beforeEach(() => {
    baseDeps = makeBaseDeps();
  });

  it("handoff.create auto-approves at the default-onboarding 'supervised' trust", () => {
    const tool = createEscalateToolFactory(baseDeps)(TEST_CONTEXT);
    expect(getToolGovernanceDecision(tool.operations["handoff.create"]!, "supervised")).toBe(
      "auto-approve",
    );
  });

  it("the GovernanceHook lets handoff.create PROCEED at supervised trust (no pending_approval dead-end)", async () => {
    const tool = createEscalateToolFactory(baseDeps)(TEST_CONTEXT);
    const hook = new GovernanceHook(new Map([[tool.id, tool]]));
    const result = await hook.beforeToolCall({
      toolId: "escalate",
      operation: "handoff.create",
      params: { reason: "medical_safety", summary: "Lead reports a changing mole" },
      effectCategory: "write",
      trustLevel: "supervised",
    });
    expect(result.proceed).toBe(true);
    expect(result.decision).not.toBe("pending_approval");
    const log = hook.getGovernanceLogs().at(-1)!;
    expect(log.decision).toBe("auto-approve");
    expect(log.overridden).toBe(true);
  });

  it("a supervised-trust escalation actually assembles + notifies the handoff (not silently swallowed)", async () => {
    const tool = createEscalateToolFactory(baseDeps)(TEST_CONTEXT);
    const hook = new GovernanceHook(new Map([[tool.id, tool]]));
    const gate = await hook.beforeToolCall({
      toolId: "escalate",
      operation: "handoff.create",
      params: { reason: "negative_sentiment", summary: "Customer is angry" },
      effectCategory: "write",
      trustLevel: "supervised",
    });
    // The executor only reaches execute() once the hook proceeds.
    expect(gate.proceed).toBe(true);
    await tool.operations["handoff.create"]!.execute({
      reason: "negative_sentiment",
      summary: "Customer is angry",
    });
    expect(baseDeps.handoffStore.save).toHaveBeenCalled();
    expect(baseDeps.notifier.notify).toHaveBeenCalled();
  });
});
