# Hardening Round 2 — PR4: Webhook Persistence + Chat Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-memory webhook storage with Prisma, fix chat ingress error collapsing, and remove the single-tenant in-memory chat path.

**Architecture:** Three independent fixes. May split into separate PRs if webhook persistence is large.

**Tech Stack:** TypeScript, Prisma, Fastify, Vitest

**Spec:** `docs/superpowers/specs/2026-04-22-hardening-round2-design.md`

---

### Task 1: Add WebhookRegistration Prisma model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/stores/prisma-webhook-store.ts`

- [ ] **Step 1: Add schema model**

In `packages/db/prisma/schema.prisma`:

```prisma
model WebhookRegistration {
  id             String   @id @default(uuid())
  organizationId String
  url            String
  events         String[]
  secret         String?
  isActive       Boolean  @default(true)
  lastDeliveryAt DateTime?
  lastStatus     String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([organizationId])
}
```

- [ ] **Step 2: Generate Prisma client**

Run: `npx pnpm@9.15.4 db:generate`

- [ ] **Step 3: Create migration**

Run: `npx pnpm@9.15.4 db:migrate -- --name add_webhook_registration`

- [ ] **Step 4: Write the Prisma store**

```typescript
import type { PrismaClient } from "@prisma/client";

export interface WebhookRegistrationData {
  id: string;
  organizationId: string;
  url: string;
  events: string[];
  secret: string | null;
  isActive: boolean;
  lastDeliveryAt: Date | null;
  lastStatus: string | null;
  createdAt: Date;
}

export class PrismaWebhookStore {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    organizationId: string;
    url: string;
    events: string[];
    secret?: string;
  }): Promise<WebhookRegistrationData> {
    return this.prisma.webhookRegistration.create({
      data: {
        organizationId: data.organizationId,
        url: data.url,
        events: data.events,
        secret: data.secret ?? null,
      },
    });
  }

  async list(organizationId: string): Promise<WebhookRegistrationData[]> {
    return this.prisma.webhookRegistration.findMany({
      where: { organizationId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getById(id: string): Promise<WebhookRegistrationData | null> {
    return this.prisma.webhookRegistration.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.webhookRegistration.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async updateDeliveryStatus(id: string, status: string): Promise<void> {
    await this.prisma.webhookRegistration.update({
      where: { id },
      data: { lastDeliveryAt: new Date(), lastStatus: status },
    });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add WebhookRegistration Prisma model and store

Replaces in-memory Map with durable database storage. Supports
create, list, soft-delete, and delivery status tracking.
EOF
)"
```

---

### Task 2: Rewire webhooks.ts to use Prisma store

**Files:**

- Modify: `apps/api/src/routes/webhooks.ts`
- Modify: `apps/api/src/__tests__/api-webhooks.test.ts`

- [ ] **Step 1: Replace in-memory Map with PrismaWebhookStore**

Remove `const webhookStore = new Map<string, WebhookRegistration>()` and all Map operations. Replace with calls to `app.prisma.webhookRegistration` (or inject a `PrismaWebhookStore` instance).

- [ ] **Step 2: Update tests to use database**

Update `apps/api/src/__tests__/api-webhooks.test.ts` to work with the Prisma-backed store instead of the in-memory Map.

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run -t "webhook"`

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: migrate webhook routes to Prisma-backed storage

Registrations survive restarts and work across horizontally scaled
instances. Soft-delete preserves history.
EOF
)"
```

---

### Task 3: Fix chat ingress error collapsing

**Files:**

- Modify: `apps/chat/src/gateway/http-platform-ingress-adapter.ts`

- [ ] **Step 1: Write test for error type preservation**

```typescript
it("distinguishes upstream errors from validation failures", async () => {
  // Mock a 500 response from the API
  // Verify the adapter returns type: "upstream_error" with retryable: true
  // Mock a 400 response from the API
  // Verify the adapter returns type: "validation_failed" with retryable: false
});
```

- [ ] **Step 2: Add typed failure responses**

Replace the generic `type: "validation_failed"` for all errors. Create a discriminated union:

```typescript
type IngressFailure =
  | { type: "validation_failed"; message: string; retryable: false }
  | { type: "upstream_error"; message: string; retryable: true; statusCode: number }
  | { type: "network_error"; message: string; retryable: true };
```

Map HTTP 4xx to `validation_failed`, 5xx to `upstream_error`, network/DNS errors to `network_error`.

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run`

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: preserve typed failure classes in chat ingress adapter

HTTP 5xx → upstream_error (retryable), 4xx → validation_failed,
network → network_error (retryable). No more generic collapse.
EOF
)"
```

---

### Task 4: Remove single-tenant in-memory chat path

**Files:**

- Modify: `apps/chat/src/main.ts`

- [ ] **Step 1: Sweep references to StaticDeploymentResolver and InMemoryGatewayConversationStore**

Verify they're only used in the single-tenant path of `main.ts`.

- [ ] **Step 2: Remove the single-tenant gateway construction**

Delete the `StaticDeploymentResolver` + `InMemoryGatewayConversationStore` path (lines 58-66 in main.ts). Keep only the managed/DB-backed path.

- [ ] **Step 3: Update Telegram webhook to use managed gateway**

If the Telegram webhook (line 157) uses `singleTenantGateway`, rewire it to use the managed gateway.

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run`

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: remove single-tenant in-memory chat path

Keep only the managed/DB-backed deployment path. Single-tenant
mode with StaticDeploymentResolver was causing deployment mode
ambiguity.
EOF
)"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx pnpm@9.15.4 test`

- [ ] **Step 2: Run typecheck + lint**

Run: `npx pnpm@9.15.4 typecheck && npx pnpm@9.15.4 lint`

- [ ] **Step 3: Create PR**

```bash
git checkout -b fix/hardening-round2-pr4-webhooks-chat
git push -u origin fix/hardening-round2-pr4-webhooks-chat
```
