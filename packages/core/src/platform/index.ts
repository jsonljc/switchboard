// Shared primitives
export type {
  ExecutionModeName,
  ActorType,
  Trigger,
  Priority,
  WorkOutcome,
  MutationClass,
  BudgetClass,
  ApprovalPolicy,
  Actor,
  ExecutionError,
} from "./types.js";

// WorkUnit
export type { SubmitWorkRequest, WorkUnit } from "./work-unit.js";
export { normalizeWorkUnit } from "./work-unit.js";

// Intent Registration
export type { IntentRegistration, ExecutorBinding } from "./intent-registration.js";

// Governance
export type { GovernanceDecision, ExecutionConstraints } from "./governance-types.js";

// Execution
export type { ExecutionResult } from "./execution-result.js";
export type { ExecutionContext, ExecutionMode } from "./execution-context.js";

// Tracing
export type { WorkTrace } from "./work-trace.js";

// Errors
export type { IngressError } from "./ingress-error.js";
export { isIngressError } from "./ingress-error.js";

// Registries
export { IntentRegistry } from "./intent-registry.js";
export { ExecutionModeRegistry } from "./execution-mode-registry.js";
