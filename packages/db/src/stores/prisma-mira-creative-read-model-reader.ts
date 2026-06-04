import type { PrismaDbClient } from "../prisma-db.js";
import type { CreativeJob } from "@switchboard/schemas";
import {
  buildMiraCreativeReadModel,
  buildWeekContext,
  type MiraCreativeJobSummary,
  type MiraCreativeReadModel,
  type MiraCreativeReadModelReader,
} from "@switchboard/core";

// M1 pilot scale: fetch the org's recent creative jobs and compute the model in
// memory (status derivation needs JSON introspection that is awkward as a SQL
// WHERE). Cap defends against pathological orgs. NOTE: counts (incl. `total`)
// reflect ONLY this fetched window — they are cockpit summary counts, NOT
// reporting/billing metrics. An org with >FETCH_CAP jobs under-counts; that is
// acceptable for M1 pilot scale and revisited (truncated flag / reporting query)
// in a later phase.
const FETCH_CAP = 200;

export class PrismaMiraCreativeReadModelReader implements MiraCreativeReadModelReader {
  constructor(private prisma: PrismaDbClient) {}

  async read(
    orgId: string,
    opts: { now: Date; timezone: string; visibleLimit?: number },
  ): Promise<MiraCreativeReadModel> {
    const rows = (await this.prisma.creativeJob.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: FETCH_CAP,
    })) as unknown as CreativeJob[];

    const week = buildWeekContext(opts.now, opts.timezone);
    return buildMiraCreativeReadModel(rows, {
      now: opts.now,
      weekStart: week.weekStart,
      prevWeekStart: week.prevWeekStart,
      ...(opts.visibleLimit !== undefined ? { visibleLimit: opts.visibleLimit } : {}),
    });
  }

  /**
   * Single-job summary for ids outside the feed window: FETCH_CAP most-recent
   * ages out exactly the published creatives old enough to have earned
   * something (slice 2). Org-scoped findFirst (cross-org ids resolve null,
   * route maps that to 404), built through the same mapper as read() so the
   * summary shape stays identical.
   */
  async readOne(
    orgId: string,
    id: string,
    opts: { now: Date; timezone: string },
  ): Promise<MiraCreativeJobSummary | null> {
    const row = (await this.prisma.creativeJob.findFirst({
      where: { id, organizationId: orgId },
    })) as unknown as CreativeJob | null;
    if (!row) return null;
    const week = buildWeekContext(opts.now, opts.timezone);
    const rm = buildMiraCreativeReadModel([row], {
      now: opts.now,
      weekStart: week.weekStart,
      prevWeekStart: week.prevWeekStart,
      visibleLimit: 1,
    });
    return rm.jobs[0] ?? null;
  }
}
