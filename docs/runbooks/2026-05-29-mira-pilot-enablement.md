# Runbook — Enable Mira for a deployed pilot org

Mira is opt-in per org. To make the feed visible for a chosen pilot org in a
deployed environment, insert an `OrgAgentEnablement{agentKey:"mira", status:"enabled"}`
row for that org. **A human runs this against prod — never automated.**

1. Confirm the pilot `organizationId` with the owner.
2. Run `seedMiraPilotOrgs(prisma, ["<pilotOrgId>"])` against the deployed DB
   (one-shot script using the deployed `DATABASE_URL`), or equivalently upsert
   the row directly:

   ```sql
   INSERT INTO "OrgAgentEnablement" ("orgId","agentKey","status")
   VALUES ('<pilotOrgId>','mira','enabled')
   ON CONFLICT ("orgId","agentKey") DO UPDATE SET "status"='enabled';
   ```

3. Verify `/mira` renders the feed for that org (and still 404s for others).
4. (Optional) seed real demo drafts only in non-prod; production shows the org's
   real creative jobs.
