// ---------------------------------------------------------------------------
// Workflow Deps Factory — builds WorkflowEngine with its stores
// ---------------------------------------------------------------------------
// Used by API to enable workflow execution capabilities.
// Returns null when required config is missing, allowing degraded boot.
// ---------------------------------------------------------------------------

import { PrismaWorkflowStore } from "@switchboard/db";
import { WorkflowEngine, StepExecutor } from "@switchboard/core";
import type { StepExecutorPolicyBridge, StepExecutorActionExecutor } from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";

export interface WorkflowDeps {
  workflowEngine: WorkflowEngine;
  store: PrismaWorkflowStore;
}

export function buildWorkflowDeps(
  prisma: PrismaClient,
  actionExecutor: StepExecutorActionExecutor,
  policyBridge: StepExecutorPolicyBridge,
): WorkflowDeps | null {
  try {
    const store = new PrismaWorkflowStore(prisma);

    const stepExecutor = new StepExecutor({
      actionStore: store.actions,
      policyBridge,
      actionExecutor,
    });

    const workflowEngine = new WorkflowEngine({
      workflows: store.workflows,
      actions: store.actions,
      checkpoints: store.checkpoints,
      stepExecutor,
    });

    return { workflowEngine, store };
  } catch (err) {
    console.error("[workflow-deps] Failed to build workflow dependencies:", err);
    return null;
  }
}
