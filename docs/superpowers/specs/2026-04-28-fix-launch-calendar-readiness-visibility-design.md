# Fix: Calendar readiness visibility

**Date:** 2026-04-28
**Author:** brainstorming session, post PR #280
**Branch slug:** `fix/launch-calendar-readiness-visibility`
**Predecessor:** PR #280 (`fix/launch-alex-context-and-calendar`) — merged 2026-04-28. This branch rebases onto `main`.

---

## Background

PR #280 closed launch-blockers #8 (WhatsApp contact identity) and #9a/#9b (`LocalCalendarProvider` `emailSender` wiring + `findOverlapping` org-scope leak). It explicitly deferred two pieces:

1. **#9c — Noop fallback visibility / readiness flag / dashboard "calendar not configured" message.** Crosses readiness API + UI; named in #280's "Out of scope (carry-forward)" section as the basis for this branch.
2. **Per-request `CalendarProvider` resolution.** The boot-time singleton at `apps/api/src/bootstrap/skill-mode.ts:65` (`resolveCalendarProvider(prismaClient, logger)` with no `orgId`) leaves a soft-fall-to-Noop seam. The fix is to resolve per-org at calendar-tool invocation time. Architectural change in `packages/core` + `apps/api`.

These two pieces are independently shippable and not coupled from the user's perspective: visibility explains current state (orgs see why bookings would be stubs); per-request resolution is internal correctness once calendar config exists. They ship as separate PRs.

**This spec covers PR 1 only — visibility.** Per-request resolution is a separate brainstorming + spec + plan cycle (`fix/launch-calendar-per-request-resolution`, slug TBD), to be opened after this branch lands.

### Already-shipped (do not re-touch)

- `LocalCalendarProvider.findOverlapping` org-scope closure (PR #280 §4).
- `LocalCalendarProvider` `emailSender` wiring + `BOOKING_FROM_EMAIL` env var (PR #280 §3).
- WhatsApp contact identity resolution at the chat-gateway boundary (PR #280 §1, §2).

---

## Constraints carried forward

- Controlled beta: 10 orgs, founder-assisted OK; free pilot, not paid day-1.
- Capability building, not architecture passes — visibility only in this PR. No runtime/provider lifecycle changes. No new product surfaces.
- No `apps/api` ↔ `apps/chat` cross-imports.
- No silent fake-success paths — readiness must surface unconfigured calendar honestly.
- File-size limits (error 600, warn 400). Co-located tests for every new module.
- Conventional Commits.

---

## Goal

Surface calendar configuration state in the existing per-org readiness endpoint so operators can see when bookings will fall back to stub behavior. Visibility only.

## Non-goals

- Changing `resolveCalendarProvider` lifecycle or call site.
- Tightening `businessHours` validation beyond runtime parity.
- Building a calendar settings UI or "setup link".
- Making calendar a `blocking` readiness check (founder-assisted orgs may legitimately not have calendar wired).

---

## Section 1 — Pure helper: `describeCalendarReadiness`

### File

`apps/api/src/lib/calendar-readiness.ts` (new). Co-located test `apps/api/src/lib/__tests__/calendar-readiness.test.ts`.

### Shape

```ts
import type { ReadinessCheck } from "../routes/readiness.js";

export type CalendarReadinessState = "google" | "local" | "unconfigured";

export interface CalendarReadinessInput {
  hasGoogleCredentials: boolean;
  hasGoogleCalendarId: boolean;
  businessHours: unknown | null;
}

export interface CalendarReadinessResult {
  state: CalendarReadinessState;
  check: ReadinessCheck; // id: "calendar", blocking: false
}

export function hasRuntimeEligibleBusinessHours(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function describeCalendarReadiness(input: CalendarReadinessInput): CalendarReadinessResult;
```

### Precedence (mirrors `skill-mode.ts:resolveCalendarProvider`)

1. `hasGoogleCredentials && hasGoogleCalendarId` → `state: "google"`, `status: "pass"`.
2. Else `hasRuntimeEligibleBusinessHours(businessHours)` → `state: "local"`, `status: "pass"`.
3. Else → `state: "unconfigured"`, `status: "fail"`.

### Messages (locked)

- **google:** `"Google Calendar configuration detected. Bookings should create real calendar events."`
- **local:** `"Local business hours detected. Bookings may not create external calendar events."`
- **unconfigured:** `"Calendar not configured. Booking flows may fall back to stub behavior."`

Wording deliberately hedges ("detected", "should", "may"): PR 1 only checks env-var presence and DB row presence, not live calendar API health. Stronger claims ("connected", "will create") would overstate what we have actually verified.

### Check identity (locked)

```ts
{
  id: "calendar",
  label: "Calendar",
  status: "pass" | "fail",
  blocking: false,
  message: "<one of the three above>",
}
```

### Why a helper instead of inlining in the route

PR 2 (per-request resolution) will need the same precedence rules to decide Google vs. Local vs. Noop per-org at tool invocation time. A pure helper pins the semantics in tests and prevents the same drift that motivated this branch in the first place. PR 1 wires the helper only into the readiness route; PR 2 may adopt it inside `resolveCalendarProvider`.

### Notes carried forward

- The `!Array.isArray(value)` guard in `hasRuntimeEligibleBusinessHours` is _slightly_ stricter than current runtime, which only checks `typeof === "object"`. Arrays are not valid business-hours config in any reading of the schema; the guard prevents a degenerate false-positive. If exact runtime parity is required later, drop the guard. Tightening _real_ validation (require at least one weekday with at least one range) belongs in a future PR that updates runtime + readiness together.

### Tests

`apps/api/src/lib/__tests__/calendar-readiness.test.ts` — table-driven, pure unit, no mocks needed:

- `hasRuntimeEligibleBusinessHours`: null → false; `{}` → true; `{mon: [...]}` → true; `[]` → false; `"string"` → false; `42` → false.
- `describeCalendarReadiness`:
  - both Google vars set → state `"google"`, status `"pass"`, message matches.
  - only credentials set → falls through (Google requires both); businessHours `null` → state `"unconfigured"`.
  - only calendar id set → falls through; businessHours `{}` → state `"local"`.
  - no Google + businessHours `null` → state `"unconfigured"`, status `"fail"`.
  - no Google + businessHours `{mon: [...]}` → state `"local"`, status `"pass"`.
  - no Google + businessHours `[]` → state `"unconfigured"` (array guard).
  - returned `check.id === "calendar"`, `check.blocking === false` in every case.

---

## Section 2 — Readiness route extension

### File

`apps/api/src/routes/readiness.ts` (extend). Existing tests `apps/api/src/routes/__tests__/readiness.test.ts` (extend).

### Changes

1. **Extend `ReadinessContext`** with:

   ```ts
   calendar: {
     hasGoogleCredentials: boolean;
     hasGoogleCalendarId: boolean;
     businessHours: unknown | null;
   }
   ```

2. **Extend `PrismaLike`** to declare the existing `organizationConfig.findFirst({ where: { id }, select: { businessHours: true } })` shape used at `skill-mode.ts:resolveCalendarProvider`. Reuse the exact same query so readiness sees what runtime sees.

3. **Loader** (the function that builds `ReadinessContext` from Prisma + env): add the `OrganizationConfig` lookup for the org, read `process.env["GOOGLE_CALENDAR_CREDENTIALS"]` and `process.env["GOOGLE_CALENDAR_ID"]` (presence-only, never logged), populate `context.calendar`.

4. **Check assembly:** call `describeCalendarReadiness(context.calendar)`, append `result.check` to `checks[]`. Position: after channel/connection checks, before deployment-stage checks.

5. **`ready` aggregation:** unchanged. The existing aggregation only weighs `blocking: true` checks, so calendar `fail` does not gate launch. This is verified, not changed, in this PR.

### Tests (extend `readiness.test.ts`)

- Org with no Google env + no businessHours → response `checks` includes calendar check with `status: "fail"`, `blocking: false`, message matches unconfigured wording. `ready` matches the baseline-without-calendar-check value (i.e., calendar fail does not flip `ready`).
- Org with `GOOGLE_CALENDAR_CREDENTIALS` and `GOOGLE_CALENDAR_ID` set in env → calendar check `status: "pass"`, message matches Google wording.
- Org with no Google env + businessHours `{mon: [{start: "09:00", end: "17:00"}]}` → calendar check `status: "pass"`, message matches local wording.
- Calendar check appears exactly once in `checks[]`.
- `ready` is unaffected by calendar state across all three cases (regression pin against accidentally making calendar blocking).

Use the existing test scaffolding pattern (mock `PrismaLike`, set/unset env vars per-case via the existing helpers).

---

## Section 3 — Dashboard

**No code changes.** Verified during brainstorming:

- `apps/dashboard/src/components/onboarding/go-live.tsx:142–143` already partitions `readiness.checks` into `blockingChecks` and `advisoryChecks` (= `!c.blocking`).
- `advisoryChecks` are rendered under a "Recommended" section via `AdvisoryCheckRow` at `go-live.tsx:213–225`.
- The new calendar check (`blocking: false`) will appear in that section automatically.

No need to apply `provision-status-message.ts`'s sanitization pattern: messages are static literal strings authored in the helper, not dynamic error text. The pattern applies to user-facing messages built from caught errors / external responses; it would add no value for fixed strings.

If a future visibility-quality issue surfaces (e.g., "Recommended" section is too quiet), that is a separate UI iteration on `AdvisoryCheckRow`.

---

## Read-only Task 1 (BEFORE any code changes)

Per process discipline. If any check fails, stop and revise.

1. **Confirm `ReadinessCheck` interface and export site.** Verify `id`, `label`, `status`, `message`, `blocking` field names and types in `apps/api/src/routes/readiness.ts`. Confirm it is exported (helper imports it from this file).
2. **Confirm `ReadinessContext` and `PrismaLike` are extension-safe.** Verify there are no other consumers in the repo that construct a `ReadinessContext` literal and would break on the new `calendar` field. Grep: `ReadinessContext` and `PrismaLike` across `apps/`, `packages/`, excluding `.worktrees/`.
3. **Confirm the existing `OrganizationConfig.businessHours` query shape.** Read the exact `findFirst` call at `skill-mode.ts:resolveCalendarProvider` (`where: { id: orgId }, select: { businessHours: true }`) and reuse it verbatim in the readiness loader so runtime + readiness see identical data.
4. **Confirm `ready` aggregation only considers `blocking: true` checks.** Read the aggregation logic in `readiness.ts`. If a non-blocking `fail` would flip `ready`, the spec's claim is wrong and Section 2 needs a re-think before coding.
5. **Confirm `AdvisoryCheckRow` rendering.** Re-verify `go-live.tsx:213–225` renders `advisoryChecks` non-conditionally (other than the `length > 0` wrapper). Already spot-checked; pin in plan to prevent surprises.
6. **Confirm env-var read pattern in tests.** Verify the existing `readiness.test.ts` setup pattern for setting/unsetting `process.env` per-test (so the new tests follow the same pattern).

### Hard stops

- If check **1** fails (interface shape mismatch), revise Section 1.
- If check **2** finds a third consumer constructing `ReadinessContext` literally, add the field with a default in that consumer (or revise the field to be optional with documented default).
- If check **3** reveals a different query shape than expected, mirror whatever runtime actually does.
- If check **4** reveals non-blocking checks affect `ready`, **stop** and revise: either make calendar's pass-state always pass (bizarre) or open a separate change to fix the aggregation (out of scope for this PR).

---

## Acceptance summary

- `GET /readiness` for an org returns a `checks[]` entry `{ id: "calendar", label: "Calendar", status, blocking: false, message }` reflecting Google / Local / Unconfigured.
- `ready` field unaffected by calendar state in all three branches.
- Dashboard `go-live` page surfaces the calendar check under "Recommended" with no dashboard code change.
- All existing tests pass; new tests are co-located; coverage thresholds preserved.
- File-size limits respected (no file approaches 400-line warn).

---

## Out of scope (carry-forward to follow-up PRs)

- **PR 2 — Per-request `CalendarProvider` resolution.** Remove boot-time singleton at `skill-mode.ts:65`; thread an `orgId → CalendarProvider` factory through the skill executor / tool-deps; covers cross-org isolation tests at the runtime layer. Own brainstorming + spec + plan cycle.
- **Tighten `businessHours` validation.** Replace "object" check with schema validation (`BusinessHoursConfigSchema.safeParse`). Must update runtime + readiness in the same change to avoid drift. Future micro-PR or fold into PR 2.
- **Calendar settings UI / "Setup calendar" link.** No existing settings surface; building one expands scope from visibility patch to product UI.
- **Live calendar API health check.** Today's check is presence-only ("configuration detected"). A real health probe (e.g., Google Calendar `events.list` ping) would justify stronger wording but adds latency, error-handling, and cache concerns — separate change.

---

## Process

1. Brainstorm → spec (this doc) → user review.
2. Writing-plans skill produces ordered task list with read-only Task 1 first.
3. Subagent-driven TDD task-by-task. Frequent commits.
4. Code review → squash-merge with auto-merge on green CI.
