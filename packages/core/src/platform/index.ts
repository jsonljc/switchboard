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

// Canonical Request
export type {
  SurfaceName,
  SurfaceMetadata,
  TargetHint,
  CanonicalSubmitRequest,
  AuthoritativeDeploymentResolver,
} from "./canonical-request.js";

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
export type {
  TraceInput,
  WorkTraceStore,
  WorkTraceUpdateResult,
  WorkTraceReadResult,
} from "./work-trace-recorder.js";
export * from "./work-trace-lock.js";
export {
  WorkTraceIntegrityError,
  assertExecutionAdmissible,
  verifyWorkTraceIntegrity,
} from "./work-trace-integrity.js";
export type { IntegrityVerdict, IntegrityOverride } from "./work-trace-integrity.js";
export {
  WORK_TRACE_HASH_VERSION,
  WORK_TRACE_HASH_VERSION_V1,
  WORK_TRACE_HASH_VERSION_V2,
  WORK_TRACE_HASH_VERSION_LATEST,
  WORK_TRACE_HASH_EXCLUDED_FIELDS_V1,
  WORK_TRACE_HASH_EXCLUDED_FIELDS_V2,
  computeWorkTraceContentHash,
  buildWorkTraceHashInput,
} from "./work-trace-hash.js";

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

// Platform Lifecycle
export { PlatformLifecycle } from "./platform-lifecycle.js";
export type { PlatformLifecycleConfig, ApprovalResponseResult } from "./platform-lifecycle.js";

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
export { WorkflowMode } from "./modes/index.js";
export type {
  WorkflowModeConfig,
  WorkflowHandler,
  WorkflowHandlerResult,
  WorkflowRuntimeServices,
  ChildWorkRequest,
} from "./modes/index.js";

// Registrars
export { registerSkillIntents } from "./skill-intent-registrar.js";
export { registerCartridgeIntents } from "./cartridge-intent-registrar.js";
export type { CartridgeManifestForRegistration } from "./cartridge-intent-registrar.js";
export { registerPipelineIntents } from "./pipeline-intent-registrar.js";
export type { PipelineDefinition } from "./pipeline-intent-registrar.js";

// Billing entitlement (canonical home is core/billing; re-exported here for convenience)
export type {
  BillingEntitlementResolver,
  OrganizationEntitlement,
  EntitlementInputs,
} from "../billing/entitlement.js";
export { evaluateEntitlement } from "../billing/entitlement.js";

// Deployment Resolution
export type {
  DeploymentContext,
  AgentPersona,
  DeploymentPolicyOverrides,
} from "./deployment-context.js";
export type { DeploymentResolverResult, DeploymentResolver } from "./deployment-resolver.js";
export { DeploymentInactiveError, toDeploymentContext } from "./deployment-resolver.js";
export { PrismaDeploymentResolver } from "./prisma-deployment-resolver.js";

// Conversation State Store
export type {
  ConversationStateStore,
  ConversationOperatorActionKind,
  SetOverrideInput,
  SetOverrideResult,
  SendOperatorMessageInput,
  SendOperatorMessageResult,
  ReleaseEscalationInput,
  ReleaseEscalationResult,
} from "./conversation-state-store.js";
export {
  ConversationStateNotFoundError,
  ConversationStateInvalidTransitionError,
} from "./conversation-state-store.js";
