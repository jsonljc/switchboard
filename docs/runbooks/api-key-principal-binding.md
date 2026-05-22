# API key principal binding (admin-consent endpoints)

> **Symptom:** Operator hits `POST /api/admin/consent/{grant,revoke,clear}` in production and gets `403 { error: "forbidden", reason: "no_principal_binding" }`. Server logs include a structured `warn` line with `decorator: "requireOrgForAuditedMutation"` and the offending `orgId`.

## Why this fires

Admin-consent grant/revoke/clear are PDPA-regulated mutations whose WorkTrace must always attribute the decision to a real principal — never a `"unknown"` placeholder. The `requireOrgForAuditedMutation` decorator fails closed in production when the auth middleware bound an organization but no principal, instead of silently recording an audit row under `actor.id = "unknown"`.

The reachable misconfiguration: a static API key whose `API_KEY_METADATA` entry has only an organization segment, e.g. `svc-key:org_a:runtime_1` (3 segments — no principal). The auth middleware accepts the key (org enforcement is strict in production) and assigns `request.organizationIdFromAuth = "org_a"`, but `request.principalIdFromAuth` is left `undefined`.

## Fix

Add the principal segment to the API key's `API_KEY_METADATA` entry. The format is `<api-key-id>:<org-id>:<runtime-id>:<principal-id>` (4 segments).

1. Identify the offending key from the `warn` line's `orgId` and your service inventory.
2. Update the vault entry for `API_KEY_METADATA` so the relevant key has 4 segments. The principal id should be a service principal recognizable in audit reviews — e.g., `principal:svc-consent-pipeline`.
3. Set the new value in Render on `switchboard-api`. The service restarts automatically.
4. Retry the original request — it should now 200 and produce a WorkTrace row with the real principal id.

## Why we 403 instead of falling back to a placeholder

Pre-PR-#614, `apps/api/src/bootstrap/routes.ts` threw a 500 in production when the principal was unbound on admin-consent — the same intent as this runbook. The PR-#614 refactor inadvertently dropped that guard; PR #617 restored it as a structured 403 + log breadcrumb. A regulator-facing audit row attributing a PDPA consent decision to `actor.id = "unknown"` would be materially worse than the 403 that forces this runbook to run.

## Related

- `apps/api/src/decorators/org.ts` — `requireOrgForAuditedMutation`
- `apps/api/src/middleware/auth.ts` — API key parsing (note: `principalId` is optional in metadata; this runbook exists because the optionality slips past auth-time validation in production)
- `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` §4.5 — auth-failure envelope reasons
