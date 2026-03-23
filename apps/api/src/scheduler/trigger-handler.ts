import type { Job } from "bullmq";
import type { TriggerStore } from "@switchboard/core";
import type { SchedulerJobData } from "../queue/scheduler-queue.js";

// Use structural typing for WorkflowEngine to avoid tight coupling
export interface TriggerWorkflowEngine {
  createWorkflow(input: {
    organizationId: string;
    triggerType: "schedule";
    triggerRef: string;
    sourceAgent: string;
    actions: unknown[];
    strategy: "sequential";
    safetyEnvelope: {
      maxSteps: number;
      maxDollarsAtRisk: number;
      timeoutMs: number;
      maxReplans: number;
    };
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  startWorkflow(workflowId: string): Promise<unknown>;
}

export interface TriggerHandlerDeps {
  store: TriggerStore;
  workflowEngine: TriggerWorkflowEngine;
}

export function createTriggerHandler(deps: TriggerHandlerDeps) {
  const { store, workflowEngine } = deps;

  return async function handleTriggerFired(job: Job<SchedulerJobData>): Promise<void> {
    const { triggerId, organizationId, action } = job.data;

    const trigger = await store.findById(triggerId);
    if (!trigger || trigger.status !== "active") {
      return; // Trigger was cancelled or already fired
    }

    if (action.type === "spawn_workflow") {
      const payload = action.payload as Record<string, unknown>;
      const workflow = await workflowEngine.createWorkflow({
        organizationId,
        triggerType: "schedule",
        triggerRef: triggerId,
        sourceAgent: (payload.sourceAgent as string) ?? "scheduler",
        actions: [],
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: (payload.maxSteps as number) ?? 10,
          maxDollarsAtRisk: (payload.maxDollarsAtRisk as number) ?? 0,
          timeoutMs: (payload.timeoutMs as number) ?? 300_000,
          maxReplans: (payload.maxReplans as number) ?? 3,
        },
        metadata: payload,
      });
      await workflowEngine.startWorkflow(workflow.id);
    } else if (action.type === "resume_workflow") {
      const workflowId = (action.payload as Record<string, unknown>).workflowId as string;
      if (workflowId) {
        await workflowEngine.startWorkflow(workflowId);
      }
    }
    // emit_event: handled by EventLoop integration (Task 8), not here

    // Timer triggers fire once — mark as fired. Cron triggers stay active.
    if (trigger.type === "timer") {
      await store.updateStatus(triggerId, "fired");
    }
  };
}
