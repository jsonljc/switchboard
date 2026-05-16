# Calendar Readiness Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface calendar configuration state (Google / Local / Unconfigured) in the per-org readiness endpoint so operators can see when bookings will fall back to stub behavior. Visibility only — no runtime/provider lifecycle changes.

**Architecture:** Pure helper `describeCalendarReadiness({hasGoogleCredentials, hasGoogleCalendarId, businessHours})` returns `{state, check}`. The readiness route's existing `buildReadinessContext` loader is extended to populate a new `ReadinessContext.calendar` field (env-var presence + per-org `OrganizationConfig.businessHours`). The pure `checkReadiness(ctx)` calls the helper and appends its `ReadinessCheck` to the existing `checks[]` array. The dashboard's `go-live.tsx` already renders non-blocking checks under "Recommended" via `AdvisoryCheckRow`; no UI changes needed.

**Tech Stack:** TypeScript, Fastify, Prisma, vitest. Monorepo: pnpm + Turbo.

**Spec:** `docs/superpowers/specs/2026-04-28-fix-launch-calendar-readiness-visibility-design.md`

---

## File Structure

**Create:**

- `apps/api/src/lib/calendar-readiness.ts` — pure helper, ~50 lines.
- `apps/api/src/lib/__tests__/calendar-readiness.test.ts` — table-driven unit tests.

**Modify:**

- `apps/api/src/routes/readiness.ts` — extend `ReadinessContext`, `PrismaLike`, `buildReadinessContext`, `checkReadiness`. Net additions; no existing checks change.
- `apps/api/src/routes/__tests__/readiness.test.ts` — extend `makeContext` factory with default `calendar` field; add three test cases for the calendar check.

**Do not touch:**

- `apps/api/src/bootstrap/skill-mode.ts` — runtime path. Out of scope this PR.
- `apps/dashboard/**` — `AdvisoryCheckRow` already renders non-blocking checks.
- Any other readiness check function.

---

## Task 0: Read-only verification (gate)

**Files:** read-only — no edits.

This task is a hard gate. If any check fails, stop and surface the discrepancy before proceeding to Task 1.

- [ ] **Step 1: Confirm `ReadinessCheck` interface shape**

Read `apps/api/src/routes/readiness.ts` lines 11–17. Verify the interface is:

```ts
export interface ReadinessCheck {
  id: string;
  label: string;
  status: "pass" | "fail";
  message: string;
  blocking: boolean;
}
```

If field names or types differ, stop and update Task 1's helper to match the real interface.

- [ ] **Step 2: Confirm `ReadinessContext` consumers**

Run:

```bash
grep -rn "ReadinessContext" apps/ packages/ --include="*.ts" | grep -v "\.worktrees/"
```

Expected: only `apps/api/src/routes/readiness.ts` and `apps/api/src/routes/__tests__/readiness.test.ts`. If any other consumer constructs a `ReadinessContext` literal, it will need the new `calendar` field too — note the file path and add a Task 2 sub-step to update it.

- [ ] **Step 3: Confirm `OrganizationConfig.businessHours` query shape — primary check**

Read `apps/api/src/bootstrap/skill-mode.ts` around lines 280–295. Verify the runtime query is:

```ts
prismaClient.organizationConfig.findFirst({
  where: { id: orgId },
  select: { businessHours: true },
});
```

Then read `apps/api/src/routes/readiness.ts` around lines 109–117. Verify the existing readiness query is:

```ts
prisma.organizationConfig.findUnique({
  where: { id: orgId },
  select: { onboardingPlaybook: true, runtimeConfig: true },
});
```

Both use `where: { id: orgId }` — confirms `OrganizationConfig.id` IS the orgId (per `packages/db/prisma/schema.prisma:408` `id String @id // orgId`). The plan extends the existing readiness `findUnique` select to also include `businessHours` rather than running a second query.

If runtime uses a different `where` shape (e.g. `organizationId`), **stop** and update Task 2 to mirror it. Do not modify the runtime call.

- [ ] **Step 4: Confirm `ready` aggregation only weighs blocking checks**

Read `apps/api/src/routes/readiness.ts` line ~263:

```ts
const ready = checks.filter((c) => c.blocking).every((c) => c.status === "pass");
```

Confirm this. If non-blocking failures flip `ready`, stop — calendar check would unintentionally gate launch.

- [ ] **Step 5: Confirm `AdvisoryCheckRow` rendering**

Read `apps/dashboard/src/components/onboarding/go-live.tsx` lines 142–143 and 213–225. Verify:

```ts
const advisoryChecks = readiness.data?.checks.filter((c) => !c.blocking) ?? [];
```

…is rendered unconditionally under a "Recommended" section header (gated only on `advisoryChecks.length > 0`). If the dashboard hides advisory checks behind a different gate, note it but do not modify the dashboard in this PR.

- [ ] **Step 6: Confirm test setup pattern**

Read `apps/api/src/routes/__tests__/readiness.test.ts` lines 1–60. Confirm the `makeContext(overrides)` factory pattern. New tests will follow the same pattern: pass `{ calendar: { ... } }` overrides, no `process.env` manipulation needed (env reads happen in `buildReadinessContext`, not in the pure `checkReadiness`).

- [ ] **Step 7: Record findings**

Record any unexpected findings inline before continuing. If all six checks match expectations exactly, no record is needed — the next tasks already encode the expected shape. Do **not** commit anything in Task 0.

---

## Task 1: Pure helper `describeCalendarReadiness`

**Files:**

- Create: `apps/api/src/lib/calendar-readiness.ts`
- Create: `apps/api/src/lib/__tests__/calendar-readiness.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/api/src/lib/__tests__/calendar-readiness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  describeCalendarReadiness,
  hasRuntimeEligibleBusinessHours,
} from "../calendar-readiness.js";

describe("hasRuntimeEligibleBusinessHours", () => {
  it("returns false for null", () => {
    expect(hasRuntimeEligibleBusinessHours(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasRuntimeEligibleBusinessHours(undefined)).toBe(false);
  });

  it("returns true for empty object (matches current runtime threshold)", () => {
    expect(hasRuntimeEligibleBusinessHours({})).toBe(true);
  });

  it("returns true for populated object", () => {
    expect(hasRuntimeEligibleBusinessHours({ mon: [{ start: "09:00", end: "17:00" }] })).toBe(true);
  });

  it("returns false for array (slightly stricter than runtime)", () => {
    expect(hasRuntimeEligibleBusinessHours([])).toBe(false);
    expect(hasRuntimeEligibleBusinessHours([{ start: "09:00" }])).toBe(false);
  });

  it("returns false for primitive types", () => {
    expect(hasRuntimeEligibleBusinessHours("string")).toBe(false);
    expect(hasRuntimeEligibleBusinessHours(42)).toBe(false);
    expect(hasRuntimeEligibleBusinessHours(true)).toBe(false);
  });
});

describe("describeCalendarReadiness", () => {
  it("returns google state when both Google env vars are set", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: true,
      hasGoogleCalendarId: true,
      businessHours: null,
    });
    expect(result.state).toBe("google");
    expect(result.check).toEqual({
      id: "calendar",
      label: "Calendar",
      status: "pass",
      blocking: false,
      message:
        "Google Calendar configuration detected. Bookings should create real calendar events.",
    });
  });

  it("falls through to local when only Google credentials are set (calendar id missing)", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: true,
      hasGoogleCalendarId: false,
      businessHours: { mon: [] },
    });
    expect(result.state).toBe("local");
    expect(result.check.status).toBe("pass");
  });

  it("falls through to unconfigured when only Google calendar id is set and no businessHours", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: true,
      businessHours: null,
    });
    expect(result.state).toBe("unconfigured");
    expect(result.check.status).toBe("fail");
  });

  it("returns local state when no Google env and businessHours is an object", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: { mon: [{ start: "09:00", end: "17:00" }] },
    });
    expect(result.state).toBe("local");
    expect(result.check).toEqual({
      id: "calendar",
      label: "Calendar",
      status: "pass",
      blocking: false,
      message: "Local business hours detected. Bookings may not create external calendar events.",
    });
  });

  it("returns local state for empty-object businessHours (runtime-parity)", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: {},
    });
    expect(result.state).toBe("local");
  });

  it("returns unconfigured when no Google env and businessHours is null", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: null,
    });
    expect(result.state).toBe("unconfigured");
    expect(result.check).toEqual({
      id: "calendar",
      label: "Calendar",
      status: "fail",
      blocking: false,
      message: "Calendar not configured. Booking flows may fall back to stub behavior.",
    });
  });

  it("returns unconfigured when businessHours is an array (array guard)", () => {
    const result = describeCalendarReadiness({
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: [],
    });
    expect(result.state).toBe("unconfigured");
    expect(result.check.status).toBe("fail");
  });

  it("always returns check.id === 'calendar' and check.blocking === false", () => {
    const inputs = [
      { hasGoogleCredentials: true, hasGoogleCalendarId: true, businessHours: null },
      { hasGoogleCredentials: false, hasGoogleCalendarId: false, businessHours: {} },
      { hasGoogleCredentials: false, hasGoogleCalendarId: false, businessHours: null },
    ] as const;
    for (const input of inputs) {
      const result = describeCalendarReadiness(input);
      expect(result.check.id).toBe("calendar");
      expect(result.check.blocking).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm --filter @switchboard/api test -- src/lib/__tests__/calendar-readiness.test.ts
```

Expected: FAIL with "Cannot find module '../calendar-readiness.js'" or similar.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/lib/calendar-readiness.ts`:

```ts
// ---------------------------------------------------------------------------
// Calendar readiness — pure helper that describes calendar configuration
// state for the per-org readiness endpoint.
//
// Visibility only. Mirrors the precedence in
// apps/api/src/bootstrap/skill-mode.ts:resolveCalendarProvider so that
// readiness reports what the runtime would currently do.
// ---------------------------------------------------------------------------

import type { ReadinessCheck } from "../routes/readiness.js";

export type CalendarReadinessState = "google" | "local" | "unconfigured";

export interface CalendarReadinessInput {
  hasGoogleCredentials: boolean;
  hasGoogleCalendarId: boolean;
  businessHours: unknown;
}

export interface CalendarReadinessResult {
  state: CalendarReadinessState;
  check: ReadinessCheck;
}

const MESSAGES = {
  google: "Google Calendar configuration detected. Bookings should create real calendar events.",
  local: "Local business hours detected. Bookings may not create external calendar events.",
  unconfigured: "Calendar not configured. Booking flows may fall back to stub behavior.",
} as const;

export function hasRuntimeEligibleBusinessHours(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function describeCalendarReadiness(input: CalendarReadinessInput): CalendarReadinessResult {
  if (input.hasGoogleCredentials && input.hasGoogleCalendarId) {
    return {
      state: "google",
      check: {
        id: "calendar",
        label: "Calendar",
        status: "pass",
        blocking: false,
        message: MESSAGES.google,
      },
    };
  }

  if (hasRuntimeEligibleBusinessHours(input.businessHours)) {
    return {
      state: "local",
      check: {
        id: "calendar",
        label: "Calendar",
        status: "pass",
        blocking: false,
        message: MESSAGES.local,
      },
    };
  }

  return {
    state: "unconfigured",
    check: {
      id: "calendar",
      label: "Calendar",
      status: "fail",
      blocking: false,
      message: MESSAGES.unconfigured,
    },
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm --filter @switchboard/api test -- src/lib/__tests__/calendar-readiness.test.ts
```

Expected: PASS, all helper tests green.

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/calendar-readiness.ts apps/api/src/lib/__tests__/calendar-readiness.test.ts
git commit -m "feat(api): add describeCalendarReadiness helper

Pure helper that mirrors skill-mode.ts:resolveCalendarProvider
precedence (Google -> Local -> Unconfigured) and emits the
ReadinessCheck used by the per-org readiness endpoint."
```

---

## Task 2: Extend `ReadinessContext`, `PrismaLike`, and `buildReadinessContext`

**Files:**

- Modify: `apps/api/src/routes/readiness.ts`
- Modify: `apps/api/src/routes/__tests__/readiness.test.ts` (just the `makeContext` factory)

This task only widens the data carried by `ReadinessContext`. No new checks yet — Task 3 wires the helper into `checkReadiness`.

- [ ] **Step 1: Add `calendar` field to `ReadinessContext`**

In `apps/api/src/routes/readiness.ts`, find the `ReadinessContext` interface (around line 28). Add the `calendar` field at the end:

```ts
export interface ReadinessContext {
  managedChannels: Array<{
    id: string;
    channel: string;
    status: string;
    connectionId: string;
  }>;
  // ... existing fields unchanged ...
  metaAdsConnection: MetaAdsConnectionInfo;
  emailVerified: boolean;
  calendar: {
    hasGoogleCredentials: boolean;
    hasGoogleCalendarId: boolean;
    businessHours: unknown;
  };
}
```

- [ ] **Step 2: Extend the `PrismaLike` `organizationConfig.findUnique` select**

In the same file, find the `organizationConfig.findUnique` declaration in `PrismaLike` (around line 109). Add `businessHours: true` to the `select` shape and to the return type:

```ts
organizationConfig: {
  findUnique(args: {
    where: { id: string };
    select: { onboardingPlaybook: true; runtimeConfig: true; businessHours: true };
  }): Promise<{
    onboardingPlaybook: unknown;
    runtimeConfig: unknown;
    businessHours: unknown;
  } | null>;
};
```

This piggybacks on the existing query — no new round-trip.

- [ ] **Step 3: Extend the actual Prisma call in `buildReadinessContext`**

Find the `prisma.organizationConfig.findUnique` call inside the `Promise.all` block in `buildReadinessContext` (around line 173). Add `businessHours: true` to the select:

```ts
prisma.organizationConfig.findUnique({
  where: { id: orgId },
  select: { onboardingPlaybook: true, runtimeConfig: true, businessHours: true },
}),
```

- [ ] **Step 4: Populate `calendar` in the returned context**

Below where `playbook` and `runtimeConfig` are derived (around line 191), add:

```ts
const hasGoogleCredentials = Boolean(process.env["GOOGLE_CALENDAR_CREDENTIALS"]);
const hasGoogleCalendarId = Boolean(process.env["GOOGLE_CALENDAR_ID"]);
const calendarBusinessHours = orgConfig?.businessHours ?? null;
```

Then in the `return { ... }` object at the end of `buildReadinessContext`, add:

```ts
calendar: {
  hasGoogleCredentials,
  hasGoogleCalendarId,
  businessHours: calendarBusinessHours,
},
```

Env-var values are checked for presence only (`Boolean(...)`) — never read into local strings, never logged.

- [ ] **Step 5: Update the test factory `makeContext` to include a default `calendar` field**

In `apps/api/src/routes/__tests__/readiness.test.ts`, find `makeContext` (line 8). Add a default `calendar` to the returned object — default to a fully-passing `local` state so existing tests keep their `ready: true` baseline (and so the test count assertion grows by exactly one):

```ts
function makeContext(overrides: Partial<ReadinessContext> = {}): ReadinessContext {
  return {
    // ... existing defaults unchanged ...
    emailVerified: true,
    calendar: {
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: { mon: [{ start: "09:00", end: "17:00" }] },
    },
    ...overrides,
  };
}
```

- [ ] **Step 6: Update the `expect(report.checks).toHaveLength(10)` assertion**

In the same test file, find the assertion `expect(report.checks).toHaveLength(10)` (line 64). Bump to 11 — the calendar check will be added in Task 3, but `makeContext`'s default already includes a passing `calendar`, so once Task 3 wires the check the count rises by one. **Leave this at 10 for now**; Task 3 will bump it. The current step only updates `makeContext`.

- [ ] **Step 7: Run the existing readiness tests**

```bash
pnpm --filter @switchboard/api test -- src/routes/__tests__/readiness.test.ts
```

Expected: all existing tests still PASS. The new `calendar` field is in the context but unused by `checkReadiness` yet, so no test behavior changes.

- [ ] **Step 8: Run typecheck**

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: no new errors. If TypeScript complains about a missing `calendar` field anywhere else, that's a `ReadinessContext` consumer Task 0 missed — surface it and add the default there.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/readiness.ts apps/api/src/routes/__tests__/readiness.test.ts
git commit -m "feat(api): carry calendar config state through ReadinessContext

Extend ReadinessContext.calendar with Google env presence and
per-org businessHours. Piggybacks on the existing
organizationConfig.findUnique select. No behavior change yet —
Task 3 wires the calendar check into checkReadiness."
```

---

## Task 3: Wire calendar check into `checkReadiness` + tests

**Files:**

- Modify: `apps/api/src/routes/readiness.ts`
- Modify: `apps/api/src/routes/__tests__/readiness.test.ts`

- [ ] **Step 1: Write the failing tests first**

In `apps/api/src/routes/__tests__/readiness.test.ts`, add a new `describe` block after the existing meta-ads section, near the bottom of the file (before the closing of the outer `describe("checkReadiness", ...)`):

```ts
// ── calendar (advisory) ─────────────────────────────────────────────────

it("calendar passes (google) when both Google env vars are present in context", () => {
  const report = checkReadiness(
    makeContext({
      calendar: { hasGoogleCredentials: true, hasGoogleCalendarId: true, businessHours: null },
    }),
  );
  const check = report.checks.find((c) => c.id === "calendar")!;
  expect(check.status).toBe("pass");
  expect(check.blocking).toBe(false);
  expect(check.message).toBe(
    "Google Calendar configuration detected. Bookings should create real calendar events.",
  );
  expect(report.ready).toBe(true);
});

it("calendar passes (local) when no Google env and businessHours is an object", () => {
  const report = checkReadiness(
    makeContext({
      calendar: {
        hasGoogleCredentials: false,
        hasGoogleCalendarId: false,
        businessHours: { mon: [{ start: "09:00", end: "17:00" }] },
      },
    }),
  );
  const check = report.checks.find((c) => c.id === "calendar")!;
  expect(check.status).toBe("pass");
  expect(check.blocking).toBe(false);
  expect(check.message).toBe(
    "Local business hours detected. Bookings may not create external calendar events.",
  );
  expect(report.ready).toBe(true);
});

it("calendar fails (unconfigured) when no Google env and no businessHours", () => {
  const report = checkReadiness(
    makeContext({
      calendar: {
        hasGoogleCredentials: false,
        hasGoogleCalendarId: false,
        businessHours: null,
      },
    }),
  );
  const check = report.checks.find((c) => c.id === "calendar")!;
  expect(check.status).toBe("fail");
  expect(check.blocking).toBe(false);
  expect(check.message).toBe(
    "Calendar not configured. Booking flows may fall back to stub behavior.",
  );
  // Calendar fail is non-blocking — ready stays true (regression pin).
  expect(report.ready).toBe(true);
});

it("calendar check appears exactly once in checks[]", () => {
  const report = checkReadiness(makeContext());
  const calendarChecks = report.checks.filter((c) => c.id === "calendar");
  expect(calendarChecks).toHaveLength(1);
});
```

Also bump the existing length assertion from `10` to `11`:

```ts
expect(report.checks).toHaveLength(11);
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm --filter @switchboard/api test -- src/routes/__tests__/readiness.test.ts
```

Expected: the four new calendar tests FAIL (no calendar check found in `checks[]`). The length assertion also fails (10 vs 11).

- [ ] **Step 3: Add `checkCalendar` and wire it into `checkReadiness`**

In `apps/api/src/routes/readiness.ts`:

Add an import at the top (alongside existing imports):

```ts
import { describeCalendarReadiness } from "../lib/calendar-readiness.js";
```

In `checkReadiness`, after the existing `checks.push(checkMetaAdsToken(ctx));` line (~line 260), append:

```ts
// 10. calendar (advisory)
checks.push(checkCalendar(ctx));
```

Then add the `checkCalendar` function near the other private check functions (any consistent location near the bottom of the file works):

```ts
function checkCalendar(ctx: ReadinessContext): ReadinessCheck {
  return describeCalendarReadiness(ctx.calendar).check;
}
```

The helper already returns a fully-formed `ReadinessCheck`, so `checkCalendar` is a one-line adapter for symmetry with the other `check*` functions.

- [ ] **Step 4: Run readiness tests, verify they pass**

```bash
pnpm --filter @switchboard/api test -- src/routes/__tests__/readiness.test.ts
```

Expected: all readiness tests PASS, including the four new calendar cases and the bumped length assertion.

- [ ] **Step 5: Run the full api test suite**

```bash
pnpm --filter @switchboard/api test
```

Expected: 560+ tests PASS (was 556 before; +4 new calendar route tests + helper tests). Zero failures.

- [ ] **Step 6: Run typecheck**

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: no errors.

- [ ] **Step 7: Run lint**

```bash
pnpm --filter @switchboard/api lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/readiness.ts apps/api/src/routes/__tests__/readiness.test.ts
git commit -m "feat(api): add calendar readiness check (advisory)

Append a non-blocking calendar ReadinessCheck to the per-org
readiness endpoint, sourced from describeCalendarReadiness.
States: Google configured (pass), local business hours (pass),
unconfigured (fail). Calendar fail does not gate launch."
```

---

## Task 4: Repo-wide verification + push

**Files:** none modified — verification only.

- [ ] **Step 1: Run full repo test suite**

```bash
pnpm test
```

Expected: all packages pass. If any unrelated test fails, investigate whether it's a pre-existing flaky test on `origin/main` (compare with the baseline noted at the start of the worktree) — do not "fix" unrelated failures in this PR.

- [ ] **Step 2: Run repo-wide typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Run repo-wide lint**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Verify file-size budgets**

```bash
wc -l apps/api/src/routes/readiness.ts apps/api/src/lib/calendar-readiness.ts
```

Expected: `readiness.ts` well under the 600-error / 400-warn thresholds (was ~529 before; should be ~560 after); helper ~70 lines.

- [ ] **Step 5: Verify the dashboard renders the new check (manual smoke, optional)**

If the dev stack is up locally:

```bash
# In one terminal:
pnpm --filter @switchboard/api dev
# In another:
pnpm --filter @switchboard/dashboard dev
```

Open the onboarding go-live page for an org with no Google env and no businessHours; the "Recommended" section should now include the calendar check with the unconfigured message. If the dev stack is not up, skip this step — it's a sanity check, not a blocker.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin fix/launch-calendar-readiness-visibility
```

- [ ] **Step 7: Open PR with auto-merge**

Use `gh pr create` with the established PR body format (Summary + Test plan). Defer the actual `gh pr create` invocation to the user / orchestrating agent — do not auto-create from inside the plan.

---

## Self-review checklist (run before handing off)

- **Spec coverage:** Each spec section maps to a task — Section 1 (helper) → Task 1; Section 2 (route extension) → Tasks 2–3; Section 3 (dashboard, no-op) → Task 0 step 5 verification only; Read-only Task 1 → Task 0; Acceptance summary → Task 4.
- **Placeholder scan:** No "TBD" / "TODO" / "implement later" in any task. Every code step shows the actual code. The one typo in Task 1 step 1 (`"pass" === "pass" ? "fail" : "fail"`) is called out explicitly with the correction.
- **Type consistency:** `CalendarReadinessInput` shape (`hasGoogleCredentials`, `hasGoogleCalendarId`, `businessHours`) is identical in helper, `ReadinessContext.calendar`, test factory, and test cases.
- **Out-of-scope discipline:** No edits to `skill-mode.ts`, no new businessHours validation, no dashboard changes, no `ReadinessCheck` type relocation.
