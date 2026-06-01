# Alex Governed Follow-Up Capability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Alex schedule a WhatsApp follow-up for a hesitant/dormant lead, and have a firing worker send it when due — but only when PDPA consent, the WhatsApp 24h window/opt-in, and template approval all allow, and only through `PlatformIngress.submit()`.

**Architecture:** A dedicated `ScheduledFollowUp` queue table (producer = a new `follow-up` skill tool Alex calls; consumer = a new Inngest cron). The cron never sends directly: it submits a governed `conversation.followup.send` `WorkflowMode` handler (modeled on `meta.lead.greeting.send`) that applies a single-sourced `evaluateProactiveSendEligibility` gate at the mutation site and POSTs an approved WhatsApp template. Fails closed — every re-engagement template is `draft`+`marketing` today, so it records a skip reason and sends nothing until Meta approval + a marketing flag.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo), Prisma/PostgreSQL, Inngest crons, Vitest. Reference spec: `docs/superpowers/specs/2026-06-01-alex-governed-followup-design.md`.

**Conventions (apply to every task):** ESM with `.js` on all relative imports; `@switchboard/*` package specifiers carry NO extension; double quotes, semicolons, 2-space indent, trailing commas, 100-char width (Prettier); no `any` (use `unknown`); no `console.log`; unused vars `_`-prefixed; commitlint subject must start lowercase; every new module needs a co-located `*.test.ts`; CI has no Postgres (mock Prisma in tests). Run on the existing branch `docs/alex-governed-followup` (spec already committed there) **or** a fresh implementation branch off `main` once the spec PR lands — confirm at execution time per the branch doctrine.

**Idempotency model (note vs spec §6):** The plan relies on four layers — `dedupeKey` UNIQUE (schedule time) + Inngest `step.run` memoization (within a run) + the ingress `idempotencyKey` replay-guard `followup-send:${id}` (across overlapping runs, the canonical D1 claim-first primitive) + terminal status flip (`pending → sent|skipped|failed`). This intentionally **replaces the spec's separate `sending` claim-CAS** with the stronger ingress idempotency, which prevents double-sends across runs and avoids a stuck-`sending` row if the worker crashes mid-send.

---

## File Structure

**Create:**

- `packages/schemas/src/scheduled-follow-up.ts` — Zod enums + types (reasons, delays, skip reasons, record).
- `packages/core/src/scheduled-follow-up/scheduled-follow-up-store.ts` — `ScheduledFollowUpStore` interface + record types (core seam).
- `packages/core/src/notifications/whatsapp-window.ts` — promoted pure 24h-window/opt-in helpers.
- `packages/core/src/notifications/proactive-eligibility.ts` — the single-sourced consent+window+template gate.
- `packages/core/src/skill-runtime/tools/schedule-follow-up.ts` — the `follow-up` skill tool.
- `packages/db/src/stores/prisma-scheduled-follow-up-store.ts` — Prisma store impl.
- `apps/api/src/services/workflows/conversation-followup-send-workflow.ts` — the governed send handler.
- `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts` — the firing cron.
- Co-located `*.test.ts` for each of the above (cron + workflow tests live in `__tests__/`).

**Modify:**

- `packages/schemas/src/index.ts`, `packages/core/src/skill-runtime/tools/index.ts`, the `@switchboard/core` export barrels (for the new core modules), `packages/db/src/index.ts` — barrel exports.
- `packages/db/prisma/schema.prisma` + a new migration dir — the `ScheduledFollowUp` model.
- `apps/chat/src/adapters/whatsapp.ts` — re-export the promoted window helpers.
- `apps/api/src/bootstrap/skill-mode.ts` — register the tool (4 sites).
- `apps/api/src/bootstrap/contained-workflows.ts` — register the send handler + intent + the `submitScheduledFollowUp` closure.
- `apps/api/src/bootstrap/inngest.ts` + `apps/api/src/app.ts` — register the cron + thread the submit closure (mirror `instantFormAdapter`).
- `skills/alex/SKILL.md` — declare the tool + add a usage instruction.
- `scripts/env-allowlist.local-readiness.json` — add `FOLLOWUP_ALLOW_MARKETING_TEMPLATE`.

---

## Task 1: Schemas — `scheduled-follow-up.ts` types

**Files:**

- Create: `packages/schemas/src/scheduled-follow-up.ts`
- Test: `packages/schemas/src/scheduled-follow-up.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/src/scheduled-follow-up.test.ts
import { describe, it, expect } from "vitest";
import {
  FollowUpReasonSchema,
  FollowUpDelaySchema,
  ProactiveSkipReasonSchema,
  FOLLOW_UP_DELAY_MS,
} from "./scheduled-follow-up.js";

describe("scheduled-follow-up schemas", () => {
  it("accepts the documented follow-up reasons", () => {
    expect(FollowUpReasonSchema.parse("hesitation")).toBe("hesitation");
    expect(() => FollowUpReasonSchema.parse("nope")).toThrow();
  });

  it("maps each delay enum to a positive millisecond offset", () => {
    for (const delay of FollowUpDelaySchema.options) {
      expect(FOLLOW_UP_DELAY_MS[delay]).toBeGreaterThan(0);
    }
    expect(FOLLOW_UP_DELAY_MS.in_1_day).toBe(24 * 60 * 60 * 1000);
    expect(FOLLOW_UP_DELAY_MS.in_1_week).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("enumerates every skip reason the gate can return", () => {
    expect(ProactiveSkipReasonSchema.parse("template_not_approved")).toBe("template_not_approved");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found).

Run: `pnpm --filter @switchboard/schemas test scheduled-follow-up`
Expected: FAIL — `Cannot find module './scheduled-follow-up.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/schemas/src/scheduled-follow-up.ts
import { z } from "zod";

/** Why Alex scheduled a follow-up (drives WorkTrace evidence + future analytics). */
export const FollowUpReasonSchema = z.enum([
  "hesitation",
  "price_concern",
  "timing_not_now",
  "awaiting_info",
  "went_quiet",
]);
export type FollowUpReason = z.infer<typeof FollowUpReasonSchema>;

/** Coarse cadence the model picks; the server maps it to a concrete dueAt. */
export const FollowUpDelaySchema = z.enum(["in_1_day", "in_3_days", "in_1_week"]);
export type FollowUpDelay = z.infer<typeof FollowUpDelaySchema>;

/** Millisecond offset applied to "now" for each delay. */
export const FOLLOW_UP_DELAY_MS: Record<FollowUpDelay, number> = {
  in_1_day: 24 * 60 * 60 * 1000,
  in_3_days: 3 * 24 * 60 * 60 * 1000,
  in_1_week: 7 * 24 * 60 * 60 * 1000,
};

/** Lifecycle of a queued follow-up. */
export const ScheduledFollowUpStatusSchema = z.enum([
  "pending",
  "sent",
  "skipped",
  "failed",
  "cancelled",
]);
export type ScheduledFollowUpStatus = z.infer<typeof ScheduledFollowUpStatusSchema>;

/** Why a due follow-up was not sent (recorded, never silent). */
export const ProactiveSkipReasonSchema = z.enum([
  "consent_pending",
  "consent_revoked",
  "no_optin",
  "no_template",
  "template_not_approved",
  "marketing_blocked",
  "unsupported_channel",
]);
export type ProactiveSkipReason = z.infer<typeof ProactiveSkipReasonSchema>;
```

- [ ] **Step 4: Add the barrel export**

In `packages/schemas/src/index.ts`, append next to the other exports:

```ts
// Scheduled follow-up types
export * from "./scheduled-follow-up.js";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `pnpm --filter @switchboard/schemas test scheduled-follow-up`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/scheduled-follow-up.ts packages/schemas/src/scheduled-follow-up.test.ts packages/schemas/src/index.ts
git commit -m "feat(followup): add scheduled-follow-up schema types"
```

---

## Task 2: Prisma model + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (append after the `PendingLeadRetry` model, which closes at line ~2026)
- Create: `packages/db/prisma/migrations/20260601120000_add_scheduled_follow_up/migration.sql`

- [ ] **Step 1: Add the model**

Append to `packages/db/prisma/schema.prisma` immediately after the `PendingLeadRetry` block (uuid id convention, matching the queue-model region):

```prisma
// ---------------------------------------------------------------------------
// ScheduledFollowUp — Alex-scheduled re-engagement nudges, fired by the
// scheduled-follow-up-dispatch cron through PlatformIngress.submit. Modeled on
// PendingLeadRetry. See docs/superpowers/specs/2026-06-01-alex-governed-followup-design.md
// ---------------------------------------------------------------------------

model ScheduledFollowUp {
  id                   String    @id @default(uuid())
  organizationId       String
  contactId            String
  conversationThreadId String?
  sessionId            String?
  deploymentId         String?
  workUnitId           String?
  channel              String
  jurisdiction         String?
  reason               String
  templateIntentClass  String
  dueAt                DateTime
  status               String    @default("pending")
  attempts             Int       @default(0)
  dedupeKey            String    @unique
  skipReason           String?
  lastError            String?
  nextRetryAt          DateTime?
  sentAt               DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([status, dueAt])
  @@index([organizationId, contactId])
}
```

- [ ] **Step 2: Hand-write the migration**

Create `packages/db/prisma/migrations/20260601120000_add_scheduled_follow_up/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "ScheduledFollowUp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationThreadId" TEXT,
    "sessionId" TEXT,
    "deploymentId" TEXT,
    "workUnitId" TEXT,
    "channel" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "reason" TEXT NOT NULL,
    "templateIntentClass" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT NOT NULL,
    "skipReason" TEXT,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledFollowUp_dedupeKey_key" ON "ScheduledFollowUp"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledFollowUp_status_dueAt_idx" ON "ScheduledFollowUp"("status", "dueAt");

-- CreateIndex
CREATE INDEX "ScheduledFollowUp_organizationId_contactId_idx" ON "ScheduledFollowUp"("organizationId", "contactId");
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm db:generate`
Expected: client regenerates with the `scheduledFollowUp` delegate. (If a later task's typecheck reports the model unknown, re-run `pnpm reset`.)

- [ ] **Step 4: Verify no drift (requires local Postgres)**

Run: `pnpm db:check-drift`
Expected: no drift — the hand-written SQL matches what Prisma would generate (index names match the `@@index`/`@unique` derivations and are under the 63-char cap). If drift is reported, reconcile the SQL to the diff.

- [ ] **Step 5: Commit** (schema + migration together, per CLAUDE.md)

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260601120000_add_scheduled_follow_up/
git commit -m "feat(followup): add ScheduledFollowUp model + migration"
```

---

## Task 3: Core store interface + Prisma store

**Files:**

- Create: `packages/core/src/scheduled-follow-up/scheduled-follow-up-store.ts`
- Create: `packages/db/src/stores/prisma-scheduled-follow-up-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-scheduled-follow-up-store.test.ts`
- Modify: the `@switchboard/core` barrel that re-exports `src/scheduled-follow-up/*`, and `packages/db/src/index.ts`

- [ ] **Step 1: Define the core store interface**

```ts
// packages/core/src/scheduled-follow-up/scheduled-follow-up-store.ts

/** Input to enqueue a follow-up. */
export interface CreateScheduledFollowUpInput {
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  sessionId: string | null;
  deploymentId: string | null;
  workUnitId: string | null;
  channel: string;
  jurisdiction: string | null;
  reason: string;
  templateIntentClass: string;
  dueAt: Date;
  dedupeKey: string;
}

/** Minimal projection the firing cron needs per due row. */
export interface DueScheduledFollowUp {
  id: string;
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  channel: string;
  templateIntentClass: string;
  reason: string;
  attempts: number;
}

/**
 * Durable queue for Alex-scheduled re-engagement nudges. Implemented in
 * @switchboard/db. The firing cron is the only consumer; the schedule tool is
 * the only producer.
 */
export interface ScheduledFollowUpStore {
  create(input: CreateScheduledFollowUpInput): Promise<{ id: string }>;
  /** ≤1 pending follow-up per contact (the schedule-time rate guard). */
  findPendingForContact(organizationId: string, contactId: string): Promise<{ id: string } | null>;
  findDue(now: Date, limit: number): Promise<DueScheduledFollowUp[]>;
  markSent(id: string): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  /** nextRetryAt set → re-queues (status back to pending); null → terminal failed. */
  markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void>;
}
```

- [ ] **Step 2: Export it from the core barrel**

Add a barrel for the new directory and re-export it from the `@switchboard/core` entrypoint that the other layers import (mirror how `consent/consent-store.ts` is exported — `ConsentStateStore` is re-exported from `@switchboard/core`). Concretely, ensure `export * from "./scheduled-follow-up/scheduled-follow-up-store.js";` is reachable from the package's main `index.ts`.

- [ ] **Step 3: Write the failing store test**

```ts
// packages/db/src/stores/__tests__/prisma-scheduled-follow-up-store.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaScheduledFollowUpStore } from "../prisma-scheduled-follow-up-store.js";

function createMockPrisma() {
  return {
    scheduledFollowUp: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaScheduledFollowUpStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaScheduledFollowUpStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaScheduledFollowUpStore(prisma as never);
  });

  it("create() inserts a row and returns its id", async () => {
    prisma.scheduledFollowUp.create.mockResolvedValue({ id: "fu_1" });
    const result = await store.create({
      organizationId: "org-1",
      contactId: "contact-1",
      conversationThreadId: "thread-1",
      sessionId: "thread-1",
      deploymentId: "dep-1",
      workUnitId: "wu-1",
      channel: "whatsapp",
      jurisdiction: "SG",
      reason: "hesitation",
      templateIntentClass: "re-engagement-offer",
      dueAt: new Date("2026-06-04T10:00:00Z"),
      dedupeKey: "followup:org-1:contact-1:2026-06-04",
    });
    expect(result).toEqual({ id: "fu_1" });
    expect(prisma.scheduledFollowUp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          contactId: "contact-1",
          dedupeKey: "followup:org-1:contact-1:2026-06-04",
          status: "pending",
        }),
        select: { id: true },
      }),
    );
  });

  it("findPendingForContact() scopes by org + contact + pending status", async () => {
    prisma.scheduledFollowUp.findFirst.mockResolvedValue({ id: "fu_1" });
    const result = await store.findPendingForContact("org-1", "contact-1");
    expect(result).toEqual({ id: "fu_1" });
    expect(prisma.scheduledFollowUp.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", contactId: "contact-1", status: "pending" },
      select: { id: true },
    });
  });

  it("findDue() returns due pending rows under the attempt cap", async () => {
    prisma.scheduledFollowUp.findMany.mockResolvedValue([
      {
        id: "fu_1",
        organizationId: "org-1",
        contactId: "contact-1",
        conversationThreadId: "thread-1",
        channel: "whatsapp",
        templateIntentClass: "re-engagement-offer",
        reason: "hesitation",
        attempts: 0,
      },
    ]);
    const now = new Date("2026-06-04T10:00:00Z");
    const rows = await store.findDue(now, 100);
    expect(rows).toHaveLength(1);
    expect(prisma.scheduledFollowUp.findMany).toHaveBeenCalledWith({
      where: {
        status: "pending",
        dueAt: { lte: now },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        attempts: { lt: 3 },
      },
      orderBy: { dueAt: "asc" },
      take: 100,
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        conversationThreadId: true,
        channel: true,
        templateIntentClass: true,
        reason: true,
        attempts: true,
      },
    });
  });

  it("markSent() flips status to sent + stamps sentAt", async () => {
    await store.markSent("fu_1");
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: expect.objectContaining({ status: "sent" }),
    });
  });

  it("markSkipped() records the reason", async () => {
    await store.markSkipped("fu_1", "template_not_approved");
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: { status: "skipped", skipReason: "template_not_approved" },
    });
  });

  it("markFailed() re-queues when nextRetryAt is provided", async () => {
    const next = new Date("2026-06-04T10:30:00Z");
    await store.markFailed("fu_1", "boom", next);
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: { status: "pending", attempts: { increment: 1 }, nextRetryAt: next, lastError: "boom" },
    });
  });

  it("markFailed() terminates when nextRetryAt is null", async () => {
    await store.markFailed("fu_1", "boom", null);
    expect(prisma.scheduledFollowUp.update).toHaveBeenCalledWith({
      where: { id: "fu_1" },
      data: { status: "failed", attempts: { increment: 1 }, lastError: "boom" },
    });
  });
});
```

- [ ] **Step 4: Run it — expect FAIL** (module not found).

Run: `pnpm --filter @switchboard/db test prisma-scheduled-follow-up-store`
Expected: FAIL — cannot find `../prisma-scheduled-follow-up-store.js`.

- [ ] **Step 5: Implement the store** (model on `PrismaTriggerStore`)

```ts
// packages/db/src/stores/prisma-scheduled-follow-up-store.ts
import type { PrismaClient } from "@prisma/client";
import type {
  ScheduledFollowUpStore,
  CreateScheduledFollowUpInput,
  DueScheduledFollowUp,
} from "@switchboard/core";

const MAX_ATTEMPTS = 3;

export class PrismaScheduledFollowUpStore implements ScheduledFollowUpStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateScheduledFollowUpInput): Promise<{ id: string }> {
    return this.prisma.scheduledFollowUp.create({
      data: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        conversationThreadId: input.conversationThreadId,
        sessionId: input.sessionId,
        deploymentId: input.deploymentId,
        workUnitId: input.workUnitId,
        channel: input.channel,
        jurisdiction: input.jurisdiction,
        reason: input.reason,
        templateIntentClass: input.templateIntentClass,
        dueAt: input.dueAt,
        dedupeKey: input.dedupeKey,
        status: "pending",
      },
      select: { id: true },
    });
  }

  async findPendingForContact(
    organizationId: string,
    contactId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.scheduledFollowUp.findFirst({
      where: { organizationId, contactId, status: "pending" },
      select: { id: true },
    });
  }

  async findDue(now: Date, limit: number): Promise<DueScheduledFollowUp[]> {
    return this.prisma.scheduledFollowUp.findMany({
      where: {
        status: "pending",
        dueAt: { lte: now },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { dueAt: "asc" },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        conversationThreadId: true,
        channel: true,
        templateIntentClass: true,
        reason: true,
        attempts: true,
      },
    });
  }

  async markSent(id: string): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledFollowUp.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
    });
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledFollowUp.update({
      where: { id },
      data: { status: "skipped", skipReason: reason },
    });
  }

  async markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void> {
    // route-governance: store-mutation-deferred — single-row id-scoped update; org-scoping tracked for #643.
    await this.prisma.scheduledFollowUp.update({
      where: { id },
      data: nextRetryAt
        ? { status: "pending", attempts: { increment: 1 }, nextRetryAt, lastError: error }
        : { status: "failed", attempts: { increment: 1 }, lastError: error },
    });
  }
}
```

- [ ] **Step 6: Export from the db barrel**

In `packages/db/src/index.ts`, add next to the other store exports:

```ts
export { PrismaScheduledFollowUpStore } from "./stores/prisma-scheduled-follow-up-store.js";
```

- [ ] **Step 7: Run the test — expect PASS**

Run: `pnpm --filter @switchboard/db test prisma-scheduled-follow-up-store`
Expected: PASS (7 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/scheduled-follow-up/ packages/db/src/stores/prisma-scheduled-follow-up-store.ts packages/db/src/stores/__tests__/prisma-scheduled-follow-up-store.test.ts packages/db/src/index.ts packages/core/src/index.ts
git commit -m "feat(followup): add ScheduledFollowUp store interface + prisma impl"
```

---

## Task 4: Promote the WhatsApp window helpers to core

**Files:**

- Create: `packages/core/src/notifications/whatsapp-window.ts`
- Test: `packages/core/src/notifications/whatsapp-window.test.ts`
- Modify: `apps/chat/src/adapters/whatsapp.ts` (re-export, keep behavior identical); the `@switchboard/core` barrel.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/notifications/whatsapp-window.test.ts
import { describe, it, expect } from "vitest";
import {
  WHATSAPP_WINDOW_MS,
  isWithinWhatsAppWindow,
  canSendWhatsAppTemplate,
} from "./whatsapp-window.js";

describe("whatsapp-window", () => {
  it("WHATSAPP_WINDOW_MS is 24h", () => {
    expect(WHATSAPP_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("null lastInboundAt is treated as OUTSIDE the window (fails closed)", () => {
    expect(isWithinWhatsAppWindow(null)).toBe(false);
  });

  it("a recent inbound is inside the window", () => {
    expect(isWithinWhatsAppWindow(new Date())).toBe(true);
  });

  it("inside the window any template is allowed", () => {
    expect(
      canSendWhatsAppTemplate({ contact: { messagingOptIn: false }, lastInboundAt: new Date() }),
    ).toEqual({ allowed: true });
  });

  it("outside the window requires opt-in", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    expect(
      canSendWhatsAppTemplate({ contact: { messagingOptIn: false }, lastInboundAt: old }),
    ).toEqual({ allowed: false, reason: "outside_window_no_consent" });
    expect(
      canSendWhatsAppTemplate({ contact: { messagingOptIn: true }, lastInboundAt: old }),
    ).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found).

Run: `pnpm --filter @switchboard/core test whatsapp-window`
Expected: FAIL — cannot find `./whatsapp-window.js`.

- [ ] **Step 3: Implement (lift verbatim from `apps/chat/src/adapters/whatsapp.ts`)**

```ts
// packages/core/src/notifications/whatsapp-window.ts

/** WhatsApp 24-hour conversation window duration in milliseconds. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether we are inside the WhatsApp 24-hour conversation window. Outside the
 * window, only pre-approved template messages may be sent. Null inbound (e.g. a
 * CTWA-only / web-form lead) is treated as OUTSIDE — fail closed.
 */
export function isWithinWhatsAppWindow(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
}

export type WhatsAppTemplateConsentReason = "outside_window_no_consent";

/**
 * Whether a proactive WhatsApp template can be sent. Inside the window any
 * template is allowed (the inbound is implicit consent); outside, the contact
 * must have explicit messagingOptIn.
 */
export function canSendWhatsAppTemplate(args: {
  contact: { messagingOptIn: boolean };
  lastInboundAt: Date | null;
}): { allowed: true } | { allowed: false; reason: WhatsAppTemplateConsentReason } {
  if (isWithinWhatsAppWindow(args.lastInboundAt)) {
    return { allowed: true };
  }
  if (args.contact.messagingOptIn) {
    return { allowed: true };
  }
  return { allowed: false, reason: "outside_window_no_consent" };
}
```

- [ ] **Step 4: Re-export from `apps/chat` to preserve existing imports**

In `apps/chat/src/adapters/whatsapp.ts`, replace the local `WHATSAPP_WINDOW_MS` / `isWithinWhatsAppWindow` / `canSendWhatsAppTemplate` / `WhatsAppTemplateConsentReason` definitions with a re-export so existing chat imports keep working unchanged:

```ts
export {
  isWithinWhatsAppWindow,
  canSendWhatsAppTemplate,
  type WhatsAppTemplateConsentReason,
} from "@switchboard/core";
// (the file's own outbound adapter logic that used WHATSAPP_WINDOW_MS now imports it from core)
```

Verify no other symbol in the file still references the removed local `WHATSAPP_WINDOW_MS` const without importing it from core.

- [ ] **Step 5: Export from the core barrel** — ensure `export * from "./notifications/whatsapp-window.js";` is reachable from `@switchboard/core`.

- [ ] **Step 6: Run both packages' tests — expect PASS**

Run: `pnpm --filter @switchboard/core test whatsapp-window && pnpm --filter @switchboard/chat test`
Expected: PASS; chat tests unaffected (behavior identical, just relocated).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/notifications/whatsapp-window.ts packages/core/src/notifications/whatsapp-window.test.ts apps/chat/src/adapters/whatsapp.ts packages/core/src/index.ts
git commit -m "refactor(followup): promote whatsapp window helpers to core"
```

---

## Task 5: The single-sourced eligibility gate

**Files:**

- Create: `packages/core/src/notifications/proactive-eligibility.ts`
- Test: `packages/core/src/notifications/proactive-eligibility.test.ts`
- Modify: the `@switchboard/core` barrel.

- [ ] **Step 1: Write the failing test** (drives from the REAL registry — all-draft ⇒ blocked — plus an injected approved template for the happy path)

```ts
// packages/core/src/notifications/proactive-eligibility.test.ts
import { describe, it, expect } from "vitest";
import { evaluateProactiveSendEligibility } from "./proactive-eligibility.js";
import type { WhatsAppTemplate } from "../skill-runtime/templates/whatsapp-registry.js";

const APPROVED_TEMPLATE: WhatsAppTemplate = {
  name: "re_engagement_offer_sg_v1",
  metaTemplateName: "alex_re_engagement_offer_sg_v1",
  intentClass: "re-engagement-offer",
  jurisdiction: "SG",
  templateCategory: "marketing",
  approvalStatus: "approved",
  body: "Hi {{lead_name}} ...",
  variables: [
    { name: "lead_name", description: "first name" },
    { name: "business_name", description: "clinic name" },
  ],
};

const optedInContact = {
  pdpaJurisdiction: "SG" as const,
  consentGrantedAt: "2026-05-01T00:00:00.000Z",
  consentRevokedAt: null,
  messagingOptIn: true,
};

const outsideWindow = new Date(Date.now() - 48 * 60 * 60 * 1000);

describe("evaluateProactiveSendEligibility", () => {
  it("blocks when PDPA consent is revoked", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...optedInContact, consentRevokedAt: "2026-05-10T00:00:00.000Z" },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "consent_revoked" });
  });

  it("blocks proactive sends when consent is pending (jurisdiction stamped, never granted)", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...optedInContact, consentGrantedAt: null },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "consent_pending" });
  });

  it("blocks when outside the window without opt-in", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...optedInContact, messagingOptIn: false },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "no_optin" });
  });

  it("blocks when no template matches the jurisdiction (null jurisdiction)", () => {
    const r = evaluateProactiveSendEligibility({
      contact: { ...optedInContact, pdpaJurisdiction: null },
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: null,
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "no_template" });
  });

  it("FAILS CLOSED on today's real registry: re-engagement template is draft", () => {
    // Uses the default (real) selectTemplate — every registry entry is approvalStatus:"draft".
    const r = evaluateProactiveSendEligibility({
      contact: optedInContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
    });
    expect(r).toEqual({ eligible: false, reason: "template_not_approved" });
  });

  it("blocks an approved marketing template when marketing substitution is disabled", () => {
    const r = evaluateProactiveSendEligibility({
      contact: optedInContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: false,
      selectTemplateFn: () => APPROVED_TEMPLATE,
    });
    expect(r).toEqual({ eligible: false, reason: "marketing_blocked" });
  });

  it("is eligible when consent + opt-in + approved template + marketing allowed all hold", () => {
    const r = evaluateProactiveSendEligibility({
      contact: optedInContact,
      lastWhatsAppInboundAt: outsideWindow,
      intentClass: "re-engagement-offer",
      jurisdiction: "SG",
      allowMarketingTemplate: true,
      selectTemplateFn: () => APPROVED_TEMPLATE,
    });
    expect(r).toEqual({ eligible: true, template: APPROVED_TEMPLATE });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found).

Run: `pnpm --filter @switchboard/core test proactive-eligibility`
Expected: FAIL.

- [ ] **Step 3: Implement the gate**

```ts
// packages/core/src/notifications/proactive-eligibility.ts
import { evaluateConsentGate } from "@switchboard/schemas";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";
import type { ProactiveSkipReason } from "@switchboard/schemas";
import { canSendWhatsAppTemplate } from "./whatsapp-window.js";
import {
  selectTemplate as defaultSelectTemplate,
  type WhatsAppTemplate,
  type Jurisdiction,
} from "../skill-runtime/templates/whatsapp-registry.js";

export type ProactiveSendEligibility =
  | { eligible: true; template: WhatsAppTemplate }
  | { eligible: false; reason: ProactiveSkipReason };

export interface ProactiveEligibilityInput {
  contact: {
    pdpaJurisdiction: PdpaJurisdiction | null;
    consentGrantedAt: Date | string | null;
    consentRevokedAt: Date | string | null;
    messagingOptIn: boolean;
  };
  lastWhatsAppInboundAt: Date | null;
  intentClass: IntentClass;
  jurisdiction: Jurisdiction | null;
  allowMarketingTemplate: boolean;
  /** Injectable for tests; defaults to the real registry lookup. */
  selectTemplateFn?: (args: {
    intentClass: IntentClass;
    jurisdiction: Jurisdiction;
  }) => WhatsAppTemplate | null;
}

/**
 * The single source of truth for "may we send this proactive WhatsApp template
 * now?". Composes the PDPA proactive consent bar, the 24h-window/opt-in bar, and
 * the approved-template + marketing-substitution checks, in strictest-first
 * order. Every block path returns a recorded reason — never a silent skip.
 */
export function evaluateProactiveSendEligibility(
  input: ProactiveEligibilityInput,
): ProactiveSendEligibility {
  // 1. PDPA proactive consent (blocks pending AND revoked).
  const consent = evaluateConsentGate({
    contact: {
      pdpaJurisdiction: input.contact.pdpaJurisdiction,
      consentGrantedAt: input.contact.consentGrantedAt,
      consentRevokedAt: input.contact.consentRevokedAt,
    },
    messageClass: "proactive",
  });
  if (consent.action === "block") {
    return { eligible: false, reason: consent.reasonCode };
  }

  // 2. WhatsApp 24h window / opt-in.
  const window = canSendWhatsAppTemplate({
    contact: { messagingOptIn: input.contact.messagingOptIn },
    lastInboundAt: input.lastWhatsAppInboundAt,
  });
  if (!window.allowed) {
    return { eligible: false, reason: "no_optin" };
  }

  // 3. Approved-template selection + marketing-substitution.
  if (input.jurisdiction === null) {
    return { eligible: false, reason: "no_template" };
  }
  const selectTemplate = input.selectTemplateFn ?? defaultSelectTemplate;
  const template = selectTemplate({
    intentClass: input.intentClass,
    jurisdiction: input.jurisdiction,
  });
  if (!template) {
    return { eligible: false, reason: "no_template" };
  }
  if (template.approvalStatus !== "approved") {
    return { eligible: false, reason: "template_not_approved" };
  }
  if (template.templateCategory === "marketing" && !input.allowMarketingTemplate) {
    return { eligible: false, reason: "marketing_blocked" };
  }

  return { eligible: true, template };
}
```

> Note: `ProactiveSkipReason` from Task 1 includes `consent_pending`/`consent_revoked`; `ConsentGateDecision.reasonCode` is exactly those two literals, so the `consent.reasonCode` assignment is type-safe.

- [ ] **Step 4: Export from the core barrel** — `export * from "./notifications/proactive-eligibility.js";`.

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @switchboard/core test proactive-eligibility`
Expected: PASS (7 tests, including the real-registry fail-closed proof).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/notifications/proactive-eligibility.ts packages/core/src/notifications/proactive-eligibility.test.ts packages/core/src/index.ts
git commit -m "feat(followup): single-sourced proactive send eligibility gate"
```

---

## Task 6: The `follow-up` schedule tool

**Files:**

- Create: `packages/core/src/skill-runtime/tools/schedule-follow-up.ts`
- Test: `packages/core/src/skill-runtime/tools/schedule-follow-up.test.ts`
- Modify: `packages/core/src/skill-runtime/tools/index.ts`; `apps/api/src/bootstrap/skill-mode.ts`; `skills/alex/SKILL.md`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/skill-runtime/tools/schedule-follow-up.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createScheduleFollowUpToolFactory } from "./schedule-follow-up.js";
import type { SkillRequestContext } from "../types.js";

function makeDeps() {
  return {
    followUpStore: {
      create: vi.fn().mockResolvedValue({ id: "fu_1" }),
      findPendingForContact: vi.fn().mockResolvedValue(null),
    },
    now: () => new Date("2026-06-01T00:00:00.000Z"),
  };
}

const CTX: SkillRequestContext = {
  sessionId: "thread_1",
  orgId: "org_1",
  deploymentId: "dep_1",
  workUnitId: "wu_1",
  contactId: "contact_1",
};

describe("schedule-follow-up tool", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("factory returns a tool with id 'follow-up' and a write-effect schedule op", () => {
    const tool = createScheduleFollowUpToolFactory(deps)(CTX);
    expect(tool.id).toBe("follow-up");
    expect(tool.operations["followup.schedule"]!.effectCategory).toBe("write");
    expect(tool.operations["followup.schedule"]!.idempotent).toBe(true);
  });

  it("fails closed when no contact is bound to the conversation", async () => {
    const tool = createScheduleFollowUpToolFactory(deps)({ ...CTX, contactId: undefined });
    const r = await tool.operations["followup.schedule"]!.execute({
      reason: "hesitation",
      delay: "in_3_days",
    });
    expect(r.status).toBe("error");
    expect(r.error!.code).toBe("MISSING_CONTACT");
    expect(deps.followUpStore.create).not.toHaveBeenCalled();
  });

  it("schedules a follow-up using trusted ctx ids, computing dueAt + dedupeKey from delay", async () => {
    const tool = createScheduleFollowUpToolFactory(deps)(CTX);
    const r = await tool.operations["followup.schedule"]!.execute({
      reason: "price_concern",
      delay: "in_3_days",
      note: "wants pricing on weekend",
    });
    expect(r.status).toBe("success");
    expect(r.data).toEqual({
      followUpId: "fu_1",
      scheduledFor: "2026-06-04T00:00:00.000Z",
      status: "scheduled",
    });
    expect(deps.followUpStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        contactId: "contact_1",
        conversationThreadId: "thread_1",
        sessionId: "thread_1",
        deploymentId: "dep_1",
        workUnitId: "wu_1",
        channel: "whatsapp",
        reason: "price_concern",
        templateIntentClass: "re-engagement-offer",
        dueAt: new Date("2026-06-04T00:00:00.000Z"),
        dedupeKey: "followup:org_1:contact_1:2026-06-04",
      }),
    );
  });

  it("is idempotent — returns already_scheduled when a pending follow-up exists", async () => {
    deps.followUpStore.findPendingForContact.mockResolvedValue({ id: "fu_existing" });
    const tool = createScheduleFollowUpToolFactory(deps)(CTX);
    const r = await tool.operations["followup.schedule"]!.execute({
      reason: "went_quiet",
      delay: "in_1_day",
    });
    expect(r.status).toBe("success");
    expect(r.data).toEqual({ followUpId: "fu_existing", status: "already_scheduled" });
    expect(deps.followUpStore.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

Run: `pnpm --filter @switchboard/core test schedule-follow-up`
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

```ts
// packages/core/src/skill-runtime/tools/schedule-follow-up.ts
import type { SkillTool, SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail } from "../tool-result.js";
import { FOLLOW_UP_DELAY_MS } from "@switchboard/schemas";
import type { FollowUpReason, FollowUpDelay } from "@switchboard/schemas";
import type { CreateScheduledFollowUpInput } from "../../scheduled-follow-up/scheduled-follow-up-store.js";

interface ScheduleFollowUpDeps {
  followUpStore: {
    create(input: CreateScheduledFollowUpInput): Promise<{ id: string }>;
    findPendingForContact(orgId: string, contactId: string): Promise<{ id: string } | null>;
  };
  /** Injectable clock for deterministic dueAt; defaults to wall clock. */
  now?: () => Date;
}

interface ScheduleFollowUpInput {
  reason: FollowUpReason;
  delay: FollowUpDelay;
  note?: string;
}

export type ScheduleFollowUpToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Lets Alex schedule a single re-engagement follow-up for the CURRENT contact.
 * Trust-bound ids (orgId, contactId, sessionId, deploymentId, workUnitId) come
 * from the injected SkillRequestContext, NEVER from LLM input (AI-1). The tool
 * only RECORDS intent — the governed send happens later via the firing cron +
 * conversation.followup.send handler.
 */
export function createScheduleFollowUpToolFactory(
  deps: ScheduleFollowUpDeps,
): ScheduleFollowUpToolFactory {
  const now = deps.now ?? (() => new Date());
  return (ctx: SkillRequestContext): SkillTool => ({
    id: "follow-up",
    operations: {
      "followup.schedule": {
        description:
          "Schedule a single WhatsApp re-engagement follow-up for this lead, to be " +
          "sent automatically later (only if consent, the messaging window, and an " +
          "approved template all allow). Use when a qualified lead has gone quiet or " +
          "hesitant. Do not schedule more than one follow-up per conversation.",
        effectCategory: "write" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: [
                "hesitation",
                "price_concern",
                "timing_not_now",
                "awaiting_info",
                "went_quiet",
              ],
            },
            delay: {
              type: "string",
              enum: ["in_1_day", "in_3_days", "in_1_week"],
            },
            note: {
              type: "string",
              description: "Optional short context for the team (not sent to the customer).",
            },
          },
          required: ["reason", "delay"],
        },
        execute: async (params: unknown): Promise<ToolResult> => {
          const contactId = ctx.contactId;
          if (!contactId) {
            return fail("MISSING_CONTACT", "No contact is associated with this conversation.", {
              modelRemediation:
                "Do not schedule a follow-up without an active contact. Continue the conversation or escalate.",
              retryable: false,
            });
          }

          const input = params as ScheduleFollowUpInput;
          const dueAt = new Date(now().getTime() + FOLLOW_UP_DELAY_MS[input.delay]);
          const dayBucket = dueAt.toISOString().slice(0, 10);
          const dedupeKey = `followup:${ctx.orgId}:${contactId}:${dayBucket}`;

          const existing = await deps.followUpStore.findPendingForContact(ctx.orgId, contactId);
          if (existing) {
            return ok({ followUpId: existing.id, status: "already_scheduled" });
          }

          const created = await deps.followUpStore.create({
            organizationId: ctx.orgId,
            contactId,
            conversationThreadId: ctx.sessionId,
            sessionId: ctx.sessionId,
            deploymentId: ctx.deploymentId,
            workUnitId: ctx.workUnitId ?? null,
            channel: "whatsapp",
            jurisdiction: null,
            reason: input.reason,
            templateIntentClass: "re-engagement-offer",
            dueAt,
            dedupeKey,
          });

          return ok({
            followUpId: created.id,
            scheduledFor: dueAt.toISOString(),
            status: "scheduled",
          });
        },
      },
    },
  });
}
```

- [ ] **Step 4: Export from the tools barrel** (`packages/core/src/skill-runtime/tools/index.ts`)

```ts
export { createScheduleFollowUpToolFactory } from "./schedule-follow-up.js";
export type { ScheduleFollowUpToolFactory } from "./schedule-follow-up.js";
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @switchboard/core test schedule-follow-up`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire into `apps/api/src/bootstrap/skill-mode.ts` (4 sites)**

(a) Add to the dynamic-import destructure (~line 78):

```ts
    createScheduleFollowUpToolFactory,
```

(b) Construct the factory near the other tool factories (~line 311, after the stores are built). Build a `PrismaScheduledFollowUpStore` for it (import `PrismaScheduledFollowUpStore` from `@switchboard/db` at the bootstrap layer, where db imports are allowed):

```ts
const scheduleFollowUpFactory = createScheduleFollowUpToolFactory({
  followUpStore: new PrismaScheduledFollowUpStore(prismaClient),
});
```

(c) Register in BOTH maps (~lines 317-338):

```ts
// toolFactories Map:
toolFactories.set("follow-up", scheduleFollowUpFactory);
// toolsMap (schema-only):
toolsMap.set("follow-up", scheduleFollowUpFactory(SCHEMA_ONLY_CTX));
```

(d) Exclude from the simulation maps (~line 673, with the delegate exclusions) — the tool performs a real write and must not run in `/simulate`:

```ts
simulationToolFactories.delete("follow-up");
simulationToolsMap.delete("follow-up");
```

- [ ] **Step 7: Declare the tool in `skills/alex/SKILL.md`**

Add to the frontmatter `tools:` list (lines 48-53):

```yaml
- follow-up
```

Add an in-body instruction block (model on the delegate section):

```markdown
## Scheduling a follow-up (follow-up)

When a qualified lead goes quiet or hesitant and a later nudge would genuinely help, schedule ONE follow-up with `follow-up.followup.schedule`. This stores a reminder — it does **not** message the customer now, and it only sends later if consent, the WhatsApp window, and an approved template all allow.

Use it **only** when:

- The lead is qualified/interested but has stopped responding or asked to think about it, and
- You have already answered their immediate question.

Do **not**:

- Schedule more than one follow-up per conversation.
- Use it instead of `escalate` (use escalate for human help / out-of-scope / frustration).
- Promise the customer a specific message or time.

Provide `reason` (why you're following up) and `delay` (`in_1_day`, `in_3_days`, or `in_1_week`). Optionally add a short `note` for the team.
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill-runtime/tools/schedule-follow-up.ts packages/core/src/skill-runtime/tools/schedule-follow-up.test.ts packages/core/src/skill-runtime/tools/index.ts apps/api/src/bootstrap/skill-mode.ts skills/alex/SKILL.md
git commit -m "feat(followup): add follow-up schedule tool + wire into alex"
```

---

## Task 7: The governed send handler `conversation.followup.send`

**Files:**

- Create: `apps/api/src/services/workflows/conversation-followup-send-workflow.ts`
- Test: `apps/api/src/services/workflows/__tests__/conversation-followup-send-workflow.test.ts`
- Modify: `apps/api/src/bootstrap/contained-workflows.ts`; `scripts/env-allowlist.local-readiness.json`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/workflows/__tests__/conversation-followup-send-workflow.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildConversationFollowUpSendWorkflow } from "../conversation-followup-send-workflow.js";
import type { WhatsAppTemplate } from "@switchboard/core";

const baseWorkUnit = {
  id: "wu_1",
  organizationId: "org_1",
  actor: { id: "system:scheduled-follow-up", type: "system" as const },
  intent: "conversation.followup.send",
  parameters: {
    contactId: "contact_1",
    conversationThreadId: "thread_1",
    channel: "whatsapp",
    templateIntentClass: "re-engagement-offer",
    reason: "went_quiet",
    followUpId: "fu_1",
  },
  deployment: {
    deploymentId: "dep_1",
    skillSlug: "alex",
    trustLevel: "guided" as const,
    trustScore: 0,
  },
  resolvedMode: "workflow" as const,
  traceId: "trace_1",
  trigger: "schedule" as const,
  priority: "normal" as const,
};

const APPROVED: WhatsAppTemplate = {
  name: "re_engagement_offer_sg_v1",
  metaTemplateName: "alex_re_engagement_offer_sg_v1",
  intentClass: "re-engagement-offer",
  jurisdiction: "SG",
  templateCategory: "marketing",
  approvalStatus: "approved",
  body: "Hi {{lead_name}} ...",
  variables: [
    { name: "lead_name", description: "first name" },
    { name: "business_name", description: "clinic" },
  ],
};

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    getSendContext: vi.fn().mockResolvedValue({
      consentGrantedAt: "2026-05-01T00:00:00.000Z",
      consentRevokedAt: null,
      pdpaJurisdiction: "SG",
      messagingOptIn: true,
      lastWhatsAppInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      jurisdiction: "SG",
      leadName: "Jane",
      businessName: "Glow Clinic",
    }),
    allowMarketingTemplate: true,
    selectTemplateFn: () => APPROVED,
    ...over,
  };
}

describe("conversation.followup.send handler", () => {
  beforeEach(() => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "tok";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "pnid";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
  });

  it("skips (completed, sent:false) for an unsupported channel", async () => {
    const wf = buildConversationFollowUpSendWorkflow(makeDeps());
    const r = await wf.execute(
      { ...baseWorkUnit, parameters: { ...baseWorkUnit.parameters, channel: "telegram" } },
      { submitChildWork: vi.fn() },
    );
    expect(r.outcome).toBe("completed");
    expect(r.outputs).toEqual({ sent: false, skipReason: "unsupported_channel" });
  });

  it("skips (completed, sent:false) with the gate's reason when not eligible", async () => {
    const deps = makeDeps({
      getSendContext: vi.fn().mockResolvedValue({
        consentGrantedAt: null, // pending
        consentRevokedAt: null,
        pdpaJurisdiction: "SG",
        messagingOptIn: true,
        lastWhatsAppInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        jurisdiction: "SG",
        leadName: "Jane",
        businessName: "Glow Clinic",
      }),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationFollowUpSendWorkflow(deps);
    const r = await wf.execute(baseWorkUnit, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("completed");
    expect(r.outputs).toEqual({ sent: false, skipReason: "consent_pending" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the approved template and returns sent:true when eligible", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid_1" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationFollowUpSendWorkflow(makeDeps());
    const r = await wf.execute(baseWorkUnit, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("completed");
    expect(r.outputs!.sent).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("graph.facebook.com");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("alex_re_engagement_offer_sg_v1");
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "Jane" },
      { type: "text", text: "Glow Clinic" },
    ]);
  });

  it("returns failed when the Graph API call errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: async () => "rate limited" }),
    );
    const wf = buildConversationFollowUpSendWorkflow(makeDeps());
    const r = await wf.execute(baseWorkUnit, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("failed");
    expect(r.error!.code).toBe("WHATSAPP_TEMPLATE_SEND_FAILED");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

Run: `pnpm --filter @switchboard/api test conversation-followup-send-workflow`
Expected: FAIL.

- [ ] **Step 3: Implement the handler**

```ts
// apps/api/src/services/workflows/conversation-followup-send-workflow.ts
import type { WorkflowHandler } from "@switchboard/core/platform";
import { evaluateProactiveSendEligibility } from "@switchboard/core";
import type { IntentClass, PdpaJurisdiction } from "@switchboard/schemas";

export interface FollowUpSendContext {
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
  pdpaJurisdiction: PdpaJurisdiction | null;
  messagingOptIn: boolean;
  lastWhatsAppInboundAt: Date | null;
  jurisdiction: "SG" | "MY" | null;
  leadName: string;
  businessName: string;
}

export interface ConversationFollowUpSendDeps {
  getSendContext: (
    orgId: string,
    contactId: string,
    threadId: string | null,
  ) => Promise<FollowUpSendContext>;
  allowMarketingTemplate: boolean;
  /** Injectable for tests; defaults to the real registry lookup inside the gate. */
  selectTemplateFn?: Parameters<typeof evaluateProactiveSendEligibility>[0]["selectTemplateFn"];
}

interface FollowUpSendParams {
  contactId: string;
  conversationThreadId: string | null;
  channel: string;
  templateIntentClass: IntentClass;
  reason: string;
  followUpId: string;
}

export function buildConversationFollowUpSendWorkflow(
  deps: ConversationFollowUpSendDeps,
): WorkflowHandler {
  return {
    async execute(workUnit) {
      const params = workUnit.parameters as unknown as FollowUpSendParams;

      if (params.channel !== "whatsapp") {
        return {
          outcome: "completed",
          summary: "Follow-up skipped: unsupported channel",
          outputs: { sent: false, skipReason: "unsupported_channel" },
        };
      }

      const ctx = await deps.getSendContext(
        workUnit.organizationId,
        params.contactId,
        params.conversationThreadId,
      );

      const eligibility = evaluateProactiveSendEligibility({
        contact: {
          pdpaJurisdiction: ctx.pdpaJurisdiction,
          consentGrantedAt: ctx.consentGrantedAt,
          consentRevokedAt: ctx.consentRevokedAt,
          messagingOptIn: ctx.messagingOptIn,
        },
        lastWhatsAppInboundAt: ctx.lastWhatsAppInboundAt,
        intentClass: params.templateIntentClass,
        jurisdiction: ctx.jurisdiction,
        allowMarketingTemplate: deps.allowMarketingTemplate,
        selectTemplateFn: deps.selectTemplateFn,
      });

      if (!eligibility.eligible) {
        return {
          outcome: "completed",
          summary: `Follow-up skipped: ${eligibility.reason}`,
          outputs: { sent: false, skipReason: eligibility.reason },
        };
      }

      const accessToken = process.env["WHATSAPP_ACCESS_TOKEN"];
      const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
      if (!accessToken || !phoneNumberId) {
        return {
          outcome: "completed",
          summary: "WhatsApp not configured; follow-up skipped",
          outputs: { sent: false, skipReason: "unsupported_channel" },
        };
      }

      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: params.contactId,
          type: "template",
          template: {
            name: eligibility.template.metaTemplateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: ctx.leadName },
                  { type: "text", text: ctx.businessName },
                ],
              },
            ],
          },
        }),
      });

      if (!response.ok) {
        return {
          outcome: "failed",
          summary: "Follow-up send failed",
          error: {
            code: "WHATSAPP_TEMPLATE_SEND_FAILED",
            message: await response.text(),
          },
        };
      }

      const json = (await response.json()) as { messages?: Array<{ id?: string }> };
      return {
        outcome: "completed",
        summary: "Follow-up sent",
        outputs: { sent: true, messageId: json.messages?.[0]?.id ?? null },
      };
    },
  };
}
```

> Note: `params.contactId` is the WhatsApp `to`. For v1 this matches how the greeting workflow uses `input.phone`; if the contactId is not the dialable phone, `getSendContext` should also return the phone and the handler should send to that — confirm the contact↔phone mapping at execution time and adjust `to` accordingly. (Plan-level: the simplest correct source is the contact's phone; thread it through `getSendContext`.)

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @switchboard/api test conversation-followup-send-workflow`
Expected: PASS (4 tests).

- [ ] **Step 5: Register in `apps/api/src/bootstrap/contained-workflows.ts`**

(a) Dynamic import (~line 84):

```ts
const { buildConversationFollowUpSendWorkflow } =
  await import("../services/workflows/conversation-followup-send-workflow.js");
```

(b) Build deps + add to the handlers Map (~line 161). Construct `getSendContext` from `prismaClient` (read consent fields + `lastWhatsAppInboundAt` + `messagingOptIn` + contact first name + phone + org display name; mirror the consent `CONSENT_SELECT` + the `skill-mode.ts:467-484` thread/contact reads). Read the marketing flag from env (default false → fail closed):

```ts
const followUpSendHandler = buildConversationFollowUpSendWorkflow({
  getSendContext: async (orgId, contactId, threadId) => {
    const contact = await prismaClient.contact.findFirst({
      where: { id: contactId, organizationId: orgId },
      select: {
        firstName: true,
        phone: true,
        messagingOptIn: true,
        pdpaJurisdiction: true,
        consentGrantedAt: true,
        consentRevokedAt: true,
        organization: { select: { name: true } },
      },
    });
    const thread = threadId
      ? await prismaClient.conversationThread.findUnique({
          where: { id: threadId },
          select: { lastWhatsAppInboundAt: true },
        })
      : null;
    return {
      consentGrantedAt: contact?.consentGrantedAt ?? null,
      consentRevokedAt: contact?.consentRevokedAt ?? null,
      pdpaJurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
      messagingOptIn: contact?.messagingOptIn ?? false,
      lastWhatsAppInboundAt: thread?.lastWhatsAppInboundAt ?? null,
      jurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
      leadName: contact?.firstName ?? "there",
      businessName: contact?.organization?.name ?? "our clinic",
    };
  },
  allowMarketingTemplate: process.env["FOLLOWUP_ALLOW_MARKETING_TEMPLATE"] === "true",
});
// …add to the handlers Map:
//   ["conversation.followup.send", followUpSendHandler],
```

> Confirm the exact `select` field names against `schema.prisma` (the Contact `firstName`/`phone`/`organization` relation names may differ; adjust to the real columns — `getSendContext`'s return shape is the contract, the query is an implementation detail). If `to` must be the phone, return it from `getSendContext` and send to it in the handler.

(c) Add the intent to the `workflowIntents` array (~line 234, model on the `meta.lead.greeting.send` block):

```ts
    {
      intent: "conversation.followup.send",
      workflowId: "conversation.followup.send",
      budgetClass: "standard",
      approvalPolicy: "none",
      allowedTriggers: ["schedule"],
    },
```

- [ ] **Step 6: Add the env var to the allowlist**

In `scripts/env-allowlist.local-readiness.json`, add `FOLLOWUP_ALLOW_MARKETING_TEMPLATE` under the appropriate category (so CI lint + test pass).

- [ ] **Step 7: Run the api test suite for this area — expect PASS**

Run: `pnpm --filter @switchboard/api test conversation-followup-send-workflow`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/workflows/conversation-followup-send-workflow.ts apps/api/src/services/workflows/__tests__/conversation-followup-send-workflow.test.ts apps/api/src/bootstrap/contained-workflows.ts scripts/env-allowlist.local-readiness.json
git commit -m "feat(followup): governed conversation.followup.send handler"
```

---

## Task 8: The firing cron + submit-closure threading

**Files:**

- Create: `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts`
- Test: `apps/api/src/services/cron/__tests__/scheduled-follow-up-dispatch.test.ts`
- Modify: `apps/api/src/bootstrap/contained-workflows.ts` (export `submitScheduledFollowUp`); `apps/api/src/app.ts` (pass it to `registerInngest`); `apps/api/src/bootstrap/inngest.ts` (options type + deps + register).

### 8a — The cron (pure, deps-injected)

- [ ] **Step 1: Write the failing test** (model on `lead-retry.test.ts`)

```ts
// apps/api/src/services/cron/__tests__/scheduled-follow-up-dispatch.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  executeScheduledFollowUpDispatch,
  createScheduledFollowUpDispatchCron,
} from "../scheduled-follow-up-dispatch.js";
import type { ScheduledFollowUpDispatchDeps, StepTools } from "../scheduled-follow-up-dispatch.js";
import type { AsyncFailureContext } from "@switchboard/core";

const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));
vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({ createFunction: createFunctionSpy })),
}));

function makeStep(): StepTools {
  return { run: async <T>(_n: string, fn: () => T | Promise<T>): Promise<T> => fn() };
}

function makeFailureContext(): AsyncFailureContext {
  return {
    auditLedger: {
      record: vi.fn().mockResolvedValue({}),
    } as unknown as AsyncFailureContext["auditLedger"],
    operatorAlerter: {
      alert: vi.fn().mockResolvedValue(undefined),
    } as unknown as AsyncFailureContext["operatorAlerter"],
    inngest: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

function makeDue(over = {}) {
  return {
    id: "fu_1",
    organizationId: "org_1",
    contactId: "contact_1",
    conversationThreadId: "thread_1",
    channel: "whatsapp",
    templateIntentClass: "re-engagement-offer",
    reason: "went_quiet",
    attempts: 0,
    ...over,
  };
}

function makeDeps(
  over: Partial<ScheduledFollowUpDispatchDeps> = {},
): ScheduledFollowUpDispatchDeps {
  return {
    failure: makeFailureContext(),
    findDueFollowUps: vi.fn().mockResolvedValue([makeDue()]),
    submitFollowUpSend: vi.fn().mockResolvedValue({
      ok: true,
      result: { outputs: { sent: true } },
      workUnit: {},
    }),
    markSent: vi.fn(),
    markSkipped: vi.fn(),
    markFailed: vi.fn(),
    now: () => new Date("2026-06-04T10:00:00Z"),
    ...over,
  };
}

describe("executeScheduledFollowUpDispatch", () => {
  it("submits each due follow-up through the ingress closure and marks it sent", async () => {
    const deps = makeDeps();
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r).toEqual({ processed: 1, sent: 1, skipped: 0, failed: 0 });
    expect(deps.submitFollowUpSend).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        contactId: "contact_1",
        conversationThreadId: "thread_1",
        channel: "whatsapp",
        templateIntentClass: "re-engagement-offer",
        reason: "went_quiet",
        followUpId: "fu_1",
      }),
    );
    expect(deps.markSent).toHaveBeenCalledWith("fu_1");
  });

  it("records a skip with the handler's reason", async () => {
    const deps = makeDeps({
      submitFollowUpSend: vi.fn().mockResolvedValue({
        ok: true,
        result: { outputs: { sent: false, skipReason: "template_not_approved" } },
        workUnit: {},
      }),
    });
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r.skipped).toBe(1);
    expect(deps.markSkipped).toHaveBeenCalledWith("fu_1", "template_not_approved");
  });

  it("retries with backoff on a failed submit below the attempt cap", async () => {
    const deps = makeDeps({
      submitFollowUpSend: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "X", message: "boom" } }),
    });
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r.failed).toBe(1);
    const [id, , nextRetryAt] = (deps.markFailed as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe("fu_1");
    expect((nextRetryAt as Date).getTime()).toBeGreaterThan(deps.now!().getTime());
  });

  it("terminates (no nextRetryAt) at the final attempt", async () => {
    const deps = makeDeps({
      findDueFollowUps: vi.fn().mockResolvedValue([makeDue({ attempts: 2 })]),
      submitFollowUpSend: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "X", message: "boom" } }),
    });
    await executeScheduledFollowUpDispatch(makeStep(), deps);
    const [, , nextRetryAt] = (deps.markFailed as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(nextRetryAt).toBeNull();
  });

  it("returns zeros when nothing is due", async () => {
    const deps = makeDeps({ findDueFollowUps: vi.fn().mockResolvedValue([]) });
    const r = await executeScheduledFollowUpDispatch(makeStep(), deps);
    expect(r).toEqual({ processed: 0, sent: 0, skipped: 0, failed: 0 });
  });
});

describe("createScheduledFollowUpDispatchCron — onFailure wiring", () => {
  it("passes a function onFailure into createFunction config", () => {
    createFunctionSpy.mockClear();
    createScheduledFollowUpDispatchCron(makeDeps());
    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

Run: `pnpm --filter @switchboard/api test scheduled-follow-up-dispatch`
Expected: FAIL.

- [ ] **Step 3: Implement the cron** (clone `lead-retry.ts` structure)

```ts
// apps/api/src/services/cron/scheduled-follow-up-dispatch.ts
import { Inngest } from "inngest";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { DueScheduledFollowUp } from "@switchboard/core";

const inngestClient = new Inngest({ id: "switchboard" });

const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24h
const BASE_INTERVAL_MS = 15 * 60 * 1000; // 15m

export interface FollowUpSendSubmitInput {
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  channel: string;
  templateIntentClass: string;
  reason: string;
  followUpId: string;
}

export interface ScheduledFollowUpDispatchDeps {
  failure: AsyncFailureContext;
  findDueFollowUps: () => Promise<DueScheduledFollowUp[]>;
  submitFollowUpSend: (input: FollowUpSendSubmitInput) => Promise<SubmitWorkResponse>;
  markSent: (id: string) => Promise<void>;
  markSkipped: (id: string, reason: string) => Promise<void>;
  markFailed: (id: string, error: string, nextRetryAt: Date | null) => Promise<void>;
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export async function executeScheduledFollowUpDispatch(
  step: StepTools,
  deps: ScheduledFollowUpDispatchDeps,
): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  const now = deps.now ?? (() => new Date());
  const due = await step.run("find-due-followups", () => deps.findDueFollowUps());

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const followUp of due) {
    await step.run(`followup-${followUp.id}`, async () => {
      const response = await deps.submitFollowUpSend({
        organizationId: followUp.organizationId,
        contactId: followUp.contactId,
        conversationThreadId: followUp.conversationThreadId,
        channel: followUp.channel,
        templateIntentClass: followUp.templateIntentClass,
        reason: followUp.reason,
        followUpId: followUp.id,
      });

      if (!response.ok) {
        const nextRetryAt = computeNextRetry(followUp.attempts, now);
        await deps.markFailed(followUp.id, response.error.code, nextRetryAt);
        failed++;
        return;
      }

      const outputs = (response.result.outputs ?? {}) as { sent?: boolean; skipReason?: string };
      if (outputs.sent === true) {
        await deps.markSent(followUp.id);
        sent++;
        return;
      }
      if (outputs.sent === false) {
        await deps.markSkipped(followUp.id, outputs.skipReason ?? "unknown");
        skipped++;
        return;
      }

      // Unexpected (no terminal sent flag) → treat as a retryable failure.
      const nextRetryAt = computeNextRetry(followUp.attempts, now);
      await deps.markFailed(followUp.id, "no_terminal_outcome", nextRetryAt);
      failed++;
    });
  }

  return { processed: due.length, sent, skipped, failed };
}

function computeNextRetry(currentAttempts: number, now: () => Date): Date | null {
  if (currentAttempts + 1 >= MAX_ATTEMPTS) return null; // terminal
  const backoffMs = Math.min(BASE_INTERVAL_MS * Math.pow(2, currentAttempts), MAX_BACKOFF_MS);
  return new Date(now().getTime() + backoffMs);
}

export function createScheduledFollowUpDispatchCron(deps: ScheduledFollowUpDispatchDeps) {
  return inngestClient.createFunction(
    {
      id: "scheduled-follow-up-dispatch",
      name: "Scheduled Follow-Up Dispatch",
      retries: 2,
      triggers: [{ cron: "*/15 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "scheduled-follow-up-dispatch",
          eventDomain: "scheduled-follow-up",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => {
      return executeScheduledFollowUpDispatch(step as unknown as StepTools, deps);
    },
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @switchboard/api test scheduled-follow-up-dispatch`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/cron/scheduled-follow-up-dispatch.ts apps/api/src/services/cron/__tests__/scheduled-follow-up-dispatch.test.ts
git commit -m "feat(followup): scheduled-follow-up-dispatch firing cron"
```

### 8b — Bootstrap wiring (submit closure + cron registration)

- [ ] **Step 6: Build `submitScheduledFollowUp` in `contained-workflows.ts`**

Where `createSubmitChildWork` is built (it has `platformIngress` + `deploymentResolver` in scope, ~line 134), add a top-level submit closure for the cron (no `parentWorkUnitId`):

```ts
const submitScheduledFollowUp = async (input: {
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  channel: string;
  templateIntentClass: string;
  reason: string;
  followUpId: string;
}): Promise<SubmitWorkResponse> => {
  const deployment = await resolveDeploymentForIntent(
    deploymentResolver,
    input.organizationId,
    "conversation.followup.send",
  );
  return platformIngress.submit({
    organizationId: input.organizationId,
    actor: { id: "system:scheduled-follow-up", type: "system" },
    intent: "conversation.followup.send",
    parameters: {
      contactId: input.contactId,
      conversationThreadId: input.conversationThreadId,
      channel: input.channel,
      templateIntentClass: input.templateIntentClass,
      reason: input.reason,
      followUpId: input.followUpId,
    },
    trigger: "schedule",
    surface: { surface: "api" },
    idempotencyKey: `followup-send:${input.followUpId}`,
    targetHint: deployment
      ? { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug }
      : undefined,
  });
};
```

Add `submitScheduledFollowUp` to whatever `bootstrapContainedWorkflows` returns/attaches (the same return object that already exposes `instantFormAdapter`). Reuse the existing `SubmitWorkResponse` import (`workflow-mode.ts`/`platform-ingress.ts` already provide it in this file).

- [ ] **Step 7: Thread it to `registerInngest` (mirror `instantFormAdapter`)**

In `apps/api/src/app.ts`, where `registerInngest(app, { instantFormAdapter, operatorAlerter })` is called (~line 867), add `submitScheduledFollowUp` to the options object (sourced from the `bootstrapContainedWorkflows` result, exactly as `instantFormAdapter` is). In `apps/api/src/bootstrap/inngest.ts`, add the field to `RegisterInngestOptions`:

```ts
  submitScheduledFollowUp?: (input: {
    organizationId: string;
    contactId: string;
    conversationThreadId: string | null;
    channel: string;
    templateIntentClass: string;
    reason: string;
    followUpId: string;
  }) => Promise<import("@switchboard/core/platform").SubmitWorkResponse>;
```

- [ ] **Step 8: Build the cron deps + register it in `inngest.ts`**

Add the import near `createLeadRetryCron` (~line 77):

```ts
import { createScheduledFollowUpDispatchCron } from "../services/cron/scheduled-follow-up-dispatch.js";
import type { ScheduledFollowUpDispatchDeps } from "../services/cron/scheduled-follow-up-dispatch.js";
```

Inside `registerInngest`, after `asyncFailure` (~line 311), build the deps using a `PrismaScheduledFollowUpStore` and the threaded closure (guard if the closure is absent — `requireX`-style or skip registration):

```ts
const followUpStore = new PrismaScheduledFollowUpStore(app.prisma);
const scheduledFollowUpDispatchDeps: ScheduledFollowUpDispatchDeps = {
  failure: asyncFailure,
  findDueFollowUps: () => followUpStore.findDue(new Date(), 100),
  submitFollowUpSend: (input) => {
    if (!options.submitScheduledFollowUp) {
      throw new Error("submitScheduledFollowUp not wired");
    }
    return options.submitScheduledFollowUp(input);
  },
  markSent: (id) => followUpStore.markSent(id),
  markSkipped: (id, reason) => followUpStore.markSkipped(id, reason),
  markFailed: (id, error, nextRetryAt) => followUpStore.markFailed(id, error, nextRetryAt),
};
```

Add to the `functions: [...]` array (~line 801, next to `createLeadRetryCron(leadRetryDeps)`):

```ts
      createScheduledFollowUpDispatchCron(scheduledFollowUpDispatchDeps),
```

(Import `PrismaScheduledFollowUpStore` from `@switchboard/db` at the top of `inngest.ts` alongside the other store imports.)

- [ ] **Step 9: Typecheck + the api suite — expect PASS**

Run: `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api test`
Expected: PASS. (If `@switchboard/core`/`@switchboard/db` exports look missing, run `pnpm reset` then a full `pnpm build` — `reset` skips ad-optimizer/creative-pipeline; per memory the full build fixes the false cascade.)

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/bootstrap/contained-workflows.ts apps/api/src/app.ts apps/api/src/bootstrap/inngest.ts
git commit -m "feat(followup): register dispatch cron + thread ingress submit closure"
```

---

## Task 9: Whole-PR fail-closed integration test + final verification

**Files:**

- Create: `apps/api/src/services/workflows/__tests__/followup-fail-closed-integration.test.ts`

- [ ] **Step 1: Write the integration test** (cron executor → real eligibility gate → real registry defaults ⇒ every due follow-up is skipped `template_not_approved`, nothing is "sent")

```ts
// apps/api/src/services/workflows/__tests__/followup-fail-closed-integration.test.ts
import { describe, it, expect, vi } from "vitest";
import { executeScheduledFollowUpDispatch } from "../../cron/scheduled-follow-up-dispatch.js";
import { buildConversationFollowUpSendWorkflow } from "../conversation-followup-send-workflow.js";

/**
 * Producer-population proof: with today's real WHATSAPP_TEMPLATES (all draft),
 * an opted-in, consented, out-of-window contact still results in NO send — the
 * gate fails closed with template_not_approved. This guards the whole pipeline
 * against an accidental ungated send if a producer/default changes.
 */
describe("follow-up fail-closed integration", () => {
  it("a fully-eligible-except-template contact is skipped, never sent", async () => {
    const handler = buildConversationFollowUpSendWorkflow({
      // NOTE: no selectTemplateFn → uses the REAL registry (all draft today).
      allowMarketingTemplate: true,
      getSendContext: vi.fn().mockResolvedValue({
        consentGrantedAt: "2026-05-01T00:00:00.000Z",
        consentRevokedAt: null,
        pdpaJurisdiction: "SG",
        messagingOptIn: true,
        lastWhatsAppInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        jurisdiction: "SG",
        leadName: "Jane",
        businessName: "Glow Clinic",
      }),
    });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const markSkipped = vi.fn();
    const markSent = vi.fn();
    const result = await executeScheduledFollowUpDispatch(
      { run: async <T>(_n: string, fn: () => T | Promise<T>): Promise<T> => fn() },
      {
        failure: {
          auditLedger: { record: vi.fn() },
          operatorAlerter: { alert: vi.fn() },
          inngest: { send: vi.fn() },
        } as never,
        findDueFollowUps: vi.fn().mockResolvedValue([
          {
            id: "fu_1",
            organizationId: "org_1",
            contactId: "contact_1",
            conversationThreadId: "thread_1",
            channel: "whatsapp",
            templateIntentClass: "re-engagement-offer",
            reason: "went_quiet",
            attempts: 0,
          },
        ]),
        // Route the submit through the REAL handler (no ingress) to prove the gate.
        submitFollowUpSend: async (input) => {
          const r = await handler.execute(
            {
              id: "wu_1",
              organizationId: input.organizationId,
              actor: { id: "system:scheduled-follow-up", type: "system" },
              intent: "conversation.followup.send",
              parameters: input,
              deployment: {
                deploymentId: "dep_1",
                skillSlug: "alex",
                trustLevel: "guided",
                trustScore: 0,
              },
              resolvedMode: "workflow",
              traceId: "trace_1",
              trigger: "schedule",
              priority: "normal",
            } as never,
            { submitChildWork: vi.fn() },
          );
          return { ok: true, result: r as never, workUnit: {} as never };
        },
        markSent,
        markSkipped,
        markFailed: vi.fn(),
      },
    );

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(markSent).not.toHaveBeenCalled();
    expect(markSkipped).toHaveBeenCalledWith("fu_1", "template_not_approved");
    expect(fetchSpy).not.toHaveBeenCalled(); // never reached the Graph API
  });
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `pnpm --filter @switchboard/api test followup-fail-closed-integration`
Expected: PASS — proves nothing is sent under today's real registry.

- [ ] **Step 3: Full verification across the monorepo**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm format:check
pnpm --filter @switchboard/dashboard build   # only if any dashboard file changed (it shouldn't here)
```

Expected: all green. Fix any failures before committing. (Known-flaky tests to ignore per memory: pg_advisory_xact_lock integrity tests, api bootstrap-smoke npm-warn, gateway-bridge-attribution under full-suite load.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/workflows/__tests__/followup-fail-closed-integration.test.ts
git commit -m "test(followup): whole-pipeline fail-closed proof on real registry"
```

- [ ] **Step 5: Push + open the implementation PR (do NOT merge)**

```bash
git push -u origin <implementation-branch>
gh pr create --base main --title "feat(followup): Alex governed follow-up capability" --body "<summary + activation checklist + 'PR not merge — for review'>"
```

---

## Activation checklist (post-merge, documented — feature is inert-but-safe until)

1. Meta approves `alex_re_engagement_offer_{sg,my}_v1`; flip `approvalStatus` → `"approved"` in `packages/core/src/skill-runtime/templates/whatsapp-registry.ts`.
2. Set `FOLLOWUP_ALLOW_MARKETING_TEMPLATE=true` for the deployment.
3. Confirm target contacts are `messagingOptIn` (or in-window) and PDPA `granted`/`not_applicable`.
4. Confirm `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` are set in the api environment.

Until all hold, every due follow-up records a `skipReason` (no silent caps) and sends nothing.

---

## Self-review (run before handoff)

- **Spec coverage:** Leg A (tool) = Task 6; firing cron = Task 8; eligibility gate = Task 5; schema/store = Tasks 1–3; window-helper promotion = Task 4; send handler = Task 7; fail-closed proof = Task 9. Idempotency model + MVP-dedupe-guard documented in the header + Task 6. ✅
- **Placeholder scan:** Two explicitly-flagged plan-level confirmations remain (the Contact `select` field names in Task 7 Step 5, and the `to`=phone-vs-contactId mapping) — both are "verify the exact column name against `schema.prisma`," not unwritten code; the contract (`getSendContext`'s return shape, the handler body) is complete. No `TBD`/`implement later`. ✅
- **Type consistency:** `ScheduledFollowUpStore` / `DueScheduledFollowUp` / `CreateScheduledFollowUpInput` (Task 3) are used verbatim by the store (Task 3), tool (Task 6), and cron (Task 8). `ProactiveSkipReason` (Task 1) is returned by the gate (Task 5) and consumed by the handler/cron. `evaluateProactiveSendEligibility`'s signature (Task 5) matches its call in Task 7. `FollowUpSendSubmitInput`/`submitScheduledFollowUp` parameter shapes match across Tasks 7/8. ✅
