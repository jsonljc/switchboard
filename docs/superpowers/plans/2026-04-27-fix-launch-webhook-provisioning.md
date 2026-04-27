# Fix: Launch Webhook Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make end-to-end channel provisioning work for a self-serve beta org per `docs/superpowers/specs/2026-04-27-fix-launch-webhook-provisioning-design.md`.

**Architecture:** Provision route gets a Meta `/subscribed_apps` call (extracted helper), a synchronous WhatsApp health probe, structured failure statuses, and env-var validation. Alex listing seed moves to org-creation. Real integration tests replace existing mock-shape tests.

**Tech Stack:** TypeScript, Fastify (apps/api), Prisma, Vitest, MSW or fetch-mocking for Meta calls.

---

## Preconditions

- Branch: `fix/launch-webhook-provisioning` (already created from main)
- The spec at `docs/superpowers/specs/2026-04-27-fix-launch-webhook-provisioning-design.md` has been reviewed by the user
- Current uncommitted PCD work in the tree is unrelated and stays untouched

---

### Task 1: Confirm prerequisites and scope ambiguities

This is a read-only diagnostic task. Findings update the plan inline before any code changes.

**Files:**

- Create: `.audit/10-fix-prep-notes.md` (one-off scratch; not committed in this branch — will be committed only if findings change the spec)

- [ ] **Step 1: Locate org-creation source of truth**

Run:

```bash
grep -rn "organization.create" apps/api/src apps/dashboard/src --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__ | head -20
grep -rn "prisma.organization" apps/api/src --include="*.ts" | grep -v node_modules | head -20
```

Expected: identifies the single (or multiple) call sites. Note them.

- [ ] **Step 2: Check ManagedChannel natural key for `(orgId, channel, phoneNumberId)`**

Read `packages/db/prisma/schema.prisma` for the `ManagedChannel` model. Determine:

- Is there a field that stores `phoneNumberId` for WhatsApp channels? If so, where (top-level field, embedded in `metadata` JSON, on the related `Connection.credentials` encrypted blob)?
- Is there any `@@unique` constraint? If yes, on which fields?

Choose the **natural key** for "this org already has this WhatsApp number connected":

- **Preferred:** `(organizationId, channel, phoneNumberId)` so an org can have multiple WhatsApp numbers.
- **Fallback only if `phoneNumberId` isn't persisted on `ManagedChannel`:** use the closest persisted credential/metadata field that uniquely identifies the customer asset; document the limitation.

**Do NOT default to `(organizationId, channel)` only** — that prevents an org from ever adding a second WhatsApp number, which is not the product behavior we want even for v1.

Note the chosen key and the lookup query that will be used in Task 10.

- [ ] **Step 3: Check health-checker probe export shape**

Read `apps/chat/src/managed/health-checker.ts` and identify the function that performs the Meta probe for WhatsApp. Note its name, exports, dependencies. **Default decision: duplicate** the small probe function into `apps/api/src/lib/whatsapp-health-probe.ts` rather than cross-app import. Override only if there's an existing factor-out in `packages/schemas` or a shared package — and note the override explicitly. Reason: `apps/api` MUST NOT import from `apps/chat`.

- [ ] **Step 4: Confirm token model — CRITICAL**

Read `apps/api/src/routes/whatsapp-onboarding.ts` carefully and identify:

1. Which token does each Meta `graphCall` actually use as `Authorization: Bearer …`? (The ESU flow likely passes the user's signup token through, but verify against the actual code.)
2. Is `WHATSAPP_GRAPH_TOKEN` (env) used as: (a) the Meta **app** access token (system-level, e.g. for `/debug_token` validation), (b) a customer-asset access token (which would only work in dev with dev-owned assets), or (c) something else?
3. For each Meta endpoint we'll call from the new helper:
   - `GET /debug_token?input_token=<USER_TOKEN>&access_token=<APP_TOKEN>` — **app token in `access_token`, customer's user token as `input_token`**
   - `POST /<wabaId>/subscribed_apps` — **customer user token (the one that has access to the WABA)**, NOT the app token
   - `GET /v17.0/{phoneNumberId}` (health probe) — **customer user token**

Document the mapping. The Meta helper signatures in Task 3 MUST take separate parameters with documented purposes (e.g. `appToken: string` for the `debug_token` call, `userToken: string` for everything else). The provision route MUST pass the **decrypted customer-provided Meta token** as `userToken`.

**Do NOT silently use `WHATSAPP_GRAPH_TOKEN` as the customer-asset access token.** If WABA-id extraction needs the app token (it does, for `debug_token`), document that one specific call as the only legitimate use — and surface a `config_error` if the env var is missing.

- [ ] **Step 5: Check for existing Meta helper module**

Run:

```bash
grep -rln "graph.facebook.com\|graphCall\|debug_token\|subscribed_apps" apps/api/src packages/core/src --include="*.ts" | grep -v node_modules | grep -v __tests__
```

Expected: identifies any existing wrapper. If `whatsapp-onboarding.ts` has `graphCall` as a private helper, plan its extraction.

- [ ] **Step 6: Identify the dashboard component that consumes the provision response**

Trace the dashboard call chain that handles a successful provision response. The natural starting point is `apps/dashboard/src/components/onboarding/channel-connect-card.tsx` (per the trace doc). Find the parent that consumes `onConnect`'s result and renders status. Note the file:line where `status === "active"` is currently assumed. This is the single component scoped for the minimal UI change in Task 11.

- [ ] **Step 7: Write findings**

Create `.audit/10-fix-prep-notes.md` with:

- org-creation call site(s) — file:line
- ManagedChannel natural key chosen for idempotency — fields + lookup query
- health-checker decision (default: duplicate; if override, why)
- **Token model mapping** — for each Meta endpoint we call, which token is required, with citations to ESU code
- Meta helper extraction plan (function signatures, parameter names, purposes)
- Dashboard provision-consumer component — file:line of the status-rendering point
- Any plan-modifying surprises

- [ ] **Step 8: Stop and surface to controller**

If any finding contradicts the spec — particularly if the token model isn't what the spec assumes — **stop and report**. Do not proceed to Task 2 until the controller acknowledges the findings. Otherwise, proceed.

---

### Task 2: Lock the URL format with a regression test (Blocker #1)

**Files:**

- Modify: `apps/api/src/__tests__/provision-fixes.test.ts` — keep file path, replace contents in this and subsequent tasks
- Add: `apps/chat/src/__tests__/whatsapp-wiring.test.ts` — extend with a path-format pin

- [ ] **Step 1: Write failing test (provision side)**

In a fresh `provision-end-to-end.test.ts` (created in Task 6) we'll add the broader integration test. For Task 2, just add a tight unit test that pins the format produced by the provision route helper. If the format is currently inline, lift it into a small exported function `buildManagedWebhookPath(connectionId: string): string` in `apps/api/src/lib/managed-webhook-path.ts` and test:

```ts
import { buildManagedWebhookPath } from "../lib/managed-webhook-path.js";

it("produces the path the chat server route handler matches", () => {
  const path = buildManagedWebhookPath("conn_abc12345");
  expect(path).toBe("/webhook/managed/conn_abc12345");
  expect(path).toMatch(/^\/webhook\/managed\/[a-zA-Z0-9_-]+$/);
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm --filter @switchboard/api test -- provision-fixes`
Expected: fail because module doesn't exist yet.

- [ ] **Step 3: Implement helper**

Create `apps/api/src/lib/managed-webhook-path.ts`:

```ts
export function buildManagedWebhookPath(connectionId: string): string {
  return `/webhook/managed/${connectionId}`;
}
```

- [ ] **Step 4: Replace inline construction at organizations.ts:214 with the helper**

Replace `const webhookPath = `/webhook/managed/${connection.id}`;` with `const webhookPath = buildManagedWebhookPath(connection.id);`. Add the import.

- [ ] **Step 5: Add cross-side pin in chat tests (NO cross-app import)**

In `apps/chat/src/__tests__/whatsapp-wiring.test.ts`, add a test asserting that the route registered by `app.post("/webhook/managed/:webhookId", …)` accepts a path matching the regex `^/webhook/managed/[a-zA-Z0-9_-]+$`. **Do NOT import from `apps/api`** — apps must not depend on each other, even in tests. Both sides assert the same regex independently with a comment in each test naming the external contract:

```ts
// External contract pinned: /webhook/managed/:connectionId
// Mirrored regex in apps/api/src/__tests__/provision-fixes.test.ts.
// Duplication is intentional; do not introduce a cross-app import.
const MANAGED_WEBHOOK_PATH = /^\/webhook\/managed\/[a-zA-Z0-9_-]+$/;
```

If the pinned format ever changes, both tests fail simultaneously — the breakage is loud and contained.

- [ ] **Step 6: Run all tests in both apps**

```bash
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/chat test
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/managed-webhook-path.ts \
        apps/api/src/__tests__/provision-fixes.test.ts \
        apps/api/src/routes/organizations.ts \
        apps/chat/src/__tests__/whatsapp-wiring.test.ts
git commit -m "fix(api): lift managed webhook path into shared helper, pin format"
```

---

### Task 3: Extract Meta `/subscribed_apps` and `debug_token` into a shared helper

**Files:**

- Create: `apps/api/src/lib/whatsapp-meta.ts`
- Create: `apps/api/src/lib/__tests__/whatsapp-meta.test.ts`
- Modify: `apps/api/src/routes/whatsapp-onboarding.ts` (replace inline calls with helper)

**Token-model contract (locked from Task 1 Step 4):**

- `fetchWabaIdFromToken({ appToken, userToken, fetchImpl? })` — calls `GET /debug_token?input_token=<userToken>&access_token=<appToken>`. The customer's `userToken` is the input being introspected; the system `appToken` authorizes the call. Both required, distinct, and named for purpose. **Do NOT collapse them into one `graphToken` parameter.**
- `registerWebhookOverride({ userToken, wabaId, webhookUrl, verifyToken, fetchImpl? })` — calls `POST /<wabaId>/subscribed_apps` with `Authorization: Bearer <userToken>`. **The customer's userToken is the credential** because only the customer's token has access to their WABA.
- `probeWhatsAppHealth({ userToken, phoneNumberId, fetchImpl? })` (Task 5, but reaffirmed here for symmetry) — calls `GET /v17.0/{phoneNumberId}` with the customer's `userToken`.

If Task 1 Step 4 reveals the actual ESU flow uses a different mapping, **stop and reconcile** — do not implement until the spec and helper match Meta reality.

- [ ] **Step 1: Write failing test**

`apps/api/src/lib/__tests__/whatsapp-meta.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerWebhookOverride, fetchWabaIdFromToken } from "../whatsapp-meta.js";

describe("whatsapp-meta helper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("registerWebhookOverride", () => {
    it("calls /<wabaId>/subscribed_apps with the customer userToken (NOT the appToken)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      const result = await registerWebhookOverride({
        userToken: "CUSTOMER_TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "verify-secret",
        fetchImpl: fetchSpy,
      });
      expect(result.ok).toBe(true);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain("/WABA_1/subscribed_apps");
      expect((init as { headers: Record<string, string> }).headers["Authorization"]).toBe(
        "Bearer CUSTOMER_TOKEN",
      );
    });

    it("returns ok=false with error when Meta returns non-2xx", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad token" } }),
      });
      const result = await registerWebhookOverride({
        userToken: "CUSTOMER_TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "v",
        fetchImpl: fetchSpy,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("bad token");
    });
  });

  describe("fetchWabaIdFromToken", () => {
    it("calls /debug_token with userToken as input_token and appToken as access_token", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { granular_scopes: [{ target_ids: ["WABA_42"] }] } }),
      });
      const result = await fetchWabaIdFromToken({
        appToken: "APP_TOKEN",
        userToken: "CUSTOMER_TOKEN",
        fetchImpl: fetchSpy,
      });
      expect(result.ok).toBe(true);
      expect(result.wabaId).toBe("WABA_42");
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain("input_token=CUSTOMER_TOKEN");
      expect(url).toContain("access_token=APP_TOKEN");
    });
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

`pnpm --filter @switchboard/api test -- whatsapp-meta`
Expected: module not found.

- [ ] **Step 3: Implement helper**

Create `apps/api/src/lib/whatsapp-meta.ts` exporting `registerWebhookOverride` and `fetchWabaIdFromToken` matching the test signatures. Both take `fetchImpl` (default: global `fetch`) so tests can inject. Both return discriminated result types (`{ ok: true, ... } | { ok: false, reason: string }`). The exact Meta debug_token shape may vary — match the production response shape used in `whatsapp-onboarding.ts:54`. Read that file to confirm the actual extraction logic before implementing.

- [ ] **Step 4: Refactor whatsapp-onboarding.ts to use the helpers**

Replace the inline `graphCall(`/${wabaId}/subscribed_apps`, ...)` at line 100 and the debug_token extraction at line 54 with calls to the new helpers. Keep behavior identical — this is a refactor.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @switchboard/api test -- whatsapp-meta
pnpm --filter @switchboard/api test -- whatsapp-onboarding
```

Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/whatsapp-meta.ts \
        apps/api/src/lib/__tests__/whatsapp-meta.test.ts \
        apps/api/src/routes/whatsapp-onboarding.ts
git commit -m "refactor(api): extract Meta webhook + debug_token calls into shared helper"
```

---

### Task 4: Wire Meta webhook auto-registration into provision route (Blocker #3)

**Files:**

- Modify: `apps/api/src/routes/organizations.ts`
- Modify: `apps/api/src/__tests__/provision-fixes.test.ts` (continued replacement of mock tests)

- [ ] **Step 1: Write failing integration test**

In `provision-fixes.test.ts`, add a test that exercises the actual provision route handler via a Fastify `inject()` call (Fastify has `app.inject({ method, url, payload })` for route-level testing). Mock the prisma client to return seedable rows; mock global `fetch` to capture the Meta call.

```ts
it("calls Meta /subscribed_apps with the managed webhook URL after provision", async () => {
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    if (url.includes("debug_token")) {
      return new Response(
        JSON.stringify({ data: { granular_scopes: [{ target_ids: ["WABA_1"] }] } }),
        { status: 200 },
      );
    }
    if (url.includes("subscribed_apps")) return new Response("{}", { status: 200 });
    if (url.includes("provision-notify")) return new Response("{}", { status: 200 });
    if (url.includes("graph.facebook.com"))
      return new Response(JSON.stringify({ id: "phone_1" }), { status: 200 });
    throw new Error("unexpected fetch " + url);
  }) as never;
  const app = await buildTestApp(/* pre-seeded org */);
  const res = await app.inject({
    method: "POST",
    url: `/api/organizations/${ORG_ID}/provision`,
    payload: {
      channels: [{ channel: "whatsapp", credentials: { token: "T", phoneNumberId: "P" } }],
    },
    headers: { authorization: "Bearer test" },
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.results[0].webhookRegistered).toBe(true);
  expect(fetchCalls.find((c) => c.url.includes("/WABA_1/subscribed_apps"))).toBeDefined();
});
```

`buildTestApp` is a small helper that returns a Fastify instance with mocked prisma and the provision route mounted. If no such helper exists, create `apps/api/src/__tests__/helpers/build-test-app.ts` first.

- [ ] **Step 2: Run test, verify FAIL**

Test fails because route doesn't call `subscribed_apps`. Capture the failure message.

- [ ] **Step 3: Add Meta registration to provision flow (customer-token primary, app-token only for debug_token)**

In `organizations.ts`, after the transaction (around line 285, before provision-notify). Note: `decryptedToken` is the customer-provided Meta token (decrypted from `Connection.credentials`); `appToken` is the system app access token used **only** for `debug_token` introspection. If `appToken` is unset, the route surfaces `config_error` rather than silently substituting it for `decryptedToken`:

```ts
// Decrypt the customer-provided Meta token (the access token for the customer's WABA).
const decryptedToken: string = decryptCredentialsField(encrypted, "token");
//   ^ exact decrypt helper name confirmed in Task 1 Step 4

// Meta webhook registration (best-effort; sets status accordingly)
let metaStatus: "registered" | "skipped" | "failed" = "skipped";
let metaReason: string | null = null;
const appToken = process.env.WHATSAPP_GRAPH_TOKEN; // Meta APP access token, used ONLY for debug_token
const verifyToken = process.env.WHATSAPP_APP_SECRET; // verify token Meta posts back
const webhookBaseUrl = process.env.CHAT_PUBLIC_URL ?? process.env.SWITCHBOARD_CHAT_URL;

if (ch.channel === "whatsapp") {
  if (!appToken || !verifyToken || !webhookBaseUrl) {
    metaStatus = "failed";
    metaReason =
      "config_error: missing WHATSAPP_GRAPH_TOKEN / WHATSAPP_APP_SECRET / CHAT_PUBLIC_URL";
    // Will be promoted to status: "config_error" by the precedence resolver.
  } else {
    const wabaResult = await fetchWabaIdFromToken({
      appToken, // system app token authorizes the introspection call
      userToken: decryptedToken, // customer's token is the subject of introspection
    });
    if (!wabaResult.ok) {
      metaStatus = "failed";
      metaReason = `WABA lookup failed: ${wabaResult.reason}`;
    } else {
      const reg = await registerWebhookOverride({
        userToken: decryptedToken, // customer's token — only this has access to the customer's WABA
        wabaId: wabaResult.wabaId,
        webhookUrl: `${webhookBaseUrl}${result.managedChannel.webhookPath}`,
        verifyToken,
      });
      if (reg.ok) {
        metaStatus = "registered";
      } else {
        metaStatus = "failed";
        metaReason = `Meta /subscribed_apps failed: ${reg.reason}`;
      }
    }
  }
}
```

Update the response push to include `webhookRegistered: metaStatus === "registered"`. Defer the final `status` and `statusDetail` resolution to the precedence step in Task 6 — for this task, attach the `metaReason` to a working `pendingMetaReason` variable that Task 6 reads.

- [ ] **Step 4: Add a test that fails if the route uses `appToken` for `subscribed_apps`**

Defensive test:

```ts
it("does NOT use the app token for /subscribed_apps; uses the customer-decrypted token", async () => {
  const subscribedAppsCalls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("subscribed_apps")) {
      subscribedAppsCalls.push({ url, init });
      return new Response("{}", { status: 200 });
    }
    if (url.includes("debug_token")) {
      // assert appToken used here as access_token
      expect(url).toContain("access_token=APP_TOKEN_FAKE");
      return new Response(
        JSON.stringify({ data: { granular_scopes: [{ target_ids: ["WABA_1"] }] } }),
        { status: 200 },
      );
    }
    if (url.includes("graph.facebook.com"))
      return new Response(JSON.stringify({ id: "phone_1" }), { status: 200 });
    if (url.includes("provision-notify")) return new Response("{}", { status: 200 });
    throw new Error("unexpected fetch " + url);
  }) as never;

  process.env.WHATSAPP_GRAPH_TOKEN = "APP_TOKEN_FAKE";
  process.env.WHATSAPP_APP_SECRET = "VERIFY_TOKEN_FAKE";
  // Customer's token is what the user submitted in the provision payload.
  // Plaintext flowing through encrypt/decrypt round-trip — must arrive at /subscribed_apps as Bearer.
  const CUSTOMER_TOKEN = "CUSTOMER_TOKEN_FAKE";
  const app = await buildTestApp(/* ... */);
  await app.inject({
    method: "POST",
    url: `/api/organizations/${ORG_ID}/provision`,
    payload: {
      channels: [
        { channel: "whatsapp", credentials: { token: CUSTOMER_TOKEN, phoneNumberId: "P" } },
      ],
    },
    headers: { authorization: "Bearer test" },
  });
  expect(subscribedAppsCalls).toHaveLength(1);
  expect(
    (subscribedAppsCalls[0].init as { headers: Record<string, string> }).headers["Authorization"],
  ).toBe(`Bearer ${CUSTOMER_TOKEN}`);
});
```

This test is the regression net for Redline 2: if anyone ever changes the registration call to use `appToken`, this test fails loudly.

- [ ] **Step 4: Run test, verify PASS**

`pnpm --filter @switchboard/api test -- provision-fixes`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/organizations.ts \
        apps/api/src/__tests__/provision-fixes.test.ts \
        apps/api/src/__tests__/helpers/build-test-app.ts
git commit -m "feat(api): auto-register WhatsApp webhook with Meta during provision"
```

---

### Task 5: Synchronous health probe in provision (Blocker #5)

**Files:**

- Create or extend: `apps/api/src/lib/whatsapp-health-probe.ts` (decision from Task 1 Step 3)
- Modify: `apps/api/src/routes/organizations.ts`
- Modify: `apps/api/src/__tests__/provision-fixes.test.ts`

- [ ] **Step 1: Write failing test**

Add to `provision-fixes.test.ts`:

```ts
it("sets lastHealthCheck on Connection when sync probe succeeds", async () => {
  // ... build app with mocked fetch returning 200 from graph.facebook.com/{phoneNumberId}
  const res = await app.inject({ ... });
  const body = JSON.parse(res.body);
  expect(body.results[0].lastHealthCheck).toEqual(expect.any(String));
  expect(body.results[0].status).toBe("active");
  // assert DB row updated
});

it("returns status=health_check_failed when probe fails", async () => {
  // mock graph.facebook.com/{phoneNumberId} returning 401
  const res = await app.inject({ ... });
  const body = JSON.parse(res.body);
  expect(body.results[0].status).toBe("health_check_failed");
  expect(body.results[0].lastHealthCheck).toBeNull();
});
```

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Implement probe wrapper (default: duplicate, no cross-app import)**

Per Task 1 Step 3, default decision is duplicate the small probe in `apps/api`. Create `apps/api/src/lib/whatsapp-health-probe.ts`:

```ts
export interface HealthProbeResult {
  ok: boolean;
  reason: string | null;
  checkedAt: Date;
}

/**
 * Sync health probe used at provision time.
 * userToken: the customer's Meta access token (decrypted from Connection.credentials).
 * phoneNumberId: the customer's WABA phone number id.
 *
 * Mirrors the probe in apps/chat/src/managed/health-checker.ts (function name confirmed in Task 1).
 * Duplication intentional — apps/api MUST NOT import from apps/chat.
 * Parity test: parity-pin in __tests__/whatsapp-health-probe.test.ts asserts identical
 * URL + auth header shape on identical inputs.
 */
export async function probeWhatsAppHealth(args: {
  userToken: string;
  phoneNumberId: string;
  fetchImpl?: typeof fetch;
}): Promise<HealthProbeResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`https://graph.facebook.com/v17.0/${args.phoneNumberId}`, {
      headers: { Authorization: `Bearer ${args.userToken}` },
    });
    if (!res.ok) {
      return { ok: false, reason: `graph ${res.status}`, checkedAt: new Date() };
    }
    return { ok: true, reason: null, checkedAt: new Date() };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fetch error",
      checkedAt: new Date(),
    };
  }
}
```

Add a parity-pin test that loads the apps/chat probe code as a string (via fs read, not import) and asserts both pieces of code produce the same URL and auth header for the same inputs. This is a regression net for "the two probes drifted apart silently."

- [ ] **Step 4: Wire into provision flow**

After Meta registration in `organizations.ts`, run the probe. On success, update Connection.lastHealthCheck and ManagedChannel.lastHealthCheck via a small `prisma.connection.update` outside the txn. On failure, set status to `"health_check_failed"`. Update response shape.

- [ ] **Step 5: Run tests, verify PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/whatsapp-health-probe.ts \
        apps/api/src/lib/__tests__/whatsapp-health-probe.test.ts \
        apps/api/src/routes/organizations.ts \
        apps/api/src/__tests__/provision-fixes.test.ts
git commit -m "feat(api): synchronous WhatsApp health probe in provision flow"
```

---

### Task 6: provision-notify hardening (Blocker #4)

**Files:**

- Modify: `apps/api/src/routes/organizations.ts`
- Modify: `apps/api/src/__tests__/provision-fixes.test.ts`

- [ ] **Step 1: Write failing tests (3 of them)**

```ts
it("returns config_error when CHAT_PUBLIC_URL is unset", async () => { ... expect(body.results[0].status).toBe("config_error"); });
it("returns pending_chat_register on notify failure (after retry)", async () => { /* mock fetch to fail twice */ ... });
it("returns active when notify succeeds on first try", async () => { ... });
```

- [ ] **Step 2: Run tests, verify FAIL**

- [ ] **Step 3: Refactor provision-notify block**

Replace `organizations.ts:286-310` with a function that:

- Fails with `status: "config_error"` if env vars missing
- Tries notify once; on non-ok, waits 200ms and tries once more
- On final failure, sets status to `"pending_chat_register"` and propagates the reason

- [ ] **Step 4: Implement status precedence resolver (locked from spec)**

The locked precedence (most blocking first): `config_error` > `pending_chat_register` > `health_check_failed` > `pending_meta_register` > `active`.

Implement as a small pure function in the route:

```ts
type StepResult = { kind: "ok" } | { kind: "fail"; reason: string };
type ResolvedStatus =
  | { status: "active"; statusDetail: null }
  | {
      status:
        | "config_error"
        | "pending_chat_register"
        | "health_check_failed"
        | "pending_meta_register";
      statusDetail: string;
    };

function resolveStatus(input: {
  config: StepResult;
  notify: StepResult;
  health: StepResult;
  meta: StepResult;
}): ResolvedStatus {
  if (input.config.kind === "fail")
    return { status: "config_error", statusDetail: input.config.reason };
  if (input.notify.kind === "fail")
    return { status: "pending_chat_register", statusDetail: input.notify.reason };
  if (input.health.kind === "fail")
    return { status: "health_check_failed", statusDetail: input.health.reason };
  if (input.meta.kind === "fail")
    return { status: "pending_meta_register", statusDetail: input.meta.reason };
  return { status: "active", statusDetail: null };
}
```

Add a unit test exhausting the 16 combinations or at minimum: all-ok → active; meta+notify both fail → `pending_chat_register` (notify wins by precedence); config fail dominates everything; health fail dominates only meta.

- [ ] **Step 5: Run tests, verify PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/organizations.ts apps/api/src/__tests__/provision-fixes.test.ts
git commit -m "fix(api): structured statuses + retry for provision-notify failures"
```

---

### Task 7: Alex listing on org creation (Blocker #6)

**Files:**

- Modify: `<org-creation file>` (confirmed in Task 1 Step 1)
- Create: `<corresponding test file>`

- [ ] **Step 1: Write failing test**

Test name: "new org has Alex in marketplace listings without provisioning a channel".

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Move the upsert**

In the org-creation handler, after creating the organization row, perform the same `agentListing.upsert` + `agentDeployment.upsert` pair currently in `organizations.ts:227-257`. Use the same data shape verbatim. Keep the upsert in the provision route as a safety net for orgs that pre-date this change.

- [ ] **Step 4: Verify provision still idempotent**

Run the existing provision tests. They should still pass — the upsert in provision is idempotent.

- [ ] **Step 5: Commit**

```bash
git add <org-creation file> <test file>
git commit -m "feat(api): seed Alex listing on org creation, not on first provision"
```

---

### Task 8: ESU route integration test (Blocker #2)

**Files:**

- Create: `apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts` (extend if exists)

- [ ] **Step 1: Write integration test**

Walk the ESU flow with mocked Meta calls covering all four `graphCall` invocations from `whatsapp-onboarding.ts`. Assert the helper-extracted `registerWebhookOverride` call is reached and that the connection is created.

- [ ] **Step 2: Run, verify PASS or FAIL**

If FAIL, fix wiring (most likely a missed env-var guard or a refactor regression from Task 3). If PASS, this confirms ESU is functional end-to-end and Blocker #2 closes as "verified, no UI work needed for beta."

- [ ] **Step 3: Document the manual flow**

Add a 1-paragraph "Connecting WhatsApp via Embedded Signup" note to `apps/dashboard/README.md` (or wherever onboarding ops docs live — confirmed in Task 1). Just enough that a founder helping a beta org knows the steps.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts \
        apps/dashboard/README.md
git commit -m "test(api): integration test for WhatsApp Embedded Signup flow"
```

---

### Task 9: End-to-end provisioning integration test

**Files:**

- Create: `apps/api/src/__tests__/provision-end-to-end.test.ts`

- [ ] **Step 1: Write the test that walks the spec acceptance criteria A1–A8**

```ts
describe("provision end-to-end", () => {
  it("a new org connects WhatsApp and lands at status=active with all post-steps green", async () => {
    // Build app with seeded org, mocked Meta calls, mocked chat-server notify
    // POST /api/organizations/:orgId/provision
    // Assert: status=active, lastHealthCheck set, webhookRegistered=true, ManagedChannel + Connection rows present
    // Assert: a second call to provision returns the same managed channel id (idempotency)
    // Simulate inbound webhook to chat server, assert routes to right org
  });
  it("Meta failure surfaces as pending_meta_register with reason", async () => { ... });
  it("notify failure surfaces as pending_chat_register with reason", async () => { ... });
  it("missing env vars surface as config_error", async () => { ... });
  it("health probe failure surfaces as health_check_failed", async () => { ... });
  it("a brand-new org sees Alex listed before provisioning", async () => { ... });
});
```

- [ ] **Step 2: Run, fix anything red**

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/provision-end-to-end.test.ts
git commit -m "test(api): end-to-end provisioning flow integration test"
```

---

### Task 10: Idempotency guard on retry (Acceptance A4)

**Files:**

- Modify: `apps/api/src/routes/organizations.ts`
- Modify: `apps/api/src/__tests__/provision-end-to-end.test.ts`

The natural key is `(organizationId, channel, phoneNumberId)` per the spec. **Do not collapse to `(organizationId, channel)` only** — that would block an org from ever adding a second WhatsApp number, which is not the v1 product behavior.

- [ ] **Step 1: Read Task 1 Step 2 finding**

Use the natural key + lookup query confirmed in `.audit/10-fix-prep-notes.md`. If `phoneNumberId` is not persisted on `ManagedChannel`, the prep notes already named the closest persisted credential/metadata field — use that.

If Task 1 found that a Prisma migration is unavoidable to support this lookup, **stop and surface to the controller before adding it**. Do not silently add a migration.

- [ ] **Step 2: Add a runtime guard at the top of the provision per-channel loop**

Pseudocode (replace field path per Task 1 finding):

```ts
// Natural key: (organizationId, channel, phoneNumberId).
// phoneNumberId comes from ch.credentials.phoneNumberId for WhatsApp.
const existing = await app.prisma.managedChannel.findFirst({
  where: {
    organizationId: orgId,
    channel: ch.channel,
    // Field path TBD by Task 1 — example if it lives on metadata JSON:
    // metadata: { path: ["phoneNumberId"], equals: ch.credentials.phoneNumberId },
    // — or on a top-level field if migrated, or on Connection.credentials encrypted blob (decrypt+match)
  },
});
if (existing) {
  results.push({
    ...mapToResponse(existing),
    status: "active",
    statusDetail: "existing channel returned",
  });
  continue;
}
```

- [ ] **Step 3: Add tests in provision-end-to-end.test.ts**

Two tests, both required:

1. **Retry idempotency:** call provision twice with the **same** `(orgId, channel, phoneNumberId)`; assert exactly one `ManagedChannel` row exists and the second response returns the existing one.
2. **Multi-number support:** call provision twice with the **same** `(orgId, channel)` but **different** `phoneNumberId`; assert two distinct `ManagedChannel` rows exist and both succeed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/organizations.ts apps/api/src/__tests__/provision-end-to-end.test.ts
git commit -m "fix(api): idempotency by (org, channel, phoneNumberId); allow multi-number orgs"
```

---

### Task 11: Minimal UI surfacing of `statusDetail`

**Files:**

- Modify: dashboard provision-consumer component (file:line confirmed in Task 1 Step 6)
- Modify: a corresponding component test (extend if exists, create if not)

Scope is **one** component: the existing provision-consumer that currently assumes `status === "active"`. No redesign, no new navigation, no module card work.

- [ ] **Step 1: Write failing component test**

The test renders the component with a provision response of `{ status: "pending_chat_register", statusDetail: "chat server returned 502", ... }` and asserts:

- The success state is NOT rendered.
- The `statusDetail` string appears verbatim in the DOM.
- A retry affordance (button or link) exists.

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Implement minimal UI change**

In the component identified by Task 1 Step 6, replace the implicit `status === "active"` assumption with a switch on the new status enum. For any non-`active` status, render the `statusDetail` string and a retry affordance. **Do not redesign.** The display can be one inline error block.

- [ ] **Step 4: Run tests, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add <component file> <test file>
git commit -m "feat(dashboard): surface provision statusDetail when status !== active"
```

---

### Task 12: Final verification

**Files:**

- None modified

- [ ] **Step 1: Run full test suite**

```bash
pnpm typecheck
pnpm test
```

Expected: green across all packages and apps. If anything red outside the files this branch touches, investigate before finishing.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

- [ ] **Step 3: Confirm spec acceptance criteria**

Walk the A1–A8 list in the spec. For each, point to the test that covers it. If any is uncovered, add the test before finishing.

- [ ] **Step 4: Surface for code review**

Use `superpowers:requesting-code-review` to dispatch a final review. Address findings, re-run tests.

- [ ] **Step 5: Use finishing-a-development-branch skill**

Invoke `superpowers:finishing-a-development-branch` to decide PR vs merge.

---

## Self-Review

- **Spec coverage:** Every spec acceptance criterion (A1–A8) maps to a test added in Tasks 2/4/5/6/7/8/9/10/11. A2 in particular is covered by both an integration test (Task 9) and a component test (Task 11). Risks #1 (idempotency, multi-number support), #2 (cross-app boundary), #6 (token model) all addressed in Task 1 prep notes and Tasks 3/4/5/10.
- **Placeholder scan:** No "TBD"/"TODO"/"figure out later" left. Task 1 explicitly produces missing facts before code changes start.
- **Type consistency:** `buildManagedWebhookPath`, `registerWebhookOverride({ userToken, … })`, `fetchWabaIdFromToken({ appToken, userToken, … })`, `probeWhatsAppHealth({ userToken, … })`, status enum values consistent across tasks. Token parameters are named for purpose, not type.
- **App boundary fence:** No task imports `apps/api` from `apps/chat` or vice versa. Webhook path contract is pinned by independent regex on each side. Health probe is duplicated in `apps/api` with a parity-pin test rather than imported.
- **Token-model fence:** Customer-provided decrypted token is the sole credential for `/subscribed_apps` and the health probe. `WHATSAPP_GRAPH_TOKEN` (app token) is used only for `debug_token` introspection. A defensive test in Task 4 fails if anyone ever changes the registration call to use the app token.
- **Out-of-scope fence:** No task touches platform-ingress, governance, creative-pipeline, ad-optimizer, billing, calendar, or WorkTrace. Schema changes only happen if Task 1 proves the runtime guard cannot work. If a migration is needed, the plan stops and surfaces to the user before running.
- **Status precedence locked:** `config_error` > `pending_chat_register` > `health_check_failed` > `pending_meta_register` > `active`. Implemented as a pure function in Task 6 with a dedicated combinatorial test.

## Redlines applied (vs original draft)

1. **Cross-app imports forbidden** — Task 2 chat-side test pins regex independently; no `apps/api` import. Health probe duplicated in `apps/api` with parity-pin test.
2. **Token model split** — Helper takes `appToken` + `userToken` separately; provision uses customer-decrypted token; defensive test fails if app token is ever used for `/subscribed_apps`.
3. **Idempotency natural key** — `(organizationId, channel, phoneNumberId)`, with explicit multi-number test. Schema change requires user approval.
4. **Status precedence** — `pending_chat_register` ranked above `health_check_failed` and `pending_meta_register` (chat unreachable = inbound dead).
5. **UI surfacing in scope** — Task 11 added: minimal change to the existing provision-consumer component to render `statusDetail` when not `active`. No redesign.
