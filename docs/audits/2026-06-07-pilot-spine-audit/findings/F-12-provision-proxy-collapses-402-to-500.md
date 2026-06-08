# F-12: Dashboard provision proxy collapses upstream 402 (entitlement) to a generic 500

- **Severity:** cosmetic (masks F-02's billing signal from the UI; no separate blocking impact)
- **Journey/step:** J2-S1 (channel connect)
- **Verdict:** BROKEN (exercised — upstream 402 surfaced to the browser as 500)
- **Location:**
  - `apps/dashboard/src/lib/api-client/core.ts:17-19` (`this.request` throws a plain `new Error(body.error)`, discarding `res.status` — unlike `dashboard.ts:182-187` which preserves `err.status`).
  - `apps/dashboard/src/app/api/dashboard/organizations/provision/route.ts:13-18` (catch maps any error whose message !== `"Unauthorized"` to HTTP **500**).
  - `apps/dashboard/src/lib/api-client/settings.ts:116-140` (`provision()` uses the status-dropping `core.ts` `request`).
  - Producer of the real status: `apps/api/src/middleware/billing-guard.ts:74` returns 402 `"Active subscription required"`.
  - (Verified against the worktree on 2026-06-08.)
- **Evidence:**
  - Live: API log shows `POST /api/organizations/.../provision -> statusCode 402`; dashboard log shows `[proxyError] { statusCode: 500, body: { error: 'Active subscription required' } }`; browser fetch received `{status:500, body:{error:"Active subscription required", statusCode:500}}` (`evidence/j2-connect-response.json`).

## What was exercised

Connected Telegram for the unentitled fresh org through the dashboard proxy; captured the upstream API status (402, from the API log) vs the status the browser received (500). Traced the api-client `request` helper and the proxy route's catch.

## What happened vs expected

Expected: an entitlement block surfaces to the UI as 402 so the client can branch to a billing/subscribe affordance. Observed: the 402 is rethrown as a plain `Error` (status dropped at `core.ts:19`), then re-coded to 500 by the proxy catch. The `useProvision` onError toast still shows the message ("Provisioning failed: Active subscription required"), but the HTTP status is wrong and no 402-specific UX (e.g. redirect to checkout) can fire. Combined with F-02, a self-serve pilot org hits a generic "500" on every channel connect with no path to resolve it in-product.

## Suggested fix scope

Preserve the upstream status in `core.ts` `request` (mirror `dashboard.ts:182-187`'s `err.status`), and have the provision proxy route re-emit that status (402) instead of a blanket 500. Add a test asserting a 402 from the API surfaces as 402 from the proxy.
