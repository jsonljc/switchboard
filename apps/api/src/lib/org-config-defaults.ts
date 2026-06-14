import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";

/**
 * Default OrganizationConfig fields seeded by the lazy `GET /config` upsert when an
 * already-authenticated org has no config row yet. One documented source so future
 * fresh-org defaults do not pressure the organizations.ts line budget.
 *
 * Safety (F-02): this is reached only after requireOrganizationScope authenticates the
 * caller, and the handler returns 403 unless the URL orgId equals authOrgId, so it can
 * only ever comp the caller's OWN authenticated org. Authentication is minted only by
 * trusted provisioning (provisionDashboardUser creates the API key alongside the config
 * row). See docs/superpowers/specs/2026-06-14-fresh-org-entitlement-design.md.
 *
 * F-02: `entitlementOverride: true` comps the pilot org so a fresh org is entitled out of
 * the box. Launch/pilot only; billing-live must clear or classify these overrides (see
 * the spec's "Required follow-up at billing-live").
 */
export const LAZY_ORG_CONFIG_CREATE_DEFAULTS = {
  name: "",
  runtimeType: "http",
  runtimeConfig: {},
  governanceProfile: "guarded",
  onboardingComplete: false,
  managedChannels: [] as string[],
  provisioningStatus: "pending",
  businessHours: DEFAULT_BUSINESS_HOURS,
  entitlementOverride: true,
};
