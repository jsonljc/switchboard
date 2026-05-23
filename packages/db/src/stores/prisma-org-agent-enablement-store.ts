import type { PrismaClient } from "@prisma/client";
import type { AgentKey } from "@switchboard/schemas";
import type {
  EnablementStatus,
  OrgAgentEnablementRow,
  OrgAgentEnablementStore,
} from "@switchboard/core";
import { StaleVersionError } from "@switchboard/core";

export class PrismaOrgAgentEnablementStore implements OrgAgentEnablementStore {
  constructor(private prisma: PrismaClient) {}

  async list(orgId: string): Promise<OrgAgentEnablementRow[]> {
    const rows = await this.prisma.orgAgentEnablement.findMany({
      where: { orgId },
      orderBy: { enabledAt: "asc" },
    });
    return rows.map(toRow);
  }

  async enable(orgId: string, agentKey: AgentKey): Promise<OrgAgentEnablementRow> {
    const row = await this.prisma.orgAgentEnablement.upsert({
      where: { orgId_agentKey: { orgId, agentKey } },
      create: { orgId, agentKey, status: "enabled" },
      update: { status: "enabled" },
    });
    return toRow(row);
  }

  async setStatus(orgId: string, agentKey: AgentKey, status: EnablementStatus): Promise<void> {
    const result = await this.prisma.orgAgentEnablement.updateMany({
      where: { orgId, agentKey },
      data: { status },
    });
    if (result.count === 0) throw new StaleVersionError(`${orgId}:${agentKey}`, -1, -1);
  }
}

function toRow(row: {
  id: string;
  orgId: string;
  agentKey: string;
  status: string;
  enabledAt: Date;
  updatedAt: Date;
}): OrgAgentEnablementRow {
  return {
    id: row.id,
    orgId: row.orgId,
    agentKey: row.agentKey as AgentKey,
    status: row.status as EnablementStatus,
    enabledAt: row.enabledAt,
    updatedAt: row.updatedAt,
  };
}
