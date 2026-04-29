import { describe, it, expect, vi } from "vitest";
import { AuditLedger, InMemoryLedgerStorage } from "../ledger.js";

describe("AuditLedger external-tx forwarding", () => {
  it("forwards options.tx to appendAtomic", async () => {
    const externalTx = { marker: "outer" };
    const storage = new InMemoryLedgerStorage();
    const spy = vi.spyOn(storage, "appendAtomic");
    const ledger = new AuditLedger(storage);

    await ledger.record(
      {
        eventType: "action.executed",
        actorType: "system",
        actorId: "x",
        entityType: "test",
        entityId: "e1",
        riskCategory: "low",
        summary: "s",
        snapshot: {},
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { tx: externalTx as any },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Function), { externalTx });
  });

  it("InMemoryLedgerStorage.appendAtomic ignores externalTx and behaves identically", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage);

    await ledger.record({
      eventType: "action.executed",
      actorType: "system",
      actorId: "x",
      entityType: "test",
      entityId: "e1",
      riskCategory: "low",
      summary: "s",
      snapshot: {},
    });
    await ledger.record(
      {
        eventType: "action.executed",
        actorType: "system",
        actorId: "x",
        entityType: "test",
        entityId: "e2",
        riskCategory: "low",
        summary: "s",
        snapshot: {},
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { tx: { irrelevant: true } as any },
    );

    const all = storage.getAll();
    expect(all).toHaveLength(2);
    expect(all[1]!.previousEntryHash).toBe(all[0]!.entryHash);
  });
});
