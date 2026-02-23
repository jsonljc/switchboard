import type { PrismaClient } from "@prisma/client";
import type { IdentitySpec, RoleOverlay, Principal, DelegationRule } from "@switchboard/schemas";
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
        delegatedApprovers: spec.delegatedApprovers ?? [],
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
        delegatedApprovers: spec.delegatedApprovers ?? [],
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

  async getOverlayById(id: string): Promise<RoleOverlay | null> {
    const row = await this.prisma.roleOverlay.findUnique({ where: { id } });
    if (!row) return null;
    return toRoleOverlay(row);
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

  async getPrincipal(id: string): Promise<Principal | null> {
    const row = await this.prisma.principal.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      type: row.type as Principal["type"],
      name: row.name,
      organizationId: row.organizationId,
      roles: row.roles as Principal["roles"],
    };
  }

  async savePrincipal(principal: Principal): Promise<void> {
    await this.prisma.principal.upsert({
      where: { id: principal.id },
      create: {
        id: principal.id,
        type: principal.type,
        name: principal.name,
        organizationId: principal.organizationId,
        roles: principal.roles,
      },
      update: {
        type: principal.type,
        name: principal.name,
        organizationId: principal.organizationId,
        roles: principal.roles,
      },
    });
  }

  async listDelegationRules(): Promise<DelegationRule[]> {
    const rows = await this.prisma.delegationRule.findMany();
    return rows.map((row: { id: string; grantorId: string; granteeId: string; scope: string; expiresAt: Date | null }) => ({
      id: row.id,
      grantor: row.grantorId,
      grantee: row.granteeId,
      scope: row.scope,
      expiresAt: row.expiresAt,
    }));
  }

  async saveDelegationRule(rule: DelegationRule): Promise<void> {
    await this.prisma.delegationRule.upsert({
      where: { id: rule.id },
      create: {
        id: rule.id,
        grantor: { connect: { id: rule.grantor } },
        grantee: { connect: { id: rule.grantee } },
        scope: rule.scope,
        expiresAt: rule.expiresAt,
      },
      update: {
        grantor: { connect: { id: rule.grantor } },
        grantee: { connect: { id: rule.grantee } },
        scope: rule.scope,
        expiresAt: rule.expiresAt,
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
  delegatedApprovers: string[];
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
    delegatedApprovers: row.delegatedApprovers ?? [],
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
