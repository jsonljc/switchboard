# Fix: Alex builder context + LocalCalendarProvider runtime bugs

**Date:** 2026-04-27
**Author:** brainstorming session, post PR #279
**Branch slug:** `fix/launch-alex-context-and-calendar`
**Predecessor:** PR #279 (`fix/launch-webhook-provisioning`) — merged 2026-04-27. This branch rebases onto `main`.

---

## Background

`.audit/08-launch-blocker-sequence.md` defined launch-blockers #7–#10 as the next cluster after the webhook-provisioning work. A read-only audit during brainstorming found that the audit's framing is partly stale: blockers #7 (Alex builder registration) and #10 (MetaCAPIDispatcher → ConversionBus) are already shipped. Two real residual bugs remain in the same surface area, plus #9 (calendar) needs its claimed fixes wired and corrected.

Because the cluster collapsed, this branch is intentionally tight: four runtime bugs in the chat-message → skill-execution → booking path. Readiness/visibility surfacing for unconfigured calendars is split into a follow-up branch (`fix/launch-calendar-readiness-visibility`) per redline.

### Already-shipped (do not re-touch)

- **#7** `alexBuilder` registered in `apps/api/src/bootstrap/skill-mode.ts:214–222`.
- **#10** `MetaCAPIDispatcher` instantiated and subscribed in `apps/api/src/bootstrap/conversion-bus-bootstrap.ts:57–87` when `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` are set. Existing test coverage in `apps/api/src/bootstrap/__tests__/conversion-bus-bootstrap.test.ts`.

The plan must explicitly note these as already-done so reviewers do not look for changes.

### What this branch fixes

1. **#8a — chat-gateway contact identity resolution (WhatsApp scope).** Today, `channel-gateway.ts` submits parameters of shape `{message, conversation, persona}`. `alexBuilder` reads `parameters.contactId` (undefined), takes the auto-create branch, and writes a fresh orphan Contact with `phone:null` on every message. After this fix, identity is resolved before ingress submission for WhatsApp; orphan-spam ends.
2. **#8b — skill-mode builder config forwards `phone` and `channel`.** Even with #8a, `skill-mode.ts:216–220` strips the new fields. One-line config widening.
3. **#9a — LocalCalendarProvider emailSender wiring.** The provider supports an `emailSender` callback (`local-calendar-provider.ts:54, 112–129`) but `skill-mode.ts:429–432` constructs it without one, so booking confirmation emails never send. We wire it through using the same Resend integration the escalation notifier already uses (`skill-mode.ts:72–73`).
4. **#9b — LocalCalendarProvider `listAvailableSlots` org-scope leak.** `local-calendar-provider.ts:72–76` calls `findOverlapping("", ...)`. Combined with `skill-mode.ts:323`'s `organizationId: filterOrgId || undefined`, this means the slot-availability query treats every org's bookings as conflicts. We bake `orgId` into the wrapper closure so the leak is impossible from the wire-up site.

### Out of scope (carry-forward)

- **#9c — Noop fallback visibility / readiness flag / dashboard "calendar not configured" message.** Real product issue, but it crosses into readiness API + UI surface area and is not the cause of either runtime bug above. Split into follow-up `fix/launch-calendar-readiness-visibility`.
- Generic per-channel (Telegram / widget / dashboard) contact identity. Contact model lacks the per-channel external-handle lookup needed to do this cleanly. Telegram/widget messages keep their current `parameters.contactId === undefined` behavior, pinned by regression tests so we do not silently degrade them further.
- Replacing `NoopCalendarProvider` with a hard-fail booking. Tied to readiness work above and to test setup that uses Noop.
- Google Calendar adapter end-to-end. `google-calendar-factory.ts` exists; productionizing it is its own design.
- Audit's other deferred items (Graph API version drift, multi-WhatsApp-number per org, etc.) — already noted as carry-forward in `.audit/00-context.md`.

---

## Constraints carried forward from PR #279

- Controlled beta: 10 orgs, founder-assisted OK; free pilot, not paid day-1.
- v1 = one managed channel per org per channel type. No schema migrations unless explicitly approved.
- App boundaries: no `apps/api` ↔ `apps/chat` cross-imports, even in tests; duplicate small functions with parity-pin tests if needed.
- No silent fake-success paths — surface clear `statusDetail` when not active; reuse the precedence-resolver and `provision-status-message.ts` patterns.
- DECISIONS.md mandate: "capability building, not architecture passes."
- Helpers under `apps/api/src/lib/` accept `apiVersion` as an explicit required parameter where Meta is involved — never hardcode (not directly relevant to this branch but pinned for any new helper).
- File-size limits (error 600, warn 400) and co-located tests for every new module.
- Capability building, not refactoring sweeps: do not "clean up" unrelated code touched in passing.

---

## Section 1 — #8a: chat-gateway contact identity resolution

### Problem

`packages/core/src/channel-gateway/channel-gateway.ts:74–91` builds the canonical submit request. The `parameters` object today contains only `{message, conversation, persona}`. `apps/api/src/bootstrap/skill-mode.ts:215, 219` reads `parameters._agentContext` and `parameters.contactId` — both `undefined` for chat traffic. `alexBuilder` then:

- `findActiveByContact(orgId, undefined)` → `[]`
- `contactStore.findById(orgId, undefined)` → `null`
- `contactStore.create({phone: null, primaryChannel: "whatsapp", source: "whatsapp"})` — creates an orphan Contact every message.

Subsequent messages from the same WhatsApp sender cannot find their Contact (no phone to look up by) and create yet another orphan. Per-sender Contact count grows linearly with message count.

### Fix shape

Resolve identity inside the gateway before `ingress.submit`. Layering rule (per redline): resolver lives in `packages/core` behind a narrow interface; `apps/chat` provides only the concrete store.

#### 1.1 Define narrow `GatewayContactStore` interface (packages/core)

`packages/core/src/channel-gateway/types.ts` — add:

```ts
export interface GatewayContactStore {
  findByPhone(orgId: string, phone: string): Promise<{ id: string } | null>;
  create(input: {
    organizationId: string;
    phone: string;
    primaryChannel: "whatsapp";
    source: string;
  }): Promise<{ id: string }>;
}
```

Narrow on purpose — the gateway needs only these two methods. The wider `ContactStore` in `packages/db/src/stores/prisma-contact-store.ts` is structurally compatible (same method names and return shapes).

#### 1.2 Add `contactStore?: GatewayContactStore` to `ChannelGatewayConfig`

Same file. Optional for backward compatibility — when absent, the gateway falls through to today's behavior (no contact resolution). All real production wiring sets it.

#### 1.3 New helper: `packages/core/src/channel-gateway/resolve-contact-identity.ts`

```ts
export interface ResolvedContactIdentity {
  contactId: string | null;
  phone: string | null;
  channel: string;
}

export async function resolveContactIdentity(args: {
  channel: string;
  sessionId: string;
  organizationId: string;
  contactStore: GatewayContactStore;
}): Promise<ResolvedContactIdentity>;
```

Behavior:

- **WhatsApp** (`channel === "whatsapp"`): treat `sessionId` as the sender phone. Call `findByPhone(orgId, phone)`; if hit, return its id. If miss, `create({organizationId, phone, primaryChannel: "whatsapp", source: "whatsapp_inbound"})` and return its id. Phone is never null on this branch.
- **Other channels** (`telegram`, `dashboard`, `widget`, …): return `{contactId: null, phone: null, channel}`. Documented as known follow-up. **No** behavior change vs. today.

Pure module — no Prisma, no apps/chat imports, no fetches. Depends only on the narrow `GatewayContactStore` interface.

#### 1.4 Wire it into `channel-gateway.ts`

Insert between current step 3b (override check) and step 5 (build messages):

```ts
const identity = this.config.contactStore
  ? await resolveContactIdentity({
      channel: message.channel,
      sessionId: message.sessionId,
      organizationId: resolved.organizationId,
      contactStore: this.config.contactStore,
    })
  : { contactId: null, phone: null, channel: message.channel };
```

Then in step 6, widen `parameters` to include identity + `_agentContext`:

```ts
parameters: {
  message: message.text,
  conversation: { messages, sessionId: message.sessionId },
  persona: resolved.persona,
  ...(identity.contactId ? { contactId: identity.contactId } : {}),
  ...(identity.phone ? { phone: identity.phone } : {}),
  channel: identity.channel,
  _agentContext: { persona: resolved.persona },
},
```

Spread-only-when-set keeps the request shape clean for non-WhatsApp paths and avoids forcing nullable contactId through ingress validation.

#### 1.5 Wire concrete store at `apps/chat/src/gateway/gateway-bridge.ts`

`PrismaContactStore` already implements `findByPhone` and `create` (`packages/db/src/stores/prisma-contact-store.ts:44, 83`). Pass it to `new ChannelGateway({ ..., contactStore: new PrismaContactStore(prisma) })`.

### Tests (TDD)

In `packages/core/src/channel-gateway/__tests__/`:

- `resolve-contact-identity.test.ts` — pure unit tests:
  - WhatsApp + new phone → calls `create` exactly once; returns the new id.
  - WhatsApp + existing phone → calls `findByPhone`, no `create`; returns the existing id.
  - Telegram/dashboard/widget → returns `{contactId: null, phone: null, channel}`; no store calls.

- Extend `channel-gateway.test.ts`:
  - Two consecutive WhatsApp messages from same sessionId → `contactStore.create` called once total (regression pin for orphan-spam).
  - Two messages from different WhatsApp sessionIds → `create` called twice with distinct phones.
  - Telegram message → request submitted with no contactId in parameters (pin existing behavior).
  - Verifies submitted parameters contain `_agentContext.persona` and `channel`.

In `apps/chat/src/gateway/__tests__/`:

- `gateway-bridge.test.ts` (or similar): new `PrismaContactStore` is wired into the constructed gateway. (Light smoke; the deep behavior is covered by core tests.)

### Acceptance

- For one WhatsApp sender across N inbound messages, `Contact.count` grows by exactly 1.
- For two WhatsApp senders, count grows by exactly 2.
- Telegram and dashboard inbound messages have `parameters.contactId` undefined and behave identically to today.

### Risks

- The WhatsApp adapter must already be putting the sender's E.164 phone in `IncomingChannelMessage.sessionId`. Verified in Task 1 below. If it puts something else (e.g. a hashed session id), Section 1 stops and we revise.
- `ChannelGateway` currently has access to `resolved.organizationId` post-deployment-resolution — the resolver runs first. Verified in Task 1.

---

## Section 2 — #8b: skill-mode builder config forwards phone + channel

### Problem

`apps/api/src/bootstrap/skill-mode.ts:216–220` constructs the alexBuilder config with `{deploymentId, orgId, contactId}` only. Even after Section 1 adds phone and channel to `parameters`, they are dropped here.

### Fix shape

Widen the config object:

```ts
const config = {
  deploymentId: ctx.deployment.deploymentId,
  orgId: ctx.workUnit.organizationId,
  contactId: ctx.workUnit.parameters.contactId as string | undefined,
  phone: ctx.workUnit.parameters.phone as string | undefined,
  channel: ctx.workUnit.parameters.channel as string | undefined,
};
```

Note: `contactId` widens from `string` to `string | undefined` to reflect reality. `alexBuilder`'s auto-create branch (`alex.ts:13–50`) already tolerates an undefined-but-then-resolved contactId path. Update the alexBuilder config type if needed so TypeScript stays honest.

### Tests

- Update `apps/api/src/bootstrap/__tests__/skill-mode-builder-registration.test.ts` to assert phone and channel are forwarded into the alexBuilder config.
- New integration-level test (against an in-memory store): given a workUnit with `parameters.phone="+6599999999"` and no `contactId`, the registered builder calls `contactStore.create` with that phone (closes the loop with Section 1).

### Acceptance

- alexBuilder receives `config.phone` and `config.channel` whenever the gateway resolved them.
- For non-WhatsApp inbound (no phone in parameters), the builder still runs without throwing — `phone` is `undefined`, auto-create proceeds with `phone: null` (today's behavior; not improved, not regressed).

---

## Section 3 — #9a: wire `emailSender` into LocalCalendarProvider

### Problem

`packages/core/src/calendar/local-calendar-provider.ts:54, 112–129` accepts an `emailSender` callback and calls it best-effort during `createBooking`. `apps/api/src/bootstrap/skill-mode.ts:429–432` constructs the provider without one, so confirmation emails never fire even when `attendeeEmail` is provided. Revenue-loop UX broken at the last mile.

### Fix shape

#### 3.1 New helper: `apps/api/src/lib/booking-confirmation-email.ts`

Mirror the existing escalation Resend integration's shape (located near `skill-mode.ts:72–73`). Pure function: takes `{to, attendeeName, service, startsAt, endsAt, bookingId}` and a Resend API key, posts via Resend REST API, throws on non-2xx. No DOM / no React — plain HTML string built with template literals (or one tiny `nano-html` style helper). Subject: `"Booking confirmation — {service}"`. Body: short, brand-neutral, includes time range and a one-line "reply to reschedule".

The helper accepts `{ apiKey, fetchImpl?, fromAddress }` so it is unit-testable with a fake fetch — same pattern as `apps/api/src/lib/whatsapp-meta.ts` from PR #279.

#### 3.2 Wire it in `skill-mode.ts`

Inside `resolveCalendarProvider`, when constructing `LocalCalendarProvider`:

```ts
const resendKey = process.env["RESEND_API_KEY"];
const fromAddress = process.env["BOOKING_FROM_EMAIL"]; // existing or new env var; document
let emailSender: EmailSender | undefined;
if (resendKey && fromAddress) {
  emailSender = (email) =>
    sendBookingConfirmationEmail({
      apiKey: resendKey,
      fromAddress,
      ...email,
    });
} else {
  logger.info(
    "Calendar: booking confirmation emails disabled (RESEND_API_KEY or BOOKING_FROM_EMAIL not set)",
  );
}

const provider = new LocalCalendarProvider({
  businessHours,
  bookingStore: localStore,
  ...(emailSender ? { emailSender } : {}),
  onSendFailure: ({ bookingId, error }) =>
    logger.error(`Calendar: booking confirmation email failed for ${bookingId}: ${error}`),
});
```

`onSendFailure` matches PR #279's "fail-loud-but-don't-block" pattern. Booking creation does not roll back if email fails — the provider already implements that behavior in its try/catch.

#### 3.3 Env var: `BOOKING_FROM_EMAIL`

Document in `.env.example` (with example `bookings@example.com`). If we already have a sender address used by the escalation notifier, reuse that instead and skip the new var; verify in Task 1.

### Tests

- Unit: `booking-confirmation-email.test.ts` — fake fetch; verifies payload shape, throws on 500, succeeds on 200.
- Behavior: extend `local-calendar-provider.test.ts` — `createBooking` with `attendeeEmail` and a mock emailSender → sender invoked exactly once with correct fields; if sender throws, `onSendFailure` invoked, returned Booking is still `confirmed`.
- Bootstrap: `skill-mode.test.ts` (or new co-located test) — when `RESEND_API_KEY` and `BOOKING_FROM_EMAIL` both set, the constructed `LocalCalendarProvider` has a non-null emailSender. When one or both missing, sender is undefined and a one-line warning is logged.

### Acceptance

- With both env vars set, creating a booking with an `attendeeEmail` results in a single Resend API call with the correct payload.
- With either env var missing, booking still succeeds; one warning is logged at boot; no email is sent.

---

## Section 4 — #9b: LocalCalendarProvider `listAvailableSlots` org-scope leak

### Problem

`packages/core/src/calendar/local-calendar-provider.ts:72–76`:

```ts
const existingBookings = await this.store.findOverlapping(
  "", // <-- empty orgId
  new Date(query.dateFrom),
  new Date(query.dateTo),
);
```

The wrapper at `apps/api/src/bootstrap/skill-mode.ts:320–331` then runs `where: { organizationId: filterOrgId || undefined, ... }`. With `filterOrgId === ""`, `organizationId` resolves to `undefined`, which Prisma treats as "no filter". Slot-availability queries see every org's bookings as conflicts. In a multi-tenant deployment this silently degrades availability; with one org it is invisible.

### Fix shape

Bake orgId into the wrapper closure at wire time. The provider is already instantiated per-org via `resolveCalendarProvider(prisma, logger, orgId)` (line 276), so the orgId is in scope at the closure capture point.

#### 4.1 Change `LocalBookingStore.findOverlapping` signature

`packages/core/src/calendar/local-calendar-provider.ts:25–29`:

```ts
findOverlapping(
  startsAt: Date,
  endsAt: Date,
): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
```

Drop the `orgId` parameter. The store is now expected to be already-org-scoped.

#### 4.2 Update provider call site

`local-calendar-provider.ts:72–76`:

```ts
const existingBookings = await this.store.findOverlapping(
  new Date(query.dateFrom),
  new Date(query.dateTo),
);
```

#### 4.3 Update wrapper in `skill-mode.ts`

Inside `resolveCalendarProvider`, the closure already has `orgId` available (function parameter, line 276). At the top of the LocalCalendarProvider branch, assert truthiness so a programming bug surfaces loudly rather than silently leaking:

```ts
if (!orgId) {
  throw new Error("resolveCalendarProvider: orgId required for LocalCalendarProvider path");
}
```

Then:

```ts
const localStore = {
  findOverlapping: async (startsAt: Date, endsAt: Date) => {
    const rows = await prismaClient.booking.findMany({
      where: {
        organizationId: orgId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        status: { notIn: ["cancelled", "failed"] },
      },
      select: { startsAt: true, endsAt: true },
    });
    return rows;
  },
  // ...createInTransaction, findById, cancel, reschedule unchanged
};
```

### Risk: blast radius of signature change

`LocalBookingStore` is exported from `packages/core/src/calendar/`. Other consumers may exist. Plan must include a Task 1 grep for `findOverlapping` and `LocalBookingStore` across the repo (excluding `.worktrees/`). If only the wrapper and tests are found, proceed. If a third consumer exists, stop and revise (likely add the orgId capture in that consumer too rather than re-adding the parameter).

### Tests

- `local-calendar-provider.test.ts` — update the existing mock store's signature; assert orgId never appears in the call.
- New regression test: two LocalCalendarProvider instances bound to different orgIds; orgB has a booking spanning slot S; orgA's `listAvailableSlots` includes S.

### Acceptance

- `findOverlapping` is called with two arguments (start, end) only.
- `prismaClient.booking.findMany` always runs with a non-empty `organizationId` filter.

---

## Section 5 — Already-shipped notes for the plan

The implementation plan must include a top-of-plan note for reviewers:

> Audit blockers #7 (Alex builder registration) and #10 (MetaCAPIDispatcher → ConversionBus) are already shipped. Verified during Task 1. No code changes required for those items in this branch. The branch covers the residual #8 + #9 runtime bugs only.

This prevents a reviewer from looking for changes related to those blockers and concluding the plan is incomplete.

---

## Read-only Task 1 (BEFORE any code changes)

Per redline. Verify all assumptions. If any check fails, stop and revise the design rather than coding around it.

1. **`ChannelGatewayConfig` definition** — confirm exact shape and that `conversationStore` is the only existing dependency-injected store. Confirm package boundary: it lives in `packages/core/src/channel-gateway/types.ts`.

2. **`PrismaContactStore` API surface** — confirm `findByPhone(orgId, phone)` and `create({...})` signatures match the narrow `GatewayContactStore` interface drafted in Section 1. Confirm `PrismaContactStore` is exported from `@switchboard/db` and importable from `apps/chat`.

3. **WhatsApp `sessionId` content** — confirm the WhatsApp adapter (`apps/chat/src/adapters/whatsapp.ts` or similar) sets `IncomingChannelMessage.sessionId` to the inbound sender's E.164 phone. If it sets a hashed value, an opaque id, or a Meta-internal id, **stop and revise.**

4. **`organizationId` availability before `ingress.submit`** — confirm `resolved.organizationId` (from `deploymentResolver.resolveByChannelToken`) is truthy and reliably correct before the new resolution step. Today this value already feeds `request.organizationId`, so it should be solid.

5. **`LocalBookingStore.findOverlapping` consumers** — grep for `findOverlapping` and `LocalBookingStore` across repo (exclude `.worktrees/`). Confirm only `local-calendar-provider.ts` (the interface), the wrapper in `skill-mode.ts`, and tests use it. If a third real consumer exists, **stop and revise** — likely capture orgId in that consumer's closure instead of re-adding the parameter.

6. **Resend integration shape** — read the existing escalation notifier's Resend usage at `apps/api/src/bootstrap/skill-mode.ts` ~lines 72–73 and surrounding helper. Confirm whether a sender-address env var already exists (so we may reuse it) or whether `BOOKING_FROM_EMAIL` is genuinely new. Adjust Section 3 accordingly.

7. **Alex builder config TypeScript shape** — confirm `Parameters<typeof alexBuilder>[1]` (the `config` arg type) accepts `phone?: string | null` and `channel?: string`. Today it does (per `alex.ts:7–8, 19–20`). Pin in the plan that no `parameter-builder.ts` type widening is needed.

If checks 1–4 and 7 pass, Section 1 + 2 unlock. If 5 passes, Section 4 unlocks. If 6 produces a clean answer, Section 3 unlocks. Sections are independent; Task 1 may unblock some and pause others.

---

## Process

1. Brainstorm → spec (this doc) → user review.
2. Writing-plans skill produces ordered task list with read-only Task 1 first.
3. Subagent-driven TDD task-by-task. Frequent commits.
4. Code review → squash-merge with auto-merge on green CI.

## Branch slug, sub-branches

- Primary: `fix/launch-alex-context-and-calendar`
- Follow-up (separate PR after this lands): `fix/launch-calendar-readiness-visibility` — covers #9c (Noop fallback visibility, readiness flag, dashboard "calendar not configured" surfacing).

---

## Acceptance summary

- **#8a**: Per WhatsApp sender, `Contact.create` count is 1 across N messages (verified by test, manual smoke during dev).
- **#8b**: alexBuilder config receives phone and channel for WhatsApp; no TypeScript regressions.
- **#9a**: With Resend env vars set, a booking with `attendeeEmail` triggers exactly one Resend POST. Without env vars, booking still works; one warning logged at boot.
- **#9b**: `LocalCalendarProvider.listAvailableSlots` never queries bookings outside the bound org; cross-org regression test passes.
- All existing tests pass; new tests are co-located; coverage thresholds (global 55/50/52/55, core 65/65/70/65) preserved.
