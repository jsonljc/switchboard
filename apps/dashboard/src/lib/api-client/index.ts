// Re-export types from domain modules
export type {
  MarketplaceListing,
  MarketplaceDeployment,
  MarketplaceTask,
  CreativeJobSummary,
  TrustScoreBreakdown,
  DraftFAQ,
  ExecutionTraceSummary,
} from "./marketplace";

export type { AgentRosterEntry, AgentStateEntry } from "./agents";

export type { BillingStatus, CheckoutResult, PortalResult } from "./billing";

// Re-export types from api-client-types (governance types used by base)
export type {
  PendingApproval,
  ApprovalDetail,
  HealthCheck,
  SimulateResult,
} from "../api-client-types";

// The final composed client
import { SwitchboardBillingClient } from "./billing";

export class SwitchboardClient extends SwitchboardBillingClient {}
