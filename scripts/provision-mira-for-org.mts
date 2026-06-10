// Provisions Mira (launchTier day-thirty) for one org: the creative deployment +
// recommendation-handoff governance + Mira enablement, in one atomic, idempotent
// call (audit F3, Wave 1). A deliberate operator action; Mira is NOT provisioned at
// signup (Riley is, via the org config seam). Riley is also re-ensured here as an
// idempotent no-op so the org's cross-agent loop is whole.
//
// Usage: npx tsx scripts/provision-mira-for-org.mts <orgId>
//
// .mts (not .ts): the repo root is CommonJS (no "type":"module"), but @switchboard/db
// publishes ESM-only exports. The .mts extension makes tsx load this script as ESM so
// the import resolves. @switchboard/db + @prisma/client are root devDependencies so a
// root-level script can resolve them.
import { PrismaClient } from "@prisma/client";
import { provisionOrgAgentDeployments } from "@switchboard/db";

async function main(): Promise<void> {
  const [orgId] = process.argv.slice(2);
  if (!orgId) {
    console.error("usage: npx tsx scripts/provision-mira-for-org.mts <orgId>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const result = await provisionOrgAgentDeployments(prisma, orgId, { mira: true });
    console.warn(
      `[provision-mira-for-org] org=${orgId} provisioned ` +
        `riley=${result.riley.deploymentId} mira=${result.mira?.deploymentId ?? "(none)"}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[provision-mira-for-org] failed:", err);
  process.exit(1);
});
