import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTriggerHandler } from "../trigger-handler.js";
import type { TriggerStore } from "@switchboard/core";
import type { TriggerWorkflowEngine } from "../trigger-handler.js";

describe("createTriggerHandler", () => {
  let store: { findById: ReturnType<typeof vi.fn>; updateStatus: ReturnType<typeof vi.fn> };
  let workflowEngine: {
    createWorkflow: ReturnType<typeof vi.fn>;
    startWorkflow: ReturnType<typeof vi.fn>;
  };
  let handler: ReturnType<typeof createTriggerHandler>;

  beforeEach(() => {
    store = {
      findById: vi.fn(),
      updateStatus: vi.fn(),
    };
    workflowEngine = {
      createWorkflow: vi.fn(async () => ({ id: "wf-new" })),
      startWorkflow: vi.fn(async () => ({ status: "completed" })),
    };
    handler = createTriggerHandler({
      store: store as unknown as TriggerStore,
      workflowEngine: workflowEngine as unknown as TriggerWorkflowEngine,
    });
  });

  it("skips if trigger is no longer active", async () => {
    store.findById.mockResolvedValue({ id: "trig-1", status: "cancelled" });

    await handler({
      data: {
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: {} },
      },
    } as never);

    expect(workflowEngine.createWorkflow).not.toHaveBeenCalled();
    expect(store.updateStatus).not.toHaveBeenCalled();
  });

  it("skips if trigger not found", async () => {
    store.findById.mockResolvedValue(null);

    await handler({
      data: {
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: {} },
      },
    } as never);

    expect(workflowEngine.createWorkflow).not.toHaveBeenCalled();
  });

  it("spawns a workflow for spawn_workflow action", async () => {
    store.findById.mockResolvedValue({
      id: "trig-1",
      status: "active",
      type: "timer",
      organizationId: "org-1",
    });

    await handler({
      data: {
        triggerId: "trig-1",
        organizationId: "org-1",
        action: {
          type: "spawn_workflow",
          payload: { sourceAgent: "nurture", intent: "follow_up" },
        },
      },
    } as never);

    expect(workflowEngine.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        triggerType: "schedule",
        triggerRef: "trig-1",
        sourceAgent: "nurture",
        actions: [],
        strategy: "sequential",
      }),
    );
    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith("wf-new");
    expect(store.updateStatus).toHaveBeenCalledWith("trig-1", "fired");
  });

  it("does not mark cron trigger as fired (stays active)", async () => {
    store.findById.mockResolvedValue({
      id: "trig-1",
      status: "active",
      type: "cron",
      organizationId: "org-1",
    });

    await handler({
      data: {
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: {} },
      },
    } as never);

    expect(workflowEngine.createWorkflow).toHaveBeenCalled();
    expect(store.updateStatus).not.toHaveBeenCalledWith("trig-1", "fired");
  });

  it("resumes a workflow for resume_workflow action", async () => {
    store.findById.mockResolvedValue({
      id: "trig-2",
      status: "active",
      type: "timer",
      organizationId: "org-1",
    });

    await handler({
      data: {
        triggerId: "trig-2",
        organizationId: "org-1",
        action: {
          type: "resume_workflow",
          payload: { workflowId: "wf-existing" },
        },
      },
    } as never);

    expect(workflowEngine.createWorkflow).not.toHaveBeenCalled();
    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith("wf-existing");
    expect(store.updateStatus).toHaveBeenCalledWith("trig-2", "fired");
  });

  it("does not resume if workflowId is missing", async () => {
    store.findById.mockResolvedValue({
      id: "trig-3",
      status: "active",
      type: "timer",
      organizationId: "org-1",
    });

    await handler({
      data: {
        triggerId: "trig-3",
        organizationId: "org-1",
        action: {
          type: "resume_workflow",
          payload: {},
        },
      },
    } as never);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    // Timer still gets marked as fired
    expect(store.updateStatus).toHaveBeenCalledWith("trig-3", "fired");
  });
});
