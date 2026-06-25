// Per-org CANARY enable flag for Riley budget-reallocation self-execution
// (governanceSettings.reallocateSelfExecutionEnabled on the org's Riley deployment). Flip ON to let
// the reallocate submitter emit for ONE canary org. Capability assignment, not config: every flip
// writes one chain-hashed AuditLedger row.
//
// ROLLOUT RULE: do NOT enable for any production org until the full
// docs/runbooks/riley-reallocation-go-live.md gate is satisfied AND exercised (the env kill switch
// RILEY_REALLOCATE_SELF_EXECUTION_ENABLED must ALSO be on for the flip to take effect).
//
// Usage: npx tsx scripts/riley-reallocate-flag.ts <orgId> --enable|--disable --actor <who>
import { PrismaClient } from "@prisma/client";
import { setRileyReallocateSelfExecution, PrismaLedgerStorage } from "@switchboard/db";
import { AuditLedger } from "@switchboard/core";

const [orgId, mode, actorFlag, actor] = process.argv.slice(2);
if (
  !orgId ||
  !["--enable", "--disable"].includes(mode ?? "") ||
  actorFlag !== "--actor" ||
  !actor
) {
  console.error(
    "usage: npx tsx scripts/riley-reallocate-flag.ts <orgId> --enable|--disable --actor <who>",
  );
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const ledger = new AuditLedger(new PrismaLedgerStorage(prisma));
  const result = await setRileyReallocateSelfExecution(prisma, ledger, {
    organizationId: orgId,
    enabled: mode === "--enable",
    actor,
  });
  console.warn(
    `[riley-reallocate-flag] org=${orgId} reallocateSelfExecutionEnabled ${result.previous} -> ${result.current} (audit row written by ${actor})`,
  );
} finally {
  await prisma.$disconnect();
}
