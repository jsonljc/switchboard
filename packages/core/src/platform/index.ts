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
// F4 registry guard: a spend-bearing intent must never be auto-approved.
export { SpendBearingAutoApproveError } from "./intent-registration.js";

// Governance
export type { GovernanceDecision, ExecutionConstraints } from "./governance-types.js";

// Execution
export type { ExecutionResult } from "./execution-result.js";
export type { ExecutionContext, ExecutionMode } from "./execution-context.js";

export type { ApprovalMode } from "./intent-registration.js";

// Tracing
export type { WorkTrace } from "./work-trace.js";
export { buildWorkTrace, buildClaimTrace } from "./work-trace-recorder.js";
export type {
  TraceInput,
  ClaimTraceInput,
  WorkTraceStore,
  WorkTraceUpdateResult,
  WorkTraceReadResult,
  WorkTraceClaimResult,
  StrandedRunningClaim,
} from "./work-trace-recorder.js";
export * from "./work-trace-lock.js";
// EV-2 / SPINE-2: stranded idempotency-claim reaper (orchestrator + constants).
export {
  reapStrandedClaims,
  STRANDED_CLAIM_MAX_AGE_MS,
  STRANDED_CLAIM_REAP_LIMIT,
} from "./stranded-claim-reaper.js";
export type {
  StrandedClaimReaperStore,
  ReapStrandedClaimsDeps,
  ReapStrandedClaimsConfig,
  ReapStrandedClaimsResult,
} from "./stranded-claim-reaper.js";
// A8b-2 / rank-18: stalled pending_confirmation booking reaper (orchestrator + constants).
export {
  reapStalledBookings,
  STALLED_BOOKING_MAX_AGE_MS,
  STALLED_BOOKING_REAP_LIMIT,
} from "./stalled-booking-reaper.js";
export type {
  StalledBookingReaperStore,
  StalledPendingBooking,
  ReapStalledBookingsDeps,
  ReapStalledBookingsConfig,
  ReapStalledBookingsResult,
} from "./stalled-booking-reaper.js";
export {
  WorkTraceIntegrityError,
  assertExecutionAdmissible,
  verifyWorkTraceIntegrity,
} from "./work-trace-integrity.js";
export type { IntegrityVerdict, IntegrityOverride } from "./work-trace-integrity.js";
export { MutatingBypassError, assertNoMutatingBypass } from "./work-trace-bypass-guard.js";
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
export { OperatorMutationMode } from "./modes/index.js";
export type {
  OperatorMutationModeConfig,
  OperatorMutationHandler,
  OperatorMutationHandlerResult,
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
  ReleaseEscalationTarget,
} from "./conversation-state-store.js";
export {
  ConversationStateNotFoundError,
  ConversationStateInvalidTransitionError,
  ContactNotFoundError,
} from "./conversation-state-store.js";

// Deployment Lifecycle Store
export type {
  DeploymentLifecycleStore,
  DeploymentLifecycleActionKind,
  HaltAllInput,
  HaltAllResult,
  ResumeAllInput,
  ResumeAllResult,
  SuspendAllInput,
  SuspendAllResult,
} from "./deployment-lifecycle-store.js";
