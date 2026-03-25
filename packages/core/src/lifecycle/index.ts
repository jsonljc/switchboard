export {
  validateTransition as validateOpportunityTransition,
  TRANSITION_GRAPH,
} from "./transition-validator.js";
export type { TransitionResult as OpportunityTransitionResult } from "./transition-validator.js";
export { deriveContactStage } from "./contact-stage-deriver.js";
export { DEFAULT_STAGE_HANDLER_MAP, agentForOpportunityStage } from "./stage-handler-map.js";
export type { StageHandlerMap } from "./stage-handler-map.js";
export type { ContactStore, CreateContactInput, ContactFilters } from "./contact-store.js";
export type { OpportunityStore, CreateOpportunityInput } from "./opportunity-store.js";
export type {
  RevenueStore,
  RecordRevenueInput,
  DateRange,
  RevenueSummary,
  CampaignRevenueSummary,
} from "./revenue-store.js";
export type { OwnerTaskStore, CreateOwnerTaskInput } from "./owner-task-store.js";
export type {
  StageAdvancementResult,
  RevenueRecordedData,
  ContactDetail,
} from "./lifecycle-types.js";
export { ContactLifecycleService } from "./lifecycle-service.js";
export type { ContactLifecycleServiceConfig } from "./lifecycle-service.js";
