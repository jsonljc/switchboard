# Deployment & Hosting — Pilot Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the codebase ready to be provisioned and operated on Vercel (dashboard) + Render (api + chat + Postgres + Redis) per the design spec at `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md`.

**Architecture:** This plan only touches code, config, and runbook files in the repo. Actual Render/Vercel provisioning, env-var setup, webhook registration with Meta, and Sentry/UptimeRobot configuration are operational tasks performed by the user against the deploy hosts after these PRs merge — they are not implementation tasks. The plan produces: a `render.yaml`, a `chat /api/health/deep` endpoint, a `SENTRY_DSN` → `SENTRY_DSN_SERVER` rename, two runbook documents, an automated smoke-test script, and one new `packages/db` script.

**Tech Stack:** TypeScript, pnpm + Turborepo, Fastify (api + chat), Prisma (Postgres), ioredis (Redis), Sentry SDK, vitest. No new runtime dependencies are added.

**Spec reference:** `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` (PR #504 on `docs/deployment-hosting-spec`). Merge order: spec should merge before any implementation PR opens, so implementation branches consume the spec from `main`.

---

## File structure

**Files to create:**

- `render.yaml` — Render Infrastructure-as-Code at repo root, declaring `api`, `chat`, Postgres, Redis, env-var keys (no values), pre-deploy command on `api`, health-check paths.
- `apps/chat/src/routes/health.ts` — Fastify plugin exposing `GET /deep` (registered under `/api/health` prefix). Returns 200/503 with DB + Redis + `api` reachability checks.
- `apps/chat/src/routes/__tests__/health.test.ts` — vitest unit tests for the new `health.ts` plugin.
- `docs/runbooks/production-urls.md` — provisioning fill-in template covering live URLs, Render region, plan tiers, monitoring dashboards, vault entries map.
- `docs/runbooks/secret-rotation.md` — five-line rotation runbook per provider (Anthropic, Meta WhatsApp/Ads, Telegram, Stripe).
- `scripts/smoke-prod.sh` — POSIX shell script that runs the runbook's automatable smoke checks against given `api` and `chat` URLs.

**Files to modify:**

- `packages/db/package.json` — add `migrate:deploy` script that runs `prisma migrate deploy`.
- `apps/api/src/bootstrap/sentry.ts` — read `SENTRY_DSN_SERVER` instead of `SENTRY_DSN`.
- `apps/chat/src/bootstrap/sentry.ts` — same rename.
- `apps/chat/src/__tests__/sentry-bootstrap.test.ts` — update test to assert new var name.
- `apps/chat/src/main.ts` — register the new health-routes plugin alongside the existing inline `/health`.
- `.env.example` — rename `SENTRY_DSN=` to `SENTRY_DSN_SERVER=`; add `SWITCHBOARD_API_URL=` documentation; annotate `INNGEST_EVENT_KEY=` / `INNGEST_SIGNING_KEY=` as Inngest-Cloud-required (already present but undocumented).

**Files NOT to modify:**

- `docker-compose.prod.yml` — per spec §12, this represents the prior self-hosted-VPS deploy plan; kept for local integration testing only. Do **not** sync its `SENTRY_DSN` references with the rename. Local devs who run the compose stack will update their local `.env`.
- `apps/dashboard/sentry.{client,server}.config.ts` — already use `NEXT_PUBLIC_SENTRY_DSN` correctly; no change.
- `apps/mcp-server/**` — out of scope per spec §11.

---

## Task 1: Add `migrate:deploy` script to `@switchboard/db`

**Why:** The spec's pre-deploy command on Render needs a clean form. Today only `migrate` (= `prisma migrate dev`, which blocks on TTY prompts) and an inline `pnpm --filter @switchboard/db exec prisma migrate deploy` (used in CI) exist. A named script makes the `render.yaml` line easier to read and gives the implementation a single canonical command.

**Files:**

- Modify: `packages/db/package.json`

---

- [ ] **Step 1.1: Add the `migrate:deploy` script entry**

Edit `packages/db/package.json`. In the `"scripts"` block, add a line below the existing `"migrate": "prisma migrate dev"`:

```json
{
  "scripts": {
    "migrate": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "migrate:status": "prisma migrate status"
  }
}
```

(Keep all other existing scripts unchanged. Adding `migrate:status` for symmetry — the runbook smoke step references it.)

- [ ] **Step 1.2: Verify the script resolves**

Run: `pnpm --filter @switchboard/db run migrate:deploy --help`

Expected: prisma's `migrate deploy` help banner prints (the script resolves to the right command). The command itself does not run against a database because `--help` short-circuits.

- [ ] **Step 1.3: Commit**

```bash
git add packages/db/package.json
git commit -m "feat(db): add migrate:deploy and migrate:status scripts for Render pre-deploy"
```

---

## Task 2: Rename `SENTRY_DSN` to `SENTRY_DSN_SERVER` across api, chat, and `.env.example`

**Why:** Per spec §4 / §7, the server-side DSN is named `SENTRY_DSN_SERVER` and the client-side (Next.js) DSN stays `NEXT_PUBLIC_SENTRY_DSN`. The rename makes the var unambiguous and prevents anyone from accidentally putting the server DSN behind a `NEXT_PUBLIC_*` prefix.

**Files:**

- Modify: `apps/api/src/bootstrap/sentry.ts:14`
- Modify: `apps/chat/src/bootstrap/sentry.ts:4`
- Modify: `apps/chat/src/__tests__/sentry-bootstrap.test.ts:15` (asserts the env var name)
- Modify: `.env.example:200` (rename the line)

---

- [ ] **Step 2.1: Update the chat sentry bootstrap test to assert the new var name**

Edit `apps/chat/src/__tests__/sentry-bootstrap.test.ts`. Change the env-var deletion inside the "is not initialized when …" test from `SENTRY_DSN` to `SENTRY_DSN_SERVER`:

```typescript
  it("is not initialized when SENTRY_DSN_SERVER is not set", async () => {
    delete process.env["SENTRY_DSN_SERVER"];
    const sentry = await import("../bootstrap/sentry.js");
    expect(sentry.isSentryInitialized()).toBe(false);
  });
```

- [ ] **Step 2.2: Run the test — it should fail**

Run: `pnpm --filter @switchboard/chat test sentry-bootstrap`

Expected: `is not initialized when SENTRY_DSN_SERVER is not set` may still pass coincidentally (because nothing sets `SENTRY_DSN_SERVER` yet), but the underlying behavior is still gated on `SENTRY_DSN`. To force a meaningful failure, also add this guard test above it:

```typescript
  it("reads SENTRY_DSN_SERVER, not SENTRY_DSN", async () => {
    delete process.env["SENTRY_DSN"];
    process.env["SENTRY_DSN_SERVER"] = "https://example@sentry.example.com/1";
    // Reset module cache so initChatSentry picks up the new env
    vi.resetModules();
    const sentry = await import("../bootstrap/sentry.js");
    await sentry.initChatSentry();
    expect(sentry.isSentryInitialized()).toBe(true);
    delete process.env["SENTRY_DSN_SERVER"];
  });
```

Re-run: `pnpm --filter @switchboard/chat test sentry-bootstrap`

Expected: the new `reads SENTRY_DSN_SERVER, not SENTRY_DSN` test FAILS — because `bootstrap/sentry.ts` still reads `process.env["SENTRY_DSN"]`, not `SENTRY_DSN_SERVER`.

- [ ] **Step 2.3: Rename the env var read in `apps/chat/src/bootstrap/sentry.ts`**

Edit `apps/chat/src/bootstrap/sentry.ts`. Change:

```typescript
  const dsn = process.env["SENTRY_DSN"];
```

to:

```typescript
  const dsn = process.env["SENTRY_DSN_SERVER"];
```

- [ ] **Step 2.4: Re-run the chat sentry tests — they should now pass**

Run: `pnpm --filter @switchboard/chat test sentry-bootstrap`

Expected: all tests pass, including the new `reads SENTRY_DSN_SERVER, not SENTRY_DSN` test.

- [ ] **Step 2.5: Rename the env var read in `apps/api/src/bootstrap/sentry.ts`**

Edit `apps/api/src/bootstrap/sentry.ts`. Change:

```typescript
  const dsn = process.env["SENTRY_DSN"];
```

to:

```typescript
  const dsn = process.env["SENTRY_DSN_SERVER"];
```

(There is no existing api sentry test to update; the chat tests cover the rename pattern.)

- [ ] **Step 2.6: Update `.env.example`**

Edit `.env.example`. Find the line:

```
SENTRY_DSN=
```

Change to:

```
SENTRY_DSN_SERVER=
```

Leave `NEXT_PUBLIC_SENTRY_DSN=` (next line) unchanged — that's the dashboard's DSN, already correctly named.

- [ ] **Step 2.7: Confirm typecheck across the workspace**

Run: `pnpm typecheck`

Expected: PASS for all packages. If a package fails because the `SENTRY_DSN` rename left a stale reference, run `grep -rn 'SENTRY_DSN[^_]' apps packages` to find it and update.

- [ ] **Step 2.8: Broad-scope grep to confirm no stale `SENTRY_DSN` references survived**

Run:

```bash
grep -R -n "SENTRY_DSN" apps packages .env.example \
  --include='*.ts' --include='*.tsx' --include='*.js' \
  --include='*.json' --include='*.example' --include='*.md' \
  --exclude-dir=node_modules --exclude-dir=dist
```

Expected: the only matches are `SENTRY_DSN_SERVER` (api/chat code) and `NEXT_PUBLIC_SENTRY_DSN` (dashboard sentry configs + `.env.example`). A bare `SENTRY_DSN` (no `_SERVER` suffix, no `NEXT_PUBLIC_` prefix) outside of a deliberate documentation note is a stale reference — go fix it before commit.

Note: `docker-compose.prod.yml` is **deliberately not synced** with this rename (per spec §12, the prod compose represents the prior self-hosted plan and is kept for local integration testing only). If your grep picks it up, leave it; otherwise the rename is complete.

- [ ] **Step 2.9: Commit**

```bash
git add apps/api/src/bootstrap/sentry.ts apps/chat/src/bootstrap/sentry.ts apps/chat/src/__tests__/sentry-bootstrap.test.ts .env.example
git commit -m "feat(observability): rename SENTRY_DSN to SENTRY_DSN_SERVER for api/chat server DSN"
```

---

## Task 3: Add `apps/chat/src/routes/health.ts` deep-readiness Fastify plugin (TDD)

**Why:** Spec §7 requires `chat` to expose `/api/health/deep`. The existing chat `/health` does shallow DB + Redis checks but does not check `api` reachability — the spec deliberately puts the `api`-reachability check in readiness (not liveness) to avoid cascading failures when `api` blips. The new plugin owns that deep check.

**Files:**

- Create: `apps/chat/src/routes/health.ts`
- Create: `apps/chat/src/routes/__tests__/health.test.ts`

**Design notes:**

- The plugin is mounted under the prefix `/api/health` so the route resolves to `GET /api/health/deep` (parallel to api's existing route).
- Deep check includes: DB (Prisma `SELECT 1`), Redis (`ping`), and `api` reachability (HTTP GET to `${SWITCHBOARD_API_URL}/health` with the `INTERNAL_API_SECRET` header).
- Each check has a 3-second timeout. Returns 200 with `healthy: true` if all checks pass, 503 otherwise. Response shape mirrors api's `/api/health/deep` for runbook consistency.
- The plugin reads its dependencies (`prisma`, `redis`, `fetch`) from injectable options so tests can supply mocks. This is the pattern used elsewhere in chat (see `apps/chat/src/__tests__/health-checker.test.ts` for the harness style).

---

- [ ] **Step 3.1: Write the failing test file**

Create `apps/chat/src/routes/__tests__/health.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { chatHealthRoutes } from "../health.js";

type PrismaLike = { $queryRaw: ReturnType<typeof vi.fn> };
type RedisLike = { ping: ReturnType<typeof vi.fn> };

function buildApp(opts: {
  prisma?: PrismaLike | null;
  redis?: RedisLike | null;
  apiBaseUrl?: string | null;
  internalApiSecret?: string | null;
  fetchImpl?: typeof fetch;
}): FastifyInstance {
  const app = Fastify();
  app.register(chatHealthRoutes, {
    prefix: "/api/health",
    prisma: opts.prisma ?? null,
    redis: opts.redis ?? null,
    apiBaseUrl: opts.apiBaseUrl ?? null,
    internalApiSecret: opts.internalApiSecret ?? null,
    fetchImpl: opts.fetchImpl,
  });
  return app;
}

describe("chat /api/health/deep", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
    vi.restoreAllMocks();
  });

  it("returns 200 healthy when all checks pass", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: "https://api.example.test",
      internalApiSecret: "test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { healthy: boolean; checks: Record<string, { status: string }> };
    expect(body.healthy).toBe(true);
    expect(body.checks["database"]?.status).toBe("connected");
    expect(body.checks["redis"]?.status).toBe("connected");
    expect(body.checks["api"]?.status).toBe("connected");
  });

  it("returns 503 when database is unreachable", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: "https://api.example.test",
      internalApiSecret: "test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { healthy: boolean; checks: Record<string, { status: string }> };
    expect(body.healthy).toBe(false);
    expect(body.checks["database"]?.status).toBe("disconnected");
  });

  it("marks api check as skipped when SWITCHBOARD_API_URL is unset (does NOT 503 — cascading-failures safe)", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: null,
      internalApiSecret: null,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { healthy: boolean; checks: Record<string, { status: string }> };
    expect(body.healthy).toBe(true);
    expect(body.checks["api"]?.status).toBe("not_configured");
  });

  it("returns 503 when api is reachable but returns 5xx", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("oops", { status: 500 }));

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: "https://api.example.test",
      internalApiSecret: "test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { healthy: boolean; checks: Record<string, { status: string }> };
    expect(body.healthy).toBe(false);
    expect(body.checks["api"]?.status).toBe("disconnected");
  });
});
```

- [ ] **Step 3.2: Run the test — confirm it fails (no implementation yet)**

Run: `pnpm --filter @switchboard/chat test -- src/routes/__tests__/health.test.ts`

Expected: FAIL — `Cannot find module '../health.js'` (file doesn't exist yet).

- [ ] **Step 3.3: Implement `apps/chat/src/routes/health.ts`**

Create `apps/chat/src/routes/health.ts`:

> **Note:** `fastify-plugin` is NOT in chat's dependencies (only api's). We export a plain `FastifyPluginAsync` instead — this gives the plugin its own encapsulation context, which is fine since we don't share state with the parent via decorators.

```typescript
import type { FastifyPluginAsync } from "fastify";

interface PrismaLike {
  $queryRaw: (q: TemplateStringsArray) => Promise<unknown>;
}

interface RedisLike {
  ping: () => Promise<string>;
}

export interface ChatHealthRoutesOptions {
  prisma: PrismaLike | null;
  redis: RedisLike | null;
  apiBaseUrl: string | null;
  internalApiSecret: string | null;
  fetchImpl?: typeof fetch;
}

interface CheckResult {
  status: "connected" | "disconnected" | "not_configured";
  latencyMs: number;
  error?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function sanitizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const chatHealthRoutes: FastifyPluginAsync<ChatHealthRoutesOptions> = async (app, opts) => {
  const fetcher = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  app.get(
    "/deep",
    {
      schema: {
        description: "Deep readiness check for chat: DB, Redis, and api reachability.",
        tags: ["Health"],
      },
    },
    async (_request, reply) => {
      const checks: Record<string, CheckResult> = {};
      let healthy = true;

      // DB
      const dbStart = Date.now();
      if (opts.prisma) {
        try {
          await withTimeout(opts.prisma.$queryRaw`SELECT 1`, 3000);
          checks["database"] = { status: "connected", latencyMs: Date.now() - dbStart };
        } catch (err) {
          checks["database"] = {
            status: "disconnected",
            latencyMs: Date.now() - dbStart,
            error: sanitizeError(err),
          };
          healthy = false;
        }
      } else {
        checks["database"] = { status: "not_configured", latencyMs: 0 };
      }

      // Redis
      const redisStart = Date.now();
      if (opts.redis) {
        try {
          await withTimeout(opts.redis.ping(), 3000);
          checks["redis"] = { status: "connected", latencyMs: Date.now() - redisStart };
        } catch (err) {
          checks["redis"] = {
            status: "disconnected",
            latencyMs: Date.now() - redisStart,
            error: sanitizeError(err),
          };
          healthy = false;
        }
      } else {
        checks["redis"] = { status: "not_configured", latencyMs: 0 };
      }

      // api reachability — skipped (not a failure) when SWITCHBOARD_API_URL is unset
      const apiStart = Date.now();
      if (opts.apiBaseUrl && opts.internalApiSecret) {
        try {
          const res = await withTimeout(
            fetcher(`${opts.apiBaseUrl}/health`, {
              method: "GET",
              headers: { "x-internal-api-secret": opts.internalApiSecret },
            }),
            3000,
          );
          if (res.ok) {
            checks["api"] = { status: "connected", latencyMs: Date.now() - apiStart };
          } else {
            checks["api"] = {
              status: "disconnected",
              latencyMs: Date.now() - apiStart,
              error: `HTTP ${res.status}`,
            };
            healthy = false;
          }
        } catch (err) {
          checks["api"] = {
            status: "disconnected",
            latencyMs: Date.now() - apiStart,
            error: sanitizeError(err),
          };
          healthy = false;
        }
      } else {
        checks["api"] = { status: "not_configured", latencyMs: 0 };
      }

      return reply.code(healthy ? 200 : 503).send({
        healthy,
        checks,
        checkedAt: new Date().toISOString(),
      });
    },
  );
};
```

- [ ] **Step 3.4: Run the tests — confirm they pass**

Run: `pnpm --filter @switchboard/chat test -- src/routes/__tests__/health.test.ts`

Expected: all 4 tests PASS (healthy path, DB failure, api-not-configured-is-fine, api 5xx).

- [ ] **Step 3.5: Commit**

```bash
git add apps/chat/src/routes/health.ts apps/chat/src/routes/__tests__/health.test.ts
git commit -m "feat(chat): add /api/health/deep readiness endpoint with DB+Redis+api checks"
```

---

## Task 4: Wire the chat health routes into `apps/chat/src/main.ts`

**Why:** The plugin from Task 3 must be registered on the Fastify app so the endpoint is actually reachable. The chat process already constructs its Prisma + Redis clients during startup; we pass those plus the new `SWITCHBOARD_API_URL` + `INTERNAL_API_SECRET` env-vars into the plugin options.

**Files:**

- Modify: `apps/chat/src/main.ts` — add import and register call near the existing inline `/health` (line ~230).

---

- [ ] **Step 4.1: Locate the registration site**

Run: `grep -n 'app.get("/health"' apps/chat/src/main.ts`

Expected: a single hit on the existing inline `/health` route registration (~line 230). The new plugin should be registered immediately before or after this line, so both health paths are wired together for readability.

- [ ] **Step 4.2: Add the import at the top of `main.ts`**

Edit `apps/chat/src/main.ts`. Near the other route imports (search for `registerManagedWebhookRoutes` to find the cluster), add:

```typescript
import { chatHealthRoutes } from "./routes/health.js";
```

- [ ] **Step 4.3: Register the plugin alongside the existing `/health`**

Immediately above the existing `app.get("/health", async ...)` block, add:

```typescript
  // Deep readiness — distinct from the shallow /health above; used by external uptime
  // probes and Render's readiness gating per docs/superpowers/specs/2026-05-15-deployment-hosting-design.md
  await app.register(chatHealthRoutes, {
    prefix: "/api/health",
    prisma: healthPrisma ?? null,
    redis: healthRedis ?? null,
    apiBaseUrl: process.env["SWITCHBOARD_API_URL"] ?? null,
    internalApiSecret: process.env["INTERNAL_API_SECRET"] ?? null,
  });
```

(The `healthPrisma` and `healthRedis` references come from the existing inline `/health` handler — they are already in scope at that point in `main.ts`.)

- [ ] **Step 4.4: Run typecheck for the chat package**

Run: `pnpm --filter @switchboard/chat typecheck`

Expected: PASS. If the `healthPrisma` or `healthRedis` names are out of scope where you added the registration, move the registration to the right block (immediately above the line where the inline `/health` reads them).

- [ ] **Step 4.5: Run the full chat test suite — confirm no regressions**

Run: `pnpm --filter @switchboard/chat test`

Expected: PASS. The new endpoint is in its own file with its own tests; existing tests should be unaffected.

- [ ] **Step 4.6: Commit**

```bash
git add apps/chat/src/main.ts
git commit -m "feat(chat): register /api/health/deep route in main.ts"
```

---

## Task 5: Author `render.yaml`

**Why:** Spec §5 requires Render topology to be Infrastructure-as-Code in the repo. The `render.yaml` declares the two web services (`api`, `chat`), the managed Postgres, the managed Redis, the pre-deploy command for `api` only (enforcing the migration-runner invariant), and the shallow `/health` path used for Render's container-promotion gating.

**Files:**

- Create: `render.yaml` at repo root.
- **Possibly create** (only if Step 5.0 verification reveals Render's blueprint does not support multi-stage `--target` selection): `Dockerfile.api`, `Dockerfile.chat` as per-service Dockerfiles. See Step 5.2.

**Design decisions (locked):**

- `healthCheckPath: /health` for **both** services — shallow liveness. This matches spec §7's deliberate decision: deep readiness (`/api/health/deep`) is correct for monitoring/UptimeRobot but **wrong for Render gating**, because chat's deep endpoint reports `api`-reachability and would fail during `api` blips, triggering needless chat redeploys.
- **No `dockerCommand` override.** The Dockerfile's `api` stage ends with `CMD ["node", "apps/api/dist/server.js"]` and the `chat` stage with `CMD ["node", "apps/chat/dist/main.js"]`. Per the audit, these are correct; overriding them would be a footgun.
- `SWITCHBOARD_API_URL` is set as a **direct value** (`http://switchboard-api:3000`), not via `fromService`. Render's private network resolves the service name `switchboard-api` to its internal hostname; the port is 3000 (set deterministically in the same blueprint). Setting the full URL with scheme + port eliminates the chat-side "is this a hostport or a URL?" ambiguity.
- `region: <RENDER_REGION>` is a deliberate fill-in (3 occurrences) — the operator picks at provisioning per spec §3 and replaces all three before connecting to Render.
- `envVars` blocks declare **keys only** for secrets (`sync: false`). Values are entered in the Render UI from the master vault.

---

- [ ] **Step 5.0 (verification gate): confirm current Render Blueprint schema**

This step exists because Render's Blueprint v2 schema may have evolved. The implementation must use the currently-valid schema, not a snapshot from this plan's authoring date.

Open https://render.com/docs/blueprint-spec and confirm the **current** spec for each of the following. If any differs from what this plan's example uses, **adjust the example before writing the file**:

1. **Redis declaration.** This plan declares Redis as `type: redis` inside the top-level `services:` list. If Render's current schema uses a different block (e.g., a separate top-level `redis:` list), use that form. **Do not commit speculative or "validate later" blocks.**
2. **Postgres declaration.** This plan uses a top-level `databases:` list. Verify it's still the correct location and field name.
3. **Multi-stage Dockerfile target selection.** The existing `Dockerfile` has stages `api`, `chat`, `dashboard`, `mcp-server`. Each web service needs to build only its target stage.
   - If Render's blueprint supports a multi-stage target field on the service (current candidates as of writing: `dockerfileTarget`, `target`, or similar), use it. The example below uses `dockerfileTarget` as a working guess — replace with the verified field name.
   - **If no such field exists in current Render blueprint:** fall back to creating `Dockerfile.api` and `Dockerfile.chat` as per-service Dockerfiles (Step 5.2 below), and reference them via `dockerfilePath`.
4. **`preDeployCommand`.** This plan uses `preDeployCommand` (camelCase, on the service). Verify field name and casing.
5. **`healthCheckPath`.** Same — verify field name and casing.

Record in the PR description which version of the Render Blueprint reference was consulted (URL + date), so future readers can see what was current at provisioning.

- [ ] **Step 5.1: Write the `render.yaml` file**

Create `render.yaml` at the repo root. The example below uses field names that are **best-known correct** as of this plan's authoring; replace any that Step 5.0 identified as different in the current Render schema.

```yaml
# Render Infrastructure-as-Code for Switchboard pilot launch.
# Reference: docs/superpowers/specs/2026-05-15-deployment-hosting-design.md
#
# Values for envVars with `sync: false` are entered in the Render UI from
# the master vault. This file declares only their *keys*.
#
# Region (3 occurrences) is set by the operator at provisioning per spec §3.
# Replace <RENDER_REGION> with the chosen region before connecting to Render.

services:
  - type: web
    name: switchboard-api
    runtime: docker
    dockerfilePath: ./Dockerfile
    dockerfileTarget: api          # If Step 5.0 verification finds a different field name, replace here.
    dockerContext: .
    plan: starter
    region: <RENDER_REGION>
    numInstances: 1
    branch: main
    autoDeploy: true
    healthCheckPath: /health        # Shallow liveness — Render uses this to gate container promotion.
    preDeployCommand: pnpm --filter @switchboard/db run migrate:deploy
    buildFilter:
      paths:
        - apps/api/**
        - packages/**
        - Dockerfile
        - pnpm-lock.yaml
        - render.yaml
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3000
      - key: HOST
        value: 0.0.0.0
      - key: DATABASE_URL
        fromDatabase:
          name: switchboard-postgres
          property: connectionString
      - key: REDIS_URL
        fromService:
          type: redis
          name: switchboard-redis
          property: connectionString
      - key: CREDENTIALS_ENCRYPTION_KEY
        sync: false
      - key: INTERNAL_API_SECRET
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: VOYAGE_API_KEY
        sync: false
      - key: META_ADS_ACCESS_TOKEN
        sync: false
      - key: META_ADS_ACCOUNT_ID
        sync: false
      - key: META_PIXEL_ID
        sync: false
      - key: STRIPE_SECRET_KEY
        sync: false
      - key: STRIPE_WEBHOOK_SECRET
        sync: false
      - key: INNGEST_EVENT_KEY
        sync: false
      - key: INNGEST_SIGNING_KEY
        sync: false
      - key: SENTRY_DSN_SERVER
        sync: false
      - key: LOG_LEVEL
        value: info

  - type: web
    name: switchboard-chat
    runtime: docker
    dockerfilePath: ./Dockerfile
    dockerfileTarget: chat         # Same caveat as `api` above.
    dockerContext: .
    plan: starter
    region: <RENDER_REGION>
    numInstances: 1
    branch: main
    autoDeploy: true
    healthCheckPath: /health        # Shallow liveness — does NOT depend on api reachability.
    buildFilter:
      paths:
        - apps/chat/**
        - packages/**
        - Dockerfile
        - pnpm-lock.yaml
        - render.yaml
    envVars:
      - key: NODE_ENV
        value: production
      - key: CHAT_PORT
        value: 3001
      - key: HOST
        value: 0.0.0.0
      - key: DATABASE_URL
        fromDatabase:
          name: switchboard-postgres
          property: connectionString
      - key: REDIS_URL
        fromService:
          type: redis
          name: switchboard-redis
          property: connectionString
      - key: CREDENTIALS_ENCRYPTION_KEY
        sync: false
      - key: INTERNAL_API_SECRET
        sync: false
      - key: SWITCHBOARD_API_URL
        value: http://switchboard-api:3000   # Render private network: http://<service-name>:<PORT>. PORT for api is 3000 (set above).
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: TELEGRAM_WEBHOOK_SECRET
        sync: false
      - key: WHATSAPP_TOKEN
        sync: false
      - key: WHATSAPP_PHONE_NUMBER_ID
        sync: false
      - key: WHATSAPP_APP_SECRET
        sync: false
      - key: WHATSAPP_VERIFY_TOKEN
        sync: false
      - key: SLACK_BOT_TOKEN
        sync: false
      - key: SLACK_SIGNING_SECRET
        sync: false
      - key: VOYAGE_API_KEY
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: SENTRY_DSN_SERVER
        sync: false
      - key: LOG_LEVEL
        value: info

  - type: redis
    name: switchboard-redis
    plan: starter
    region: <RENDER_REGION>
    maxmemoryPolicy: allkeys-lru
    ipAllowList: []                # Empty list = private-network only, no public access.

databases:
  - name: switchboard-postgres
    plan: starter
    region: <RENDER_REGION>
    postgresMajorVersion: 16
```

- [ ] **Step 5.2 (conditional fallback): per-service Dockerfiles if multi-stage target selection isn't supported**

Only execute this step if Step 5.0 verification revealed that Render's current blueprint **does not** support multi-stage Docker `--target` selection. In that case:

1. Remove the `dockerfileTarget:` line from both services in `render.yaml`.
2. Change `dockerfilePath: ./Dockerfile` → `dockerfilePath: ./Dockerfile.api` for `switchboard-api`, and `./Dockerfile.chat` for `switchboard-chat`.
3. Create `Dockerfile.api` at repo root by copying the existing `Dockerfile` and removing the `chat`, `dashboard`, and `mcp-server` stages. The remaining stages (`base`, `build`, `api`) form a complete build that produces an api-only image.
4. Create `Dockerfile.chat` similarly, keeping `base`, `build`, `chat` and removing the others.

The existing `Dockerfile` at repo root stays — `docker-compose.prod.yml` and local integration testing still depend on it.

If Step 5.0 confirmed Render does support `dockerfileTarget` (or the equivalent), **skip this step entirely** — the single Dockerfile + target selection is the cleaner solution and avoids duplication.

- [ ] **Step 5.3: Validate the YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('render.yaml'))"`

Expected: no output (clean parse). If `python3` is unavailable, run `node -e "require('js-yaml').load(require('fs').readFileSync('render.yaml','utf8'))"` or another YAML parser. A parse error here means the file isn't even YAML, never mind valid blueprint.

- [ ] **Step 5.4: Sanity-grep the secrets and the placeholder count**

Run: `grep -E '^\s*- key:' render.yaml | sort -u`

Expected output includes (at minimum): `CREDENTIALS_ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `META_ADS_ACCESS_TOKEN`, `META_ADS_ACCOUNT_ID`, `META_PIXEL_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `SENTRY_DSN_SERVER`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`. Cross-reference against the spec's §4 matrix — anything missing must be added before commit.

Also confirm only the deliberate region placeholder remains:

Run: `grep -c '<RENDER_REGION>' render.yaml`

Expected: `3` (api service region, chat service region, redis region — Postgres in `databases:` also uses it, depending on whether you count its placement; verify against the actual file). If there's any other placeholder string (`<TBD>`, `TODO`, `FIXME`, `validate later`), remove it — the file must be ready to provision against once `<RENDER_REGION>` is filled.

- [ ] **Step 5.5: Commit**

```bash
git add render.yaml Dockerfile.api Dockerfile.chat   # Last two only if Step 5.2 ran.
git commit -m "feat(deploy): add render.yaml declaring api+chat+Postgres+Redis topology"
```

---

## Task 6: Author `docs/runbooks/production-urls.md`

**Why:** Spec §10 step 10 requires a single document of record for production-environment specifics: the live URLs, Render region, plan tiers, monitoring links, and the vault entries map. The file is filled in at provisioning time; this task creates the template with all expected sections.

**Files:**

- Create: `docs/runbooks/production-urls.md`

---

- [ ] **Step 6.1: Write the template**

Create `docs/runbooks/production-urls.md`:

````markdown
# Production URLs and Hosting Map

> **Status:** Template. Operator fills in at provisioning time per `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` §10 step 10.

## Service URLs

| Service | URL | Host | Plan | Notes |
|---|---|---|---|---|
| Dashboard | `https://<TBD>` | Vercel | <Hobby/Pro> | Next.js + NextAuth. PR previews on. |
| API | `https://<TBD>` | Render Web Service (public) | Starter | Fastify REST. `SWITCHBOARD_API_URL` on chat + dashboard points here. |
| Chat | `https://<TBD>` | Render Web Service (public) | Starter | Fastify webhook server. Custom domain (`chat.<your-domain>`) recommended for Meta. |
| Postgres | (internal) | Render Postgres | Starter | Snapshots: daily, <RETENTION_DAYS> retention. Validated at provisioning. |
| Redis | (internal) | Render Redis | Starter | Cache + rate-limit. Lose-able. |

## Render region

- **Chosen region:** `<TBD>`
- **Rationale:** <fill in: closest to primary pilot users + webhook traffic per spec §3>

## Webhook callback URLs (registered with providers)

| Provider | Endpoint | Registered at | Verify token / signing secret reference |
|---|---|---|---|
| WhatsApp (Meta) | `https://<chat-domain>/webhook/managed/<webhookId>` | Meta Business Manager | `WHATSAPP_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET` |
| Instagram (Meta) | `https://<chat-domain>/webhook/managed/<webhookId>` | Meta Business Manager | Same as WhatsApp app |
| Telegram | `https://<chat-domain>/webhook/telegram` | `pnpm cli:register-webhook` | `TELEGRAM_WEBHOOK_SECRET` |
| Slack | `https://<chat-domain>/webhook/managed/<webhookId>` | Slack app config (Event Subscriptions) | `SLACK_SIGNING_SECRET` |

## Monitoring dashboards

| Surface | URL |
|---|---|
| Sentry (server) | `<TBD>` |
| Sentry (client) | `<TBD>` |
| UptimeRobot (api `/api/health/deep`) | `<TBD>` |
| UptimeRobot (chat `/api/health/deep`) | `<TBD>` |
| Render dashboard | `<TBD>` |
| Vercel dashboard | `<TBD>` |
| Inngest Cloud | `<TBD>` |

## Vault entries map

> The master copy of every secret lives in the password manager. The host-UI value is a copy. This table records the path/title in the vault for each Render env-var key, so rotations have a single source of truth to update first.

| Render env-var key | Vault item path/title |
|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | `<TBD>` |
| `INTERNAL_API_SECRET` | `<TBD>` |
| `ANTHROPIC_API_KEY` | `<TBD>` |
| `VOYAGE_API_KEY` | `<TBD>` |
| `META_ADS_ACCESS_TOKEN` | `<TBD>` |
| `META_PIXEL_ID` | `<TBD>` |
| `WHATSAPP_TOKEN` | `<TBD>` |
| `WHATSAPP_APP_SECRET` | `<TBD>` |
| `WHATSAPP_VERIFY_TOKEN` | `<TBD>` |
| `TELEGRAM_BOT_TOKEN` | `<TBD>` |
| `TELEGRAM_WEBHOOK_SECRET` | `<TBD>` |
| `SLACK_BOT_TOKEN` | `<TBD>` |
| `SLACK_SIGNING_SECRET` | `<TBD>` |
| `STRIPE_SECRET_KEY` | `<TBD>` |
| `STRIPE_WEBHOOK_SECRET` | `<TBD>` |
| `INNGEST_EVENT_KEY` | `<TBD>` |
| `INNGEST_SIGNING_KEY` | `<TBD>` |
| `SENTRY_DSN_SERVER` | `<TBD>` |
| `NEXT_PUBLIC_SENTRY_DSN` (on Vercel) | `<TBD>` |
| `NEXTAUTH_SECRET` (on Vercel) | `<TBD>` |

## Rollback URLs

| Target | URL |
|---|---|
| Render rollback (api) | `<TBD>` |
| Render rollback (chat) | `<TBD>` |
| Vercel rollback (dashboard) | `<TBD>` |

## Postgres backup management

- **Snapshot listing:** Render dashboard → switchboard-postgres → Backups
- **Restore drill cadence:** quarterly, before public launch, after major schema migration (per spec §8)
- **Last drill:** `<TBD>`
- **Next drill due:** `<TBD>`
````

- [ ] **Step 6.2: Commit**

```bash
git add docs/runbooks/production-urls.md
git commit -m "docs(runbooks): production URLs and hosting map template"
```

---

## Task 7: Author `docs/runbooks/secret-rotation.md`

**Why:** Spec §4 discipline rule 4 requires a documented rotation procedure per provider-issued token. Solo operator at pilot — the rotation playbook is what makes "rotate every 90 days" feasible. Each provider gets a short entry: dashboard URL, rotation steps, Render env keys to update.

**Files:**

- Create: `docs/runbooks/secret-rotation.md`

---

- [ ] **Step 7.1: Write the rotation runbook**

Create `docs/runbooks/secret-rotation.md`:

````markdown
# Secret Rotation Runbook

> **Discipline:** Master record in the password manager. Rotation **updates the vault first**, then propagates the new value to Render (and Vercel, if applicable). See `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` §4 rule 3.

For each provider below, the entry covers: where to rotate, what to do, and which Render env-var keys to update with the new value.

## Anthropic API key

- **Dashboard:** https://console.anthropic.com/settings/keys
- **Rotation steps:**
  1. Create a new API key in the Anthropic console.
  2. Update the vault entry for `ANTHROPIC_API_KEY` with the new value.
  3. Set the new value in Render for both `switchboard-api` and `switchboard-chat`. The services restart automatically.
  4. Once you have confirmed traffic is flowing on the new key (Anthropic console → usage), revoke the old key.

## Meta WhatsApp / Instagram / Ads tokens

> Meta tokens are time-limited (short-lived debug or 60-day system-user tokens). The rotation is the renewal.

- **Dashboard:** https://business.facebook.com → Business settings → System users → (relevant system user) → Generate new token
- **Rotation steps:**
  1. Generate a new system-user token with the same permissions (`whatsapp_business_management`, `whatsapp_business_messaging`, `ads_management`, `business_management`).
  2. Update the relevant vault entries: `WHATSAPP_TOKEN`, `META_ADS_ACCESS_TOKEN` (often the same token).
  3. Update Render env on `switchboard-api` (for `META_ADS_ACCESS_TOKEN`) and `switchboard-chat` (for `WHATSAPP_TOKEN`).
  4. **WHATSAPP_APP_SECRET** and **WHATSAPP_VERIFY_TOKEN** are app-level, not token-level. They rotate only when you regenerate the app in Meta Developer console or change the webhook verification setup, respectively.

## Telegram bot token

- **Dashboard:** Telegram → talk to @BotFather → `/token` → choose bot → "Revoke current token"
- **Rotation steps:**
  1. Revoke and regenerate via @BotFather. Telegram immediately invalidates the old token.
  2. Update vault entry `TELEGRAM_BOT_TOKEN`.
  3. Update Render env on `switchboard-chat`. The chat process restarts and registers the webhook with the new token via the existing `/webhook/telegram` URL.
  4. **TELEGRAM_WEBHOOK_SECRET** is a value you choose; rotate it by picking a new random string, updating the vault + Render, then re-registering the webhook with `pnpm cli:register-webhook`.

## Slack bot token and signing secret

- **Dashboard:** https://api.slack.com/apps → (your app) → Install App / Basic Information
- **Rotation steps:**
  1. **Bot token:** "Install App" → "Reinstall to Workspace" → copy the new `xoxb-…` token.
  2. **Signing secret:** Basic Information → "Show" / "Regenerate" under Signing Secret.
  3. Update vault entries `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`.
  4. Update Render env on `switchboard-chat`. Old tokens stop working immediately on regeneration.

## Stripe API keys

- **Dashboard:** https://dashboard.stripe.com/apikeys
- **Rotation steps:**
  1. **Secret key:** "Roll" the existing key. Stripe gives a 24-hour grace window where both old and new work.
  2. **Webhook secret:** Per webhook endpoint, "Roll" — same 24-hour grace.
  3. Update vault entries `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
  4. Update Render env on `switchboard-api`. Verify the next webhook event is accepted before the 24-hour grace lapses.

## Voyage AI API key

- **Dashboard:** https://dash.voyageai.com (or current Voyage console URL)
- **Rotation steps:**
  1. Generate a new API key.
  2. Update vault entry `VOYAGE_API_KEY`.
  3. Update Render env on both `switchboard-api` and `switchboard-chat` (both services use embeddings).
  4. Revoke the old key after confirming new traffic.

## Inngest signing keys

- **Dashboard:** https://app.inngest.com/<workspace>/settings/signing-keys
- **Rotation steps:**
  1. Inngest supports zero-downtime rotation by configuring a "next" signing key in the dashboard.
  2. Update vault entries `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
  3. Update Render env on `switchboard-api`. Inngest holds both old and new active until you mark the rotation complete in the dashboard.

## NextAuth secret

- **Source:** Generated locally (e.g., `openssl rand -base64 32`).
- **Rotation steps:**
  1. Generate a new value.
  2. Update vault entry `NEXTAUTH_SECRET`.
  3. Update Vercel env (Production scope) for the dashboard.
  4. Redeploy Vercel.
  5. **Side effect:** all existing NextAuth sessions are invalidated. Pick a time when active users are minimal.

## Credentials encryption key

> **DO NOT ROTATE WITHOUT A MIGRATION PLAN.** Stored credentials in Postgres are encrypted with this key. Rotating it without re-encrypting renders existing credentials unreadable. See [[feedback_dev_stack]] — seed-vs-runtime encryption mismatch is a known footgun.

- If rotation is genuinely needed (compromise), the procedure is: re-encrypt all rows with the new key while both keys are temporarily available, then cut over. This requires a custom migration script and operator approval.
````

- [ ] **Step 7.2: Commit**

```bash
git add docs/runbooks/secret-rotation.md
git commit -m "docs(runbooks): per-provider secret rotation procedures"
```

---

## Task 8: Author `scripts/smoke-prod.sh`

**Why:** Spec §10 step 7 lists the post-deploy smoke checklist. Several items are automatable (HTTP probes, migration status). Wrapping them in a script means the operator runs one command instead of seven, and the script's exit code is the pass/fail signal. Items that require browser interaction (dashboard load + drag-and-drop) stay manual.

**Files:**

- Create: `scripts/smoke-prod.sh`

---

- [ ] **Step 8.1: Write the smoke script**

Create `scripts/smoke-prod.sh`:

```bash
#!/usr/bin/env bash
# smoke-prod.sh — automated production smoke checks for the deployment spec's runbook.
#
# Usage:
#   API_URL=https://api.example.com \
#   CHAT_URL=https://chat.example.com \
#   INTERNAL_API_SECRET=... \
#   ./scripts/smoke-prod.sh
#
# Exits 0 if every check passes, non-zero (and prints which check failed) otherwise.
# Browser-side smoke (dashboard drag-and-drop, Sentry test events, rollback rehearsal)
# is documented in docs/superpowers/specs/2026-05-15-deployment-hosting-design.md §10
# steps 7 + 11 + 12 and stays manual.

set -euo pipefail

# Required CLI dependencies. Fail early with a clear message if anything is missing.
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required" >&2; exit 64; }
command -v jq   >/dev/null 2>&1 || { echo "ERROR: jq is required (brew install jq / apt-get install jq)" >&2; exit 64; }

require() {
  local var_name="$1"
  if [ -z "${!var_name:-}" ]; then
    echo "ERROR: $var_name is required" >&2
    exit 64
  fi
}

require API_URL
require CHAT_URL
require INTERNAL_API_SECRET

pass=0
fail=0

check() {
  local label="$1"
  shift
  printf "  %-50s " "$label"
  if "$@" >/tmp/smoke-prod-last.log 2>&1; then
    echo "OK"
    pass=$((pass + 1))
  else
    echo "FAIL"
    echo "    last output:"
    sed 's/^/      /' /tmp/smoke-prod-last.log
    fail=$((fail + 1))
  fi
}

check_http_ok() {
  local url="$1"
  shift
  local status
  status=$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' "$@" "$url")
  [ "$status" = "200" ] || { echo "expected 200, got $status"; return 1; }
}

check_http_status() {
  local url="$1"
  local expected="$2"
  shift 2
  local status
  status=$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' "$@" "$url")
  [ "$status" = "$expected" ] || { echo "expected $expected, got $status"; return 1; }
}

check_json_field() {
  local url="$1"
  local field="$2"
  local expected="$3"
  shift 3
  local actual
  actual=$(curl --max-time 10 -s "$@" "$url" | jq -r "$field")
  [ "$actual" = "$expected" ] || { echo "$field: expected $expected, got $actual"; return 1; }
}

echo "Running production smoke checks against:"
echo "  API_URL=$API_URL"
echo "  CHAT_URL=$CHAT_URL"
echo

echo "[api]"
check "GET /health returns 200" \
  check_http_ok "$API_URL/health"
check "GET /api/health/deep returns 200" \
  check_http_ok "$API_URL/api/health/deep" -H "x-internal-api-secret: $INTERNAL_API_SECRET"
check "/api/health/deep reports database=connected" \
  check_json_field "$API_URL/api/health/deep" '.checks.database.status' 'connected' \
    -H "x-internal-api-secret: $INTERNAL_API_SECRET"
check "/api/health/deep reports redis=connected" \
  check_json_field "$API_URL/api/health/deep" '.checks.redis.status' 'connected' \
    -H "x-internal-api-secret: $INTERNAL_API_SECRET"

echo "[chat]"
check "GET /health returns 200" \
  check_http_ok "$CHAT_URL/health"
check "GET /api/health/deep returns 200" \
  check_http_ok "$CHAT_URL/api/health/deep"
check "/api/health/deep reports database=connected" \
  check_json_field "$CHAT_URL/api/health/deep" '.checks.database.status' 'connected'
check "/api/health/deep reports redis=connected" \
  check_json_field "$CHAT_URL/api/health/deep" '.checks.redis.status' 'connected'
check "/api/health/deep reports api reachability" \
  check_json_field "$CHAT_URL/api/health/deep" '.checks.api.status' 'connected'

echo "[webhook routing — negative case]"
check "chat returns 4xx for an unknown managed-webhook id (routing alive)" \
  check_http_status "$CHAT_URL/webhook/managed/__smoke__" "404" -X POST -H "content-type: application/json" -d '{}'

# This check proves only that the routing layer is alive — it is NOT a signature-
# verification test. Real signature verification (Meta hub.verify_token, Slack signing
# secret, Telegram secret token) is channel-specific and requires real webhookIds and
# valid signed payloads; it remains a manual smoke step in the runbook.

echo
echo "Summary: $pass passed, $fail failed"
if [ $fail -gt 0 ]; then
  exit 1
fi
exit 0
```

- [ ] **Step 8.2: Make the script executable**

Run: `chmod +x scripts/smoke-prod.sh`

- [ ] **Step 8.3: Lint with shellcheck if available, else POSIX-syntax-check with bash**

Run: `command -v shellcheck >/dev/null && shellcheck scripts/smoke-prod.sh || bash -n scripts/smoke-prod.sh`

Expected: clean output (no warnings from shellcheck if installed; no syntax errors from `bash -n`).

- [ ] **Step 8.4: Dry-run against bogus URLs to verify the failure path**

Run:

```bash
API_URL=http://localhost:9999 \
CHAT_URL=http://localhost:9999 \
INTERNAL_API_SECRET=test \
./scripts/smoke-prod.sh || true
```

Expected: every check FAILs (because nothing is listening on :9999), the summary reports `0 passed, N failed`, and the script exits non-zero. This confirms the failure-detection path works.

- [ ] **Step 8.5: Commit**

```bash
git add scripts/smoke-prod.sh
git commit -m "feat(scripts): smoke-prod.sh automates the deployment runbook's HTTP smoke checks"
```

---

## Task 9: Update `.env.example` with `SWITCHBOARD_API_URL` documentation and Inngest cloud notes

**Why:** The spec introduces `SWITCHBOARD_API_URL` as the dashboard's server-side API base URL. `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` exist in `.env.example` but without a note explaining they are required for Inngest Cloud (Render production) and unused in local Inngest dev mode.

**Files:**

- Modify: `.env.example`

---

- [ ] **Step 9.1: Locate the Inngest block and the dashboard section**

Run: `grep -n 'INNGEST\|SWITCHBOARD_API_URL\|NEXTAUTH_URL' .env.example`

Expected: hits on `INNGEST_EVENT_KEY=` and `INNGEST_SIGNING_KEY=` (already present), `SWITCHBOARD_API_URL=` if it exists, and `NEXTAUTH_URL=`. The `SWITCHBOARD_API_URL` line may already exist; if it doesn't, Task 9 adds it.

- [ ] **Step 9.2: Annotate the Inngest block**

Edit `.env.example`. Find the existing Inngest section (look for `INNGEST_EVENT_KEY=`) and ensure the comment above it reads:

```
# Inngest async-job orchestration.
# Local dev: leave blank — `inngest dev` connects to the API's /api/inngest endpoint
# without signing.
# Production (Inngest Cloud): both keys are REQUIRED. Generated in the Inngest
# Cloud dashboard at https://app.inngest.com/<workspace>/settings/signing-keys.
# Set on the `api` service in Render.
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

- [ ] **Step 9.3: Document `SWITCHBOARD_API_URL` in the dashboard section**

Find the `NEXTAUTH_URL=` line in `.env.example`. Above it, add (if not already present):

```
# Dashboard's server-side base URL for the Switchboard API.
# Consumed by apps/dashboard's Next.js API routes (see apps/dashboard/src/lib/get-api-client.ts).
# The browser does not call the API directly — calls are proxied server-side through
# Next.js API routes, so this is NOT prefixed with NEXT_PUBLIC_.
# Local dev: http://localhost:3000
# Production: the public Render URL of the api service.
SWITCHBOARD_API_URL=http://localhost:3000
```

If a `SWITCHBOARD_API_URL=` line already exists elsewhere in the file (it may), consolidate to one canonical location with this comment block.

- [ ] **Step 9.4: Commit**

```bash
git add .env.example
git commit -m "docs(env): document SWITCHBOARD_API_URL and Inngest-Cloud env requirements"
```

---

## Task 10: Final verification — typecheck, lint, test, dashboard build

**Why:** Catch any regressions introduced by the touched files. Per `feedback_dashboard_build_not_in_ci`, `next build` is not in CI, so the dashboard build must be exercised locally.

**Files:** none modified in this task — verification only.

---

- [ ] **Step 10.1: Run workspace typecheck**

Run: `pnpm typecheck`

Expected: PASS for every package. If `@switchboard/db` reports missing exports, run `pnpm reset` first per `CLAUDE.md`.

- [ ] **Step 10.2: Run workspace lint**

Run: `pnpm lint`

Expected: PASS. Pre-existing `any`-warnings in `apps/api` routes are acceptable (per CLAUDE.md). No NEW warnings should appear from the files this plan touched.

- [ ] **Step 10.3: Run the chat test suite**

Run: `pnpm --filter @switchboard/chat test`

Expected: all tests pass, including the new `apps/chat/src/routes/__tests__/health.test.ts` (4 tests) and the updated `apps/chat/src/__tests__/sentry-bootstrap.test.ts`.

- [ ] **Step 10.4: Run the api test suite**

Run: `pnpm --filter @switchboard/api test`

Expected: PASS. The Sentry rename only touches `bootstrap/sentry.ts`; no existing api test references `process.env.SENTRY_DSN` directly.

- [ ] **Step 10.5: Run the dashboard build (catches Next.js-specific regressions CI misses)**

Run: `pnpm --filter @switchboard/dashboard build`

Expected: clean `next build` output, no type errors, no missing-module errors. (`.env.example` documentation changes don't affect the build, but it's a cheap regression check.)

- [ ] **Step 10.6: Confirm the produced artifacts list matches the plan**

Run:

```bash
git diff --name-only main..HEAD
```

Expected (exact set, modulo ordering):

```
.env.example
apps/api/src/bootstrap/sentry.ts
apps/chat/src/__tests__/sentry-bootstrap.test.ts
apps/chat/src/bootstrap/sentry.ts
apps/chat/src/main.ts
apps/chat/src/routes/__tests__/health.test.ts
apps/chat/src/routes/health.ts
docs/runbooks/production-urls.md
docs/runbooks/secret-rotation.md
docs/superpowers/plans/2026-05-15-deployment-hosting-implementation.md
packages/db/package.json
render.yaml
scripts/smoke-prod.sh
```

Plus, **only if Task 5 Step 5.2 ran** (Render's blueprint doesn't support multi-stage target selection, so per-service Dockerfiles are needed):

```
Dockerfile.api
Dockerfile.chat
```

If any file is missing or any unexpected file is in the diff, investigate before opening the PR.

- [ ] **Step 10.7: Open the PR**

```bash
git push -u origin docs/deployment-hosting-plan
gh pr create --base main --head docs/deployment-hosting-plan \
  --title "feat(deploy): pilot launch implementation — render.yaml, Sentry rename, chat /api/health/deep, runbooks, smoke script" \
  --body "$(cat <<'EOF'
## Summary

Implements `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` (PR #504) for pilot launch on Vercel + Render.

Code/config changes:
- `render.yaml` declaring api + chat + Postgres + Redis
- `chat /api/health/deep` deep readiness endpoint with DB + Redis + api-reachability checks
- `SENTRY_DSN` → `SENTRY_DSN_SERVER` rename in api + chat + `.env.example`
- `packages/db` gets `migrate:deploy` and `migrate:status` scripts
- `.env.example` documents `SWITCHBOARD_API_URL` and Inngest-Cloud env requirements

Operational artifacts (filled at provisioning time):
- `docs/runbooks/production-urls.md` — URLs, region, plan tiers, monitoring links, vault map
- `docs/runbooks/secret-rotation.md` — per-provider rotation procedures
- `scripts/smoke-prod.sh` — automates the runbook's HTTP smoke checks

Out of scope (per spec §11):
- `apps/mcp-server` production deployment (STDIO-only, no production caller)

## Test plan
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm --filter @switchboard/chat test` passes (new routes/__tests__/health.test.ts + updated sentry-bootstrap.test.ts)
- [ ] `pnpm --filter @switchboard/api test` passes
- [ ] `pnpm --filter @switchboard/dashboard build` succeeds
- [ ] `scripts/smoke-prod.sh` fails cleanly against bogus URLs (dry run); will be re-run against real URLs at launch per runbook

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Closing notes

After this plan's PR merges, the implementation surface is exhausted. The remaining launch work is operational and documented in spec §10:

- Vercel + Render provisioning (operator runs `render.yaml` connect-from-repo)
- Vault → Render UI env-var copying
- WhatsApp / Telegram / Slack webhook registration
- Sentry alert-rule configuration (especially the `test=true` exclusion)
- UptimeRobot monitor setup
- Rollback rehearsal
- 24-hour first-user dry run

That work is **not** in scope for any future implementation PR. It's executed live against the deploy hosts following the runbooks this plan creates.
