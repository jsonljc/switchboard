import type { AgentKey } from "@switchboard/schemas";

export type EnablementStatus = "enabled" | "coming_soon" | "disabled";

export interface OrgAgentEnablementRow {
  id: string;
  orgId: string;
  agentKey: AgentKey;
  status: EnablementStatus;
  enabledAt: Date;
  updatedAt: Date;
}

export interface OrgAgentEnablementStore {
  list(orgId: string): Promise<OrgAgentEnablementRow[]>;
  enable(orgId: string, agentKey: AgentKey): Promise<OrgAgentEnablementRow>;
  setStatus(orgId: string, agentKey: AgentKey, status: EnablementStatus): Promise<void>;
}
