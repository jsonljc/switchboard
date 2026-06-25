import { describe, it, expect, vi } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { AuditLedger, InMemoryLedgerStorage, NoopOperatorAlerter } from "@switchboard/core";

// EV-2 / SPINE-2: findStuckRunning is the bounded scan the stranded-claim reaper runs.
// It must target ONLY keyed `running` ingress claims older than the cutoff — never the
// keyless `running` rows that conversation/lifecycle turns persist (which would break
// live conversations if reaped).
function makeStore(findMany: ReturnType<typeof vi.fn>): PrismaWorkTraceStore {
  const prisma = { workTrace: { findMany }, $transaction: vi.fn() };
  return new PrismaWorkTraceStore(prisma as never, {
    auditLedger: new AuditLedger(new InMemoryLedgerStorage()),
    operatorAlerter: new NoopOperatorAlerter(),
  });
}

describe("PrismaWorkTraceStore.findStuckRunning", () => {
  it("scans only KEYED running claims older than the cutoff, oldest-first, bounded by limit", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const store = makeStore(findMany);
    const olderThan = new Date("2026-06-25T11:30:00.000Z");

    await store.findStuckRunning(olderThan, 250);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        outcome: "running",
        // idempotencyKey IS NOT NULL excludes keyless conversation/lifecycle running rows.
        idempotencyKey: { not: null },
        executionStartedAt: { lt: olderThan },
      },
      orderBy: { executionStartedAt: "asc" },
      take: 250,
      select: {
        workUnitId: true,
        organizationId: true,
        idempotencyKey: true,
        intent: true,
        traceId: true,
        executionStartedAt: true,
      },
    });
  });

  it("maps rows to StrandedRunningClaim with executionStartedAt as an ISO string", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        workUnitId: "wu_a",
        organizationId: "org_1",
        idempotencyKey: "pay:org_1:wk26",
        intent: "payment.record_verified",
        traceId: "tr_a",
        executionStartedAt: new Date("2026-06-25T11:00:00.000Z"),
      },
    ]);
    const store = makeStore(findMany);

    const out = await store.findStuckRunning(new Date("2026-06-25T11:30:00.000Z"), 500);

    expect(out).toEqual([
      {
        workUnitId: "wu_a",
        organizationId: "org_1",
        idempotencyKey: "pay:org_1:wk26",
        intent: "payment.record_verified",
        traceId: "tr_a",
        executionStartedAt: "2026-06-25T11:00:00.000Z",
      },
    ]);
  });

  it("coerces a null executionStartedAt to null (defensive; keyed claims normally set it)", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        workUnitId: "wu_b",
        organizationId: "org_2",
        idempotencyKey: "k_b",
        intent: "revenue.record",
        traceId: "tr_b",
        executionStartedAt: null,
      },
    ]);
    const store = makeStore(findMany);

    const out = await store.findStuckRunning(new Date(), 500);

    expect(out[0]!.executionStartedAt).toBeNull();
  });
});
