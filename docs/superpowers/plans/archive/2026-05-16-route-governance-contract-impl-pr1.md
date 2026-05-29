# Route Governance Contract v1 — Impl PR-1 Plan: Operator-Direct Cohort + Checker Warning Mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the Route Governance Contract v1 across the 4 ingress-migrated operator-direct routes (mandatory `Idempotency-Key`, typed Fastify decorators replacing duplicated preHandlers, normalized envelopes, Cohort B → A WorkTrace migration), and ship the `check-routes` per-class validator in warning-mode-on-touched-routes-only so the doctrine enforces from day one.

**Architecture:** Three new utilities (`validation-error.ts`, `auth-fallback.ts`, `decorators/require-org.ts`) replace the per-route preHandler + 403/orgId-narrowing boilerplate currently duplicated in the 4 routes. `requireIdempotencyKey()` extends the existing `idempotency-key.ts` with a mandatory variant. The `recommendation.ts` operator-mutation handler folds the route's current pre-flight tenant check into the handler so cross-tenant access produces a `RECOMMENDATION_NOT_FOUND` failed outcome with a persisted WorkTrace (Cohort B → A migration per spec §5.1). `check-routes` gains a header parser + per-class matrix validator gated by a new `--mode=warn-touched` flag; CI runs it as a non-blocking advisory.

**Tech Stack:** Fastify 5 (typed decorators + preHandler chains), Zod (parameter + outputs schemas), Vitest (TDD), TypeScript (strict; no `any`), pnpm/Turborepo monorepo, ts-morph (check-routes AST traversal).

**Consumes:** `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` (lands first via PR #604). Sections referenced: §3 matrix, §4 envelope, §5 cohort canonicalization, §6 decorators, §7 idempotency, §9 outputs sub-pattern (referenced but not yet wired — that's PR-2/PR-3), §12 migration strategy.

**Out of scope (deferred to PR-2/3/4):** Cross-app type relocation (PR-2), store-layer sweep (PR-3), `@route-class` backfill of the remaining 63 routes (PR-4), flip from warning to error (PR-4), removal of legacy `requireOrganizationScope` / `resolveOrganizationForMutation` helpers (PR-4), `outputs` typed-schema migration end-to-end (PR-2/PR-3).

---

## File structure

### Create

| Path                                                    | Responsibility                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/utils/validation-error.ts`                | Shared `replyValidationError(reply, zodError)` helper — the §4.3 normalized envelope.                                                                                                                                                            |
| `apps/api/src/utils/__tests__/validation-error.test.ts` | Vitest suite for `replyValidationError`.                                                                                                                                                                                                         |
| `apps/api/src/utils/auth-fallback.ts`                   | `buildDevAuthFallback(app)` factory returning a preHandler — consolidates the `if (app.authDisabled) populate from x-org-id` block currently duplicated in 4 routes. Factory shape avoids Fastify `this`-binding fragility across plugin scopes. |
| `apps/api/src/utils/__tests__/auth-fallback.test.ts`    | Vitest suite for `buildDevAuthFallback`.                                                                                                                                                                                                         |
| `apps/api/src/decorators/require-org.ts`                | `requireOrg` + `requireOrgForMutation` typed preHandlers + module augmentation adding narrowed `request.orgId: string` and `request.actorId: string`.                                                                                            |
| `apps/api/src/decorators/__tests__/require-org.test.ts` | Vitest suite for both decorators.                                                                                                                                                                                                                |
| `.agent/tools/route-class-validator.ts`                 | Per-class matrix validation rules + `validateRouteClass(sourceFile, repoPath): Warning[]` API. Pure data — no I/O.                                                                                                                               |
| `.agent/tools/__tests__/route-class-validator.test.ts`  | Vitest suite for the validator.                                                                                                                                                                                                                  |

### Modify

| Path                                                                                       | Change                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/utils/idempotency-key.ts`                                                    | Add `requireIdempotencyKey(request, reply): string \| null` mandatory variant (existing `getIdempotencyKey` unchanged).                                                                                                                                                                                                      |
| `apps/api/src/utils/__tests__/idempotency-key.test.ts`                                     | Extend with require-variant tests (the file may not exist yet — if not, create it).                                                                                                                                                                                                                                          |
| `apps/api/src/app.ts`                                                                      | Only the `FastifyRequest` module augmentation at line 43 extends with the new narrowed `orgId` + `actorId` properties. **No `app.decorate("requireOrg", ...)` registration** — PR-1 uses direct imports per Task 4 / Task 10.                                                                                                |
| `apps/api/src/__tests__/test-server.ts`                                                    | No change required (decorators are direct imports). If any test imports `requireOrg` directly, that's the only adjustment.                                                                                                                                                                                                   |
| `apps/api/src/bootstrap/operator-intents/recommendation.ts`                                | Cohort B → A migration: handler fetches the recommendation row inside the try block, returns `failed-RECOMMENDATION_NOT_FOUND` for both missing-row and tenant-mismatch. Replace the comment that says "made unreachable by the pre-flight checks in the route."                                                             |
| `apps/api/src/routes/recommendations.ts`                                                   | Remove the pre-flight `getById` + `row.orgId !== orgId` block (lines 178-184 today). Adopt direct-imported `requireOrgForMutation`, `requireIdempotencyKey`, and `buildDevAuthFallback(app)` (no `app.decorate`). Drop the duplicated `app.addHook("preHandler", ...)` block. Add `// @route-class: operator-direct` header. |
| `apps/api/src/routes/dashboard-opportunities.ts`                                           | Adopt direct-imported `requireOrgForMutation`, `requireIdempotencyKey`, and `buildDevAuthFallback(app)`. Drop duplicated preHandler. Add `// @route-class: operator-direct` header.                                                                                                                                          |
| `apps/api/src/routes/lifecycle-disqualifications.ts`                                       | Adopt direct-imported `requireOrgForMutation`, `requireIdempotencyKey`, and `buildDevAuthFallback(app)`. Drop duplicated preHandler. Add `// @route-class: operator-direct` header.                                                                                                                                          |
| `apps/api/src/routes/admin-consent.ts`                                                     | Adopt direct-imported `requireOrgForMutation`, `requireIdempotencyKey`, and `buildDevAuthFallback(app)`. Drop duplicated preHandler. Add `// @route-class: operator-direct` header.                                                                                                                                          |
| `apps/api/src/routes/__tests__/dashboard-opportunities-ingress.test.ts`                    | Add: 400 when Idempotency-Key absent; decorator-narrowed `request.orgId` reaches handler; existing happy/failure cases continue to pass.                                                                                                                                                                                     |
| `apps/api/src/routes/__tests__/recommendations-ingress.test.ts`                            | Add: 400 when Idempotency-Key absent; **WorkTrace persisted for tenant-reject path** (cross-tenant `getById` no longer pre-flight-rejected); existing tests continue to pass.                                                                                                                                                |
| `apps/api/src/routes/__tests__/lifecycle-disqualifications-ingress.test.ts`                | Add: 400 when Idempotency-Key absent; decorator-narrowed contract; existing tests continue to pass.                                                                                                                                                                                                                          |
| `apps/api/src/routes/__tests__/admin-consent.test.ts` (or `admin-consent-ingress.test.ts`) | Add: 400 when Idempotency-Key absent; decorator-narrowed contract; existing tests continue to pass.                                                                                                                                                                                                                          |
| `.agent/tools/check-routes.ts`                                                             | Add `--mode=warn-touched` CLI flag. When set: detect touched files via `git diff --name-only origin/main HEAD` filtered to route paths, parse each touched route's `@route-class` header, invoke `validateRouteClass`, print warnings to stderr, exit 0. When unset: existing behavior.                                      |
| `.github/workflows/ci.yml`                                                                 | Add new step in `architecture` job: `Route class advisory` running `bash .agent/tools/check-routes --mode=warn-touched` with `continue-on-error: true`.                                                                                                                                                                      |

### Untouched but worth noting

- `apps/api/src/utils/require-org.ts` (`requireOrganizationScope`) — KEEP. Still used by non-migrated routes (e.g., `recommendations.ts` GET handler, `dashboard-overview.ts`, etc.). PR-4 audits whether to deprecate.
- `apps/api/src/utils/org-access.ts` (`assertOrgAccess`, `resolveOrganizationForMutation`) — KEEP. `actions.ts:62` + `execute.ts` use `resolveOrganizationForMutation` for body-orgId fallback (a need the 4 migrated routes don't have). PR-4 audits.
- `apps/api/src/bootstrap/operator-intents/disqualification.ts` — already returns `failed` outcomes for `DISQUALIFICATION_NOT_FOUND` and `DISQUALIFICATION_CONFLICT` (verified during plan-writing on 2026-05-16). Cohort C is already Cohort-A-conforming; no handler change needed. The plan adds a tenant-reject regression test in the route's test suite.
- `apps/api/src/bootstrap/operator-intents/opportunity.ts` + `consent.ts` — already Cohort A.

---

## Implementation tasks

### Task 0: Preflight — Client compatibility + pattern decision

This task is a **hard blocker** for all subsequent tasks. The Idempotency-Key mandate (Task 1+) breaks any client that POSTs to these endpoints without the header. The decorator pattern decision must be committed before route refactors so the plan doesn't ship two competing patterns.

**Files:** read-only audit. May produce changes in `apps/dashboard/src/lib/api-client*.ts`, `apps/dashboard/src/lib/hooks/use-*.ts`, or similar dashboard fetch helpers if any caller lacks the header.

- [ ] **Step 1: Commit to the decorator pattern.**

Decision: **direct imports, no `app.decorate()` registration**. Routes do `import { requireOrgForMutation } from "../decorators/require-org.js"` and pass the function reference in their `{ preHandler: requireOrgForMutation }` route options. This avoids Fastify-instance typing churn and matches the code examples in Tasks 4-9.

Verify the plan does NOT call for `app.decorate("requireOrg", ...)` anywhere. Grep this plan file: `grep -n 'app\.decorate.*require' THIS_PLAN.md` — expected: zero matches in implementation tasks.

If any subsequent task (4, 6-9, 10) references `app.requireOrg` or `app.requireOrgForMutation`, that's a plan bug — file it as an issue and use direct import.

- [ ] **Step 2: Two-pass grep for callers of the 7 operator-direct endpoints.**

The literal URL grep misses common patterns (template literals with variable IDs, typed API clients, route-constant indirection). Run BOTH passes.

**Pass 1 — literal URL strings (catches direct fetch calls):**

```bash
grep -rIn '"/api/recommendations/[^"]*/act"\|/api/dashboard/opportunities/[^/]*\+/stage\|/api/dashboard/lifecycle/disqualifications/[^/]*\+/confirm\|/api/dashboard/lifecycle/disqualifications/[^/]*\+/dismiss\|/api/admin/consent/grant\|/api/admin/consent/revoke\|/api/admin/consent/clear' \
  apps/dashboard apps/chat apps/api \
  --include='*.ts' --include='*.tsx' 2>&1 | grep -v __tests__
```

**Pass 2 — broader keyword sweep (catches template literals, route constants, typed clients):**

```bash
rg -n 'recommendations/[^/]+/act|dashboard/opportunities/[^/]+/stage|lifecycle/disqualifications|admin/consent/(grant|revoke|clear)|Idempotency-Key' \
  apps/dashboard apps/chat apps/api \
  --glob '*.{ts,tsx}' 2>&1 | grep -v __tests__
```

**Pass 3 — route-constant inspection (manual):**

Read these files top-to-bottom (existence varies by codebase) and identify any route helper functions or constants:

- `apps/dashboard/src/lib/api-client.ts`
- `apps/dashboard/src/lib/routes.ts` (if exists)
- `apps/dashboard/src/lib/hooks/use-*.ts` for the 4 endpoint families
- Any `*-client.ts` or `*Routes.ts` file in `apps/dashboard/src/`

Capture results into a scratch note: which files call these endpoints (directly or via a helper), and do they send `Idempotency-Key`?

- [ ] **Step 3: Audit each caller for the header.**

For each non-test caller, open the file and check the `fetch` / `apiClient.post` / equivalent call. Verify either:

- The call passes `headers: { "Idempotency-Key": <some_key> }`, OR
- The shared `apiClient` / `fetch` wrapper auto-injects it on POST/PATCH/DELETE.

If neither is true, the caller breaks after PR-1's route changes ship.

- [ ] **Step 4: Fix any callers that lack the header.**

The simplest fix: extract a `mutationFetch(url, body)` helper in `apps/dashboard/src/lib/api-client.ts` (or wherever the shared fetcher lives) that auto-injects `Idempotency-Key` on every POST/PATCH/DELETE call to operator-direct endpoints.

**Use a defensive UUID helper** — `crypto.randomUUID()` is not always available (older SSR contexts, some Vitest/jsdom environments, polyfilled browsers). Create a one-shot helper:

```ts
// apps/dashboard/src/lib/idempotency.ts
export function createIdempotencyKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `idemp_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
}
```

Then the shared wrapper calls it once per mutation:

```ts
async function mutationFetch(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": createIdempotencyKey(),
    },
    body: JSON.stringify(body),
  });
}
```

Add a unit test for `createIdempotencyKey`:

- When `globalThis.crypto.randomUUID` is defined → returns the UUID.
- When `globalThis.crypto` is undefined → returns the `idemp_*` fallback.
- Returned value is always a non-empty string.

Update all 7-endpoint callers to use `mutationFetch`. If no shared wrapper exists, apply the per-caller fix inline using `createIdempotencyKey()`. Either way, the change lands in THIS PR — not a follow-up.

- [ ] **Step 5: Verify the fix end-to-end.**

If a fix was applied, write a quick test in the affected hook's test file asserting the header is present in the outbound request. Then run that test file.

```bash
pnpm --filter @switchboard/dashboard test -- --run <affected-test-file> 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 6: Commit (if fixes were applied).**

```bash
git add <touched dashboard client files>
git commit -m "$(cat <<'EOF'
chore(dashboard): inject Idempotency-Key on operator-direct mutation calls

Preflight for Route Governance Contract v1 PR-1: the upcoming server-side
mandate breaks any client that POSTs to the 7 operator-direct endpoints
without the header. This commit lands the client-side compat shim BEFORE
the server-side mandate so the rollout is a no-op from the UI side.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If the audit found zero callers needing fixes, document that result in the PR description and skip the commit.

---

### Task 1: Add `requireIdempotencyKey()` mandatory helper

**Files:**

- Modify: `apps/api/src/utils/idempotency-key.ts`
- Modify or create: `apps/api/src/utils/__tests__/idempotency-key.test.ts`

- [ ] **Step 1: Confirm the test file location.**

Run: `ls apps/api/src/utils/__tests__/idempotency-key.test.ts 2>&1`
Expected: file exists OR "No such file or directory."

If file does not exist, create with the test in Step 2. If it exists, append the new tests.

- [ ] **Step 2: Write failing tests for `requireIdempotencyKey`.**

Write to `apps/api/src/utils/__tests__/idempotency-key.test.ts` (create the file if it does not exist):

```ts
import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";
import { getIdempotencyKey, requireIdempotencyKey } from "../idempotency-key.js";

function fakeRequest(headers: Record<string, string | undefined> = {}): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & { sent: { code?: number; body?: unknown } } {
  const captured: { code?: number; body?: unknown } = {};
  const reply = {
    sent: captured,
    code(c: number) {
      captured.code = c;
      return reply;
    },
    send(b: unknown) {
      captured.body = b;
      return reply;
    },
  };
  return reply as unknown as FastifyReply & { sent: { code?: number; body?: unknown } };
}

describe("requireIdempotencyKey", () => {
  it("returns the trimmed header when present", () => {
    const reply = fakeReply();
    const key = requireIdempotencyKey(fakeRequest({ "idempotency-key": "  abc123  " }), reply);
    expect(key).toBe("abc123");
    expect(reply.sent.code).toBeUndefined();
  });

  it("returns null and emits 400 when header absent", () => {
    const reply = fakeReply();
    const key = requireIdempotencyKey(fakeRequest({}), reply);
    expect(key).toBeNull();
    expect(reply.sent.code).toBe(400);
    expect(reply.sent.body).toEqual({
      error: "missing_idempotency_key",
      hint: "Idempotency-Key header is required for this endpoint",
      statusCode: 400,
    });
  });

  it("returns null and emits 400 when header is whitespace-only", () => {
    const reply = fakeReply();
    const key = requireIdempotencyKey(fakeRequest({ "idempotency-key": "   " }), reply);
    expect(key).toBeNull();
    expect(reply.sent.code).toBe(400);
  });

  it("returns null and emits 400 when header is non-string", () => {
    const reply = fakeReply();
    // Fastify can deliver string[] for repeated headers
    const key = requireIdempotencyKey(
      fakeRequest({ "idempotency-key": ["a", "b"] as unknown as string }),
      reply,
    );
    expect(key).toBeNull();
    expect(reply.sent.code).toBe(400);
  });
});

describe("getIdempotencyKey (existing — regression coverage)", () => {
  it("returns trimmed string when present", () => {
    expect(getIdempotencyKey(fakeRequest({ "idempotency-key": " xyz " }))).toBe("xyz");
  });

  it("returns undefined when absent", () => {
    expect(getIdempotencyKey(fakeRequest({}))).toBeUndefined();
  });

  it("returns undefined when whitespace-only", () => {
    expect(getIdempotencyKey(fakeRequest({ "idempotency-key": "   " }))).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/utils/__tests__/idempotency-key.test.ts 2>&1 | tail -20`
Expected: FAIL — `requireIdempotencyKey` is not a function (import error).

- [ ] **Step 4: Implement `requireIdempotencyKey`.**

Add to `apps/api/src/utils/idempotency-key.ts` (keep the existing `getIdempotencyKey` export unchanged):

```ts
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Mandatory variant of {@link getIdempotencyKey}: when the `Idempotency-Key`
 * header is missing or invalid, sends a 400 response and returns `null`. Route
 * handlers short-circuit on a `null` return with `if (!key) return;`.
 *
 * Used by operator-direct routes per the Route Governance Contract v1 (§7.1).
 * Other route classes use `getIdempotencyKey` (optional) or omit the contract
 * entirely.
 */
export function requireIdempotencyKey(request: FastifyRequest, reply: FastifyReply): string | null {
  const key = getIdempotencyKey(request);
  if (!key) {
    reply.code(400).send({
      error: "missing_idempotency_key",
      hint: "Idempotency-Key header is required for this endpoint",
      statusCode: 400,
    });
    return null;
  }
  return key;
}
```

Note: the existing `getIdempotencyKey` already handles non-string headers via the `typeof raw !== "string"` guard, so the non-string test case in Step 2 exercises both helpers correctly.

- [ ] **Step 5: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/utils/__tests__/idempotency-key.test.ts 2>&1 | tail -20`
Expected: PASS — all 7 cases green.

- [ ] **Step 6: Commit.**

```bash
git -C /Users/jasonli/switchboard/.claude/worktrees/audit-phase3a-impl-pr1 add apps/api/src/utils/idempotency-key.ts apps/api/src/utils/__tests__/idempotency-key.test.ts
git -C /Users/jasonli/switchboard/.claude/worktrees/audit-phase3a-impl-pr1 commit -m "$(cat <<'EOF'
feat(api): add requireIdempotencyKey mandatory variant

Operator-direct routes per Route Governance Contract v1 §7.1 will use
this variant; the existing optional getIdempotencyKey stays for
control-plane and lifecycle routes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

_Note: the worktree path for the IMPL PR will be set up by the executing agent via `superpowers:using-git-worktrees`; the path in this plan's git commands assumes `audit-phase3a-impl-pr1` per convention. Adjust if the actual worktree path differs._

---

### Task 2: Create `validation-error.ts` helper

**Files:**

- Create: `apps/api/src/utils/validation-error.ts`
- Create: `apps/api/src/utils/__tests__/validation-error.test.ts`

- [ ] **Step 1: Write failing test for `replyValidationError`.**

Create `apps/api/src/utils/__tests__/validation-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { replyValidationError } from "../validation-error.js";

function fakeReply(): FastifyReply & { sent: { code?: number; body?: unknown } } {
  const captured: { code?: number; body?: unknown } = {};
  const reply = {
    sent: captured,
    code(c: number) {
      captured.code = c;
      return reply;
    },
    send(b: unknown) {
      captured.body = b;
      return reply;
    },
  };
  return reply as unknown as FastifyReply & { sent: { code?: number; body?: unknown } };
}

describe("replyValidationError", () => {
  it("emits 400 with normalized envelope per spec §4.3", () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = schema.safeParse({ name: "" });
    if (result.success) throw new Error("test setup invariant: parse should fail");

    const reply = fakeReply();
    replyValidationError(reply, result.error);

    expect(reply.sent.code).toBe(400);
    expect(reply.sent.body).toEqual({
      error: "invalid_body",
      issues: result.error.issues,
      statusCode: 400,
    });
  });

  it("returns the reply for chainable use", () => {
    const schema = z.object({ x: z.number() });
    const result = schema.safeParse({ x: "not a number" });
    if (result.success) throw new Error("test setup invariant: parse should fail");

    const reply = fakeReply();
    const returned = replyValidationError(reply, result.error);
    expect(returned).toBe(reply);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/utils/__tests__/validation-error.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `replyValidationError`.**

Create `apps/api/src/utils/validation-error.ts`:

```ts
import type { FastifyReply } from "fastify";
import type { ZodError } from "zod";

/**
 * Emits the canonical validation-failure envelope per Route Governance
 * Contract v1 §4.3. Replaces the current mix of
 * `{ details: error.format() }`, `{ issues: error.issues.map(...) }`, and
 * `{ details: error.issues }` across routes.
 *
 * The envelope intentionally returns raw `ZodIssue[]` (not formatted /
 * stringified): clients parse `code`, `path`, and `message` directly off the
 * issue array.
 */
export function replyValidationError(reply: FastifyReply, error: ZodError): FastifyReply {
  return reply.code(400).send({
    error: "invalid_body",
    issues: error.issues,
    statusCode: 400,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/utils/__tests__/validation-error.test.ts 2>&1 | tail -10`
Expected: PASS — both cases green.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/utils/validation-error.ts apps/api/src/utils/__tests__/validation-error.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add replyValidationError helper for §4.3 envelope

Single source for the canonical validation-failure envelope across all
route classes per Route Governance Contract v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create `auth-fallback.ts` — shared dev-mode preHandler

**Files:**

- Create: `apps/api/src/utils/auth-fallback.ts`
- Create: `apps/api/src/utils/__tests__/auth-fallback.test.ts`

- [ ] **Step 1: Write failing tests for `devAuthFallback`.**

Create `apps/api/src/utils/__tests__/auth-fallback.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { buildDevAuthFallback } from "../auth-fallback.js";

describe("buildDevAuthFallback (factory)", () => {
  it("populates organizationIdFromAuth + principalIdFromAuth from headers in dev mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.addHook("preHandler", buildDevAuthFallback(app));
    app.get("/probe", (request) => ({
      org: request.organizationIdFromAuth,
      principal: request.principalIdFromAuth,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-org-id": "org_demo", "x-principal-id": "alice" },
    });
    expect(res.json()).toEqual({ org: "org_demo", principal: "alice" });
    await app.close();
  });

  it("defaults to 'default' org + principal when headers absent in dev mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.addHook("preHandler", buildDevAuthFallback(app));
    app.get("/probe", (request) => ({
      org: request.organizationIdFromAuth,
      principal: request.principalIdFromAuth,
    }));

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.json()).toEqual({ org: "default", principal: "default" });
    await app.close();
  });

  it("does not overwrite existing organizationIdFromAuth set by auth middleware", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.addHook("preHandler", async (request) => {
      request.organizationIdFromAuth = "org_from_auth";
      request.principalIdFromAuth = "user_from_auth";
    });
    app.addHook("preHandler", buildDevAuthFallback(app));
    app.get("/probe", (request) => ({
      org: request.organizationIdFromAuth,
      principal: request.principalIdFromAuth,
    }));

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.json()).toEqual({ org: "org_from_auth", principal: "user_from_auth" });
    await app.close();
  });

  it("does nothing in auth-enabled mode (authDisabled === false)", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.addHook("preHandler", buildDevAuthFallback(app));
    app.get("/probe", (request) => ({
      org: request.organizationIdFromAuth ?? null,
      principal: request.principalIdFromAuth ?? null,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-org-id": "org_demo" },
    });
    expect(res.json()).toEqual({ org: null, principal: null });
    await app.close();
  });

  it("integrates correctly when registered inside a plugin", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    await app.register(async (plugin) => {
      plugin.addHook("preHandler", buildDevAuthFallback(plugin));
      plugin.get("/p", (request) => ({ org: request.organizationIdFromAuth }));
    });
    const res = await app.inject({ method: "GET", url: "/p", headers: { "x-org-id": "org_int" } });
    expect(res.json()).toEqual({ org: "org_int" });
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/utils/__tests__/auth-fallback.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildDevAuthFallback` factory.**

Use a **factory pattern** that captures the app in a closure rather than relying on Fastify's `this`-binding inside hooks (which can break across plugin scopes). This is the explicit safer pattern called out in the review of this plan.

Create `apps/api/src/utils/auth-fallback.ts`:

```ts
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";

/**
 * Returns a dev-mode preHandler that populates `request.organizationIdFromAuth`
 * and `request.principalIdFromAuth` from `x-org-id` / `x-principal-id`
 * headers, falling back to "default" when the headers are absent. The returned
 * handler is a no-op when `app.authDisabled === false` (production /
 * staging auth-enabled mode).
 *
 * Replaces the per-route `app.addHook("preHandler", async (request) => { if
 * (app.authDisabled) ... })` block currently duplicated across the 4
 * ingress-migrated routes (`dashboard-opportunities`, `recommendations`,
 * `lifecycle-disqualifications`, `admin-consent`).
 *
 * Factory shape (vs. a free function relying on `this`): captures the app
 * reference in a closure so plugin-scoped registrations work correctly
 * regardless of Fastify's hook binding semantics.
 *
 * Designed to run BEFORE `requireOrg` / `requireOrgForMutation` in the
 * preHandler chain so the org-id is populated by the time those decorators
 * check for it.
 *
 * Idempotent: does not overwrite a field already populated by an earlier
 * preHandler (e.g., the production auth middleware).
 */
export function buildDevAuthFallback(app: FastifyInstance): preHandlerAsyncHookHandler {
  return async function devAuthFallback(request) {
    if (app.authDisabled !== true) return;

    const orgHeader = request.headers["x-org-id"];
    if (typeof orgHeader === "string" && orgHeader.trim()) {
      request.organizationIdFromAuth = orgHeader.trim();
    } else if (!request.organizationIdFromAuth) {
      request.organizationIdFromAuth = "default";
    }

    const principalHeader = request.headers["x-principal-id"];
    if (typeof principalHeader === "string" && principalHeader.trim()) {
      request.principalIdFromAuth = principalHeader.trim();
    } else if (!request.principalIdFromAuth) {
      request.principalIdFromAuth = "default";
    }
  };
}
```

Route plugins (Tasks 6-9) register the fallback as `app.addHook("preHandler", buildDevAuthFallback(app))` inside the plugin function where `app` is the parameter the plugin receives. The tests in Step 1 already use this shape — no further adjustment needed.

Bonus: add one integration test that mounts the fallback through a real plugin (not a bare `/probe`) to verify it works under Fastify's plugin-scope binding:

```ts
it("integrates correctly when registered inside a plugin", async () => {
  const app = Fastify();
  app.decorate("authDisabled", true);
  await app.register(async (plugin) => {
    plugin.addHook("preHandler", buildDevAuthFallback(plugin));
    plugin.get("/p", (request) => ({ org: request.organizationIdFromAuth }));
  });
  const res = await app.inject({ method: "GET", url: "/p", headers: { "x-org-id": "org_int" } });
  expect(res.json()).toEqual({ org: "org_int" });
  await app.close();
});
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/utils/__tests__/auth-fallback.test.ts 2>&1 | tail -10`
Expected: PASS — all 4 cases green.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/utils/auth-fallback.ts apps/api/src/utils/__tests__/auth-fallback.test.ts
git commit -m "$(cat <<'EOF'
feat(api): extract devAuthFallback preHandler to shared util

Replaces the duplicated `if (app.authDisabled) ...` preHandler block
currently in 4 routes. Operator-direct routes per Route Governance
Contract v1 §6.3 register this as the first preHandler in their chain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create `decorators/require-org.ts` — typed Fastify decorators

**Files:**

- Create: `apps/api/src/decorators/require-org.ts`
- Create: `apps/api/src/decorators/__tests__/require-org.test.ts`

- [ ] **Step 1: Write failing tests for `requireOrg` + `requireOrgForMutation`.**

Create `apps/api/src/decorators/__tests__/require-org.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { requireOrg, requireOrgForMutation } from "../require-org.js";
import { buildDevAuthFallback } from "../../utils/auth-fallback.js";

describe("requireOrg preHandler (read-side)", () => {
  it("narrows request.orgId + request.actorId when organizationIdFromAuth is set", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.get("/probe", { preHandler: [buildDevAuthFallback(app), requireOrg] }, (request) => ({
      orgId: request.orgId,
      actorId: request.actorId,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-org-id": "org_a", "x-principal-id": "user_a" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: "org_a", actorId: "user_a" });
    await app.close();
  });

  it("falls back actorId to 'unknown' when principalIdFromAuth absent in auth-enabled mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.addHook("preHandler", async (request) => {
      request.organizationIdFromAuth = "org_b";
      // principalIdFromAuth intentionally NOT set
    });
    app.get("/probe", { preHandler: requireOrg }, (request) => ({
      orgId: request.orgId,
      actorId: request.actorId,
    }));

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: "org_b", actorId: "unknown" });
    await app.close();
  });

  it("emits 403 normalized envelope when organizationIdFromAuth absent in auth-enabled mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.get("/probe", { preHandler: requireOrg }, () => ({ unreachable: true }));

    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
    await app.close();
  });
});

describe("requireOrgForMutation preHandler (write-side)", () => {
  it("narrows orgId + actorId when set (same as requireOrg)", async () => {
    const app = Fastify();
    app.decorate("authDisabled", true);
    app.post(
      "/probe",
      { preHandler: [buildDevAuthFallback(app), requireOrgForMutation] },
      (request) => ({ orgId: request.orgId, actorId: request.actorId }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/probe",
      headers: { "x-org-id": "org_c", "x-principal-id": "user_c" },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orgId: "org_c", actorId: "user_c" });
    await app.close();
  });

  it("emits 403 normalized envelope when org absent in auth-enabled mode", async () => {
    const app = Fastify();
    app.decorate("authDisabled", false);
    app.post("/probe", { preHandler: requireOrgForMutation }, () => ({ unreachable: true }));

    const res = await app.inject({ method: "POST", url: "/probe", payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/decorators/__tests__/require-org.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the decorators + module augmentation.**

Create `apps/api/src/decorators/require-org.ts`:

```ts
import type { preHandlerAsyncHookHandler } from "fastify";

/**
 * Augment FastifyRequest with the narrowed `orgId` and `actorId` properties
 * that operator-direct preHandlers set. Once `requireOrg` (or
 * `requireOrgForMutation`) has run, the handler can read these as
 * non-nullable `string` — no `?? "unknown"` boilerplate, no `if (!orgId)
 * return;` checks.
 *
 * The narrowing is a runtime contract, not a TS-enforced invariant: if a
 * route handler accesses `request.orgId` without first registering one of
 * these preHandlers, it will read `undefined` at runtime even though TS
 * thinks the value is `string`. Treat this as a Fastify-decorator-typical
 * convention (the same trade-off as `app.prisma` etc.).
 */
declare module "fastify" {
  interface FastifyRequest {
    /**
     * Set by `requireOrg` or `requireOrgForMutation` preHandler. Non-null
     * when the handler executes. See header comment for the runtime-contract
     * caveat.
     */
    orgId: string;
    /**
     * Set by `requireOrg` or `requireOrgForMutation` preHandler. Defaults to
     * `"unknown"` when production auth middleware did not bind a principal
     * (rare in prod with auth middleware; common in dev mode where
     * `devAuthFallback` populated the principal to "default").
     */
    actorId: string;
  }
}

/**
 * Read-side org-scope preHandler. Use on GET routes that should fail closed
 * when no organization is bound. For mutations, prefer
 * {@link requireOrgForMutation}.
 *
 * Behavior (Route Governance Contract v1 §6.3, envelope §4.5):
 * - If `request.organizationIdFromAuth` is set → narrow `request.orgId`
 *   + `request.actorId` and continue.
 * - If not set → reply 403 `{ error: "forbidden", reason: "no_org_binding",
 *   statusCode: 403 }`.
 */
export const requireOrg: preHandlerAsyncHookHandler = async (request, reply) => {
  const orgId = request.organizationIdFromAuth;
  if (!orgId) {
    return reply.code(403).send({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
  }
  request.orgId = orgId;
  request.actorId = request.principalIdFromAuth ?? "unknown";
};

/**
 * Write-side org-scope preHandler. Identical to {@link requireOrg} for the
 * 4 ingress-migrated routes (which do not accept body-supplied orgId). The
 * separate name + identical behavior is intentional: future tightening
 * (e.g., requiring an HMAC binding on mutating requests) lives here without
 * affecting read-side routes.
 *
 * Routes that DO accept body-supplied orgId in dev mode (e.g.,
 * `actions.ts:62`) keep using the legacy `resolveOrganizationForMutation`
 * helper — that's a separate PR-4 audit.
 */
export const requireOrgForMutation: preHandlerAsyncHookHandler = async (request, reply) => {
  const orgId = request.organizationIdFromAuth;
  if (!orgId) {
    return reply.code(403).send({
      error: "forbidden",
      reason: "no_org_binding",
      statusCode: 403,
    });
  }
  request.orgId = orgId;
  request.actorId = request.principalIdFromAuth ?? "unknown";
};
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/decorators/__tests__/require-org.test.ts 2>&1 | tail -10`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/decorators/require-org.ts apps/api/src/decorators/__tests__/require-org.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add requireOrg + requireOrgForMutation typed preHandlers

Replaces the per-route `requireOrganizationScope(request, reply)` +
`if (!orgId) return;` boilerplate currently duplicated across the 4
ingress-migrated routes. Narrows request.orgId + request.actorId to
non-nullable strings via Fastify module augmentation.

Route Governance Contract v1 §6.1-§6.3. Closes Cat 1 finding 1.5
(auth-cast removal happens in the route refactors that consume these).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Cohort B → A handler migration — `recommendation.ts`

**Files:**

- Modify: `apps/api/src/bootstrap/operator-intents/recommendation.ts`
- Modify: an existing test file or create `apps/api/src/bootstrap/operator-intents/__tests__/recommendation-handler.test.ts`

- [ ] **Step 1: Locate (or create) the handler-level test file.**

Run: `find apps/api -name 'recommendation*.test.ts' -not -path '*/node_modules/*' 2>&1`
Expected: route-level test at `apps/api/src/routes/__tests__/recommendations-ingress.test.ts` (or similar). No handler-level test exists yet — create one.

- [ ] **Step 2: Write failing tests for handler tenant-reject path.**

Create `apps/api/src/bootstrap/operator-intents/__tests__/recommendation-handler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { RecommendationStore } from "@switchboard/core";
import type { WorkUnit } from "@switchboard/core/platform";
import { buildActOnRecommendationHandler } from "../recommendation.js";

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu_1",
    requestedAt: new Date().toISOString(),
    organizationId: "org_a",
    actor: { id: "alice", type: "user" },
    intent: "operator.act_on_recommendation",
    parameters: { recommendationId: "rec_1", action: "primary" },
    deployment: { deploymentId: "dep_a" } as never,
    resolvedMode: "operator_mutation",
    traceId: "trace_1",
    trigger: "api",
    priority: "normal",
    ...overrides,
  } as WorkUnit;
}

function makeStore(overrides: Partial<RecommendationStore> = {}): RecommendationStore {
  return {
    getById: async () => null,
    applyAct: async () => ({ status: "ok" as const, row: null as never }),
    listBySurface: async () => [],
    create: async () => ({}) as never,
    ...overrides,
  } as RecommendationStore;
}

describe("buildActOnRecommendationHandler (Cohort A semantics)", () => {
  it("returns failed-RECOMMENDATION_NOT_FOUND when row absent", async () => {
    const store = makeStore({ getById: async () => null });
    const handler = buildActOnRecommendationHandler(store);
    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("RECOMMENDATION_NOT_FOUND");
  });

  it("returns failed-RECOMMENDATION_NOT_FOUND when row.orgId mismatches workUnit.organizationId", async () => {
    const applyAct = vi.fn();
    const store = makeStore({
      getById: async () => ({ id: "rec_1", orgId: "org_other" }) as never,
      applyAct: applyAct as never,
    });
    const handler = buildActOnRecommendationHandler(store);
    const result = await handler.execute(makeWorkUnit({ organizationId: "org_a" }));

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("RECOMMENDATION_NOT_FOUND");
    // Hardening assertion: tenant-reject MUST short-circuit BEFORE any
    // state-mutating call. A buggy handler could detect mismatch and still
    // call applyAct, which would mutate the wrong tenant's data.
    expect(applyAct).not.toHaveBeenCalled();
  });

  it("returns completed when row exists in the right org and act succeeds", async () => {
    const store = makeStore({
      getById: async () => ({ id: "rec_1", orgId: "org_a" }) as never,
      applyAct: async () => ({ status: "ok" as const, row: { id: "rec_1" } as never }),
    });
    const handler = buildActOnRecommendationHandler(store);
    const result = await handler.execute(makeWorkUnit({ organizationId: "org_a" }));

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.result).toBeDefined();
  });

  it("returns failed-RECOMMENDATION_INVALID_ACTION when applyAct rejects with surface mismatch", async () => {
    const store = makeStore({
      getById: async () => ({ id: "rec_1", orgId: "org_a" }) as never,
      applyAct: async () => {
        throw new Error("surface accepts only undo");
      },
    });
    const handler = buildActOnRecommendationHandler(store);
    const result = await handler.execute(makeWorkUnit({ organizationId: "org_a" }));

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("RECOMMENDATION_INVALID_ACTION");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/bootstrap/operator-intents/__tests__/recommendation-handler.test.ts 2>&1 | tail -10`
Expected: FAIL — first two cases fail because the current handler relies on the route's pre-flight and would throw (the route's pre-flight is unreachable inside a handler-only test).

- [ ] **Step 4: Update the handler to fold the pre-flight check into Cohort A.**

Replace `apps/api/src/bootstrap/operator-intents/recommendation.ts` contents:

```ts
// apps/api/src/bootstrap/operator-intents/recommendation.ts
// ---------------------------------------------------------------------------
// Phase 1b.2 / Route Governance Contract v1 PR-1 — operator.act_on_recommendation
//
// Cohort B → A migration (spec §5.1): the row-existence + tenant-isolation
// check now lives in the handler instead of a route pre-flight, so
// cross-tenant attempts produce a persisted WorkTrace with
// `failed-RECOMMENDATION_NOT_FOUND`. The route no longer pre-fetches.
// ---------------------------------------------------------------------------
import { actOnRecommendation } from "@switchboard/core";
import type { RecommendationStore } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { ActOnRecommendationParametersSchema } from "../../routes/operator-intents-schemas.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

export function buildActOnRecommendationHandler(
  recommendationStore: RecommendationStore,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = ActOnRecommendationParametersSchema.parse(workUnit.parameters);

      // Tenant-isolation reject: fold the route's former pre-flight check into
      // the handler so the failure path persists a WorkTrace. Cross-tenant
      // attempts surface as RECOMMENDATION_NOT_FOUND (not TENANT_MISMATCH) per
      // spec §5.1 — the conflation is intentional (do not leak existence).
      const row = await recommendationStore.getById(params.recommendationId);
      if (!row || row.orgId !== workUnit.organizationId) {
        return {
          outcome: "failed" as const,
          summary: "Recommendation not found",
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.RECOMMENDATION_NOT_FOUND,
            message: "Recommendation not found",
          },
        };
      }

      try {
        const result = await actOnRecommendation(recommendationStore, {
          recommendationId: params.recommendationId,
          orgId: workUnit.organizationId,
          actor: { principalId: workUnit.actor.id, type: "operator" },
          action: params.action,
          note: params.note,
        });
        return {
          outcome: "completed" as const,
          summary: `Recommendation ${params.recommendationId} acted on with ${params.action}`,
          outputs: { result },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("surface accepts")) {
          return {
            outcome: "failed" as const,
            summary: "Invalid action for recommendation surface",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.RECOMMENDATION_INVALID_ACTION,
              message: msg,
            },
          };
        }
        // Genuine unexpected — rethrow so the global handler returns scrubbed 500.
        throw err;
      }
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/bootstrap/operator-intents/__tests__/recommendation-handler.test.ts 2>&1 | tail -10`
Expected: PASS — all 4 cases green.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/bootstrap/operator-intents/recommendation.ts apps/api/src/bootstrap/operator-intents/__tests__/recommendation-handler.test.ts
git commit -m "$(cat <<'EOF'
fix(api): fold recommendation pre-flight check into handler (Cohort B → A)

Tenant-isolation reject for act_on_recommendation now produces a persisted
WorkTrace with failed-RECOMMENDATION_NOT_FOUND. The route's getById +
orgId mismatch pre-flight (which short-circuited before ingress and
left no audit trail) becomes the handler's first responsibility.

Route Governance Contract v1 §5.1 cohort canonicalization. The route
refactor that removes the pre-flight lands in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Refactor `recommendations.ts` route — adopt decorators + remove pre-flight

**Files:**

- Modify: `apps/api/src/routes/recommendations.ts`
- Modify: `apps/api/src/routes/__tests__/recommendations-ingress.test.ts` (file may need to be located first)

- [ ] **Step 1: Locate the route test file.**

Run: `ls apps/api/src/routes/__tests__/recommendations*.test.ts 2>&1`
Expected: one or more existing test files for the recommendations route.

- [ ] **Step 2: Add three failing tests covering the new contract.**

Append to the located test file (or create `apps/api/src/routes/__tests__/recommendations-ingress.test.ts` if no ingress test exists yet). The harness shape comes from the existing `recommendations-ingress.test.ts:1-90` pattern: `buildTestServer()` returns `{ app, cartridge, storage }`; `app.recommendationStore` is decorated by default; `app.lastIngressTrace` + `app.ingressTraceCount` are test-only observers (Object.defineProperty getters); seeding uses `emitRecommendation` from `@switchboard/core`.

```ts
import { describe, expect, it } from "vitest";
import { emitRecommendation } from "@switchboard/core";
import { buildTestServer } from "../../__tests__/test-server.js";

async function seedRec(app: import("fastify").FastifyInstance, orgId = "default") {
  const result = await emitRecommendation(app.recommendationStore!, {
    orgId,
    agentKey: "alex",
    intent: "recommendation.ad_set_pause",
    action: "pause",
    humanSummary: "PR-1 test rec",
    confidence: 0.6,
    dollarsAtRisk: 100,
    riskLevel: "low",
    parameters: {},
    presentation: {
      primaryLabel: "Pause",
      secondaryLabel: "Reduce",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    targetEntities: { campaignId: `c-pr1-${Date.now()}` },
  });
  if (result.surface === "dropped") throw new Error("seed must not drop");
  return result;
}

describe("POST /:id/act — Route Governance Contract v1 PR-1", () => {
  it("returns 400 missing_idempotency_key when Idempotency-Key header absent", async () => {
    const { app } = await buildTestServer();
    const rec = await seedRec(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      payload: { action: "primary" },
      // intentionally NO Idempotency-Key header
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    await app.close();
  });

  it("persists a WorkTrace with failed-RECOMMENDATION_NOT_FOUND for cross-tenant act", async () => {
    const { app } = await buildTestServer();
    // Seed a rec belonging to a DIFFERENT org than the request's auth org.
    const rec = await seedRec(app, "org_other");
    const prev = app.ingressTraceCount ?? 0;

    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      headers: { "Idempotency-Key": "key-xtenant-1", "x-org-id": "org_a" },
      payload: { action: "primary" },
    });

    expect(res.statusCode).toBe(404);
    // The whole point of the migration: WorkTrace persisted for tenant-reject.
    expect(app.ingressTraceCount).toBe(prev + 1);
    expect(app.lastIngressTrace?.outcome).toBe("failed");
    // The harness `lastIngressTrace` shape is { intent, mode, outcome, organizationId };
    // the typed error.code is on the trace's error object — extend the harness type
    // augmentation in test-server.ts:94 to expose it, or assert on the route's
    // 404 response body code instead. PR-1 plan recommends extending the harness.
    await app.close();
  });

  it("happy path still passes with new contract", async () => {
    const { app } = await buildTestServer();
    const rec = await seedRec(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/recommendations/${rec.id}/act`,
      headers: { "Idempotency-Key": "key-happy-1" },
      payload: { action: "primary" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
```

Harness extension note: the current `lastIngressTrace` type at `apps/api/src/__tests__/test-server.ts:94-99` exposes `{ intent, mode, outcome, organizationId }`. Extending it with the optional `error?: { code: string; message: string }` field is a 2-line change in `test-server.ts` that the tenant-reject test depends on for the `error.code` assertion. Land that extension in the same commit as the new tests.

- [ ] **Step 3: Run the tests to verify failures.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/routes/__tests__/recommendations 2>&1 | tail -30`
Expected: 2-3 FAILs (missing-key check + tenant-reject WorkTrace assertion; existing tests pass).

- [ ] **Step 4: Refactor `recommendations.ts` route.**

**Apply a minimal diff against the current file on `main`** — do not blindly replace the file contents from this plan's reference snippet. Line numbers and surrounding code (rate limit config, response shapes, schema metadata, route paths) may have drifted since plan-writing. The reference snippet below shows the _target shape_; the implementing agent reads the current file first, identifies the 9 specific deltas listed afterward, and applies them surgically. Re-run `git diff` after each delta to verify nothing unrelated changed.

Target shape (for reference — apply as a delta, not a replacement):

```ts
// @route-class: operator-direct
import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import {
  type RecommendationAction,
  type RecommendationSurface,
  type RecommendationStatus,
} from "@switchboard/core";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrg, requireOrgForMutation } from "../decorators/require-org.js";
import { replyValidationError } from "../utils/validation-error.js";
import { z } from "zod";
// Note: `requireOrganizationScope` from `../utils/require-org.js` is intentionally
// NOT imported — the new decorators (`requireOrg`, `requireOrgForMutation`)
// replace it for this route. PR-4 audits whether the legacy helper can be
// deprecated across the codebase.
import {
  ACT_ON_RECOMMENDATION_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
} from "../bootstrap/operator-intents.js";

const ACT_HTTP_RATE_LIMIT_MAX = parseInt(
  process.env["RECOMMENDATION_ACT_RATE_LIMIT_MAX"] ?? "300",
  10,
);
const ACT_HTTP_RATE_LIMIT_WINDOW_MS = parseInt(
  process.env["RECOMMENDATION_ACT_RATE_LIMIT_WINDOW_MS"] ?? "60000",
  10,
);

const VALID_SURFACES: ReadonlySet<RecommendationSurface> = new Set(["queue", "shadow_action"]);
const VALID_ACTIONS: ReadonlySet<RecommendationAction> = new Set([
  "primary",
  "secondary",
  "dismiss",
  "confirm",
  "undo",
]);

const ActBodySchema = z.object({
  action: z.enum(["primary", "secondary", "dismiss", "confirm", "undo"]),
  note: z.string().optional(),
});

function parseSinceMs(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d+)h$/.exec(s);
  if (!m) return undefined;
  return parseInt(m[1]!, 10) * 60 * 60 * 1000;
}

type RecommendationRow = NonNullable<
  Awaited<ReturnType<NonNullable<FastifyInstance["recommendationStore"]>["getById"]>>
>;

function rowToApiShape(row: RecommendationRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.orgId,
    agentKey: row.agentKey,
    intent: row.intent,
    action: row.action,
    humanSummary: row.humanSummary,
    confidence: row.confidence,
    dollarsAtRisk: row.dollarsAtRisk,
    riskLevel: row.riskLevel,
    surface: row.surface,
    status: row.status,
    parameters: row.parameters,
    targetEntities: row.targetEntities,
    sourceAgent: row.sourceAgent,
    sourceWorkflow: row.sourceWorkflow,
    actedBy: row.actedBy,
    actedAt: row.actedAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    undoableUntil: row.undoableUntil?.toISOString() ?? null,
  };
}

export const recommendationsRoutes: FastifyPluginAsync = async (app) => {
  if (!app.recommendationStore) {
    app.log.warn("[recommendations] route registered without store; will 503 on every request");
  }

  app.addHook("preHandler", buildDevAuthFallback(app));

  app.get(
    "/",
    {
      schema: {
        description: "List recommendations by surface",
        tags: ["Recommendations"],
      },
      preHandler: requireOrg,
    },
    async (request, reply) => {
      if (!app.recommendationStore) {
        return reply
          .code(503)
          .send({ error: "Recommendations store unavailable", statusCode: 503 });
      }
      const { orgId } = request;
      const q = request.query as {
        surface?: string;
        status?: string;
        since?: string;
        limit?: string;
      };
      if (!q.surface || !VALID_SURFACES.has(q.surface as RecommendationSurface)) {
        return reply.code(400).send({
          error: "surface query param required (queue|shadow_action)",
          statusCode: 400,
        });
      }
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 50, 200) : 50;
      const rows = await app.recommendationStore.listBySurface({
        orgId,
        surface: q.surface as Exclude<RecommendationSurface, "dropped">,
        status: (q.status ?? "pending") as RecommendationStatus,
        sinceMs: parseSinceMs(q.since),
        limit,
      });
      return reply.code(200).send({ recommendations: rows.map(rowToApiShape) });
    },
  );

  app.post(
    "/:id/act",
    {
      schema: {
        description: "Act on a recommendation (primary | secondary | dismiss | confirm | undo).",
        tags: ["Recommendations"],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        headers: {
          type: "object",
          properties: {
            "Idempotency-Key": {
              type: "string",
              description: "Required per Route Governance Contract v1",
            },
          },
        },
        body: {
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string" },
            note: { type: "string" },
          },
        },
      },
      config: {
        rateLimit: {
          max: ACT_HTTP_RATE_LIMIT_MAX,
          timeWindow: ACT_HTTP_RATE_LIMIT_WINDOW_MS,
        },
      },
      preHandler: requireOrgForMutation,
    },
    async (request, reply) => {
      if (!app.recommendationStore) {
        return reply
          .code(503)
          .send({ error: "Recommendations store unavailable", statusCode: 503 });
      }
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const parsed = ActBodySchema.safeParse(request.body);
      if (!parsed.success) return replyValidationError(reply, parsed.error);
      if (!VALID_ACTIONS.has(parsed.data.action)) {
        return reply.code(400).send({
          error: `action must be one of ${[...VALID_ACTIONS].join("|")}`,
          statusCode: 400,
        });
      }

      const { id } = request.params as { id: string };

      // Pre-flight check intentionally REMOVED — the handler now folds the
      // missing-row + tenant-mismatch check into a failed-NOT_FOUND outcome,
      // which persists a WorkTrace per Route Governance Contract v1 §5.1.

      const response = await app.platformIngress.submit({
        organizationId: request.orgId,
        actor: { id: request.actorId, type: "user" },
        intent: ACT_ON_RECOMMENDATION_INTENT,
        parameters: {
          recommendationId: id,
          action: parsed.data.action,
          note: parsed.data.note,
        },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }

      const { result } = response;
      if (result.outcome === "failed") {
        if (result.error?.code === OPERATOR_INTENT_ERROR_CODES.RECOMMENDATION_NOT_FOUND) {
          return reply.code(404).send({ error: "Recommendation not found", statusCode: 404 });
        }
        if (result.error?.code === OPERATOR_INTENT_ERROR_CODES.RECOMMENDATION_INVALID_ACTION) {
          return reply.code(400).send({ error: result.error.message, statusCode: 400 });
        }
        throw new Error(result.error?.message ?? "Operator mutation execution failed");
      }

      const actResult = (
        result.outputs as { result?: { status: string; row: Parameters<typeof rowToApiShape>[0] } }
      ).result;
      if (!actResult) {
        throw new Error("Operator mutation handler returned no result output");
      }
      if (actResult.status === "ok") {
        return reply.code(200).send({ recommendation: rowToApiShape(actResult.row) });
      }
      return reply.code(409).send({
        error: actResult.status,
        recommendation: rowToApiShape(actResult.row),
      });
    },
  );
};
```

Key diffs from current:

1. `// @route-class: operator-direct` header at top.
2. Imports: drop `getIdempotencyKey`, add `requireIdempotencyKey`, `buildDevAuthFallback`, `requireOrg`, `requireOrgForMutation`, `replyValidationError`, `z`. **Do not** import `requireOrganizationScope` (the legacy helper) — the decorators replace it.
3. Drop the `app.addHook("preHandler", ...)` block (the duplicated dev fallback) — replaced by `app.addHook("preHandler", buildDevAuthFallback(app))`.
4. GET handler: add `preHandler: requireOrg` to the route options; replace `requireOrganizationScope(request, reply)` + `if (!orgId) return;` with `const { orgId } = request;`.
5. POST handler: add `preHandler: requireOrgForMutation` to the route options; replace the org-scope + idempotency-optional-spread pattern with `requireOrgForMutation` decorator + `requireIdempotencyKey()`; use Zod-via-`replyValidationError` for body validation (the existing manual VALID_ACTIONS check stays as a defensive layer).
6. Remove the pre-flight `getById` + `row.orgId !== orgId` block (lines 178-184 in the current file).
7. Replace `parsed.data.action as RecommendationAction` with the typed `parsed.data.action` from the Zod enum.
8. Replace `principalId = request.principalIdFromAuth ?? "dashboard-user"` with `request.actorId` (set by `requireOrgForMutation`).
9. Replace conditional `...(idempotencyKey ? { idempotencyKey } : {})` with `idempotencyKey` directly (now mandatory).

- [ ] **Step 5: Run the route tests to verify they pass.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/routes/__tests__/recommendations 2>&1 | tail -30`
Expected: PASS — all new + existing tests green.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/routes/recommendations.ts apps/api/src/routes/__tests__/recommendations-ingress.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): adopt Route Governance Contract v1 in recommendations.ts

- @route-class: operator-direct header
- Decorators replace duplicated requireOrganizationScope boilerplate
- Idempotency-Key now mandatory via requireIdempotencyKey
- Pre-flight tenant check removed (handler now persists WorkTrace for
  failed-RECOMMENDATION_NOT_FOUND per Cohort B → A migration)
- Validation envelope normalized via replyValidationError

Closes Cat 3 findings 3.2 + 3.3 + 3.7 for this route. Cat 3.1 partial:
cross-tenant access now produces an audit trail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Refactor `dashboard-opportunities.ts` route

**Files:**

- Modify: `apps/api/src/routes/dashboard-opportunities.ts`
- Modify: `apps/api/src/routes/__tests__/dashboard-opportunities-ingress.test.ts`

- [ ] **Step 1: Write failing tests for new contract.**

Append to the existing test file:

`buildTestServer` accepts `{ opportunityStore }` (default: in-memory TestOpportunityStore is decorated). Seed using whatever the existing dashboard-opportunities-ingress test does — likely `app.opportunityStore!.create(...)` or `seedOpportunity(app, ...)` (locate the existing seed helper first).

```ts
describe("PATCH /:id/stage — Route Governance Contract v1 PR-1", () => {
  it("returns 400 missing_idempotency_key when header absent", async () => {
    const { app } = await buildTestServer();
    // Seed using whatever pattern the existing dashboard-opportunities-ingress
    // test uses (e.g., app.opportunityStore!.create(...) or a seed helper).
    // The seeding mechanic does not matter for this assertion — only that the
    // route's idempotency check fires before any store interaction.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_does_not_matter/stage",
      payload: { stage: "qualified" },
      // intentionally NO Idempotency-Key header
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    await app.close();
  });

  it("happy path: header present, narrowed orgId/actorId reach handler", async () => {
    const { app } = await buildTestServer();
    // Reuse existing seed mechanic from the existing dashboard-opportunities-ingress.test.ts.
    // Add an opportunity owned by "default" org; assert response < 500.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/dashboard/opportunities/opp_seeded_above/stage",
      headers: { "Idempotency-Key": "key-stage-1" },
      payload: { stage: "qualified" },
    });
    expect(res.statusCode).toBeLessThan(500);
    await app.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify failures.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/routes/__tests__/dashboard-opportunities 2>&1 | tail -30`
Expected: FAIL on the missing-Idempotency-Key check.

- [ ] **Step 3: Update `dashboard-opportunities.ts`.**

**Apply a minimal diff against the current file on `main`**, not a wholesale replacement. The reference snippet below shows the target shape; the implementing agent reads the current file first and applies the deltas surgically. Preserve unrelated imports, schema metadata, and any route-options keys (e.g., `config: { rateLimit: ... }`) that may have been added since plan-writing.

Target shape (for reference — apply as a delta, not a replacement):

```ts
// @route-class: operator-direct
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { OpportunityStageSchema, type PipelineBoardOpportunity } from "@switchboard/schemas";
import { listOpportunitiesForBoard } from "@switchboard/core/lifecycle";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrg, requireOrgForMutation } from "../decorators/require-org.js";
import { replyValidationError } from "../utils/validation-error.js";
import {
  TRANSITION_OPPORTUNITY_STAGE_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
} from "../bootstrap/operator-intents.js";

const StageTransitionRequestSchema = z.object({
  stage: OpportunityStageSchema,
});

export const dashboardOpportunitiesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.get("/api/dashboard/opportunities", { preHandler: requireOrg }, async (request, reply) => {
    if (!app.opportunityStore) {
      return reply.code(503).send({ error: "Opportunity store not available" });
    }
    return await listOpportunitiesForBoard(
      { orgId: request.orgId },
      { opportunityStore: app.opportunityStore },
    );
  });

  app.patch(
    "/api/dashboard/opportunities/:id/stage",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      if (!app.opportunityStore) {
        return reply.code(503).send({ error: "Opportunity store not available" });
      }
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available" });
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const parsed = StageTransitionRequestSchema.safeParse(request.body);
      if (!parsed.success) return replyValidationError(reply, parsed.error);

      const { id } = request.params as { id: string };

      const response = await app.platformIngress.submit({
        organizationId: request.orgId,
        actor: { id: request.actorId, type: "user" },
        intent: TRANSITION_OPPORTUNITY_STAGE_INTENT,
        parameters: { id, stage: parsed.data.stage },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }

      const { result } = response;
      if (result.outcome === "failed") {
        if (result.error?.code === OPERATOR_INTENT_ERROR_CODES.OPPORTUNITY_NOT_FOUND) {
          return reply.code(404).send({ error: OPERATOR_INTENT_ERROR_CODES.OPPORTUNITY_NOT_FOUND });
        }
        throw new Error(result.error?.message ?? "Operator mutation execution failed");
      }

      const opportunity = (result.outputs as { opportunity?: PipelineBoardOpportunity })
        .opportunity;
      if (!opportunity) {
        throw new Error("Operator mutation handler returned no opportunity output");
      }
      return { opportunity };
    },
  );
};
```

- [ ] **Step 4: Run the route tests to verify pass.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/routes/__tests__/dashboard-opportunities 2>&1 | tail -30`
Expected: PASS — all new + existing tests green.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/routes/dashboard-opportunities.ts apps/api/src/routes/__tests__/dashboard-opportunities-ingress.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): adopt Route Governance Contract v1 in dashboard-opportunities.ts

- @route-class: operator-direct header
- Decorators replace duplicated preHandler + requireOrganizationScope
- Idempotency-Key now mandatory via requireIdempotencyKey
- Validation envelope normalized via replyValidationError

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Refactor `lifecycle-disqualifications.ts` route + add tenant-reject regression test

**Files:**

- Modify: `apps/api/src/routes/lifecycle-disqualifications.ts`
- Modify: `apps/api/src/routes/__tests__/lifecycle-disqualifications-ingress.test.ts`

The disqualification handler already returns failed outcomes for `DISQUALIFICATION_NOT_FOUND` (verified during plan-writing) — no handler change needed. The route gets the decorator + mandatory-Idempotency-Key contract, and a new regression test pins the tenant-reject WorkTrace persistence.

- [ ] **Step 1: Write failing tests.**

Append to existing test file:

`buildTestServer({ disqualificationHook: { confirm, dismiss } })` registers the hook + the lifecycle-disqualifications routes (the harness gates registration on the hook being present). Use `app.lastIngressTrace` / `app.ingressTraceCount` for WorkTrace assertions (harness exposes them via `Object.defineProperty` getters at `test-server.ts:411-417`).

```ts
describe("POST /:threadId/confirm — Route Governance Contract v1 PR-1", () => {
  it("returns 400 missing_idempotency_key when header absent", async () => {
    const { app } = await buildTestServer({
      disqualificationHook: {
        confirm: async () => ({ result: "confirmed" as const }),
        dismiss: async () => ({ result: "dismissed" as const, restoredStatus: "qualified" }),
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/thread_x/confirm",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    await app.close();
  });

  it("persists WorkTrace with outcome=failed when hook reports not_found", async () => {
    const { app } = await buildTestServer({
      disqualificationHook: {
        confirm: async () => ({ result: "not_found" as const }),
        dismiss: async () => ({ result: "not_found" as const }),
      },
    });
    const prev = app.ingressTraceCount ?? 0;

    const res = await app.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/missing_thread/confirm",
      headers: { "Idempotency-Key": "key-nf-1" },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(app.ingressTraceCount).toBe(prev + 1);
    expect(app.lastIngressTrace?.outcome).toBe("failed");
    // Asserting on error.code requires the test-server harness type
    // augmentation extension (see Task 6 note); meanwhile assert on the
    // response body's `reason: "not_found"`.
    expect(res.json()).toMatchObject({ reason: "not_found" });
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify failure.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/routes/__tests__/lifecycle-disqualifications 2>&1 | tail -30`
Expected: FAIL on the missing-Idempotency-Key check; the WorkTrace assertion may pass already (handler is Cohort-A-conforming) but the test still needs the decorator wiring to run.

- [ ] **Step 3: Update the route file.**

**Apply a minimal diff to `apps/api/src/routes/lifecycle-disqualifications.ts`** following the Task 7 pattern. The pattern is identical to `dashboard-opportunities.ts`. Specifically:

1. Add `// @route-class: operator-direct` header.
2. Import `buildDevAuthFallback`, `requireOrg`, `requireOrgForMutation`, `requireIdempotencyKey`, `replyValidationError`.
3. Replace `app.addHook("preHandler", ...)` block with `app.addHook("preHandler", buildDevAuthFallback(app))`.
4. GET handler gets `preHandler: requireOrg`; replace `request.organizationIdFromAuth` + `if (!orgId)` with `request.orgId`.
5. Both POST handlers get `preHandler: requireOrgForMutation`; replace `request.organizationIdFromAuth` + `request.principalIdFromAuth ?? "system:unknown"` with `request.orgId` + `request.actorId`.
6. Both POST handlers replace `getIdempotencyKey` + conditional spread with `requireIdempotencyKey(request, reply)` + early-return.
7. Body validation stays as-is (the existing JSON schema validation is sufficient; if a Zod schema is added later, route it through `replyValidationError`).

The full code follows the pattern in Task 7 — copy that structure and substitute the disqualification-specific intent constants + outcome mapping.

- [ ] **Step 4: Run tests to verify pass.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/routes/__tests__/lifecycle-disqualifications 2>&1 | tail -30`
Expected: PASS — all new + existing tests green.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/routes/lifecycle-disqualifications.ts apps/api/src/routes/__tests__/lifecycle-disqualifications-ingress.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): adopt Route Governance Contract v1 in lifecycle-disqualifications.ts

- @route-class: operator-direct header
- Decorators replace duplicated preHandler + manual org/principal extraction
- Idempotency-Key now mandatory via requireIdempotencyKey
- Added tenant-reject WorkTrace regression test (Cohort A verification)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Refactor `admin-consent.ts` route

**Files:**

- Modify: `apps/api/src/routes/admin-consent.ts`
- Modify: `apps/api/src/routes/__tests__/admin-consent.test.ts` (or `admin-consent-ingress.test.ts`)

- [ ] **Step 1: Write failing tests.**

Append to existing admin-consent test file:

`buildTestServer({ consentService, consentReader })` registers the admin-consent routes (the harness gates on BOTH being present; if either is absent, the routes are not wired). Reuse the mock ConsentService + ContactConsentReader shapes already established in the existing admin-consent test file (look at the first `describe` block's setup helper).

```ts
describe("admin consent — Route Governance Contract v1 PR-1", () => {
  it.each([
    [
      "/api/admin/consent/grant",
      {
        contactId: "c1",
        jurisdiction: "sg",
        source: "operator_recorded",
        grantedAt: new Date().toISOString(),
      },
    ],
    [
      "/api/admin/consent/revoke",
      {
        contactId: "c1",
        source: "operator_recorded_revocation",
        revokedAt: new Date().toISOString(),
      },
    ],
    ["/api/admin/consent/clear", { contactId: "c1", notes: "test" }],
  ])("returns 400 missing_idempotency_key on %s when header absent", async (url, payload) => {
    // Reuse the mock service + reader builders already in this file's existing
    // tests — they live above this new describe block.
    const { app } = await buildTestServer({
      consentService: makeMockConsentService(),
      consentReader: makeMockConsentReader(),
    });
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    await app.close();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/routes/__tests__/admin-consent 2>&1 | tail -30`
Expected: FAIL on all 3 cases.

- [ ] **Step 3: Update `admin-consent.ts`.**

**Apply a minimal diff** following the Task 7/8 pattern. The current 3 POST handlers each have `getIdempotencyKey(req)` + conditional spread; replace with the mandatory `requireIdempotencyKey(req, reply)` + early-return. The GET handler stays as-is.

Add `// @route-class: operator-direct` header at the top of the file.

**Known classification compromise:** this file mixes one read-only GET (`/api/admin/consent/:contactId`) with three operator-direct POSTs. File-level `@route-class: operator-direct` classifies by the file's dominant semantics — the highest-risk handler determines the label. The alternative — per-route header comments above each handler — is not adopted in PR-1 to keep the parser simple, but is reserved for a future doctrine revision if mixed files become common. Document the compromise inline in the file as a one-line comment near the `@route-class` header:

```ts
// @route-class: operator-direct
// Note: this file mixes one read-only GET + 3 operator-direct POSTs. The
// class label reflects the dominant mutation semantics; the GET handler
// pre-dates the contract and is exempted by file-level classification.
```

- [ ] **Step 4: Run tests to verify pass.**

Run: `pnpm --filter @switchboard/api test -- --run apps/api/src/routes/__tests__/admin-consent 2>&1 | tail -30`
Expected: PASS — all new + existing tests green.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/routes/admin-consent.ts apps/api/src/routes/__tests__/admin-consent.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): adopt Route Governance Contract v1 in admin-consent.ts

- @route-class: operator-direct header
- Decorators replace duplicated preHandler
- Idempotency-Key now mandatory via requireIdempotencyKey on all 3 POSTs
- Validation envelope normalized via replyValidationError

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Verify direct-import decorator pattern is consistent

The pattern was committed in Task 0: decorators are imported per-route (`import { requireOrg, requireOrgForMutation } from "../decorators/require-org.js"`). No `app.decorate()` registration. No `FastifyInstance` augmentation for `app.requireOrg`. This task verifies the decision held across the route refactors.

- [ ] **Step 1: Verify zero `app.requireOrg` references exist.**

Run from repo root:

```bash
grep -rn 'app\.requireOrg\|app\["requireOrg\|app\.requireOrgForMutation\|app\["requireOrgForMutation' apps/api/src 2>&1 | grep -v __tests__ | head -10
```

Expected: zero matches. Any match indicates the route accidentally adopted the registered-decorator pattern instead of the committed direct-import pattern.

- [ ] **Step 2: If matches exist, fix by switching to direct import.**

For each match, replace `app.requireOrg` / `app.requireOrgForMutation` with the imported function reference. Re-run the grep until zero matches.

- [ ] **Step 3: Verify no `FastifyInstance.requireOrg` augmentation was added.**

Run: `grep -n 'requireOrg.*preHandlerAsyncHookHandler\|requireOrgForMutation.*preHandlerAsyncHookHandler' apps/api/src/app.ts apps/api/src/__tests__/test-server.ts 2>&1`
Expected: zero matches. The `FastifyRequest.orgId` / `actorId` augmentation from Task 4 IS expected; the `FastifyInstance.requireOrg` augmentation is NOT.

- [ ] **Step 4: Run full API test suite.**

Run: `pnpm --filter @switchboard/api test -- --run 2>&1 | tail -30`
Expected: PASS — no regressions.

No commit is required for this task (it's a verification-only step). If Step 2 produced fixes, commit them with a `fix(api):` prefix.

---

### Task 11: Audit dashboard consumers of the 403 auth envelope

The spec §6.3 + §14 mandate this audit because the auth-failure envelope changed from `{ error: "Forbidden: organization-scoped authentication is required", hint, statusCode: 403 }` to `{ error: "forbidden", reason: "no_org_binding", statusCode: 403 }`. Clients reading the English message string break; clients reading `statusCode` or HTTP status work as before.

- [ ] **Step 1: Grep for consumers of the old envelope.**

Run from the repo root:

```bash
grep -rIn 'Forbidden: organization-scoped\|Forbidden: organization mismatch\|Forbidden: authenticated request has no organization binding' \
  apps/dashboard apps/chat apps/api \
  --include='*.ts' --include='*.tsx' 2>&1 | grep -v __tests__
```

Expected: 0-3 hits. Each hit is either:

- A test asserting on the English string (update to assert on `error: "forbidden"` + `reason`).
- A dashboard error-handling branch that surfaces the English message in a toast/notification (update to surface a translated message based on `reason`).
- An API call wrapper that parses the string for redirect logic (update to switch on `reason`).

- [ ] **Step 2: For each hit, apply the minimal fix.**

For test files: update the assertion. Example:

```ts
// Before:
expect(res.json().error).toBe("Forbidden: organization-scoped authentication is required");
// After:
expect(res.json()).toMatchObject({ error: "forbidden", reason: "no_org_binding" });
```

For dashboard UI: replace the string check with the `reason` discriminator. Example:

```ts
// Before:
if (err.message?.includes("organization-scoped")) showLoginPrompt();
// After:
if (err.body?.reason === "no_org_binding") showLoginPrompt();
```

- [ ] **Step 3: Re-run the grep to confirm no remaining English-string consumers.**

Run the same grep from Step 1.
Expected: 0 hits.

- [ ] **Step 4: Run the affected test suites.**

Run: `pnpm --filter @switchboard/api test -- --run && pnpm --filter @switchboard/dashboard test -- --run 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Commit (if any consumers were touched).**

```bash
git add <changed files>
git commit -m "$(cat <<'EOF'
chore: migrate consumers from old 403 message-string to typed reason

Route Governance Contract v1 §4.5 normalized the 403 auth envelope from
{ error: "Forbidden: ...", hint, statusCode } to { error: "forbidden",
reason, statusCode }. This commit updates all consumers that parsed the
English string to switch on the typed reason discriminator instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no consumers existed, log that the grep returned zero results and skip the commit.

---

### Task 12: Create `route-class-validator.ts` — per-class matrix rules

**Files:**

- Create: `.agent/tools/route-class-validator.ts`
- Create: `.agent/tools/__tests__/route-class-validator.test.ts`

- [ ] **Step 1: Write failing tests.**

Create `.agent/tools/__tests__/route-class-validator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { parseRouteClass, validateRouteClass } from "../route-class-validator.js";

function makeSource(content: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("test.ts", content);
}

describe("parseRouteClass", () => {
  it("extracts class from header comment", () => {
    const sf = makeSource(`// @route-class: operator-direct\nexport const x = 1;`);
    expect(parseRouteClass(sf)).toBe("operator-direct");
  });

  it("returns null when no header present", () => {
    const sf = makeSource(`export const x = 1;`);
    expect(parseRouteClass(sf)).toBeNull();
  });

  it("handles class labels with hyphens", () => {
    const sf = makeSource(`// @route-class: ingress-receiver\nexport const x = 1;`);
    expect(parseRouteClass(sf)).toBe("ingress-receiver");
  });

  it("returns null for unknown class labels", () => {
    const sf = makeSource(`// @route-class: not-a-real-class\nexport const x = 1;`);
    expect(parseRouteClass(sf)).toBeNull();
  });
});

describe("validateRouteClass — operator-direct", () => {
  it("returns no warnings when route uses requireIdempotencyKey + requireOrgForMutation correctly", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/x", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const key = requireIdempotencyKey(req, reply);
        });
      };
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });

  it("warns when operator-direct route does not import requireIdempotencyKey", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/x", { preHandler: requireOrgForMutation }, async () => {});
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/requireIdempotencyKey/);
  });

  it("warns when operator-direct route does not import requireOrgForMutation", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      export const r = async (app) => {
        app.post("/x", async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(/requireOrgForMutation/);
  });

  it("warns when requireIdempotencyKey is imported but never called", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/x", { preHandler: requireOrgForMutation }, async () => {});
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(
      /imports requireIdempotencyKey but never calls/,
    );
  });

  it("warns when requireOrgForMutation is imported but not registered as preHandler", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/x", async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(
      /imports requireOrgForMutation but does not register/,
    );
  });

  it("warns when there are more mutating handlers than requireIdempotencyKey calls", () => {
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.post("/a", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
        // Second mutating handler — does NOT call requireIdempotencyKey.
        app.patch("/b", { preHandler: requireOrgForMutation }, async () => {});
      };
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings.map((w) => w.message).join("\n")).toMatch(
      /registers 2 mutating handler\(s\) but only calls requireIdempotencyKey 1 time/,
    );
  });

  it("does NOT warn for GET handlers in operator-direct file (admin-consent mixed-class compromise)", () => {
    // Mirrors the post-Task-9 shape of admin-consent.ts: 3 POSTs + 1 GET in
    // the same file, classified as operator-direct by dominant semantics.
    // GETs do not need requireIdempotencyKey.
    const sf = makeSource(`
      // @route-class: operator-direct
      import { requireIdempotencyKey } from "../utils/idempotency-key.js";
      import { requireOrg, requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async (app) => {
        app.get("/x/:id", { preHandler: requireOrg }, async () => {});
        app.post("/x/grant", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
        app.post("/x/revoke", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
        app.post("/x/clear", { preHandler: requireOrgForMutation }, async (req, reply) => {
          const k = requireIdempotencyKey(req, reply);
        });
      };
    `);
    // 3 mutating routes + 3 calls = balanced. GET is ignored.
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });
});

describe("validateRouteClass — read-only", () => {
  it("returns no warnings when read-only route imports requireOrg", () => {
    const sf = makeSource(`
      // @route-class: read-only
      import { requireOrg } from "../decorators/require-org.js";
      export const r = async () => {};
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });

  it("warns when read-only route imports requireOrgForMutation (write-side guard on read route)", () => {
    const sf = makeSource(`
      // @route-class: read-only
      import { requireOrgForMutation } from "../decorators/require-org.js";
      export const r = async () => {};
    `);
    const warnings = validateRouteClass(sf, "test.ts");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/requireOrgForMutation/);
  });
});

describe("validateRouteClass — control-plane / lifecycle / ingress-receiver", () => {
  it("returns no warnings for control-plane (relaxed in PR-1)", () => {
    const sf = makeSource(`
      // @route-class: control-plane
      export const r = async () => {};
    `);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });
  // lifecycle + ingress-receiver intentionally not validated in PR-1; full matrix lands in PR-4.
});

describe("validateRouteClass — no header", () => {
  it("returns no warnings when no header present (PR-4 backfills; PR-1 is touched-only)", () => {
    const sf = makeSource(`export const r = async () => {};`);
    expect(validateRouteClass(sf, "test.ts")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `cd .agent/tools && pnpm exec vitest run __tests__/route-class-validator.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator.**

Create `.agent/tools/route-class-validator.ts`:

```ts
import type { SourceFile } from "ts-morph";

export type RouteClass =
  | "operator-direct"
  | "lifecycle"
  | "control-plane"
  | "ingress-receiver"
  | "read-only";

const KNOWN_CLASSES: ReadonlySet<RouteClass> = new Set([
  "operator-direct",
  "lifecycle",
  "control-plane",
  "ingress-receiver",
  "read-only",
]);

export interface ValidatorWarning {
  path: string;
  message: string;
}

/**
 * Parse the `// @route-class: <name>` header comment from a source file.
 * Returns null when the header is absent or names an unknown class.
 */
export function parseRouteClass(sf: SourceFile): RouteClass | null {
  // Find the first matching line in the leading comment block.
  const text = sf.getFullText();
  // Match anywhere in the file's leading comments (within the first 2KB so we
  // don't scan whole files unnecessarily).
  const head = text.slice(0, 2048);
  const match = /\/\/\s*@route-class:\s*([a-z-]+)/.exec(head);
  if (!match) return null;
  const label = match[1] as RouteClass;
  return KNOWN_CLASSES.has(label) ? label : null;
}

/**
 * Per-class matrix validator for Route Governance Contract v1 PR-1.
 *
 * Returns warnings (not errors) for non-conformant cells. CI prints these as
 * advisory output via `--mode=warn-touched`. PR-4 flips to errors after the
 * full route-class backfill is in place.
 *
 * PR-1 scope: only validates operator-direct and read-only routes; other
 * classes are relaxed until PR-4.
 *
 * **Validation strategy — three-stage AST checks, not just imports.**
 *
 * For each rule (e.g., "operator-direct must use requireIdempotencyKey"):
 *
 * 1. *Import check* — is the helper imported? If not, warn "should import."
 *    Without an import, no later check fires (you can't call what you don't
 *    have). The import-presence warning is the entry point.
 * 2. *Usage check* — is the helper actually called/referenced in the file?
 *    Catches the "imports but forgets" failure mode. Uses
 *    `getDescendantsOfKind(SyntaxKind.CallExpression)` + identifier scans, not
 *    just import declarations.
 * 3. *Cardinality check* — for `requireIdempotencyKey`, does the call count
 *    match the number of mutating-verb route registrations (POST/PATCH/PUT/
 *    DELETE)? Catches the "imports + uses on handler A but forgets on handler
 *    B" failure mode. GET handlers are NOT counted — read-only handlers in
 *    operator-direct files (e.g., the mixed admin-consent.ts GET) are exempt.
 *
 * Each stage produces at most one warning per rule. The validator returns the
 * union of stage warnings; routes can have multiple warnings if multiple
 * rules fail.
 */
export function validateRouteClass(sf: SourceFile, repoPath: string): ValidatorWarning[] {
  const cls = parseRouteClass(sf);
  if (cls === null) return []; // no header → no validation in PR-1 (warning-mode-on-touched only)

  const warnings: ValidatorWarning[] = [];
  const imports = sf.getImportDeclarations().map((d) => d.getModuleSpecifierValue());

  const importsNamed = (name: string) =>
    sf.getImportDeclarations().some((d) => d.getNamedImports().some((n) => n.getName() === name));

  // Count CallExpression nodes whose callee identifier matches `name`.
  // ts-morph: SyntaxKind.CallExpression → getExpression() → text comparison.
  // This catches both `requireIdempotencyKey(...)` and `foo.requireIdempotencyKey(...)`;
  // the latter is unlikely in route files but doesn't produce a false warning.
  const callsNamed = (name: string): number => {
    let count = 0;
    sf.forEachDescendant((node) => {
      if (node.getKindName() === "CallExpression") {
        const expr = (
          node as { getExpression?: () => { getText: () => string } }
        ).getExpression?.();
        if (expr && expr.getText().endsWith(name)) count += 1;
      }
    });
    return count;
  };

  // Reference identifier `name` anywhere in the file (e.g., as a preHandler
  // value). Used to verify decorator references, not just imports.
  const referencesName = (name: string): boolean => {
    let found = false;
    sf.forEachDescendant((node) => {
      if (found) return;
      if (node.getKindName() === "Identifier" && node.getText() === name) found = true;
    });
    return found;
  };

  // Count mutating HTTP verb registrations: app.post(...) / app.patch(...) /
  // app.delete(...) / app.put(...).
  const countMutatingRoutes = (): number => {
    let count = 0;
    sf.forEachDescendant((node) => {
      if (node.getKindName() !== "CallExpression") return;
      const expr = (node as { getExpression: () => { getText: () => string } }).getExpression();
      const text = expr.getText();
      if (/\.(post|patch|delete|put)$/.test(text)) count += 1;
    });
    return count;
  };

  if (cls === "operator-direct") {
    if (!importsNamed("requireIdempotencyKey")) {
      warnings.push({
        path: repoPath,
        message:
          "operator-direct route should import requireIdempotencyKey (spec §7.1: Idempotency-Key is mandatory)",
      });
    } else if (callsNamed("requireIdempotencyKey") === 0) {
      // Imported but never called — strong signal of unfinished migration.
      warnings.push({
        path: repoPath,
        message:
          "operator-direct route imports requireIdempotencyKey but never calls it (spec §7.1)",
      });
    } else if (countMutatingRoutes() > callsNamed("requireIdempotencyKey")) {
      // Calls < mutating routes: some handler likely forgets the mandate.
      warnings.push({
        path: repoPath,
        message: `operator-direct route registers ${countMutatingRoutes()} mutating handler(s) but only calls requireIdempotencyKey ${callsNamed("requireIdempotencyKey")} time(s) (spec §7.1: each mutating handler must call it)`,
      });
    }

    if (!importsNamed("requireOrgForMutation")) {
      warnings.push({
        path: repoPath,
        message: "operator-direct route should import requireOrgForMutation (spec §6 + §3 matrix)",
      });
    } else if (!referencesName("requireOrgForMutation")) {
      // Imported but only the import-decl references it — no preHandler usage.
      // (The import declaration itself produces an identifier reference; require
      // at least one additional reference elsewhere in the file.)
      const identifierCount = (() => {
        let c = 0;
        sf.forEachDescendant((node) => {
          if (node.getKindName() === "Identifier" && node.getText() === "requireOrgForMutation")
            c += 1;
        });
        return c;
      })();
      if (identifierCount < 2) {
        warnings.push({
          path: repoPath,
          message:
            "operator-direct route imports requireOrgForMutation but does not register it as a preHandler (spec §6)",
        });
      }
    }
  }

  if (cls === "read-only") {
    if (importsNamed("requireOrgForMutation")) {
      warnings.push({
        path: repoPath,
        message:
          "read-only route should not use requireOrgForMutation (use requireOrg for read-side; spec §3 matrix)",
      });
    }
  }

  // lifecycle / control-plane / ingress-receiver: relaxed in PR-1.
  return warnings;
}
```

- [ ] **Step 4: Run tests to verify pass.**

Run: `cd .agent/tools && pnpm exec vitest run __tests__/route-class-validator.test.ts 2>&1 | tail -20`
Expected: PASS — all 11 cases green.

- [ ] **Step 5: Commit.**

```bash
git add .agent/tools/route-class-validator.ts .agent/tools/__tests__/route-class-validator.test.ts
git commit -m "$(cat <<'EOF'
feat(agent-tools): add route-class header parser + per-class validator

PR-1 scope: validates operator-direct + read-only routes. lifecycle /
control-plane / ingress-receiver relaxed until PR-4 full backfill.
Routes without a header skip validation (PR-1 is warning-mode-on-touched-
only).

Route Governance Contract v1 §3 matrix + §12 migration strategy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Extend `check-routes.ts` with `--mode=warn-touched` flag

**Files:**

- Modify: `.agent/tools/check-routes.ts`
- Modify or create: `.agent/tools/__tests__/check-routes-warn-mode.test.ts`

- [ ] **Step 1: Write failing test for warn-touched mode.**

Create `.agent/tools/__tests__/check-routes-warn-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runRouteClassAdvisory } from "../check-routes.js";

describe("runRouteClassAdvisory (warn-touched mode)", () => {
  it("returns warnings for touched routes only", async () => {
    // Stub `git diff` via the touchedFiles option.
    const result = await runRouteClassAdvisory({
      touchedFiles: ["apps/api/src/routes/recommendations.ts"],
      repoRoot: process.cwd(),
    });
    expect(result.exitCode).toBe(0); // warnings, not errors
    // result.warnings shape: Array<{ path, message }>
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("returns no warnings when no routes are touched", async () => {
    const result = await runRouteClassAdvisory({
      touchedFiles: [],
      repoRoot: process.cwd(),
    });
    expect(result.warnings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("ignores touched files that aren't routes", async () => {
    const result = await runRouteClassAdvisory({
      touchedFiles: ["package.json", "apps/api/src/utils/foo.ts"],
      repoRoot: process.cwd(),
    });
    expect(result.warnings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `cd .agent/tools && pnpm exec vitest run __tests__/check-routes-warn-mode.test.ts 2>&1 | tail -10`
Expected: FAIL — `runRouteClassAdvisory` not exported.

- [ ] **Step 3: Add `runRouteClassAdvisory` to `check-routes.ts`.**

Append to `.agent/tools/check-routes.ts`:

```ts
import { validateRouteClass, type ValidatorWarning } from "./route-class-validator.js";
import { execSync } from "child_process";

export interface AdvisoryOptions {
  /** If omitted, detects via `git diff --name-only origin/main HEAD`. */
  touchedFiles?: string[];
  repoRoot: string;
}

export interface AdvisoryResult {
  warnings: ValidatorWarning[];
  exitCode: 0; // always 0 — advisory mode never blocks CI
}

const ROUTE_GLOBS = [
  /^apps\/api\/src\/routes\//,
  /^apps\/chat\/src\/routes\//,
  /^apps\/dashboard\/src\/app\/api\//,
];

export async function runRouteClassAdvisory(opts: AdvisoryOptions): Promise<AdvisoryResult> {
  const touched = opts.touchedFiles ?? detectTouchedFiles();
  const routeFiles = touched.filter((f) => ROUTE_GLOBS.some((rx) => rx.test(f)));

  if (routeFiles.length === 0) {
    return { warnings: [], exitCode: 0 };
  }

  const project = new Project({ useInMemoryFileSystem: false });
  const warnings: ValidatorWarning[] = [];
  for (const repoPath of routeFiles) {
    const abs = join(opts.repoRoot, repoPath);
    try {
      const sf = project.addSourceFileAtPath(abs);
      warnings.push(...validateRouteClass(sf, repoPath));
    } catch {
      // File missing or unreadable — skip.
    }
  }

  return { warnings, exitCode: 0 };
}

function detectTouchedFiles(): string[] {
  try {
    const out = execSync("git diff --name-only origin/main...HEAD", { encoding: "utf8" });
    return out.split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}
```

Then extend the CLI block at the bottom of `check-routes.ts`:

```ts
if (isMain) {
  // ... existing CLI block ...

  // New: --mode=warn-touched flag
  const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1];
  if (mode === "warn-touched") {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "..", "..");
    const advisory = await runRouteClassAdvisory({ repoRoot });
    for (const w of advisory.warnings) {
      console.warn(`::warning file=${w.path}::${w.message}`);
    }
    if (advisory.warnings.length > 0) {
      console.warn(`\n${advisory.warnings.length} route-class advisory warning(s).`);
    }
    process.exit(advisory.exitCode);
  }

  // ... existing legacy CLI behavior continues ...
}
```

The `::warning file=...::` syntax is GitHub Actions' workflow command format for surfacing warnings as PR annotations.

- [ ] **Step 4: Run tests to verify pass.**

Run: `cd .agent/tools && pnpm exec vitest run __tests__/check-routes-warn-mode.test.ts 2>&1 | tail -10`
Expected: PASS — all 3 cases green.

- [ ] **Step 5: Manual smoke test.**

Run from repo root: `bash .agent/tools/check-routes --mode=warn-touched 2>&1 | head -20`
Expected: zero or a small number of warnings (depending on what's been touched since `origin/main`). Exit code 0.

- [ ] **Step 6: Commit.**

```bash
git add .agent/tools/check-routes.ts .agent/tools/__tests__/check-routes-warn-mode.test.ts
git commit -m "$(cat <<'EOF'
feat(agent-tools): add check-routes --mode=warn-touched advisory

Detects touched route files via git diff origin/main...HEAD, runs the
per-class matrix validator from route-class-validator, prints warnings
as GitHub Actions annotations. Always exits 0 (advisory only).

Route Governance Contract v1 §12 — PR-1 ships the checker in warning
mode so the doctrine enforces from day one without blocking unrelated
work. PR-4 flips to errors after full route-class backfill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Wire advisory into CI

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a step to the `architecture` job.**

In `.github/workflows/ci.yml`, find the `architecture:` job (around line 268). After the existing "Dependency boundary validation" step (~line 302), add:

```yaml
- name: Route class advisory (Route Governance Contract v1)
  run: bash .agent/tools/check-routes --mode=warn-touched
  continue-on-error: true
```

- [ ] **Step 2: Confirm YAML is valid.**

Run: `python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/ci.yml"))' 2>&1`
Expected: no output (silent success).

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: add route-class advisory step to architecture job

Runs check-routes --mode=warn-touched on every PR. Advisory only
(continue-on-error: true); does not block merges in PR-1. PR-4 flips
to a blocking step after the full route-class backfill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Final integration pass

- [ ] **Step 1: Run full API test suite.**

Run: `pnpm --filter @switchboard/api test -- --run 2>&1 | tail -20`
Expected: PASS — all green.

- [ ] **Step 2: Run typecheck across workspace.**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: PASS. If failures reference missing exports from `@switchboard/schemas` / `@switchboard/db` / `@switchboard/core`, run `pnpm reset` first per CLAUDE.md and retry.

- [ ] **Step 3: Run formatter check.**

Run: `pnpm format:check 2>&1 | tail -10`
Expected: PASS. If failures, run `pnpm format:write` and re-commit the diff.

- [ ] **Step 4: Run dashboard production build (CI does this; reproduces it locally per `feedback_dashboard_build_not_in_ci`).**

Run: `pnpm --filter @switchboard/dashboard build 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Run the route-class advisory locally against the PR.**

Run: `bash .agent/tools/check-routes --mode=warn-touched 2>&1`
Expected: zero warnings on the 4 routes touched in PR-1 (they all have `@route-class: operator-direct` header + import the required helpers).

- [ ] **Step 6: Manual verification of the 4 routes via test harness.**

Run: `pnpm --filter @switchboard/api test -- --run '__tests__/dashboard-opportunities|recommendations|lifecycle-disqualifications|admin-consent' 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 7: Hard PR checklist gate — zero advisory warnings on touched routes.**

This is a **hard human review gate**, not just CI advisory. Even though CI's `check-routes --mode=warn-touched` is `continue-on-error: true`, the four routes touched in PR-1 are expected to produce zero warnings. Any warning indicates a contract violation that should be fixed before merge.

Run: `bash .agent/tools/check-routes --mode=warn-touched 2>&1`
Expected: zero warnings for `apps/api/src/routes/dashboard-opportunities.ts`, `recommendations.ts`, `lifecycle-disqualifications.ts`, `admin-consent.ts`. Any warning blocks the merge until resolved.

Document the result in the PR description: "✅ check-routes --mode=warn-touched produced zero warnings for the four migrated routes."

- [ ] **Step 8: Final review of git log.**

Run: `git log --oneline origin/main..HEAD 2>&1`
Expected: ~15 focused commits (Preflight Task 0 may add one), each scoped to one task. If any commits are mixed (e.g., decorator change + test change crossed into a route refactor), split via `git rebase -i` BEFORE pushing.

- [ ] **Step 9: Push and open PR.**

Branch name: `audit-phase3a-impl-pr1` (or however the worktree was named).

```bash
git push -u origin <branch>
gh pr create --title "feat(audit): Route Governance Contract v1 — Impl PR-1 (operator-direct cohort + checker warning mode)" --body "$(cat <<'EOF'
## Summary

Phase 3A impl PR-1 per `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` §12. Implements the operator-direct route class contract across the 4 ingress-migrated routes, migrates Cohort B (recommendations) to Cohort A WorkTrace semantics, and ships the `check-routes` per-class validator in warning-mode-on-touched-routes-only.

## Closes

- Cat 3.2 (Idempotency-Key gap) — mandatory on operator-direct.
- Cat 3.3 (Error response shape) — normalized §4 envelope.
- Cat 3.7 (Validation error structure) — `replyValidationError`.
- Cat 3.8 (Optional audit on conversations.ts) — partial; covered for operator-direct class.
- Cat 1.5 (auth-cast removal) — decorators replace `(req as any).principalIdFromAuth`.
- Cat 3.1 (audit-trail gap) — partial; tenant-reject path on recommendations.ts now persists WorkTrace.

## Architectural notes

- Decorators are imported per-route (not registered via `app.decorate`) — see Task 10 for the verification step + fallback if the registered pattern is preferred.
- Cohort C (lifecycle-disqualifications) handler was already Cohort-A-conforming at planning time; PR-1 adds a regression test pinning the contract.
- check-routes advisory always exits 0 (`continue-on-error: true` in CI). PR-4 will flip to blocking after full route-class backfill.

## Test plan

- [ ] **Preflight Task 0** completed: decorator pattern committed (direct imports, no `app.decorate`); dashboard Idempotency-Key audit done; any client-side fixes shipped IN THIS PR.
- [ ] CI green (typecheck + lint + tests + dashboard build + architecture job).
- [ ] Manual smoke test of all 4 routes via `pnpm --filter @switchboard/api test`.
- [ ] **Hard gate:** `bash .agent/tools/check-routes --mode=warn-touched` returns **zero warnings** for `apps/api/src/routes/dashboard-opportunities.ts`, `recommendations.ts`, `lifecycle-disqualifications.ts`, `admin-consent.ts`. Any warning blocks the merge.
- [ ] Cohort B → A regression: `expect(applyAct).not.toHaveBeenCalled()` for recommendation tenant-reject case (Task 5).
- [ ] No `app.requireOrg` / `app.requireOrgForMutation` references in `apps/api/src` (Task 10 verification).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

This plan implements PR-1 scope from spec §12 in full. Spec coverage:

| Spec section                                            | Task                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| §4.3 validation envelope                                | Task 2 (`replyValidationError`) + Tasks 6-9 (route refactors)           |
| §4.5 auth-failure envelope                              | Task 4 (decorator emits it) + Task 11 (consumer audit)                  |
| §5.1 Cohort B → A                                       | Task 5 (handler, with `applyAct` not-called hardening) + Task 6 (route) |
| §6.1-§6.3 typed decorators                              | Tasks 3 (factory) + 4 (decorators) + 10 (pattern verification)          |
| §7.1 mandatory Idempotency-Key                          | Task 1 + Tasks 6-9 + Task 0 client compat preflight                     |
| §11 crosswalk (PR-1 column)                             | Tasks 0, 1, 2, 5, 6, 7, 8, 9 collectively                               |
| §12 PR-1 scope                                          | All tasks                                                               |
| §12 PR-1 check-routes warning mode                      | Tasks 12 (AST-usage validator) + 13 + 14                                |
| §14 risk: clients reading auth message string           | Task 11                                                                 |
| §14 risk: dashboard clients not sending Idempotency-Key | **Task 0** (hard preflight blocker, not deferred)                       |

No `TBD` / `TODO` / "fill in" sections. Most code blocks are runnable as-is; a few rely on inspect-current-code substitutions that the executing agent fills in from local state. Those are intentional — the alternative would freeze line numbers and seed fixtures that drift between plan-writing and execution.

**Known judgment-required substitutions** (catalog so the executing agent knows where to look up rather than copy-paste):

| Location                                                                                     | Substitution                                                                                                                           | How to resolve                                                                                                                           |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Task 7 happy-path test (`opp_seeded_above`)                                                  | Replace with the actual opportunity ID from whichever seed helper the existing `dashboard-opportunities-ingress.test.ts` already uses. | Open the existing test file; reuse its seed pattern (e.g., `seedOpportunity(app)` or `app.opportunityStore!.create({...})`).             |
| Task 9 admin-consent `makeMockConsentService()` / `makeMockConsentReader()`                  | Replace with the mock builders already present in the file's first describe block.                                                     | Locate the helpers above the new describe; if absent, write minimal mocks matching `ConsentService` / `ContactConsentReader` signatures. |
| Task 6 step 6 / Task 11 step 5 `<touched dashboard client files>`                            | Replace with the file paths produced by Task 11 step 2's grep.                                                                         | The Task 11 grep produces the list directly.                                                                                             |
| Task 0 step 6 `<file paths from Task 0 step 2 results>`                                      | Same as above.                                                                                                                         | Grep output.                                                                                                                             |
| Task 8 step 3 "specific delta list" referencing `dashboard-opportunities.ts` Task 7 template | The 7-item delta list at Task 7 step 4 is the source.                                                                                  | Cross-reference Task 7's code block.                                                                                                     |

Type consistency: `requireOrg` / `requireOrgForMutation` are referenced consistently across Tasks 3, 4, 6, 7, 8, 9, 12. `requireIdempotencyKey` consistent across Tasks 1, 6, 7, 8, 9, 12. `replyValidationError` consistent across Tasks 2, 6, 7. `buildDevAuthFallback` (factory pattern) consistent across Tasks 3, 6, 7, 8, 9 — no occurrences of the older free-function `devAuthFallback` form (which relied on Fastify `this`-binding) remain.

### Architectural decisions committed at the plan level

1. **Decorators are direct imports, NOT registered via `app.decorate`.** Task 0 commits this; Task 10 verifies it post-implementation; the file structure section reflects it. Any deviation by the implementing agent is a contract violation flagged by Task 10's grep.
2. **`buildDevAuthFallback(app)` factory pattern over free-function with `this`-binding.** Avoids Fastify plugin-scope binding fragility. Task 3 specifies the factory + an integration test through a real plugin (not just a bare `/probe`).
3. **`check-routes` validator does AST usage checks, not just import checks** (per Task 12 implementation). Catches the "imports but never calls" failure mode that import-only validation would miss.
4. **Hard human review gate: zero advisory warnings on the four touched routes.** Even though CI is `continue-on-error: true`, the four migrated routes are expected to produce zero warnings. Any warning blocks merge.
5. **`admin-consent.ts` mixed GET + 3 POSTs are file-classified as `operator-direct`** (Task 9 step 3 note). Documented as a temporary compromise; per-route header comments are reserved for future doctrine revision if mixed files become common.

### Scope decision: single PR vs split into PR-1A + PR-1B

The plan keeps PR-1 as a single PR (runtime contract + governance checker together). If the PR grows too large during review (>50 files touched, or >20 commits), split at this seam:

- **PR-1A:** Tasks 0-11 (helpers + decorators + 4 routes + Cohort B → A + dashboard audit). Runtime contract.
- **PR-1B:** Tasks 12-14 (validator + check-routes mode + CI advisory). Governance checker.

The split would let PR-1A merge first while PR-1B is in review. The cost: touched routes in PR-1A wouldn't get the warning-mode checker until PR-1B lands. Acceptable given the routes themselves are correct by construction (test coverage in PR-1A asserts the contract).

If PR-1 stays unified, enforce focused commits — the final integration step expects ~15 commits, each scoped to one task.
