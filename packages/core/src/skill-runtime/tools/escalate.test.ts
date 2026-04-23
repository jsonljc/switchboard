import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEscalateToolFactory } from "./escalate.js";
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
});
