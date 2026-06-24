# A8 — Alex booking wrong-target reschedule/cancel guard (implementation plan)

> Ephemeral build-loop scratch (uncommitted). NOT a docs/ spec. Execute task-by-task with TDD.

**Goal:** When `booking.reschedule`/`booking.cancel` receive a `service` that matches NONE of the
contact's upcoming bookings, surface a `NO_MATCHING_BOOKING` failure instead of silently acting on
an unrelated (soonest) booking.

**Architecture:** Centralize target selection in `resolveTarget` (calendar-reschedule.ts) returning a
discriminated `TargetResolution` (`ok` | `none` | `no_match`). Both operations map the three kinds
to results uniformly, so the fix lands in both reschedule + cancel without duplicating the
disambiguation. Pre-mutation guard only — provider/store mutation code is byte-identical.

**Tech stack:** TypeScript (packages/core), vitest. ESM, `.js` import extensions.

## Global constraints (verbatim)

- No `any`; unused vars `_`-prefixed; no `console.log`; double quotes, semi, 2-space, 100-col.
- Co-located `*.test.ts`. Lowercase commit subject (Conventional Commits). No em-dashes.
- `fail(code, message, opts)` legacy form: code is a free string (tool-result.ts:45). New code
  `NO_MATCHING_BOOKING` needs no enum change; grep confirmed ZERO code consumers of booking codes
  (only the LLM reads them via modelRemediation).
- Only behavior change permitted: service supplied + zero matches -> no_match. The `!service`
  soonest-first path stays byte-identical (existing tests must stay green).

---

## Task 1: RED — prove the wrong-target cancel defect

**Files:**

- Test: `packages/core/src/skill-runtime/tools/calendar-reschedule.test.ts`

- [ ] **Step 1: Add the two-service fixture + failing test** (append to the test file)

```ts
const twoBookings = [
  {
    id: "b1",
    calendarEventId: "evt-1",
    service: "filler",
    startsAt: new Date("2026-06-12T02:00:00Z"),
    endsAt: new Date("2026-06-12T03:00:00Z"),
    status: "confirmed",
  },
  {
    id: "b2",
    calendarEventId: "evt-2",
    service: "dysport",
    startsAt: new Date("2026-06-15T02:00:00Z"),
    endsAt: new Date("2026-06-15T03:00:00Z"),
    status: "confirmed",
  },
];

it("cancel does NOT cancel an unrelated booking when the requested service matches none", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ id: "b1" }),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({
    service: "botox",
  });
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("NO_MATCHING_BOOKING");
  expect(d.bookingStore.cancel).not.toHaveBeenCalled();
  expect((res.data as { availableServices?: string[] }).availableServices).toEqual([
    "filler",
    "dysport",
  ]);
});
```

- [ ] **Step 2: Run to verify it FAILS (RED proof)**

Run: `pnpm --filter @switchboard/core test -- calendar-reschedule`
Expected: FAIL — current `resolveTarget("botox")` narrows to [] then falls back to `bookings[0]`
(b1/filler) and cancels it, so `res.status` is `"success"` and `res.error?.code` is undefined
(assertion `toBe("NO_MATCHING_BOOKING")` fails) AND `bookingStore.cancel` WAS called with b1. This
is the exact wrong-target defect.

---

## Task 2: GREEN — discriminated resolveTarget + uniform call-site mapping

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/calendar-reschedule.ts:39-47` (resolveTarget),
  add a shared `NO_MATCHING` helper near `NO_CONTACT` (:32-37), update the two call sites
  (reschedule :85-93, cancel :178-185).

**Interfaces produced:** `type TargetResolution = {kind:"ok";booking:UpcomingBooking} | {kind:"none"} | {kind:"no_match";availableServices:string[]}`; `resolveTarget(bookings, service?) -> TargetResolution`.

- [ ] **Step 1: Replace `resolveTarget` (lines 39-47)**

```ts
// The booking is resolved from the trusted ctx.contactId, so a model-supplied
// contactId can never reach another contact's bookings. An optional `service`
// narrows WITHIN the contact's own upcoming bookings (soonest-first). When a
// `service` is supplied but matches NONE of the contact's bookings we MUST NOT
// fall back to an unrelated booking: acting on the soonest-of-all would
// reschedule/cancel the WRONG appointment (e.g. a "botox" request landing on a
// "filler" booking). Surface no_match so the caller asks which appointment.
type TargetResolution =
  | { kind: "ok"; booking: UpcomingBooking }
  | { kind: "none" }
  | { kind: "no_match"; availableServices: string[] };

function resolveTarget(bookings: UpcomingBooking[], service?: string): TargetResolution {
  const soonest = bookings[0];
  if (!soonest) return { kind: "none" };
  if (!service) return { kind: "ok", booking: soonest };
  const narrowed = bookings.filter((b) => b.service.toLowerCase() === service.toLowerCase());
  const match = narrowed[0];
  if (!match) {
    return { kind: "no_match", availableServices: [...new Set(bookings.map((b) => b.service))] };
  }
  return { kind: "ok", booking: match };
}
```

- [ ] **Step 2: Add the shared `NO_MATCHING` helper** (after the `NO_CONTACT` helper, ~line 37)

```ts
const NO_MATCHING = (verb: "move" | "cancel", availableServices: string[]): ToolResult =>
  fail("NO_MATCHING_BOOKING", `I don't see a matching appointment to ${verb}.`, {
    retryable: false,
    data: { availableServices },
    modelRemediation:
      `The contact's upcoming appointments are: ${availableServices.join(", ")}. ` +
      `Ask which one they mean before you ${verb} it; do not ${verb} an appointment they did not name.`,
  });
```

- [ ] **Step 3: Update the reschedule call site** (replace current :85-93 `const target = ...; if (!target) {...}`)

```ts
const upcoming = await deps.bookingStore.findUpcomingByContact(orgId, contactId);
const resolution = resolveTarget(upcoming, input.service);
if (resolution.kind === "none") {
  return fail("NO_UPCOMING_BOOKING", "I don't see an upcoming appointment to move.", {
    retryable: false,
    modelRemediation:
      "Tell the lead you don't see an upcoming booking and offer to book a new appointment.",
  });
}
if (resolution.kind === "no_match") return NO_MATCHING("move", resolution.availableServices);
const target = resolution.booking;
```

- [ ] **Step 4: Update the cancel call site** (replace current :178-185)

```ts
const upcoming = await deps.bookingStore.findUpcomingByContact(orgId, contactId);
const resolution = resolveTarget(upcoming, input.service);
if (resolution.kind === "none") {
  return fail("NO_UPCOMING_BOOKING", "I don't see an upcoming appointment to cancel.", {
    retryable: false,
    modelRemediation: "Tell the lead you don't see an upcoming booking to cancel.",
  });
}
if (resolution.kind === "no_match") return NO_MATCHING("cancel", resolution.availableServices);
const target = resolution.booking;
```

- [ ] **Step 5: Run the Task-1 test -> GREEN**

Run: `pnpm --filter @switchboard/core test -- calendar-reschedule`
Expected: the Task-1 test passes; all pre-existing tests in the file stay green.

---

## Task 3: Broaden coverage (reschedule mismatch + positive regressions)

**Files:** Test: `packages/core/src/skill-runtime/tools/calendar-reschedule.test.ts`

- [ ] **Step 1: Add four tests**

```ts
it("reschedule does NOT move an unrelated booking when the requested service matches none", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn().mockResolvedValue({ id: "b1" }),
      cancel: vi.fn(),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-20T02:00:00Z",
    slotEnd: "2026-06-20T03:00:00Z",
    calendarId: "primary",
    service: "botox",
  });
  expect(res.error?.code).toBe("NO_MATCHING_BOOKING");
  expect(d.bookingStore.reschedule).not.toHaveBeenCalled();
});

it("cancel selects the booking matching the requested service, not the soonest", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ id: "b2" }),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({
    service: "dysport",
  });
  expect(res.status).toBe("success");
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b2");
});

it("cancel with no service still targets the soonest booking (unchanged)", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ id: "b1" }),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({});
  expect(res.status).toBe("success");
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b1");
});

it("reschedule selects the service-matched booking among several, not the soonest", async () => {
  const rescheduleBooking = vi.fn().mockResolvedValue({});
  const d = deps({
    calendarProviderFactory: vi.fn().mockResolvedValue({
      rescheduleBooking,
      cancelBooking: vi.fn().mockResolvedValue(undefined),
    }),
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn().mockResolvedValue({ id: "b2" }),
      cancel: vi.fn(),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-20T02:00:00Z",
    slotEnd: "2026-06-20T03:00:00Z",
    calendarId: "primary",
    service: "dysport",
  });
  expect(res.status).toBe("success");
  expect(d.bookingStore.reschedule).toHaveBeenCalledWith("org-1", "b2", expect.any(Object));
  expect(rescheduleBooking).toHaveBeenCalledWith("evt-2", expect.any(Object));
});
```

- [ ] **Step 2: Run the file -> all GREEN**

Run: `pnpm --filter @switchboard/core test -- calendar-reschedule`
Expected: all tests pass (new + pre-existing). No regression.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skill-runtime/tools/calendar-reschedule.ts \
        packages/core/src/skill-runtime/tools/calendar-reschedule.test.ts
git commit -m "fix(core): guard reschedule/cancel against wrong-target service mismatch (A8)"
```

---

## VERIFY (build-loop phase 4, not a plan task)

- `pnpm --filter @switchboard/core test`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`;
  `pnpm arch:check`; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm build` (core consumers).
- Locate + run `eval:alex-conversation` (acceptance: booking tools touched). If it does not exercise
  a service-mismatch reschedule/cancel, green is sufficient; only extend a fixture if the path is hit.
- Independent fresh-context review (diff + criteria + lessons only). Triage with receiving-code-review.
- SURFACE-before-merge: appointment-cancel behavior change on the irreversible path -> human merge call.
