# Meta Page-id Setter (PR C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an operator control-plane setter that writes `credentials.pageId` onto an org's meta-ads `Connection`, flipping the `creative.job.publish` precondition gate from `META_PAGE_NOT_CONFIGURED` to resolvable.

**Architecture:** A dedicated org-scoped read-modify-write store method (`mergeCredentialsById`) merges the page id into the encrypted credentials blob (decrypting only after org + service are confirmed); a new `control-plane` route `PUT /api/connections/:id/meta-page-id` validates and delegates to it; the dashboard plumbing (api-client method → Next proxy → react-query hook → a small `SetMetaPageIdDialog` on the meta-ads connection card) lets an operator set it. No schema/migration (the `credentials` column exists). Spec: `docs/superpowers/specs/2026-06-03-mira-meta-page-id-setter-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Prisma (`Connection` model), AES-256-GCM credential crypto (`@switchboard/db`), Fastify (apps/api), Next 14 + react-query + Zod (apps/dashboard), vitest (`vitest run`).

**Conventions:** no `any`; no `console.log`; prettier (semi, double quotes, 2-space, trailing commas, 100 width); co-located `*.test.ts`; Conventional Commits (lowercase subject first word); files < 600 lines. Run from the worktree root `/Users/jasonli/switchboard/.claude/worktrees/meta-page-id-setter`.

---

## Task 1: DB store — `mergeCredentialsById` (org-scoped credential merge)

**Files:**
- Modify: `packages/db/src/storage/prisma-connection-store.ts` (add method to `PrismaConnectionStore`)
- Test: `packages/db/src/storage/__tests__/prisma-connection-store.test.ts` (existing; crypto is mocked as `encrypt = JSON.stringify` / `decrypt = JSON.parse`)

- [ ] **Step 1: Add the import of the mocked crypto fns to the test file (to spy on `decryptCredentials`)**

At the top of `prisma-connection-store.test.ts`, after the `vi.mock(...)` block (line 8), add an import so tests can assert call counts:

```ts
import { decryptCredentials } from "../../crypto/credentials.js";
```

- [ ] **Step 2: Write the failing tests** (append this `describe` block before the final closing `});` of the top-level `describe`)

```ts
  describe("mergeCredentialsById", () => {
    it("merges the patch into existing credentials, preserving other keys", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        id: "conn_1",
        serviceId: "meta-ads",
        credentials: JSON.stringify({ accessToken: "tok", accountId: "act_1" }),
      });
      prisma.connection.updateMany.mockResolvedValue({ count: 1 });

      const result = await store.mergeCredentialsById("conn_1", "org_1", "meta-ads", {
        pageId: "123456789012345",
      });

      expect(result).toBe("updated");
      // org-scoped on both legs
      expect(prisma.connection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "conn_1", organizationId: "org_1" } }),
      );
      const updateArgs = prisma.connection.updateMany.mock.calls[0]![0];
      expect(updateArgs.where).toEqual({ id: "conn_1", organizationId: "org_1" });
      // the merged blob keeps accessToken/accountId and adds pageId (crypto mock round-trips via JSON)
      expect(JSON.parse(updateArgs.data.credentials)).toEqual({
        accessToken: "tok",
        accountId: "act_1",
        pageId: "123456789012345",
      });
    });

    it("returns not_found when no row matches the org (cross-org)", async () => {
      prisma.connection.findFirst.mockResolvedValue(null);

      const result = await store.mergeCredentialsById("conn_1", "org_other", "meta-ads", {
        pageId: "123456789012345",
      });

      expect(result).toBe("not_found");
      expect(prisma.connection.updateMany).not.toHaveBeenCalled();
    });

    it("returns wrong_service without decrypting when serviceId mismatches", async () => {
      vi.mocked(decryptCredentials).mockClear();
      prisma.connection.findFirst.mockResolvedValue({
        id: "conn_1",
        serviceId: "stripe",
        credentials: JSON.stringify({ secretKey: "sk_1" }),
      });

      const result = await store.mergeCredentialsById("conn_1", "org_1", "meta-ads", {
        pageId: "123456789012345",
      });

      expect(result).toBe("wrong_service");
      expect(decryptCredentials).not.toHaveBeenCalled();
      expect(prisma.connection.updateMany).not.toHaveBeenCalled();
    });

    it("returns not_found when the row is deleted between read and write", async () => {
      prisma.connection.findFirst.mockResolvedValue({
        id: "conn_1",
        serviceId: "meta-ads",
        credentials: JSON.stringify({ accessToken: "tok" }),
      });
      prisma.connection.updateMany.mockResolvedValue({ count: 0 });

      const result = await store.mergeCredentialsById("conn_1", "org_1", "meta-ads", {
        pageId: "123456789012345",
      });

      expect(result).toBe("not_found");
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/db test -- prisma-connection-store`
Expected: FAIL — `store.mergeCredentialsById is not a function`.

- [ ] **Step 4: Implement the method** (in `prisma-connection-store.ts`, add inside the `PrismaConnectionStore` class, after `delete(...)` ends at line 117, before the closing `}` of the class)

```ts
  /**
   * Org-scoped read-modify-write of the encrypted credentials blob. Merges `patch`
   * into the existing credentials (preserving other keys) and re-encrypts. Decrypts
   * only after confirming the row is the caller's org AND the expected service, so a
   * cross-org / wrong-service request never touches secret material. Returns:
   *  - "updated"       merged and written
   *  - "not_found"     no row for (id, organizationId), or deleted before the write
   *  - "wrong_service" the row exists but is a different serviceId
   */
  async mergeCredentialsById(
    id: string,
    organizationId: string | null,
    expectedServiceId: string,
    patch: Record<string, unknown>,
  ): Promise<"updated" | "not_found" | "wrong_service"> {
    const row = await this.prisma.connection.findFirst({
      where: { id, organizationId },
      select: { id: true, serviceId: true, credentials: true },
    });
    if (!row) return "not_found";
    if (row.serviceId !== expectedServiceId) return "wrong_service";

    const current =
      typeof row.credentials === "string"
        ? decryptCredentials(row.credentials)
        : (row.credentials as Record<string, unknown>);

    const result = await this.prisma.connection.updateMany({
      where: { id: row.id, organizationId },
      data: { credentials: encryptCredentials({ ...current, ...patch }) },
    });
    if (result.count === 0) return "not_found";
    return "updated";
  }
```

(`encryptCredentials` / `decryptCredentials` are already imported at the top of the file — line 2.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/db test -- prisma-connection-store`
Expected: PASS (all existing + the 4 new tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/storage/prisma-connection-store.ts packages/db/src/storage/__tests__/prisma-connection-store.test.ts
git commit -m "feat(db): mergeCredentialsById for org-scoped credential merge"
```

---

## Task 2: API — `SetMetaPageIdBodySchema`

**Files:**
- Modify: `apps/api/src/validation.ts` (add after `UpdateConnectionBodySchema`, line 161)

- [ ] **Step 1: Add the schema** (insert immediately after the `UpdateConnectionBodySchema` block closes at line 161)

```ts
export const SetMetaPageIdBodySchema = z.object({
  pageId: z
    .string()
    .trim()
    .regex(/^\d{5,32}$/, "Facebook Page id must be the numeric Page ID (digits only)."),
});
```

- [ ] **Step 2: Typecheck the schema compiles**

Run: `pnpm --filter @switchboard/api exec tsc --noEmit -p tsconfig.json` (or defer to Task 3's test run)
Expected: no error in `validation.ts`.

(No standalone test; the schema — including the `.trim()` ordering — is exercised by the Task 3 route tests, which include a padded-input case. Committed with Task 3.)

---

## Task 3: API — `PUT /api/connections/:id/meta-page-id` route

**Files:**
- Modify: `apps/api/src/routes/connections.ts` (import the schema; add the handler)
- Test: `apps/api/src/__tests__/api-connections.test.ts` (add `mergeCredentialsById` to `mockStore`; add a `describe` block)

- [ ] **Step 1: Add `mergeCredentialsById` to the test's `mockStore`** (in `api-connections.test.ts`, the `mockStore` object at lines 6-13)

```ts
const mockStore = {
  save: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  delete: vi.fn(),
  updateStatus: vi.fn(),
  getByService: vi.fn(),
  mergeCredentialsById: vi.fn(),
};
```

- [ ] **Step 2: Write the failing route tests** (append this `describe` block before the final closing `});` of the top-level `describe("Connections API", ...)`)

```ts
  describe("PUT /api/connections/:id/meta-page-id", () => {
    it("sets the page id and returns 200 with no credential material", async () => {
      mockStore.mergeCredentialsById.mockResolvedValue("updated");

      const res = await app.inject({
        method: "PUT",
        url: "/api/connections/conn_1/meta-page-id",
        payload: { pageId: "123456789012345" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.connection).toEqual({ id: "conn_1", updated: true });
      expect(JSON.stringify(body)).not.toContain("accessToken");
      expect(mockStore.mergeCredentialsById).toHaveBeenCalledWith("conn_1", "org_test", "meta-ads", {
        pageId: "123456789012345",
      });
    });

    it("trims surrounding whitespace from the page id", async () => {
      mockStore.mergeCredentialsById.mockResolvedValue("updated");

      const res = await app.inject({
        method: "PUT",
        url: "/api/connections/conn_1/meta-page-id",
        payload: { pageId: "  123456789012345  " },
      });

      expect(res.statusCode).toBe(200);
      expect(mockStore.mergeCredentialsById).toHaveBeenCalledWith("conn_1", "org_test", "meta-ads", {
        pageId: "123456789012345",
      });
    });

    it("returns 400 for a non-numeric page id and does not call the store", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/connections/conn_1/meta-page-id",
        payload: { pageId: "not-a-number" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.toLowerCase()).toContain("numeric");
      expect(mockStore.mergeCredentialsById).not.toHaveBeenCalled();
    });

    it("returns 404 when the connection is missing or cross-org", async () => {
      mockStore.mergeCredentialsById.mockResolvedValue("not_found");

      const res = await app.inject({
        method: "PUT",
        url: "/api/connections/conn_x/meta-page-id",
        payload: { pageId: "123456789012345" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not found");
    });

    it("returns 400 when the connection is not a meta-ads connection", async () => {
      mockStore.mergeCredentialsById.mockResolvedValue("wrong_service");

      const res = await app.inject({
        method: "PUT",
        url: "/api/connections/conn_1/meta-page-id",
        payload: { pageId: "123456789012345" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Meta Ads");
    });

    it("returns 503 when the encryption key is not set", async () => {
      delete process.env["CREDENTIALS_ENCRYPTION_KEY"];

      const res = await app.inject({
        method: "PUT",
        url: "/api/connections/conn_1/meta-page-id",
        payload: { pageId: "123456789012345" },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("CREDENTIALS_ENCRYPTION_KEY");
    });

    it("returns 403 with no organization context", async () => {
      await app.close();
      app = Fastify({ logger: false });
      app.decorate("prisma", { _mock: true } as unknown as never);
      app.decorate("storageContext", { cartridges: mockCartridges } as unknown as never);
      app.decorateRequest("organizationIdFromAuth", undefined);
      await app.register(connectionsRoutes, { prefix: "/api/connections" });

      const res = await app.inject({
        method: "PUT",
        url: "/api/connections/conn_1/meta-page-id",
        payload: { pageId: "123456789012345" },
      });

      expect(res.statusCode).toBe(403);
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/api test -- api-connections`
Expected: FAIL — route returns 404 (no handler) so the 200/400/etc. assertions fail.

- [ ] **Step 4: Import the schema** (in `connections.ts`, update the import on line 5)

```ts
import {
  CreateConnectionBodySchema,
  SetMetaPageIdBodySchema,
  UpdateConnectionBodySchema,
} from "../validation.js";
```

- [ ] **Step 5: Add the handler** (in `connections.ts`, insert after the `PUT /:id` handler closes at line 214, before the `DELETE /:id` handler)

```ts
  // PUT /api/connections/:id/meta-page-id — set the Facebook Page id on a meta-ads connection
  app.put(
    "/:id/meta-page-id",
    {
      schema: {
        description: "Set the Facebook Page id used for Meta ad creatives on a meta-ads connection.",
        tags: ["Connections"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({ error: "Organization context required", statusCode: 403 });
      }

      const parsed = SetMetaPageIdBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues.map((i) => i.message).join("; "),
          statusCode: 400,
        });
      }

      if (!hasEncryptionKey()) {
        return reply.code(503).send({
          error:
            "Credential encryption is not configured. Set CREDENTIALS_ENCRYPTION_KEY environment variable.",
          statusCode: 503,
        });
      }

      const { id } = request.params as { id: string };
      const store = await getConnectionStore(app.prisma);
      const result = await store.mergeCredentialsById(id, organizationId, "meta-ads", {
        pageId: parsed.data.pageId,
      });

      if (result === "not_found") {
        return reply.code(404).send({ error: "Connection not found", statusCode: 404 });
      }
      if (result === "wrong_service") {
        return reply.code(400).send({ error: "Not a Meta Ads connection", statusCode: 400 });
      }

      return reply.code(200).send({ connection: { id, updated: true } });
    },
  );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/api test -- api-connections`
Expected: PASS (all existing + 7 new). If the "trims whitespace" test fails, the Zod `.trim()` did not run before `.regex()` — change the schema in `validation.ts` to `z.object({ pageId: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().regex(/^\d{5,32}$/, "...")) })` and re-run.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/validation.ts apps/api/src/routes/connections.ts apps/api/src/__tests__/api-connections.test.ts
git commit -m "feat(api): control-plane route to set meta-ads Facebook Page id"
```

---

## Task 4: API — loop-closing gate test (real crypto round-trip)

**Files:**
- Create: `apps/api/src/services/__tests__/creative-publish-page-id-loop.test.ts` (does **NOT** mock `@switchboard/db` — uses real crypto + real `PrismaConnectionStore`)

- [ ] **Step 1: Write the loop-closing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import {
  PrismaConnectionStore,
  encryptCredentials,
  decryptCredentials,
  type PrismaClient,
} from "@switchboard/db";
import { assertPublishable } from "../creative-publish-preconditions.js";

const TEST_KEY = "test-credentials-encryption-key-0123456789";
const ORG = "org_loop";
const CONN_ID = "conn_loop";
const JOB_ID = "job_loop";

// Stateful in-memory Prisma double: one meta-ads connection row + a publishable creative job.
// findFirst/updateMany honor the WHERE filters used by both the gate and the store.
function makeStatefulPrisma(initialCredentials: string) {
  const row = {
    id: CONN_ID,
    serviceId: "meta-ads",
    organizationId: ORG,
    credentials: initialCredentials,
    externalAccountId: null as string | null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-memory Prisma double for tests
  const where = (w: any) =>
    (w.id === undefined || w.id === row.id) &&
    (w.organizationId === undefined || w.organizationId === row.organizationId) &&
    (w.serviceId === undefined || w.serviceId === row.serviceId);
  return {
    connection: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-memory Prisma double
      findFirst: vi.fn(async ({ where: w }: any) => (where(w) ? { ...row } : null)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-memory Prisma double
      updateMany: vi.fn(async ({ where: w, data }: any) => {
        if (!where(w)) return { count: 0 };
        if (typeof data.credentials === "string") row.credentials = data.credentials;
        return { count: 1 };
      }),
    },
    creativeJob: {
      findUnique: vi.fn(async () => ({
        id: JOB_ID,
        organizationId: ORG,
        currentStage: "complete",
        stoppedAt: null,
        reviewDecision: "kept",
        durableAssetUrl: "https://assets.example/creative-assets/job_loop/assembled.mp4",
      })),
    },
  };
}

describe("page-id setter closes the publish gate (real crypto round-trip)", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env["CREDENTIALS_ENCRYPTION_KEY"];
    process.env["CREDENTIALS_ENCRYPTION_KEY"] = TEST_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env["CREDENTIALS_ENCRYPTION_KEY"];
    else process.env["CREDENTIALS_ENCRYPTION_KEY"] = savedKey;
  });

  it("flips META_PAGE_NOT_CONFIGURED to ok once an operator sets a pageId, preserving the token", async () => {
    // Seed a real-encrypted meta-ads connection WITHOUT a pageId.
    const prisma = makeStatefulPrisma(
      encryptCredentials({ accessToken: "tok_live", accountId: "act_123" }),
    );
    const store = new PrismaConnectionStore(prisma as unknown as PrismaClient);
    const deps = {
      prisma: prisma as unknown as PrismaClient,
      decrypt: (e: unknown) => decryptCredentials(e as string),
    };

    // Before: the gate blocks on the missing pageId.
    const before = await assertPublishable(deps, ORG, JOB_ID);
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.code).toBe("META_PAGE_NOT_CONFIGURED");

    // Operator sets the page id (exactly what the route does).
    const result = await store.mergeCredentialsById(CONN_ID, ORG, "meta-ads", {
      pageId: "123456789012345",
    });
    expect(result).toBe("updated");

    // After: the gate resolves; accessToken/accountId survived the merge.
    const after = await assertPublishable(deps, ORG, JOB_ID);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.pageId).toBe("123456789012345");
      expect(after.accessToken).toBe("tok_live");
      expect(after.accountId).toBe("act_123");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- creative-publish-page-id-loop`
Expected: PASS. (If it fails because real `assertPublishable` selects fields the double omits, confirm the double returns `credentials` + `externalAccountId`; the gate reads only those two from the connection.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/__tests__/creative-publish-page-id-loop.test.ts
git commit -m "test(api): loop-closing gate test for the meta page-id setter"
```

---

## Task 5: Dashboard — api-client `setMetaPageId`

**Files:**
- Modify: `apps/dashboard/src/lib/api-client/settings.ts` (add method to `SwitchboardSettingsClient`)

- [ ] **Step 1: Add the method** (insert after `testConnection` ends at line 85, before the `// Organization Config` comment)

```ts
  async setMetaPageId(id: string, pageId: string) {
    return this.request<{ connection: unknown }>(`/api/connections/${id}/meta-page-id`, {
      method: "PUT",
      body: JSON.stringify({ pageId }),
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @switchboard/dashboard exec tsc --noEmit` (or defer to Task 6's test run)
Expected: no error. (Thin client method; covered by the Task 6 proxy test, which mocks `getApiClient`. Committed with Task 6.)

---

## Task 6: Dashboard — Next proxy route

**Files:**
- Create: `apps/dashboard/src/app/api/dashboard/connections/[id]/meta-page-id/route.ts`
- Test: `apps/dashboard/src/app/api/dashboard/connections/[id]/meta-page-id/__tests__/route.test.ts`

> Before writing the test, open one existing proxy test (`apps/dashboard/src/app/api/dashboard/opportunities/[id]/stage/__tests__/route.test.ts`) and mirror its exact request-construction + handler-invocation idiom; the skeleton below matches the common pattern.

- [ ] **Step 1: Write the failing proxy test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const setMetaPageId = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(async () => ({ setMetaPageId })),
}));
vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({ organizationId: "org-1" })),
}));

import { PUT } from "../route";
import { requireSession } from "@/lib/session";

function req(body: unknown) {
  return { json: async () => body } as unknown as Request;
}
const ctx = { params: Promise.resolve({ id: "conn_1" }) };

describe("PUT /api/dashboard/connections/[id]/meta-page-id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards the pageId to the api client and returns its data", async () => {
    setMetaPageId.mockResolvedValue({ connection: { id: "conn_1", updated: true } });

    const res = await PUT(req({ pageId: "123456789012345" }) as never, ctx as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connection: { id: "conn_1", updated: true } });
    expect(setMetaPageId).toHaveBeenCalledWith("conn_1", "123456789012345");
  });

  it("returns 401 when the session is missing", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));

    const res = await PUT(req({ pageId: "123456789012345" }) as never, ctx as never);

    expect(res.status).toBe(401);
  });

  it("surfaces a backend error message (e.g. invalid page id)", async () => {
    setMetaPageId.mockRejectedValueOnce(
      new Error("Facebook Page id must be the numeric Page ID (digits only)."),
    );

    const res = await PUT(req({ pageId: "x" }) as never, ctx as never);

    expect(res.status).toBe(500);
    expect((await res.json()).error.toLowerCase()).toContain("numeric");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- meta-page-id`
Expected: FAIL — cannot resolve `../route` (file does not exist).

- [ ] **Step 3: Create the proxy route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = (await request.json()) as { pageId?: string };
    const client = await getApiClient();
    const data = await client.setMetaPageId(id, body.pageId ?? "");
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- meta-page-id`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/api-client/settings.ts "apps/dashboard/src/app/api/dashboard/connections/[id]/meta-page-id"
git commit -m "feat(dashboard): proxy + api-client for the meta page-id setter"
```

---

## Task 7: Dashboard — `useSetMetaPageId` hook

**Files:**
- Modify: `apps/dashboard/src/hooks/use-connections.ts` (add the hook after `useUpdateConnection`)
- Test: `apps/dashboard/src/hooks/__tests__/use-connections.test.ts` (new; mirror `use-business-facts.test.ts`)

- [ ] **Step 1: Write the failing hook test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useSetMetaPageId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PUTs the page id to the connection proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ connection: { id: "conn_1", updated: true } }),
    });
    const { useSetMetaPageId } = await import("@/hooks/use-connections");
    const { result } = renderHook(() => useSetMetaPageId(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ id: "conn_1", pageId: "123456789012345" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/connections/conn_1/meta-page-id",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ pageId: "123456789012345" }),
      }),
    );
  });

  it("throws the backend error message on failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Not a Meta Ads connection" }),
    });
    const { useSetMetaPageId } = await import("@/hooks/use-connections");
    const { result } = renderHook(() => useSetMetaPageId(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: "conn_1", pageId: "123456789012345" });
      }),
    ).rejects.toThrow("Not a Meta Ads connection");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- use-connections`
Expected: FAIL — `useSetMetaPageId` is not exported.

- [ ] **Step 3: Add the hook** (in `use-connections.ts`, after `useUpdateConnection` closes at line 123)

```ts
export function useSetMetaPageId() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({ id, pageId }: { id: string; pageId: string }) => {
      const res = await fetch(`/api/dashboard/connections/${id}/meta-page-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to set Facebook Page id");
      }
      return res.json();
    },
    onSuccess: () => {
      if (keys) queryClient.invalidateQueries({ queryKey: keys.connections.all() });
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- use-connections`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-connections.ts apps/dashboard/src/hooks/__tests__/use-connections.test.ts
git commit -m "feat(dashboard): useSetMetaPageId mutation hook"
```

---

## Task 8: Dashboard — `SetMetaPageIdDialog` + connection-card action

**Files:**
- Create: `apps/dashboard/src/components/settings/set-meta-page-id-dialog.tsx`
- Modify: `apps/dashboard/src/components/settings/connections-list.tsx` (import, state, card button, dialog mount)
- Test: `apps/dashboard/src/components/settings/__tests__/set-meta-page-id-dialog.test.tsx`

- [ ] **Step 1: Write the failing dialog test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";
import { SetMetaPageIdDialog } from "../set-meta-page-id-dialog";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));
const toast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast }) }));
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client: qc }, node));
}

describe("SetMetaPageIdDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Save until a numeric page id is entered", () => {
    wrap(<SetMetaPageIdDialog connectionId="conn_1" onClose={vi.fn()} />);
    const save = screen.getByRole("button", { name: /save page/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/facebook page id/i), { target: { value: "abc" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/facebook page id/i), {
      target: { value: "123456789012345" },
    });
    expect(save).toBeEnabled();
  });

  it("submits the page id, toasts success, and closes", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ connection: { id: "conn_1", updated: true } }),
    });
    const onClose = vi.fn();
    wrap(<SetMetaPageIdDialog connectionId="conn_1" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/facebook page id/i), {
      target: { value: "123456789012345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save page/i }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/connections/conn_1/meta-page-id",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/saved/i) }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- set-meta-page-id-dialog`
Expected: FAIL — cannot resolve `../set-meta-page-id-dialog`.

- [ ] **Step 3: Create the dialog component**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useSetMetaPageId } from "@/hooks/use-connections";
import { useToast } from "@/components/ui/use-toast";

const PAGE_ID_RE = /^\d{5,32}$/;

export function SetMetaPageIdDialog({
  connectionId,
  onClose,
}: {
  connectionId: string | null;
  onClose: () => void;
}) {
  const [pageId, setPageId] = useState("");
  const { toast } = useToast();
  const setMetaPageId = useSetMetaPageId();

  const trimmed = pageId.trim();
  const isValid = PAGE_ID_RE.test(trimmed);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectionId || !isValid) return;
    setMetaPageId.mutate(
      { id: connectionId, pageId: trimmed },
      {
        onSuccess: () => {
          toast({
            title: "Facebook Page saved",
            description: "Mira can now stage paused ads for this connection.",
          });
          setPageId("");
          onClose();
        },
        onError: (err: unknown) => {
          toast({
            variant: "destructive",
            title: "Could not save Page id",
            description: err instanceof Error ? err.message : "Please try again.",
          });
        },
      },
    );
  };

  return (
    <Dialog open={!!connectionId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Facebook Page</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="meta-page-id">Facebook Page ID</Label>
            <Input
              id="meta-page-id"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="123456789012345"
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">
              The numeric Page ID (digits only) of the Facebook Page your ads run from. Find it in
              Meta Business Suite under your Page&apos;s settings. Required before Mira can stage
              paused ads.
            </p>
            {pageId.length > 0 && !isValid && (
              <p className="text-xs text-destructive">Enter the numeric Page ID (digits only).</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || setMetaPageId.isPending}>
              {setMetaPageId.isPending ? "Saving..." : "Save Page"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the dialog test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- set-meta-page-id-dialog`
Expected: PASS.

- [ ] **Step 5: Wire the card action into `connections-list.tsx`**

(a) Add the import after line 32 (`import { WhatsAppEmbeddedSignup } ...`):
```ts
import { SetMetaPageIdDialog } from "./set-meta-page-id-dialog";
```

(b) Add state after line 72 (`const [deleteConfirm, ...]`):
```ts
  const [pageIdConn, setPageIdConn] = useState<string | null>(null);
```

(c) Add the button inside the card action row — in the `<div className="flex gap-2 pt-1">` block (lines 211-230), after the `Test` button and before the `Delete` button:
```tsx
                    {conn.serviceId === "meta-ads" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPageIdConn(conn.id)}
                      >
                        Set Facebook Page
                      </Button>
                    )}
```

(d) Mount the dialog just before the closing `</>` (after the New-connection `</Dialog>` at line 423):
```tsx
      <SetMetaPageIdDialog connectionId={pageIdConn} onClose={() => setPageIdConn(null)} />
```

- [ ] **Step 6: Run the full dashboard settings test surface to confirm no regressions**

Run: `pnpm --filter @switchboard/dashboard test -- connections set-meta-page-id`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/settings/set-meta-page-id-dialog.tsx apps/dashboard/src/components/settings/connections-list.tsx apps/dashboard/src/components/settings/__tests__/set-meta-page-id-dialog.test.tsx
git commit -m "feat(dashboard): Set Facebook Page action on the meta-ads connection card"
```

---

## Task 9: Full gates + PR

**Files:** none (verification + integration)

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS (no errors). If missing-exports errors appear for `@switchboard/db`, run `pnpm reset` then retry.

- [ ] **Step 2: Lint + format**

Run: `pnpm lint && pnpm format:check`
Expected: PASS. If `format:check` fails, run `pnpm format` and re-stage.

- [ ] **Step 3: Route-governance gate**

Run: `pnpm exec tsx .agent/tools/check-routes.ts --mode=error`
Expected: exit 0. (A non-blocking `::warning::` for the control-plane org-guard on `connections.ts` is expected and pre-existing — it does not fail `--mode=error`. If deps are missing, `cd .agent/tools && pnpm install --ignore-workspace`.)

- [ ] **Step 4: Dependency-cruiser + env completeness**

Run: `pnpm exec depcruise --version >/dev/null 2>&1 && pnpm dep-check 2>/dev/null; pnpm exec tsx scripts/check-env-completeness.ts 2>/dev/null || true`
Expected: no new violations. (No new env var was introduced, so env-completeness has nothing to add. Use the repo's actual depcruise/env scripts as named in `package.json` if these differ.)

- [ ] **Step 5: Run the full touched-package suites**

Run: `pnpm --filter @switchboard/db test && pnpm --filter @switchboard/api test && pnpm --filter @switchboard/dashboard test`
Expected: PASS. (Pre-existing flakes per memory: `pg_advisory_xact_lock`, `gateway-bridge-attribution`, `Eval — Claim Classifier` — these are unrelated to this change; note them if seen, do not block.)

- [ ] **Step 6: Self-review the diff** against the spec and CLAUDE.md basics (no `any`, no `console.log`, `.js` import extensions, file sizes < 600).

Run: `git diff origin/main --stat && git log origin/main..HEAD --oneline`

- [ ] **Step 7: Push and open the PR (do NOT merge)**

```bash
git push -u origin feat/meta-page-id-setter
gh pr create --base main --title "feat: operator Facebook Page-id setter for meta-ads connection (Mira PR C)" --body "<see PR body template in the spec §2 + §8; link the spec and plan; note go-live blocker #2 cleared; STOP for merge decision>"
```

- [ ] **Step 8: Confirm CI is green** on all required checks (typecheck/lint/test/security/route-governance). Then STOP and hand to the user for the merge decision.

---

## Self-Review (run after writing; fix inline)

- **Spec coverage:** store merge (§3.1 → Task 1), route + validation (§3.2 → Tasks 2-3), loop-closing test (§4.2 → Task 4), dashboard plumbing + UI (§3.3 → Tasks 5-8), gates (§7 → Task 9). All spec sections map to a task. ✓
- **Type consistency:** `mergeCredentialsById(id, organizationId, expectedServiceId, patch) → "updated"|"not_found"|"wrong_service"` is identical across Task 1 (impl), Task 3 (route call), Task 4 (loop test), and the route maps `not_found→404`, `wrong_service→400`. `setMetaPageId(id, pageId)` identical across Tasks 5-7. `useSetMetaPageId().mutate({ id, pageId })` identical across Tasks 7-8. ✓
- **No placeholders:** every code step shows complete code; every run step shows the command + expected result. ✓
- **Crypto-mock discipline:** Task 1 uses the existing JSON-mock file; Task 4 is a new file that does NOT mock `@switchboard/db`. ✓
