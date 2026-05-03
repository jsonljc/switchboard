import { randomUUID } from "node:crypto";
import type { AgentKey } from "@switchboard/schemas";
import type { OrgAgentEnablementRow, OrgAgentEnablementStore } from "@switchboard/core";

export function createInMemoryOrgAgentEnablementStore(): OrgAgentEnablementStore {
  const rows: OrgAgentEnablementRow[] = [];

  function find(orgId: string, agentKey: AgentKey): OrgAgentEnablementRow | undefined {
    return rows.find((r) => r.orgId === orgId && r.agentKey === agentKey);
  }

  return {
    async list(orgId) {
      return rows.filter((r) => r.orgId === orgId).map((r) => ({ ...r }));
    },
    async enable(orgId, agentKey) {
      const existing = find(orgId, agentKey);
      if (existing) {
        existing.status = "enabled";
        existing.updatedAt = new Date();
        return { ...existing };
      }
      const now = new Date();
      const row: OrgAgentEnablementRow = {
        id: randomUUID(),
        orgId,
        agentKey,
        status: "enabled",
        enabledAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return { ...row };
    },
    async setStatus(orgId, agentKey, status) {
      const existing = find(orgId, agentKey);
      if (!existing) return;
      existing.status = status;
      existing.updatedAt = new Date();
    },
  };
}
