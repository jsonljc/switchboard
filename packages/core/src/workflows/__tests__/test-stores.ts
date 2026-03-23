import type {
  WorkflowExecution,
  WorkflowStatus,
  PendingAction,
  PendingActionStatus,
  ApprovalCheckpoint,
} from "@switchboard/schemas";
import type {
  WorkflowStore,
  PendingActionStore,
  ApprovalCheckpointStore,
} from "../store-interfaces.js";

// ---------------------------------------------------------------------------
// InMemoryWorkflowStore
// ---------------------------------------------------------------------------

export class InMemoryWorkflowStore implements WorkflowStore {
  readonly items: Map<string, WorkflowExecution> = new Map();

  async create(workflow: WorkflowExecution): Promise<void> {
    this.items.set(workflow.id, { ...workflow });
  }

  async getById(id: string): Promise<WorkflowExecution | null> {
    const w = this.items.get(id);
    return w ? { ...w } : null;
  }

  async update(id: string, updates: Partial<WorkflowExecution>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Workflow ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async list(filter: {
    organizationId?: string;
    status?: WorkflowStatus;
    sourceAgent?: string;
    limit?: number;
  }): Promise<WorkflowExecution[]> {
    let results = [...this.items.values()];
    if (filter.organizationId)
      results = results.filter((w) => w.organizationId === filter.organizationId);
    if (filter.status) results = results.filter((w) => w.status === filter.status);
    if (filter.sourceAgent) results = results.filter((w) => w.sourceAgent === filter.sourceAgent);
    if (filter.limit) results = results.slice(0, filter.limit);
    return results;
  }
}

// ---------------------------------------------------------------------------
// InMemoryPendingActionStore
// ---------------------------------------------------------------------------

export class InMemoryPendingActionStore implements PendingActionStore {
  readonly items: Map<string, PendingAction> = new Map();

  async create(action: PendingAction): Promise<void> {
    this.items.set(action.id, { ...action });
  }

  async getById(id: string): Promise<PendingAction | null> {
    const a = this.items.get(id);
    return a ? { ...a } : null;
  }

  async update(id: string, updates: Partial<PendingAction>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`PendingAction ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async listByWorkflow(workflowId: string): Promise<PendingAction[]> {
    return [...this.items.values()].filter((a) => a.workflowId === workflowId);
  }

  async listByStatus(
    organizationId: string,
    status: PendingActionStatus,
    limit?: number,
  ): Promise<PendingAction[]> {
    let results = [...this.items.values()].filter(
      (a) => a.organizationId === organizationId && a.status === status,
    );
    if (limit) results = results.slice(0, limit);
    return results;
  }
}

// ---------------------------------------------------------------------------
// InMemoryApprovalCheckpointStore
// ---------------------------------------------------------------------------

export class InMemoryApprovalCheckpointStore implements ApprovalCheckpointStore {
  readonly items: Map<string, ApprovalCheckpoint> = new Map();

  async create(checkpoint: ApprovalCheckpoint): Promise<void> {
    this.items.set(checkpoint.id, { ...checkpoint });
  }

  async getById(id: string): Promise<ApprovalCheckpoint | null> {
    const c = this.items.get(id);
    return c ? { ...c } : null;
  }

  async getByWorkflowAndStep(
    workflowId: string,
    stepIndex: number,
  ): Promise<ApprovalCheckpoint | null> {
    const c = [...this.items.values()].find(
      (c) => c.workflowId === workflowId && c.stepIndex === stepIndex,
    );
    return c ? { ...c } : null;
  }

  async update(id: string, updates: Partial<ApprovalCheckpoint>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`ApprovalCheckpoint ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async listPending(_organizationId: string): Promise<ApprovalCheckpoint[]> {
    // Note: In-memory version filters by status only.
    // The Prisma store will use a JOIN to filter by workflow.organizationId.
    // This is acceptable for unit tests.
    return [...this.items.values()].filter((c) => c.status === "pending");
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface TestWorkflowStores {
  workflows: InMemoryWorkflowStore;
  actions: InMemoryPendingActionStore;
  checkpoints: InMemoryApprovalCheckpointStore;
}

export function createTestWorkflowStores(): TestWorkflowStores {
  return {
    workflows: new InMemoryWorkflowStore(),
    actions: new InMemoryPendingActionStore(),
    checkpoints: new InMemoryApprovalCheckpointStore(),
  };
}
