// Read-only pre-flip diagnostic: report, per org, whether live Stripe deposit issuance will
// resolve to the real StripeConnectPaymentAdapter or fail closed to Noop, and exactly why. It
// reuses the factory's real decision via classifyStripeReadiness (assembleOrgReadiness), so it
// cannot drift. Never prints the decrypted secret. Read-only: no writes, no HTTP route.
//
// Usage (needs DATABASE_URL + CREDENTIALS_ENCRYPTION_KEY, and the same PAYMENT_PUBLIC_URL /
// DASHBOARD_URL / STRIPE_* env the API runs with for the global preconditions to be meaningful):
//
//   npx tsx apps/api/scripts/check-stripe-readiness.mts <orgId>   # one org; exit 1 if not live
//   npx tsx apps/api/scripts/check-stripe-readiness.mts           # every org with a stripe Connection
//
// .mts: @switchboard/db is ESM-only (see scripts/provision-stripe-for-org.mts).
import { PrismaClient, decryptCredentials } from "@switchboard/db";
import {
  assembleOrgReadiness,
  describeReadiness,
  resolveRedirectPrecondition,
  resolveWebhookPrecondition,
  type RawStripeConnectionRow,
} from "../src/payments/stripe-readiness.js";

const decrypt = (encrypted: unknown): Record<string, unknown> =>
  decryptCredentials(encrypted as string);

function printPreconditions(): void {
  const redirect = resolveRedirectPrecondition(process.env);
  const webhook = resolveWebhookPrecondition(process.env);
  console.warn("deployment preconditions (global, affect every live org):");
  if (redirect.ok) {
    console.warn(`  redirect base: ${redirect.effectiveBaseUrl} (from ${redirect.source}) [OK]`);
  } else {
    console.warn(
      "  redirect base: PAYMENT_PUBLIC_URL and DASHBOARD_URL unset -> localhost dev default; " +
        "live Checkout links would point to localhost [WARN]",
    );
  }
  if (webhook.ok) {
    console.warn("  webhook verification: STRIPE_SECRET_KEY set, STRIPE_CONNECT_WEBHOOK_SECRET set [OK]");
  } else {
    console.warn(
      `  webhook verification: STRIPE_SECRET_KEY ${webhook.stripeSecretKeySet ? "set" : "MISSING"}, ` +
        `STRIPE_CONNECT_WEBHOOK_SECRET ${webhook.connectWebhookSecretSet ? "set" : "MISSING"}; ` +
        "absent either, the payments webhook 503s and deposits never settle [WARN]",
    );
  }
}

async function fetchOne(prisma: PrismaClient, orgId: string): Promise<RawStripeConnectionRow | null> {
  // No status filter: the diagnostic must see a non-connected Connection to report it.
  return prisma.connection.findFirst({
    where: { serviceId: "stripe", organizationId: orgId },
    select: { credentials: true, externalAccountId: true, status: true },
  });
}

async function fetchAll(
  prisma: PrismaClient,
): Promise<Array<{ organizationId: string | null; row: RawStripeConnectionRow }>> {
  const rows = await prisma.connection.findMany({
    where: { serviceId: "stripe" },
    select: { organizationId: true, credentials: true, externalAccountId: true, status: true },
    orderBy: { organizationId: "asc" },
  });
  return rows.map(({ organizationId, ...row }) => ({ organizationId, row }));
}

async function main(): Promise<void> {
  const orgId = process.argv[2];
  const prisma = new PrismaClient();
  try {
    printPreconditions();
    if (orgId) {
      const row = await fetchOne(prisma, orgId);
      const result = assembleOrgReadiness(row, decrypt);
      console.warn(`org ${orgId}: ${describeReadiness(result)}`);
      if (!result.live) process.exitCode = 1;
    } else {
      const entries = await fetchAll(prisma);
      if (entries.length === 0) {
        console.warn("no 'stripe' Connections found; nothing provisioned yet");
      }
      for (const { organizationId, row } of entries) {
        const result = assembleOrgReadiness(row, decrypt);
        console.warn(`org ${organizationId ?? "(global)"}: ${describeReadiness(result)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // Message only: this path handles encrypted credentials; do not serialize error internals.
  console.error("[check-stripe-readiness] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
