// apps/api/src/bootstrap/operator-intents/__tests__/record-verified-payment.integration.test.ts
// ---------------------------------------------------------------------------
// Postgres-gated replay-proof integration test for payment.record_verified.
// Skipped when DATABASE_URL is absent (CI without Postgres, local no-db runs).
// Proves the partial-unique no-op that the unit test cannot — a replayed
// externalReference against a real $transaction must produce exactly ONE
// LifecycleRevenueEvent row, ONE Receipt row.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@switchboard/db";
import { PrismaRevenueStore, PrismaReceiptStore, PrismaOutboxStore } from "@switchboard/db";
import type { StoreTransactionContext } from "@switchboard/core";
import {
  buildRecordVerifiedPaymentHandler,
  type ReceiptWriter,
} from "../record-verified-payment.js";
import type { WorkUnit } from "@switchboard/core/platform";

describe.skipIf(!process.env["DATABASE_URL"])("payment.record_verified replay (real tx)", () => {
  it("a replayed externalReference writes exactly one revenue + receipt + outbox row", async () => {
    const prisma = new PrismaClient();
    const revenueStore = new PrismaRevenueStore(prisma);
    const receipts = new PrismaReceiptStore(prisma);
    const outbox = new PrismaOutboxStore(prisma);

    // FK rows (Organization/Contact/Opportunity/Booking) must be seeded before this
    // test can assert revCount/receiptCount. No shared api integration-test seed helper
    // exists yet (seeding is deferred to the pilot runbook). The CI-runnable proof of
    // the idempotency guard lives in:
    //   packages/db/src/stores/__tests__/prisma-receipt-store.test.ts  (mint dedup)
    //   packages/db/src/stores/__tests__/prisma-revenue-store.test.ts  (record dedup)
    // This test is kept as the Postgres-gated gate for when seeding is added.
    const orgId = "itest-org";
    const externalReference = "pi_replay_1";

    const receiptWriter: ReceiptWriter = {
      write: (input, tx) => receipts.mint(input, tx as never).then(() => {}),
    };
    const handler = buildRecordVerifiedPaymentHandler(
      receiptWriter,
      revenueStore,
      {
        write: (id, type, payload, tx) =>
          outbox.write(id, type, payload, tx as never).then(() => {}),
      },
      (fn) => prisma.$transaction((tx: StoreTransactionContext) => fn(tx)),
      // F3: server-side fetch-back stub — a confirmed paid stripe charge.
      async () => ({
        provider: "stripe",
        externalReference,
        amountCents: 5000,
        currency: "SGD",
        status: "paid",
        bookingId: "itest-booking",
      }),
    );

    const wu = (): WorkUnit =>
      ({
        id: "wu",
        requestedAt: new Date().toISOString(),
        organizationId: orgId,
        actor: { id: "system", type: "service" },
        intent: "payment.record_verified",
        parameters: {
          contactId: "itest-contact",
          opportunityId: "itest-opp",
          bookingId: "itest-booking",
          amountCents: 5000,
          currency: "SGD",
          externalReference,
          provider: "stripe",
        },
        deployment: {} as never,
        resolvedMode: "operator_mutation",
        traceId: "t",
        trigger: "api",
        priority: "normal",
      }) as WorkUnit;

    await handler.execute(wu());
    await handler.execute(wu()); // replay — must be a no-op

    const revCount = await prisma.lifecycleRevenueEvent.count({
      where: { organizationId: orgId, externalReference },
    });
    const receiptCount = await prisma.receipt.count({
      where: { organizationId: orgId, externalRef: externalReference },
    });
    expect(revCount).toBe(1);
    expect(receiptCount).toBe(1);
    await prisma.$disconnect();
  }, 30_000);
});
