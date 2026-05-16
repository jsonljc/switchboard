# Calendar Per-Request Provider Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boot-time `CalendarProvider` singleton with a per-org `CalendarProviderFactory` so each org's calendar tool calls resolve a provider scoped to that org's `businessHours`/credentials.

**Architecture:** New `apps/api/src/bootstrap/calendar-provider-factory.ts` module owns per-org resolution and Promise-cached memoization with rejection cleanup. `calendar-book` accepts a factory + `isCalendarProviderConfigured` capability predicate (no app-level Noop concept in core). `slots.query` and `booking.create` fail visibly on missing orgId, factory rejection, or unconfigured provider — no fake-success.

**Tech Stack:** TypeScript ESM, pnpm + Turborepo, Vitest, Prisma. Constraints: file-size warn 400 / error 600; conventional commits; co-located tests; no `apps/api` ↔ `apps/chat` cross-imports; `packages/core` cannot import from `apps/`.

**Spec:** `docs/superpowers/specs/2026-04-28-fix-launch-calendar-per-request-resolution-design.md`

---

## File Structure

**Created:**
- `apps/api/src/bootstrap/calendar-provider-factory.ts` — factory closure with per-org Promise cache; owns the `Google → Local → Noop` precedence currently in `resolveCalendarProvider`.
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts` — factory-layer unit tests (8 cases).

**Modified:**
- `apps/api/src/bootstrap/noop-calendar-provider.ts` — add exported `isNoopCalendarProvider(provider)` helper.
- `apps/api/src/bootstrap/skill-mode.ts` — remove `resolveCalendarProvider`; wire factory + capability predicate into `createCalendarBookTool`.
- `packages/core/src/skill-runtime/tools/calendar-book.ts` — replace `calendarProvider` dep with `calendarProviderFactory` + `isCalendarProviderConfigured`; add per-operation guards; add `orgId` to `slots.query` schema.
- `packages/core/src/skill-runtime/tools/calendar-book.test.ts` — update existing test scaffolding; add 8 new failure-path tests.

**Untouched (verify by spec discipline):**
- `packages/core/src/calendar/local-calendar-provider.ts`
- `apps/api/src/lib/calendar-readiness.ts` and `apps/api/src/routes/readiness.ts`
- `packages/core/src/skill-runtime/skill-executor.ts` and `types.ts`
- `apps/api/src/bootstrap/google-calendar-factory.ts`
- `packages/core/src/skill-runtime/tools/escalate.ts`

---

## Task 1: Read-only verification (Section 4 of spec)

No code changes. If any check fails, stop and revise the spec.

**Files:**
- Read: `apps/api/src/bootstrap/skill-mode.ts`
- Read: `apps/api/src/bootstrap/noop-calendar-provider.ts`
- Read: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Read: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`
- Read: `packages/core/src/skill-runtime/tool-result.ts`
- Read: `packages/schemas/src/calendar.ts` (or wherever `CalendarProvider` is exported from)

- [ ] **Step 1: Confirm `CalendarProvider` interface shape**

```bash
rg -n "export (type|interface) CalendarProvider" packages/schemas/src
```

Expected: a single export site declaring `listAvailableSlots`, `createBooking`, `cancelBooking`, `rescheduleBooking`, `getBooking`, `healthCheck`. **Hard stop:** if a `kind`/`status` discriminator already exists, prefer it over `isCalendarProviderConfigured` and revise Section 3 of the spec before continuing.

- [ ] **Step 2: Confirm `NoopCalendarProvider` path and exports**

```bash
ls apps/api/src/bootstrap/noop-calendar-provider.ts
rg -n "export" apps/api/src/bootstrap/noop-calendar-provider.ts
```

Expected: file exists; exports `class NoopCalendarProvider`; no `isNoopCalendarProvider` helper yet (we will add). **Hard stop:** if the noop provider lives in `packages/core`, layering rationale must be revised.

- [ ] **Step 3: Confirm `OrganizationConfig.findFirst` query shape used today**

```bash
sed -n '273,295p' apps/api/src/bootstrap/skill-mode.ts
```

Expected: `where: { id: orgId }` with `select: { businessHours: true }`. **Hard stop:** if a different field name is in use, mirror that verbatim in the new factory.

- [ ] **Step 4: Confirm calendar-book test file and mock pattern**

```bash
ls packages/core/src/skill-runtime/tools/calendar-book.test.ts
rg -n "calendarProvider:" packages/core/src/skill-runtime/tools/calendar-book.test.ts | head
```

Expected: file exists; uses `vi.fn()` mock factory functions and direct deps injection.

- [ ] **Step 5: Confirm `fail()` signature in `tool-result.ts`**

```bash
rg -n "export function fail" packages/core/src/skill-runtime/tool-result.ts
```

Expected: legacy form `fail(code, message, opts?)` accepting `{ modelRemediation?, retryable?, data? }`. New failures will use this form.

- [ ] **Step 6: Confirm logger interface used at bootstrap call site**

```bash
rg -n "logger" apps/api/src/bootstrap/skill-mode.ts | head -10
```

Inspect the type passed to `bootstrapSkillMode`. If structured args are used (e.g., `logger.info({ orgId }, "msg")`), the factory's `logger` type must be widened to match. Today's signature: `{ info(msg: string): void; error(msg: string): void }` — replace the spec's placeholder with this exact shape unless the actual logger differs.

- [ ] **Step 7: Confirm no other consumers of `resolveCalendarProvider`**

```bash
rg -n "resolveCalendarProvider" --glob '!.claude/**' --glob '!node_modules/**'
```

Expected: only `apps/api/src/bootstrap/skill-mode.ts`. **Hard stop:** if a second consumer exists, surface it before deletion.

- [ ] **Step 8: Confirm `createCalendarBookTool` call sites**

```bash
rg -n "createCalendarBookTool\(" --glob '!.claude/**' --glob '!node_modules/**'
```

Expected: one production call site (`apps/api/src/bootstrap/skill-mode.ts`) plus the test file. **Hard stop:** if another non-test consumer exists outside `bootstrap/skill-mode.ts`, surface it.

- [ ] **Step 9: Confirm `slots.query` callers are LLM-only**

```bash
rg -n "slots\.query|slots-query" --glob '!.claude/**' --glob '!node_modules/**' --glob '!docs/**'
```

Expected: only the tool definition itself, the LLM tool-calling path in `skill-executor.ts`, and tests. **Hard stop:** if a programmatic caller exists, document it and decide between (a) updating the caller and (b) leaving `orgId` optional in the schema with runtime `ORG_ID_REQUIRED` failure.

- [ ] **Step 10: Confirm Google env is global, not per-org**

```bash
rg -n "GOOGLE_CALENDAR_CREDENTIALS|GOOGLE_CALENDAR_ID" --glob '!.claude/**' --glob '!node_modules/**'
```

Expected: read from `process.env` at the resolver only. **Hard stop:** if any per-org Google config exists today, the factory must preserve that.

- [ ] **Step 11: Confirm core does not import from apps**

```bash
rg -n "@switchboard/api|apps/api" packages/core/src
```

Expected: no matches. Layering must remain intact in this PR.

- [ ] **Step 12: Confirm tool schemas are not snapshotted elsewhere**

```bash
rg -n "slots.query|slots-query" --glob '!.claude/**' --glob '!node_modules/**' -t ts -t json | grep -i 'snapshot\|fixture\|schema' || echo "no snapshots found"
```

Inspect any matches. If snapshots/fixtures pin the current `slots.query` schema, plan an update pass for them.

- [ ] **Step 13: Capture baseline test/typecheck signal**

```bash
pnpm --filter @switchboard/core test calendar-book 2>&1 | tail -20
pnpm --filter @switchboard/api test calendar 2>&1 | tail -20
pnpm typecheck 2>&1 | tail -20
```

Expected: all green. Capture the exact pass count for `calendar-book.test.ts` so additive tests can be confirmed in Task 7.

- [ ] **Step 14: Commit a checkpoint note**

```bash
git status
```

Expected: clean tree (no code edits). No commit in this task.

---

## Task 2: Add `isNoopCalendarProvider` helper

**Files:**
- Modify: `apps/api/src/bootstrap/noop-calendar-provider.ts`
- Test: `apps/api/src/bootstrap/__tests__/noop-calendar-provider.test.ts` (create if absent)

- [ ] **Step 1: Write failing test**

If the test file does not exist, create `apps/api/src/bootstrap/__tests__/noop-calendar-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  NoopCalendarProvider,
  isNoopCalendarProvider,
} from "../noop-calendar-provider.js";

describe("isNoopCalendarProvider", () => {
  it("returns true for a NoopCalendarProvider instance", () => {
    expect(isNoopCalendarProvider(new NoopCalendarProvider())).toBe(true);
  });

  it("returns false for a non-Noop provider", () => {
    const fake = {
      listAvailableSlots: async () => [],
      createBooking: async () => ({}) as never,
      cancelBooking: async () => undefined,
      rescheduleBooking: async () => ({}) as never,
      getBooking: async () => null,
      healthCheck: async () => ({ status: "connected", latencyMs: 5 }) as never,
    };
    expect(isNoopCalendarProvider(fake as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @switchboard/api test noop-calendar-provider
```

Expected: FAIL — `isNoopCalendarProvider is not a function`.

- [ ] **Step 3: Implement helper**

In `apps/api/src/bootstrap/noop-calendar-provider.ts`, append:

```ts
import type { CalendarProvider } from "@switchboard/schemas";

export function isNoopCalendarProvider(provider: CalendarProvider): boolean {
  return provider instanceof NoopCalendarProvider;
}
```

(`CalendarProvider` is already implicitly used; if not already imported as a type, add it.)

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter @switchboard/api test noop-calendar-provider
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/noop-calendar-provider.ts \
        apps/api/src/bootstrap/__tests__/noop-calendar-provider.test.ts
git commit -m "feat(calendar): export isNoopCalendarProvider helper"
```

---

## Task 3: Create `CalendarProviderFactory` module — empty orgId guard + cache shape

TDD start. Build the factory in slices: guard, cache identity, then resolution branches.

**Files:**
- Create: `apps/api/src/bootstrap/calendar-provider-factory.ts`
- Create: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`

- [ ] **Step 1: Write failing test for missing/empty orgId**

Create `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCalendarProviderFactory } from "../calendar-provider-factory.js";

function makePrisma(rowByOrg: Record<string, { businessHours: unknown } | null>) {
  return {
    organizationConfig: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        return rowByOrg[where.id] ?? null;
      }),
    },
  };
}

const silentLogger = { info: () => {}, error: () => {} };

describe("createCalendarProviderFactory: input validation", () => {
  it("rejects with ORG_ID_REQUIRED when orgId is empty string", async () => {
    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({}) as never,
      logger: silentLogger,
      env: {},
    });

    await expect(factory("")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });

  it("rejects with ORG_ID_REQUIRED when orgId is whitespace-only", async () => {
    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({}) as never,
      logger: silentLogger,
      env: {},
    });

    await expect(factory("   ")).rejects.toThrow(/ORG_ID_REQUIRED/);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @switchboard/api test calendar-provider-factory
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create factory skeleton**

Create `apps/api/src/bootstrap/calendar-provider-factory.ts`:

```ts
import type { PrismaClient } from "@switchboard/db";
import type { CalendarProvider } from "@switchboard/schemas";

export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

export interface CalendarProviderFactoryDeps {
  prismaClient: PrismaClient;
  // Matches the existing bootstrap logger shape. Confirmed in Task 1, Step 6.
  logger: { info(msg: string): void; error(msg: string): void };
  // Optional env injection for tests; falls back to process.env.
  env?: { GOOGLE_CALENDAR_CREDENTIALS?: string; GOOGLE_CALENDAR_ID?: string };
}

export function createCalendarProviderFactory(
  deps: CalendarProviderFactoryDeps,
): CalendarProviderFactory {
  // No eviction in beta (~10 orgs, process-lifetime cache mirrors today's
  // singleton lifetime per orgId). Production should add TTL or explicit
  // invalidation if calendar credentials/business hours can rotate at runtime.
  const cache = new Map<string, Promise<CalendarProvider>>();

  const factory: CalendarProviderFactory = (orgId: string) => {
    if (!orgId || typeof orgId !== "string" || orgId.trim() === "") {
      return Promise.reject(new Error("ORG_ID_REQUIRED"));
    }

    const existing = cache.get(orgId);
    if (existing) return existing;

    const promise = resolveForOrg(deps, orgId).catch((error) => {
      cache.delete(orgId);
      throw error;
    });

    cache.set(orgId, promise);
    return promise;
  };

  return factory;
}

async function resolveForOrg(
  _deps: CalendarProviderFactoryDeps,
  _orgId: string,
): Promise<CalendarProvider> {
  // Placeholder — implemented in Task 4.
  throw new Error("NOT_IMPLEMENTED");
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter @switchboard/api test calendar-provider-factory
```

Expected: both validation tests PASS. Note: the cache cleanup is exercised here only by the rejection cases — empty orgId never reaches `resolveForOrg` so `NOT_IMPLEMENTED` is not thrown.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/calendar-provider-factory.ts \
        apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts
git commit -m "feat(calendar): add CalendarProviderFactory module skeleton"
```

---

## Task 4: Implement `resolveForOrg` — Google / Local / Noop precedence

**Files:**
- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts`
- Modify: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`

- [ ] **Step 1: Add failing tests for resolution branches**

Append to `calendar-provider-factory.test.ts`:

```ts
import { isNoopCalendarProvider, NoopCalendarProvider } from "../noop-calendar-provider.js";

describe("createCalendarProviderFactory: Noop fallback", () => {
  it("returns NoopCalendarProvider when org has no businessHours and no Google env", async () => {
    const prisma = makePrisma({ "org-A": { businessHours: null } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const provider = await factory("org-A");

    expect(isNoopCalendarProvider(provider)).toBe(true);
  });

  it("returns NoopCalendarProvider when OrganizationConfig row is missing", async () => {
    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({}) as never,
      logger: silentLogger,
      env: {},
    });

    expect(isNoopCalendarProvider(await factory("org-missing"))).toBe(true);
  });

  it("treats array businessHours as not configured (Noop)", async () => {
    const prisma = makePrisma({ "org-A": { businessHours: [] } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    expect(isNoopCalendarProvider(await factory("org-A"))).toBe(true);
  });
});

describe("createCalendarProviderFactory: Local provider", () => {
  it("returns a non-Noop provider when businessHours object is present", async () => {
    const prisma = makePrisma({
      "org-local": {
        businessHours: { mon: [{ start: "09:00", end: "17:00" }] },
      },
    });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const provider = await factory("org-local");

    expect(isNoopCalendarProvider(provider)).toBe(false);
    expect(provider).not.toBeInstanceOf(NoopCalendarProvider);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
pnpm --filter @switchboard/api test calendar-provider-factory
```

Expected: FAIL — `NOT_IMPLEMENTED`.

- [ ] **Step 3: Implement `resolveForOrg`**

Replace the placeholder in `apps/api/src/bootstrap/calendar-provider-factory.ts`:

```ts
import type { PrismaClient } from "@switchboard/db";
import type { CalendarProvider, BusinessHoursConfig } from "@switchboard/schemas";
import { NoopCalendarProvider } from "./noop-calendar-provider.js";

async function resolveForOrg(
  deps: CalendarProviderFactoryDeps,
  orgId: string,
): Promise<CalendarProvider> {
  const env = deps.env ?? {
    GOOGLE_CALENDAR_CREDENTIALS: process.env["GOOGLE_CALENDAR_CREDENTIALS"],
    GOOGLE_CALENDAR_ID: process.env["GOOGLE_CALENDAR_ID"],
  };

  // Mirrors today's runtime query shape (skill-mode.ts resolveCalendarProvider,
  // confirmed in Task 1 Step 3). Do not "fix" the field name in this PR.
  const orgConfig = await deps.prismaClient.organizationConfig.findFirst({
    where: { id: orgId },
    select: { businessHours: true },
  });

  let businessHours: BusinessHoursConfig | null = null;
  if (
    orgConfig?.businessHours &&
    typeof orgConfig.businessHours === "object" &&
    !Array.isArray(orgConfig.businessHours)
  ) {
    businessHours = orgConfig.businessHours as BusinessHoursConfig;
  }

  // Option 1: Google Calendar (global env today; per-org credentials is future work).
  if (env.GOOGLE_CALENDAR_CREDENTIALS && env.GOOGLE_CALENDAR_ID) {
    try {
      const { createGoogleCalendarProvider } = await import("./google-calendar-factory.js");
      const provider = await createGoogleCalendarProvider({
        credentials: env.GOOGLE_CALENDAR_CREDENTIALS,
        calendarId: env.GOOGLE_CALENDAR_ID,
        businessHours,
      });
      const health = await provider.healthCheck();
      deps.logger.info(
        `Calendar[${orgId}]: Google Calendar connected (${health.status}, ${health.latencyMs}ms)`,
      );
      return provider;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Calendar[${orgId}]: failed to initialize Google Calendar: ${msg}`);
      // Fall through to Local if businessHours available.
    }
  }

  // Option 2: Local provider (per-org businessHours).
  if (businessHours) {
    const { LocalCalendarProvider } = await import("@switchboard/core/calendar");

    const localStore = buildLocalStore(deps.prismaClient);

    const provider = new LocalCalendarProvider({
      businessHours,
      bookingStore: localStore,
    });
    deps.logger.info(
      `Calendar[${orgId}]: using LocalCalendarProvider (business hours configured, no Google creds)`,
    );
    return provider;
  }

  // Option 3: Noop.
  deps.logger.info(
    `Calendar[${orgId}]: using NoopCalendarProvider (no calendar configured, bookings disabled)`,
  );
  return new NoopCalendarProvider();
}

function buildLocalStore(prismaClient: PrismaClient) {
  return {
    findOverlapping: async (filterOrgId: string, startsAt: Date, endsAt: Date) => {
      return prismaClient.booking.findMany({
        where: {
          organizationId: filterOrgId || undefined,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          status: { notIn: ["cancelled", "failed"] },
        },
        select: { startsAt: true, endsAt: true },
      });
    },
    createInTransaction: async (input: {
      organizationId: string;
      contactId: string;
      opportunityId?: string | null;
      service: string;
      startsAt: Date;
      endsAt: Date;
      timezone: string;
      status: string;
      calendarEventId: string;
      attendeeName?: string | null;
      attendeeEmail?: string | null;
      createdByType: string;
      sourceChannel?: string | null;
      workTraceId?: string | null;
    }) => {
      return prismaClient.$transaction(async (tx) => {
        const conflicts = await tx.booking.findMany({
          where: {
            organizationId: input.organizationId,
            startsAt: { lt: input.endsAt },
            endsAt: { gt: input.startsAt },
            status: { notIn: ["cancelled", "failed"] },
          },
          select: { id: true },
          take: 1,
        });
        if (conflicts.length > 0) {
          throw new Error("SLOT_CONFLICT");
        }
        return tx.booking.create({
          data: {
            organizationId: input.organizationId,
            contactId: input.contactId,
            opportunityId: input.opportunityId ?? null,
            service: input.service,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            timezone: input.timezone,
            status: input.status,
            calendarEventId: input.calendarEventId,
            attendeeName: input.attendeeName ?? null,
            attendeeEmail: input.attendeeEmail ?? null,
            createdByType: input.createdByType,
            sourceChannel: input.sourceChannel ?? null,
            workTraceId: input.workTraceId ?? null,
          },
          select: { id: true },
        });
      });
    },
    findById: async (bookingId: string) => {
      const row = await prismaClient.booking.findUnique({ where: { id: bookingId } });
      if (!row) return null;
      return {
        id: row.id,
        contactId: row.contactId,
        organizationId: row.organizationId,
        opportunityId: row.opportunityId ?? null,
        service: row.service,
        status: row.status as "confirmed" | "cancelled" | "pending_confirmation",
        calendarEventId: row.calendarEventId ?? null,
        attendeeName: row.attendeeName ?? null,
        attendeeEmail: row.attendeeEmail ?? null,
        notes: null,
        createdByType: (row.createdByType ?? "agent") as "agent" | "human" | "contact",
        sourceChannel: row.sourceChannel ?? null,
        workTraceId: row.workTraceId ?? null,
        rescheduledAt: null,
        rescheduleCount: 0,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        timezone: row.timezone ?? "Asia/Singapore",
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
    cancel: async (bookingId: string) => {
      await prismaClient.booking.update({
        where: { id: bookingId },
        data: { status: "cancelled" },
      });
    },
    reschedule: async (bookingId: string, newSlot: { start: string; end: string }) => {
      const updated = await prismaClient.booking.update({
        where: { id: bookingId },
        data: {
          startsAt: new Date(newSlot.start),
          endsAt: new Date(newSlot.end),
          rescheduleCount: { increment: 1 },
        },
        select: { id: true },
      });
      return { id: updated.id };
    },
  };
}
```

This is a faithful clone of `resolveCalendarProvider`'s `localStore` (verbatim from current `skill-mode.ts:319–427`) plus the Google/Local/Noop precedence. **Do not change semantics** — Task 1 Step 3 confirmed the query shape; Task 1 Step 10 confirmed Google env is global.

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter @switchboard/api test calendar-provider-factory
```

Expected: 5 PASS (2 from Task 3 + 3 Noop branch + 1 Local).

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/calendar-provider-factory.ts \
        apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts
git commit -m "feat(calendar): implement Google/Local/Noop resolution per orgId"
```

---

## Task 5: Cache behavior tests (memoization, rejection cleanup, concurrency)

**Files:**
- Modify: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts`

- [ ] **Step 1: Add failing tests for cache identity**

Append to the test file:

```ts
describe("createCalendarProviderFactory: memoization", () => {
  it("returns the same Promise for the same orgId across calls", async () => {
    const prisma = makePrisma({ "org-A": { businessHours: null } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const p1 = factory("org-A");
    const p2 = factory("org-A");

    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
    expect(prisma.organizationConfig.findFirst).toHaveBeenCalledTimes(1);
  });

  it("returns independent providers for different orgIds", async () => {
    const prisma = makePrisma({
      "org-A": { businessHours: { mon: [{ start: "09:00", end: "17:00" }] } },
      "org-B": { businessHours: null },
    });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const [a, b] = await Promise.all([factory("org-A"), factory("org-B")]);

    expect(isNoopCalendarProvider(a)).toBe(false);
    expect(isNoopCalendarProvider(b)).toBe(true);
    expect(prisma.organizationConfig.findFirst).toHaveBeenCalledTimes(2);
  });

  it("concurrent first calls for the same org share construction", async () => {
    const prisma = makePrisma({ "org-A": { businessHours: null } });
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    const [a, b] = await Promise.all([factory("org-A"), factory("org-A")]);

    expect(a).toBe(b);
    expect(prisma.organizationConfig.findFirst).toHaveBeenCalledTimes(1);
  });

  it("rejected construction is cleared from cache so a later call can retry", async () => {
    let attempt = 0;
    const prisma = {
      organizationConfig: {
        findFirst: vi.fn(async () => {
          attempt += 1;
          if (attempt === 1) throw new Error("DB connection lost");
          return { businessHours: null };
        }),
      },
    };
    const factory = createCalendarProviderFactory({
      prismaClient: prisma as never,
      logger: silentLogger,
      env: {},
    });

    await expect(factory("org-A")).rejects.toThrow(/DB connection lost/);

    // Second call must NOT receive the rejected promise.
    const provider = await factory("org-A");
    expect(isNoopCalendarProvider(provider)).toBe(true);
    expect(prisma.organizationConfig.findFirst).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify pass**

The behaviors tested are already implemented in Task 3's skeleton. They should pass without further code changes.

```bash
pnpm --filter @switchboard/api test calendar-provider-factory
```

Expected: all PASS (validation 2 + Noop 3 + Local 1 + memoization 4 = 10).

If any test fails, fix the implementation rather than the test.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts
git commit -m "test(calendar): pin factory memoization, concurrency, and rejection cleanup"
```

---

## Task 6: Update `calendar-book` deps + per-operation guards

**Files:**
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Write failing tests for new deps shape and failure paths**

Replace the test scaffolding at the top of `calendar-book.test.ts` (the `beforeEach` block) and add new test cases. Final scaffolding:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCalendarBookTool } from "./calendar-book.js";

function makeCalendarProvider() {
  return {
    listAvailableSlots: vi.fn(),
    createBooking: vi.fn(),
  };
}

function makeBookingStore() {
  return { create: vi.fn(), findBySlot: vi.fn() };
}

function makeOpportunityStore() {
  return { findActiveByContact: vi.fn(), create: vi.fn() };
}

function makeRunTransaction() {
  return vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      booking: {
        update: vi
          .fn()
          .mockResolvedValue({ id: "bk_1", status: "confirmed", calendarEventId: "gcal_1" }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({ id: "ob_1" }) },
    }),
  );
}

function makeFailureHandler() {
  return {
    handle: vi.fn().mockResolvedValue({
      bookingId: "bk_1",
      status: "failed",
      failureType: "provider_error",
      retryable: false,
      escalationId: "esc_1",
      message:
        "I couldn't complete the booking just now. I've flagged this for a human to follow up.",
    }),
  };
}

describe("createCalendarBookTool", () => {
  let calendarProvider: ReturnType<typeof makeCalendarProvider>;
  let calendarProviderFactory: ReturnType<typeof vi.fn>;
  let isCalendarProviderConfigured: ReturnType<typeof vi.fn>;
  let bookingStore: ReturnType<typeof makeBookingStore>;
  let opportunityStore: ReturnType<typeof makeOpportunityStore>;
  let runTransaction: ReturnType<typeof makeRunTransaction>;
  let failureHandler: ReturnType<typeof makeFailureHandler>;
  let tool: ReturnType<typeof createCalendarBookTool>;

  beforeEach(() => {
    calendarProvider = makeCalendarProvider();
    calendarProviderFactory = vi.fn(async (_orgId: string) => calendarProvider as never);
    isCalendarProviderConfigured = vi.fn(() => true);
    bookingStore = makeBookingStore();
    opportunityStore = makeOpportunityStore();
    runTransaction = makeRunTransaction();
    failureHandler = makeFailureHandler();
    tool = createCalendarBookTool({
      calendarProviderFactory: calendarProviderFactory as never,
      isCalendarProviderConfigured: isCalendarProviderConfigured as never,
      bookingStore: bookingStore as never,
      opportunityStore: opportunityStore as never,
      runTransaction: runTransaction as never,
      failureHandler: failureHandler as never,
    });
  });

  // ... existing tests ("has id", governance tier, idempotent, slots.query delegates,
  // booking.create persists, opportunity creation, duplicate, calendar throws,
  // confirm transaction fails) carry over UNCHANGED except slots.query call now
  // includes orgId: "org_1".
```

Update the existing `slots.query delegates to calendarProvider` test to pass `orgId`:

```ts
  it("slots.query delegates to calendarProvider", async () => {
    const mockSlots = [
      {
        start: "2026-04-20T10:00:00+08:00",
        end: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
        available: true,
      },
    ];
    calendarProvider.listAvailableSlots.mockResolvedValue(mockSlots);

    const result = await tool.operations["slots.query"]!.execute({
      orgId: "org_1",
      dateFrom: "2026-04-20T00:00:00+08:00",
      dateTo: "2026-04-20T23:59:59+08:00",
      durationMinutes: 30,
      service: "consultation",
      timezone: "Asia/Singapore",
    });

    expect(calendarProviderFactory).toHaveBeenCalledWith("org_1");
    expect(calendarProvider.listAvailableSlots).toHaveBeenCalled();
    expect(result.status).toBe("success");
    expect(result.data?.slots).toEqual(mockSlots);
  });
```

Append the 8 new failure-path tests:

```ts
  describe("slots.query failure paths", () => {
    it("fails ORG_ID_REQUIRED when orgId missing", async () => {
      const result = await tool.operations["slots.query"]!.execute({
        dateFrom: "2026-04-20T00:00:00+08:00",
        dateTo: "2026-04-20T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("ORG_ID_REQUIRED");
      expect(calendarProviderFactory).not.toHaveBeenCalled();
    });

    it("fails ORG_ID_REQUIRED when orgId is whitespace", async () => {
      const result = await tool.operations["slots.query"]!.execute({
        orgId: "   ",
        dateFrom: "2026-04-20T00:00:00+08:00",
        dateTo: "2026-04-20T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("ORG_ID_REQUIRED");
    });

    it("fails CALENDAR_NOT_CONFIGURED when provider is unconfigured (no slots leak)", async () => {
      isCalendarProviderConfigured.mockReturnValue(false);

      const result = await tool.operations["slots.query"]!.execute({
        orgId: "org_1",
        dateFrom: "2026-04-20T00:00:00+08:00",
        dateTo: "2026-04-20T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_NOT_CONFIGURED");
      expect(result.error?.modelRemediation).toMatch(/Escalate to the operator/);
      expect(result.data?.slots).toBeUndefined();
      expect(calendarProvider.listAvailableSlots).not.toHaveBeenCalled();
    });

    it("fails CALENDAR_PROVIDER_ERROR when factory rejects", async () => {
      calendarProviderFactory.mockRejectedValue(new Error("Boom"));

      const result = await tool.operations["slots.query"]!.execute({
        orgId: "org_1",
        dateFrom: "2026-04-20T00:00:00+08:00",
        dateTo: "2026-04-20T23:59:59+08:00",
        durationMinutes: 30,
        service: "consultation",
        timezone: "Asia/Singapore",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_PROVIDER_ERROR");
      expect(calendarProvider.listAvailableSlots).not.toHaveBeenCalled();
    });
  });

  describe("booking.create failure paths", () => {
    it("fails ORG_ID_REQUIRED when orgId missing", async () => {
      const result = await tool.operations["booking.create"]!.execute({
        contactId: "ct_1",
        service: "consultation",
        slotStart: "2026-04-20T10:00:00+08:00",
        slotEnd: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("ORG_ID_REQUIRED");
      expect(calendarProviderFactory).not.toHaveBeenCalled();
      expect(bookingStore.create).not.toHaveBeenCalled();
    });

    it("fails ORG_ID_REQUIRED when orgId whitespace", async () => {
      const result = await tool.operations["booking.create"]!.execute({
        orgId: "   ",
        contactId: "ct_1",
        service: "consultation",
        slotStart: "2026-04-20T10:00:00+08:00",
        slotEnd: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("ORG_ID_REQUIRED");
    });

    it("fails CALENDAR_NOT_CONFIGURED when provider is unconfigured", async () => {
      isCalendarProviderConfigured.mockReturnValue(false);

      const result = await tool.operations["booking.create"]!.execute({
        orgId: "org_1",
        contactId: "ct_1",
        service: "consultation",
        slotStart: "2026-04-20T10:00:00+08:00",
        slotEnd: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_NOT_CONFIGURED");
      expect(result.error?.modelRemediation).toMatch(/Escalate to the operator/);
      expect(bookingStore.create).not.toHaveBeenCalled();
      expect(calendarProvider.createBooking).not.toHaveBeenCalled();
    });

    it("fails CALENDAR_PROVIDER_ERROR when factory rejects", async () => {
      calendarProviderFactory.mockRejectedValue(new Error("Boom"));

      const result = await tool.operations["booking.create"]!.execute({
        orgId: "org_1",
        contactId: "ct_1",
        service: "consultation",
        slotStart: "2026-04-20T10:00:00+08:00",
        slotEnd: "2026-04-20T10:30:00+08:00",
        calendarId: "primary",
      });

      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("CALENDAR_PROVIDER_ERROR");
      expect(bookingStore.create).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm --filter @switchboard/core test calendar-book
```

Expected: many failures — `createCalendarBookTool` does not yet accept `calendarProviderFactory`/`isCalendarProviderConfigured`.

- [ ] **Step 3: Update `calendar-book.ts` deps and operation bodies**

In `packages/core/src/skill-runtime/tools/calendar-book.ts`:

Replace the deps interface near the top:

```ts
// Type duplicated locally because packages/core cannot import from apps/api.
// Structurally identical to apps/api/src/bootstrap/calendar-provider-factory.ts.
// If drift becomes a problem, hoist into @switchboard/schemas.
export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

interface CalendarBookToolDeps {
  calendarProviderFactory: CalendarProviderFactory;
  isCalendarProviderConfigured: (provider: CalendarProvider) => boolean;
  bookingStore: BookingStoreSubset;
  opportunityStore: OpportunityStoreSubset;
  runTransaction: TransactionFn;
  failureHandler: BookingFailureHandler;
}
```

Add a private helper inside the file (above `createCalendarBookTool`):

```ts
function isMissingOrgId(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

const NOT_CONFIGURED_REMEDIATION =
  "Do not tell the customer there are no available slots. Escalate to the operator because calendar booking is not configured.";

// TODO(per-request-trust): orgId is read from LLM-controlled tool input.
// The follow-up executor-contract PR should source this from SkillRequestContext
// (see escalate.ts for the target shape) so it cannot be spoofed by tool args.
async function resolveProviderOrFail(
  deps: Pick<CalendarBookToolDeps, "calendarProviderFactory" | "isCalendarProviderConfigured">,
  orgId: string,
): Promise<{ provider: CalendarProvider } | { failure: ToolResult }> {
  let provider: CalendarProvider;
  try {
    provider = await deps.calendarProviderFactory(orgId);
  } catch {
    return {
      failure: fail(
        "CALENDAR_PROVIDER_ERROR",
        "Calendar provider could not be initialized.",
        { data: { calendarProviderResolved: false }, retryable: false },
      ),
    };
  }
  if (!deps.isCalendarProviderConfigured(provider)) {
    return {
      failure: fail("CALENDAR_NOT_CONFIGURED", "Calendar booking is not configured for this organization.", {
        modelRemediation: NOT_CONFIGURED_REMEDIATION,
        retryable: false,
      }),
    };
  }
  return { provider };
}
```

Update `slots.query` schema and execute:

```ts
"slots.query": {
  description: "Query available calendar slots for a date range.",
  effectCategory: "read" as const,
  idempotent: true,
  inputSchema: {
    type: "object",
    properties: {
      // Temporary: orgId currently comes from model/tool input.
      // Move to trusted SkillRequestContext in the executor-contract follow-up PR.
      orgId: { type: "string" },
      dateFrom: { type: "string", description: "ISO 8601 start date" },
      dateTo: { type: "string", description: "ISO 8601 end date" },
      durationMinutes: { type: "number", description: "Appointment duration in minutes" },
      service: { type: "string", description: "Service type" },
      timezone: { type: "string", description: "IANA timezone" },
    },
    required: ["orgId", "dateFrom", "dateTo", "durationMinutes", "service", "timezone"],
  },
  execute: async (params: unknown) => {
    const query = params as SlotQuery & { orgId?: string };
    if (isMissingOrgId(query.orgId)) {
      return fail("ORG_ID_REQUIRED", "Calendar booking requires an orgId.", { retryable: false });
    }
    const resolved = await resolveProviderOrFail(deps, query.orgId as string);
    if ("failure" in resolved) return resolved.failure;
    const slots = await resolved.provider.listAvailableSlots(query);
    return ok({ slots } as Record<string, unknown>);
  },
},
```

Update `booking.create` execute to add the orgId guard and switch from `deps.calendarProvider` to the resolved provider:

```ts
execute: async (params: unknown): Promise<ToolResult> => {
  const input = params as {
    orgId?: string;
    contactId: string;
    service: string;
    slotStart: string;
    slotEnd: string;
    calendarId: string;
    attendeeName?: string;
    attendeeEmail?: string;
  };

  if (isMissingOrgId(input.orgId)) {
    return fail("ORG_ID_REQUIRED", "Calendar booking requires an orgId.", { retryable: false });
  }
  const resolved = await resolveProviderOrFail(deps, input.orgId as string);
  if ("failure" in resolved) return resolved.failure;
  const provider = resolved.provider;

  // ... existing body, with `deps.calendarProvider.createBooking(...)` replaced by
  // `provider.createBooking(...)`. Everything else carries over verbatim.
}
```

(Full edit: every reference to `deps.calendarProvider` inside `booking.create` becomes `provider`.)

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter @switchboard/core test calendar-book
```

Expected: all original tests pass + 8 new failure-path tests pass. Total: ~17 cases.

- [ ] **Step 5: Typecheck core**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: clean.

- [ ] **Step 6: File-size check**

```bash
wc -l packages/core/src/skill-runtime/tools/calendar-book.ts \
      apps/api/src/bootstrap/calendar-provider-factory.ts
```

Expected: both under 400 lines (warn). If `calendar-book.ts` approaches the threshold, leave as-is for this PR (we do not split files unless the warn fires).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/tools/calendar-book.ts \
        packages/core/src/skill-runtime/tools/calendar-book.test.ts
git commit -m "feat(calendar): resolve provider per-org in calendar-book tool"
```

---

## Task 7: Wire factory into `skill-mode.ts`; remove `resolveCalendarProvider`

**Files:**
- Modify: `apps/api/src/bootstrap/skill-mode.ts`

- [ ] **Step 1: Replace boot-time provider resolution with factory wiring**

In `apps/api/src/bootstrap/skill-mode.ts`:

a) Add the imports at the top of the file (alongside existing bootstrap imports):

```ts
import { createCalendarProviderFactory } from "./calendar-provider-factory.js";
import { isNoopCalendarProvider } from "./noop-calendar-provider.js";
```

b) Remove the `await resolveCalendarProvider(prismaClient, logger)` call near line 65 and replace with:

```ts
const calendarProviderFactory = createCalendarProviderFactory({ prismaClient, logger });
```

c) Update the `createCalendarBookTool` call (currently at lines 152–190) so the deps include `calendarProviderFactory` and `isCalendarProviderConfigured` instead of `calendarProvider`:

```ts
[
  "calendar-book",
  createCalendarBookTool({
    calendarProviderFactory,
    isCalendarProviderConfigured: (provider) => !isNoopCalendarProvider(provider),
    bookingStore,
    opportunityStore: {
      // ... unchanged
    },
    runTransaction: (
      // ... unchanged
    ),
    failureHandler,
  }),
],
```

d) Delete the entire `async function resolveCalendarProvider(...) { ... }` block at the bottom of the file (lines 273–443). The factory module owns this logic now. The `// per-request resolution is the deeper fix` comment goes away with it.

e) The `CalendarProvider` type import on line 3 (`import type { CalendarProvider } from "@switchboard/schemas";`) is no longer used in this file — remove it if no other reference remains.

- [ ] **Step 2: Typecheck the api workspace**

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: clean. Common failure: an unused import for `CalendarProvider`. Remove it if so.

- [ ] **Step 3: Run api tests**

```bash
pnpm --filter @switchboard/api test
```

Expected: all PASS, including any existing `skill-mode` tests. The bootstrap tests under `apps/api/src/bootstrap/__tests__/` should now exercise the factory wiring path.

- [ ] **Step 4: Run core tests**

```bash
pnpm --filter @switchboard/core test
```

Expected: all PASS. Confirms no other consumer of the old `calendar-book` deps shape.

- [ ] **Step 5: Lint**

```bash
pnpm --filter @switchboard/api lint
pnpm --filter @switchboard/core lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts
git commit -m "feat(calendar): wire per-org CalendarProviderFactory at bootstrap"
```

---

## Task 8: Final verification

**Files:** none modified.

- [ ] **Step 1: Full test suite**

```bash
pnpm test 2>&1 | tail -40
```

Expected: all PASS.

- [ ] **Step 2: Full typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: Full lint**

```bash
pnpm lint 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 4: Coverage check (core thresholds 65/65/70/65)**

```bash
pnpm --filter @switchboard/core test --coverage 2>&1 | tail -25
```

Expected: thresholds preserved or improved. If they regress, audit the new test cases for missing branches.

- [ ] **Step 5: File-size and grep audit**

```bash
wc -l apps/api/src/bootstrap/calendar-provider-factory.ts \
      packages/core/src/skill-runtime/tools/calendar-book.ts \
      apps/api/src/bootstrap/skill-mode.ts
rg -n "TODO\(per-request-trust\)" packages/core/src/skill-runtime/tools/calendar-book.ts
rg -n "resolveCalendarProvider" --glob '!.claude/**' --glob '!node_modules/**' --glob '!docs/**'
```

Expected: factory + calendar-book under 400 lines; `skill-mode.ts` shrunk by ~150 lines; TODO present at exactly the resolution block; no remaining references to `resolveCalendarProvider` outside docs.

- [ ] **Step 6: Acceptance summary walk-through**

Re-read Section 5 of the spec. For each of the 13 acceptance criteria, state which task/test pins it. If any is not pinned, add a test before opening the PR.

- [ ] **Step 7: Open PR**

```bash
git push -u origin fix/launch-calendar-per-request-resolution
gh pr create --base main --title "fix(launch): per-org calendar provider resolution (#9c follow-up)" --body "$(cat <<'EOF'
## Summary
- Replaces boot-time `CalendarProvider` singleton with a per-org `CalendarProviderFactory`.
- Memoizes per orgId with rejection cleanup; no eviction in beta (~10 orgs).
- `calendar-book` tool resolves per operation; missing orgId / unconfigured provider / construction error all fail visibly. `slots.query` does not soft-fall to empty slots.
- LLM-supplied `params.orgId` is marked as a temporary trust-boundary limitation; follow-up executor-contract PR will move identity to `SkillRequestContext`.

## Spec
`docs/superpowers/specs/2026-04-28-fix-launch-calendar-per-request-resolution-design.md`

## Test plan
- [ ] `pnpm test` green
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
- [ ] `pnpm --filter @switchboard/core test --coverage` thresholds preserved
- [ ] Factory tests cover same-org / different-org / concurrent / rejection cleanup / Noop / Local
- [ ] Tool tests cover ORG_ID_REQUIRED / CALENDAR_NOT_CONFIGURED / CALENDAR_PROVIDER_ERROR for both operations
- [ ] No silent fake-success: `slots.query` never leaks empty slots when calendar is unconfigured

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR created against `main`. Review → squash-merge with auto-merge on green CI.

---

## Self-review

**Spec coverage check (Section 5 acceptance criteria):**

1. No singleton `CalendarProvider` at bootstrap → Task 7.
2. Per-org factory preserves Google → Local → Noop precedence → Task 4.
3. Promise-cached memoization with rejection cleanup → Task 3 + Task 5.
4. `calendar-book` accepts factory + capability predicate → Task 6.
5. ORG_ID_REQUIRED / CALENDAR_PROVIDER_ERROR / CALENDAR_NOT_CONFIGURED for both ops, no soft-fall → Task 6 + Task 8.
6. Cross-org isolation pinned at factory boundary → Task 5.
7. Non-calendar tools unchanged → Task 7 lint/test pass.
8. Existing calendar-book tests pass after deps update → Task 6.
9. New tests pin all required behaviors → Tasks 4, 5, 6.
10. Today's global Google env behavior preserved → Task 4 inner resolver.
11. File-size limits respected → Task 6 Step 6 + Task 8 Step 5.
12. TODOs at resolution block + slots.query schema → Task 6 Step 3.
13. No silent fake-success → explicit assertion in Task 6 (`slots` undefined on Noop).

**Placeholder scan:** none. Each step has either exact code or an exact command.

**Type consistency:** `CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>` is consistent across `apps/api/src/bootstrap/calendar-provider-factory.ts`, `packages/core/src/skill-runtime/tools/calendar-book.ts`, and the test scaffolds. `isCalendarProviderConfigured: (provider: CalendarProvider) => boolean` is consistent.

**Hard stops:** Task 1 spells out hard-stop conditions for each verification check; if any fires, the task lists the spec section to revise.
