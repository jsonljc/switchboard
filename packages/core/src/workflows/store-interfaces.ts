import type {
  WorkflowExecution,
  WorkflowStatus,
  PendingAction,
  PendingActionStatus,
  ApprovalCheckpoint,
} from "@switchboard/schemas";

export interface WorkflowStore {
  create(workflow: WorkflowExecution): Promise<void>;
  getById(id: string): Promise<WorkflowExecution | null>;
  update(id: string, updates: Partial<WorkflowExecution>): Promise<void>;
  list(filter: {
    organizationId?: string;
    status?: WorkflowStatus;
    sourceAgent?: string;
    limit?: number;
  }): Promise<WorkflowExecution[]>;
}

export interface PendingActionStore {
  create(action: PendingAction): Promise<void>;
  getById(id: string): Promise<PendingAction | null>;
  update(id: string, updates: Partial<PendingAction>): Promise<void>;
  listByWorkflow(workflowId: string): Promise<PendingAction[]>;
  listByStatus(
    organizationId: string,
    status: PendingActionStatus,
    limit?: number,
  ): Promise<PendingAction[]>;
}

export interface ApprovalCheckpointStore {
  create(checkpoint: ApprovalCheckpoint): Promise<void>;
  getById(id: string): Promise<ApprovalCheckpoint | null>;
  getByWorkflowAndStep(workflowId: string, stepIndex: number): Promise<ApprovalCheckpoint | null>;
  update(id: string, updates: Partial<ApprovalCheckpoint>): Promise<void>;
  listPending(organizationId: string): Promise<ApprovalCheckpoint[]>;
}
