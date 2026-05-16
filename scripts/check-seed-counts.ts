#!/usr/bin/env tsx
/**
 * Verifies that `org_dev` has enough domain data for live-mode surfaces.
 * State machine (three exit behaviors, four sub-states):
 *   - PASS              DB reachable, all minimums met               → exit 0
 *   - FAIL              DB reachable, at least one minimum unmet     → exit 1
 *   - SKIP-NO-URL       DATABASE_URL not set                         → exit 0 (or 1 with --strict-db)
 *   - SKIP-UNREACHABLE  DATABASE_URL set, DB not reachable           → exit 0 (or 1 with --strict-db)
 *
 * `--strict-db` flag turns either SKIP state into a hard failure with a
 * loud recovery hint. `local:verify:fast` invokes with `--strict-db` so a
 * pre-bootstrap clone fails the local pre-flight instead of silently
 * passing. CI's setup job invokes without the flag (CI configures DB
 * before this check, so SKIP cannot legitimately fire there).
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

export type SeedCountState = "PASS" | "FAIL" | "SKIP-NO-URL" | "SKIP-UNREACHABLE";

export interface SeedCountResult {
  state: SeedCountState;
  counts: Partial<Record<keyof typeof MINIMUMS, number>>;
  unmet: Array<{ key: keyof typeof MINIMUMS; expected: number; actual: number }>;
  unreachableReason?: string; // present only when state === "SKIP-UNREACHABLE"
}

export async function auditSeedCounts(): Promise<SeedCountResult> {
  if (!process.env["DATABASE_URL"]) {
    return { state: "SKIP-NO-URL", counts: {}, unmet: [] };
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
    return { state: unmet.length ? "FAIL" : "PASS", counts, unmet };
  } catch (err) {
    return {
      state: "SKIP-UNREACHABLE",
      counts: {},
      unmet: [],
      unreachableReason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await prisma.$disconnect();
  }
}

/* eslint-disable no-console */
const SKIP_BANNER = `
================================================================
⚠  SEED-COUNT CHECK SKIPPED
   DATABASE_URL is %REASON%.
   The local dashboard will render empty surfaces until the DB
   is configured and seeded. To recover:
     1. Start Postgres (e.g. \`docker compose up postgres -d\`).
     2. Run \`pnpm local:setup\` (or \`pnpm db:migrate && pnpm db:seed\`).
================================================================
`;

const STRICT_HINT = `
✗ DATABASE_URL missing or DB unreachable.
  Start Postgres and run \`pnpm local:setup\`,
  or run \`pnpm db:migrate && pnpm db:seed\` directly.
`;

export interface RunMainOptions {
  strictDb: boolean;
  _auditFn?: () => Promise<SeedCountResult>;
}

export async function runMain(opts: RunMainOptions): Promise<void> {
  const audit = opts._auditFn ?? auditSeedCounts;
  const result = await audit();

  if (result.state === "PASS") {
    console.log("✓ seed counts meet minimums");
    for (const [k, v] of Object.entries(result.counts)) {
      console.log(`    ${k}: ${v}`);
    }
    process.exit(0);
  }

  if (result.state === "FAIL") {
    console.log("✗ seed counts below local-readiness minimums:");
    for (const u of result.unmet) {
      console.log(`    ${u.key}: expected ≥${u.expected}, actual ${u.actual}`);
    }
    process.exit(1);
  }

  // SKIP-NO-URL or SKIP-UNREACHABLE
  const reason =
    result.state === "SKIP-NO-URL"
      ? "not set"
      : `set but DB is unreachable${result.unreachableReason ? `: ${result.unreachableReason}` : ""}`;
  process.stderr.write(SKIP_BANNER.replace("%REASON%", reason));
  if (opts.strictDb) {
    process.stderr.write(STRICT_HINT);
    process.exit(1);
  }
  process.exit(0);
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const strictDb = process.argv.includes("--strict-db");
  void runMain({ strictDb });
}
