# workTraceIds Gateway Plumbing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plumb `workTraceId` from `PlatformIngress.submit()` response through the ChannelGateway → ConversationLifecycleTracker → `ConversationEndEvent`, and surface it via `BookingAttribution.workTraceId` so `DeploymentMemoryEvidence.workTraceId` is populated on the strong-tier attribution path. Closes the PR-3.1.b carry-debt that silently disables strong-tier outcome attribution in production.

**Architecture:** Additive — one new field on three layers (gateway callback, lifecycle tracker, BookingAttribution). One new field on `ActiveSession` as a metadata accumulator kept separate from `messages[]` to avoid leaking trace IDs into summarization prompts. No new modules, no schema migration (`DeploymentMemoryEvidence.workTraceId` was made nullable in PR-3.2a anticipating this PR).

**Tech Stack:** TypeScript, pnpm + Turborepo monorepo, vitest, no Prisma schema changes.

**Spec reference:** `docs/superpowers/specs/2026-05-15-worktrace-ids-gateway-plumbing-design.md`

---

## Prerequisites

- [ ] **Step 0a: Create worktree off latest `origin/main`**

```bash
cd /Users/jasonli/switchboard
git fetch origin main --quiet
git worktree add -b feat/worktrace-ids-gateway-plumbing \
  .claude/worktrees/feat+worktrace-ids-gateway-plumbing origin/main
cd .claude/worktrees/feat+worktrace-ids-gateway-plumbing
```

Expected: `HEAD is now at <sha>` line containing recent docs/spec/plan merge commits.

- [ ] **Step 0b: Initialize the worktree per CLAUDE.md doctrine**

```bash
pnpm worktree:init
pnpm install --prefer-offline
pnpm db:generate
```

The first command warns "Postgres is not reachable" — that's fine, tests in this plan don't need a live DB. The third command generates the Prisma client; without it, `pnpm typecheck` fails with "Module '@prisma/client' has no exported member 'PrismaClient'".

- [ ] **Step 0c: Baseline — confirm tests pass on a clean checkout**

```bash
pnpm typecheck
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/chat test
```

Expected:

- `pnpm typecheck` — 18/18 packages succeed
- `@switchboard/core` test — 3143+ tests passed
- `@switchboard/chat` test — 280 tests passed

If anything fails on the baseline, STOP and investigate — these regressions are not introduced by this plan.

---

## Task 1: Widen `BookingAttribution` to surface `workTraceId`

This is the foundation. Adding the field first means subsequent tasks (lifecycle tracker, compounding-service evidence row) can consume it through proper types.

**Files:**

- Modify: `packages/core/src/memory/booking-attribution.ts`
- Test: `packages/core/src/memory/__tests__/booking-attribution.test.ts` (existing — add assertion)

- [ ] **Step 1.1: Write the failing assertion in existing strong-tier test**

Open `packages/core/src/memory/__tests__/booking-attribution.test.ts` and update the first `it(...)` block to assert the new `workTraceId` field on the strong-tier return:

```typescript
it("returns strong attribution when a Booking shares a workTraceId with the conversation", async () => {
  const store: BookingAttributionStore = {
    findByWorkTraceIds: vi.fn().mockResolvedValue([{ id: "bk-1", workTraceId: "wt-B" }]),
    findInWindow: vi.fn(),
  };

  const result = await resolveBookingAttribution(store, event());

  expect(result.tier).toBe("strong");
  expect(result.bookingId).toBe("bk-1");
  expect(result.workTraceId).toBe("wt-B");
  expect(store.findInWindow).not.toHaveBeenCalled();
});
```

(The change is the new `expect(result.workTraceId).toBe("wt-B");` line.)

- [ ] **Step 1.2: Run test — expect a TypeScript error or test failure**

```bash
pnpm --filter @switchboard/core test booking-attribution
```

Expected: TypeScript reports `Property 'workTraceId' does not exist on type 'BookingAttribution'`. (Vitest may surface this as a compile-time error before the test runs, or as a runtime `undefined !== "wt-B"` assertion failure — either is fine.)

- [ ] **Step 1.3: Widen `BookingAttribution` interface**

Open `packages/core/src/memory/booking-attribution.ts` and add the optional `workTraceId` field to `BookingAttribution`:

```typescript
export interface BookingAttribution {
  tier: AttributionTier;
  bookingId?: string;
  workTraceId?: string;
}
```

- [ ] **Step 1.4: Surface `workTraceId` on the strong-tier return**

In the same file, update the strong-tier branch in `resolveBookingAttribution` (currently around lines 46-53):

```typescript
// Tier 1: strong — match Booking.workTraceId against the conversation's
// executed-tool work-trace ids.
if (event.workTraceIds && event.workTraceIds.length > 0) {
  const strong = await store.findByWorkTraceIds(event.organizationId, event.workTraceIds);
  if (strong.length > 0) {
    // Deterministic pick: first row. Multiple tool-trace bookings in one
    // conversation are vanishingly rare; if it happens, the first wins.
    return {
      tier: "strong",
      bookingId: strong[0]!.id,
      workTraceId: strong[0]!.workTraceId ?? undefined,
    };
  }
}
```

The `?? undefined` defends against a store returning `workTraceId: null` — `null` would type-check (`workTraceId: string | null` on the row interface) but we want strict `string | undefined` on the attribution shape.

- [ ] **Step 1.5: Run test — expect pass**

```bash
pnpm --filter @switchboard/core test booking-attribution
```

Expected: 6 tests pass.

- [ ] **Step 1.6: Run full core typecheck to catch fallout**

```bash
pnpm typecheck
```

Expected: 18/18 packages succeed. If any package outside core complains about `BookingAttribution`, investigate — only core should consume this type.

- [ ] **Step 1.7: Commit**

```bash
git add packages/core/src/memory/booking-attribution.ts packages/core/src/memory/__tests__/booking-attribution.test.ts
git commit -m "$(cat <<'EOF'
feat(core): widen BookingAttribution to surface workTraceId on strong tier

First step of the PR-3.1.b carry-debt closure. Adds optional
`workTraceId?: string` to `BookingAttribution` and populates it on the
strong-tier return from `resolveBookingAttribution`. The compounding
service's evidence-row write site (compounding-service.ts:285-290) can
now backfill the previously-`null` workTraceId field; Task 2 lands that
backfill.

Spec: docs/superpowers/specs/2026-05-15-worktrace-ids-gateway-plumbing-design.md
EOF
)"
```

---

## Task 2: Backfill `DeploymentMemoryEvidence.workTraceId` in compounding-service

With `BookingAttribution.workTraceId` available, replace the explicit `null` literal in the evidence-row write site. The Prisma column is already nullable (PR-3.2a anticipated this PR).

**Files:**

- Modify: `packages/core/src/memory/compounding-service.ts`
- Test: `packages/core/src/memory/__tests__/compounding-service-canonical-keys.test.ts`

- [ ] **Step 2.1: Update the existing strong-tier evidence assertion to demand `workTraceId`**

Open `packages/core/src/memory/__tests__/compounding-service-canonical-keys.test.ts`. Find the first `expect(evidenceStore.recordEvidence).toHaveBeenCalledWith(...)` block (around line 55) and add the `workTraceId` field to the `objectContaining`:

```typescript
expect(evidenceStore.recordEvidence).toHaveBeenCalledWith(
  expect.objectContaining({
    deploymentMemoryId: "mem-1",
    bookingId: "bk-1",
    workTraceId: "wt-A",
    attributionTier: "strong",
  }),
);
```

(The single new line is `workTraceId: "wt-A",`. The mock at line 27 already returns `{ id: "bk-1", workTraceId: "wt-A" }` for `findByWorkTraceIds`, so the matched trace ID flows through end-to-end once the production code is fixed.)

- [ ] **Step 2.2: Run test — expect fail**

```bash
pnpm --filter @switchboard/core test compounding-service-canonical-keys
```

Expected: the assertion fails because `recordEvidence` was called with `workTraceId: null` (the current production behavior). The error message will show "Expected: workTraceId: 'wt-A', Received: workTraceId: null".

- [ ] **Step 2.3: Replace the `null` literal in `compounding-service.ts`**

Open `packages/core/src/memory/compounding-service.ts` and find the `recordEvidence` call (around lines 280-292). Replace the carry-debt comment block AND the `workTraceId: null` line with:

```typescript
if (this.evidenceStore && attribution.bookingId) {
  await this.evidenceStore.recordEvidence({
    deploymentMemoryId: memoryId,
    organizationId: event.organizationId,
    bookingId: attribution.bookingId,
    conversionRecordId: null,
    workTraceId: attribution.workTraceId ?? null,
    attributionTier: attribution.tier,
  });
}
```

(The carry-debt comment is intentionally deleted — the debt is being closed by this PR. The `?? null` accepts both the strong-tier path where `attribution.workTraceId` is set, and the fallback path where the attribution has no workTraceId.)

- [ ] **Step 2.4: Run test — expect pass**

```bash
pnpm --filter @switchboard/core test compounding-service-canonical-keys
```

Expected: all tests in that file pass (including the updated strong-tier assertion).

- [ ] **Step 2.5: Run the broader compounding-service test suite to confirm no regressions**

```bash
pnpm --filter @switchboard/core test compounding-service
```

Expected: all `compounding-service*.test.ts` files pass. The fallback path tests should continue to assert `attributionTier: "fallback"` and (implicitly) `workTraceId: null` — the fallback path has no workTraceId, so `attribution.workTraceId ?? null` evaluates to `null`, preserving existing behavior.

- [ ] **Step 2.6: Commit**

```bash
git add packages/core/src/memory/compounding-service.ts packages/core/src/memory/__tests__/compounding-service-canonical-keys.test.ts
git commit -m "$(cat <<'EOF'
feat(core): backfill DeploymentMemoryEvidence.workTraceId on strong tier

Replaces the explicit `workTraceId: null` literal in
compounding-service.ts (the second carry-debt site for PR-3.1.b) with
`attribution.workTraceId ?? null`. The carry-debt comment block is
deleted — the debt is closed by this PR.

Fallback-tier evidence rows continue to write `workTraceId: null`
because `BookingAttribution.workTraceId` is undefined on that path.
The Prisma column was already nullable (PR-3.2a), so no schema change.

Spec: docs/superpowers/specs/2026-05-15-worktrace-ids-gateway-plumbing-design.md
EOF
)"
```

---

## Task 3: Lifecycle tracker — `workTraceIds` accumulator on `ActiveSession`

The four tests in this task pin the behavioral contract: accumulate in order, no dedupe, emit `undefined` when empty, skip turns that omit a trace.

**Files:**

- Modify: `packages/core/src/channel-gateway/conversation-lifecycle.ts`
- Test: `packages/core/src/__tests__/conversation-lifecycle.test.ts`

- [ ] **Step 3.1: Add the four failing tests**

Open `packages/core/src/__tests__/conversation-lifecycle.test.ts` and append these four `it(...)` blocks to the existing `describe("ConversationLifecycleTracker", () => { ... })` (insert before the closing `});` at line 150):

```typescript
it("accumulates workTraceIds across assistant turns and surfaces them in the end event", async () => {
  tracker.recordMessage({
    sessionKey: "dep-1:telegram:session-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    channelType: "telegram",
    sessionId: "session-1",
    role: "user",
    content: "Hello",
  });
  tracker.recordMessage({
    sessionKey: "dep-1:telegram:session-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    channelType: "telegram",
    sessionId: "session-1",
    role: "assistant",
    content: "Hi",
    workTraceId: "wt-A",
  });
  tracker.recordMessage({
    sessionKey: "dep-1:telegram:session-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    channelType: "telegram",
    sessionId: "session-1",
    role: "user",
    content: "Tell me more",
  });
  tracker.recordMessage({
    sessionKey: "dep-1:telegram:session-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    channelType: "telegram",
    sessionId: "session-1",
    role: "assistant",
    content: "Sure",
    workTraceId: "wt-B",
  });

  await tracker.closeConversation("dep-1:telegram:session-1", "explicit_close");

  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ workTraceIds: ["wt-A", "wt-B"] }));
});

it("preserves insertion order across multiple distinct traces (no dedupe)", async () => {
  const traces = ["wt-X", "wt-Y", "wt-Z"];
  for (const wt of traces) {
    tracker.recordMessage({
      sessionKey: "dep-1:telegram:session-1",
      deploymentId: "dep-1",
      organizationId: "org-1",
      channelType: "telegram",
      sessionId: "session-1",
      role: "assistant",
      content: `turn ${wt}`,
      workTraceId: wt,
    });
  }

  await tracker.closeConversation("dep-1:telegram:session-1", "explicit_close");

  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({ workTraceIds: ["wt-X", "wt-Y", "wt-Z"] }),
  );
});

it("emits workTraceIds: undefined (not []) when no traces are recorded", async () => {
  tracker.recordMessage({
    sessionKey: "dep-1:telegram:session-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    channelType: "telegram",
    sessionId: "session-1",
    role: "user",
    content: "Hello",
  });

  await tracker.closeConversation("dep-1:telegram:session-1", "explicit_close");

  const call = (handler as ReturnType<typeof vi.fn>).mock.calls[0]!;
  const event = call[0] as { workTraceIds?: string[] };
  expect(event.workTraceIds).toBeUndefined();
});

it("skips turns where workTraceId is omitted (forward compat while call sites migrate)", async () => {
  tracker.recordMessage({
    sessionKey: "dep-1:telegram:session-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    channelType: "telegram",
    sessionId: "session-1",
    role: "assistant",
    content: "first",
    workTraceId: "wt-1",
  });
  tracker.recordMessage({
    sessionKey: "dep-1:telegram:session-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    channelType: "telegram",
    sessionId: "session-1",
    role: "assistant",
    content: "middle (no workTraceId — older call site)",
  });
  tracker.recordMessage({
    sessionKey: "dep-1:telegram:session-1",
    deploymentId: "dep-1",
    organizationId: "org-1",
    channelType: "telegram",
    sessionId: "session-1",
    role: "assistant",
    content: "third",
    workTraceId: "wt-3",
  });

  await tracker.closeConversation("dep-1:telegram:session-1", "explicit_close");

  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ workTraceIds: ["wt-1", "wt-3"] }));
});
```

- [ ] **Step 3.2: Run tests — expect 4 failures**

```bash
pnpm --filter @switchboard/core test conversation-lifecycle
```

Expected: 4 of the 4 new tests fail. Possible failure modes:

- TypeScript error on `workTraceId` field not existing on `RecordMessageInput` — addressed in Step 3.3
- Runtime assertion failure because `event.workTraceIds` is `undefined` — addressed in Steps 3.4, 3.5

- [ ] **Step 3.3: Add `workTraceId` to `RecordMessageInput` + `workTraceIds` to `ActiveSession`**

Open `packages/core/src/channel-gateway/conversation-lifecycle.ts`. Update `RecordMessageInput` (around lines 29-38) to add the optional field:

```typescript
export interface RecordMessageInput {
  sessionKey: string;
  deploymentId: string;
  organizationId: string;
  channelType: string;
  sessionId: string;
  contactId?: string;
  role: string;
  content: string;
  workTraceId?: string;
}
```

Update `ActiveSession` (around lines 40-49) to add the accumulator:

```typescript
interface ActiveSession {
  deploymentId: string;
  organizationId: string;
  channelType: string;
  sessionId: string;
  contactId: string | null;
  messages: Array<{ role: string; content: string }>;
  workTraceIds: string[];
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}
```

- [ ] **Step 3.4: Initialize the accumulator on session creation + append on each message**

In the same file, update `recordMessage` (around lines 66-90). The existing-session branch needs to push the workTraceId when present; the new-session branch needs to initialize the accumulator:

```typescript
  recordMessage(input: RecordMessageInput): void {
    const existing = this.sessions.get(input.sessionKey);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push({ role: input.role, content: input.content });
      if (input.workTraceId) existing.workTraceIds.push(input.workTraceId);
      if (input.contactId) existing.contactId = input.contactId;
      existing.timer = this.startTimer(input.sessionKey);
    } else {
      if (this.sessions.size >= this.maxSessions) {
        console.warn("[ConversationLifecycleTracker] Max sessions reached, dropping new session");
        return;
      }
      this.sessions.set(input.sessionKey, {
        deploymentId: input.deploymentId,
        organizationId: input.organizationId,
        channelType: input.channelType,
        sessionId: input.sessionId,
        contactId: input.contactId ?? null,
        messages: [{ role: input.role, content: input.content }],
        workTraceIds: input.workTraceId ? [input.workTraceId] : [],
        startedAt: Date.now(),
        timer: this.startTimer(input.sessionKey),
      });
    }
  }
```

- [ ] **Step 3.5: Populate `event.workTraceIds` in `fireEnd`**

In the same file, update `fireEnd` (around lines 119-144). The new line populates `workTraceIds: undefined` when the accumulator is empty, never `[]`:

```typescript
  private async fireEnd(
    sessionKey: string,
    session: ActiveSession,
    reason: ConversationEndReason,
  ): Promise<void> {
    this.sessions.delete(sessionKey);

    const event: ConversationEndEvent = {
      deploymentId: session.deploymentId,
      organizationId: session.organizationId,
      contactId: session.contactId,
      channelType: session.channelType,
      sessionId: session.sessionId,
      messages: session.messages,
      duration: Math.round((Date.now() - session.startedAt) / 1000),
      messageCount: session.messages.length,
      endReason: reason,
      endedAt: new Date(),
      workTraceIds: session.workTraceIds.length > 0 ? session.workTraceIds : undefined,
    };

    try {
      await this.handler(event);
    } catch (err) {
      console.error("[ConversationLifecycleTracker] Error in end handler:", err);
    }
  }
```

- [ ] **Step 3.6: Run tests — expect all 4 new tests + 5 existing tests pass (9 total)**

```bash
pnpm --filter @switchboard/core test conversation-lifecycle
```

Expected: 9 tests pass in `conversation-lifecycle.test.ts`. (The 5 existing tests are backward-compatible because `workTraceIds: undefined` is the default when no traces are recorded — matches the prior shape exactly.)

- [ ] **Step 3.7: Run full core test suite to catch any cross-file fallout**

```bash
pnpm --filter @switchboard/core test
```

Expected: all 3143+ tests pass (with the 4 new conversation-lifecycle tests added, 3147+). `ActiveSession` is file-local (not exported), so no external fixture should be affected by the field addition. If any cross-file test fails, the most likely cause is a `ConversationEndEvent` fixture asserting exact shape via `toEqual` that now misses the new `workTraceIds` field — relax those to `toMatchObject` or extend them.

- [ ] **Step 3.8: Commit**

```bash
git add packages/core/src/channel-gateway/conversation-lifecycle.ts packages/core/src/__tests__/conversation-lifecycle.test.ts
git commit -m "$(cat <<'EOF'
feat(core): plumb workTraceIds accumulator on ConversationLifecycleTracker

Adds `workTraceId?: string` to RecordMessageInput and `workTraceIds: string[]`
to ActiveSession. recordMessage appends when present (no dedupe, preserve
insertion order). fireEnd surfaces the accumulator on the event when
non-empty, omits the field (undefined) when empty so backward-compat with
existing test fixtures holds.

Four new tests pin the contract: accumulate, order preservation,
empty→undefined (never []), skip turns that omit workTraceId.

Spec: docs/superpowers/specs/2026-05-15-worktrace-ids-gateway-plumbing-design.md
EOF
)"
```

---

## Task 4: ChannelGateway — pass `workTraceId` on assistant `onMessageRecorded` callback

The assistant-turn site has `response.result.traceId` in scope; pass it through. The user-turn site stays unchanged (user turns have no trace). This task includes a unit test directly against `ChannelGateway` so the negative invariant ("user-turn `onMessageRecorded` never carries `workTraceId`") is pinned at the layer where the emission decision is actually made — not just downstream at the bridge.

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`
- Test: `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts` (existing — `createMockConfig` harness exists; cost of extension is low)

- [ ] **Step 4.1: Widen `onMessageRecorded` callback type**

Open `packages/core/src/channel-gateway/types.ts` and update the `onMessageRecorded` field on `ChannelGatewayConfig` (around lines 68-77):

```typescript
  /** Called after each message is persisted. MUST be synchronous — async callbacks are not awaited. */
  onMessageRecorded?: (info: {
    deploymentId: string;
    listingId: string;
    organizationId: string;
    channel: string;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    workTraceId?: string;
  }) => void;
```

- [ ] **Step 4.2: Pass `response.result.traceId` at the assistant call site**

Open `packages/core/src/channel-gateway/channel-gateway.ts`. Find the assistant `onMessageRecorded` call (around lines 67-75) and add `workTraceId`:

```typescript
await conversationStore.addMessage(conversationId, "assistant", text);
onMessageRecorded?.({
  deploymentId: resolved.deploymentId,
  listingId: resolved.listingId,
  organizationId: resolved.organizationId,
  channel: message.channel,
  sessionId: message.sessionId,
  role: "assistant",
  content: text,
  workTraceId: response.result.traceId,
});
await replySink.send(text);
```

`ExecutionResult.traceId` is a required `string` per `packages/core/src/platform/execution-result.ts:10`, so no `?? undefined` defense is needed.

- [ ] **Step 4.3: Verify user-turn site is unchanged**

In the same file, the user-turn `onMessageRecorded` call (around lines 140-148) should NOT pass `workTraceId`. Re-read to confirm:

```typescript
this.config.onMessageRecorded?.({
  deploymentId: resolved.deploymentId,
  listingId: resolved.listingId,
  organizationId: resolved.organizationId,
  channel: message.channel,
  sessionId: message.sessionId,
  role: "user",
  content: message.text,
});
```

If `workTraceId` accidentally appears here, remove it. Step 4.4 below adds the unit test that catches it.

- [ ] **Step 4.4: Add positive + negative unit tests in `channel-gateway.test.ts`**

Open `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`. Two changes:

**Change A: extend the `platformIngress.submit` mock in `createMockConfig`** so `result.traceId` is set (the existing mock at lines 42-50 puts `traceId` on `workUnit` only — the production code reads `result.traceId` per `execution-result.ts:10`):

```typescript
    platformIngress: {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { response: "Hello from agent" },
          summary: "Responded to user",
          traceId: "trace-1",
        },
        workUnit: { id: "wu-1", traceId: "trace-1" },
      }),
    },
```

**Change B: append two new `it(...)` blocks inside the existing `describe("ChannelGateway", () => { ... })`** (insert before line ~310's closing `});`):

```typescript
it("emits workTraceId on the assistant-turn onMessageRecorded callback", async () => {
  const onMessageRecordedSpy = vi.fn();
  const config = createMockConfig({ onMessageRecorded: onMessageRecordedSpy });
  const gateway = new ChannelGateway(config);
  const message: IncomingChannelMessage = {
    channel: "web_widget",
    token: "sw_valid123",
    sessionId: "sess-1",
    text: "Hello",
  };
  const replySink: ReplySink = { send: vi.fn().mockResolvedValue(undefined) };

  await gateway.handleIncoming(message, replySink);

  // Two calls: one for the user turn, one for the assistant turn.
  // The assistant call carries result.traceId.
  expect(onMessageRecordedSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      role: "assistant",
      workTraceId: "trace-1",
    }),
  );
});

it("does NOT emit workTraceId on the user-turn onMessageRecorded callback (invariant: user turns are text events)", async () => {
  const onMessageRecordedSpy = vi.fn();
  const config = createMockConfig({ onMessageRecorded: onMessageRecordedSpy });
  const gateway = new ChannelGateway(config);
  const message: IncomingChannelMessage = {
    channel: "web_widget",
    token: "sw_valid123",
    sessionId: "sess-1",
    text: "Hello",
  };
  const replySink: ReplySink = { send: vi.fn().mockResolvedValue(undefined) };

  await gateway.handleIncoming(message, replySink);

  // First call (user turn) must not carry workTraceId.
  const userCallArg = onMessageRecordedSpy.mock.calls.find(
    (c) => (c[0] as { role: string }).role === "user",
  )?.[0] as { workTraceId?: string } | undefined;
  expect(userCallArg).toBeDefined();
  expect(userCallArg!.workTraceId).toBeUndefined();
});
```

- [ ] **Step 4.5: Run tests — expect 2 new tests pass**

```bash
pnpm --filter @switchboard/core test channel-gateway.test
```

Expected: 2 new tests pass alongside the existing ones. The positive assertion proves the gateway threads `response.result.traceId` to the assistant callback; the negative invariant proves the user-turn callback never carries `workTraceId`.

If the existing "processes message and delivers reply via replySink" test (line ~114) regresses because of the Change A mock update, that's expected only if a stale snapshot asserted exact equality on the result shape — fix by extending the snapshot, NOT by reverting the mock change. The mock now matches the production contract (`ExecutionResult.traceId` is required).

- [ ] **Step 4.6: Run typecheck — expect pass**

```bash
pnpm typecheck
```

Expected: 18/18 packages succeed.

- [ ] **Step 4.7: Commit**

```bash
git add packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/channel-gateway.ts packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts
git commit -m "$(cat <<'EOF'
feat(core): channel-gateway passes workTraceId on assistant onMessageRecorded

Widens ChannelGatewayConfig.onMessageRecorded to accept an optional
workTraceId, and the assistant-turn dispatch in handleSubmitResponse
now passes response.result.traceId. User-turn dispatch is intentionally
unchanged — user turns are text events, not execution events.

Two new unit tests in channel-gateway.test.ts pin both shapes at the
layer where the emission decision is made:
- positive: assistant-turn onMessageRecorded carries result.traceId
- negative invariant: user-turn onMessageRecorded never carries workTraceId

The bridge-layer test in Task 5 additionally pins that the bridge does
not introduce a workTraceId during forwarding of user-shaped input —
defense in depth at both layers.

Spec: docs/superpowers/specs/2026-05-15-worktrace-ids-gateway-plumbing-design.md
EOF
)"
```

---

## Task 5: Gateway bridge — forward `workTraceId` to lifecycle tracker + integration tests

The bridge's `onMessageRecorded` callback receives `info` from the gateway and forwards a subset to `lifecycleTracker.recordMessage`. This task forwards the new field and adds the two integration tests (positive + negative invariant) the spec calls for.

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`
- Test: `apps/chat/src/gateway/__tests__/gateway-bridge-attribution.test.ts`

- [ ] **Step 5.1: Add the failing integration tests (positive + negative)**

Open `apps/chat/src/gateway/__tests__/gateway-bridge-attribution.test.ts`. Two changes.

**Important — keep existing assertions green.** The mock-rewrite below is intentionally minimal: it captures `onMessageRecorded` and routes `recordMessage` through a named spy, but does NOT change any return shape that prior tests depend on. If the existing two assertions (lines ~49-64 and ~66-97) regress after Change A, prefer the smallest mock extension that captures `onMessageRecorded` over a broader rewrite. The goal is to add the new assertions, not to refactor the existing ones.

**Change A: extend the `vi.mock("@switchboard/core", ...)` block** to capture the `onMessageRecorded` callback the bridge installs on ChannelGateway. Replace the existing `ChannelGateway` mock line with:

```typescript
const compoundingCtorArgs: unknown[] = [];
const processConversationEndMock = vi.fn();
let capturedLifecycleHandler: ((event: unknown) => Promise<void>) | null = null;
let capturedOnMessageRecorded: ((info: Record<string, unknown>) => void) | null = null;
const lifecycleRecordMessageSpy = vi.fn();

vi.mock("@switchboard/core", async () => {
  const actual = await vi.importActual<typeof import("@switchboard/core")>("@switchboard/core");
  return {
    ...actual,
    ConversationCompoundingService: vi.fn().mockImplementation((deps: unknown) => {
      compoundingCtorArgs.push(deps);
      return {
        processConversationEnd: processConversationEndMock,
      };
    }),
    ConversationLifecycleTracker: vi
      .fn()
      .mockImplementation((config: { onConversationEnd: (e: unknown) => Promise<void> }) => {
        capturedLifecycleHandler = config.onConversationEnd;
        return {
          recordMessage: lifecycleRecordMessageSpy,
        };
      }),
    ChannelGateway: vi
      .fn()
      .mockImplementation((config: { onMessageRecorded?: typeof capturedOnMessageRecorded }) => {
        capturedOnMessageRecorded = config.onMessageRecorded ?? null;
        return { config };
      }),
  };
});
```

(The diff vs the original: a new `capturedOnMessageRecorded` ref, a new `lifecycleRecordMessageSpy`, the `ConversationLifecycleTracker` mock returns the named spy instead of an inline `vi.fn()`, and the `ChannelGateway` mock captures `onMessageRecorded`.)

**Change B: reset the new spies in `beforeEach`** by extending it:

```typescript
beforeEach(() => {
  compoundingCtorArgs.length = 0;
  processConversationEndMock.mockReset();
  capturedLifecycleHandler = null;
  capturedOnMessageRecorded = null;
  lifecycleRecordMessageSpy.mockReset();
});
```

**Change C: append the two new `it(...)` blocks** to the existing `describe(...)`:

```typescript
it("forwards workTraceId from assistant-turn onMessageRecorded to lifecycleTracker.recordMessage", async () => {
  const { createGatewayBridge } = await import("../gateway-bridge.js");
  const fakePrisma = {} as never;
  const fakeIngress = { submit: vi.fn() };

  createGatewayBridge(fakePrisma, { platformIngress: fakeIngress });

  expect(capturedOnMessageRecorded).not.toBeNull();

  capturedOnMessageRecorded!({
    deploymentId: "dep_1",
    listingId: "list_1",
    organizationId: "org_1",
    channel: "telegram",
    sessionId: "ses_1",
    role: "assistant",
    content: "Hi there",
    workTraceId: "wt-X",
  });

  expect(lifecycleRecordMessageSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      role: "assistant",
      content: "Hi there",
      workTraceId: "wt-X",
    }),
  );
});

it("does not add workTraceId when forwarding a user-turn message to lifecycleTracker.recordMessage", async () => {
  const { createGatewayBridge } = await import("../gateway-bridge.js");
  const fakePrisma = {} as never;
  const fakeIngress = { submit: vi.fn() };

  createGatewayBridge(fakePrisma, { platformIngress: fakeIngress });

  expect(capturedOnMessageRecorded).not.toBeNull();

  capturedOnMessageRecorded!({
    deploymentId: "dep_1",
    listingId: "list_1",
    organizationId: "org_1",
    channel: "telegram",
    sessionId: "ses_1",
    role: "user",
    content: "Hello",
    // NOTE: no workTraceId field — pins that user turns stay text events.
  });

  const call = lifecycleRecordMessageSpy.mock.calls[0]!;
  const recordArg = call[0] as { workTraceId?: string };
  expect(recordArg.workTraceId).toBeUndefined();
});
```

- [ ] **Step 5.2: Run tests — expect fail**

```bash
pnpm --filter @switchboard/chat test gateway-bridge-attribution
```

Expected: the new tests fail because the bridge's `onMessageRecorded` callback doesn't yet forward `workTraceId`. The first new test will fail with the spy's call args missing `workTraceId`. The second new test will pass coincidentally (the spy receives an object without `workTraceId`) — but that's fine, the invariant is positively asserted.

(Actually: if Change A's mock changes break the existing two tests, fix the existing tests by updating them to use `lifecycleRecordMessageSpy` instead of an inline spy. They should still pass — the existing tests don't assert on `recordMessage` calls, they assert on `compoundingCtorArgs` and `capturedLifecycleHandler` which are unchanged.)

- [ ] **Step 5.3: Forward `workTraceId` in the bridge's `onMessageRecorded` callback**

Open `apps/chat/src/gateway/gateway-bridge.ts`. Find the `onMessageRecorded` block (around lines 255-266) and add the field to the forwarded shape:

```typescript
    onMessageRecorded: (info) => {
      taskRecorder.recordMessage(info);
      lifecycleTracker.recordMessage({
        sessionKey: `${info.deploymentId}:${info.channel}:${info.sessionId}`,
        deploymentId: info.deploymentId,
        organizationId: info.organizationId,
        channelType: info.channel,
        sessionId: info.sessionId,
        role: info.role,
        content: info.content,
        workTraceId: info.workTraceId,
      });
    },
```

Since `info.workTraceId` is `string | undefined` (assistant has it, user doesn't), passing it directly works in both shapes — `recordMessage` skips the accumulator push when undefined (per Task 3 logic).

- [ ] **Step 5.4: Run tests — expect pass**

```bash
pnpm --filter @switchboard/chat test gateway-bridge-attribution
```

Expected: all 4 tests pass (2 existing + 2 new).

- [ ] **Step 5.5: Run full chat test suite to catch any spy-mock fallout from Change A**

```bash
pnpm --filter @switchboard/chat test
```

Expected: 282 tests pass (280 baseline + 2 new). If any unrelated test in the chat package fails, investigate — likely a stale snapshot or fixture.

- [ ] **Step 5.6: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts apps/chat/src/gateway/__tests__/gateway-bridge-attribution.test.ts
git commit -m "$(cat <<'EOF'
feat(chat): forward workTraceId through gateway-bridge to lifecycle tracker

Bridge's onMessageRecorded callback now forwards info.workTraceId to
lifecycleTracker.recordMessage, completing the gateway → lifecycle
plumbing for the strong-tier outcome-attribution path.

Adds two bridge-layer integration tests:
- positive: assistant turn → workTraceId reaches recordMessage spy
- bridge does not add workTraceId when forwarding a user-turn
  message (defense in depth — the gateway-layer negative invariant
  is pinned in Task 4's channel-gateway.test.ts)

Spec: docs/superpowers/specs/2026-05-15-worktrace-ids-gateway-plumbing-design.md
EOF
)"
```

---

## Task 6: Final verification + open PR

- [ ] **Step 6.1: Full verification gates**

```bash
pnpm typecheck
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/chat test
pnpm --filter @switchboard/dashboard build
```

Expected — all green:

- `pnpm typecheck` — 18/18 succeed
- `@switchboard/schemas` — 581 tests passed (unchanged, sanity check)
- `@switchboard/core` — 3147+ tests passed (3143 baseline + 4 new conversation-lifecycle + assertion updates count as same tests with stricter expectations)
- `@switchboard/api` — 925+ tests passed (unchanged)
- `@switchboard/chat` — 282 tests passed (280 baseline + 2 new integration)
- `@switchboard/dashboard build` — clean (no dashboard files touched; build runs per the dashboard-build-not-in-CI doctrine)

If anything fails here, fix it in a new commit BEFORE pushing. Do not amend earlier commits — the test-driven commit history is the audit trail.

- [ ] **Step 6.2: Confirm branch context before push**

```bash
git branch --show-current
git log --oneline origin/main..HEAD
```

Expected:

- Branch: `feat/worktrace-ids-gateway-plumbing`
- 5 commits ahead of main (Task 1, 2, 3, 4, 5; Task 6 has no code commit, just verification + PR).

If branch is wrong, STOP. The pre-commit hook (`scripts/check-branch-relevance.sh`) warns on docs-vs-feature-branch mismatches but is non-blocking. Verify before pushing.

- [ ] **Step 6.3: Push the branch**

```bash
git push -u origin feat/worktrace-ids-gateway-plumbing
```

- [ ] **Step 6.4: Open the PR**

```bash
gh pr create --base main \
  --title "feat(agent-infra-parity): PR-3.1.b — workTraceIds gateway plumbing (closes carry-debt)" \
  --body "$(cat <<'EOF'
Closes the PR-3.1.b carry-debt flagged at \`docs/superpowers/plans/2026-05-14-agent-infra-pr3.2.md:21\`. Five PRs of PR-3.2 investment silently ship with their keystone (strong-tier outcome attribution) disabled until this lands; every \`outcomePatternsExtracted\` metric in production today is tagged \`attributionTier=\"fallback\"\` instead of \`\"strong\"\`.

## Summary

Threads \`workTraceId\` from \`PlatformIngress.submit()\` response through three existing layers (no new modules):

1. \`ChannelGateway.onMessageRecorded\` callback type widens to carry optional \`workTraceId\` on assistant turns.
2. \`ActiveSession\` gains a \`workTraceIds: string[]\` accumulator (separate from \`messages[]\` so trace IDs never leak into summarization prompts).
3. \`fireEnd\` populates \`ConversationEndEvent.workTraceIds\` (omitted/undefined when empty — never \`[]\`).
4. \`BookingAttribution\` widens with an optional \`workTraceId\`; the strong-tier resolver surfaces the matched ID.
5. The compounding service replaces \`workTraceId: null\` with \`attribution.workTraceId ?? null\`. The carry-debt comment is deleted.

## Verification

- \`pnpm typecheck\` clean across 18 packages
- 4 new conversation-lifecycle tests (accumulate, order preservation, empty→undefined, skip-undefined-turn)
- 2 new gateway-bridge-attribution tests (positive forwarding + negative invariant — user turns never carry \`workTraceId\`)
- Existing booking-attribution and compounding-service-canonical-keys assertions tightened to demand the new field
- Dashboard build clean (per dashboard-build-not-in-CI doctrine, even though no dashboard files are touched)

## Out of scope (filed separately)

- prom-client camelCase/snake_case label cleanup (second PR-3.2 carry-debt — separate observability PR)
- ad-optimizer follow-ups #510 (in-flight) / #512 / #513

## Spec + plan

- Spec: \`docs/superpowers/specs/2026-05-15-worktrace-ids-gateway-plumbing-design.md\` (#518)
- Plan: \`docs/superpowers/plans/2026-05-15-worktrace-ids-gateway-plumbing.md\` (this PR's predecessor plan PR)
EOF
)"
```

- [ ] **Step 6.5: Arm auto-merge once CI clears**

```bash
gh pr merge <PR-number> --auto --squash
```

(Pass the PR number printed by `gh pr create` in Step 6.4. Do NOT pass `--delete-branch` while a worktree still holds the branch — that flag will warn and fail-soft.)

- [ ] **Step 6.6: Post-merge: monitor production metrics**

After the PR lands and the next production deploy goes out:

- Monitor `outcomePatternsExtracted` metric — `attributionTier="strong"` should start appearing where it was 0%.
- Inspect new `DeploymentMemoryEvidence` rows: `workTraceId IS NOT NULL` on strong-tier rows; `workTraceId IS NULL` on fallback-tier rows.
- Cohort-rate change in `outcomePatternsMerged` and `outcomePatternsCreated` is expected — the strong tier may produce different pattern-merge behavior than fallback, since the booking match is more precise.

This monitoring isn't a code task. Document the observations in a follow-up issue if anything is anomalous.

---

## Rollback plan

If the production deploy surfaces unexpected behavior:

1. The PR is a single squash commit on main. Revert via `gh pr revert <merged-PR-number>` or `git revert <squash-sha>`.
2. Strong-tier attribution returns to 0% (the pre-PR state). No data corruption — `DeploymentMemoryEvidence` rows written between deploy and revert keep their `workTraceId` values; future rows go back to `null`. The column was always nullable.
3. File an issue with the observed behavior; restart planning from the spec.
