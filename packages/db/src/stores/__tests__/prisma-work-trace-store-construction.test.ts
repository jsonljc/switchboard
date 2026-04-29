import { describe, it, expect } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { AuditLedger, InMemoryLedgerStorage, NoopOperatorAlerter } from "@switchboard/core";

const fakePrisma = {} as never;

describe("PrismaWorkTraceStore — construction", () => {
  it("throws when config is missing entirely", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new PrismaWorkTraceStore(fakePrisma, undefined as any)).toThrow(
      /requires auditLedger and operatorAlerter/,
    );
  });

  it("throws when auditLedger is missing", () => {
    const config = { operatorAlerter: new NoopOperatorAlerter() };
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => new PrismaWorkTraceStore(fakePrisma, config as any),
    ).toThrow(/requires auditLedger and operatorAlerter/);
  });

  it("throws when operatorAlerter is missing", () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    const config = { auditLedger: ledger };
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => new PrismaWorkTraceStore(fakePrisma, config as any),
    ).toThrow(/requires auditLedger and operatorAlerter/);
  });

  it("constructs cleanly when both deps are present (real ledger + noop alerter)", () => {
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    const store = new PrismaWorkTraceStore(fakePrisma, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });
    expect(store).toBeInstanceOf(PrismaWorkTraceStore);
  });
});
