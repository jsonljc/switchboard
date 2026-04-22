# Hardening Round 2 — PR1: Security & Correctness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four security/correctness bugs with surgical, minimal-blast-radius changes.

**Architecture:** No architectural change. Each fix is independent and isolated to 1-2 files. The C3 fix is an interim guard that PR2 will supersede when it deletes the legacy approval path.

**Tech Stack:** Node.js crypto, Fastify middleware, Vitest

**Spec:** `docs/superpowers/specs/2026-04-22-hardening-round2-design.md`

---

### Task 1: C1 — Add org + actor to idempotency fingerprint

**Files:**

- Modify: `apps/api/src/middleware/idempotency.ts`
- Modify: `apps/api/src/__tests__/api-idempotency.test.ts`

- [ ] **Step 1: Write failing test for cross-org idempotency isolation**

Add this test to `apps/api/src/__tests__/api-idempotency.test.ts` inside the existing `describe("Idempotency Middleware", ...)` block, after the last `it(...)`:

```typescript
it("returns 409 when the same key is used by a different org", async () => {
  // First request with org_alpha
  const first = await app.inject({
    method: "POST",
    url: "/api/actions/propose",
    headers: {
      "idempotency-key": "cross-org-key",
      "x-organization-id": "org_alpha",
    },
    payload: proposePayload,
  });

  expect(first.statusCode).toBe(201);

  // Same key, same payload, different org
  const second = await app.inject({
    method: "POST",
    url: "/api/actions/propose",
    headers: {
      "idempotency-key": "cross-org-key",
      "x-organization-id": "org_beta",
    },
    payload: proposePayload,
  });

  // Different org = different fingerprint = 409 mismatch
  expect(second.statusCode).toBe(409);
  expect(second.json().error).toContain("Idempotency-Key");
});

it("returns 409 when the same key is used by a different principal", async () => {
  const first = await app.inject({
    method: "POST",
    url: "/api/actions/propose",
    headers: {
      "idempotency-key": "cross-actor-key",
      "x-principal-id": "user_alice",
    },
    payload: proposePayload,
  });

  expect(first.statusCode).toBe(201);

  const second = await app.inject({
    method: "POST",
    url: "/api/actions/propose",
    headers: {
      "idempotency-key": "cross-actor-key",
      "x-principal-id": "user_bob",
    },
    payload: proposePayload,
  });

  expect(second.statusCode).toBe(409);
  expect(second.json().error).toContain("Idempotency-Key");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run -t "same key is used by a different org"`

Expected: FAIL — both requests currently produce the same fingerprint so the second returns 201 (cached) instead of 409.

- [ ] **Step 3: Update computeFingerprint to include org and actor**

In `apps/api/src/middleware/idempotency.ts`, replace the `computeFingerprint` function:

```typescript
function computeFingerprint(request: FastifyRequest): string {
  const method = request.method;
  const route = request.routerPath ?? request.routeOptions.url ?? request.url;
  const orgId = request.organizationIdFromAuth ?? request.headers["x-organization-id"] ?? "";
  const actorId = request.principalIdFromAuth ?? request.headers["x-principal-id"] ?? "";
  const bodyHash = createHash("sha256")
    .update(JSON.stringify(request.body ?? null))
    .digest("hex");
  return `${method}:${route}:${orgId}:${actorId}:${bodyHash}`;
}
```

- [ ] **Step 4: Run all idempotency tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run -t "Idempotency"`

Expected: All tests PASS, including the two new cross-org and cross-actor tests.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: scope idempotency fingerprint to org + actor

Add organizationIdFromAuth and principalIdFromAuth to the idempotency
fingerprint so the same key from different tenants or actors produces
a 409 mismatch instead of a cached cross-tenant response.
EOF
)"
```

---

### Task 2: C3 — Make trace update non-optional before execution (temporary guard)

**Files:**

- Modify: `packages/core/src/platform/platform-lifecycle.ts`
- Modify: `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`

- [ ] **Step 1: Write failing test — patch with trace update failure must throw**

Add this test to `packages/core/src/platform/__tests__/platform-lifecycle.test.ts` inside the appropriate describe block (look for a `describe` covering `respondToApproval` or patch behavior):

```typescript
it("throws when trace update fails during patch (no silent proceed)", async () => {
  const envelopeId = `env-${randomUUID()}`;
  const approvalId = `approval-${randomUUID()}`;

  const state = createApprovalState({
    expiresAt: new Date(Date.now() + 86400000),
    quorum: null,
  });

  approvalStore.getById.mockResolvedValue({
    request: makeApprovalRequest({
      id: approvalId,
      envelopeId,
      approvers: [],
    }),
    envelopeId,
    organizationId: ORG_ID,
    state,
  });

  envelopeStore.getById.mockResolvedValue(makeEnvelope(envelopeId, { status: "pending_approval" }));

  // Force trace update to fail
  traceStore.update.mockRejectedValue(new Error("Trace store unavailable"));
  traceStore.getByWorkUnitId.mockResolvedValue(null);

  await expect(
    lifecycle.respondToApproval({
      approvalId,
      action: "patch",
      respondedBy: "approver-1",
      bindingHash: BINDING_HASH,
      patchValue: { campaignId: "camp-patched" },
    }),
  ).rejects.toThrow("Trace store unavailable");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run -t "trace update fails during patch"`

Expected: FAIL — the current code catches and swallows the error, so the promise resolves instead of rejecting.

- [ ] **Step 3: Remove silent catch in updateWorkTraceApproval**

In `packages/core/src/platform/platform-lifecycle.ts`, replace the `updateWorkTraceApproval` method (around line 544-561):

```typescript
  private async updateWorkTraceApproval(
    workUnitId: string,
    fields: {
      approvalId: string;
      approvalOutcome: WorkTrace["approvalOutcome"];
      approvalRespondedBy: string;
      approvalRespondedAt: string;
      outcome?: WorkTrace["outcome"];
      completedAt?: string;
      parameters?: Record<string, unknown>;
    },
  ): Promise<void> {
    // Temporary guard (PR2 deletes this method entirely).
    // Trace update MUST succeed before execution proceeds — silent failure
    // would cause executeAfterApproval to use stale parameters.
    await this.config.traceStore.update(workUnitId, fields);
  }
```

Also update `updateWorkTraceOutcome` (around line 563-572) to propagate errors:

```typescript
  private async updateWorkTraceOutcome(
    workUnitId: string,
    outcome: WorkTrace["outcome"],
  ): Promise<void> {
    await this.config.traceStore.update(workUnitId, {
      outcome,
      completedAt: new Date().toISOString(),
    });
  }
```

- [ ] **Step 4: Run all platform-lifecycle tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run -t "PlatformLifecycle"`

Expected: All tests PASS. Some existing tests may need their `traceStore.update` mock to resolve (not reject) — check and fix any that assumed silent failure.

- [ ] **Step 5: If existing tests fail, fix their trace store mocks**

If any existing tests were relying on the silent catch (e.g., not mocking `traceStore.update` at all and it threw), add `traceStore.update.mockResolvedValue(undefined)` to those tests' `beforeEach` or individual setups.

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run -t "PlatformLifecycle"`

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: propagate trace update errors in PlatformLifecycle

Remove silent catch in updateWorkTraceApproval and updateWorkTraceOutcome.
If trace update fails, the error now propagates, preventing
executeAfterApproval from running with stale parameters.

Temporary guard — PR2 deletes respondToApproval entirely.
EOF
)"
```

---

### Task 3: H7 — Unify API key encryption to one env var and one derivation

**Files:**

- Modify: `apps/dashboard/src/lib/crypto.ts`
- Modify: `apps/dashboard/.env.local.example`
- Modify: `.env.example`
- Create: `apps/dashboard/src/lib/__tests__/crypto.test.ts`

- [ ] **Step 1: Write failing test — roundtrip encrypt (setup.ts style) + decrypt (dashboard style)**

Create `apps/dashboard/src/lib/__tests__/crypto.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes, createCipheriv } from "crypto";
import { decryptApiKey } from "../crypto";

const TEST_SECRET = "test-encryption-secret-at-least-32-chars-long";

function encryptLikeSetup(apiKey: string, secret: string): string {
  const keyBuffer = createHash("sha256").update(secret).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

describe("crypto roundtrip", () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    savedEnv = process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_SECRET;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.CREDENTIALS_ENCRYPTION_KEY = savedEnv;
    } else {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    }
  });

  it("decrypts a key encrypted with setup.ts-style SHA-256 derivation", () => {
    const originalKey = "sb_abc123def456";
    const encrypted = encryptLikeSetup(originalKey, TEST_SECRET);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(originalKey);
  });

  it("throws when CREDENTIALS_ENCRYPTION_KEY is not set", () => {
    const saved = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    try {
      expect(() => decryptApiKey("aa:bb:cc")).toThrow("CREDENTIALS_ENCRYPTION_KEY");
    } finally {
      process.env.CREDENTIALS_ENCRYPTION_KEY = saved;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run -t "crypto roundtrip"`

Expected: FAIL — `decryptApiKey` currently reads `API_KEY_ENCRYPTION_SECRET` (wrong env var) and uses `Buffer.from(secret, "hex")` (wrong derivation).

- [ ] **Step 3: Fix dashboard crypto.ts to use CREDENTIALS_ENCRYPTION_KEY with SHA-256 derivation**

Replace `apps/dashboard/src/lib/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. " +
        "This must match the secret used by the API server for encryption.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptApiKey(encryptedApiKey: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedApiKey.split(":");
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex!, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex!, "hex"));
  let decrypted = decipher.update(encrypted!, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

- [ ] **Step 4: Run crypto roundtrip test**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run -t "crypto roundtrip"`

Expected: All PASS.

- [ ] **Step 5: Update .env.example files**

In `apps/dashboard/.env.local.example`, replace:

```
API_KEY_ENCRYPTION_SECRET=generate-a-32-byte-hex-secret
```

with:

```
CREDENTIALS_ENCRYPTION_KEY=same-value-as-api-server
```

In `.env.example`, remove the `API_KEY_ENCRYPTION_SECRET=` line (line 88). The existing `CREDENTIALS_ENCRYPTION_KEY=` line (line 91) already covers both API and dashboard.

- [ ] **Step 6: Run full dashboard test suite to check for regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run`

Expected: All PASS. No other file in the dashboard imports `API_KEY_ENCRYPTION_SECRET` directly — only `crypto.ts` does.

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: unify API key encryption to CREDENTIALS_ENCRYPTION_KEY

Dashboard crypto.ts now uses the same env var and SHA-256 key derivation
as setup.ts, so keys encrypted at bootstrap can be decrypted by the
dashboard. Adds roundtrip test verifying both sides produce compatible
ciphertext.
EOF
)"
```

---

### Task 4: M5 — Remove insecure default webhook verification secret

**Files:**

- Modify: `apps/api/src/routes/ad-optimizer.ts`
- Modify (if exists): `apps/api/src/__tests__/api-ad-optimizer.test.ts`

- [ ] **Step 1: Write failing test — startup/verification rejects missing env var**

Check if `apps/api/src/__tests__/api-ad-optimizer.test.ts` exists. If not, create it. Add:

```typescript
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";

describe("ad-optimizer webhook verification", () => {
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env["META_WEBHOOK_VERIFY_TOKEN"];
  });

  afterEach(() => {
    if (savedToken !== undefined) {
      process.env["META_WEBHOOK_VERIFY_TOKEN"] = savedToken;
    } else {
      delete process.env["META_WEBHOOK_VERIFY_TOKEN"];
    }
  });

  it("rejects verification when META_WEBHOOK_VERIFY_TOKEN is not set", async () => {
    delete process.env["META_WEBHOOK_VERIFY_TOKEN"];

    // Re-import to pick up the missing env var
    // The module should throw or the verify endpoint should return 403
    const { adOptimizerRoutes } = await import("../routes/ad-optimizer.js");

    // If module-level: expect import to throw
    // If endpoint-level: test the GET /leads/webhook endpoint returns 403
    expect(adOptimizerRoutes).toBeDefined();
    // Actual behavior depends on implementation choice below
  });
});
```

- [ ] **Step 2: Update ad-optimizer.ts to require the env var**

In `apps/api/src/routes/ad-optimizer.ts`, replace line 4:

```typescript
const VERIFY_TOKEN = process.env["META_WEBHOOK_VERIFY_TOKEN"] ?? "switchboard-verify";
```

with:

```typescript
function getVerifyToken(): string {
  const token = process.env["META_WEBHOOK_VERIFY_TOKEN"];
  if (!token) {
    throw new Error(
      "META_WEBHOOK_VERIFY_TOKEN is required. " +
        "Set this to the verify token configured in your Meta webhook settings.",
    );
  }
  return token;
}
```

Then update the verification endpoint (around line 19) to call `getVerifyToken()`:

```typescript
  app.get<{
    Querystring: {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };
  }>("/leads/webhook", async (request, reply) => {
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    let verifyToken: string;
    try {
      verifyToken = getVerifyToken();
    } catch {
      return reply.code(500).send({ error: "Webhook verification not configured", statusCode: 500 });
    }

    if (mode === "subscribe" && token === verifyToken) {
      return reply.code(200).send(challenge);
```

- [ ] **Step 3: Update the test to verify the behavior**

Update the test from Step 1 to actually test the endpoint behavior. Use `buildTestServer` if available, or test the function directly:

```typescript
it("returns 500 when META_WEBHOOK_VERIFY_TOKEN is not set", async () => {
  delete process.env["META_WEBHOOK_VERIFY_TOKEN"];

  // If using buildTestServer:
  const { buildTestServer, type TestContext } = await import("./test-server.js");
  const ctx: TestContext = await buildTestServer();
  const app = ctx.app;

  const res = await app.inject({
    method: "GET",
    url: "/api/ad-optimizer/leads/webhook",
    query: {
      "hub.mode": "subscribe",
      "hub.verify_token": "any-token",
      "hub.challenge": "challenge-123",
    },
  });

  expect(res.statusCode).toBe(500);
  expect(res.json().error).toContain("not configured");
  await app.close();
});
```

- [ ] **Step 4: Run ad-optimizer tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run -t "ad-optimizer"`

Expected: All PASS.

- [ ] **Step 5: Run full API test suite to check for regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run`

Expected: All PASS. If any tests fail because they relied on the default token, add `process.env["META_WEBHOOK_VERIFY_TOKEN"] = "test-token"` to their setup.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: require META_WEBHOOK_VERIFY_TOKEN, remove insecure default

The ad-optimizer webhook verification endpoint no longer falls back to
a hardcoded "switchboard-verify" token. Returns 500 if the env var is
not configured, preventing easy-to-guess verification bypass.
EOF
)"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx pnpm@9.15.4 test`

Expected: All packages PASS.

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`

Expected: No type errors.

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`

Expected: No lint errors.

- [ ] **Step 4: Create PR branch and push**

```bash
git checkout -b fix/hardening-round2-pr1-security
git push -u origin fix/hardening-round2-pr1-security
```
