export { loadSkill } from "./skill-loader.js";
export { SkillExecutorImpl } from "./skill-executor.js";
export { GovernanceHook } from "./hooks/governance-hook.js";
export { SimulationPolicyHook } from "./hooks/simulation-policy-hook.js";
export { TracePersistenceHook } from "./hooks/trace-persistence-hook.js";
export { DeterministicSafetyGateHook } from "./hooks/deterministic-safety-gate.js";
export type { DeterministicSafetyGateHookDeps } from "./hooks/deterministic-safety-gate.js";
export { PriceClaimGateHook } from "./hooks/price-claim-gate.js";
export type { PriceClaimGateHookDeps } from "./hooks/price-claim-gate.js";
export { PdpaConsentGateHook } from "./hooks/pdpa-consent-gate.js";
export type { PdpaConsentGateHookDeps } from "./hooks/pdpa-consent-gate.js";
export { WhatsAppWindowGateHook } from "./hooks/whatsapp-window-gate.js";
export type {
  WhatsAppWindowGateDeps,
  WhatsAppWindowGateConfig,
  WhatsAppTemplateApprovalSource,
} from "./hooks/whatsapp-window-gate.js";
export {
  resolveTemplate,
  selectTemplate,
  parseTemplateApprovalOverlay,
} from "./templates/whatsapp-registry.js";
export type {
  TemplateApprovalOverlay,
  TemplateApprovalStatus,
} from "./templates/whatsapp-registry.js";
// Governance infrastructure re-exported for bootstrap wiring convenience
export { createAgentDeploymentGovernanceResolver } from "../governance/governance-config-resolver.js";
export type { GovernanceConfigResolver } from "../governance/governance-config-resolver.js";
export { InMemoryGovernancePostureCache } from "../governance/posture-cache.js";
export type { GovernancePostureCache } from "../governance/posture-cache.js";
export { loadBannedPhrases } from "../governance/banned-phrases/index.js";
export { loadEscalationTriggers } from "../governance/escalation-triggers/index.js";
/** @deprecated Use `AnthropicToolAdapter` instead. Alias retained for out-of-tree consumers; removal scheduled for PR-4B follow-up. */
export { AnthropicToolCallingAdapter } from "./tool-calling-adapter.js";
export { AnthropicToolAdapter } from "./adapters/anthropic-tool-adapter.js";
export { interpolate } from "./template-engine.js";
export { getGovernanceConstraints } from "./governance-injector.js";
export { buildSystemPrompt } from "./system-prompt.js";
export { ToolRegistry } from "./tool-registry.js";
export {
  getToolGovernanceDecision,
  mapDecisionToOutcome,
  GOVERNANCE_POLICY,
} from "./governance.js";
export { ParameterResolutionError, validateBuilderRegistration } from "./parameter-builder.js";
export {
  createCrmQueryToolFactory,
  createCrmWriteToolFactory,
  createCalendarBookToolFactory,
  createWebScannerTool,
  createEscalateToolFactory,
  createDepositLinkToolFactory,
  createDelegateToolFactory,
  createScheduleFollowUpToolFactory,
  buildRescheduleOperations,
  resolveBookedValueCents,
  enforceConsentPrecondition,
} from "./tools/index.js";
export type {
  EscalateToolFactory,
  DepositLinkToolFactory,
  DelegateToolFactory,
  DelegateToolDeps,
  CalendarBookToolFactory,
  CrmWriteToolFactory,
  CalendarProviderFactory,
  ScheduleFollowUpToolFactory,
  CalendarRescheduleDeps,
  ResolveBookedValueInput,
  ConsentPrecondition,
  BookingConsentState,
} from "./tools/index.js";
export type {
  ChildWorkSubmitter,
  DelegationRequest,
  DelegationResult,
  DelegationTarget,
} from "./delegation-port.js";
export { composeSkillRequestContext } from "./skill-request-context.js";
export {
  alexBuilder,
  miraBuilder,
  hasSurfacedCreativeMemorySignal,
  salesPipelineBuilder,
  websiteProfilerBuilder,
  adOptimizerInteractiveBuilder,
} from "./builders/index.js";
export { CircuitBreaker } from "./circuit-breaker.js";
export { BlastRadiusLimiter } from "./blast-radius-limiter.js";
export { OutcomeLinker, deriveLinkedOutcome } from "./outcome-linker.js";
export type { LinkedOutcome } from "./outcome-linker.js";
export { ok, fail, denied, pendingApproval } from "./tool-result.js";
export type { ToolResult } from "./tool-result.js";
export {
  structuredError,
  isValidTaxonomyCode,
  getCategoryForCode,
  TAXONOMY_CODES,
  ERROR_CATEGORIES,
  DEFAULT_REMEDIATIONS,
} from "./error-taxonomy.js";
export type { ErrorCategory, StructuredError } from "./error-taxonomy.js";
export { filterForReinjection, DEFAULT_REINJECTION_POLICY } from "./reinjection-filter.js";
export type {
  ResultClass,
  ReinjectionPolicy,
  ReinjectionMeta,
  ReinjectionDecision,
} from "./reinjection-filter.js";
export { ContextResolverImpl } from "./context-resolver.js";

// Batch execution
export { BatchSkillHandler } from "./batch-skill-handler.js";
export type { BatchExecutionResult } from "./batch-skill-handler.js";
export { validateBatchSkillResult } from "./batch-types.js";
export type {
  BatchContextRequirement,
  BatchContextContract,
  BatchSkillResult,
  BatchExecutionConfig,
  BatchParameterBuilder,
  BatchSkillStores,
  BatchRecommendation,
  BatchProposedWrite,
} from "./batch-types.js";
export { adOptimizerBuilder, AD_OPTIMIZER_CONTRACT } from "./builders/index.js";
export { createBatchExecutorFunction } from "./batch-executor-function.js";

// Types
export type {
  SkillDefinition,
  ParameterDeclaration,
  ParameterType,
  SkillExecutionParams,
  SkillExecutionResult,
  ToolCallRecord,
  SkillTool,
  SkillToolFactory,
  SkillToolOperation,
  SkillExecutor,
  SkillHook,
  SkillHookContext,
  OutputFieldDeclaration,
  SkillExecutionTraceData,
  SkillExecutionTrace,
  SkillRequestContext,
} from "./types.js";
export {
  SkillParseError,
  SkillValidationError,
  SkillParameterError,
  SkillExecutionBudgetError,
} from "./types.js";
export type {
  EffectCategory,
  GovernanceTier,
  TrustLevel,
  GovernanceDecision,
  GovernanceOutcome,
  GovernanceLogEntry,
} from "./governance-types.js";
export type { ParameterBuilder, SkillStores, SkillServices } from "./parameter-builder.js";
export { BuilderRegistry } from "./builder-registry.js";
export { BookingFailureHandler } from "./tools/booking-failure-handler.js";
export type { BuilderContext, RegisteredBuilder } from "./builder-registry.js";
export { ClaimClassifierHook } from "./hooks/claim-classifier.js";
export type { ClaimClassifierHookDeps } from "./hooks/claim-classifier.js";
// 1b-2 classifier infrastructure re-exported for bootstrap wiring convenience
export { splitSentences } from "../governance/text/sentence-splitter.js";
export { renderHandoffTemplate } from "../governance/handoff-template.js";
export { createAnthropicClaimClassifier } from "../governance/classifier/anthropic-classifier.js";
export { createSubstantiationResolver } from "../governance/classifier/substantiation-resolver.js";
export { createInMemoryLRU } from "../governance/classifier/substantiation-cache.js";
export { loadRegulatoryPublicSources } from "../governance/classifier/regulatory-sources/index.js";
export { loadRewriteTemplates } from "../governance/classifier/rewrite-templates/index.js";
