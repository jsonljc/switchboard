// Org + owner provisioning is canonical in @switchboard/db
// (packages/db/src/seed/provision-org-with-owner.ts). This module re-exports it under
// the historical dashboard names so the signup callers (register route, OAuth adapter)
// compile unchanged. provisionOrgWithOwner is byte-identical to the previous
// provisionDashboardUser body; keeping one source prevents drift from the F-01
// (business hours) / F-02 (entitlement) fixes.
export {
  provisionOrgWithOwner as provisionDashboardUser,
  type ProvisionOrgWithOwnerInput as ProvisionDashboardUserInput,
} from "@switchboard/db";
