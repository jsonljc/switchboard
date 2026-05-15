# WhatsApp Send-Test (Slice 2A — Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend proof-path for `whatsapp_business_messaging`. After this PR merges, an operator (or curl) can `POST /api/dashboard/whatsapp/send-test` with `{ phoneNumberId, templateName, languageCode, toNumber }`, the API validates against a tenant allowlist + APPROVED template list, calls Graph `/messages`, returns the WhatsApp message ID immediately, persists a `WhatsAppTestSend` row, and Meta's later `statuses` webhook updates that row via an `apps/chat` bridge.

**No UI in this PR.** The dashboard wiring is Slice 2B (separate PR).

**Architecture:** New Fastify plugin `whatsapp-send-test.ts` registered under the existing `/api/dashboard/whatsapp` prefix (keeps `whatsapp-management.ts` lean). New `WhatsAppTestSend` table; `testRecipients` JSON allowlist on `ManagedChannel`. Webhook back-channel via a thin bridge module in `apps/chat`, wired into `main.ts` using whatever store-construction pattern the file already uses (do not introduce a new one).

**Tech Stack:** Fastify (apps/api), Prisma 6 (packages/db), Zod (packages/schemas), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-14-whatsapp-tech-provider-console-design.md` — Slice 2 (backend half).

---

## Scope guardrails — do NOT add these

- ❌ Any dashboard/React code (that's Slice 2B).
- ❌ An admin UI or API to **edit** `testRecipients`. In Slice 2A, the allowlist is admin-seeded by direct SQL only.
- ❌ Persisting webhook status events to `WhatsAppMessageStatus` more broadly (`PrismaWhatsAppStatusStore` already exists but is unwired — out of scope here).
- ❌ In-app template creation.
- ❌ Optimistic UI / mutation queue — N/A, no UI.

## Codebase alignment notes (verified against main as of 2026-05-14)

- Route prefix is `/api/dashboard/whatsapp` (not `/api/whatsapp-management/...`). New POST → `POST /api/dashboard/whatsapp/send-test`.
- `apps/api/src/routes/whatsapp-management.ts` is ~480 LOC. Add new file `whatsapp-send-test.ts` to avoid breaching the 600-LOC soft cap.
- Existing Graph helper signature: `graphGet(path: string, token: string, fetchImpl: typeof fetch)` returning `{ ok: true; data } | { ok: false; code; message; httpStatus }` (no `retryable` field). It does **not** prepend a base URL — callers pass the full URL (e.g., `` `${graphBase}/${wabaId}/message_templates` ``). The new `graphPost` mirrors that exact shape (no `retryable`); callers infer `retryable` at the boundary using `code === "WHATSAPP_RATE_LIMITED"` (this is how `whatsapp-management.ts:398` already does it).
- The Graph token is sourced from `process.env.META_SYSTEM_USER_TOKEN` (`whatsapp-management.ts:155`), not from `Connection.credentials`. The `wabaId` is sourced from `connection.externalAccountId` (line 199). `Connection.credentials` only carries `primaryPhoneNumberId` (`interface WhatsAppCredentials { primaryPhoneNumberId?: string; [key: string]: unknown }`). Decryption is via `decryptCredentials()` fallback after `JSON.parse` — only needed if your handler reads credentials.
- Test pattern (mocked Prisma + Graph) uses `app.decorate("prisma", { ... } as any)`, `app.inject({ method, url, payload })`. The project allows pre-existing `as any` in test files (CLAUDE.md). Mirror it.
- `WhatsAppMessageStatus` model already exists; out of scope.
- `ManagedWebhookDeps` in `apps/chat/src/routes/managed-webhook.ts:32` already exposes an optional `onStatusUpdate` parameter; the existing `registerManagedWebhookRoutes(app, { registry, failedMessageStore, ctwaAdapter, dedup })` call in `apps/chat/src/main.ts:330` simply omits it. We wire it.
- **`apps/chat/src/main.ts` scope detail:** `prisma` is declared inside `if (process.env["DATABASE_URL"]) { ... }` (lines 119-124), not at outer scope. New stores must follow the same pattern as `failedMessageStore`: declare `let testSendStore: PrismaWhatsAppTestSendStore | null = null;` at outer scope, assign inside the block, then build the bridge after the block. Do not put `new PrismaWhatsAppTestSendStore(prisma)` adjacent to `registerManagedWebhookRoutes` — `prisma` is out of scope there.
- Relative imports in `apps/api`, `apps/chat`, `packages/*` use `.js` extensions (ESM).
- Migrations are hand-written SQL after `prisma migrate diff` (per `feedback_prisma_migrate_dev_tty.md`).

## State model — semantic clarification

`WhatsAppTestSend` uses two status fields:

- **`apiStatus`** — terminal: `"sent"` (Graph returned a `messageId`) or `"failed"` (Graph returned an error or no ID). This is the App Review proof. Avoid the word `"queued"` — Meta returning a `messageId` means the message is **accepted**, not pending Meta action.
- **`lastWebhookStatus`** — progressive: `null` until the first webhook arrives, then `"sent" | "delivered" | "read" | "failed"`. Renders as "Accepted by WhatsApp · awaiting delivery webhook" before the first event arrives.

> **Persistence rule (Slice 2A):** The enum reserves `"failed"` for forward compatibility, but **2A only persists rows once Graph returns a `messageId`**. The Prisma model declares `messageId String @unique`, so a row cannot exist without one. Upstream Graph failures return an HTTP error response to the operator and are **not persisted** in this slice. A future slice may add a separate failure-attempts table or relax the uniqueness constraint to record failed sends.

## File structure (Slice 2A only)

**Create:**

- `packages/schemas/src/whatsapp-test-send.ts` + co-located test
- `packages/db/src/stores/prisma-whatsapp-test-send-store.ts` + co-located test
- `packages/db/prisma/migrations/<TS>_whatsapp_test_send/migration.sql`
- `apps/api/src/routes/whatsapp-send-test.ts` + co-located test
- `apps/chat/src/bridges/whatsapp-test-send-status-bridge.ts` + co-located test

**Modify:**

- `packages/schemas/src/index.ts` — export new schemas
- `packages/db/prisma/schema.prisma` — add `testRecipients` to `ManagedChannel`, add `WhatsAppTestSend` model
- `packages/db/src/index.ts` (or `stores/index.ts`) — export new store
- `apps/api/src/routes/whatsapp-management.ts` — extract a small `fetchWhatsAppTemplates(wabaId, token, fetchImpl)` helper (export it) so send-test can re-use it without duplication
- `apps/api/src/bootstrap/routes.ts` — register `whatsappSendTestRoutes`
- `apps/chat/src/main.ts` — wire `onStatusUpdate` using the existing store-construction pattern in this file (only instantiate `PrismaWhatsAppTestSendStore` directly if adjacent stores are already instantiated that way; otherwise use the existing factory)

---

## Task 1 — Zod schemas

**Files:**

- Create: `packages/schemas/src/whatsapp-test-send.ts`
- Create: `packages/schemas/src/__tests__/whatsapp-test-send.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Failing tests** — create `packages/schemas/src/__tests__/whatsapp-test-send.test.ts`. The test asserts:
  - `WhatsAppSendTestRequestSchema.parse({ phoneNumberId, templateName, languageCode, toNumber: "+15551234567" })` succeeds.
  - Non-E.164 (`"15551234567"`) throws.
  - Empty `templateName` throws.
  - `WhatsAppSendTestResultSchema` accepts both `status: "sent"` (with `messageId`) and `status: "failed"` (with optional `graphError: { code, message, retryable }`).
  - `WhatsAppTestSendRowSchema` accepts a row with `lastWebhookStatus: null`, `lastWebhookAt: null`.

- [ ] **Step 2: Run failing**

```bash
pnpm --filter @switchboard/schemas test -- whatsapp-test-send
```

- [ ] **Step 3: Implement** — create `packages/schemas/src/whatsapp-test-send.ts`:

```typescript
import { z } from "zod";

const E164 = /^\+[1-9]\d{6,14}$/;

export const WhatsAppSendTestRequestSchema = z.object({
  phoneNumberId: z.string().min(1),
  templateName: z.string().min(1).max(512),
  languageCode: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[a-zA-Z_-]+$/, "languageCode must be ISO-like, e.g. en_US"),
  toNumber: z.string().regex(E164, "toNumber must be E.164 (e.g. +15551234567)"),
});

export const WhatsAppSendTestGraphErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

// apiStatus is terminal: "sent" means Graph returned a messageId; "failed" means it didn't.
export const WhatsAppSendTestResultSchema = z.object({
  messageId: z.string().nullable(),
  status: z.enum(["sent", "failed"]),
  sentAt: z.string(),
  graphError: WhatsAppSendTestGraphErrorSchema.optional(),
});

export const WhatsAppTestSendRowSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  phoneNumberId: z.string(),
  templateName: z.string(),
  languageCode: z.string(),
  toNumber: z.string(),
  sentBy: z.string(),
  sentAt: z.string(),
  apiStatus: z.enum(["sent", "failed"]),
  lastWebhookStatus: z.enum(["sent", "delivered", "read", "failed"]).nullable(),
  lastWebhookAt: z.string().nullable(),
});

export type WhatsAppSendTestRequest = z.infer<typeof WhatsAppSendTestRequestSchema>;
export type WhatsAppSendTestResult = z.infer<typeof WhatsAppSendTestResultSchema>;
export type WhatsAppTestSendRow = z.infer<typeof WhatsAppTestSendRowSchema>;
```

- [ ] **Step 4: Export from index** — append to `packages/schemas/src/index.ts`:

```typescript
export * from "./whatsapp-test-send.js";
```

- [ ] **Step 5: Run, pass, commit**

```bash
pnpm --filter @switchboard/schemas test -- whatsapp-test-send
git add packages/schemas/
git commit -m "feat(schemas): WhatsAppSendTest{Request,Result,Row} schemas — apiStatus is sent|failed (slice 2a)"
```

---

## Task 2 — Prisma model + migration

**Files:** modify `packages/db/prisma/schema.prisma`; create `packages/db/prisma/migrations/<TS>_whatsapp_test_send/migration.sql`.

- [ ] **Step 1: Edit schema.prisma**

Inside the existing `model ManagedChannel { ... }` block, add this field before the `@@index`/`@@unique` lines:

```prisma
  testRecipients    Json      @default("[]")
```

After the `WhatsAppMessageStatus` model, append:

```prisma
model WhatsAppTestSend {
  id                 String    @id @default(uuid())
  organizationId     String
  managedChannelId   String
  messageId          String    @unique
  phoneNumberId      String
  templateName       String
  languageCode       String
  toNumber           String
  sentBy             String
  sentAt             DateTime  @default(now())
  apiStatus          String    @default("sent")
  lastWebhookStatus  String?
  lastWebhookAt      DateTime?

  @@index([organizationId, sentAt(sort: Desc)])
  @@index([managedChannelId, sentAt(sort: Desc)])
}
```

- [ ] **Step 2: Format**

```bash
pnpm --filter @switchboard/db exec prisma format
```

- [ ] **Step 3: Generate migration**

```bash
cd packages/db
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_whatsapp_test_send"
pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "prisma/migrations/${TS}_whatsapp_test_send/migration.sql"
cat "prisma/migrations/${TS}_whatsapp_test_send/migration.sql"
```

Verify the SQL adds the `testRecipients` JSONB column on `ManagedChannel` (NOT NULL DEFAULT '[]'::jsonb) and creates the `WhatsAppTestSend` table + indexes. Index names must fit under 63 chars (Prisma truncates).

- [ ] **Step 4: Apply locally (if local Postgres up)**

```bash
cd /Users/jasonli/switchboard
pnpm db:migrate
```

Skip if no Postgres; CI drift check will catch.

- [ ] **Step 5: Generate client + typecheck**

```bash
pnpm db:generate
pnpm --filter @switchboard/db typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/
git commit -m "feat(db): WhatsAppTestSend model + testRecipients column on ManagedChannel (slice 2a)"
```

---

## Task 3 — PrismaWhatsAppTestSendStore

**Files:**

- Create: `packages/db/src/stores/prisma-whatsapp-test-send-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-whatsapp-test-send-store.test.ts`
- Modify: `packages/db/src/index.ts` (or `stores/index.ts` — match the existing `PrismaWhatsAppStatusStore` export path)

- [ ] **Step 1: Failing tests** — assert via mocked Prisma:
  - `create()` calls `whatsAppTestSend.create({ data: input })` and returns the row.
  - `listRecent("org_1", 10)` calls `findMany({ where: { organizationId }, orderBy: { sentAt: "desc" }, take: 10 })`.
  - `updateWebhookStatus({ messageId, status, at })` returns `null` when the row doesn't exist (and never calls `update`).
  - `updateWebhookStatus({ messageId, status, at })` calls `update({ where: { messageId }, data: { lastWebhookStatus: status, lastWebhookAt: at } })` when the row exists.

- [ ] **Step 2: Run failing**

```bash
pnpm --filter @switchboard/db test -- prisma-whatsapp-test-send-store
```

- [ ] **Step 3: Implement** — create `packages/db/src/stores/prisma-whatsapp-test-send-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";

export type ApiStatus = "sent" | "failed";
export type WebhookStatus = "sent" | "delivered" | "read" | "failed";

export interface WhatsAppTestSendRow {
  id: string;
  organizationId: string;
  managedChannelId: string;
  messageId: string;
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  toNumber: string;
  sentBy: string;
  sentAt: Date;
  apiStatus: ApiStatus;
  lastWebhookStatus: WebhookStatus | null;
  lastWebhookAt: Date | null;
}

export interface WhatsAppTestSendCreateInput {
  organizationId: string;
  managedChannelId: string;
  messageId: string;
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  toNumber: string;
  sentBy: string;
  sentAt: Date;
  apiStatus: ApiStatus;
}

export interface UpdateWebhookStatusInput {
  messageId: string;
  status: WebhookStatus;
  at: Date;
}

export class PrismaWhatsAppTestSendStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: WhatsAppTestSendCreateInput): Promise<WhatsAppTestSendRow> {
    const row = await this.prisma.whatsAppTestSend.create({ data: input });
    return row as WhatsAppTestSendRow;
  }

  async listRecent(organizationId: string, limit: number): Promise<WhatsAppTestSendRow[]> {
    const rows = await this.prisma.whatsAppTestSend.findMany({
      where: { organizationId },
      orderBy: { sentAt: "desc" },
      take: limit,
    });
    return rows as WhatsAppTestSendRow[];
  }

  async updateWebhookStatus(input: UpdateWebhookStatusInput): Promise<WhatsAppTestSendRow | null> {
    const existing = await this.prisma.whatsAppTestSend.findUnique({
      where: { messageId: input.messageId },
    });
    if (!existing) return null;
    const updated = await this.prisma.whatsAppTestSend.update({
      where: { messageId: input.messageId },
      data: { lastWebhookStatus: input.status, lastWebhookAt: input.at },
    });
    return updated as WhatsAppTestSendRow;
  }
}
```

- [ ] **Step 4: Export from package index.** The convention in `packages/db/src/index.ts` is **named re-exports**, not `export *`. Add:

```typescript
export {
  PrismaWhatsAppTestSendStore,
  type WhatsAppTestSendRow,
  type WhatsAppTestSendCreateInput,
  type UpdateWebhookStatusInput,
  type ApiStatus,
  type WebhookStatus,
} from "./stores/prisma-whatsapp-test-send-store.js";
```

(`PrismaWhatsAppStatusStore` itself is not currently re-exported; if you want symmetry, add a named re-export for it too in the same PR — optional but tidy.)

- [ ] **Step 5: Run, pass, commit**

```bash
pnpm --filter @switchboard/db test -- prisma-whatsapp-test-send-store
git add packages/db/src/
git commit -m "feat(db): PrismaWhatsAppTestSendStore — create / listRecent / updateWebhookStatus"
```

---

## Task 4 — Extract `fetchWhatsAppTemplates` from whatsapp-management.ts

**Files:** modify `apps/api/src/routes/whatsapp-management.ts` (extract + export); existing tests in `__tests__/whatsapp-management.test.ts` must still pass.

Send-test (Task 6) needs to look up approved templates without duplicating the Graph fetch. Extract a small helper.

- [ ] **Step 1:** Locate the existing templates handler. It builds a full URL like `` `${graphBase}/${wabaId}/message_templates?...` ``, calls `graphGet(fullUrl, token, fetchImpl)`, and maps Graph rows into the full `Template` shape consumed by `/templates`. The helper must return that **same** shape so the existing route can be refactored without changing its external response:

```typescript
// Mirror the existing /templates route's output type — do NOT pare down.
export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  status: string; // "APPROVED" | "PENDING" | "REJECTED" | ...
  category: string;
  hasBody: boolean;
  hasButtons: boolean;
  rejectedReason: string | null;
}

export async function fetchWhatsAppTemplates(args: {
  wabaId: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<
  | { ok: true; templates: WhatsAppTemplate[] }
  | { ok: false; code: string; message: string; httpStatus: number }
> {
  // Build the same full URL the existing /templates handler uses (graphBase + /<wabaId>/message_templates with fields).
  // Call graphGet, then run the existing component-mapping logic to produce WhatsAppTemplate[].
}
```

Refactor the `/templates` route handler to call this new helper. The dashboard consumes `category`, `hasBody`, `hasButtons`, and `rejectedReason`; do not drop any of them. Send-test only reads `name`, `status`, and `language` — pull what you need from the full row. The route's `retryable` field (currently inferred at the boundary) stays where it is.

- [ ] **Step 2: Run existing tests, expect green**

```bash
pnpm --filter @switchboard/api test -- whatsapp-management
```

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(api): extract fetchWhatsAppTemplates helper for reuse (no behaviour change)"
```

---

## Task 5 — Scaffold `whatsapp-send-test.ts` plugin + `graphPost`

**Files:**

- Create: `apps/api/src/routes/whatsapp-send-test.ts`
- Create: `apps/api/src/routes/__tests__/whatsapp-send-test.test.ts`

- [ ] **Step 1: Failing test for plugin registration**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappSendTestRoutes } from "../whatsapp-send-test.js";

function buildPrismaMock() {
  return {
    connection: { findFirst: vi.fn() },
    managedChannel: { findFirst: vi.fn() },
    whatsAppTestSend: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

async function buildApp(opts: {
  prisma: ReturnType<typeof buildPrismaMock>;
  graphApiFetch: typeof fetch;
}) {
  const app = Fastify({ logger: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- existing house style in whatsapp-management.test.ts
  app.decorate("prisma", opts.prisma as any);
  app.decorateRequest("organizationIdFromAuth", "");
  app.decorateRequest("userEmail", "");
  app.addHook("onRequest", async (request) => {
    (request as unknown as { organizationIdFromAuth: string }).organizationIdFromAuth = "org_test";
    (request as unknown as { userEmail: string }).userEmail = "u@example.com";
  });
  await app.register(whatsappSendTestRoutes, { graphApiFetch: opts.graphApiFetch });
  return app;
}

describe("whatsappSendTestRoutes registration", () => {
  let app: FastifyInstance;
  beforeEach(() => {});
  it("registers POST /send-test and GET /test-sends", async () => {
    app = await buildApp({ prisma: buildPrismaMock(), graphApiFetch: vi.fn() });
    expect(app.hasRoute({ method: "POST", url: "/send-test" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/test-sends" })).toBe(true);
    await app.close();
  });
});
```

- [ ] **Step 2: Implement scaffold + `graphPost`** — create `apps/api/src/routes/whatsapp-send-test.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

interface GraphErrorBody {
  error?: {
    code?: number | string;
    message?: string;
    type?: string;
    error_subcode?: number;
  };
}

// Mirrors graphGet's return shape — NO `retryable` field. Callers infer retryable from code.
export type GraphPostResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; httpStatus: number };

// `url` is a full URL — matches graphGet's convention. Caller composes ${graphBase}/${phoneNumberId}/messages.
export async function graphPost(
  url: string,
  body: unknown,
  token: string,
  fetchImpl: typeof fetch,
): Promise<GraphPostResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      code: "WHATSAPP_NETWORK_ERROR",
      message: err instanceof Error ? err.message : "network error",
      httpStatus: 502,
    };
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = {};
  }
  if (res.ok) return { ok: true, data: parsed };

  const errBody = parsed as GraphErrorBody;
  const code = Number(errBody.error?.code ?? 0);
  const subcode = Number(errBody.error?.error_subcode ?? 0);
  const message = errBody.error?.message ?? "Graph API error";

  if (code === 190) return { ok: false, code: "WHATSAPP_TOKEN_INVALID", message, httpStatus: 502 };
  if (code === 200 || code === 10 || res.status === 403)
    return { ok: false, code: "WHATSAPP_GRAPH_PERMISSION_DENIED", message, httpStatus: 403 };
  if (res.status === 429 || code === 4 || subcode === 80007)
    return { ok: false, code: "WHATSAPP_RATE_LIMITED", message, httpStatus: 429 };
  if (code === 132000 || code === 132001)
    return { ok: false, code: "WHATSAPP_TEMPLATE_NOT_FOUND", message, httpStatus: 400 };
  return { ok: false, code: "WHATSAPP_UPSTREAM_ERROR", message, httpStatus: 502 };
}

// Boundary helper — derive the user-facing retryable flag for the JSON error envelope.
// Intentionally LOCAL to whatsapp-send-test.ts for now. whatsapp-management.ts:398 has its
// own narrower inline check (`code === "WHATSAPP_RATE_LIMITED"`). Unifying both into a
// shared util is a separate follow-up; do not move this helper unless you also update
// whatsapp-management.ts' inline check and add a regression test for /templates' retryable flag.
export function isRetryable(code: string): boolean {
  return (
    code === "WHATSAPP_RATE_LIMITED" ||
    code === "WHATSAPP_UPSTREAM_ERROR" ||
    code === "WHATSAPP_NETWORK_ERROR" ||
    code === "WHATSAPP_NO_MESSAGE_ID"
  );
}

export interface SendTestOptions {
  graphApiFetch?: typeof fetch;
}

export const whatsappSendTestRoutes: FastifyPluginAsync<SendTestOptions> = async (app, opts) => {
  const fetchImpl = opts.graphApiFetch ?? fetch;
  void fetchImpl; // used in Task 6 handler

  app.post("/send-test", async (_req, reply) =>
    reply
      .code(501)
      .send({ error: { code: "NOT_IMPLEMENTED", message: "filled next task", retryable: false } }),
  );
  app.get("/test-sends", async (_req, reply) =>
    reply
      .code(501)
      .send({ error: { code: "NOT_IMPLEMENTED", message: "filled next task", retryable: false } }),
  );
};
```

- [ ] **Step 3: Run, pass, commit**

```bash
pnpm --filter @switchboard/api test -- whatsapp-send-test
git add apps/api/src/routes/whatsapp-send-test.ts apps/api/src/routes/__tests__/whatsapp-send-test.test.ts
git commit -m "feat(api): scaffold whatsappSendTestRoutes plugin + graphPost helper (slice 2a)"
```

---

## Task 6 — POST /send-test — happy path + allowlist + template approval

Three behaviours, same handler, one task (three TDD cycles).

### 6a — Happy path

- [ ] **Step 1: Failing test** — assert that when channel has `testRecipients: ["+15551234567"]`, the Connection has `externalAccountId: "WABA_1"`, `process.env.META_SYSTEM_USER_TOKEN` is set (use `vi.stubEnv("META_SYSTEM_USER_TOKEN", "TOKEN")` or set in `beforeEach`), and Graph (a) returns an APPROVED template list and (b) returns a `messageId`:
  - response status 200
  - body `{ messageId: "wamid.HBgLABC==", status: "sent", sentAt: "<iso>" }`
  - `prisma.whatsAppTestSend.create` called exactly once with `apiStatus: "sent"`
  - first Graph call URL includes `/WABA_1/message_templates` (the approval pre-check)
  - second Graph call URL includes `/PN_123/messages`
  - both calls use `Authorization: Bearer TOKEN`

- [ ] **Step 2: Implement handler** — replace the `/send-test` stub:

```typescript
import { WhatsAppSendTestRequestSchema, type WhatsAppSendTestRequest } from "@switchboard/schemas";
import { fetchWhatsAppTemplates } from "./whatsapp-management.js";

app.post("/send-test", async (request, reply) => {
  const orgId = (request as unknown as { organizationIdFromAuth: string }).organizationIdFromAuth;
  const sentBy = (request as unknown as { userEmail?: string }).userEmail ?? "system";

  const parsed = WhatsAppSendTestRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: {
        code: "WHATSAPP_BAD_REQUEST",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        retryable: false,
      },
    });
  }
  const body: WhatsAppSendTestRequest = parsed.data;

  const channel = await app.prisma!.managedChannel.findFirst({
    where: { organizationId: orgId, channel: "whatsapp" },
  });
  if (!channel) {
    return reply.code(404).send({
      error: {
        code: "WHATSAPP_NOT_CONNECTED",
        message: "WhatsApp channel is not connected",
        retryable: false,
      },
    });
  }

  const allowed = Array.isArray(channel.testRecipients)
    ? (channel.testRecipients as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (!allowed.includes(body.toNumber)) {
    return reply.code(403).send({
      error: {
        code: "WHATSAPP_RECIPIENT_NOT_ALLOWLISTED",
        message: "toNumber must be on this channel's testRecipients allowlist",
        retryable: false,
      },
    });
  }

  // Source the WhatsApp Business Account ID from Connection.externalAccountId
  // (NOT from credentials — credentials only carry primaryPhoneNumberId).
  const conn = await app.prisma!.connection.findFirst({
    where: { id: channel.connectionId, organizationId: orgId },
  });
  const wabaId = conn?.externalAccountId ?? null;
  if (!wabaId) {
    return reply.code(500).send({
      error: {
        code: "WHATSAPP_WABA_MISSING",
        message: "Connection has no externalAccountId (WABA)",
        retryable: false,
      },
    });
  }
  // The Graph token is a system-user token from env — same source as /templates and /phone-numbers.
  const token = process.env.META_SYSTEM_USER_TOKEN ?? "";
  if (!token) {
    return reply.code(500).send({
      error: {
        code: "WHATSAPP_TOKEN_MISSING",
        message: "META_SYSTEM_USER_TOKEN is not configured on the server",
        retryable: false,
      },
    });
  }

  // Template approval pre-check — trust boundary (frontend filter alone is insufficient).
  // fetchWhatsAppTemplates mirrors graphGet's return shape (no `retryable`); infer at boundary.
  const tplResult = await fetchWhatsAppTemplates({ wabaId, token, fetchImpl });
  if (!tplResult.ok) {
    return reply.code(tplResult.httpStatus).send({
      error: {
        code: tplResult.code,
        message: tplResult.message,
        retryable: isRetryable(tplResult.code),
      },
    });
  }
  const tpl = tplResult.templates.find(
    (t) => t.name === body.templateName && t.language === body.languageCode,
  );
  if (!tpl || tpl.status.toUpperCase() !== "APPROVED") {
    return reply.code(400).send({
      error: {
        code: "WHATSAPP_TEMPLATE_NOT_APPROVED",
        message: "Only APPROVED templates can be used for send-test",
        retryable: false,
      },
    });
  }

  const graphBody = {
    messaging_product: "whatsapp",
    to: body.toNumber.replace(/^\+/, ""),
    type: "template",
    template: { name: body.templateName, language: { code: body.languageCode } },
  };
  // graphPost takes a FULL URL (matches graphGet). Reuse the module-level GRAPH_BASE from the plugin (line ~466).
  const result = await graphPost(
    `${GRAPH_BASE}/${body.phoneNumberId}/messages`,
    graphBody,
    token,
    fetchImpl,
  );
  if (!result.ok) {
    return reply.code(result.httpStatus).send({
      error: { code: result.code, message: result.message, retryable: isRetryable(result.code) },
    });
  }
  const data = result.data as { messages?: Array<{ id?: string }> };
  const messageId = data.messages?.[0]?.id;
  if (!messageId) {
    return reply.code(502).send({
      error: {
        code: "WHATSAPP_NO_MESSAGE_ID",
        message: "Graph accepted the message but did not return an ID",
        retryable: true,
      },
    });
  }

  const sentAt = new Date();
  await app.prisma!.whatsAppTestSend.create({
    data: {
      organizationId: orgId,
      managedChannelId: channel.id,
      messageId,
      phoneNumberId: body.phoneNumberId,
      templateName: body.templateName,
      languageCode: body.languageCode,
      toNumber: body.toNumber,
      sentBy,
      sentAt,
      apiStatus: "sent",
    },
  });
  return reply.code(200).send({ messageId, status: "sent", sentAt: sentAt.toISOString() });
});
```

- [ ] **Step 3: Run, pass.**

### 6b — Allowlist rejection

- [ ] **Step 1: Failing test** — `testRecipients: ["+15550000000"]`, request `toNumber: "+15551234567"` → 403 `WHATSAPP_RECIPIENT_NOT_ALLOWLISTED`; `graphFetch` never called.

- [ ] **Step 2: Run — should pass** (handler already enforces).

### 6c — Template-not-approved rejection

- [ ] **Step 1: Failing test** — channel allowlist + connection OK, Graph templates returns `[{ name: "appt_reminder", status: "PENDING", language: "en_US" }]` → 400 `WHATSAPP_TEMPLATE_NOT_APPROVED`; only ONE Graph call (the templates fetch, NOT `/messages`).

- [ ] **Step 2: Run, pass.**

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(api): POST /send-test — happy path + allowlist + APPROVED-template precheck"
```

---

## Task 7 — Graph error mapping

**File:** `apps/api/src/routes/__tests__/whatsapp-send-test.test.ts`

- [ ] **Step 1: Add error path tests** asserting the handler maps Graph errors correctly:
  - Graph returns HTTP 429 → response 429, `error.code === "WHATSAPP_RATE_LIMITED"`, `error.retryable === true`.
  - Graph returns `messages: []` (no id) → response 502, `error.code === "WHATSAPP_NO_MESSAGE_ID"`.
  - Each test stubs `graphFetch` to return APPROVED templates first, then the error/no-id response.

- [ ] **Step 2: Run, pass.**

- [ ] **Step 3: Commit**

```bash
git commit -am "test(api): /send-test Graph error mapping coverage"
```

---

## Task 8 — GET /test-sends

**Files:**

- Modify: `apps/api/src/routes/whatsapp-send-test.ts`
- Modify: `apps/api/src/routes/__tests__/whatsapp-send-test.test.ts`

- [ ] **Step 1: Failing test** — `prisma.whatsAppTestSend.findMany` returns one row with `apiStatus: "sent"`, `lastWebhookStatus: "delivered"`, `lastWebhookAt: <Date>`. Request `GET /test-sends`. Assert:
  - status 200; body `{ tests: [{ apiStatus: "sent", lastWebhookStatus: "delivered", ... }] }`
  - prisma called with `{ where: { organizationId: "org_test" }, orderBy: { sentAt: "desc" }, take: 10 }`
  - `sentAt` + `lastWebhookAt` serialized as ISO strings

- [ ] **Step 2: Replace the `/test-sends` stub:**

```typescript
app.get("/test-sends", async (request, reply) => {
  const orgId = (request as unknown as { organizationIdFromAuth: string }).organizationIdFromAuth;
  const rows = await app.prisma!.whatsAppTestSend.findMany({
    where: { organizationId: orgId },
    orderBy: { sentAt: "desc" },
    take: 10,
  });
  const tests = rows.map((r) => ({
    id: r.id,
    messageId: r.messageId,
    phoneNumberId: r.phoneNumberId,
    templateName: r.templateName,
    languageCode: r.languageCode,
    toNumber: r.toNumber,
    sentBy: r.sentBy,
    sentAt: r.sentAt.toISOString(),
    apiStatus: r.apiStatus,
    lastWebhookStatus: r.lastWebhookStatus,
    lastWebhookAt: r.lastWebhookAt ? r.lastWebhookAt.toISOString() : null,
  }));
  return reply.send({ tests });
});
```

- [ ] **Step 3: Run, pass, commit**

```bash
git commit -am "feat(api): GET /test-sends — paginated recent test sends (limit 10)"
```

---

## Task 9 — Register API plugin

**File:** `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1:** Add import + register call alongside the existing `whatsappManagementRoutes` registration:

```typescript
import { whatsappSendTestRoutes } from "../routes/whatsapp-send-test.js";

await app.register(whatsappSendTestRoutes, { prefix: "/api/dashboard/whatsapp" });
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @switchboard/api typecheck
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(api): register whatsappSendTestRoutes under /api/dashboard/whatsapp"
```

---

## Task 10 — Webhook back-channel: bridge module + wire into apps/chat/main.ts

**Files:**

- Create: `apps/chat/src/bridges/whatsapp-test-send-status-bridge.ts`
- Create: `apps/chat/src/__tests__/whatsapp-test-send-status.test.ts`
- Modify: `apps/chat/src/main.ts` — wire `onStatusUpdate` **using the existing store/dependency construction pattern in this file**. Only instantiate `PrismaWhatsAppTestSendStore` directly if adjacent stores are already instantiated directly. If `main.ts` uses a factory/registry pattern, register the new store through the same factory.

- [ ] **Step 1: Failing tests for the bridge** — assert:
  - When called with status `"delivered"` + a timestamp, the bridge calls `testSendStore.updateWebhookStatus({ messageId, status: "delivered", at: <timestamp> })`.
  - When called with an unknown status (e.g., `"weird"`), the bridge does not throw and does not call the store.

- [ ] **Step 2: Implement bridge** — create `apps/chat/src/bridges/whatsapp-test-send-status-bridge.ts`:

```typescript
import type { PrismaWhatsAppTestSendStore, WebhookStatus } from "@switchboard/db";

const ACCEPTED: ReadonlySet<WebhookStatus> = new Set(["sent", "delivered", "read", "failed"]);

interface BridgeDeps {
  testSendStore: PrismaWhatsAppTestSendStore;
}

export interface StatusUpdate {
  messageId: string;
  recipientId: string;
  status: string;
  timestamp: Date;
}

export function buildWhatsAppStatusBridge(deps: BridgeDeps) {
  return {
    async onStatusUpdate(update: StatusUpdate, _orgId: string): Promise<void> {
      if (!ACCEPTED.has(update.status as WebhookStatus)) return;
      await deps.testSendStore.updateWebhookStatus({
        messageId: update.messageId,
        status: update.status as WebhookStatus,
        at: update.timestamp,
      });
    },
  };
}
```

- [ ] **Step 3: Run, pass**

```bash
pnpm --filter @switchboard/chat test -- whatsapp-test-send-status
```

- [ ] **Step 4: Wire into `apps/chat/src/main.ts`** — read the existing `registerManagedWebhookRoutes` call. Identify how `failedMessageStore` and other adjacent stores are constructed. Follow that pattern.

Two acceptable shapes:

**Shape A — direct instantiation** (if `failedMessageStore = new FailedMessageStore(prisma)` is in scope):

```typescript
import { PrismaWhatsAppTestSendStore } from "@switchboard/db";
import { buildWhatsAppStatusBridge } from "./bridges/whatsapp-test-send-status-bridge.js";

const testSendStore = new PrismaWhatsAppTestSendStore(prisma);
const statusBridge = buildWhatsAppStatusBridge({ testSendStore });

registerManagedWebhookRoutes(app, {
  registry,
  failedMessageStore,
  ctwaAdapter,
  dedup: { checkDedup },
  onStatusUpdate: (update, orgId) => statusBridge.onStatusUpdate(update, orgId),
});
```

**Shape B — registry/factory**: register `PrismaWhatsAppTestSendStore` through the existing registry, then build the bridge from the resolved instance. Do not introduce a new pattern.

Also confirm the `StatusUpdate` interface shape matches what `apps/chat/src/adapters/whatsapp.ts` `parseStatusUpdate()` returns. Adapt the bridge's interface (not the adapter's output) if field names differ.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @switchboard/chat typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/bridges/ apps/chat/src/__tests__/whatsapp-test-send-status.test.ts apps/chat/src/main.ts
git commit -m "feat(chat): wire onStatusUpdate → WhatsAppTestSend via bridge (slice 2a)"
```

---

## Task 11 — End-to-end verification (backend only)

- [ ] **Step 1:** Full typecheck

```bash
pnpm typecheck
```

- [ ] **Step 2:** Full test suite

```bash
pnpm test
```

Pre-existing flake to ignore: `prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` `pg_advisory_xact_lock void` (per `feedback_db_integrity_tests_pg_advisory_lock.md`).

- [ ] **Step 3: Drift check**

```bash
pnpm db:check-drift
```

- [ ] **Step 4: Open PR**

```bash
git push -u origin <branch-name>
gh pr create --base main \
  --title "feat(whatsapp): Slice 2A — backend send-test (whatsapp_business_messaging proof)" \
  --body "<see PR body template in plan body — references Slice 2A scope, allowlist SQL seeding, out-of-scope list>"
```

The PR body must include the SQL snippet for seeding `testRecipients` (admin-only, no UI in 2A) and state explicitly: "Slice 2B (dashboard) is a follow-up PR."
