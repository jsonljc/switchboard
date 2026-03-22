import type { PrismaClient } from "@prisma/client";
import type { AgentRoleOverride } from "@switchboard/schemas";
import type { RoleOverrideStore } from "@switchboard/core/sessions";

export class PrismaRoleOverrideStore implements RoleOverrideStore {
  constructor(private prisma: PrismaClient) {}

  async save(override: AgentRoleOverride): Promise<void> {
    await this.prisma.agentRoleOverride.create({
      data: {
        id: override.id,
        organizationId: override.organizationId,
        roleId: override.roleId,
        allowedTools: override.allowedTools ?? [],
        safetyEnvelopeOverride: override.safetyEnvelopeOverride
          ? (override.safetyEnvelopeOverride as object)
          : undefined,
        governanceProfileOverride: override.governanceProfileOverride ?? undefined,
        additionalGuardrails: override.additionalGuardrails
          ? (override.additionalGuardrails as object)
          : undefined,
        createdAt: override.createdAt,
        updatedAt: override.updatedAt,
      },
    });
  }

  async getByOrgAndRole(organizationId: string, roleId: string): Promise<AgentRoleOverride | null> {
    const row = await this.prisma.agentRoleOverride.findUnique({
      where: { organizationId_roleId: { organizationId, roleId } },
    });
    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organizationId,
      roleId: row.roleId,
      allowedTools: row.allowedTools,
      safetyEnvelopeOverride:
        (row.safetyEnvelopeOverride as AgentRoleOverride["safetyEnvelopeOverride"]) ?? undefined,
      governanceProfileOverride: row.governanceProfileOverride ?? undefined,
      additionalGuardrails: (row.additionalGuardrails as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async update(id: string, updates: Partial<AgentRoleOverride>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.allowedTools !== undefined) data.allowedTools = updates.allowedTools;
    if (updates.safetyEnvelopeOverride !== undefined)
      data.safetyEnvelopeOverride = updates.safetyEnvelopeOverride as object;
    if (updates.governanceProfileOverride !== undefined)
      data.governanceProfileOverride = updates.governanceProfileOverride;
    if (updates.additionalGuardrails !== undefined)
      data.additionalGuardrails = updates.additionalGuardrails as object;

    await this.prisma.agentRoleOverride.update({ where: { id }, data });
  }
}
