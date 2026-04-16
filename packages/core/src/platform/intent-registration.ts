import type {
  ExecutionModeName,
  Trigger,
  MutationClass,
  BudgetClass,
  ApprovalPolicy,
} from "./types.js";

export type ExecutorBinding =
  | { mode: "skill"; skillSlug: string }
  | { mode: "pipeline"; pipelineId: string }
  | { mode: "cartridge"; actionId: string };

export interface IntentRegistration {
  intent: string;
  defaultMode: ExecutionModeName;
  allowedModes: ExecutionModeName[];
  executor: ExecutorBinding;
  parameterSchema: Record<string, unknown>;
  mutationClass: MutationClass;
  budgetClass: BudgetClass;
  approvalPolicy: ApprovalPolicy;
  idempotent: boolean;
  allowedTriggers: Trigger[];
  timeoutMs: number;
  retryable: boolean;
}
