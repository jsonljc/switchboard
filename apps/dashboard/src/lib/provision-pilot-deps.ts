import { provisionOrgAgentDeployments } from "@switchboard/db";
import type { ProvisionPilotDeps } from "./provision-pilot-org";
import { provisionDashboardUser } from "./provision-dashboard-user";

/**
 * Composition root for the pilot-provisioning CLI: the real implementations
 * wired to the `ProvisionPilotDeps` contract. This lives in the dashboard
 * package (not the untyped `scripts/` CLI) precisely so the wiring is
 * type-checked — if `provisionDashboardUser` or `provisionOrgAgentDeployments`
 * drift from the contract, this assignment is a build error rather than a
 * runtime surprise in production provisioning.
 *
 * It is deliberately not unit-tested: vitest (vite) cannot resolve the ESM-only
 * `@switchboard/db` entry, and there is no logic here to test — its correctness
 * IS the type-check. The orchestration that uses these deps is covered in
 * provision-pilot-org.test.ts via injected fakes.
 */
export const realProvisionPilotDeps: ProvisionPilotDeps = {
  provisionDashboardUser,
  provisionOrgAgentDeployments,
};
