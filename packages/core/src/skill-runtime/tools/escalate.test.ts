import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEscalateTool } from "./escalate.js";
import type { HandoffReason } from "../../handoff/types.js";

function makeDeps() {
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
    sessionId: "sess_1",
    orgId: "org_1",
    messages: [{ role: "user", content: "Do you have parking?" }],
  };
}

describe("escalate tool", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("has id 'escalate'", () => {
    const tool = createEscalateTool(deps);
    expect(tool.id).toBe("escalate");
  });

  it("has handoff.create operation with effectCategory internal_write", () => {
    const tool = createEscalateTool(deps);
    expect(tool.operations["handoff.create"]).toBeDefined();
    expect(tool.operations["handoff.create"]!.effectCategory).toBe("write");
  });

  it("creates a handoff package and notifies", async () => {
    const tool = createEscalateTool(deps);
    const result = await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "Customer asked about parking, no data available",
      customerSentiment: "neutral",
    });

    expect(deps.assembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        organizationId: "org_1",
        reason: "missing_knowledge",
        messages: [{ role: "user", text: "Do you have parking?" }],
      }),
    );
    expect(deps.handoffStore.save).toHaveBeenCalled();
    expect(deps.notifier.notify).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        data: { handoffId: "handoff_123", status: "pending" },
      }),
    );
  });

  it("returns existing handoff if one is pending for same session (duplicate guard)", async () => {
    deps.handoffStore.getBySessionId.mockResolvedValue({
      id: "handoff_existing",
      status: "pending",
    });
    const tool = createEscalateTool(deps);
    const result = await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "duplicate attempt",
    });

    expect(deps.assembler.assemble).not.toHaveBeenCalled();
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: "success",
        data: { handoffId: "handoff_existing", status: "already_pending" },
      }),
    );
  });
});
