import { describe, it, expect } from "vitest";
import { AuditLedger, InMemoryLedgerStorage } from "../ledger.js";

async function recordAnchor(
  ledger: AuditLedger,
  workUnitId: string,
  contentHash: string,
  traceVersion: number,
  eventType: "work_trace.persisted" | "work_trace.updated",
) {
  return ledger.record({
    eventType,
    actorType: "system",
    actorId: "store",
    entityType: "work_trace",
    entityId: workUnitId,
    riskCategory: "low",
    summary: `WorkTrace ${workUnitId} v${traceVersion}`,
    snapshot: { workUnitId, traceVersion, contentHash, hashAlgorithm: "sha256", hashVersion: 1 },
  });
}

describe("AuditLedger.findAnchor", () => {
  it("returns the entry whose snapshot.traceVersion matches", async () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    await recordAnchor(ledger, "wu_1", "h1", 1, "work_trace.persisted");
    await recordAnchor(ledger, "wu_1", "h2", 2, "work_trace.updated");
    await recordAnchor(ledger, "wu_1", "h3", 3, "work_trace.updated");

    const anchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.updated",
      traceVersion: 2,
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.snapshot["contentHash"]).toBe("h2");
    expect(anchor!.snapshot["traceVersion"]).toBe(2);
  });

  it("returns null when no entry has the requested traceVersion", async () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    await recordAnchor(ledger, "wu_1", "h1", 1, "work_trace.persisted");

    const anchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.updated",
      traceVersion: 5,
    });
    expect(anchor).toBeNull();
  });

  it("disambiguates entries with same entityId but different eventType", async () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    await recordAnchor(ledger, "wu_1", "h1", 1, "work_trace.persisted");
    await recordAnchor(ledger, "wu_1", "h2", 2, "work_trace.updated");

    const persistAnchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.persisted",
      traceVersion: 1,
    });
    expect(persistAnchor!.snapshot["contentHash"]).toBe("h1");

    const updateAnchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.updated",
      traceVersion: 2,
    });
    expect(updateAnchor!.snapshot["contentHash"]).toBe("h2");
  });

  it("locates traceVersion 1 even after 200 sequential updates", async () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    await recordAnchor(ledger, "wu_1", "h1", 1, "work_trace.persisted");
    for (let v = 2; v <= 200; v++) {
      await recordAnchor(ledger, "wu_1", `h${v}`, v, "work_trace.updated");
    }

    const persistAnchor = await ledger.findAnchor({
      entityType: "work_trace",
      entityId: "wu_1",
      eventType: "work_trace.persisted",
      traceVersion: 1,
    });
    expect(persistAnchor).not.toBeNull();
    expect(persistAnchor!.snapshot["traceVersion"]).toBe(1);
  });
});
