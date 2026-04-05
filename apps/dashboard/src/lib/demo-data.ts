import { getDb, PrismaListingStore } from "@switchboard/db";

const DEMO_ORG_ID = "org_demo";

// ── Local Types (matching Prisma shapes) ──

export interface MarketplaceListing {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: string;
  status: string;
  taskCategories: string[];
  trustScore: number;
  autonomyLevel: string;
  priceTier: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DemoTask {
  id: string;
  listingId: string;
  category: string;
  status: string;
  output: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface TrustRecord {
  id: string;
  listingId: string;
  taskCategory: string;
  score: number;
  totalApprovals: number;
  totalRejections: number;
  consecutiveApprovals: number;
  lastActivityAt: Date | null;
}

// ── Helper Functions ──

function isBundle(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  return (metadata as Record<string, unknown>).isBundle === true;
}

// ── Public API ──

/**
 * Fetch all listed agents (excluding bundles), ordered by creation date.
 */
export async function getListedAgents(): Promise<MarketplaceListing[]> {
  const db = getDb();
  const listings = await db.agentListing.findMany({
    where: { status: "listed" },
    orderBy: { createdAt: "asc" },
  });

  return listings
    .filter((listing) => !isBundle(listing.metadata))
    .map((listing) => ({
      id: listing.id,
      name: listing.name,
      slug: listing.slug,
      description: listing.description,
      type: listing.type,
      status: listing.status,
      taskCategories: listing.taskCategories,
      trustScore: listing.trustScore,
      autonomyLevel: listing.autonomyLevel,
      priceTier: listing.priceTier,
      metadata: listing.metadata as Record<string, unknown> | null,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
    }));
}

/**
 * Fetch all bundle listings (status: listed OR pending_review), ordered by creation date.
 */
export async function getBundleListings(): Promise<MarketplaceListing[]> {
  const db = getDb();
  const listings = await db.agentListing.findMany({
    where: {
      status: { in: ["listed", "pending_review"] },
    },
    orderBy: { createdAt: "asc" },
  });

  return listings
    .filter((listing) => isBundle(listing.metadata))
    .map((listing) => ({
      id: listing.id,
      name: listing.name,
      slug: listing.slug,
      description: listing.description,
      type: listing.type,
      status: listing.status,
      taskCategories: listing.taskCategories,
      trustScore: listing.trustScore,
      autonomyLevel: listing.autonomyLevel,
      priceTier: listing.priceTier,
      metadata: listing.metadata as Record<string, unknown> | null,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
    }));
}

/**
 * Fetch a single listing by slug (via PrismaListingStore).
 */
export async function getListingBySlug(slug: string): Promise<MarketplaceListing | null> {
  const db = getDb();
  const store = new PrismaListingStore(db);
  const listing = await store.findBySlug(slug);

  if (!listing) return null;

  return {
    id: listing.id,
    name: listing.name,
    slug: listing.slug,
    description: listing.description,
    type: listing.type,
    status: listing.status,
    taskCategories: listing.taskCategories,
    trustScore: listing.trustScore,
    autonomyLevel: listing.autonomyLevel,
    priceTier: listing.priceTier,
    metadata: listing.metadata as Record<string, unknown> | null,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

/**
 * Fetch demo tasks for a listing (limited to DEMO_ORG_ID).
 */
export async function getDemoTasks(listingId: string, limit = 20): Promise<DemoTask[]> {
  const db = getDb();
  const tasks = await db.agentTask.findMany({
    where: {
      listingId,
      organizationId: DEMO_ORG_ID,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return tasks.map((task) => ({
    id: task.id,
    listingId: task.listingId,
    category: task.category,
    status: task.status,
    output: task.output as Record<string, unknown> | null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  }));
}

/**
 * Compute demo task statistics for a listing.
 */
export async function getDemoTaskStats(listingId: string): Promise<{
  totalTasks: number;
  approvedCount: number;
  approvalRate: number;
  lastActiveAt: Date | null;
}> {
  const db = getDb();
  const tasks = await db.agentTask.findMany({
    where: {
      listingId,
      organizationId: DEMO_ORG_ID,
    },
    orderBy: { updatedAt: "desc" },
  });

  const totalTasks = tasks.length;
  const approvedCount = tasks.filter((task) => task.status === "approved").length;
  const approvalRate = totalTasks > 0 ? Math.round((approvedCount / totalTasks) * 100) : 0;
  const lastActiveAt = tasks.length > 0 ? tasks[0].updatedAt : null;

  return {
    totalTasks,
    approvedCount,
    approvalRate,
    lastActiveAt,
  };
}

/**
 * Fetch trust score records for a listing, ordered by score descending.
 */
export async function getTrustRecords(listingId: string): Promise<TrustRecord[]> {
  const db = getDb();
  const records = await db.trustScoreRecord.findMany({
    where: { listingId },
    orderBy: { score: "desc" },
  });

  return records.map((record) => ({
    id: record.id,
    listingId: record.listingId,
    taskCategory: record.taskCategory,
    score: record.score,
    totalApprovals: record.totalApprovals,
    totalRejections: record.totalRejections,
    consecutiveApprovals: record.consecutiveApprovals,
    lastActivityAt: record.lastActivityAt,
  }));
}

/**
 * Compute trust score progression over time for a listing.
 * Trust mechanics: start at 0, approval +3 (with streak bonus capped at +2), rejection -10.
 */
export async function getTrustProgression(
  listingId: string,
): Promise<Array<{ timestamp: string; score: number }>> {
  const db = getDb();
  const tasks = await db.agentTask.findMany({
    where: {
      listingId,
      organizationId: DEMO_ORG_ID,
      status: { in: ["approved", "rejected"] },
      completedAt: { not: null },
    },
    orderBy: { completedAt: "asc" },
  });

  let score = 0;
  let streak = 0;
  const progression: Array<{ timestamp: string; score: number }> = [];

  for (const task of tasks) {
    if (task.status === "approved") {
      streak += 1;
      const streakBonus = Math.min(streak - 1, 2);
      score = Math.min(score + 3 + streakBonus, 100);
    } else if (task.status === "rejected") {
      streak = 0;
      score = Math.max(score - 10, 0);
    }

    progression.push({
      timestamp: task.completedAt!.toISOString(),
      score,
    });
  }

  return progression;
}
