// ---------------------------------------------------------------------------
// SLA Check Job — scans all orgs for breached handoff SLAs
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@switchboard/db";

export interface BreachedHandoff {
  id: string;
  organizationId: string;
  sessionId: string;
  slaDeadlineAt: Date;
  status: string;
}

/**
 * Scans all organizations with pending handoffs and invokes onBreach
 * for any that have passed their SLA deadline.
 *
 * Designed to be called from a setInterval or BullMQ repeatable job.
 */
export async function checkAllOrgBreaches(
  prisma: PrismaClient,
  onBreach: (handoff: BreachedHandoff) => Promise<void>,
): Promise<number> {
  // Find distinct orgs with pending handoffs
  const rows = await prisma.handoff.findMany({
    where: { status: "pending" },
    select: { organizationId: true },
  });

  const orgIds = [...new Set(rows.map((r: { organizationId: string }) => r.organizationId))];
  const now = new Date();
  let breachCount = 0;

  for (const orgId of orgIds) {
    const pendingHandoffs = await prisma.handoff.findMany({
      where: { organizationId: orgId, status: "pending" },
    });

    for (const h of pendingHandoffs) {
      if (h.slaDeadlineAt <= now) {
        breachCount++;
        await onBreach({
          id: h.id,
          organizationId: h.organizationId,
          sessionId: h.sessionId,
          slaDeadlineAt: h.slaDeadlineAt,
          status: h.status,
        });
      }
    }
  }

  return breachCount;
}

const DEFAULT_CHECK_INTERVAL_MS = 60_000; // 1 minute

export function startSlaCheckInterval(
  prisma: PrismaClient,
  onBreach: (handoff: BreachedHandoff) => Promise<void>,
  intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
): { stop: () => void } {
  const timer = setInterval(() => {
    checkAllOrgBreaches(prisma, onBreach).catch((err) =>
      console.error("[sla-check] Error checking SLA breaches:", err),
    );
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}
