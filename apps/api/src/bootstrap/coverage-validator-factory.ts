import { CoverageValidator } from "@switchboard/ad-optimizer";

/** Minimal Meta credentials the coverage validator needs to build an ads client.
 *  Mirrors the ad-optimizer-internal DeploymentCredentials (not exported). */
export interface CoverageValidatorCredentials {
  accessToken: string;
  accountId: string;
}

interface CampaignCoverageRow {
  id: string;
  destination_type: string;
  spend: number;
}

/** Pure assembly: wire a CoverageValidator from already-bound collaborators. Kept
 *  separate from the production wiring so the abstain/pass behavior is unit-testable. */
export function buildCoverageValidator(deps: {
  listCampaigns: (query: { orgId: string; accountId: string }) => Promise<CampaignCoverageRow[]>;
  hasRecentLead: (sourceType: string, days: number) => Promise<boolean>;
}): CoverageValidator {
  return new CoverageValidator({
    adsClient: { listCampaigns: deps.listCampaigns },
    intakeStore: { hasRecentLead: deps.hasRecentLead },
  });
}

/** Production wiring for `CronDependencies.createCoverageValidator`: returns the
 *  `(deploymentId, creds) => CoverageValidator` factory the weekly audit calls.
 *
 *  SAFETY: the validator never threads orgId to `hasRecentLead`, so the org is
 *  resolved here (once per deployment, memoized). An unresolvable org yields
 *  `hasRecentLead=false` WITHOUT consulting the store, so the gate ABSTAINS rather
 *  than risk crediting another org's leads, the safe "don't analyze on blind
 *  spots" direction. This whole factory is wired only behind RILEY_COVERAGE_GATE_ENABLED
 *  (default OFF); see apps/api/src/bootstrap/inngest.ts. */
export function buildCreateCoverageValidator(deps: {
  deploymentStore: { findById(id: string): Promise<{ organizationId: string } | null> };
  leadIntakeStore: {
    hasRecentLead(orgId: string, sourceType: string, days: number): Promise<boolean>;
  };
  makeAdsClient: (creds: CoverageValidatorCredentials) => {
    listCampaigns(query: { orgId: string; accountId: string }): Promise<CampaignCoverageRow[]>;
  };
}): (deploymentId: string, creds: CoverageValidatorCredentials) => CoverageValidator {
  return (deploymentId, creds) => {
    let orgIdPromise: Promise<string | null> | undefined;
    const resolveOrgId = () =>
      (orgIdPromise ??= deps.deploymentStore
        .findById(deploymentId)
        .then((d) => d?.organizationId ?? null));
    return buildCoverageValidator({
      listCampaigns: (query) => deps.makeAdsClient(creds).listCampaigns(query),
      hasRecentLead: async (sourceType, days) => {
        const orgId = await resolveOrgId();
        if (!orgId) {
          console.warn(
            `[coverage-validator] no org for deployment ${deploymentId}; abstaining (fail-safe)`,
          );
          return false;
        }
        return deps.leadIntakeStore.hasRecentLead(orgId, sourceType, days);
      },
    });
  };
}
