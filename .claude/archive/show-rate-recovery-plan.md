# Booking Attendance Recording (Slice 1) Implementation Plan — rev1 (fan-out graded)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes. Worktree: `.claude/worktrees/show-rate-recovery` (branch `feat/show-rate-recovery`, base origin/main@373cdc61).

**Goal:** Let a staff/owner record whether a booking was `attended` or a `no_show`, end-to-end through `PlatformIngress`, so held-appointment-rate becomes computable (the read ships in Slice 2).

**Architecture:** Mirror the `operator.record_revenue` operator-direct pattern. New nullable `Booking.attendance` column (separate axis from lifecycle `status`); a `PrismaBookingStore.recordAttendance` writer; a `booking.record_attendance` intent (`system_auto_approved`, non-spend recorded fact) with a thin apps/api handler; one operator route cloned from `revenue.ts` as the production caller. No core changes, no governance/entitlement/policy seed.

**Tech Stack:** Prisma (Postgres), Zod, Fastify, Vitest, TS ESM (`.js` import suffixes).

**Fan-out grade (rev1 fixes baked in):** app.ts must construct its own `PrismaBookingStore` in the bootstrap block (the `:657` `bookings` is out of scope); route test is an integration test via `buildTestServer`/`test-server.ts` mirroring `revenue-ingress.test.ts` (NOT the GET-only `revenue.test.ts`); all tests live under `__tests__/` dirs; use the `makePrisma()` factory; use a shared `BOOKING_NOT_FOUND` error constant.

## Constraints the executor MUST honor

- **Layering:** db (L4) ⊀ apps; core (L3) ⊀ db. Handler in apps/api (L5) injects a structurally-typed writer. No core edits.
- **No-match abort:** `recordAttendance` uses `updateMany` and MUST `throw` on `count === 0` (mirror `confirm()` `prisma-booking-store.ts:87-94`); `TenantMismatchError extends StaleVersionError`, so a cross-org id throws the parent → mapped to `BOOKING_NOT_FOUND`.
- **Route-class contract** (`.agent/tools/route-class-validator.ts`): new route file starts `// @route-class: operator-direct`, imports+calls `requireIdempotencyKey` once, registers `requireOrgForMutation`. Copy `revenue.ts` verbatim. NO route-allowlist entry (revenue.ts has none; goes through ingress).
- **`system_auto_approved` correct** (non-spend; `assertNotSpendBearingAutoApprove` passes; intent not on the `adoptimizer.*` financial denylist). No policy/entitlement seed.
- **Prisma regen:** after editing `schema.prisma`, run `pnpm db:generate` (or `pnpm reset`) before typecheck/tests.
- **Migration in same commit**; hand-written SQL (no `migrate dev`). Latest existing migration = `20260611150000_creative_job_stage_failure`; new dir timestamp must sort after it.
- **No em-dashes; lowercase Conventional Commit subjects.**

## File map (paths verified by fan-out)

- Modify `packages/db/prisma/schema.prisma` (Booking: `attendance` column + `@@index([organizationId, attendance])`)
- Create `packages/db/prisma/migrations/<ts>_booking_attendance/migration.sql`
- Modify `packages/db/src/stores/prisma-booking-store.ts` (+`recordAttendance`)
- Modify `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` (+cases; uses existing `makePrisma()` factory)
- Modify `apps/api/src/routes/operator-intents-schemas.ts` (+`RecordAttendanceParametersSchema`)
- Create `apps/api/src/routes/__tests__/operator-intents-schemas.test.ts`
- Modify `apps/api/src/bootstrap/operator-intents/shared.ts` (+`RECORD_ATTENDANCE_INTENT`, +`BOOKING_NOT_FOUND` in `OPERATOR_INTENT_ERROR_CODES`)
- Create `apps/api/src/bootstrap/operator-intents/attendance.ts` (handler + `BookingAttendanceWriter`)
- Create `apps/api/src/bootstrap/operator-intents/attendance.test.ts` (co-located; mirrors record-verified-payment.test.ts)
- Modify `apps/api/src/bootstrap/operator-intents.ts` (deps + handlers.set + register + count + re-export the intent const)
- Modify `apps/api/src/app.ts` (construct `new PrismaBookingStore(prismaClient)` in the bootstrap block ~873-903 + pass `bookingAttendanceWriter`)
- Create `apps/api/src/routes/booking-attendance.ts`
- Modify `apps/api/src/bootstrap/routes.ts` (register, mirroring `revenueRoutes` at `routes.ts:249`: `app.register(bookingAttendanceRoutes, { prefix: "/api" })`)
- Modify `apps/api/src/__tests__/test-server.ts` (thread `bookingAttendanceWriter` into `bootstrapOperatorIntents` + register `bookingAttendanceRoutes`)
- Create `apps/api/src/routes/__tests__/booking-attendance.test.ts` (integration; mirrors `revenue-ingress.test.ts`)

---

### Task 1: Schema column + migration

**Files:** Modify `schema.prisma`; Create migration dir.

- [ ] **Step 1:** In `schema.prisma` model Booking (after `status`, ~line 2015) add:

```prisma
  // Attendance outcome — a SEPARATE axis from lifecycle `status`. null = not yet recorded.
  // Values: "attended" | "no_show". Producer: booking.record_attendance (operator-direct).
  attendance      String?
```

In the model index block (next to `@@index([status])`) add:

```prisma
  @@index([organizationId, attendance])
```

- [ ] **Step 2:** `ls packages/db/prisma/migrations | sort | tail -1` → pick `<ts>` (UTC `YYYYMMDDHHMMSS`) strictly greater (latest is `20260611150000_creative_job_stage_failure`). Create `packages/db/prisma/migrations/<ts>_booking_attendance/migration.sql`:

```sql
-- Booking.attendance: separate attendance axis (attended | no_show); null = unrecorded.
ALTER TABLE "Booking" ADD COLUMN "attendance" TEXT;
CREATE INDEX "Booking_organizationId_attendance_idx" ON "Booking"("organizationId", "attendance");
```

- [ ] **Step 3:** `pnpm db:generate` — Expected: success; generated `Booking` now has `attendance: string | null`.
- [ ] **Step 4:** Commit.

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add booking attendance column + migration"
```

---

### Task 2: `PrismaBookingStore.recordAttendance` (TDD)

**Files:** Modify `prisma-booking-store.ts`; Modify `packages/db/src/stores/__tests__/prisma-booking-store.test.ts` (use the file's existing `makePrisma()` factory — open it first to copy the exact shape).

- [ ] **Step 1: Failing test.** Add to the existing test file using its `makePrisma()` factory (override `updateMany`/`findFirstOrThrow` per case):

```ts
describe("recordAttendance", () => {
  it("updates attendance scoped by org+id and returns the row", async () => {
    const prisma = makePrisma();
    prisma.booking.updateMany = vi.fn(async () => ({ count: 1 }));
    prisma.booking.findFirstOrThrow = vi.fn(async () => ({ id: "b1", attendance: "attended" }));
    const store = new PrismaBookingStore(prisma);

    const row = await store.recordAttendance("org-1", "b1", "attended");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", organizationId: "org-1" },
      data: { attendance: "attended" },
    });
    expect(row).toEqual({ id: "b1", attendance: "attended" });
  });

  it("throws StaleVersionError on no match (no-match abort, not phantom success)", async () => {
    const prisma = makePrisma();
    prisma.booking.updateMany = vi.fn(async () => ({ count: 0 }));
    const store = new PrismaBookingStore(prisma);
    await expect(store.recordAttendance("org-1", "missing", "no_show")).rejects.toBeInstanceOf(
      StaleVersionError,
    );
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @switchboard/db test -- prisma-booking-store` — Expected: FAIL (method undefined).
- [ ] **Step 3:** Implement in `prisma-booking-store.ts` after `cancel()` (~line 184), mirroring `confirm()`:

```ts
  async recordAttendance(organizationId: string, bookingId: string, outcome: string) {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId },
      data: { attendance: outcome },
    });
    // count === 0 => no booking for this org. updateMany swallows the no-row case,
    // so guard it (else a wrong/cross-org id reports phantom success).
    if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);
    return this.prisma.booking.findFirstOrThrow({ where: { id: bookingId, organizationId } });
  }
```

- [ ] **Step 4:** Run the test — Expected: PASS.
- [ ] **Step 5:** Commit.

```bash
git add packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/__tests__/prisma-booking-store.test.ts
git commit -m "feat(db): record booking attendance outcome via store writer"
```

---

### Task 3: Parameter schema (TDD)

**Files:** Modify `operator-intents-schemas.ts`; Create `apps/api/src/routes/__tests__/operator-intents-schemas.test.ts`.

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect } from "vitest";
import { RecordAttendanceParametersSchema } from "../operator-intents-schemas.js";

describe("RecordAttendanceParametersSchema", () => {
  it("accepts attended/no_show and defaults recordedBy to owner", () => {
    expect(
      RecordAttendanceParametersSchema.parse({ bookingId: "b1", outcome: "attended" }),
    ).toEqual({
      bookingId: "b1",
      outcome: "attended",
      recordedBy: "owner",
    });
  });
  it("rejects an unknown outcome", () => {
    expect(
      RecordAttendanceParametersSchema.safeParse({ bookingId: "b1", outcome: "maybe" }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @switchboard/api test -- operator-intents-schemas` — Expected: FAIL.
- [ ] **Step 3:** Add (after `RecordRevenueParametersSchema`, ~line 95):

```ts
export const RecordAttendanceParametersSchema = z.object({
  bookingId: z.string().min(1),
  outcome: z.enum(["attended", "no_show"]),
  // Not persisted on Booking in this slice; rides into the WorkTrace audit record so
  // "who recorded it" is captured (canonical persistence).
  recordedBy: z.enum(["owner", "staff"]).default("owner"),
});

export type RecordAttendanceParameters = z.infer<typeof RecordAttendanceParametersSchema>;
```

- [ ] **Step 4:** Run — Expected: PASS. **Step 5:** Commit.

```bash
git add apps/api/src/routes/operator-intents-schemas.ts apps/api/src/routes/__tests__/operator-intents-schemas.test.ts
git commit -m "feat(api): add record-attendance parameter schema"
```

---

### Task 4: Intent const + error code + handler (TDD)

**Files:** Modify `shared.ts`; Create `attendance.ts` + co-located `attendance.test.ts`.

- [ ] **Step 1:** In `shared.ts` add the intent const (mirror `RECORD_REVENUE_INTENT`) and add `BOOKING_NOT_FOUND` to the existing `OPERATOR_INTENT_ERROR_CODES` map (open shared.ts to match its exact shape):

```ts
export const RECORD_ATTENDANCE_INTENT = "booking.record_attendance";
// add to OPERATOR_INTENT_ERROR_CODES: BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND"
```

- [ ] **Step 2: Failing handler test** (`attendance.test.ts`), mirroring `record-verified-payment.test.ts` seam:

```ts
import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import { StaleVersionError } from "@switchboard/core";
import { buildRecordAttendanceHandler, type BookingAttendanceWriter } from "./attendance.js";

function makeWorkUnit(params: Record<string, unknown>): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date(0).toISOString(),
    organizationId: "org-1",
    actor: { id: "u1", type: "user" as never },
    intent: "booking.record_attendance",
    parameters: params,
    deployment: {} as never,
    resolvedMode: "operator_mutation",
    traceId: "t-1",
    trigger: "api",
    priority: "normal",
  } as WorkUnit;
}

describe("buildRecordAttendanceHandler", () => {
  it("records the outcome scoped to the work unit's org and completes", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => ({ id: "b1", attendance: "attended" })),
    };
    const result = await buildRecordAttendanceHandler(writer).execute(
      makeWorkUnit({ bookingId: "b1", outcome: "attended", recordedBy: "owner" }),
    );
    expect(writer.recordAttendance).toHaveBeenCalledWith("org-1", "b1", "attended");
    expect(result.outcome).toBe("completed");
    expect(result.outputs?.booking).toEqual({ id: "b1", attendance: "attended" });
  });

  it("maps a missing booking (StaleVersionError) to failed BOOKING_NOT_FOUND", async () => {
    const writer: BookingAttendanceWriter = {
      recordAttendance: vi.fn(async () => {
        throw new StaleVersionError("b1", -1, -1);
      }),
    };
    const result = await buildRecordAttendanceHandler(writer).execute(
      makeWorkUnit({ bookingId: "b1", outcome: "no_show" }),
    );
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("BOOKING_NOT_FOUND");
  });
});
```

- [ ] **Step 3:** Run `pnpm --filter @switchboard/api test -- bootstrap/operator-intents/attendance` — Expected: FAIL.
- [ ] **Step 4:** Implement `attendance.ts` (use the shared error constant from `shared.ts`):

```ts
// apps/api/src/bootstrap/operator-intents/attendance.ts
// booking.record_attendance handler — operator/staff records attended | no_show.
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { StaleVersionError } from "@switchboard/core";
import { RecordAttendanceParametersSchema } from "../../routes/operator-intents-schemas.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

/** Minimal writer surface; PrismaBookingStore satisfies it structurally. */
export interface BookingAttendanceWriter {
  recordAttendance(
    organizationId: string,
    bookingId: string,
    outcome: string,
  ): Promise<{ id: string; attendance: string | null }>;
}

export function buildRecordAttendanceHandler(
  writer: BookingAttendanceWriter,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordAttendanceParametersSchema.parse(workUnit.parameters);
      try {
        const booking = await writer.recordAttendance(
          workUnit.organizationId,
          params.bookingId,
          params.outcome,
        );
        return {
          outcome: "completed" as const,
          summary: `Recorded ${params.outcome} for booking ${params.bookingId}`,
          outputs: { booking },
        };
      } catch (err) {
        if (err instanceof StaleVersionError) {
          return {
            outcome: "failed" as const,
            summary: `Booking ${params.bookingId} not found for organization`,
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND,
              message: "Booking not found",
            },
          };
        }
        throw err;
      }
    },
  };
}
```

(If `OPERATOR_INTENT_ERROR_CODES` does not exist in shared.ts, fall back to the inline string `"BOOKING_NOT_FOUND"` and note it for review.)

- [ ] **Step 5:** Run — Expected: PASS. **Step 6:** Commit.

```bash
git add apps/api/src/bootstrap/operator-intents/shared.ts apps/api/src/bootstrap/operator-intents/attendance.ts apps/api/src/bootstrap/operator-intents/attendance.test.ts
git commit -m "feat(api): add booking record-attendance operator handler"
```

---

### Task 5: Wire the intent into bootstrap + app

**Files:** Modify `operator-intents.ts`, `app.ts`.

- [ ] **Step 1:** In `operator-intents.ts`:
  1. Import `buildRecordAttendanceHandler, type BookingAttendanceWriter` from `./operator-intents/attendance.js` and `RECORD_ATTENDANCE_INTENT` from `./operator-intents/shared.js`. Re-export `RECORD_ATTENDANCE_INTENT` (the routes import intent consts from `../bootstrap/operator-intents.js`).
  2. Add `bookingAttendanceWriter?: BookingAttendanceWriter;` to `OperatorIntentsBootstrapDeps` (~line 94) and destructure in `bootstrapOperatorIntents` (~line 135).
  3. Handlers section (after the revenue block ~188):

```ts
if (bookingAttendanceWriter) {
  handlers.set(RECORD_ATTENDANCE_INTENT, buildRecordAttendanceHandler(bookingAttendanceWriter));
}
```

4. Registration section (after revenue register ~222):

```ts
if (bookingAttendanceWriter) {
  registerOperatorIntent(intentRegistry, RECORD_ATTENDANCE_INTENT);
}
```

5. Add `+ (bookingAttendanceWriter ? 1 : 0)` to the `intentCount` sum (~233).

- [ ] **Step 2:** In `app.ts`, inside the bootstrap `if (prismaClient)` block (~873-903), construct the writer locally (the `:657` `bookings` is a property of `reportStores`, OUT OF SCOPE here). Import `PrismaBookingStore` from `@switchboard/db` at that block (siblings `PrismaOutboxStore`/`PrismaReceiptStore` are imported there ~875-876), then:

```ts
const bookingAttendanceStore = new PrismaBookingStore(prismaClient);
// ...
bootstrapOperatorIntents({
  // ...existing deps...
  bookingAttendanceWriter: bookingAttendanceStore,
});
```

- [ ] **Step 3:** `pnpm --filter @switchboard/api typecheck` (or `pnpm typecheck`) — Expected: PASS (PrismaBookingStore structurally satisfies `BookingAttendanceWriter`).
- [ ] **Step 4:** Commit.

```bash
git add apps/api/src/bootstrap/operator-intents.ts apps/api/src/app.ts
git commit -m "feat(api): register booking.record_attendance operator intent"
```

---

### Task 6: Operator route + integration test (TDD) — the production caller

**Files:** Create `booking-attendance.ts`; Modify `routes.ts`, `test-server.ts`; Create `apps/api/src/routes/__tests__/booking-attendance.test.ts`.

- [ ] **Step 1: Extend the test harness.** Open `apps/api/src/__tests__/test-server.ts`. (a) Add an optional `bookingAttendanceWriter` to its options and thread it into the `bootstrapOperatorIntents({...})` call (mirror how it injects `revenueStore` etc., ~476-486). (b) Register the route next to `revenueRoutes` (~523): `await app.register(bookingAttendanceRoutes, { prefix: "/api" })`.

- [ ] **Step 2: Failing integration test** (`__tests__/booking-attendance.test.ts`), mirroring `revenue-ingress.test.ts`. Inject a fake `bookingAttendanceWriter` (a `recordAttendance` `vi.fn`) via `buildTestServer`. Assert, with `app.inject`:
  - `POST /api/:orgId/bookings/:bookingId/attendance` with `{ outcome: "attended" }` + an `idempotency-key` header → 200, body `{ booking }`, writer called with `(authOrgId, bookingId, "attended")`.
  - writer throwing `StaleVersionError` → 404.
  - `{ outcome: "maybe" }` → 400.
  - missing `idempotency-key` header → 4xx (mirror revenue-ingress.test.ts's idempotency assertion).
  - auth-org wins over path `:orgId` (mirror revenue-ingress.test.ts:267): a mismatched path orgId still scopes to the authenticated org.

Open `revenue-ingress.test.ts` + `test-server.ts` first and copy their exact injection + header + decorate mechanics.

- [ ] **Step 3:** Run `pnpm --filter @switchboard/api test -- booking-attendance` — Expected: FAIL (route + harness option missing).
- [ ] **Step 4: Implement the route** (`booking-attendance.ts`), cloning `revenue.ts`:

```ts
// @route-class: operator-direct
// ---------------------------------------------------------------------------
// Booking attendance route — staff/owner records attended | no_show
// ---------------------------------------------------------------------------
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";
import { RECORD_ATTENDANCE_INTENT } from "../bootstrap/operator-intents.js";

const RecordAttendanceInputSchema = z.object({
  outcome: z.enum(["attended", "no_show"]),
  recordedBy: z.enum(["owner", "staff"]).default("owner"),
});

export const bookingAttendanceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.post(
    "/:orgId/bookings/:bookingId/attendance",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const parsed = RecordAttendanceInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
      }
      const { bookingId } = request.params as { orgId: string; bookingId: string };

      const response = await app.platformIngress.submit({
        intent: RECORD_ATTENDANCE_INTENT,
        parameters: { bookingId, ...parsed.data },
        actor: { id: request.actorId, type: "user" },
        organizationId: request.orgId, // auth authoritative; :orgId path param informational
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }
      if (response.result.outcome === "failed") {
        if (response.result.error?.code === "BOOKING_NOT_FOUND") {
          return reply.code(404).send({ error: "Booking not found", statusCode: 404 });
        }
        throw new Error(response.result.error?.message ?? "Attendance recording failed");
      }
      return reply.code(200).send({ booking: response.result.outputs?.booking });
    },
  );
};
```

- [ ] **Step 5: Register in production** `routes.ts` mirroring `revenue.ts` at `routes.ts:249`: `await app.register(bookingAttendanceRoutes, { prefix: "/api" });`.
- [ ] **Step 6:** Run the integration test — Expected: PASS. **Step 7:** Commit.

```bash
git add apps/api/src/routes/booking-attendance.ts apps/api/src/bootstrap/routes.ts apps/api/src/__tests__/test-server.ts apps/api/src/routes/__tests__/booking-attendance.test.ts
git commit -m "feat(api): operator route to record booking attendance"
```

---

### Task 7: Full verification (delegate the gate-run to a subagent)

- [ ] **Step 1:** `pnpm db:generate`, then capture per-gate pass/fail:
  - `pnpm typecheck`
  - `pnpm --filter @switchboard/db test` (REQUIRED — store tests mock Prisma)
  - `pnpm --filter @switchboard/api test` (REQUIRED — app suite; typecheck-green can still red here)
  - `pnpm lint` and `pnpm format:check`
  - `pnpm arch:check`
  - `pnpm build`
  - `pnpm db:check-drift` IF Postgres reachable; else hand-verify the migration SQL == schema delta and rely on CI's drift gate.
- [ ] **Step 2:** Three-dot diff: `git diff origin/main...HEAD --stat` — only the planned files changed.
- [ ] **Step 3:** Acceptance criteria, each evidenced:
  1. `Booking.attendance` column + migration exist; client regenerated.
  2. `recordAttendance` writes org-scoped + aborts on no-match (db test green).
  3. `booking.record_attendance` registered (`system_auto_approved`); handler completes + maps not-found to `BOOKING_NOT_FOUND` (handler test green).
  4. `POST /api/:orgId/bookings/:bookingId/attendance` records via ingress (integration test green): 200 success, 404 not-found, 400 bad outcome, idempotency enforced, auth-org wins over path.
  5. No core changes; no route-allowlist entry; layering intact (`arch:check` green).
- [ ] **Step 4:** Final adversarial review (`/code-review` on the three-dot diff). Resolve findings.

## Out of scope (later slices)

Held-rate read + dashboard tile + staff check-in UI (Slice 2); booked→`held` Receipt promotion; recovery workflows; attribution_confidence; exceptions[]; consent-completeness.
