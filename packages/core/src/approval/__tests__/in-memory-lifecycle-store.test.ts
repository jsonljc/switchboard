import { describe, it, expect } from "vitest";
import { InMemoryLifecycleStore } from "../in-memory-lifecycle-store.js";
import { StaleVersionError } from "../state-machine.js";

function input(env = "wu-1") {
  return {
    actionEnvelopeId: env,
    organizationId: "org_dev",
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: { a: 1 },
      approvalScopeSnapshot: {},
      bindingHash: "h1",
      createdBy: "system",
    },
  };
}

describe("InMemoryLifecycleStore", () => {
  it("creates a lifecycle with revision and reads it back", async () => {
    const store = new InMemoryLifecycleStore();
    const { lifecycle, revision } = await store.createLifecycleWithRevision(input());
    expect(lifecycle.status).toBe("pending");
    expect(lifecycle.currentRevisionId).toBe(revision.id);
    expect(revision.revisionNumber).toBe(1);
    expect(await store.getLifecycleById(lifecycle.id)).toMatchObject({ id: lifecycle.id });
    expect(await store.getLifecycleByEnvelopeId("wu-1")).toMatchObject({ id: lifecycle.id });
    expect(await store.getCurrentRevision(lifecycle.id)).toMatchObject({ bindingHash: "h1" });
  });

  it("enforces optimistic version on status updates", async () => {
    const store = new InMemoryLifecycleStore();
    const { lifecycle } = await store.createLifecycleWithRevision(input());
    await expect(
      store.updateLifecycleStatus(lifecycle.id, "rejected", 99, "org_dev"),
    ).rejects.toBeInstanceOf(StaleVersionError);
    const updated = await store.updateLifecycleStatus(lifecycle.id, "rejected", 1, "org_dev");
    expect(updated.status).toBe("rejected");
    expect(updated.version).toBe(2);
  });

  it("approveAndMaterialize flips status and pins the executable work unit", async () => {
    const store = new InMemoryLifecycleStore();
    const { lifecycle, revision } = await store.createLifecycleWithRevision(input());
    const { lifecycle: approved, workUnit } = await store.approveAndMaterialize(
      lifecycle.id,
      1,
      "org_dev",
      {
        lifecycleId: lifecycle.id,
        approvalRevisionId: revision.id,
        actionEnvelopeId: "wu-1",
        frozenPayload: { intent: "x" },
        frozenBinding: {},
        frozenExecutionPolicy: {},
        executableUntil: new Date(Date.now() + 3_600_000),
      },
    );
    expect(approved.status).toBe("approved");
    expect(approved.currentExecutableWorkUnitId).toBe(workUnit.id);
    expect(await store.getExecutableWorkUnit(workUnit.id)).toMatchObject({ id: workUnit.id });
  });

  it("rejects duplicate dispatch idempotency keys and counts records", async () => {
    const store = new InMemoryLifecycleStore();
    await store.createDispatchRecord({
      executableWorkUnitId: "ewu-1",
      attemptNumber: 1,
      idempotencyKey: "k1",
    });
    await expect(
      store.createDispatchRecord({
        executableWorkUnitId: "ewu-1",
        attemptNumber: 2,
        idempotencyKey: "k1",
      }),
    ).rejects.toThrow(/idempotency/i);
    await store.createDispatchRecord({
      executableWorkUnitId: "ewu-1",
      attemptNumber: 2,
      idempotencyKey: "k2",
    });
    expect(await store.countDispatchRecords("ewu-1")).toBe(2);
    expect(await store.countDispatchRecords("ewu-other")).toBe(0);
  });

  it("lists pending and recovery_required lifecycles scoped by org", async () => {
    const store = new InMemoryLifecycleStore();
    const { lifecycle: a } = await store.createLifecycleWithRevision(input("wu-a"));
    await store.createLifecycleWithRevision({ ...input("wu-b"), organizationId: "org_other" });
    expect(await store.listPendingLifecycles("org_dev")).toHaveLength(1);
    expect(await store.listPendingLifecycles()).toHaveLength(2);
    await store.updateLifecycleStatus(a.id, "recovery_required", 1, "org_dev");
    expect(await store.listPendingLifecycles("org_dev")).toHaveLength(0);
    expect(await store.listRecoveryRequiredLifecycles("org_dev")).toHaveLength(1);
    expect(await store.listRecoveryRequiredLifecycles("org_other")).toHaveLength(0);
  });

  it("lists expired pending lifecycles by cutoff", async () => {
    const store = new InMemoryLifecycleStore();
    await store.createLifecycleWithRevision({
      ...input("wu-exp"),
      expiresAt: new Date(Date.now() - 1000),
    });
    await store.createLifecycleWithRevision(input("wu-live"));
    const expired = await store.listExpiredPendingLifecycles();
    expect(expired).toHaveLength(1);
    expect(expired[0]?.actionEnvelopeId).toBe("wu-exp");
  });
});
