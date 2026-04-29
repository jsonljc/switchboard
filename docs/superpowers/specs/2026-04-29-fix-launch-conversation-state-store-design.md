# Design — `fix/launch-conversation-state-store` (Risk #1)

**Audit reference:** `.audit/08-launch-blocker-sequence.md` Launch-Risk #1 (lines 512–525).

**Date:** 2026-04-29

**Author:** Claude (Opus 4.7) under operator review.

**Slice:** Launch-Risk #1 only. Risks #2–#6 are out of scope.

---

## 1. Problem

`apps/api/src/routes/conversations.ts` and `apps/api/src/routes/escalations.ts` mutate `prisma.conversationState` directly. Three operator-driven mutations bypass any persistence boundary and are not recorded in `WorkTrace`:

| # | Callsite | Mutation | Operator semantic |
|---|---|---|---|
| 1 | `conversations.ts` ~286 | `conversationState.update` toggling `status` between `"active"` and `"human_override"` | Operator removes the AI from the conversation |
| 2 | `conversations.ts` ~343 | `conversationState.update` appending an owner message and bumping `lastActivityAt` | Operator sends an ad-hoc message during human override |
| 3 | `escalations.ts` ~198 | `conversationState.update` appending owner reply and setting `status: "active"` | Operator releases an escalation back to the AI |

These violate two doctrine invariants from `CLAUDE.md`:

- **"`WorkTrace` is canonical persistence."** — None of the three mutations land in `WorkTrace`.
- **"No mutating bypass paths."** — Routes touch Prisma directly with no Store indirection.

The acceptance criteria from the audit doc:

> PrismaConversationStateStore created and wired into routes. Chat state mutations routed through Store indirection. Conversation updates recorded in WorkTrace.

## 2. Design intent

Create a single persistence boundary, `ConversationStateStore`, that owns the three operator mutations. Each mutation persists state and an **operator-mutation `WorkTrace` record** in one Prisma transaction. The trace is honest: it does not pretend the mutation went through `PlatformIngress.submit()` governance evaluation. A new top-level `ingressPath` discriminator on `WorkTrace` makes that distinction queryable, hash-covered, and tamper-evident.

This is the **B-now, A-later** path. A future slice may register these as first-class action kinds behind `PlatformIngress.submit()`. This slice does not.

## 3. Non-goals

- **Not** routing operator mutations through `PlatformIngress.submit()` in this slice.
- **Not** introducing a separate `ActivityLog` audit surface for these events.
- **Not** refactoring `WorkTrace` consumers into a discriminated `runtimeAction | operatorMutation` union.
- **Not** moving `ConversationState` *reads* through the Store. Reads stay direct-Prisma in `apps/api/src/routes/conversations.ts` (`findMany`, `findUnique`, `count`, `findFirst`) and in `apps/api/src/routes/escalations.ts` (`findUnique`). The audit calls out *mutations* explicitly.
- **Not** changing the existing channel-delivery side-effect order: routes still call `app.agentNotifier.sendProactive(...)` after the store call returns.
- **Not** broadening the generic core `WorkTraceStore` interface unless it can express tx-aware persistence honestly today.
- **Not** adding any new mutation methods beyond the three named action kinds.

## 4. Architecture

### 4.1 New core platform contract

`packages/core/src/platform/conversation-state-store.ts` (new file):

```ts
import type { Actor } from "./types.js";

export type ConversationOperatorActionKind =
  | "conversation.override.set"
  | "conversation.message.send"
  | "escalation.reply.release_to_ai";

export interface ConversationStateSnapshot {
  status: string;
  // Forward-compatible: callers may inspect more fields, but the trace
  // before/after currently records `status` only. Add fields here if a
  // future operator mutation needs them in the trace; do not add them
  // speculatively.
}

export interface SetOverrideInput {
  organizationId: string;
  threadId: string;
  override: boolean; // true => human_override, false => active
  operator: Actor; // actorType "operator" expected; carried through to trace
}

export interface SetOverrideResult {
  conversationId: string;
  threadId: string;
  status: string;
  workTraceId: string;
}

export interface SendOperatorMessageInput {
  organizationId: string;
  threadId: string;
  operator: Actor;
  message: {
    /**
     * Plain text the operator typed. The store derives `redactedPreview`
     * and `bodyHash` internally — callers do not compute them. The text
     * is appended to ConversationState.messages (existing behavior); the
     * trace records only redacted preview + hash.
     */
    text: string;
  };
}

export interface SendOperatorMessageResult {
  conversationId: string;
  threadId: string;
  channel: string;
  destinationPrincipalId: string;
  workTraceId: string;
  appendedMessage: { role: "owner"; text: string; timestamp: string };
}

export interface ReleaseEscalationInput {
  organizationId: string;
  handoffId: string;
  threadId: string; // resolved by the route from handoff.sessionId
  operator: Actor;
  reply: {
    /**
     * Plain text the operator typed. The store derives `redactedPreview`
     * and `bodyHash` internally — callers do not compute them.
     */
    text: string;
  };
}

export interface ReleaseEscalationResult {
  conversationId: string;
  threadId: string;
  channel: string;
  destinationPrincipalId: string;
  workTraceId: string;
  appendedReply: { role: "owner"; text: string; timestamp: string };
}

export interface ConversationStateStore {
  setOverride(input: SetOverrideInput): Promise<SetOverrideResult>;
  sendOperatorMessage(input: SendOperatorMessageInput): Promise<SendOperatorMessageResult>;
  releaseEscalationToAi(input: ReleaseEscalationInput): Promise<ReleaseEscalationResult>;
}
```

Re-exported from `packages/core/src/platform/index.ts` alongside `WorkTraceStore`. The interface is **not** in `packages/schemas` — it is a platform persistence boundary, not a wire schema.

The route passes the plain text the operator typed. The store derives `redactedPreview` (a length-capped, control-character-stripped slice) and `bodyHash` (SHA-256 of the canonical UTF-8 bytes) internally; only those two fields enter `WorkTrace.parameters.message`. The full text is appended to `ConversationState.messages` (existing JSON-column behavior — this slice does not change what is stored on `ConversationState`) and flows through to `app.agentNotifier.sendProactive(...)` from the route after the store call returns.

Centralizing redaction + hashing in the store guarantees both routes hash and redact identically, and prevents drift if a future caller appears.

### 4.2 `WorkTrace.ingressPath` discriminator

Add a top-level field to `WorkTrace`:

```ts
ingressPath: "platform_ingress" | "store_recorded_operator_mutation";
```

- **Existing rows default to `"platform_ingress"`** via the migration default.
- **`buildWorkTrace` defaults `ingressPath` to `"platform_ingress"`** unless the caller passes a different value via `TraceInput`.
- **Operator-mutation traces set `ingressPath = "store_recorded_operator_mutation"`.**
- **`buildWorkTraceHashInput` must include `ingressPath`** in the canonical hash input. This is a one-field extension to the v1 hash input shipped in PR #308. The hash version stays at v1; the operator-mutation rows are the first rows that carry a non-default value, so existing-row hashes remain stable as long as the canonicalization treats `"platform_ingress"` identically across pre- and post-migration reads.
- **Filterable at row level:** dashboards, integrity replays, and queries can filter by `ingress_path = 'store_recorded_operator_mutation'` without parsing JSON.

### 4.3 `ExecutionModeName` extension

`packages/core/src/platform/types.ts`:

```ts
// before
export type ExecutionModeName = "skill" | "pipeline" | "cartridge" | "workflow";

// after
export type ExecutionModeName =
  | "skill"
  | "pipeline"
  | "cartridge"
  | "workflow"
  | "operator_mutation";
```

Operator-mutation traces use `mode = "operator_mutation"`. Validators / exhaustive switches that consume `ExecutionModeName` will be updated to handle the new variant. The `WorkTrace.mode` Prisma column is already `String` (not an enum), so no DB enum migration is needed.

### 4.4 `governanceMode` (clarification)

`WorkTrace` has no top-level `governanceMode` field today. The "operator_auto_allow" signal is recorded inside `modeMetrics`:

```ts
modeMetrics: { governanceMode: "operator_auto_allow" }
```

The row stays honest because the **triple** (`ingressPath = "store_recorded_operator_mutation"` ∧ `mode = "operator_mutation"` ∧ `governanceOutcome = "execute"`) makes it unmistakable that the mutation did not pass through `PlatformIngress` policy evaluation. `governanceMode` is a soft annotation for reviewers; the row-level discriminator is `ingressPath`.

`governanceOutcome` uses the existing literal `"execute"` (the `WorkTrace` type only allows `"execute" | "require_approval" | "deny"`; `"allow"` is not a valid literal today and is **not** added in this slice).

### 4.5 PrismaWorkTraceStore — tx-aware operator-mutation write path

Add one method to the concrete `PrismaWorkTraceStore` (in `packages/db/src/stores/prisma-work-trace-store.ts`):

```ts
recordOperatorMutation(
  trace: WorkTrace,
  ctx: { tx: Prisma.TransactionClient },
): Promise<void>;
```

- The method MUST use `ctx.tx` for the insert so the write joins the caller's `$transaction`.
- The method MUST compute `contentHash` and `traceVersion = 1` exactly as `persist()` does today (call the same hash helper). The integrity invariant (PR #308) applies to operator-mutation rows.
- The generic core `WorkTraceStore` interface is **not** broadened in this slice. `PrismaConversationStateStore` depends on the concrete `PrismaWorkTraceStore` for this method. This is a deliberate db-layer-to-db-layer dependency to preserve the honest interface boundary in core.

### 4.6 PrismaConversationStateStore

`packages/db/src/stores/prisma-conversation-state-store.ts` (new file; distinct from the unrelated existing `prisma-conversation-store.ts`).

```ts
export class PrismaConversationStateStore implements ConversationStateStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workTraceStore: PrismaWorkTraceStore,
  ) {}
  // ...
}
```

Each public method opens `prisma.$transaction(async (tx) => { ... })`. Inside the tx callback:

1. `tx.conversationState.findFirst(...)` (or `findUnique`) for the row, scoped to `organizationId`.
2. Validate state-transition preconditions, mirroring the route guards being replaced:
   - `setOverride`: row must exist; otherwise throw a typed `ConversationStateNotFound` error the route maps to 404.
   - `sendOperatorMessage`: row must exist and `status === "human_override"`; otherwise throw `ConversationStateInvalidTransition` mapped to 404 / 409 by the route.
   - `releaseEscalationToAi`: row must exist for `threadId`; if absent, throw `ConversationStateNotFound` (the route currently silently skips when the conversation is missing — this slice **changes that to an explicit 404** to keep behavior auditable; see §6.2).
3. Compute `before` snapshot (`{ status }`) and `after` snapshot (`{ status }`).
4. `tx.conversationState.update(...)` to apply the mutation.
5. Build the operator-mutation `WorkTrace` payload (see §4.7) and call `workTraceStore.recordOperatorMutation(trace, { tx })`.
6. Return the result DTO including `workTraceId`.

The transaction boundary stays inside the store. Routes never see `tx`.

### 4.7 Operator-mutation `WorkTrace` payload shape

```ts
{
  workUnitId,                       // crypto.randomUUID()
  traceId,                          // same as workUnitId for store-recorded rows
  parentWorkUnitId: undefined,
  deploymentId: undefined,
  intent: <ConversationOperatorActionKind>,    // "conversation.override.set" | …
  mode: "operator_mutation",
  organizationId,
  actor: input.operator,            // { type: "operator", id: <userId>, … }
  trigger: { source: "operator_dashboard" },
  idempotencyKey: undefined,
  parameters: {
    actionKind,
    orgId,
    conversationId,
    escalationId,                   // releaseEscalationToAi only
    before: { status: <prev> },
    after:  { status: <next> },
    message: {                      // sendOperatorMessage / releaseEscalationToAi only
      channel,
      destination,
      redactedPreview,
      bodyHash,
      deliveryAttempted: false,     // updated post-delivery via WorkTraceStore.update
      deliveryResult: undefined,
    },
  },
  governanceOutcome: "execute",
  riskScore: 0,
  matchedPolicies: [],
  governanceConstraints: undefined,
  outcome: "succeeded",
  durationMs: <measured>,
  executionSummary: "<one-line human description>",
  executionOutputs: undefined,
  modeMetrics: { governanceMode: "operator_auto_allow" },
  ingressPath: "store_recorded_operator_mutation",
  requestedAt:           <ISO at store entry>,
  governanceCompletedAt: <same as requestedAt>,
  executionStartedAt:    <ISO before tx.conversationState.update>,
  completedAt:           <ISO after tx.conversationState.update>,
}
```

### 4.8 Channel delivery and post-mutation enrichment

For `sendOperatorMessage` and `releaseEscalationToAi`, the route owns the network side-effect and any subsequent enrichment:

1. Route calls `app.conversationStateStore.<method>(...)` → state + initial trace, transactional.
2. Route calls `app.agentNotifier.sendProactive(principalId, channel, message)` outside any DB transaction.
3. Route calls a delivery-enrichment method on `WorkTraceStore` (existing or to be added) to update the same `workTraceId` with `parameters.message.deliveryAttempted = true` and `parameters.message.deliveryResult = …`.

The delivery-enrichment method is owned by `WorkTraceStore`, **not** `ConversationStateStore`. `ConversationStateStore` is not a generic `WorkTrace` update surface.

The exact delivery-enrichment surface depends on what `WorkTraceStore.update(workUnitId, fields)` already supports. The plan PR will pick the smallest surface:

- **Preferred:** reuse the existing `WorkTraceStore.update(workUnitId, fields)` from `work-trace-recorder.ts` to overwrite `parameters` with the enriched object. This is hash-relevant (parameters enter the hash) so the existing path bumps `traceVersion` and re-anchors `contentHash`. Verified-honest by construction.
- **Fallback only if needed:** add a thin `recordDeliveryOutcome(workUnitId, { deliveryAttempted, deliveryResult })` helper on `PrismaWorkTraceStore` that wraps the same call. Add only if route ergonomics require it; do not broaden the core interface.

If `app.workTraceStore` is not currently decorated on the Fastify instance, the plan PR adds the decorator rather than coupling delivery enrichment to `ConversationStateStore`.

### 4.9 Bootstrap wiring

`apps/api/src/server.ts` (or wherever `app.prisma` is decorated):

- Construct a single `PrismaWorkTraceStore` instance (existing or to be exposed).
- Construct `new PrismaConversationStateStore(prisma, workTraceStore)`.
- Decorate `app.conversationStateStore` and (if missing today) `app.workTraceStore`.
- Add Fastify type augmentation in the API package so `request.server.conversationStateStore` is typed.

Routes `import { ConversationStateStore } from "@switchboard/core/platform"` for the type only. Routes do **not** import `PrismaConversationStateStore` from `@switchboard/db` — that import would couple routes to the implementation and is a lint smell to flag during review.

### 4.10 Route surgery

#### `apps/api/src/routes/conversations.ts`

- PATCH `/:threadId/override` (~line 286): replace direct `findFirst` + `conversationState.update` with `app.conversationStateStore.setOverride(...)`. The route still does the auth check, parses the body, and maps store errors to HTTP codes.
- POST `/:threadId/send` (~line 343): replace direct `findFirst` + `conversationState.update` with `app.conversationStateStore.sendOperatorMessage(...)`. After the store call returns, perform `app.agentNotifier.sendProactive(...)` and the delivery-enrichment update.
- The `PrismaLike` test interface in this file shrinks — `update` is removed from the typed surface; only `findMany`, `count`, `findFirst`, `findUnique` remain. `buildConversationList` and `buildConversationDetail` (read paths) are untouched.

#### `apps/api/src/routes/escalations.ts`

- POST `/:id/reply` (~line 198): replace the inline `conversationState.update` with `app.conversationStateStore.releaseEscalationToAi(...)`. The `handoff.update` and channel delivery logic remain in-route. The post-mutation `app.prisma.conversationState.findUnique` call (line 227) used to look up `principalId`/`channel` for delivery is no longer needed because the store result already returns them.

The store's `releaseEscalationToAi` requires the route to pass `threadId`, which the route resolves from `handoff.sessionId` (existing logic). If `handoff.sessionId` is null, the route skips the store call entirely — this matches existing behavior of the "release without conversation" branch.

### 4.11 Schema migration

New migration directory: `packages/db/prisma/migrations/20260429120000_add_worktrace_ingress_path/migration.sql`.

```sql
ALTER TABLE "WorkTrace"
  ADD COLUMN "ingress_path" TEXT NOT NULL DEFAULT 'platform_ingress';
```

- Timestamp `20260429120000` is greater than the most recent migration `20260429071248_add_worktrace_integrity` (PR #308).
- The `Prisma.schema` `WorkTrace` model gains:
  ```
  ingressPath String @default("platform_ingress") @map("ingress_path")
  ```
- The default backfills existing rows transparently. No data migration step is required.
- `pnpm db:check-drift` is listed in the implementation PR test plan as a merger pre-flight (no live Postgres available in the implementer's environment per CLAUDE.md guidance).

## 5. Tests

### 5.1 Unit — `PrismaConversationStateStore`

Co-located at `packages/db/src/stores/__tests__/prisma-conversation-state-store.test.ts`. Mocks `PrismaClient` (transaction-aware mock) and `PrismaWorkTraceStore`. Verifies for each of the three methods:

- State mutation receives the expected `where` + `data`.
- `WorkTraceStore.recordOperatorMutation` called exactly once, with the same `tx` client.
- Trace payload carries: `intent`, `mode = "operator_mutation"`, `ingressPath = "store_recorded_operator_mutation"`, `governanceOutcome = "execute"`, `riskScore = 0`, `matchedPolicies = []`, operator actor, before/after, and (for messages) `message` parameters with `deliveryAttempted: false`.
- Precondition violations throw the typed errors and do **not** call the WorkTrace store.
- Transaction ordering: state update happens before trace insert, and a thrown error from the trace insert rolls back the state update (verified by mock-tx semantics).

### 5.2 Unit — `buildWorkTrace` / `buildWorkTraceHashInput`

`packages/core/src/platform/__tests__/work-trace-recorder.test.ts` (extend) and `…/work-trace-hash.test.ts` (extend):

- `buildWorkTrace` defaults `ingressPath = "platform_ingress"` when absent from `TraceInput`.
- `buildWorkTrace` carries an explicit `ingressPath` through to the output.
- `buildWorkTraceHashInput` includes `ingressPath` in canonical input. Two traces identical except for `ingressPath` produce **different** hashes.
- A trace with `ingressPath = "platform_ingress"` produces a hash equal to one generated by the prior canonical input shape **only if** the canonicalization treats the default value identically — verify and lock down with a fixture so the hash for a canonical pre-migration shape is preserved on read.

### 5.3 Route tests

- Update `apps/api/src/routes/__tests__/conversations-send.test.ts` to mock `app.conversationStateStore` instead of `mockPrisma.conversationState`.
- Update `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts` similarly.
- Add a test that asserts the route never calls `prisma.conversationState.update` (regression harness — `mockPrisma.conversationState.update` should not be invoked on the success path).

### 5.4 Integration

`apps/api/src/__tests__/conversation-state-store.integration.test.ts`, gated on `DATABASE_URL`:

```ts
describe.skipIf(!process.env.DATABASE_URL)("PrismaConversationStateStore (integration)", ...);
```

Verifies end-to-end that `setOverride` (the simplest of the three) writes both the `ConversationState` row update and the `WorkTrace` row in the same transaction, and that injecting a forced error inside the trace insert rolls back the state mutation.

### 5.5 Lint / type guards

- `packages/db/src` exports `PrismaConversationStateStore` for the API bootstrap file only. A grep test (or arch-check rule, if cheap) ensures no `apps/api/src/routes/**` file imports `PrismaConversationStateStore` directly.
- The shrunken `PrismaLike` in `conversations.ts` typechecks (no `update` reference left in the file).

## 6. Behavioral changes

### 6.1 Trace overhead per mutation

Each operator mutation now writes one `WorkTrace` row. Expected steady-state volume is single-digit-per-day at launch — this is operator dashboard activity, not high-frequency. No throughput concerns.

### 6.2 Escalation release with missing conversation — explicit 404

The current `escalations.ts:182` path silently skips the conversation update if `app.prisma.conversationState.findUnique` returns null. After this slice, `releaseEscalationToAi` raises `ConversationStateNotFound` and the route returns 404. This is a **deliberate behavioral tightening**: a release request that names a session whose conversation is gone is operator-visible state corruption and should surface, not be papered over. Recorded here so the implementer does not "fix" it back to silent-skip.

### 6.3 Default `ingressPath` for existing rows

Existing rows backfill to `"platform_ingress"` via the migration default. `buildWorkTraceHashInput` extension means hashes computed on rows read from the DB include `"platform_ingress"`. The first re-anchor of a pre-migration row (via any normal `WorkTraceStore.update` after this PR ships) will bump `traceVersion` and write a hash that includes `ingressPath`. Pre-existing locked rows that never get updated continue to verify against their original hash, which did not include `ingressPath` — see §6.4.

### 6.4 Pre-migration locked rows — integrity verification

Rows that were `lockedAt`-sealed before this slice ships have `contentHash` values computed without `ingressPath` in the canonical input. The implementer MUST preserve verification of those pre-existing locked rows. Two acceptable strategies — the plan picks one:

- **Versioned hash input:** introduce `traceVersion = 0` semantics for "hash was computed without `ingressPath`," and have the verifier choose canonical-input shape based on `traceVersion`. PR #308 already established `traceVersion` semantics; this slice extends them.
- **Default-equivalence:** if the canonical-JSON serializer omits `ingressPath` when its value is the default `"platform_ingress"`, the new code can verify pre-existing locked rows without knowing they predate this slice. Verifying this property requires reading the canonicalizer; the implementer confirms or falls back to the versioned-hash-input strategy.

Either way, **no pre-existing locked row is allowed to fail integrity verification** after this slice ships. A test fixture loading a known pre-migration row's hash and re-verifying after the change is mandatory.

## 7. Dependencies and order of work

1. Add `ingressPath` field to `WorkTrace` (TS) + Prisma model + migration. Update `buildWorkTrace` default + `buildWorkTraceHashInput` inclusion. Tests + integrity preservation per §6.4.
2. Add `"operator_mutation"` to `ExecutionModeName`. Update any exhaustive switches.
3. Add `recordOperatorMutation(trace, { tx })` to `PrismaWorkTraceStore`. Tests.
4. Add `ConversationStateStore` interface to `packages/core/src/platform/`. Re-export.
5. Add `PrismaConversationStateStore` to `packages/db/src/stores/`. Tests (unit + integration).
6. Wire `app.conversationStateStore` (and `app.workTraceStore` if missing) in `apps/api/src/server.ts`. Type augmentation.
7. Replace direct Prisma mutations in `conversations.ts` (override, send) and `escalations.ts` (reply). Update route tests.
8. Run `pnpm reset && pnpm typecheck && pnpm test && pnpm build && pnpm lint`. All must pass.
9. Update `.audit/08-launch-blocker-sequence.md` Risk #1 entry to "shipped" with PR citation + verification date.

## 8. Acceptance

- [ ] `apps/api/src/routes/conversations.ts` and `apps/api/src/routes/escalations.ts` no longer call `prisma.conversationState.update` (or `.create`).
- [ ] `ConversationStateStore` interface lives in `packages/core/src/platform/conversation-state-store.ts` and is re-exported from `packages/core/src/platform/index.ts`.
- [ ] `PrismaConversationStateStore` lives in `packages/db/src/stores/prisma-conversation-state-store.ts`, is distinct from the unrelated existing `prisma-conversation-store.ts`, and is wired as `app.conversationStateStore` on the Fastify API.
- [ ] No file under `apps/api/src/routes/` imports `PrismaConversationStateStore` directly.
- [ ] `WorkTrace.ingressPath` exists as a top-level field; existing rows default to `"platform_ingress"`; new operator-mutation rows set `"store_recorded_operator_mutation"`.
- [ ] `buildWorkTrace` defaults `ingressPath` to `"platform_ingress"`; `buildWorkTraceHashInput` includes `ingressPath` in the canonical input; pre-existing locked rows still verify their original `contentHash` (per §6.4).
- [ ] `ExecutionModeName` includes `"operator_mutation"`.
- [ ] Each of the three operator mutations produces a `WorkTrace` row with `ingressPath = "store_recorded_operator_mutation"`, `mode = "operator_mutation"`, `governanceOutcome = "execute"`, operator `actor`, action-kind `intent`, before/after `parameters`, and (for message kinds) `parameters.message` with `redactedPreview` + `bodyHash` + `deliveryAttempted` + (after route enrichment) `deliveryResult`.
- [ ] `ConversationState` mutation and the operator-mutation `WorkTrace` insert occur in the same Prisma `$transaction`.
- [ ] Channel-delivery enrichment happens via `WorkTraceStore.update`/`recordDeliveryOutcome`, **not** via a method on `ConversationStateStore`.
- [ ] Tests cover: `ingressPath` defaulting, hash input inclusion, transactional ordering, all three mutation methods, the regression harness asserting routes do not touch `prisma.conversationState.update`.
- [ ] Schema migration `20260429120000_add_worktrace_ingress_path` lands in the same commit as the schema change.
- [ ] Implementation PR test plan lists `pnpm db:check-drift` as a pre-merge follow-up the merger must run.
- [ ] `.audit/08-launch-blocker-sequence.md` Risk #1 entry marked shipped with PR citation + verification date.

## 9. Migration and rollout

- This is a backwards-compatible schema change. Default-backfill means existing services keep functioning during deploy.
- No feature flag is necessary: routes either call the store or they don't, and the store is the only writer of operator-mutation rows. There is no "old vs new" coexistence period.
- Rollback is the standard `git revert` of the implementation PR plus a `DROP COLUMN ingress_path` if the column itself needs to be removed (unlikely in practice).

## 10. Future migration to `PlatformIngress.submit()` (deferred)

Once operator-dashboard mutations become first-class governed actions:

1. Register the three action kinds with the skill/action runtime.
2. Routes call `PlatformIngress.submit({ intent: "conversation.override.set", ... })` directly.
3. `ingressPath = "platform_ingress"` (the natural default) — no change to existing trace consumers.
4. `ConversationStateStore.setOverride` etc. can either be deprecated or kept as the persistence-layer implementation invoked by the action handler. The Store boundary is preserved either way.
5. The `"operator_mutation"` `ExecutionModeName` literal can be retired or repurposed.

This slice does **not** make any of those changes. The `ingressPath` discriminator is the entirety of the bridge.
