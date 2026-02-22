import type { PrismaClient } from "@prisma/client";
import type { IdentitySpec, RoleOverlay } from "@switchboard/schemas";
import type { IdentityStore } from "@switchboard/core";

export class PrismaIdentityStore implements IdentityStore {
  constructor(private prisma: PrismaClient) {}

  async saveSpec(spec: IdentitySpec): Promise<void> {
    await this.prisma.identitySpec.upsert({
      where: { id: spec.id },
      create: {
        id: spec.id,
        principalId: spec.principalId,
        organizationId: spec.organizationId,
        name: spec.name,
        description: spec.description,
        riskTolerance: spec.riskTolerance as object,
        globalSpendLimits: spec.globalSpendLimits as object,
        cartridgeSpendLimits: spec.cartridgeSpendLimits as object,
        forbiddenBehaviors: spec.forbiddenBehaviors,
        trustBehaviors: spec.trustBehaviors,
        createdAt: spec.createdAt,
        updatedAt: spec.updatedAt,
      },
      update: {
        principalId: spec.principalId,
        organizationId: spec.organizationId,
        name: spec.name,
        description: spec.description,
        riskTolerance: spec.riskTolerance as object,
        globalSpendLimits: spec.globalSpendLimits as object,
        cartridgeSpendLimits: spec.cartridgeSpendLimits as object,
        forbiddenBehaviors: spec.forbiddenBehaviors,
        trustBehaviors: spec.trustBehaviors,
        updatedAt: spec.updatedAt,
      },
    });
  }

  async getSpecByPrincipalId(principalId: string): Promise<IdentitySpec | null> {
    const row = await this.prisma.identitySpec.findFirst({
      where: { principalId },
    });
    if (!row) return null;
    return toIdentitySpec(row);
  }

  async getSpecById(id: string): Promise<IdentitySpec | null> {
    const row = await this.prisma.identitySpec.findUnique({ where: { id } });
    if (!row) return null;
    return toIdentitySpec(row);
  }

  async listOverlaysBySpecId(specId: string): Promise<RoleOverlay[]> {
    const rows = await this.prisma.roleOverlay.findMany({
      where: { identitySpecId: specId },
    });
    return rows.map(toRoleOverlay);
  }

  async saveOverlay(overlay: RoleOverlay): Promise<void> {
    await this.prisma.roleOverlay.upsert({
      where: { id: overlay.id },
      create: {
        id: overlay.id,
        identitySpecId: overlay.identitySpecId,
        name: overlay.name,
        description: overlay.description,
        mode: overlay.mode,
        priority: overlay.priority,
        active: overlay.active,
        conditions: overlay.conditions as object,
        overrides: overlay.overrides as object,
        createdAt: overlay.createdAt,
        updatedAt: overlay.updatedAt,
      },
      update: {
        identitySpecId: overlay.identitySpecId,
        name: overlay.name,
        description: overlay.description,
        mode: overlay.mode,
        priority: overlay.priority,
        active: overlay.active,
        conditions: overlay.conditions as object,
        overrides: overlay.overrides as object,
        updatedAt: overlay.updatedAt,
      },
    });
  }
}

function toIdentitySpec(row: {
  id: string;
  principalId: string;
  organizationId: string | null;
  name: string;
  description: string;
  riskTolerance: unknown;
  globalSpendLimits: unknown;
  cartridgeSpendLimits: unknown;
  forbiddenBehaviors: string[];
  trustBehaviors: string[];
  createdAt: Date;
  updatedAt: Date;
}): IdentitySpec {
  return {
    id: row.id,
    principalId: row.principalId,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    riskTolerance: row.riskTolerance as IdentitySpec["riskTolerance"],
    globalSpendLimits: row.globalSpendLimits as IdentitySpec["globalSpendLimits"],
    cartridgeSpendLimits: row.cartridgeSpendLimits as IdentitySpec["cartridgeSpendLimits"],
    forbiddenBehaviors: row.forbiddenBehaviors,
    trustBehaviors: row.trustBehaviors,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRoleOverlay(row: {
  id: string;
  identitySpecId: string;
  name: string;
  description: string;
  mode: string;
  priority: number;
  active: boolean;
  conditions: unknown;
  overrides: unknown;
  createdAt: Date;
  updatedAt: Date;
}): RoleOverlay {
  return {
    id: row.id,
    identitySpecId: row.identitySpecId,
    name: row.name,
    description: row.description,
    mode: row.mode as RoleOverlay["mode"],
    priority: row.priority,
    active: row.active,
    conditions: row.conditions as RoleOverlay["conditions"],
    overrides: row.overrides as RoleOverlay["overrides"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
