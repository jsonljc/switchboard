#!/usr/bin/env tsx
/**
 * Verifies that `org_dev` has enough domain data for live-mode surfaces
 * to render non-empty. Skips gracefully (exit 0 with a warning) if no
 * DATABASE_URL is configured or the DB is unreachable.
 */
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

const ORG_ID = "org_dev";
const MINIMUMS = {
  org: 1,
  agents: 2,
  contacts: 5,
  opportunities: 5,
  auditEntries: 15,
  approvalRecords: 2,
  scheduledTriggers: 1,
} as const;

export interface SeedCountResult {
  skipped: boolean;
  counts: Partial<Record<keyof typeof MINIMUMS, number>>;
  unmet: Array<{ key: keyof typeof MINIMUMS; expected: number; actual: number }>;
}

export async function auditSeedCounts(): Promise<SeedCountResult> {
  if (!process.env["DATABASE_URL"]) {
    return { skipped: true, counts: {}, unmet: [] };
  }
  const prisma = new PrismaClient();
  try {
    const counts = {
      org: await prisma.organizationConfig.count({ where: { id: ORG_ID } }),
      agents: await prisma.agentRoster.count({ where: { organizationId: ORG_ID } }),
      contacts: await prisma.contact.count({ where: { organizationId: ORG_ID } }),
      opportunities: await prisma.opportunity.count({ where: { organizationId: ORG_ID } }),
      auditEntries: await prisma.auditEntry.count({ where: { organizationId: ORG_ID } }),
      approvalRecords: await prisma.approvalRecord.count({ where: { organizationId: ORG_ID } }),
      scheduledTriggers: await prisma.scheduledTriggerRecord.count({
        where: { organizationId: ORG_ID },
      }),
    };
    const unmet = (Object.keys(MINIMUMS) as Array<keyof typeof MINIMUMS>)
      .filter((k) => counts[k] < MINIMUMS[k])
      .map((k) => ({ key: k, expected: MINIMUMS[k], actual: counts[k] }));
    return { skipped: false, counts, unmet };
  } catch (err) {
    console.warn(`[seed-counts] DB unreachable: ${(err as Error).message}`); // eslint-disable-line no-console
    return { skipped: true, counts: {}, unmet: [] };
  } finally {
    await prisma.$disconnect();
  }
}

/* eslint-disable no-console */
async function main(): Promise<void> {
  const result = await auditSeedCounts();
  if (result.skipped) {
    console.log("⚠ skipping seed-count check (no DB reachable)");
    process.exit(0);
  }
  if (result.unmet.length) {
    console.log("✗ seed counts below local-readiness minimums:");
    for (const u of result.unmet) {
      console.log(`    ${u.key}: expected ≥${u.expected}, actual ${u.actual}`);
    }
    process.exit(1);
  }
  console.log("✓ seed counts meet minimums");
  for (const [k, v] of Object.entries(result.counts)) {
    console.log(`    ${k}: ${v}`);
  }
  process.exit(0);
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
