import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { PrismaLedgerStorage } from "../../storage/prisma-ledger-storage.js";
import { AuditLedger, NoopOperatorAlerter } from "@switchboard/core";
import { WORK_TRACE_INTEGRITY_CUTOFF_AT } from "../../integrity-cutoff.js";
import type { WorkTrace } from "@switchboard/core/platform";

const SKIP = !process.env.DATABASE_URL;

function makeTrace(overrides: Partial<WorkTrace> = {}): WorkTrace {
  return {
    workUnitId: `wu_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    traceId: "tr_int_1",
    intent: "digital-ads.pause",
    mode: "cartridge",
    organizationId: "org_int",
    actor: { id: "user_int", type: "user" },
    trigger: "api",
    governanceOutcome: "execute",
    riskScore: 10,
    matchedPolicies: ["P_INT"],
    outcome: "completed",
    durationMs: 100,
    requestedAt: new Date().toISOString(),
    governanceCompletedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe.skipIf(SKIP)("PrismaWorkTraceStore — integrity (Postgres)", () => {
  const prisma = new PrismaClient();
  let store: PrismaWorkTraceStore;
  let ledger: AuditLedger;

  beforeAll(async () => {
    ledger = new AuditLedger(new PrismaLedgerStorage(prisma));
    store = new PrismaWorkTraceStore(prisma, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("persist writes WorkTrace + paired anchor at v1", async () => {
    const t = makeTrace();
    await store.persist(t);

    const row = await prisma.workTrace.findUnique({ where: { workUnitId: t.workUnitId } });
    expect(row?.contentHash).toBeTruthy();
    expect(row?.traceVersion).toBe(1);

    const anchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: t.workUnitId,
      eventType: "work_trace.persisted",
      traceVersion: 1,
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.snapshot["contentHash"]).toBe(row!.contentHash);
    expect(anchor!.snapshot["traceVersion"]).toBe(1);
    expect(anchor!.snapshot["hashAlgorithm"]).toBe("sha256");
  });

  it("getByWorkUnitId on freshly-persisted trace returns ok", async () => {
    const t = makeTrace();
    await store.persist(t);
    const result = await store.getByWorkUnitId(t.workUnitId);
    expect(result).not.toBeNull();
    expect(result?.integrity.status).toBe("ok");
    expect(result?.trace.workUnitId).toBe(t.workUnitId);
  });

  it("tampering with executionOutputs is detected as mismatch", async () => {
    const t = makeTrace();
    await store.persist(t);
    await prisma.workTrace.update({
      where: { workUnitId: t.workUnitId },
      data: { executionOutputs: JSON.stringify({ tampered: true }) },
    });
    const result = await store.getByWorkUnitId(t.workUnitId);
    expect(result?.integrity.status).toBe("mismatch");
  });

  it("deleting the anchor surfaces missing_anchor", async () => {
    const t = makeTrace();
    await store.persist(t);
    // Delete only the work_trace.persisted anchor for this workUnitId
    await prisma.auditEntry.deleteMany({
      where: {
        entityType: "work_trace",
        entityId: t.workUnitId,
        eventType: "work_trace.persisted",
      },
    });
    const result = await store.getByWorkUnitId(t.workUnitId);
    expect(result?.integrity.status).toBe("missing_anchor");
  });

  it("post-cutoff row with traceVersion=0 returns missing_anchor (invariant guard)", async () => {
    const t = makeTrace();
    await store.persist(t);
    await prisma.workTrace.update({
      where: { workUnitId: t.workUnitId },
      data: { traceVersion: 0 },
    });
    const result = await store.getByWorkUnitId(t.workUnitId);
    expect(result?.integrity.status).toBe("missing_anchor");
  });

  it("update bumps traceVersion and writes paired anchor with chain metadata", async () => {
    const t = makeTrace();
    await store.persist(t);
    const updateResult = await store.update(t.workUnitId, { executionSummary: "updated summary" });
    expect(updateResult.ok).toBe(true);

    const row = await prisma.workTrace.findUnique({ where: { workUnitId: t.workUnitId } });
    expect(row?.traceVersion).toBe(2);

    const anchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: t.workUnitId,
      eventType: "work_trace.updated",
      traceVersion: 2,
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.snapshot["previousVersion"]).toBe(1);
    expect(anchor!.snapshot["contentHash"]).toBe(row!.contentHash);
    expect(anchor!.snapshot["changedFields"]).toEqual(expect.arrayContaining(["executionSummary"]));
    // Computed integrity fields and store-derived lockedAt MUST NOT appear.
    expect(anchor!.snapshot["changedFields"]).not.toContain("contentHash");
    expect(anchor!.snapshot["changedFields"]).not.toContain("traceVersion");
    expect(anchor!.snapshot["changedFields"]).not.toContain("lockedAt");

    // Read returns ok at the new version.
    const readResult = await store.getByWorkUnitId(t.workUnitId);
    expect(readResult?.integrity.status).toBe("ok");
  });

  it("pre-migration row (requestedAt < cutoff, contentHash null) returns skipped", async () => {
    const wuId = `wu_pre_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    // Insert a row directly bypassing the store, simulating a pre-migration row.
    await prisma.workTrace.create({
      data: {
        workUnitId: wuId,
        traceId: "tr_pre",
        intent: "x",
        mode: "cartridge",
        organizationId: "org_pre",
        actorId: "u",
        actorType: "user",
        trigger: "api",
        matchedPolicies: "[]",
        governanceOutcome: "execute",
        riskScore: 0,
        outcome: "completed",
        durationMs: 0,
        requestedAt: new Date(new Date(WORK_TRACE_INTEGRITY_CUTOFF_AT).getTime() - 86_400_000),
        governanceCompletedAt: new Date(
          new Date(WORK_TRACE_INTEGRITY_CUTOFF_AT).getTime() - 86_400_000,
        ),
        contentHash: null,
        traceVersion: 0,
      },
    });
    const result = await store.getByWorkUnitId(wuId);
    expect(result?.integrity).toEqual({ status: "skipped", reason: "pre_migration" });
  });
});
