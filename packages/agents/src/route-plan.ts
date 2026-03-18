// ---------------------------------------------------------------------------
// Route Plan — destination resolution output
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";

export type DestinationType = "agent" | "connector" | "webhook" | "manual_queue" | "system";
export type DestinationCriticality = "required" | "optional" | "best_effort";
export type DestinationSequencing = "parallel" | "after_success" | "blocking";

export interface ResolvedDestination {
  type: DestinationType;
  id: string;
  criticality: DestinationCriticality;
  sequencing: DestinationSequencing;
  afterDestinationId?: string;
}

export interface RoutePlan {
  event: RoutedEventEnvelope;
  destinations: ResolvedDestination[];
}

export type ManualQueueReason =
  | "manual_review"
  | "human_approval"
  | "needs_configuration"
  | "failed_after_retries"
  | "blocked_by_policy";

export interface WebhookDestinationConfig {
  id: string;
  url: string;
  secret?: string;
  subscribedEvents: string[];
  criticality: DestinationCriticality;
  enabled: boolean;
}

export interface ConnectorDestinationConfig {
  id: string;
  connectorType: string;
  subscribedEvents: string[];
  criticality: DestinationCriticality;
  enabled: boolean;
  config: Record<string, unknown>;
}
