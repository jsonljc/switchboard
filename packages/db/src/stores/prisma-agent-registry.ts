import type { PrismaClient } from "@prisma/client";

export interface PersistedRegistration {
  agentId: string;
  agentRole?: string;
  executionMode: string;
  status: string;
  config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  configVersion: number;
}

export interface PersistInput {
  agentId: string;
  agentRole?: string;
  executionMode: string;
  status: string;
  config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
}

export class PrismaAgentRegistryStore {
  constructor(private prisma: PrismaClient) {}

  async persistRegistration(orgId: string, input: PersistInput): Promise<void> {
    await this.prisma.agentRegistration.upsert({
      where: { orgId_agentId: { orgId, agentId: input.agentId } },
      create: {
        orgId,
        agentId: input.agentId,
        agentRole: input.agentRole ?? null,
        executionMode: input.executionMode,
        status: input.status,
        config: input.config as object,
        capabilities: input.capabilities as object,
        configVersion: 1,
      },
      update: {
        agentRole: input.agentRole ?? undefined,
        executionMode: input.executionMode,
        status: input.status,
        config: input.config as object,
        capabilities: input.capabilities as object,
        configVersion: { increment: 1 },
      },
    });
  }

  async loadAll(orgId: string): Promise<PersistedRegistration[]> {
    const rows = await this.prisma.agentRegistration.findMany({
      where: { orgId },
    });

    return rows.map((r) => ({
      agentId: r.agentId,
      agentRole: (r as { agentRole?: string | null }).agentRole ?? undefined,
      executionMode: r.executionMode,
      status: r.status,
      config: r.config as Record<string, unknown>,
      capabilities: r.capabilities as Record<string, unknown>,
      configVersion: r.configVersion,
    }));
  }
}
