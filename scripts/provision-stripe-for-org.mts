// Provisions a Stripe Connect payment Connection for one org so the no-PMS deposit loop can
// resolve the live StripeConnectPaymentAdapter (not Noop). The operator obtains the connected
// account id (acct_...) and that account's secret (sk_...) or restricted (rk_...) key
// out-of-band (Stripe Dashboard / Connect onboarding). Persists encrypted
// {connectedAccountId, secretKey} and sets Connection.externalAccountId := connectedAccountId
// (the #999 credential contract). Restricted keys (rk_) are preferred (least privilege).
//
// Usage (the secret is read from STDIN, never argv/env, so it stays out of shell history and
// the process listing):
//
//   npx tsx scripts/provision-stripe-for-org.mts <orgId> <acct_...>
//   # then paste the secret key and press Ctrl-D
//
//   # or pipe from a secret manager (no literal key on the command line):
//   op read "op://vault/stripe/<acct>-key" | npx tsx scripts/provision-stripe-for-org.mts <orgId> <acct_...>
//
// Requires DATABASE_URL + CREDENTIALS_ENCRYPTION_KEY in the environment.
//
// .mts (not .ts): @switchboard/db is ESM-only (see provision-mira-for-org.mts).
import { PrismaClient, PrismaConnectionStore } from "@switchboard/db";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const [orgId, connectedAccountId] = process.argv.slice(2);
  if (!orgId || !connectedAccountId) {
    console.error(
      "usage: npx tsx scripts/provision-stripe-for-org.mts <orgId> <connectedAccountId>  " +
        "(secret key on stdin: paste + Ctrl-D, or pipe from a secret manager)",
    );
    process.exit(1);
  }

  const secretKey = await readStdin();
  if (!secretKey) {
    console.error("[provision-stripe-for-org] no secret key on stdin");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const store = new PrismaConnectionStore(prisma);
    const result = await store.provisionStripeConnection({
      organizationId: orgId,
      connectedAccountId,
      secretKey,
    });
    console.warn(
      `[provision-stripe-for-org] org=${orgId} connection=${result.id} ` +
        `created=${result.created} externalAccountId=${connectedAccountId} ` +
        `(secret persisted encrypted, not shown)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[provision-stripe-for-org] failed:", err);
  process.exit(1);
});
