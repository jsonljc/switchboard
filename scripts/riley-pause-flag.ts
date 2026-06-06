// Auditable per-org toggle for Phase-C pause self-execution. Capability
// assignment, not config: every flip writes one chain-hashed AuditLedger row.
// ROLLOUT RULE: no production org flips ON until strict-truth riley_self
// ownership (PR-3 of the pause wiring) is merged and verified.
//
// Usage: npx tsx scripts/riley-pause-flag.ts <orgId> --enable|--disable --actor <who>
import { PrismaClient } from "@prisma/client";
import { setRileyPauseSelfExecution, PrismaLedgerStorage } from "@switchboard/db";
import { AuditLedger } from "@switchboard/core";

const [orgId, mode, actorFlag, actor] = process.argv.slice(2);
if (
  !orgId ||
  !["--enable", "--disable"].includes(mode ?? "") ||
  actorFlag !== "--actor" ||
  !actor
) {
  console.error(
    "usage: npx tsx scripts/riley-pause-flag.ts <orgId> --enable|--disable --actor <who>",
  );
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const ledger = new AuditLedger(new PrismaLedgerStorage(prisma));
  const result = await setRileyPauseSelfExecution(prisma, ledger, {
    organizationId: orgId,
    enabled: mode === "--enable",
    actor,
  });
  console.warn(
    `[riley-pause-flag] org=${orgId} pauseSelfExecutionEnabled ${result.previous} -> ${result.current} (audit row written by ${actor})`,
  );
} finally {
  await prisma.$disconnect();
}
