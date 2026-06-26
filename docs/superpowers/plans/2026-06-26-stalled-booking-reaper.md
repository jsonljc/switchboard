# Stalled `pending_confirmation` Booking Reaper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded hourly reaper that ages stranded `pending_confirmation` bookings (older than a 30-minute TTL) to `failed`, releasing the slot they permanently block, with a per-row counter and one operator alert per run.

**Architecture:** Mirror the EV-2 stranded-claim reaper across three layers — a db store method pair (`PrismaBookingStore.findStalledPending` + `reapStalledPending`), a core orchestrator (`reapStalledBookings` over a narrow `StalledBookingReaperStore` interface), and a thin Inngest cron in apps/api wired in `inngest.ts`. A new `bookingStalledReaped` counter is added to all three metrics registries. Direct row-mutation cron, not a governed ingress intent.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Prisma, Inngest, Vitest, prom-client.

## Global Constraints

- ESM only, `.js` extensions in relative imports. No `any`. No `console.log` (use `console.warn`/`console.error`).
- Prettier: semi, double quotes, 2-space indent, trailing commas, 100 char width. Lowercase conventional-commit subject. No em-dashes in code/comments/commits.
- Reap target is the existing `failed` status — NO new `BookingStatus` enum value, NO schema migration.
- New `SwitchboardMetrics` counter MUST be added to all 3 registries: `packages/core/src/telemetry/metrics.ts` (interface + InMemory default), `apps/api/src/metrics.ts` (PromCounter), `apps/chat/src/bootstrap/metrics.ts` (PromCounter).
- Per-touched-package `pnpm --filter <pkg> exec tsc --noEmit` before each commit; rebuild a lower package's `dist` after editing it so consumers typecheck.
- TTL = 30 min (`STALLED_BOOKING_MAX_AGE_MS`), scan limit 500 (`STALLED_BOOKING_REAP_LIMIT`).

---

### Task 1: db store methods — `findStalledPending` + `reapStalledPending`

**Files:**

- Modify: `packages/db/src/stores/prisma-booking-store.ts` (add two methods to `PrismaBookingStore`)
- Test: `packages/db/src/stores/__tests__/prisma-booking-store.test.ts`

**Interfaces:**

- Produces:
  - `findStalledPending(olderThan: Date, limit: number): Promise<Array<{ id: string; organizationId: string; createdAt: Date }>>`
  - `reapStalledPending(organizationId: string, bookingId: string): Promise<{ count: number }>`

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe("PrismaBookingStore", ...)`)

```ts
it("findStalledPending queries pending_confirmation rows older than the cutoff, bounded + ordered", async () => {
  const cutoff = new Date("2026-06-26T12:00:00Z");
  const rows = [
    { id: "bk_1", organizationId: "org_1", createdAt: new Date("2026-06-26T10:00:00Z") },
  ];
  (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

  const result = await store.findStalledPending(cutoff, 500);

  expect(result).toEqual(rows);
  const arg = (prisma.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  expect(arg.where).toEqual({ status: "pending_confirmation", createdAt: { lt: cutoff } });
  expect(arg.take).toBe(500);
  expect(arg.orderBy).toEqual({ createdAt: "asc" });
  expect(arg.select).toEqual({ id: true, organizationId: true, createdAt: true });
});

it("reapStalledPending issues a status-guarded updateMany and returns the count (1 = reaped)", async () => {
  (prisma.booking.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

  const result = await store.reapStalledPending("org_1", "bk_1");

  expect(result).toEqual({ count: 1 });
  expect(prisma.booking.updateMany).toHaveBeenCalledWith({
    where: { id: "bk_1", organizationId: "org_1", status: "pending_confirmation" },
    data: { status: "failed" },
  });
});

it("reapStalledPending returns count 0 when a concurrent confirm/fail already moved the row (benign race)", async () => {
  (prisma.booking.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

  const result = await store.reapStalledPending("org_1", "bk_1");

  expect(result).toEqual({ count: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/prisma-booking-store.test.ts`
Expected: FAIL — `store.findStalledPending is not a function` / `store.reapStalledPending is not a function`.

- [ ] **Step 3: Implement the two methods** (add before the closing `}` of `class PrismaBookingStore`, after `findFutureBookingContactIds`)

```ts
  // Cross-org system sweep (like findUpcomingConfirmed): the bookings the stalled-pending
  // reaper ages to `failed`. A booking is created `pending_confirmation` BEFORE the external
  // calendar mutation; if the terminalizing write (confirm / markFailed / failure-handler) is
  // lost to a thrown tx or process death, the row is stranded pending_confirmation and the
  // overlap predicate (notIn [failed, cancelled]) blocks its slot forever. `createdAt` is the
  // age axis: a legitimate pending resolves within one synchronous tool call, so anything older
  // than the reaper TTL is stranded. Bounded (@@index([status]) / @@index([organizationId, createdAt]))
  // so a backlog cannot blow up the scan.
  async findStalledPending(
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; organizationId: string; createdAt: Date }>> {
    return this.prisma.booking.findMany({
      where: { status: "pending_confirmation", createdAt: { lt: olderThan } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, organizationId: true, createdAt: true },
    });
  }

  // Race-safe compare-and-set: the `status: "pending_confirmation"` predicate is the guard. If a
  // concurrent confirm()/markFailed() moved the row between the reaper's scan and here, count===0
  // (a benign race) and we never overwrite a now-confirmed booking. Org + booking scoped (F12 / IDOR).
  async reapStalledPending(organizationId: string, bookingId: string): Promise<{ count: number }> {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId, status: "pending_confirmation" },
      data: { status: "failed" },
    });
    return { count: result.count };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/prisma-booking-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + rebuild db dist (core orchestrator + cron consume it)**

Run: `pnpm --filter @switchboard/db exec tsc --noEmit && pnpm --filter @switchboard/db build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts
git commit -m "feat(db): stalled pending_confirmation booking find + status-guarded reap (A8b-2)"
```

---

### Task 2: core orchestrator — `reapStalledBookings`

**Files:**

- Create: `packages/core/src/platform/stalled-booking-reaper.ts`
- Modify: `packages/core/src/platform/index.ts` (re-export)
- Test: `packages/core/src/platform/__tests__/stalled-booking-reaper.test.ts`

**Files (also):**

- Modify: `packages/core/src/observability/operator-alerter.ts` (add the `InfrastructureErrorType` union member — `errorType` is a CLOSED union, so the alert won't typecheck without it).

**Interfaces:**

- Consumes: `Counter` (`../../telemetry/metrics.js`); `OperatorAlerter`, `InfrastructureFailureAlert`, `safeAlert` (`../../observability/operator-alerter.js`).
- Produces: `reapStalledBookings(deps, config): Promise<ReapStalledBookingsResult>`; `STALLED_BOOKING_MAX_AGE_MS`; `STALLED_BOOKING_REAP_LIMIT`; types `StalledBookingReaperStore`, `StalledPendingBooking`, `ReapStalledBookingsDeps`, `ReapStalledBookingsConfig`, `ReapStalledBookingsResult`. Adds `"stalled_booking_reaped"` to `InfrastructureErrorType`.

- [ ] **Step 1: Write the failing test** — create `packages/core/src/platform/__tests__/stalled-booking-reaper.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import {
  reapStalledBookings,
  STALLED_BOOKING_MAX_AGE_MS,
  STALLED_BOOKING_REAP_LIMIT,
  type StalledBookingReaperStore,
  type StalledPendingBooking,
} from "../stalled-booking-reaper.js";
import type { Counter } from "../../telemetry/metrics.js";
import type {
  InfrastructureFailureAlert,
  OperatorAlerter,
} from "../../observability/operator-alerter.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");

function makeBooking(over: Partial<StalledPendingBooking> = {}): StalledPendingBooking {
  return {
    id: "bk-1",
    organizationId: "org-1",
    createdAt: new Date("2026-06-26T11:00:00.000Z"),
    ...over,
  };
}

function makeCounter(): Counter & { calls: Array<Record<string, string> | undefined> } {
  const calls: Array<Record<string, string> | undefined> = [];
  return { calls, inc: (labels) => calls.push(labels) };
}

function makeAlerter(): OperatorAlerter & { alerts: InfrastructureFailureAlert[] } {
  const alerts: InfrastructureFailureAlert[] = [];
  return {
    alerts,
    alert: async (p) => {
      alerts.push(p);
    },
  };
}

function makeStore(opts: {
  stuck: StalledPendingBooking[];
  reap?: (id: string) => Promise<{ count: number }>;
}): StalledBookingReaperStore & {
  findStalledPending: ReturnType<typeof vi.fn>;
  reapStalledPending: ReturnType<typeof vi.fn>;
} {
  return {
    findStalledPending: vi.fn(async () => opts.stuck),
    reapStalledPending: vi.fn(async (_org: string, id: string) =>
      opts.reap ? opts.reap(id) : { count: 1 },
    ),
  };
}

const config = { olderThanMs: STALLED_BOOKING_MAX_AGE_MS, limit: STALLED_BOOKING_REAP_LIMIT };

describe("reapStalledBookings", () => {
  it("ages each stale pending booking to failed: counter per row, org-scoped, one warning alert", async () => {
    const store = makeStore({
      stuck: [
        makeBooking({ id: "bk-a", organizationId: "org-1" }),
        makeBooking({ id: "bk-b", organizationId: "org-2" }),
      ],
    });
    const counter = makeCounter();
    const alerter = makeAlerter();

    const result = await reapStalledBookings({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 2, reaped: 2, raced: 0, failed: 0 });
    expect(store.reapStalledPending).toHaveBeenCalledWith("org-1", "bk-a");
    expect(store.reapStalledPending).toHaveBeenCalledWith("org-2", "bk-b");
    expect(counter.calls).toEqual([{ orgId: "org-1" }, { orgId: "org-2" }]);
    expect(alerter.alerts).toHaveLength(1);
    expect(alerter.alerts[0]!.severity).toBe("warning");
    expect(alerter.alerts[0]!.errorType).toBe("stalled_booking_reaped");
  });

  it("passes now - olderThanMs as the cutoff and the configured limit to the scan", async () => {
    const store = makeStore({ stuck: [] });
    await reapStalledBookings(
      { store, counter: makeCounter(), alerter: makeAlerter(), now: () => NOW },
      config,
    );
    const [cutoff, limit] = store.findStalledPending.mock.calls[0]!;
    expect(cutoff).toEqual(new Date(NOW.getTime() - STALLED_BOOKING_MAX_AGE_MS));
    expect(limit).toBe(STALLED_BOOKING_REAP_LIMIT);
  });

  it("counts a count:0 row as raced and keeps the alert at warning (benign concurrent confirm/fail)", async () => {
    const store = makeStore({ stuck: [makeBooking()], reap: async () => ({ count: 0 }) });
    const counter = makeCounter();
    const alerter = makeAlerter();

    const result = await reapStalledBookings({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 1, reaped: 0, raced: 1, failed: 0 });
    expect(counter.calls).toEqual([]);
    expect(alerter.alerts[0]!.severity).toBe("warning");
  });

  it("counts a thrown reap as failed and escalates the alert to critical", async () => {
    const store = makeStore({
      stuck: [makeBooking()],
      reap: async () => {
        throw new Error("db down");
      },
    });
    const alerter = makeAlerter();

    const result = await reapStalledBookings(
      { store, counter: makeCounter(), alerter, now: () => NOW },
      config,
    );

    expect(result).toEqual({ scanned: 1, reaped: 0, raced: 0, failed: 1 });
    expect(alerter.alerts[0]!.severity).toBe("critical");
  });

  it("emits the CAPPED note when the scan hits the limit", async () => {
    const stuck = Array.from({ length: 3 }, (_, i) => makeBooking({ id: `bk-${i}` }));
    const store = makeStore({ stuck });
    const alerter = makeAlerter();

    await reapStalledBookings(
      { store, counter: makeCounter(), alerter, now: () => NOW },
      { olderThanMs: STALLED_BOOKING_MAX_AGE_MS, limit: 3 },
    );

    expect(alerter.alerts[0]!.errorMessage).toContain("CAPPED");
  });

  it("does nothing and raises no alert when no stale bookings are found", async () => {
    const store = makeStore({ stuck: [] });
    const counter = makeCounter();
    const alerter = makeAlerter();

    const result = await reapStalledBookings({ store, counter, alerter, now: () => NOW }, config);

    expect(result).toEqual({ scanned: 0, reaped: 0, raced: 0, failed: 0 });
    expect(alerter.alerts).toHaveLength(0);
    expect(counter.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core exec vitest run src/platform/__tests__/stalled-booking-reaper.test.ts`
Expected: FAIL — cannot find module `../stalled-booking-reaper.js`.

- [ ] **Step 3: Implement the orchestrator** — create `packages/core/src/platform/stalled-booking-reaper.ts`

```ts
import type { Counter } from "../telemetry/metrics.js";
import type {
  OperatorAlerter,
  InfrastructureFailureAlert,
} from "../observability/operator-alerter.js";
import { safeAlert } from "../observability/operator-alerter.js";

/**
 * A8b-2 / rank-18 — Stalled `pending_confirmation` booking reaper.
 *
 * `PrismaBookingStore.create` persists a booking as `pending_confirmation` BEFORE the external
 * calendar mutation, and the slot-overlap predicate counts that row as occupying (status notIn
 * [failed, cancelled]). The only writers that terminalize the row are confirm() -> confirmed,
 * markFailed() -> failed, and the calendar-book failure handler. If that terminalizing write is
 * lost — the failure-handler tx throws, or the process dies between create() and a terminal
 * write — the row is stranded `pending_confirmation` and PERMANENTLY blocks its physical slot
 * (every future create() throws BookingSlotConflictError), silently (no metric, no reaper).
 *
 * This bounded sweep ages such a row to the existing terminal `failed` (already excluded from
 * every active/overlap predicate, so the slot releases and reporting stays correct with no new
 * status), emits a counter per reaped row, and raises ONE operator alert per run. It is the same
 * failure class as the stranded idempotency-claim reaper (a process death / throw between a
 * pre-write and its terminalization) and mirrors its shape.
 */

/** The narrow store slice the reaper needs. PrismaBookingStore satisfies it structurally. */
export interface StalledBookingReaperStore {
  findStalledPending(
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; organizationId: string; createdAt: Date }>>;
  /** Status-guarded CAS: count 1 = reaped, count 0 = a concurrent confirm/fail already moved it. */
  reapStalledPending(organizationId: string, bookingId: string): Promise<{ count: number }>;
}

export interface StalledPendingBooking {
  id: string;
  organizationId: string;
  createdAt: Date;
}

export interface ReapStalledBookingsDeps {
  store: StalledBookingReaperStore;
  /** `bookingStalledReaped` — incremented once per row actually aged to failed, labeled by orgId. */
  counter: Counter;
  /** Fired ONCE per run (when >=1 stale booking is found) — no per-row alert storm. */
  alerter: OperatorAlerter;
  /** Injectable clock for tests; defaults to wall clock. */
  now?: () => Date;
}

export interface ReapStalledBookingsConfig {
  /** Age threshold: only pending bookings created before (now - this) are reaped. */
  olderThanMs: number;
  /** Upper bound on rows scanned/aged per run. */
  limit: number;
}

export interface ReapStalledBookingsResult {
  /** Stale pending bookings found this run. */
  scanned: number;
  /** Bookings successfully aged to failed (slot released). */
  reaped: number;
  /** Bookings a concurrent confirm/fail terminalized between scan and our CAS (count 0). Benign. */
  raced: number;
  /** Bookings whose reap-write THREW (a hard store error) — left for the next run; the alarm case. */
  failed: number;
}

/**
 * 30 minutes — far above any legitimate pending window. A booking resolves
 * pending_confirmation -> confirmed/failed within ONE synchronous tool invocation (the provider
 * call is seconds); there is no async-park path that legitimately holds a booking pending. A
 * row still pending after this is stranded. Even a falsely-reaped slow confirm resolves in the
 * SAFE direction (slot released; row terminalized to failed).
 */
export const STALLED_BOOKING_MAX_AGE_MS = 30 * 60 * 1000;

/** Bounded batch per run — the reaper never fans out unbounded on a mass strand. */
export const STALLED_BOOKING_REAP_LIMIT = 500;

export async function reapStalledBookings(
  deps: ReapStalledBookingsDeps,
  config: ReapStalledBookingsConfig,
): Promise<ReapStalledBookingsResult> {
  const now = deps.now?.() ?? new Date();
  const olderThan = new Date(now.getTime() - config.olderThanMs);

  const stuck = await deps.store.findStalledPending(olderThan, config.limit);
  let reaped = 0;
  let raced = 0;
  let failed = 0;

  for (const booking of stuck) {
    try {
      const { count } = await deps.store.reapStalledPending(booking.organizationId, booking.id);
      if (count === 0) {
        // A concurrent confirm()/markFailed() moved the row between our scan and CAS. The row is
        // now properly terminal; nothing to do and NOT an alarm. Count as a benign race.
        raced++;
        console.warn(
          `[stalled-booking-reaper] bookingId=${booking.id} org=${booking.organizationId} ` +
            `was already terminalized by a concurrent confirm/fail; skipping`,
        );
        continue;
      }
      reaped++;
      deps.counter.inc({ orgId: booking.organizationId });
      // Per-row forensics so each released slot is in logs (the alert is a summary).
      console.warn(
        `[stalled-booking-reaper] reaped stalled pending_confirmation booking bookingId=${booking.id} ` +
          `org=${booking.organizationId} createdAt=${booking.createdAt.toISOString()} -> failed (slot released)`,
      );
    } catch (err) {
      failed++;
      console.error(
        `[stalled-booking-reaper] reap threw for bookingId=${booking.id} ` +
          `org=${booking.organizationId}; left for next run`,
        err,
      );
    }
  }

  // ONE summary alert per run when ANY stale booking was found — never silent, never a per-row
  // storm. Only a HARD reap-write error (a throw) escalates to critical; a benign concurrent-seal
  // race does not (the row resolved).
  if (stuck.length > 0) {
    const capped = stuck.length >= config.limit;
    const cappedNote = capped
      ? ` Result CAPPED at the ${config.limit}-row scan limit; more stalled bookings likely remain and the next run will continue.`
      : "";
    const alert: InfrastructureFailureAlert = {
      errorType: "stalled_booking_reaped",
      severity: failed > 0 ? "critical" : "warning",
      errorMessage:
        `Found ${stuck.length} stalled pending_confirmation booking(s); reaped ${reaped} to failed ` +
        `(slot released), ${raced} already-terminalized by a concurrent confirm/fail, ` +
        `${failed} hard reap-write error(s).${cappedNote}`,
      retryable: false,
      occurredAt: now.toISOString(),
      source: "inngest_function",
    };
    await safeAlert(deps.alerter, alert);
  }

  return { scanned: stuck.length, reaped, raced, failed };
}
```

- [ ] **Step 3b: Add the errorType union member** — in `packages/core/src/observability/operator-alerter.ts`, change the closing member of the `InfrastructureErrorType` union (`| "stranded_claim_reaped";`) to:

```ts
  | "stranded_claim_reaped"
  // A8b-2 / rank-18: the stalled-booking reaper aged >=1 booking stranded in
  // `pending_confirmation` to `failed`, releasing the slot it blocked. Always surfaced;
  // severity escalates to critical when a reap-write itself failed.
  | "stalled_booking_reaped";
```

- [ ] **Step 4: Re-export from the platform barrel** — in `packages/core/src/platform/index.ts`, after the stranded-claim-reaper block (the `} from "./stranded-claim-reaper.js";` type re-export ending ~line 66):

```ts
// A8b-2 / rank-18: stalled pending_confirmation booking reaper (orchestrator + constants).
export {
  reapStalledBookings,
  STALLED_BOOKING_MAX_AGE_MS,
  STALLED_BOOKING_REAP_LIMIT,
} from "./stalled-booking-reaper.js";
export type {
  StalledBookingReaperStore,
  StalledPendingBooking,
  ReapStalledBookingsDeps,
  ReapStalledBookingsConfig,
  ReapStalledBookingsResult,
} from "./stalled-booking-reaper.js";
```

- [ ] **Step 5: Run test + typecheck + rebuild core dist**

Run: `pnpm --filter @switchboard/core exec vitest run src/platform/__tests__/stalled-booking-reaper.test.ts && pnpm --filter @switchboard/core exec tsc --noEmit && pnpm --filter @switchboard/core build`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/platform/stalled-booking-reaper.ts packages/core/src/platform/__tests__/stalled-booking-reaper.test.ts packages/core/src/platform/index.ts packages/core/src/observability/operator-alerter.ts
git commit -m "feat(core): stalled-booking reaper orchestrator + barrel export (A8b-2)"
```

---

### Task 3: `bookingStalledReaped` counter in all 3 registries

**Files:**

- Modify: `packages/core/src/telemetry/metrics.ts` (interface ~line 35; InMemory default ~line 191)
- Modify: `apps/api/src/metrics.ts` (PromCounter ~after line 196)
- Modify: `apps/chat/src/bootstrap/metrics.ts` (PromCounter ~after line 196)

**Interfaces:**

- Produces: `SwitchboardMetrics.bookingStalledReaped: Counter`.

- [ ] **Step 1: core interface** — in `packages/core/src/telemetry/metrics.ts`, after `bookingCancel: Counter;`:

```ts
bookingStalledReaped: Counter;
```

- [ ] **Step 2: core InMemory default** — in the same file, after `bookingCancel: new InMemoryCounter(),`:

```ts
    bookingStalledReaped: new InMemoryCounter(),
```

- [ ] **Step 3: api PromCounter** — in `apps/api/src/metrics.ts`, after the `bookingCancel: new PromCounter(...)` block:

```ts
    bookingStalledReaped: new PromCounter(
      "switchboard_booking_stalled_reaped_total",
      "Stalled pending_confirmation bookings aged to failed by the reaper (slot released)",
      ["orgId"],
    ),
```

- [ ] **Step 4: chat PromCounter** — in `apps/chat/src/bootstrap/metrics.ts`, after the `bookingCancel: new PromCounter(...)` block, add the identical block as Step 3.

- [ ] **Step 5: Typecheck core + rebuild core dist (registries reference the interface)**

Run: `pnpm --filter @switchboard/core exec tsc --noEmit && pnpm --filter @switchboard/core build`
Expected: no errors. (The InMemory `buildInMemoryMetrics` and both PromCounter maps must satisfy `SwitchboardMetrics`; a missing key fails here.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/telemetry/metrics.ts apps/api/src/metrics.ts apps/chat/src/bootstrap/metrics.ts
git commit -m "feat(metrics): bookingStalledReaped counter in all 3 registries (A8b-2)"
```

---

### Task 4: apps/api Inngest cron + wiring

**Files:**

- Create: `apps/api/src/services/cron/stalled-booking-reaper.ts`
- Test: `apps/api/src/services/cron/__tests__/stalled-booking-reaper.test.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts` (import ~line 155; functions list ~after line 1636)

**Interfaces:**

- Consumes: `reapStalledBookings`, `STALLED_BOOKING_MAX_AGE_MS`, `STALLED_BOOKING_REAP_LIMIT`, `StalledBookingReaperStore`, `ReapStalledBookingsResult` (`@switchboard/core/platform`); `makeOnFailureHandler`, `AsyncFailureContext`, `OperatorAlerter`, `Counter` (`@switchboard/core`); `inngestClient` (`@switchboard/creative-pipeline`); `PrismaBookingStore` (already imported in inngest.ts).
- Produces: `createStalledBookingReaperCron(deps)`, `executeStalledBookingReaper(step, deps)`.

- [ ] **Step 1: Write the failing test** — create `apps/api/src/services/cron/__tests__/stalled-booking-reaper.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import {
  executeStalledBookingReaper,
  type StalledBookingReaperCronDeps,
  type StepTools,
} from "../stalled-booking-reaper.js";

function makeStep(): StepTools & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn(async (_name: string, fn: () => unknown) => fn()) };
}

const baseDeps = {
  failure: { operatorAlerter: undefined } as unknown as StalledBookingReaperCronDeps["failure"],
  alerter: { alert: vi.fn(async () => {}) },
  counter: { inc: vi.fn() },
};

describe("executeStalledBookingReaper", () => {
  it("no-ops (skipped) when no store is wired and never enters step.run", async () => {
    const step = makeStep();
    const result = await executeStalledBookingReaper(step, { ...baseDeps, store: null });
    expect(result).toEqual({ scanned: 0, reaped: 0, raced: 0, failed: 0, skipped: true });
    expect(step.run).not.toHaveBeenCalled();
  });

  it("runs the orchestrator under step.run when a store is wired", async () => {
    const store = {
      findStalledPending: vi.fn(async () => []),
      reapStalledPending: vi.fn(),
    };
    const step = makeStep();
    const result = await executeStalledBookingReaper(step, { ...baseDeps, store });
    expect(result).toEqual({ scanned: 0, reaped: 0, raced: 0, failed: 0 });
    expect(step.run).toHaveBeenCalledWith("reap-stalled-bookings", expect.any(Function));
    expect(store.findStalledPending).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api exec vitest run src/services/cron/__tests__/stalled-booking-reaper.test.ts`
Expected: FAIL — cannot find module `../stalled-booking-reaper.js`.

- [ ] **Step 3: Implement the cron** — create `apps/api/src/services/cron/stalled-booking-reaper.ts`

```ts
// apps/api/src/services/cron/stalled-booking-reaper.ts
// ---------------------------------------------------------------------------
// A8b-2 / rank-18 — stalled pending_confirmation booking reaper (Inngest cron)
// ---------------------------------------------------------------------------
// Hourly sweep that ages bookings stranded in `pending_confirmation` (a thrown
// failure-handler tx or a process death between create() and a terminal write)
// to the terminal `failed` status, releasing the physical slot they otherwise
// block forever. Emits a per-row counter and ONE operator alert per run. The
// aging logic lives in the core `reapStalledBookings` orchestrator; this file is
// the thin Inngest wiring. Idempotent across retries — an already-reaped row is
// `failed`, not `pending_confirmation`, so findStalledPending will not return it.
// ---------------------------------------------------------------------------

import {
  makeOnFailureHandler,
  type AsyncFailureContext,
  type OperatorAlerter,
  type Counter,
} from "@switchboard/core";
import {
  reapStalledBookings,
  STALLED_BOOKING_MAX_AGE_MS,
  STALLED_BOOKING_REAP_LIMIT,
  type StalledBookingReaperStore,
  type ReapStalledBookingsResult,
} from "@switchboard/core/platform";
import { inngestClient } from "@switchboard/creative-pipeline";

export interface StalledBookingReaperCronDeps {
  failure: AsyncFailureContext;
  /**
   * The booking store (PrismaBookingStore satisfies the narrow reaper slice). Null when no
   * Postgres-backed store is wired — the cron then no-ops, never fabricating a reaper run.
   */
  store: StalledBookingReaperStore | null;
  alerter: OperatorAlerter;
  /** `bookingStalledReaped` from the active metrics registry. */
  counter: Counter;
  /** Defaults to STALLED_BOOKING_MAX_AGE_MS. */
  olderThanMs?: number;
  /** Defaults to STALLED_BOOKING_REAP_LIMIT. */
  limit?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export type StalledBookingReaperResult = ReapStalledBookingsResult & { skipped?: boolean };

export async function executeStalledBookingReaper(
  step: StepTools,
  deps: StalledBookingReaperCronDeps,
): Promise<StalledBookingReaperResult> {
  const store = deps.store;
  if (!store) {
    // No store wired (no Postgres) — nothing to reap. Never alert.
    return { scanned: 0, reaped: 0, raced: 0, failed: 0, skipped: true };
  }
  return step.run("reap-stalled-bookings", () =>
    reapStalledBookings(
      { store, counter: deps.counter, alerter: deps.alerter, now: deps.now },
      {
        olderThanMs: deps.olderThanMs ?? STALLED_BOOKING_MAX_AGE_MS,
        limit: deps.limit ?? STALLED_BOOKING_REAP_LIMIT,
      },
    ),
  );
}

export function createStalledBookingReaperCron(deps: StalledBookingReaperCronDeps) {
  return inngestClient.createFunction(
    {
      id: "stalled-booking-reaper-hourly",
      name: "Stalled Booking Reaper",
      retries: 2,
      triggers: [{ cron: "0 * * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "stalled-booking-reaper-hourly",
          eventDomain: "stalled-booking-reaper",
          // A reaper run failing means stalled bookings keep blocking slots silently — alert.
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => executeStalledBookingReaper(step as unknown as StepTools, deps),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api exec vitest run src/services/cron/__tests__/stalled-booking-reaper.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `apps/api/src/bootstrap/inngest.ts`**

Add the import after `createStrandedClaimReaperCron` (~line 155):

```ts
import { createStalledBookingReaperCron } from "../services/cron/stalled-booking-reaper.js";
```

Add to the `functions: [...]` array, immediately after the `createStrandedClaimReaperCron({...})` entry (~line 1636):

```ts
      // A8b-2 / rank-18: age bookings stranded in `pending_confirmation` (lost terminal write)
      // to `failed`, releasing the slot they block forever (counter + operator alert). Constructs
      // the concrete PrismaBookingStore (which carries the reaper methods); a null prisma -> the
      // cron no-ops rather than fabricating a run.
      createStalledBookingReaperCron({
        failure: asyncFailure,
        store: app.prisma ? new PrismaBookingStore(app.prisma) : null,
        alerter: operatorAlerter,
        counter: getMetrics().bookingStalledReaped,
      }),
```

- [ ] **Step 6: Typecheck api**

Run: `pnpm --filter @switchboard/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/cron/stalled-booking-reaper.ts apps/api/src/services/cron/__tests__/stalled-booking-reaper.test.ts apps/api/src/bootstrap/inngest.ts
git commit -m "feat(api): wire stalled-booking reaper Inngest cron (A8b-2)"
```

---

## Final verification (before surfacing the PR)

- [ ] `pnpm --filter @switchboard/db --filter @switchboard/core --filter @switchboard/api exec tsc --noEmit` — all green.
- [ ] `pnpm --filter @switchboard/db --filter @switchboard/core --filter @switchboard/api test` — touched-package suites green.
- [ ] `pnpm lint` (or per-package eslint) + `pnpm format` — clean, no em-dashes.
- [ ] `pnpm --filter @switchboard/chat exec tsc --noEmit` — the chat metrics registry still satisfies `SwitchboardMetrics`.
- [ ] Confirm no migration was needed (reap target is the existing `failed` status).
