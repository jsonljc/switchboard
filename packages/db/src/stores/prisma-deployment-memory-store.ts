import { StaleVersionError } from "@switchboard/core";
import type { DeploymentMemorySource } from "@switchboard/schemas";
import type { PrismaDbClient } from "../prisma-db.js";

export interface CreateDeploymentMemoryInput {
  organizationId: string;
  deploymentId: string;
  category: string;
  content: string;
  confidence?: number;
  canonicalKey?: string | null;
  source?: DeploymentMemorySource | null;
}

export class PrismaDeploymentMemoryStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateDeploymentMemoryInput) {
    const now = new Date();
    const data = {
      organizationId: input.organizationId,
      deploymentId: input.deploymentId,
      category: input.category,
      content: input.content,
      canonicalKey: input.canonicalKey ?? null,
      confidence: input.confidence ?? 0.5,
      sourceCount: 1,
      lastSeenAt: now,
      source: input.source ?? null,
      validFrom: now,
    };
    try {
      return await this.prisma.deploymentMemory.create({ data });
    } catch (err) {
      // The unique is on CONTENT (org, deployment, category, content). With
      // invalidate-not-delete, an evicted/decayed row physically remains and
      // blocks re-creating the same content (P2002). Deterministic resolution:
      // if the colliding row is INVALIDATED, resurrect it (a fresh assertion
      // supersedes the tombstone, taking the NEW write's canonicalKey/confidence/
      // source); if it is LIVE, rethrow so the caller's existing duplicate
      // handling runs unchanged (the taste/revenue_proven crons + the pattern
      // P2002 recovery only ever collide with LIVE rows, so they are unaffected).
      if (!isPrismaUniqueConstraintError(err)) throw err;
      const colliding = await this.prisma.deploymentMemory.findFirst({
        where: {
          organizationId: input.organizationId,
          deploymentId: input.deploymentId,
          category: input.category,
          content: input.content,
        },
      });
      if (!colliding || colliding.invalidatedAt === null) throw err;
      return this.prisma.deploymentMemory.update({
        where: { id: colliding.id },
        data: {
          invalidatedAt: null,
          validTo: null,
          validFrom: now,
          lastDecayedAt: null,
          confidence: input.confidence ?? 0.5,
          sourceCount: 1,
          lastSeenAt: now,
          canonicalKey: input.canonicalKey ?? null,
          source: input.source ?? null,
        },
      });
    }
  }

  async incrementConfidence(organizationId: string, id: string, newConfidence: number) {
    const result = await this.prisma.deploymentMemory.updateMany({
      where: { id, organizationId },
      data: {
        sourceCount: { increment: 1 },
        confidence: newConfidence,
        lastSeenAt: new Date(),
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    return this.prisma.deploymentMemory.findFirstOrThrow({
      where: { id, organizationId },
    }) as Promise<{
      id: string;
      sourceCount: number;
    }>;
  }

  async listByDeployment(organizationId: string, deploymentId: string) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId, invalidatedAt: null },
      orderBy: { confidence: "desc" },
    });
  }

  async listHighConfidence(
    organizationId: string,
    deploymentId: string,
    minConfidence: number,
    minSourceCount: number,
  ) {
    return this.prisma.deploymentMemory.findMany({
      where: {
        organizationId,
        deploymentId,
        confidence: { gte: minConfidence },
        sourceCount: { gte: minSourceCount },
        invalidatedAt: null,
      },
      orderBy: { confidence: "desc" },
    });
  }

  async findByCategory(organizationId: string, deploymentId: string, category: string) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId, category, invalidatedAt: null },
    });
  }

  async findByCategoryAndCanonicalKey(
    organizationId: string,
    deploymentId: string,
    category: string,
    canonicalKey: string,
  ) {
    return this.prisma.deploymentMemory.findMany({
      where: { organizationId, deploymentId, category, canonicalKey, invalidatedAt: null },
    });
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const result = await this.prisma.deploymentMemory.deleteMany({
      where: { id, organizationId },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  async invalidate(organizationId: string, id: string): Promise<void> {
    const now = new Date();
    const result = await this.prisma.deploymentMemory.updateMany({
      where: { id, organizationId, invalidatedAt: null },
      data: { invalidatedAt: now, validTo: now },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  async countByDeployment(organizationId: string, deploymentId: string): Promise<number> {
    return this.prisma.deploymentMemory.count({
      where: { organizationId, deploymentId, invalidatedAt: null },
    });
  }

  async findEvictionCandidate(
    organizationId: string,
    deploymentId: string,
  ): Promise<{ id: string; confidence: number } | null> {
    // Lowest confidence wins; ties broken by oldest lastSeenAt (LRU).
    return this.prisma.deploymentMemory.findFirst({
      where: { organizationId, deploymentId, invalidatedAt: null },
      orderBy: [{ confidence: "asc" }, { lastSeenAt: "asc" }],
      select: { id: true, confidence: true },
    });
  }

  async decayStale(input: {
    cutoffDate: Date;
    decayAmount: number;
    floor: number;
    startOfDay: Date;
  }): Promise<number> {
    // route-governance: store-mutation-global — cross-org confidence decay batch.
    // Pass 1: decrement live, stale, above-floor rows (idempotent per UTC day via
    // the lastDecayedAt guard). invalidatedAt:null skips already soft-removed rows.
    const decremented = await this.prisma.deploymentMemory.updateMany({
      where: {
        lastSeenAt: { lt: input.cutoffDate },
        confidence: { gt: input.floor },
        invalidatedAt: null,
        OR: [{ lastDecayedAt: null }, { lastDecayedAt: { lt: input.startOfDay } }],
      },
      data: {
        confidence: { decrement: input.decayAmount },
        lastDecayedAt: new Date(),
      },
    });
    // Pass 2: invalidate-not-delete. A STALE row that has decayed to/below the
    // floor is spent; soft-remove it (frees a cap slot, preserves history) rather
    // than leaving a zombie. lastSeenAt < cutoffDate is SAFETY-CRITICAL here: it is
    // the only thing scoping decay, so omitting it would wrongly invalidate a
    // recently-seen low-confidence row. We deliberately do NOT carry pass-1's
    // lastDecayedAt OR-guard: invalidatedAt:null already makes this idempotent, and
    // the guard would defer invalidating a row decremented-to-floor THIS run by a
    // full cycle.
    const now = new Date();
    await this.prisma.deploymentMemory.updateMany({
      where: {
        lastSeenAt: { lt: input.cutoffDate },
        confidence: { lte: input.floor },
        invalidatedAt: null,
      },
      data: { invalidatedAt: now, validTo: now },
    });
    // Return the DECREMENTED count to preserve the existing outcomePatternsDecayed
    // metric's meaning (rows decayed this run). Invalidations are a side effect.
    return decremented.count;
  }
}

/** P2002 (unique-constraint) classifier — matches Prisma's error code, not its message. */
function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
