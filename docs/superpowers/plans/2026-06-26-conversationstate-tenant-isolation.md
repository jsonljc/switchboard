# ConversationState cross-tenant isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute INLINE — this is one atomic schema change rippling across packages/db, packages/core, apps/chat, apps/api; a partial constraint change is unsafe, so the whole thing lands as one green PR.

**Goal:** Make `ConversationState` per-org unique and scope every reader/writer by `organizationId`, so a phone shared across two orgs gets isolated `human_override` state (no cross-tenant read leak, no write-collision DoS).

**Architecture:** Swap `threadId @unique` → `@@unique([organizationId, threadId])` (nullable-compound). Route both status-write adapters through one `setConversationStatusScoped()` helper in `packages/db`. Add a required `organizationId` param to the write interfaces (compiler forces every caller to scope). Read path switches `findUnique`→`findFirst` with org. Legacy null-org rows left inert.

**Tech Stack:** Prisma 6.19 (compound-unique selector), Vitest (real-PG tier gated on `DATABASE_URL`), pnpm/Turbo monorepo.

## Global Constraints

- ESM only; `.js` extensions in relative imports. No `any`. No `console.log`.
- Prettier: semi, double quotes, 2-space, trailing commas, 100 width.
- Conventional Commits, **lowercase subject** (commitlint).
- Schema change requires the migration in the SAME commit; `pnpm db:check-drift` clean.
- Prisma CLI needs `DATABASE_URL` exported from the worktree-root `.env`:
  `export DATABASE_URL="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' .env | tr -d '"' | tr -d "'")"`
- Pre-commit runs eslint+prettier only → run `pnpm --filter <pkg> exec tsc --noEmit` per touched package before committing.
- New write param order: `setConversationStatus(sessionId, organizationId, status, upsertContext?)`.

---

### Task 1: RED — headline cross-tenant isolation integration test

**Files:**

- Create: `packages/db/src/stores/__tests__/conversation-state-isolation.integration.test.ts`
  (moved from `apps/api` during execution — importing the chat read class across apps
  violates `rootDir`; the test exercises the helper + replicates the gateway `findFirst`)

**Interfaces:**

- Consumes (must exist after Task 2): `setConversationStatusScoped(prisma, { sessionId, organizationId, status, upsertContext? })` from `@switchboard/db`; `PrismaGatewayConversationStore.getConversationStatus(sessionId, organizationId)`.

- [ ] **Step 1: Write the failing test** (real PG, two orgs share one phone)

```ts
import { describe, it, expect } from "vitest";
import { PrismaClient, setConversationStatusScoped } from "@switchboard/db";
import { PrismaGatewayConversationStore } from "../../../chat/src/gateway/gateway-conversation-store.js";

// Cross-tenant isolation for ConversationState (adversarial audit #2). Two orgs
// share one phone (sessionId). Org A's human_override must NOT leak into org B's
// gateway read, and org B's status write must NOT clobber org A's row.
describe.skipIf(!process.env["DATABASE_URL"])(
  "ConversationState tenant isolation (integration)",
  () => {
    it("isolates human_override across two orgs sharing one phone", async () => {
      const prisma = new PrismaClient();
      const phone = `+6590000${Math.floor(Math.random() * 1e6)}`;
      const orgA = `orgA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orgB = `orgB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        // Org A pauses (human_override) on the shared phone.
        await setConversationStatusScoped(prisma, {
          sessionId: phone,
          organizationId: orgA,
          status: "human_override",
          upsertContext: { channel: "whatsapp", principalId: phone },
        });

        // Org B's gateway reads status for the same phone → must be null (NOT paused).
        const store = new PrismaGatewayConversationStore(prisma);
        expect(await store.getConversationStatus(phone, orgB)).toBeNull();

        // Org B writes its own status → creates a distinct row, does NOT clobber A.
        await setConversationStatusScoped(prisma, {
          sessionId: phone,
          organizationId: orgB,
          status: "active",
          upsertContext: { channel: "whatsapp", principalId: phone },
        });

        // Org A still paused; org B active; two distinct rows.
        expect(await store.getConversationStatus(phone, orgA)).toBe("human_override");
        expect(await store.getConversationStatus(phone, orgB)).toBe("active");
        const rows = await prisma.conversationState.findMany({ where: { threadId: phone } });
        expect(rows).toHaveLength(2);
      } finally {
        await prisma.conversationState.deleteMany({ where: { threadId: phone } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);
```

- [ ] **Step 2: Run → verify RED** (compile error: `setConversationStatusScoped` not exported; `getConversationStatus` arity). That is the expected RED.

```bash
export DATABASE_URL="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' .env | tr -d '"' | tr -d "'")"
pnpm --filter @switchboard/api exec vitest run src/__tests__/conversation-state-isolation.integration.test.ts
```

Expected: FAIL (unresolved import / type error).

---

### Task 2: GREEN — schema, migration, helper, read + write scoping (atomic)

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (`ConversationState` block)
- Create: `packages/db/prisma/migrations/<ts>_conversationstate_per_org_unique/migration.sql`
- Create: `packages/db/src/stores/set-conversation-status-scoped.ts` (+ barrel export in `packages/db/src/index.ts`)
- Create: `packages/db/src/stores/__tests__/set-conversation-status-scoped.test.ts`
- Modify: `packages/core/src/channel-gateway/types.ts` (`getConversationStatus?` + `GatewayConversationStatusSetter`)
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts:51,248` (pass `resolved.organizationId`)
- Modify: `packages/core/src/channel-gateway/pre-input-gate.ts:166,326` (pass `organizationId`)
- Modify: `packages/core/src/consent/consent-service.ts:281` (pass `effectiveOrgId`)
- Modify: `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts:37,186,284` (interface + pass `orgId`)
- Modify: `packages/core/src/skill-runtime/hooks/claim-classifier.ts:369,419` (pass `ctx.orgId`)
- Modify: `packages/core/src/skill-runtime/hooks/price-claim-gate.ts:153` (pass `ctx.orgId`)
- Modify: `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts:184` (pass `ctx.orgId`)
- Modify: `apps/chat/src/gateway/gateway-conversation-store.ts:110` (read → findFirst + org)
- Modify: `apps/chat/src/gateway/gateway-bridge.ts:194` (adapter → helper)
- Modify: `apps/chat/src/conversation/prisma-store.ts:53,63` (save → compound key)
- Modify: `apps/api/src/bootstrap/skill-mode.ts:237` (adapter → helper)
- Modify: `apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts` (read unit test → findFirst+org)

**Interfaces:**

- Produces: `setConversationStatusScoped(prisma, { sessionId: string; organizationId: string; status: string; upsertContext?: { channel: string; principalId: string } }): Promise<void>`.
- Produces: `GatewayConversationStore.getConversationStatus?(sessionId: string, organizationId: string): Promise<string | null>`.
- Produces: write interfaces `setConversationStatus(sessionId: string, organizationId: string, status: string, upsertContext?: ConversationStatusUpsertContext): Promise<void>`.

- [ ] **Step 1: Schema** — in `packages/db/prisma/schema.prisma` `ConversationState`: change `threadId String @unique` → `threadId String`; remove `@@index([organizationId])`; add `@@unique([organizationId, threadId])`.

- [ ] **Step 2: Generate migration + client**

```bash
export DATABASE_URL="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' .env | tr -d '"' | tr -d "'")"
cd packages/db && pnpm exec prisma migrate dev --name conversationstate_per_org_unique && cd ../..
```

Then edit `migration.sql` to add the single-org backfill (Fork 2, REVISED post-review): derive `organizationId` for legacy null-org rows from the gateway's org-stamped `ConversationThread` (same `sessionId`), single-org-only so it never misassigns; un-derivable rows stay null (NULLS-distinct harmless; TTL reaps). Document it in the SQL.

- [ ] **Step 3: Helper** — create `set-conversation-status-scoped.ts` (compound upsert when `upsertContext`, else org-scoped `updateMany`); export from `index.ts`. 30-day TTL on create.

- [ ] **Step 4: Helper unit test** (mock Prisma) — asserts upsert uses `{ organizationId_threadId: { organizationId, threadId } }` and create carries org; updateMany where includes `organizationId`.

- [ ] **Step 5: Read** — `gateway-conversation-store.ts` `getConversationStatus(sessionId, organizationId)` → `findFirst({ where: { threadId: sessionId, organizationId }, select: { status: true } })`. Update interface in `types.ts`. Update both `channel-gateway.ts` callers to pass `resolved.organizationId`.

- [ ] **Step 6: Write interfaces + callers** — add required `organizationId` to both `setConversationStatus` interfaces; update all 9 caller sites (org already in scope per spec).

- [ ] **Step 7: Adapters** — `gateway-bridge.ts` and `skill-mode.ts` delegate to `setConversationStatusScoped` (org from new param).

- [ ] **Step 8: save()** — `prisma-store.ts`: sticky read `findUnique`→`findFirst({ where: { threadId, organizationId }, select: { status: true } })`; upsert where → `{ organizationId_threadId: { organizationId: state.organizationId, threadId: state.threadId } }`.

- [ ] **Step 9: Update read unit test** — `gateway-conversation-store.test.ts`: mock `conversationState.findFirst`; pass org to `getConversationStatus`; assert findFirst args `{ where: { threadId, organizationId }, select: { status: true } }`.

- [ ] **Step 10: Regenerate + per-package typecheck**

```bash
pnpm db:generate
pnpm --filter @switchboard/db exec tsc --noEmit
pnpm --filter @switchboard/core exec tsc --noEmit
pnpm --filter @switchboard/chat exec tsc --noEmit
pnpm --filter @switchboard/api exec tsc --noEmit
```

Expected: all clean. (Rebuild lower `dist` if core/db edits aren't picked up: `pnpm --filter @switchboard/core --filter @switchboard/db build`.)

- [ ] **Step 11: Run the headline integration test → GREEN**

```bash
export DATABASE_URL="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' .env | tr -d '"' | tr -d "'")"
pnpm --filter @switchboard/api exec vitest run src/__tests__/conversation-state-isolation.integration.test.ts
pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/set-conversation-status-scoped.test.ts
pnpm --filter @switchboard/chat exec vitest run src/gateway/__tests__/gateway-conversation-store.test.ts
```

Expected: all PASS.

---

### Task 3: Verify — regression suites + drift + lint, then commit

- [ ] **Step 1: Affected package test suites** (catch hook-caller + override-race fallout)

```bash
export DATABASE_URL="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' .env | tr -d '"' | tr -d "'")"
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/chat test
pnpm --filter @switchboard/api test
```

Expected: green (fix any call-arg assertions broken by the new param).

- [ ] **Step 2: Erasure integration unchanged**

```bash
pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/prisma-contact-store-erasure.integration.test.ts
```

Expected: PASS (no PDPA-purge regression).

- [ ] **Step 3: Drift + lint**

```bash
pnpm db:check-drift
pnpm --filter @switchboard/db --filter @switchboard/core --filter @switchboard/chat --filter @switchboard/api lint
```

Expected: no drift; lint clean.

- [ ] **Step 4: Commit** (schema + migration + code + tests together)

```bash
git add -A
git commit -m "fix(db,core,chat,api): scope ConversationState by org (per-org unique + scoped read/write)"
```

---

### Task 4: Review, PR, merge, prune

- [ ] Dispatch reviewer(s) via superpowers:requesting-code-review; fix Critical/Important before merge.
- [ ] Push branch; open PR to `main` with a body explaining the constraint swap + the single-org null-org backfill (Fork 2).
- [ ] Verify required CI checks (typecheck/lint/test/security) green via `gh pr checks`.
- [ ] Squash-merge; `git worktree remove` + branch prune.
- [ ] Mark `project_adversarial_audit_2026_06_26` memory note COMPLETE.

## Self-Review

- **Spec coverage:** schema/migration (T2.1-2), null-org doc (T2.2), helper+consistency (T2.3-4, T2.7), read scoping (T2.5), write interface+callers (T2.6), save() seam (T2.8), already-correct verified (no task — verification only), tests (T1, T2.4/9/11, T3). All spec sections mapped.
- **Placeholder scan:** none — every code step shows exact code or exact command.
- **Type consistency:** `setConversationStatusScoped` signature and `getConversationStatus(sessionId, organizationId)` arity consistent across T1 (consumer) and T2 (producer); param order `(sessionId, organizationId, status, upsertContext?)` consistent T2.6/7.
