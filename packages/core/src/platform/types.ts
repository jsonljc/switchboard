export type ExecutionModeName = "skill" | "pipeline" | "cartridge";
export type ActorType = "user" | "agent" | "system" | "service";
export type Trigger = "chat" | "api" | "schedule" | "internal";
export type Priority = "low" | "normal" | "high" | "critical";
export type WorkOutcome = "completed" | "failed" | "pending_approval" | "queued" | "running";
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
