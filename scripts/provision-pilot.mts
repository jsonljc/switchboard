// Fully provisions one vetted pilot clinic org so a real clinic can be onboarded while
// self-serve signup is closed (waitlist launch mode). Creates the org (comped
// entitlement + default business hours), the owner (Principal + IdentitySpec +
// DashboardUser with a bcrypt-hashed temp password and an encrypted apiKey) AND Riley's
// deployment, all via the canonical @switchboard/db provisioners (provisionPilotOrg).
// F-05 flagged this as required before flipping prod to waitlist.
//
// The owner logs in with email + password (the prod CredentialsProvider). emailVerified
// is stamped now (the clinic is vetted; we skip the verification round-trip). The temp
// password is printed once: share it securely and have the owner change it after first
// login.
//
// Usage:
//   CREDENTIALS_ENCRYPTION_KEY=... DATABASE_URL=... \
//     npx tsx scripts/provision-pilot.mts --email owner@clinic.com [--name "Clinic Name"] [--password "..."]
//
// --email is required. --name defaults to the email. --password defaults to a strong
// generated value (printed once). Requires DATABASE_URL + CREDENTIALS_ENCRYPTION_KEY in
// the environment (the apiKey is encrypted with the same key the dashboard/API decrypt
// with). Re-running for an existing email is safe: it re-ensures Riley and reports the
// org as already provisioned (it does not reset the password or re-mint the apiKey).
//
// .mts (not .ts): @switchboard/db is ESM-only (see provision-mira-for-org.mts for the
// full ERR_PACKAGE_PATH_NOT_EXPORTED rationale). bcryptjs is a root devDependency so a
// root-level script can resolve it.
import { randomBytes } from "crypto";
import { PrismaClient, provisionPilotOrg, provisionOrgAgentDeployments } from "@switchboard/db";
import bcrypt from "bcryptjs";

interface PilotArgs {
  email: string;
  name?: string;
  password: string;
}

/** Parse `--email`, `--name`, `--password` (each as `--flag value`). */
function parseArgs(argv: string[]): { email?: string; name?: string; password?: string } {
  const out: { email?: string; name?: string; password?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--email") {
      out.email = next;
      i += 1;
    } else if (arg === "--name") {
      out.name = next;
      i += 1;
    } else if (arg === "--password") {
      out.password = next;
      i += 1;
    }
  }
  return out;
}

/** A strong URL-safe temp password (no shell-hostile chars), used when --password is absent. */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.email) {
    console.error(
      "usage: npx tsx scripts/provision-pilot.mts --email <owner-email> " +
        '[--name "<clinic name>"] [--password "<temp password>"]',
    );
    process.exit(1);
  }
  const email = parsed.email;
  const name = parsed.name;
  const password = parsed.password ?? generatePassword();
  const generated = parsed.password === undefined;

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.dashboardUser.findUnique({ where: { email } });
    if (existing) {
      // Idempotent re-run: do not re-mint the org/apiKey or reset the password. Just
      // re-ensure Riley's deployment (a no-clobber no-op if already provisioned) so a
      // partially-provisioned org converges.
      await provisionOrgAgentDeployments(prisma, existing.organizationId, { mira: false });
      console.warn(
        `[provision-pilot] already provisioned: email=${email} org=${existing.organizationId} ` +
          "(re-ensured Riley; password + apiKey left unchanged)",
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await provisionPilotOrg(prisma, {
      email,
      name: name ?? null,
      emailVerified: new Date(),
      passwordHash,
    });

    console.warn(
      `[provision-pilot] provisioned org=${user.organizationId} email=${email}\n` +
        `  temp password: ${password}${generated ? " (generated)" : ""}\n` +
        "  Log in at the dashboard with this email + password. Share the password " +
        "securely; have the owner change it after first login.",
    );
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "P2002") {
      console.error(
        `[provision-pilot] an account already exists for email=${email} (unique-constraint). ` +
          "Re-run is idempotent; if you see this, a concurrent provision raced.",
      );
      process.exit(1);
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // Log only the message: this script handles a temp password + an encrypted-credentials
  // payload, so avoid serializing error internals (some drivers populate them with query
  // input) to stderr / log sinks.
  console.error("[provision-pilot] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
