// Runtime in-flight kill-switch for Riley budget-reallocation self-execution
// (governanceSettings.reallocateKillSwitch on the org's Riley deployment). Flip ON to halt in-flight
// + future reallocate execution for an org WITHOUT a redeploy; OFF to re-arm. Capability assignment,
// not config: every flip writes one chain-hashed AuditLedger row.
//
// Usage: npx tsx scripts/riley-reallocate-kill-switch.ts <orgId> --enable|--disable --actor <who>
import { PrismaClient } from "@prisma/client";
import { setRileyReallocateKillSwitch, PrismaLedgerStorage } from "@switchboard/db";
import { AuditLedger } from "@switchboard/core";

const [orgId, mode, actorFlag, actor] = process.argv.slice(2);
if (
  !orgId ||
  !["--enable", "--disable"].includes(mode ?? "") ||
  actorFlag !== "--actor" ||
  !actor
) {
  console.error(
    "usage: npx tsx scripts/riley-reallocate-kill-switch.ts <orgId> --enable|--disable --actor <who>",
  );
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const ledger = new AuditLedger(new PrismaLedgerStorage(prisma));
  const result = await setRileyReallocateKillSwitch(prisma, ledger, {
    organizationId: orgId,
    enabled: mode === "--enable",
    actor,
  });
  console.warn(
    `[riley-reallocate-kill-switch] org=${orgId} reallocateKillSwitch ${result.previous} -> ${result.current} (audit row written by ${actor})`,
  );
} finally {
  await prisma.$disconnect();
}
