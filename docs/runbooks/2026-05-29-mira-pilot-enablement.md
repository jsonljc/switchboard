# Runbook — Enable Mira for a deployed pilot org

Mira is opt-in per org. To make the feed visible for a chosen pilot org in a
deployed environment, upsert an `OrgAgentEnablement{agentKey:"mira", status:"enabled"}`
row for that org via the Prisma client (which supplies the managed `id` and
`updatedAt` columns). **A human runs this against prod — never automated.**

1. Confirm the pilot `organizationId` with the owner.
2. Run `seedMiraPilotOrgs` as a one-shot script against the deployed `DATABASE_URL`:

   ```bash
   DATABASE_URL="<prod-database-url>" npx tsx -e "
   import { PrismaClient } from '@prisma/client';
   import { seedMiraPilotOrgs } from './packages/db/src/seed/seed-mira-pilot-orgs.js';
   const prisma = new PrismaClient();
   await seedMiraPilotOrgs(prisma, ['<pilotOrgId>']);
   await prisma.\$disconnect();
   console.warn('Done.');
   "
   ```

   This goes through the Prisma client, which supplies `id` (uuid) and
   `updatedAt` correctly — the raw `@default`/`@updatedAt` annotations are
   app-layer-only and have no database-level default.

3. Verify `/mira` renders the feed for that org (and still 404s for others).
4. (Optional) seed real demo drafts only in non-prod; production shows the org's
   real creative jobs.
