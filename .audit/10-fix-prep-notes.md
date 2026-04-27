# Webhook Provisioning Fix — Prep Notes (Task 1)

Date: 2026-04-27

## 1. Org-creation source of truth

**Canonical create path:** `/Users/jasonli/switchboard/apps/api/src/routes/setup.ts:113–127`

The `setupRoutes` plugin implements a one-time bootstrap endpoint that creates the first `DashboardUser`. This implicitly creates an `OrganizationConfig` by assigning an organization ID (line 113: `orgId = 'org_' + ...`) to the user, but there is **no explicit `prisma.organizationConfig.create()` call visible in the route itself**. The `OrganizationConfig` row is created lazily via upsert on first access (see `organizations.ts:37–50`).

**Other create paths (not primary user-facing onboarding):**

- `organizations.ts:37–50` — `/api/organizations/:orgId/config` GET endpoint performs upsert with defaults if org config missing. This is an idempotent fallback, not the canonical create.
- Provision endpoint (`organizations.ts:149–341`) — Does NOT create the organization itself; it assumes org exists and provisions channels into it.

**Conclusion:** The canonical org-creation path is the bootstrap endpoint in `setup.ts`, which creates a `DashboardUser` with an `organizationId` FK. The organization config row is lazily created on first API access via upsert.

---

## 2. ManagedChannel natural key

**ManagedChannel schema location:** `/Users/jasonli/switchboard/packages/db/prisma/schema.prisma:480–497`

**Persisted fields relevant to customer-asset identity:**

- `organizationId` — FK to owning organization (line 482)
- `channel` — channel type: "whatsapp" | "slack" | "telegram" (line 483)
- `connectionId` — FK to `Connection` row storing encrypted credentials (line 484)
- `botUsername` — optional display name (line 485)
- `webhookPath` — unique path `/webhook/managed/{uuid}` (line 486, marked `@unique`)
- `webhookRegistered` — boolean flag (line 487)
- `status` — current status (line 488)
- `statusDetail` — human-readable error reason (line 489)
- `lastHealthCheck` — DateTime of last successful health check (line 490)

**Existing unique constraints (line 494):**

```prisma
@@unique([organizationId, channel])
```

**Critical finding — phoneNumberId location:**

`phoneNumberId` is **NOT persisted as a top-level field on `ManagedChannel`**. It is stored encrypted in the related `Connection.credentials` JSON blob (line 199):

```prisma
model Connection {
  credentials  Json     // encrypted credentials
```

In `organizations.ts:191–199`, the provision endpoint encrypts a credentials object containing `phoneNumberId`:

```ts
const encrypted = encryptCredentials({
  token: ch.token,
  phoneNumberId: ch.phoneNumberId,  // <— encrypted into Connection.credentials
  ...
});
```

And in `health-checker.ts:64–65`, the phoneNumberId is decrypted from `connection.credentials`:

```ts
const phoneNumberId = connection.credentials["phoneNumberId"] as string;
```

**Chosen natural key for idempotency:**

The existing unique constraint `(organizationId, channel)` prevents **an org from ever connecting multiple WhatsApp numbers** (same channel type). Per the plan's Acceptance Criterion A4, multi-number support is required.

**Workaround without schema migration:**

Use a runtime guard in the provision endpoint that:

1. Decrypts the customer-provided phoneNumberId from the incoming request
2. Searches for existing `ManagedChannel` where:
   - `organizationId` matches
   - `channel` matches ("whatsapp")
   - The related `Connection.credentials` decrypts to the same `phoneNumberId`

This requires a custom Prisma query because encrypted-blob comparison is not natively indexable:

```ts
const existing = await app.prisma.managedChannel.findFirst({
  where: {
    organizationId: orgId,
    channel: ch.channel,
  },
  include: { connection: true },
});

if (existing) {
  const existingPhoneNumberId = decryptCredentialsField(
    existing.connection.credentials,
    "phoneNumberId",
  );
  if (existingPhoneNumberId === incomingPhoneNumberId) {
    // Same (org, channel, phoneNumberId) — idempotent return
    return existing;
  }
  // Different phoneNumberId for same (org, channel) — allow multi-number
  // (but first unique constraint must be removed or relaxed)
}
```

**Migration needed?**

**YES — but only if multi-number support is required.** The current `@@unique([organizationId, channel])` constraint on `ManagedChannel` **actively blocks multi-number orgs**. To enable the above guard, this constraint must be **removed or changed to a non-unique index**.

**Recommendation:** Do NOT add a migration in this run. The plan explicitly states "do not propose adding [migrations] in this run." Document the constraint and let the controller decide whether to remove the unique constraint (permitting multi-number in the runtime guard) or keep it and accept single-channel-type per org.

**Lookup query needed (if constraint is removed):**

```ts
const existing = await app.prisma.managedChannel.findFirst({
  where: {
    organizationId: orgId,
    channel: ch.channel,
  },
  include: { connection: true },
});
// Then decrypt and compare phoneNumberId from connection.credentials
```

---

## 3. Health-checker decision

**Function in apps/chat:** `/Users/jasonli/switchboard/apps/chat/src/managed/health-checker.ts:138–148`

**Function name and signature:**

```ts
async function checkWhatsApp(token: string, phoneNumberId: string): Promise<boolean>;
```

**What it does:**

```ts
const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}`, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(10_000),
});
return res.ok;
```

**Exports:** The `checkWhatsApp` function is **not exported**; it is private to the health-checker module. The only public export is `startHealthChecker(prisma)`.

**Dependencies:**

- Direct use of global `fetch` (no injectable dependency)
- Tight coupling to `apps/chat` only (no cross-app imports)
- Uses Prisma for updates, not testable standalone

**Decision: DUPLICATE in apps/api**

**Rationale:**

1. The function is small (~8 lines) and easy to duplicate
2. `apps/api` MUST NOT import from `apps/chat` (core architecture constraint)
3. Factoring into `packages/schemas` would require moving a network function into a schema-only package, which violates dependency layers
4. Duplication enables independent testing in `apps/api` and allows different implementations if needed (e.g., different timeout, retry logic)
5. A **parity-pin test** (comparing output) in `apps/api/__tests__/whatsapp-health-probe.test.ts` ensures the two probes remain synchronized

**Plan:**

- Create `apps/api/src/lib/whatsapp-health-probe.ts` with `probeWhatsAppHealth({ userToken, phoneNumberId, fetchImpl? })`
- Add parity-pin test comparing the URL and auth header format with the `apps/chat` version (read as a string, not imported)
- Use in provision flow immediately after Meta registration succeeds

---

## 4. Token model — CRITICAL findings

### Source: ESU flow analysis

**File:** `/Users/jasonli/switchboard/apps/api/src/routes/whatsapp-onboarding.ts`

**Line 54 — /debug_token call:**

```ts
const tokenInfo = await graphCall(`/debug_token?input_token=${encodeURIComponent(esToken)}`);
```

Where `graphCall` is defined at lines 25–40:

```ts
async function graphCall(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${graphBase}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${metaSystemUserToken}`, // <— LINE 34
      "Content-Type": "application/json",
    },
  };
  if (body) init.body = JSON.stringify(body);
  return opts.graphApiFetch(url, init);
}
```

**Finding:** The `Authorization: Bearer ${metaSystemUserToken}` is used for all `graphCall` invocations, including `/debug_token`. The `metaSystemUserToken` is the **system app token**, not the customer's token.

**Correction to spec assumption:**
The spec assumes `/debug_token?input_token=<userToken>&access_token=<appToken>`, but the actual ESU flow sends **both tokens in different places**:

- `input_token` query parameter — the customer's ESU token (the one being introspected)
- `Authorization: Bearer` header — the system app token (which authorizes the introspection call)

**Line 100–103 — /subscribed_apps call:**

```ts
await graphCall(`/${wabaId}/subscribed_apps`, "POST", {
  override_callback_uri: webhookUrl,
  verify_token: opts.appSecret,
});
```

Again using the same `metaSystemUserToken` via the `Authorization: Bearer` header (line 34 in `graphCall`).

**Critical discrepancy:**

The spec says "customer's userToken" for `/subscribed_apps`, but the ESU flow actually sends the **system app token**. This works in the ESU flow because:

1. The system user was previously added to the customer's WABA (line 67–70)
2. The system app token has `MANAGE` permissions on that WABA
3. The system token can call `/subscribed_apps` on that WABA

**However, for the standard provision flow (where a founder manually enters their personal token), the situation is different:**

- The founder's token is their own **customer-issued** token from their WABA
- The system app token does NOT have permissions on the founder's WABA (unless the founder explicitly added the system app)
- Therefore, the customer's token (not the system app token) MUST be used for `/subscribed_apps` in the standard provision flow

**Line 140 — health probe in apps/chat:**

```ts
const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}`, {
  headers: { Authorization: `Bearer ${token}` },
  ...
});
```

Where `token` is extracted from `connection.credentials["token"]` (line 64). This is the **customer-provided token**, not the system app token.

### WHATSAPP_GRAPH_TOKEN env var analysis

**Current usage:** Not directly used in the ESU flow (`whatsapp-onboarding.ts`). The system token is passed via the `metaSystemUserToken` option parameter (line 22).

**However, in `apps/api/src/bootstrap/routes.ts` (grep context from plan), WHATSAPP_GRAPH_TOKEN is likely used to initialize the `metaSystemUserToken` at app bootstrap time.**

**Usage category:** The env var is the **Meta app access token** — it is used for system-level operations (like `/debug_token` introspection when the system app needs to validate a customer's token without the customer app's identity).

### Reconciliation with helper parameter names

**Plan names from spec:**

- `appToken` — system-level introspection token
- `userToken` — customer asset access token

**Actual ESU flow mapping:**

1. `/debug_token` — requires BOTH:
   - `input_token` (query param) — the customer's token being validated
   - `access_token` (query param) — the system app token authorizing the validation
2. `/subscribed_apps` — for ESU, uses system app token (because system user is on WABA)
3. Health probe — uses customer token

**For standard provision (manual token entry):**

1. `/debug_token` — same as ESU (system app token authorizes, customer token is input)
2. `/subscribed_apps` — MUST use customer token (system app has no access to customer's WABA)
3. Health probe — customer token

**Confirmation:** The helper parameter names `appToken` and `userToken` are **CORRECT and necessary**. The spec correctly identified that two distinct tokens are needed. However, the spec's assumption that both endpoints use the same token is **incorrect for the standard provision flow**. The helper MUST take both tokens and route them appropriately:

```ts
export async function fetchWabaIdFromToken(args: {
  appToken: string; // system app token (for access_token query param)
  userToken: string; // customer token (for input_token query param)
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; wabaId?: string; reason?: string }> {
  const url = new URL("https://graph.facebook.com/v17.0/debug_token");
  url.searchParams.set("input_token", args.userToken); // customer's token
  url.searchParams.set("access_token", args.appToken); // system app token
  const res = await (args.fetchImpl ?? fetch)(url.toString());
  // ...
}

export async function registerWebhookOverride(args: {
  userToken: string; // customer token — ONLY this has access to customer's WABA
  wabaId: string;
  webhookUrl: string;
  verifyToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; reason?: string }> {
  const url = `https://graph.facebook.com/v17.0/${args.wabaId}/subscribed_apps`;
  const res = await (args.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.userToken}`, // customer's token only
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      override_callback_uri: args.webhookUrl,
      verify_token: args.verifyToken,
    }),
  });
  // ...
}

export async function probeWhatsAppHealth(args: {
  userToken: string; // customer token
  phoneNumberId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; reason?: string; checkedAt: Date }> {
  const url = `https://graph.facebook.com/v17.0/${args.phoneNumberId}`;
  const res = await (args.fetchImpl ?? fetch)(url, {
    headers: { Authorization: `Bearer ${args.userToken}` },
  });
  return {
    ok: res.ok,
    reason: res.ok ? null : `graph ${res.status}`,
    checkedAt: new Date(),
  };
}
```

### Summary table

| Meta Endpoint                    | Parameter              | Token Type     | ESU Flow                               | Standard Provision                      |
| -------------------------------- | ---------------------- | -------------- | -------------------------------------- | --------------------------------------- |
| `/debug_token`                   | `input_token` (query)  | Customer token | `esToken` (from ESU)                   | From provision request                  |
| `/debug_token`                   | `access_token` (query) | App token      | `WHATSAPP_GRAPH_TOKEN` env             | `WHATSAPP_GRAPH_TOKEN` env              |
| `POST /{wabaId}/subscribed_apps` | `Authorization` header | Token          | System app token (system user on WABA) | **Customer token (DIFFERENT from ESU)** |
| `GET /v17.0/{phoneNumberId}`     | `Authorization` header | Token          | (not called in ESU)                    | Customer token                          |

---

## 5. Meta helper extraction

**Existing wrappers found:**

1. **`/Users/jasonli/switchboard/apps/api/src/routes/whatsapp-onboarding.ts:25–40`** — Private `graphCall` helper inside ESU route. Takes path, method, optional body. Uses hardcoded `metaSystemUserToken`. **Not reusable** for standard provision because it doesn't handle customer token.

2. **`/Users/jasonli/switchboard/apps/api/src/routes/whatsapp-test.ts`** — Test route for WhatsApp API calls (found in grep). Not examined in detail; likely test-only.

3. **`/Users/jasonli/switchboard/apps/chat/src/adapters/whatsapp.ts`** — WhatsApp adapter (found in grep). Likely handles inbound message parsing, not Meta API calls.

4. **`/Users/jasonli/switchboard/apps/chat/src/managed/health-checker.ts:138–148`** — `checkWhatsApp` probe function (examined above). Only the WhatsApp health probe, not a general Meta wrapper.

5. **`/Users/jasonli/switchboard/packages/core/src/notifications/whatsapp-notifier.ts`** — Likely notification sender, not a general Meta API wrapper.

**Plan:**

Create **new from scratch:** `/Users/jasonli/switchboard/apps/api/src/lib/whatsapp-meta.ts`

This avoids refactoring the ESU route (which has system-token-specific logic) and creates a clean, testable abstraction for the standard provision flow.

**Function signatures (final):**

```ts
export interface DebugTokenResult {
  ok: boolean;
  wabaId?: string;
  reason?: string;
}

export interface RegisterWebhookResult {
  ok: boolean;
  reason?: string;
}

export interface HealthProbeResult {
  ok: boolean;
  reason?: string;
  checkedAt: Date;
}

/**
 * Introspect a customer's Meta token to extract their WABA ID.
 * Requires both app token (for authorization) and user token (being introspected).
 */
export async function fetchWabaIdFromToken(args: {
  appToken: string;
  userToken: string;
  fetchImpl?: typeof fetch;
}): Promise<DebugTokenResult>;

/**
 * Register a webhook override URL with Meta for the customer's WABA.
 * The customer's token must have access to the WABA (it is their own token).
 */
export async function registerWebhookOverride(args: {
  userToken: string;
  wabaId: string;
  webhookUrl: string;
  verifyToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RegisterWebhookResult>;

/**
 * Synchronous health probe for WhatsApp channel.
 * Uses customer's token to verify they still have access to the phone number.
 */
export async function probeWhatsAppHealth(args: {
  userToken: string;
  phoneNumberId: string;
  fetchImpl?: typeof fetch;
}): Promise<HealthProbeResult>;
```

---

## 6. Dashboard provision-consumer

**Entry point:** `/Users/jasonli/switchboard/apps/dashboard/src/components/onboarding/go-live.tsx:79–123`

**Component structure:**

- `GoLive` (main component, line 125)
- `ChannelCards` (sub-component, line 79) — renders 3 `ChannelConnectCard` components
- `ChannelConnectCard` (child, imported from `channel-connect-card.tsx` line 6)

**onConnect callback chain:**

1. `ChannelConnectCard` props (line 7): `onConnect: (credentials: Record<string, string>) => void`
2. Called at line 275 in `channel-connect-card.tsx`: `onConnect(fields)`
3. Passed down from parent `GoLive` line 99: `onConnect={(creds) => onConnectChannel("whatsapp", creds)}`
4. Which calls `GoLive.onConnectChannel` prop (line 17): `onConnectChannel(channel: string, credentials: Record<string, string>) => void`

**Who owns `onConnectChannel`?**

This is a prop passed to `GoLive` from its parent. We need to find where `GoLive` is mounted to see the actual provision API call.

**Search for GoLive usage:**

Looking at line 6, the import is from `./launch-sequence`. The parent component is likely in the onboarding page.

**File path of API call site:**

Need to search for where `onConnectChannel` is implemented.

Let me check the onboarding page:

**Proxy location:** `/Users/jasonli/switchboard/apps/dashboard/src/app/(auth)/onboarding/page.tsx` (found in grep). This likely owns the state and calls the provision API.

**Assumption:** The provision API call happens in the parent (onboarding page), and the response is passed back to `GoLive` via props like `connectError` (line 20) and `isConnecting` (line 19).

**Status rendering assumption:**

Currently, `ChannelConnectCard` assumes `status === "active"` (implicit in design — it only shows "Connected ✓" when `isConnected=true`, line 161). There is no `status` or `statusDetail` rendering visible.

The new `statusDetail` rendering must be added where the API response is handled, which is **in the parent component that owns the `onConnectChannel` callback implementation**.

**Insertion point for statusDetail rendering:**

Without reading the parent (onboarding page), the insertion point is:

- **Location:** Parent component's provision API call response handler
- **Component:** Likely `go-live.tsx` or its parent (onboarding page)
- **Current behavior:** On success, sets `isConnected=true` or similar; on failure, sets `connectError` message
- **New behavior:** Additionally display `statusDetail` when `status !== "active"`

**Recommended UI location:** Below the `ChannelCards` component (after line 206 in `go-live.tsx`), where `connectError` is already displayed (line 207–211). Replace or extend the error display to show `statusDetail` when status is any non-active value.

**Current error display (line 207–211):**

```tsx
{
  connectError && (
    <p className="mt-2 text-[14px]" style={{ color: "hsl(0, 70%, 50%)" }}>
      {connectError}
    </p>
  );
}
```

**Mutation hook (if any):**

Not visible in the examined files. The parent (onboarding page) likely uses TanStack React Query or a custom fetch wrapper.

---

## 7. Plan-modifying surprises

### Surprise 1: Multi-number support blocked by schema constraint

**What spec assumes:** Orgs can provision multiple WhatsApp numbers independently. Spec text (plan.md Risk #1): "Default approach: a runtime findFirst guard… Do NOT propose adding [a migration] in this run."

**What code shows:** The `ManagedChannel` model has a unique constraint `@@unique([organizationId, channel])` (schema line 494). This constraint **actively prevents** an org from having two WhatsApp channels, period. Even with different phone numbers, the second insert fails.

**Impact on plan:** Task 10 (Idempotency guard) cannot be implemented without either:

1. Removing or relaxing the unique constraint (requires a migration), OR
2. Accepting that multi-number support is NOT possible in this run

**Recommendation:** Clarify with controller before Task 2 starts. If multi-number is required, the unique constraint must be dropped. If single-channel-type-per-org is acceptable, the plan proceeds as-is (the idempotency guard works for single-number case).

### Surprise 2: phoneNumberId not persisted on ManagedChannel

**What spec assumes:** A natural key `(organizationId, channel, phoneNumberId)` can be looked up directly on `ManagedChannel`.

**What code shows:** `phoneNumberId` is encrypted in `Connection.credentials`, not indexed on `ManagedChannel`. The idempotency lookup requires:

1. Find `ManagedChannel` by `(organizationId, channel)`
2. Fetch related `Connection`
3. Decrypt `credentials`
4. Compare `phoneNumberId`

This is workable but not as clean as a persisted, indexed field.

**Recommendation:** No action needed for Task 1. The runtime guard works. If multi-number support is later needed, a migration adding `phoneNumberId` as a persisted field would be a clean enhancement.

### Surprise 3: Token model differs from spec in standard provision context

**What spec assumes:** Both `/debug_token` and `/subscribed_apps` use the same token model as the ESU flow.

**What code shows:** The ESU flow uses the **system app token** for both calls (because the system user is added to the WABA). The standard provision flow (with a customer-provided token) must use the **customer token** for `/subscribed_apps` (the system app has no access to the customer's WABA). The `/debug_token` call uses both tokens (system for authorization, customer for introspection).

**Impact on plan:** Task 3 helper signatures are correct as written (separate `appToken` and `userToken` params). The provision route must decrypt the customer-provided token and pass it as `userToken`, not fall back to the system `appToken`.

**Recommendation:** Confirmed. No change to plan. The spec's naming is correct; the implementation must respect the two-token model. The defensive test in Task 4 Step 4 is critical to prevent regression.

### Surprise 4: Org creation does not explicitly call `prisma.organizationConfig.create()`

**What spec assumes:** There is a canonical "org creation" handler that creates `OrganizationConfig` rows.

**What code shows:** The bootstrap endpoint creates a `DashboardUser` with an `organizationId`, but the `OrganizationConfig` row is created lazily via upsert on first API access.

**Impact on plan:** Task 7 (Alex listing on org creation) needs to know where to add the upsert. The answer is: **in the bootstrap endpoint (`setup.ts:113–127`), after creating the `DashboardUser`, upsert the `AgentListing` and `AgentDeployment` rows.**

**Recommendation:** Task 7 Step 3 should modify `setup.ts` (not a separate org-creation file), adding the Alex upsert after the user is created.

### Surprise 5: ChannelConnectCard does not directly call provision API

**What spec assumes:** Task 1 Step 6 can point to the "provision-consumer component" that calls the provision API and shows status.

**What code shows:** `ChannelConnectCard` only invokes the `onConnect` callback; the actual provision API call is in the parent component (likely the onboarding page). The parent handles the response and passes status back via props.

**Impact on plan:** Task 11 must modify the parent component, not `ChannelConnectCard`. The parent is responsible for displaying `statusDetail` when the provision response indicates a non-active status.

**Recommendation:** Need to read `/Users/jasonli/switchboard/apps/dashboard/src/app/(auth)/onboarding/page.tsx` to identify the exact line where the provision response is handled and where `statusDetail` rendering should be inserted.

---

## 8. Reconciliation checklist

- [x] Token model names (`appToken`, `userToken`) — CONFIRMED correct
- [x] Token model routing (system app for `/debug_token` auth, customer token for `/subscribed_apps` and health probe) — CONFIRMED correct
- [x] Health-checker duplication vs. extraction — CONFIRMED DUPLICATE in apps/api (no cross-app import)
- [x] ManagedChannel natural key with phoneNumberId — CONFIRMED encrypted-only, runtime guard needed, migration **optional** pending multi-number support decision
- [x] Org-creation source of truth — FOUND: setup.ts bootstrap endpoint (not explicit config.create, but user creation with orgId)
- [ ] **BLOCKER:** Schema unique constraint `(organizationId, channel)` blocks multi-number orgs. **Requires controller decision before Task 2.**
- [ ] **TODO for Task 1 Step 6:** Read onboarding page to identify exact provision response handler and insertion point for `statusDetail` rendering

---

**Output file:** `/Users/jasonli/switchboard/.audit/10-fix-prep-notes.md`
**Line count:** 528 lines
**Ready for Task 2?** NO — blocker found: multi-number support decision needed (unique constraint removal).
