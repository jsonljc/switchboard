# SP2: Integration Wiring — Design Spec

> **Program:** Controlled Beta Remediation (7 SPs)
> **Predecessor:** SP1 (Self-Serve Signup) — shipped on `feat/revenue-control-center`
> **Successor:** SP3 (Activation Fix + Minimum Safety Controls)

---

## 1. Scope & Pass Condition

**Goal:** A beta user can connect their Meta Ads account and WhatsApp channel
from the dashboard without founder intervention. The resulting credentials are
stored and usable by the chat runtime for SP3 activation.

**Pass condition:** A user can complete Meta Ads OAuth and WhatsApp channel
setup from dashboard UI surfaces, with the resulting credentials stored and
resolvable by the chat runtime's `PrismaDeploymentResolver`, without the founder
configuring per-customer env vars or pasting tokens on their behalf.

**Deployment-level env vars (not per-customer):**

- `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` — one Meta App for the platform
- `FACEBOOK_REDIRECT_URI` — OAuth callback URL
- `CREDENTIALS_ENCRYPTION_KEY` — AES-256-GCM key for credential storage

These are standard deployment config, handled by `deploy/setup.sh`.

### Explicit Deferrals

- Token refresh scheduling (60-day window, not a beta-week concern)
- Proactive expiry/re-auth UX
- Richer connection health dashboarding
- Credential store unification (two parallel systems stay parallel)
- Steps 3–5 of improve-spend wizard (targets, CAPI, activate) — shown as
  "Coming soon"

---

## 2. Meta Ads OAuth Wizard Wiring

### Current State

`improve-spend-setup.tsx` has a 5-step wizard. All steps are placeholders:
step 1 shows "Facebook OAuth flow will be initiated here," step 2 has hardcoded
mock accounts, steps 3–5 have placeholder text. No real data flow.

The backend is complete: `apps/api/src/routes/facebook-oauth.ts` has working
`/authorize`, `/callback`, and `/:deploymentId/accounts` endpoints. The OAuth
helper in `packages/ad-optimizer/src/facebook-oauth.ts` handles token exchange,
long-lived token upgrade, and ad account listing against Graph API v21.0.

### What Ships

**Step 1 (connect-meta):** Replace placeholder with a "Connect Meta Ads" button.
On click, redirect to `/api/connections/facebook/authorize?deploymentId={id}`.
The deployment ID comes from the module setup context (the improve-spend
module's `AgentDeployment`).

**OAuth callback redirect fix:** The existing callback redirects to
`/marketplace/deployments/${deploymentId}?connected=true` — a dead route
post-pivot. Change to
`/modules/improve-spend/setup?step=select-account&connected=true`.
The wizard reads the query param to advance to step 2 on return.

**Step 2 (select-account):** Replace hardcoded mock accounts with a fetch to
`/api/connections/facebook/${deploymentId}/accounts`. Render real accounts with
radio selection. On selection, persist the chosen `adAccountId` to the
deployment's `inputConfig` via the existing deployment update endpoint. The user
must explicitly choose — no auto-selection.

**Steps 3–5:** Marked as "Coming soon" with disabled navigation. Not
fake-functional. Wizard completes after step 2 for SP2.

### Design Decision: User Chooses Ad Account

The existing callback auto-selects the first ad account. SP2 overrides this:
show all accounts, let the user choose. Rationale: real businesses often have
multiple ad accounts; auto-selecting the wrong one silently is worse than an
extra click.

### Downstream Note

`adAccountId` persisted in `inputConfig` must be consumed by the ad-optimizer
runtime to be meaningful. Verifying that consumption path is SP3's concern, not
SP2's. SP2's job is to ensure the selected account is correctly stored and
retrievable.

---

## 3. WhatsApp Guided Setup + Test Connection

### Current State

`channel-connect-card.tsx` shows bare "Phone number" (tel input) and "API key"
(password input) fields. No explanation of what these credentials are, where to
find them, or whether they're valid. Credentials are persisted regardless of
validity.

### What Ships

**Field relabeling:**

- "Phone number" → "Phone Number ID" (type: text, not tel — it's a numeric ID,
  not a phone number)
- "API key" → "WhatsApp Cloud API Access Token" (type: password, stays)

**Inline guidance:** Collapsible "Where do I find these?" section containing:

- Navigation path: Meta Business Suite → WhatsApp → API Setup
- One-line description of each credential
- How to tell whether the account has Cloud API access
- Link to Meta's Cloud API documentation

**Test Connection:** "Test Connection" button that calls a new endpoint before
save. The endpoint hits
`GET https://graph.facebook.com/v21.0/{phoneNumberId}?access_token={token}`
and returns success/failure. Credentials are only persisted after a successful
test.

**Error messages:** Specific, not generic:

- 401 → "Invalid access token. Check that you copied the full token."
- 404 → "Phone Number ID not found. Verify the ID in your Meta Business Suite."
- Timeout → "Could not reach Meta's servers. Check your network and try again."

**No-save-on-failure:** If test fails, credentials are not saved. The user sees
the error and can correct and retry. No draft/disconnected state with bad
credentials in the store.

---

## 4. Deployment Bridge (Beta Compatibility)

### Why the Bridge Exists

The onboarding flow creates `Connection` + `ManagedChannel` records. The chat
runtime's `RuntimeRegistry` loads these and creates WhatsApp adapters with
correct outbound credentials. But `ChannelGateway.handleIncoming()` calls
`PrismaDeploymentResolver.resolveByChannelToken()`, which queries the
`DeploymentConnection` table — never populated by onboarding.

Without the bridge, a user can "connect successfully" in the dashboard, but
inbound messages fail with "No deployment connection found for channel=whatsapp"
because the resolver can't find a deployment to route to.

### What the Bridge Does

**This is a beta compatibility bridge, not long-term architectural unification.**
It makes the ManagedChannel credential path visible to
`PrismaDeploymentResolver` by creating explicit records in the deployment path.

During provisioning, after creating `Connection` + `ManagedChannel`, also:

1. **Find or create an `AgentDeployment`** for the org, linked to the Alex
   listing (slug: `alex-conversion`) with `skillSlug: "alex"`, status `active`.
   Look up by org ID + listing slug first; create only if none exists.
2. **Create a `DeploymentConnection`** record with:
   - `deploymentId` → the Alex deployment
   - `type` → channel name (e.g. "whatsapp")
   - `credentials` → same encrypted credentials as the `Connection`
   - `tokenHash` → SHA-256 hash of the `Connection.id` (because that's the
     value passed as `token` to `resolveByChannelToken` via the
     `ManagedChannel` path — see `runtime-registry.ts:80` and
     `managed-webhook.ts:73`)

### Sync Invariant

**The bridge record must be created or updated whenever the relevant connection
is saved or changed, not only on first provisioning.** If a user re-provisions
WhatsApp with new credentials, the `DeploymentConnection` must update too.

This is enforced by making bridge creation part of the provisioning route itself
(not a separate step or background job). The provisioning route is the single
write path for channel credentials, so co-locating the bridge there guarantees
sync.

### Meta Ads: No Bridge Needed

The existing Meta Ads OAuth callback already creates `DeploymentConnection`
records directly (in `facebook-oauth.ts`). Meta Ads flows through the
deployment path natively. The bridge is only needed for the
onboarding/ManagedChannel credential path (WhatsApp, Telegram).

---

## 5. Files Touched

| Action | Path                                                                      | Responsibility                                                         |
| ------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Edit   | `apps/dashboard/src/components/modules/improve-spend-setup.tsx`           | Wire OAuth button, real account fetch, selection persistence           |
| Edit   | `apps/api/src/routes/facebook-oauth.ts`                                   | Change callback redirect from dead marketplace URL to module setup URL |
| New    | `apps/api/src/routes/whatsapp-test.ts`                                    | WhatsApp test-connection endpoint                                      |
| Edit   | `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`       | Relabel fields, add guidance, add test connection button               |
| Edit   | `apps/api/src/routes/organizations.ts`                                    | Add bridge record creation in provisioning route                       |
| New    | `apps/dashboard/src/app/api/dashboard/connections/whatsapp/test/route.ts` | Dashboard proxy for WhatsApp test                                      |

---

## 6. Tests

### Meta Ads OAuth

- OAuth button constructs correct authorize URL with deployment ID and scopes
- OAuth callback redirects to `/modules/improve-spend/setup?step=select-account`
  (not dead marketplace URL)
- Ad account fetch returns real data from stored credentials (mocked Graph API)
- User can select a specific ad account and selection persists to `inputConfig`
- Wizard step 2 shows real account names and IDs (not hardcoded mocks)

### WhatsApp Setup

- Test-connection succeeds with valid credentials (mocked Graph API 200)
- Test-connection fails with 401 → shows "Invalid access token" message
- Test-connection fails with 404 → shows "Phone Number ID not found" message
- Invalid credentials are not persisted to the connection store
- Valid credentials are persisted only after successful test

### Deployment Bridge

- Provisioning creates bridge `DeploymentConnection` + `AgentDeployment` records
- Bridge `tokenHash` matches SHA-256 hash of `Connection.id`
- Bridge updates when credentials are re-provisioned (not stale)
- `PrismaDeploymentResolver.resolveByChannelToken()` successfully resolves after
  provisioning with the bridge in place
- Re-provisioning with new credentials updates `DeploymentConnection.credentials`

---

## 7. What Doesn't Ship

- No WhatsApp embedded signup or WABA provisioning
- No Meta Ads campaign creation or management from dashboard
- No CAPI (Conversions API) setup
- No multi-ad-account management (single account per org)
- No token refresh scheduler or proactive expiry UX
- No connection health dashboard beyond what exists
- No credential store unification
- No improve-spend wizard steps 3–5 (targets, CAPI, activate)

---

## 8. Audit Steps Addressed

- **Step 4 (Meta Ads + WhatsApp Connection): Fail → Pass with friction**
  - Meta Ads: real OAuth flow from dashboard, real account selection
  - WhatsApp: guided credential entry with verified test connection
  - Friction: WhatsApp still requires manual Cloud API token (no embedded signup);
    improve-spend wizard incomplete beyond account selection

---

## 9. Verification Checklist

After SP2, validate:

1. Set `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URI` in env
2. Navigate to improve-spend module setup → click "Connect Meta Ads"
3. Complete OAuth flow with a real Meta Business account
4. Verify callback returns to wizard step 2 with real ad accounts listed
5. Select an ad account → verify `inputConfig.adAccountId` is persisted
6. Navigate to onboarding → WhatsApp channel → enter Cloud API credentials
7. Click "Test Connection" → verify success with valid credentials
8. Click "Test Connection" with bad credentials → verify specific error shown
9. After successful WhatsApp connection, verify `DeploymentConnection` bridge
   record exists with correct `tokenHash`
10. Verify `PrismaDeploymentResolver.resolveByChannelToken()` can resolve the
    WhatsApp channel (unit test or manual DB check)
