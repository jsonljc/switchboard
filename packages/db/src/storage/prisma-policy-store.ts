import type { PrismaClient } from "@prisma/client";
import type { Policy } from "@switchboard/schemas";
import type { PolicyStore } from "@switchboard/core";

export class PrismaPolicyStore implements PolicyStore {
  constructor(private prisma: PrismaClient) {}

  async save(policy: Policy): Promise<void> {
    await this.prisma.policy.upsert({
      where: { id: policy.id },
      create: {
        id: policy.id,
        name: policy.name,
        description: policy.description,
        organizationId: policy.organizationId,
        cartridgeId: policy.cartridgeId,
        priority: policy.priority,
        active: policy.active,
        rule: policy.rule as object,
        effect: policy.effect,
        effectParams: policy.effectParams as object ?? undefined,
        approvalRequirement: policy.approvalRequirement ?? null,
        riskCategoryOverride: policy.riskCategoryOverride ?? null,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      },
      update: {
        name: policy.name,
        description: policy.description,
        organizationId: policy.organizationId,
        cartridgeId: policy.cartridgeId,
        priority: policy.priority,
        active: policy.active,
        rule: policy.rule as object,
        effect: policy.effect,
        effectParams: policy.effectParams as object ?? undefined,
        approvalRequirement: policy.approvalRequirement ?? null,
        riskCategoryOverride: policy.riskCategoryOverride ?? null,
        updatedAt: policy.updatedAt,
      },
    });
  }

  async getById(id: string): Promise<Policy | null> {
    const row = await this.prisma.policy.findUnique({ where: { id } });
    if (!row) return null;
    return toPolicy(row);
  }

  async update(id: string, data: Partial<Policy>): Promise<void> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (data.name !== undefined) updateData["name"] = data.name;
    if (data.description !== undefined) updateData["description"] = data.description;
    if (data.organizationId !== undefined) updateData["organizationId"] = data.organizationId;
    if (data.cartridgeId !== undefined) updateData["cartridgeId"] = data.cartridgeId;
    if (data.priority !== undefined) updateData["priority"] = data.priority;
    if (data.active !== undefined) updateData["active"] = data.active;
    if (data.rule !== undefined) updateData["rule"] = data.rule as object;
    if (data.effect !== undefined) updateData["effect"] = data.effect;
    if (data.effectParams !== undefined) updateData["effectParams"] = data.effectParams as object;
    if (data.approvalRequirement !== undefined) updateData["approvalRequirement"] = data.approvalRequirement;
    if (data.riskCategoryOverride !== undefined) updateData["riskCategoryOverride"] = data.riskCategoryOverride;

    await this.prisma.policy.update({ where: { id }, data: updateData });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.policy.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async listActive(filter?: { cartridgeId?: string; organizationId?: string | null }): Promise<Policy[]> {
    const where: Record<string, unknown> = { active: true };

    if (filter?.cartridgeId) {
      where["OR"] = [
        { cartridgeId: null },
        { cartridgeId: filter.cartridgeId },
      ];
    }

    // Scope to global policies + org-specific policies when org is provided
    if (filter?.organizationId !== undefined) {
      const orgCondition = [
        { organizationId: null },
        { organizationId: filter.organizationId },
      ];
      if (where["OR"]) {
        // Combine with existing cartridgeId OR using AND
        const cartridgeOr = where["OR"];
        delete where["OR"];
        where["AND"] = [
          { OR: cartridgeOr },
          { OR: orgCondition },
        ];
      } else {
        where["OR"] = orgCondition;
      }
    }

    const rows = await this.prisma.policy.findMany({
      where,
      orderBy: { priority: "asc" },
    });

    return rows.map(toPolicy);
  }
}

function toPolicy(row: {
  id: string;
  name: string;
  description: string;
  organizationId: string | null;
  cartridgeId: string | null;
  priority: number;
  active: boolean;
  rule: unknown;
  effect: string;
  effectParams: unknown;
  approvalRequirement: string | null;
  riskCategoryOverride: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Policy {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    organizationId: row.organizationId,
    cartridgeId: row.cartridgeId,
    priority: row.priority,
    active: row.active,
    rule: row.rule as Policy["rule"],
    effect: row.effect as Policy["effect"],
    effectParams: (row.effectParams as Record<string, unknown>) ?? undefined,
    approvalRequirement: (row.approvalRequirement as Policy["approvalRequirement"]) ?? undefined,
    riskCategoryOverride: (row.riskCategoryOverride as Policy["riskCategoryOverride"]) ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
