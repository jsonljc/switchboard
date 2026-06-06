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

    // NOTE: seed Organization/Contact/Opportunity/Booking rows the FKs need here,
    // reusing the existing api integration-test seed helpers, then set these ids.
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
