# F-15 Chat-to-API Ingress Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the multi-tenant chat-to-API ingress hop authenticate (it 401s at prod
defaults today, blocking all inbound on all channels) by re-tiering it to an internal
service-authenticated route that honors the chat-resolved org, plus a fail-fast boot guard.

**Architecture:** New `POST /api/internal/ingress/submit` route authenticated by
`INTERNAL_API_SECRET` (timing-safe, already provisioned on both Render services). It reads
`body.organizationId` (resolved server-side by the chat gateway from the channel token) and
calls `app.platformIngress.submit`, so governance/entitlement/idempotency are unchanged. The
chat `HttpPlatformIngressAdapter` is repointed at this route with `INTERNAL_API_SECRET`. A
chat boot guard refuses to start a managed-channel runtime without the secret. The existing
`/api/ingress/submit` (operator-direct, org-from-auth) is left untouched.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Fastify, Zod, Vitest, pnpm/Turbo.

**Spec:** `docs/superpowers/specs/2026-06-08-f-15-chat-ingress-auth-design.md`

---

## File Structure

| File                                                          | Responsibility                                    | Action                                                |
| ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `apps/chat/src/startup-checks.ts`                             | chat boot validation                              | modify: require `INTERNAL_API_SECRET` in managed mode |
| `apps/chat/src/startup-checks.test.ts`                        | boot-check tests                                  | create                                                |
| `apps/api/src/lib/internal-secret-auth.ts`                    | shared timing-safe `INTERNAL_API_SECRET` verifier | create                                                |
| `apps/api/src/lib/internal-secret-auth.test.ts`               | verifier tests                                    | create                                                |
| `apps/api/src/routes/internal-chat-approvals.ts`              | existing internal route                           | modify: use shared verifier                           |
| `apps/api/src/validation.ts`                                  | Zod request schemas                               | modify: add `InternalIngressSubmitBodySchema`         |
| `apps/api/src/routes/internal-ingress.ts`                     | new internal ingress route                        | create                                                |
| `apps/api/src/__tests__/internal-ingress.test.ts`             | route auth + org-honoring + wired tests           | create                                                |
| `apps/api/src/bootstrap/routes.ts`                            | route registration                                | modify: register the new route                        |
| `apps/api/src/middleware/auth.ts`                             | global API-key auth gate                          | modify: allowlist the new path                        |
| `apps/chat/src/gateway/http-platform-ingress-adapter.ts`      | chat-to-API HTTP adapter                          | modify: internal path + secret                        |
| `apps/chat/src/gateway/http-platform-ingress-adapter.test.ts` | adapter tests                                     | create                                                |
| `apps/chat/src/main.ts`                                       | chat bootstrap                                    | modify: pass `INTERNAL_API_SECRET` to adapter         |
| `render.yaml`                                                 | deploy config                                     | modify: document shared-secret requirement            |
| `.env.example`                                                | env documentation                                 | modify: mark secret required in managed mode          |
| `docs/audits/.../findings/F-15-*.md`                          | audit finding                                     | modify: append resolution note                        |

---

### Task 1: Chat boot guard (fail-fast on missing secret in managed mode)

**Files:**

- Modify: `apps/chat/src/startup-checks.ts`
- Create: `apps/chat/src/startup-checks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/chat/src/startup-checks.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStartupChecks } from "./startup-checks.js";

describe("runStartupChecks, INTERNAL_API_SECRET (F-15)", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t"); // satisfy the channel check
  });
  afterEach(() => vi.unstubAllEnvs());

  it("errors when DATABASE_URL is set but INTERNAL_API_SECRET is empty (managed mode)", () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const result = runStartupChecks();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(true);
  });

  it("passes when DATABASE_URL and INTERNAL_API_SECRET are both set", () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("INTERNAL_API_SECRET", "s3cr3t");
    const result = runStartupChecks();
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(false);
  });

  it("does not require the secret when there is no database (non-managed dev mode)", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const result = runStartupChecks();
    expect(result.errors.some((e) => e.includes("INTERNAL_API_SECRET"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @switchboard/chat test -- startup-checks`
Expected: FAIL (the first test sees no `INTERNAL_API_SECRET` error yet).

- [ ] **Step 3: Add the guard**

In `apps/chat/src/startup-checks.ts`, after the `CREDENTIALS_ENCRYPTION_KEY` block (before
`return`), add:

```ts
// F-15: managed-channel mode (DATABASE_URL set) routes every inbound through the
// chat-to-API ingress hop, which authenticates with INTERNAL_API_SECRET. Without it,
// every inbound 401s silently. Fail fast and loud in all environments.
if (process.env["DATABASE_URL"] && !process.env["INTERNAL_API_SECRET"]) {
  errors.push(
    "INTERNAL_API_SECRET is required when DATABASE_URL is set (managed-channel mode): " +
      "it authenticates the chat-to-API ingress hop. Set the same value on the api service.",
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @switchboard/chat test -- startup-checks`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/startup-checks.ts apps/chat/src/startup-checks.test.ts
git commit -m "feat(chat): fail-fast boot guard for INTERNAL_API_SECRET in managed mode (f-15)"
```

---

### Task 2: Shared internal-secret verifier

Extract the timing-safe verifier (currently inline in `internal-chat-approvals.ts`) so the
new ingress route and the existing bridge share one security primitive.

**Files:**

- Create: `apps/api/src/lib/internal-secret-auth.ts`
- Create: `apps/api/src/lib/internal-secret-auth.test.ts`
- Modify: `apps/api/src/routes/internal-chat-approvals.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/internal-secret-auth.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { verifyInternalSecret } from "./internal-secret-auth.js";

function req(authorization?: string): FastifyRequest {
  return { headers: authorization ? { authorization } : {} } as FastifyRequest;
}

describe("verifyInternalSecret", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns 'unconfigured' when INTERNAL_API_SECRET is unset", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    expect(verifyInternalSecret(req("Bearer x"))).toBe("unconfigured");
  });

  it("returns 'unauthorized' when the header is missing", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "s3cr3t");
    expect(verifyInternalSecret(req())).toBe("unauthorized");
  });

  it("returns 'unauthorized' on a wrong secret (and on length mismatch)", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "s3cr3t");
    expect(verifyInternalSecret(req("Bearer wrong"))).toBe("unauthorized");
    expect(verifyInternalSecret(req("Bearer s3cr3t-longer"))).toBe("unauthorized");
  });

  it("returns 'ok' on an exact match", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "s3cr3t");
    expect(verifyInternalSecret(req("Bearer s3cr3t"))).toBe("ok");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @switchboard/api test -- internal-secret-auth`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Create the verifier**

Create `apps/api/src/lib/internal-secret-auth.ts` (logic lifted verbatim from
`internal-chat-approvals.ts:39-53`, including the byte-length guard that prevents a
`RangeError` -> 500 on multi-byte headers):

```ts
import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

export type InternalSecretCheck = "ok" | "unconfigured" | "unauthorized";

/**
 * Verify a request's `Authorization: Bearer <INTERNAL_API_SECRET>` header against the
 * configured `INTERNAL_API_SECRET`, using a timing-safe comparison. Returns the check
 * state; callers map it to an HTTP response (401/503) per their fail-closed policy.
 *
 * Compare BYTE lengths (not UTF-16 code units): a multi-byte header with a matching
 * code-unit count would otherwise make timingSafeEqual throw a RangeError and surface
 * as a 500 instead of a 401.
 */
export function verifyInternalSecret(request: FastifyRequest): InternalSecretCheck {
  const secret = process.env["INTERNAL_API_SECRET"];
  if (!secret) return "unconfigured";
  const header = request.headers.authorization;
  if (!header) return "unauthorized";
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (headerBuf.length !== expectedBuf.length) return "unauthorized";
  if (!timingSafeEqual(headerBuf, expectedBuf)) return "unauthorized";
  return "ok";
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `pnpm --filter @switchboard/api test -- internal-secret-auth`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor `internal-chat-approvals.ts` to use the shared verifier**

In `apps/api/src/routes/internal-chat-approvals.ts`: delete the local
`validateInternalSecret` function and its `SecretCheck` type and the `timingSafeEqual`
import; import the shared verifier and call it. Replace `const secretCheck =
validateInternalSecret(request);` with `const secretCheck = verifyInternalSecret(request);`.

```ts
// remove: import { timingSafeEqual } from "node:crypto";
import { verifyInternalSecret } from "../lib/internal-secret-auth.js";
// remove the local `type SecretCheck` + `function validateInternalSecret(...)` block
```

- [ ] **Step 6: Run the existing bridge test to confirm no regression**

Run: `pnpm --filter @switchboard/api test -- internal-chat-approvals`
Expected: PASS (unchanged behavior).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/internal-secret-auth.ts apps/api/src/lib/internal-secret-auth.test.ts apps/api/src/routes/internal-chat-approvals.ts
git commit -m "refactor(api): extract shared INTERNAL_API_SECRET verifier (f-15)"
```

---

### Task 3: Internal ingress route + body schema + registration + allowlist

**Files:**

- Modify: `apps/api/src/validation.ts`
- Create: `apps/api/src/routes/internal-ingress.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`
- Modify: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/src/__tests__/internal-ingress.test.ts`

- [ ] **Step 1: Add the body schema**

In `apps/api/src/validation.ts`, after the `boundedParameters` helper, add (the enums match
`ActorType`/`Trigger`/`SurfaceName` in `packages/core/src/platform/`):

```ts
// ── Internal chat-to-API ingress (F-15) ──────────────────────────────
export const InternalIngressSubmitBodySchema = z.object({
  organizationId: z.string().min(1).max(200),
  actor: z.object({
    id: z.string().min(1).max(200),
    type: z.enum(["user", "agent", "system", "service"]),
  }),
  intent: z.string().min(1).max(200),
  parameters: boundedParameters.optional(),
  trigger: z.enum(["chat", "api", "schedule", "internal"]).optional(),
  surface: z
    .object({
      surface: z.enum(["api", "mcp", "chat", "dashboard"]),
      sessionId: z.string().max(500).optional(),
      requestId: z.string().max(500).optional(),
      correlationId: z.string().max(500).optional(),
    })
    .optional(),
  targetHint: z
    .object({
      skillSlug: z.string().max(200).optional(),
      deploymentId: z.string().max(200).optional(),
      channel: z.string().max(50).optional(),
      token: z.string().max(500).optional(),
    })
    .optional(),
  traceId: z.string().max(200).optional(),
  idempotencyKey: z.string().max(500).optional(),
  contactId: z.string().max(200).optional(),
  conversationThreadId: z.string().max(200).optional(),
});
```

- [ ] **Step 2: Write the failing route test**

Create `apps/api/src/__tests__/internal-ingress.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { internalIngressRoutes } from "../routes/internal-ingress.js";
import { buildTestServer } from "./test-server.js";

const SECRET = "test-internal-secret";
const BASE = {
  organizationId: "org_a",
  actor: { id: "wa:+6591234567", type: "user" as const },
  intent: "alex.respond",
  parameters: { message: "hi" },
  trigger: "chat" as const,
  surface: { surface: "chat" as const, sessionId: "+6591234567" },
};

/** Minimal app with the REAL auth middleware + a spy platformIngress. */
async function buildApp(opts: { authEnabled: boolean }): Promise<{
  app: FastifyInstance;
  submit: ReturnType<typeof vi.fn>;
}> {
  const submit = vi.fn().mockResolvedValue({ ok: true, result: {}, workUnit: {} });
  const app = Fastify();
  app.decorate("prisma", null);
  // API_KEYS present -> authDisabled=false (auth enabled); absent -> authDisabled=true.
  if (opts.authEnabled) vi.stubEnv("API_KEYS", "k");
  else vi.stubEnv("API_KEYS", "");
  await app.register(authMiddleware);
  app.decorate("platformIngress", { submit } as never);
  await app.register(internalIngressRoutes, { prefix: "/api/internal/ingress" });
  await app.ready();
  return { app, submit };
}

describe("POST /api/internal/ingress/submit (F-15)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is excluded from API-key auth and enforces the internal secret (no header -> 401 Unauthorized)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app } = await buildApp({ authEnabled: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      payload: BASE,
    });
    // If the allowlist failed, auth middleware would answer "Missing Authorization header".
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Unauthorized");
    await app.close();
  });

  it("rejects a wrong secret with 401", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: "Bearer nope" },
      payload: BASE,
    });
    expect(res.statusCode).toBe(401);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts the correct secret and submits under the BODY org (not an auth-key org)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: BASE,
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a", intent: "alex.respond" }),
    );
    await app.close();
  });

  it("serves multiple tenants with ONE secret (multi-tenant proof)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    for (const org of ["org_a", "org_b"]) {
      await app.inject({
        method: "POST",
        url: "/api/internal/ingress/submit",
        headers: { authorization: `Bearer ${SECRET}` },
        payload: { ...BASE, organizationId: org },
      });
    }
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_a" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_b" }));
    await app.close();
  });

  it("forwards Spec-1A lineage + idempotency key to submit", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: {
        ...BASE,
        contactId: "contact_1",
        conversationThreadId: "thread_1",
        idempotencyKey: "org_a:whatsapp:wamid.1",
      },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact_1",
        conversationThreadId: "thread_1",
        idempotencyKey: "org_a:whatsapp:wamid.1",
      }),
    );
    await app.close();
  });

  it("rejects a malformed body (missing organizationId) with 400 and does not submit", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, submit } = await buildApp({ authEnabled: true });
    const { organizationId: _omit, ...noOrg } = BASE;
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: noOrg,
    });
    expect(res.statusCode).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("503s when the secret is unset and auth is enabled (fail closed)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const { app, submit } = await buildApp({ authEnabled: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      payload: BASE,
    });
    expect(res.statusCode).toBe(503);
    expect(submit).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts without a secret in pure dev mode (no DB, no keys -> authDisabled)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const { app, submit } = await buildApp({ authEnabled: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      payload: BASE,
    });
    expect(res.statusCode).toBe(200);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_a" }));
    await app.close();
  });

  it("wired: an authenticated submit reaches the REAL PlatformIngress (unknown intent -> intent_not_found)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app } = await buildTestServer();
    await app.register(internalIngressRoutes, { prefix: "/api/internal/ingress" });
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/ingress/submit",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: { ...BASE, intent: "does.not.exist" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.type).toBe("intent_not_found");
    await app.close();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @switchboard/api test -- internal-ingress`
Expected: FAIL (route module does not exist).

- [ ] **Step 4: Create the route**

Create `apps/api/src/routes/internal-ingress.ts`:

```ts
// @route-class: lifecycle
import type { FastifyPluginAsync } from "fastify";
import { verifyInternalSecret } from "../lib/internal-secret-auth.js";
import { InternalIngressSubmitBodySchema } from "../validation.js";

// Internal chat-to-API ingress hop
// (spec docs/superpowers/specs/2026-06-08-f-15-chat-ingress-auth-design.md).
//
// The chat service is a single shared process serving every org's managed channels. It
// resolves the authoritative org SERVER-SIDE from the channel token (channel-gateway.ts)
// and carries it in body.organizationId. This route authenticates the CALLER PROCESS via
// INTERNAL_API_SECRET (timing-safe; same trust model as /internal/provision-notify and
// /api/internal/chat-approvals/respond) and honors that org. It calls
// app.platformIngress.submit, so PlatformIngress runs entitlement + GovernanceGate +
// idempotency unchanged: this is NOT a mutating bypass. The path is excluded from the
// API-key auth middleware (exact path) and self-authenticates here, fail closed.

const RATE_LIMIT_MAX = 600; // message-rate, not human-tap
const RATE_LIMIT_WINDOW_MS = 60_000;

export const internalIngressRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/submit",
    {
      schema: {
        description:
          "Internal chat-to-API ingress: authenticated by INTERNAL_API_SECRET, honors the " +
          "chat-resolved body.organizationId, and submits through PlatformIngress.",
        tags: ["Internal"],
        hide: true,
      },
      config: { rateLimit: { max: RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW_MS } },
    },
    async (request, reply) => {
      const secretState = verifyInternalSecret(request);
      if (secretState === "unauthorized") {
        return reply.code(401).send({ error: "Unauthorized", statusCode: 401 });
      }
      if (secretState === "unconfigured" && app.authDisabled !== true) {
        request.log.error("INTERNAL_API_SECRET not configured; rejecting internal ingress");
        return reply
          .code(503)
          .send({ error: "Internal authentication not configured", statusCode: 503 });
      }
      // secretState === "ok", or "unconfigured" in auth-disabled dev mode: proceed.

      if (!app.platformIngress) {
        return reply.code(503).send({ error: "PlatformIngress not available", statusCode: 503 });
      }

      const parsed = InternalIngressSubmitBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 });
      }
      const body = parsed.data;

      try {
        const response = await app.platformIngress.submit({
          organizationId: body.organizationId,
          actor: body.actor,
          intent: body.intent,
          parameters: body.parameters ?? {},
          trigger: body.trigger ?? "chat",
          surface: body.surface ?? { surface: "chat" },
          targetHint: body.targetHint,
          traceId: body.traceId,
          ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
          ...(body.contactId ? { contactId: body.contactId } : {}),
          ...(body.conversationThreadId ? { conversationThreadId: body.conversationThreadId } : {}),
        });
        request.log.info(
          { organizationId: body.organizationId, intent: body.intent, ok: response.ok },
          "internal ingress submit",
        );
        return reply.send(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        request.log.error({ err }, "internal ingress submit error");
        return reply
          .code(500)
          .send({ ok: false, error: { type: "internal_error", message }, statusCode: 500 });
      }
    },
  );
};
```

- [ ] **Step 5: Register the route**

In `apps/api/src/bootstrap/routes.ts`, add the import near line 12 and the registration near
the existing internal-chat-approvals registration (line 119):

```ts
import { internalIngressRoutes } from "../routes/internal-ingress.js";
// ...
await app.register(internalIngressRoutes, { prefix: "/api/internal/ingress" });
```

- [ ] **Step 6: Allowlist the path in the API-key auth middleware**

In `apps/api/src/middleware/auth.ts`, inside the `preHandler` skip block (after the
`/api/internal/chat-approvals/respond` line, ~137), add:

```ts
      // Internal chat-to-API ingress: self-authenticates with INTERNAL_API_SECRET
      // (timing-safe) inside the route; exact path, never a prefix (F-15).
      request.url === "/api/internal/ingress/submit" ||
```

- [ ] **Step 7: Run it to confirm it passes**

Run: `pnpm --filter @switchboard/api test -- internal-ingress`
Expected: PASS (9 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/validation.ts apps/api/src/routes/internal-ingress.ts apps/api/src/bootstrap/routes.ts apps/api/src/middleware/auth.ts apps/api/src/__tests__/internal-ingress.test.ts
git commit -m "feat(api): internal-secret-authed ingress route honoring chat-resolved org (f-15)"
```

---

### Task 4: Re-tier the chat adapter to the internal hop

**Files:**

- Modify: `apps/chat/src/gateway/http-platform-ingress-adapter.ts`
- Create: `apps/chat/src/gateway/http-platform-ingress-adapter.test.ts`
- Modify: `apps/chat/src/main.ts`

- [ ] **Step 1: Write the failing adapter test**

Create `apps/chat/src/gateway/http-platform-ingress-adapter.test.ts`. Note: the `fetch`
spy is typed via `vi.spyOn(globalThis, "fetch")` (avoids the untyped-`vi.fn()` build break
where indexing `mock.calls` trips TS2493):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import { HttpPlatformIngressAdapter } from "./http-platform-ingress-adapter.js";

const REQUEST = {
  organizationId: "org_a",
  actor: { id: "wa:+65", type: "user" },
  intent: "alex.respond",
  parameters: {},
  trigger: "chat",
  surface: { surface: "chat" },
} as unknown as CanonicalSubmitRequest;

describe("HttpPlatformIngressAdapter", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {}, workUnit: {} }), { status: 200 }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to the internal ingress path with the Bearer secret", async () => {
    const adapter = new HttpPlatformIngressAdapter("http://api:3000", "s3cr3t");
    await adapter.submit(REQUEST);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api:3000/api/internal/ingress/submit");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer s3cr3t");
  });

  it("omits the Authorization header when no secret is set", async () => {
    const adapter = new HttpPlatformIngressAdapter("http://api:3000", undefined);
    await adapter.submit(REQUEST);
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("returns a validation_failed error on a 4xx response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("nope", { status: 401 }));
    const adapter = new HttpPlatformIngressAdapter("http://api:3000", "s3cr3t");
    const res = await adapter.submit(REQUEST);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.type).toBe("validation_failed");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @switchboard/chat test -- http-platform-ingress-adapter`
Expected: FAIL (adapter still posts to `/api/ingress/submit`).

- [ ] **Step 3: Repoint the adapter**

In `apps/chat/src/gateway/http-platform-ingress-adapter.ts`: rename the constructor param
`apiKey` -> `internalSecret` (and the field), update the doc comment, and change the fetch
URL to the internal path. Diff:

```ts
export class HttpPlatformIngressAdapter {
  private readonly baseUrl: string;
  private readonly internalSecret: string | undefined;

  constructor(baseUrl: string, internalSecret?: string) {
    this.baseUrl = baseUrl;
    this.internalSecret = internalSecret;
  }
  // ...
    if (this.internalSecret) {
      headers["Authorization"] = `Bearer ${this.internalSecret}`;
    }
    // ...
      const response = await fetch(`${this.baseUrl}/api/internal/ingress/submit`, {
```

- [ ] **Step 4: Pass the secret from main.ts**

In `apps/chat/src/main.ts:74-75`:

```ts
// Chat-to-API ingress authenticates as a trusted internal service (F-15). The chat
// service resolves each inbound's org server-side and carries it in the request body;
// the API honors it on the internal-secret-authed ingress route.
const internalSecret = process.env["INTERNAL_API_SECRET"];
const platformIngressAdapter = new HttpPlatformIngressAdapter(apiUrl, internalSecret);
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `pnpm --filter @switchboard/chat test -- http-platform-ingress-adapter`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/gateway/http-platform-ingress-adapter.ts apps/chat/src/gateway/http-platform-ingress-adapter.test.ts apps/chat/src/main.ts
git commit -m "feat(chat): authenticate ingress hop with INTERNAL_API_SECRET via internal route (f-15)"
```

---

### Task 5: Config + documentation

**Files:**

- Modify: `render.yaml`
- Modify: `.env.example`
- Modify: `docs/audits/2026-06-07-pilot-spine-audit/findings/F-15-chat-api-ingress-unauthenticated-at-prod-default.md`

- [ ] **Step 1: Document the shared secret in `render.yaml`**

On the `switchboard-api` service `INTERNAL_API_SECRET` entry (line ~68) and the
`switchboard-chat` service `INTERNAL_API_SECRET` entry (line ~188), add a comment above each:

```yaml
# Shared chat<->api service secret. MUST be the SAME value on both services.
# Authenticates the chat-to-API ingress hop (F-15) + provision-notify + chat-approvals.
- key: INTERNAL_API_SECRET
  sync: false
```

- [ ] **Step 2: Document the requirement in `.env.example`**

At `.env.example:156`, replace the bare `INTERNAL_API_SECRET=` with:

```bash
# Shared chat<->api service secret. REQUIRED when DATABASE_URL is set (managed-channel
# mode): authenticates the chat-to-API ingress hop (F-15) + provision-notify + chat
# approval bridge. Use the SAME value for api and chat. The chat server refuses to boot
# in managed mode without it.
INTERNAL_API_SECRET=
```

And annotate the legacy `SWITCHBOARD_API_KEY` (line ~146):

```bash
# Optional: legacy single-tenant "delegate to central API" credential. NOT used by the
# managed-channel chat-to-API ingress hop (that uses INTERNAL_API_SECRET; see F-15).
SWITCHBOARD_API_KEY=
```

- [ ] **Step 3: Append a resolution note to the F-15 finding**

At the end of the F-15 finding file, add:

```markdown
## Resolution (2026-06-08)

Fixed on `fix/f-15-chat-ingress-auth`. The audit's literal fix (provision a single
`SWITCHBOARD_API_KEY` + matching `API_KEYS`) was found multi-tenant-incorrect: the API
derives the org from the auth key (`requireOrgForMutation` ->
`resolveByOrgAndSlug(request.organizationId, ...)`), so one org-scoped key would route every
tenant's inbound to one org. The audit did not surface this because it exercised only the
single audit org.

Shipped instead: the chat-to-API ingress hop is authenticated as a trusted internal service
via `INTERNAL_API_SECRET` (already provisioned on both Render services) on a new
`POST /api/internal/ingress/submit` route that honors the chat-resolved `body.organizationId`
and still flows through `PlatformIngress.submit` (governance unchanged). A chat boot guard
fails fast when `DATABASE_URL` is set but `INTERNAL_API_SECRET` is empty. F-15 alone yields
working, authenticated inbound that still default-denies until F-16/F-02 land (expected).
See `docs/superpowers/specs/2026-06-08-f-15-chat-ingress-auth-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add render.yaml .env.example docs/audits/2026-06-07-pilot-spine-audit/findings/F-15-chat-api-ingress-unauthenticated-at-prod-default.md
git commit -m "docs(deploy): document INTERNAL_API_SECRET for the ingress hop (f-15)"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + build the touched packages**

Run: `pnpm --filter @switchboard/api --filter @switchboard/chat build`
Expected: exit 0 (catches the untyped-`vi.fn` build break the unit runner misses).

- [ ] **Step 2: Run the api + chat test suites**

Run: `pnpm --filter @switchboard/api test` then `pnpm --filter @switchboard/chat test`
Expected: PASS (including the new suites; no regressions).

- [ ] **Step 3: Typecheck the workspace**

Run: `pnpm typecheck`
Expected: exit 0. (If it reports missing `@switchboard/*` exports, run `pnpm reset` then retry.)

- [ ] **Step 4: Route-ingress + fast local gates**

Run: `CI=1 npx tsx scripts/local-verify-fast.ts`
Expected: route-ingress check passes (the new route reaches `PlatformIngress.submit` via the
`"PlatformIngress not available"` guard string, so it is not flagged as a bypass and needs no
allowlist entry; the `@route-class: lifecycle` header is present). If route-ingress flags the
new file, add an allowlist entry to `.agent/tools/route-allowlist.yaml` with a reason.

- [ ] **Step 5: Lint + format**

Run: `pnpm lint && pnpm format:check`
Expected: clean. (CI lint runs prettier; run `pnpm format:write` if needed, then re-add.)

- [ ] **Step 6: Final commit if any fixups were needed**

```bash
git add -A && git commit -m "chore(f-15): verification fixups" || echo "nothing to fix up"
```

---

## Self-Review

**Spec coverage:**

- 4.1 internal route (auth tiers, body org, validation, governance-via-submit, idempotency
  from body, lineage pass-through, hidden + rate-limited) -> Task 3.
- 4.2 chat adapter re-tier -> Task 4.
- 4.3 chat boot guard -> Task 1.
- 4.4 render.yaml + .env.example + finding note -> Task 5.
- Security (timing-safe shared verifier, fail-closed) -> Tasks 2 + 3.
- Testing strategy (boot guard, auth missing/bad/good, org-honored, multi-tenant, lineage,
  400, 503, dev-accept, wired real-ingress) -> Tasks 1, 3, 4.
- Verification (build/typecheck/test/check-routes/lint) -> Task 6.

**Placeholder scan:** none. Every step has concrete code or an exact command + expected output.

**Type consistency:** `verifyInternalSecret` returns `InternalSecretCheck` ("ok" |
"unconfigured" | "unauthorized"), used identically in Tasks 2 and 3. Schema enums match
`ActorType` (`user|agent|system|service`), `Trigger` (`chat|api|schedule|internal`), and
`SurfaceName` (`api|mcp|chat|dashboard`), so the CTWA path (`actor.type:"system"`,
`trigger:"internal"`) and the chat path (`type:"user"`, `trigger:"chat"`) both pass the
schema and reach `submit` with faithful types. Adapter constructor param `internalSecret` is
used consistently in the adapter and `main.ts`.
