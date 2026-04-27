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

- [ ] **Step 2: Check ManagedChannel uniqueness**

Read `packages/db/prisma/schema.prisma` for the `ManagedChannel` model. Confirm whether there is a `@@unique` on `(organizationId, channel)` or `(organizationId, phoneNumberId)`. Note the answer.

- [ ] **Step 3: Check health-checker probe export shape**

Read `apps/chat/src/managed/health-checker.ts` and identify the function that performs the Meta probe for WhatsApp. Note its name, exports, dependencies. Decide:

- (a) reusable from `apps/api` directly, or
- (b) needs a parallel implementation in `apps/api/src/lib/whatsapp-health-probe.ts`

- [ ] **Step 4: Check for existing Meta helper module**

Run:

```bash
grep -rln "graph.facebook.com\|graphCall\|debug_token\|subscribed_apps" apps/api/src packages/core/src --include="*.ts" | grep -v node_modules | grep -v __tests__
```

Expected: identifies any existing wrapper. If `whatsapp-onboarding.ts` has `graphCall` as a private helper, decide whether to extract it.

- [ ] **Step 5: Write findings**

Create `.audit/10-fix-prep-notes.md` with:

- org-creation call site(s) — file:line
- ManagedChannel uniqueness state (yes/no — if no, choice: guard-at-runtime vs migration)
- health-checker decision (a or b)
- Meta helper extraction plan
- Any plan-modifying surprises

- [ ] **Step 6: Stop and surface to controller**

If any finding contradicts the spec (e.g., org creation is in dashboard not api, or schema requires migration), pause and update the plan before continuing. Otherwise, proceed to Task 2.

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

- [ ] **Step 5: Add cross-side pin in chat tests**

In `apps/chat/src/__tests__/whatsapp-wiring.test.ts`, add a test asserting that the route registered by `app.post("/webhook/managed/:webhookId", …)` matches a path produced by `buildManagedWebhookPath`. Import the helper from apps/api via a relative path or duplicate the regex pin (avoid cross-app import). Document the choice in the test file with a one-line comment if duplicating.

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
    it("calls /<wabaId>/subscribed_apps with override_callback_uri and verify_token", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
      const result = await registerWebhookOverride({
        graphToken: "TOKEN",
        wabaId: "WABA_1",
        webhookUrl: "https://chat.example.com/webhook/managed/conn_1",
        verifyToken: "verify-secret",
        fetchImpl: fetchSpy,
      });
      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/WABA_1/subscribed_apps"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("returns ok=false with error when Meta returns non-2xx", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad token" } }),
      });
      const result = await registerWebhookOverride({
        graphToken: "TOKEN",
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
    it("extracts WABA ID from debug_token response", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { granular_scopes: [{ target_ids: ["WABA_42"] }] } }),
      });
      const result = await fetchWabaIdFromToken({
        graphToken: "TOKEN",
        userToken: "USER_TOKEN",
        fetchImpl: fetchSpy,
      });
      expect(result.ok).toBe(true);
      expect(result.wabaId).toBe("WABA_42");
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

- [ ] **Step 3: Add Meta registration to provision flow**

In `organizations.ts`, after the transaction (around line 285, before provision-notify):

```ts
// Meta webhook registration (best-effort; sets status accordingly)
let metaStatus: "registered" | "skipped" | "failed" = "skipped";
let metaReason: string | null = null;
const graphToken = process.env.WHATSAPP_GRAPH_TOKEN;
const appSecret = process.env.WHATSAPP_APP_SECRET;
const webhookBaseUrl = process.env.CHAT_PUBLIC_URL ?? process.env.SWITCHBOARD_CHAT_URL;
if (ch.channel === "whatsapp" && graphToken && appSecret && webhookBaseUrl) {
  const wabaResult = await fetchWabaIdFromToken({
    graphToken,
    userToken: decryptedToken,
  });
  if (!wabaResult.ok) {
    metaStatus = "failed";
    metaReason = `WABA lookup failed: ${wabaResult.reason}`;
  } else {
    const reg = await registerWebhookOverride({
      graphToken,
      wabaId: wabaResult.wabaId,
      webhookUrl: `${webhookBaseUrl}${result.managedChannel.webhookPath}`,
      verifyToken: appSecret,
    });
    if (reg.ok) {
      metaStatus = "registered";
    } else {
      metaStatus = "failed";
      metaReason = `Meta /subscribed_apps failed: ${reg.reason}`;
    }
  }
}
```

(`decryptedToken` requires decrypting credentials; check whether the existing flow already has this in scope. If not, decrypt here using the same `encryptCredentials` helper inverse.)

Update the response push to include `webhookRegistered: metaStatus === "registered"` and propagate `metaReason` into `statusDetail` per the new status-shape in the spec.

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

- [ ] **Step 3: Implement probe wrapper**

Per Task 1 Step 3 decision: if reusable, import; if not, create `apps/api/src/lib/whatsapp-health-probe.ts`:

```ts
export interface HealthProbeResult {
  ok: boolean;
  reason: string | null;
  checkedAt: Date;
}
export async function probeWhatsAppHealth(args: {
  token: string;
  phoneNumberId: string;
  fetchImpl?: typeof fetch;
}): Promise<HealthProbeResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`https://graph.facebook.com/v17.0/${args.phoneNumberId}`, {
      headers: { Authorization: `Bearer ${args.token}` },
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

- [ ] **Step 4: Verify status precedence**

Decide and document the precedence when multiple post-create steps fail (e.g., Meta failed AND notify failed). Suggested order, most blocking first: `config_error` > `health_check_failed` > `pending_meta_register` > `pending_chat_register` > `active`. Add a unit test for this ordering.

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

- [ ] **Step 1: Confirm Task 1 Step 2 finding**

If a unique constraint exists on ManagedChannel for `(organizationId, channel)` or `(organizationId, phoneNumberId)`, the upsert path naturally handles retry. Skip to Step 3.

If no constraint exists, proceed to Step 2.

- [ ] **Step 2: Add a runtime guard (no migration)**

At the top of the provision per-channel loop:

```ts
const existing = await app.prisma.managedChannel.findFirst({
  where: { organizationId: orgId, channel: ch.channel },
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

- [ ] **Step 3: Add idempotency test in provision-end-to-end.test.ts**

Already in Task 9 list — verify it passes. If failing, fix the guard.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/organizations.ts apps/api/src/__tests__/provision-end-to-end.test.ts
git commit -m "fix(api): idempotency guard on duplicate provision calls"
```

---

### Task 11: Final verification

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

- **Spec coverage:** Every spec acceptance criterion (A1–A8) maps to a test added in Tasks 2/4/5/6/7/8/9/10. Risks #1 (idempotency), #2 (cross-app imports), #4 (Meta rate) are addressed in Task 1 prep notes and Task 5/10. Risk #3 (probe latency) is acknowledged but not addressed in code — acceptable per spec.
- **Placeholder scan:** No "TBD"/"TODO"/"figure out later" left. Task 1 explicitly produces missing facts before code changes start.
- **Type consistency:** `buildManagedWebhookPath`, `registerWebhookOverride`, `fetchWabaIdFromToken`, `probeWhatsAppHealth`, status enum values consistent across tasks.
- **Out-of-scope fence:** No task touches platform-ingress, governance, creative-pipeline, ad-optimizer, billing, calendar, or WorkTrace. Schema changes only happen if Task 1 Step 2 reveals a missing unique constraint AND the team prefers a migration over the runtime guard in Task 10. If a migration is opened, surface to user before running.
