export type ExecutionModeName =
  | "skill"
  | "pipeline"
  | "cartridge"
  | "workflow"
  | "operator_mutation";
export type ActorType = "user" | "agent" | "system" | "service";
export type Trigger = "chat" | "api" | "schedule" | "internal";
export type Priority = "low" | "normal" | "high" | "critical";
export type WorkOutcome =
  | "completed"
  | "failed"
  | "pending_approval"
  | "queued"
  | "running"
  // Terminal dead-letter sink for an orphaned `running` idempotency CLAIM (EV-2 /
  // SPINE-2): a process death between claim() and finalizeTrace leaves a `running`
  // WorkTrace that permanently blocks its idempotency key. The stranded-claim reaper
  // ages such a claim here — a NON-resubmittable terminal (the mutation may have
  // committed, so the key must never become re-runnable; manual reconciliation only).
  | "needs_reconciliation";
export type MutationClass = "read" | "write" | "destructive";
export type BudgetClass = "cheap" | "standard" | "expensive";
export type ApprovalPolicy = "none" | "threshold" | "always";

export interface Actor {
  id: string;
  type: ActorType;
}

export interface ExecutionError {
  code: string;
  message: string;
  stage?: string;
}
