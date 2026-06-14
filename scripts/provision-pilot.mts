// Provisions a vetted pilot clinic org from the operator side, so a real
// customer can be onboarded while self-serve signup is gated to "waitlist"
// (F-05). Mirrors the canonical self-serve onboarding (provisionDashboardUser:
// entitled per F-02, bookable per F-01, day-one agent enablement) and then
// eagerly seeds Riley's deployment + governance, finally minting a one-time
// set-password link for the owner. See docs/runbooks/provisioning.md and
// apps/dashboard/src/lib/provision-pilot-org.ts.
//
// Usage:
//   npx tsx scripts/provision-pilot.mts <owner-email> [--name "Clinic Name"] \
//     [--base-url https://app.example.com] [--reissue-link]
//
//   --reissue-link   mint a fresh set-password link for an already-provisioned
//                    owner (use when the first link lapsed); does not re-provision.
//
// .mts (not .ts): @switchboard/db is ESM-only — a root `.ts` script loaded as
// CJS fails to require-resolve it (ERR_PACKAGE_PATH_NOT_EXPORTED). `.mts` forces
// ESM. Same rationale as scripts/provision-mira-for-org.mts.

import { PrismaClient } from "@switchboard/db";
import { realProvisionPilotDeps } from "../apps/dashboard/src/lib/provision-pilot-deps";
import {
  PilotOrgExistsError,
  PilotOwnerNotFoundError,
  provisionPilotOrg,
  reissueSetupLink,
} from "../apps/dashboard/src/lib/provision-pilot-org";

interface Args {
  email?: string;
  name?: string;
  baseUrl?: string;
  reissue: boolean;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("-")) {
    throw new Error(
      `${flag} requires a value (got ${value === undefined ? "end of arguments" : value})`,
    );
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { reissue: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reissue-link") {
      args.reissue = true;
    } else if (a === "--name") {
      args.name = requireValue(a, argv[++i]);
    } else if (a.startsWith("--name=")) {
      args.name = a.slice("--name=".length);
    } else if (a === "--base-url") {
      args.baseUrl = requireValue(a, argv[++i]);
    } else if (a.startsWith("--base-url=")) {
      args.baseUrl = a.slice("--base-url=".length);
    } else if (!a.startsWith("-") && args.email === undefined) {
      args.email = a;
    } else {
      throw new Error(`unexpected argument: ${a}`);
    }
  }
  return args;
}

const USAGE =
  'usage: npx tsx scripts/provision-pilot.mts <owner-email> [--name "Clinic Name"] [--base-url https://app.example.com] [--reissue-link]';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error(USAGE);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (args.reissue) {
      const r = await reissueSetupLink(prisma, { email: args.email, baseUrl: args.baseUrl });
      console.warn(
        [
          "",
          `Reissued set-password link for ${r.ownerEmail} (org ${r.organizationId}).`,
          "",
          `  Set-password link (expires ${r.setupLinkExpiresAt.toISOString()}):`,
          `  ${r.setupUrl}`,
          "",
          "Convey this link over a trusted channel; treat it as a secret (it sets the owner's password). Do not paste it into shared logs.",
        ].join("\n"),
      );
    } else {
      const r = await provisionPilotOrg(
        prisma,
        { email: args.email, name: args.name, baseUrl: args.baseUrl },
        realProvisionPilotDeps,
      );
      console.warn(
        [
          "",
          `Provisioned pilot org ${r.organizationId} for ${r.ownerEmail}.`,
          "  - entitlement comped + business hours seeded -> the org can take bookings",
          "  - day-one agents enabled; Riley deployment + governance seeded (Mira withheld)",
          r.rileyDeploymentId
            ? `  - Riley deployment: ${r.rileyDeploymentId}`
            : "  - Riley deployment: deferred (will seed on the owner's first dashboard load)",
          "",
          `  Set-password link (expires ${r.setupLinkExpiresAt.toISOString()}):`,
          `  ${r.setupUrl}`,
          "",
          "Next steps:",
          "  1. Convey the set-password link to the owner over a trusted channel. Treat it as a",
          "     secret (it sets their password); do not paste it into shared logs.",
          "  2. They open it, set a password, and sign in with email + password.",
          "  3. Connect the clinic's channels and calendar from the dashboard.",
          "  If the link lapses before use, re-run with --reissue-link to mint a fresh one.",
        ].join("\n"),
      );
    }
  } catch (err) {
    if (err instanceof PilotOrgExistsError || err instanceof PilotOwnerNotFoundError) {
      console.error(`[provision-pilot] ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[provision-pilot] failed:", err);
  process.exit(1);
});
