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
export { buildWorkTrace } from "./work-trace-recorder.js";
export type { TraceInput, WorkTraceStore } from "./work-trace-recorder.js";

// Errors
export type { IngressError } from "./ingress-error.js";
export { isIngressError } from "./ingress-error.js";

// Platform Ingress
export { PlatformIngress } from "./platform-ingress.js";
export type {
  PlatformIngressConfig,
  SubmitWorkResponse,
  GovernanceGateInterface,
} from "./platform-ingress.js";

// Registries
export { IntentRegistry } from "./intent-registry.js";
export { ExecutionModeRegistry } from "./execution-mode-registry.js";

// Governance
export { GovernanceGate } from "./governance/index.js";
export type {
  GovernanceGateDeps,
  GovernanceCartridge,
  ConstraintOverrides,
} from "./governance/index.js";
export {
  resolveConstraints,
  DEFAULT_CONSTRAINTS,
  DEFAULT_CARTRIDGE_CONSTRAINTS,
  CONSTRAINT_PROFILE_CARTRIDGE_V1,
} from "./governance/index.js";

// Modes
export { SkillMode } from "./modes/index.js";
export type { SkillModeConfig } from "./modes/index.js";
export { CartridgeMode } from "./modes/index.js";
export type { CartridgeModeConfig } from "./modes/index.js";
export { PipelineMode } from "./modes/index.js";
export type { PipelineModeConfig, PipelineEventSender } from "./modes/index.js";

// Registrars
export { registerSkillIntents } from "./skill-intent-registrar.js";
export { registerCartridgeIntents } from "./cartridge-intent-registrar.js";
export type { CartridgeManifestForRegistration } from "./cartridge-intent-registrar.js";
export { registerPipelineIntents } from "./pipeline-intent-registrar.js";
export type { PipelineDefinition } from "./pipeline-intent-registrar.js";
