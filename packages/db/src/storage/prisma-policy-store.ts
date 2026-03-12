import type { PrismaClient } from "@prisma/client";
import type { Policy } from "@switchboard/schemas";
import type { PolicyStore } from "@switchboard/core";

export interface PrismaPolicyStoreOptions {
  redis?: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, mode: string, ttl: number) => Promise<unknown>;
    del: (key: string) => Promise<unknown>;
  };
  cacheTtlSeconds?: number;
}

const CACHE_PREFIX = "switchboard:policies:";

export class PrismaPolicyStore implements PolicyStore {
  private redis?: PrismaPolicyStoreOptions["redis"];
  private cacheTtlSeconds: number;
  private knownCacheKeys = new Set<string>();

  constructor(
    private prisma: PrismaClient,
    options?: PrismaPolicyStoreOptions,
  ) {
    this.redis = options?.redis;
    this.cacheTtlSeconds = options?.cacheTtlSeconds ?? 60;
  }

  private cacheKey(filter?: { cartridgeId?: string; organizationId?: string | null }): string {
    const cartridge = filter?.cartridgeId ?? "all";
    const org = filter?.organizationId ?? "global";
    return `${CACHE_PREFIX}${cartridge}:${org}`;
  }

  private async invalidateCache(): Promise<void> {
    if (!this.redis) return;
    // Delete all tracked cache keys
    const keysToDelete = [...this.knownCacheKeys];
    this.knownCacheKeys.clear();
    for (const key of keysToDelete) {
      try {
        await this.redis.del(key);
      } catch {
        // Cache invalidation failure is non-fatal
      }
    }
  }

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
        effectParams: (policy.effectParams as object) ?? undefined,
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
        effectParams: (policy.effectParams as object) ?? undefined,
        approvalRequirement: policy.approvalRequirement ?? null,
        riskCategoryOverride: policy.riskCategoryOverride ?? null,
        updatedAt: policy.updatedAt,
      },
    });
    await this.invalidateCache();
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
    if (data.approvalRequirement !== undefined)
      updateData["approvalRequirement"] = data.approvalRequirement;
    if (data.riskCategoryOverride !== undefined)
      updateData["riskCategoryOverride"] = data.riskCategoryOverride;

    await this.prisma.policy.update({ where: { id }, data: updateData });
    await this.invalidateCache();
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.policy.delete({ where: { id } });
      await this.invalidateCache();
      return true;
    } catch {
      return false;
    }
  }

  async listActive(filter?: {
    cartridgeId?: string;
    organizationId?: string | null;
  }): Promise<Policy[]> {
    // Check Redis cache first
    if (this.redis) {
      try {
        const key = this.cacheKey(filter);
        const cached = await this.redis.get(key);
        if (cached) {
          const parsed = JSON.parse(cached) as Array<Record<string, unknown>>;
          return parsed.map((row) => ({
            ...row,
            createdAt: new Date(row["createdAt"] as string),
            updatedAt: new Date(row["updatedAt"] as string),
          })) as Policy[];
        }
      } catch {
        // Cache miss or error — fall through to DB
      }
    }

    const where: Record<string, unknown> = { active: true };

    if (filter?.cartridgeId) {
      where["OR"] = [{ cartridgeId: null }, { cartridgeId: filter.cartridgeId }];
    }

    // Scope to global policies + org-specific policies when org is provided
    if (filter?.organizationId !== undefined) {
      const orgCondition = [{ organizationId: null }, { organizationId: filter.organizationId }];
      if (where["OR"]) {
        // Combine with existing cartridgeId OR using AND
        const cartridgeOr = where["OR"];
        delete where["OR"];
        where["AND"] = [{ OR: cartridgeOr }, { OR: orgCondition }];
      } else {
        where["OR"] = orgCondition;
      }
    }

    const rows = await this.prisma.policy.findMany({
      where,
      orderBy: { priority: "asc" },
    });

    const results = rows.map(toPolicy);

    // Store in Redis cache
    if (this.redis) {
      try {
        const key = this.cacheKey(filter);
        await this.redis.set(key, JSON.stringify(results), "EX", this.cacheTtlSeconds);
        this.knownCacheKeys.add(key);
      } catch {
        // Cache write failure is non-fatal
      }
    }

    return results;
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
