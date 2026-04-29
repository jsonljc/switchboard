# Design — `fix/launch-conversation-state-store` (Risk #1)

**Audit reference:** `.audit/08-launch-blocker-sequence.md` Launch-Risk #1 (lines 512–525).

**Date:** 2026-04-29

**Author:** Claude (Opus 4.7) under operator review.

**Slice:** Launch-Risk #1 only. Risks #2–#6 are out of scope.

---

## 1. Problem

`apps/api/src/routes/conversations.ts` and `apps/api/src/routes/escalations.ts` mutate `prisma.conversationState` directly. Three operator-driven mutations bypass any persistence boundary and are not recorded in `WorkTrace`:

| #   | Callsite                | Mutation                                                                               | Operator semantic                                      |
| --- | ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | `conversations.ts` ~286 | `conversationState.update` toggling `status` between `"active"` and `"human_override"` | Operator removes the AI from the conversation          |
| 2   | `conversations.ts` ~343 | `conversationState.update` appending an owner message and bumping `lastActivityAt`     | Operator sends an ad-hoc message during human override |
| 3   | `escalations.ts` ~198   | `conversationState.update` appending owner reply and setting `status: "active"`        | Operator releases an escalation back to the AI         |

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
- **Not** moving `ConversationState` _reads_ through the Store. Reads stay direct-Prisma in `apps/api/src/routes/conversations.ts` (`findMany`, `findUnique`, `count`, `findFirst`) and in `apps/api/src/routes/escalations.ts` (`findUnique`). The audit calls out _mutations_ explicitly.
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

### 4.2 `WorkTrace.ingressPath` discriminator and `hashInputVersion`

Add two top-level fields to `WorkTrace`:

```ts
ingressPath: "platform_ingress" | "store_recorded_operator_mutation";
hashInputVersion: number; // 1 = pre-this-slice canonicalization; 2 = includes ingressPath
```

- **Existing rows default to `ingressPath = "platform_ingress"` and `hashInputVersion = 1`** via migration column defaults.
- **`buildWorkTrace` defaults `ingressPath` to `"platform_ingress"` and `hashInputVersion` to the latest version (2).**
- **Operator-mutation traces set `ingressPath = "store_recorded_operator_mutation"`.**
- **Versioned hash input strategy:** `buildWorkTraceHashInput` switches its excluded-field set on `trace.hashInputVersion`. v1 excludes both `ingressPath` and `hashInputVersion` (matching the canonical input shape in PR #308). v2 includes `ingressPath` but still excludes `hashInputVersion` (which would self-reference). This keeps pre-existing locked rows verifiable against their original `contentHash` (they read back as `hashInputVersion = 1`, so their hash is recomputed with the v1 shape — bit-for-bit identical to what was stored). New persists carry `hashInputVersion = 2`, so their canonical input includes `ingressPath` and the hash binds the discriminator. **The hash is tamper-evident on `ingressPath` for every row written after this slice ships.** See §6.4 for the integrity preservation argument.
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

### 4.4 `governanceMode`, actor type, and trigger (verified literals)

The repo's existing literal unions constrain three fields. The spec must honor them:

- **`WorkTrace` has no top-level `governanceMode` field today.** The "operator_auto_allow" signal is recorded inside `modeMetrics`:

  ```ts
  modeMetrics: {
    governanceMode: "operator_auto_allow";
  }
  ```

  The row stays honest because the **triple** (`ingressPath = "store_recorded_operator_mutation"` ∧ `mode = "operator_mutation"` ∧ `governanceOutcome = "execute"`) makes it unmistakable that the mutation did not pass through `PlatformIngress` policy evaluation. `governanceMode` is a soft annotation for reviewers; the row-level discriminator is `ingressPath`.

- **`governanceOutcome`** uses the literal `"execute"` (`WorkTrace.governanceOutcome` is `"execute" | "require_approval" | "deny"`; `"allow"` is not valid and is **not** added in this slice).

- **`Actor.type`** is `"user" | "agent" | "system" | "service"` (`packages/core/src/platform/types.ts:2`). There is **no** `"operator"` literal. Operators are humans; the trace records `actor.type = "user"`.

- **`Actor.id`** comes from the API request. The Switchboard API uses API-key auth (`organizationIdFromAuth`, `principalIdFromAuth`, `runtimeIdFromAuth`); there is no per-user identifier on the request today. The spec records `actor.id = principalIdFromAuth ?? "operator"`. **Limitation acknowledged:** because the API key is org-scoped (often shared by the dashboard service account), `actor.id` is not a per-user identifier. Per-user attribution requires either per-user API keys or a dashboard-issued user-id header — both are out of scope for this slice and tracked as a follow-up. This slice ships honest at the level of "an operator on this organization's dashboard performed the mutation"; it does not falsely attribute to a specific human.

- **`Trigger`** is `"chat" | "api" | "schedule" | "internal"` (`packages/core/src/platform/types.ts:3`). There is **no** `"manual"` literal. Operator dashboard mutations enter via HTTP API; the trace records `trigger = "api"`.

- **`WorkOutcome`** is `"completed" | "failed" | "pending_approval" | "queued" | "running"` (`packages/core/src/platform/types.ts:5`). There is **no** `"succeeded"` literal. Successful operator mutations terminate at `outcome = "completed"`. See §4.7.1 for why operator-mutation rows initially persist as `"running"` and transition to `"completed"` via the finalize update.

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

### 4.7 Operator-mutation `WorkTrace` payload shape (initial persist)

The store persists the trace **initially as a non-terminal `outcome: "running"` row** with `executionStartedAt` and `completedAt` left undefined. This is required by the WorkTrace lock validator (`packages/core/src/platform/work-trace-lock.ts`) — see §4.7.1 for the full reasoning. The route (or, for `setOverride`, the store's own post-tx finalize step) transitions the row to `"completed"` via a separate `WorkTraceStore.update(...)` call, which stamps `lockedAt`.

```ts
{
  workUnitId,                       // crypto.randomUUID()
  traceId,                          // same as workUnitId for store-recorded rows
  parentWorkUnitId: undefined,
  deploymentId: undefined,
  intent: <ConversationOperatorActionKind>,    // "conversation.override.set" | …
  mode: "operator_mutation",
  organizationId,
  actor: input.operator,            // { type: "user", id: principalIdFromAuth ?? "operator" }
  trigger: "api",                   // operator dashboard → HTTP API
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
      redactedPreview,              // store-derived from input.message.text
      bodyHash,                     // store-derived from input.message.text
      deliveryAttempted: false,     // route updates this on enrich+finalize
      deliveryResult: undefined,    // route updates this on enrich+finalize
    },
  },
  governanceOutcome: "execute",
  riskScore: 0,
  matchedPolicies: [],
  governanceConstraints: undefined,
  outcome: "running",               // <-- non-terminal at persist; finalized to "completed" via update()
  durationMs: 0,                    // <-- finalized later
  executionSummary: "<one-line human description>",
  executionOutputs: undefined,
  modeMetrics: { governanceMode: "operator_auto_allow" },
  ingressPath: "store_recorded_operator_mutation",
  hashInputVersion: 2,
  requestedAt:           <ISO at store entry>,
  governanceCompletedAt: <same as requestedAt>,
  executionStartedAt:    undefined, // set on finalize update
  completedAt:           undefined, // set on finalize update
}
```

### 4.7.1 Why "persist as running, finalize via update": the lock-validator constraint

The WorkTrace lock validator (`work-trace-lock.ts:120-125`) enforces:

```ts
if (update.parameters !== undefined && !isEqual(update.parameters, current.parameters)) {
  const sealed = current.approvalOutcome !== undefined || current.executionStartedAt !== undefined;
  if (sealed) rejectedFields.push("parameters");
}
```

If we persisted the trace with `executionStartedAt` set (as an originally-tempting "this happened just now" stamp), the next `update()` call from the route's enrichment step would find `current.executionStartedAt` set, mark `sealed = true`, and reject the `parameters` mutation. Worse: in non-production environments the lock validator throws `WorkTraceLockedError` rather than returning a soft `{ ok: false, code: "WORK_TRACE_LOCKED" }` (`prisma-work-trace-store.ts:306-308`). Every send/reply route would 500 in tests.

**Resolution:** persist with `executionStartedAt = undefined` and `outcome = "running"`. The finalize update sets `outcome = "completed"` (a permitted `running → completed` transition), `executionStartedAt` (one-shot first-set, allowed), `completedAt`, `durationMs`, and (for message-bearing methods) the enriched `parameters`. The validator's `enteringTerminal` clause (`work-trace-lock.ts:152-156`) sees `running → completed` and stamps `lockedAt` automatically.

**Atomicity caveat:** the conversation state mutation and the **initial** trace persist remain transactional. The **finalize** update is a separate transaction. If the finalize update fails (network hiccup, DB blip), the trace exists permanently as `outcome: "running"` with `lockedAt: null`. That row is queryable and recoverable; the conversation state mutation still happened and is still attributable. This is an acceptable trade-off — the audit invariant ("no operator mutation without a trace") is upheld; only the trace's terminal status is best-effort post-tx. An operator-side reconciliation job could detect long-running stalled operator-mutation traces and finalize them as `failed`. Out of scope for this slice; recorded as future work in §10.

### 4.8 Finalize-and-enrich via `WorkTraceStore.update`

`app.workTraceStore` is **already** decorated on the Fastify instance (`apps/api/src/app.ts:54, 424`, shipped in PR #308 for the WorkTrace integrity gate). The plan uses it directly. No new `workTraceStore` decorator is added.

All three mutations end with a single `WorkTraceStore.update(workUnitId, fields)` call that finalizes the trace from `running → completed` and stamps `lockedAt`. Whether enrichment data accompanies the finalize depends on the action kind:

- **`setOverride`** (no external side-effect): the store itself, **after its outer `$transaction` commits**, calls `workTraceStore.update(workUnitId, { outcome: "completed", executionStartedAt, completedAt, durationMs })`. No `parameters` patch (no enrichment data exists). The validator allows the `running → completed` transition and stamps `lockedAt`.

- **`sendOperatorMessage` / `releaseEscalationToAi`** (external channel delivery): the store returns the `workTraceId` (and `executionStartedAt` stamp from before tx commit) to the route. The route performs `app.agentNotifier.sendProactive(...)` outside any DB transaction. After delivery completes (success or failure), the route calls a small file-local helper `finalizeOperatorTrace(app.workTraceStore, workTraceId, { parameters: enriched, outcome: "completed", executionStartedAt, completedAt, durationMs })` — a thin wrapper around `WorkTraceStore.update`. The same call atomically updates `parameters` (mutable because `current.executionStartedAt` is still undefined per §4.7.1), sets `executionStartedAt` (one-shot first-set, allowed), and transitions `outcome: running → completed` (which stamps `lockedAt`).

The finalize-enrich helper lives at `apps/api/src/routes/work-trace-delivery-enrichment.ts` (new file), shared between `conversations.ts` and `escalations.ts`. The helper:

1. Calls `workTraceStore.getByWorkUnitId(workTraceId)` to read current `parameters`.
2. Merges the delivery patch into `parameters.message`.
3. Calls `workTraceStore.update(workTraceId, { parameters: merged, outcome: "completed", executionStartedAt, completedAt, durationMs }, { caller: "<route_name>" })`.
4. If `update` returns `{ ok: false, code: "WORK_TRACE_LOCKED" }` (production path) or throws `WorkTraceLockedError` (dev/test path — `prisma-work-trace-store.ts:306-308`), wraps the throw in a try/catch, logs `console.warn` with the diagnostic, and continues. The trace was sealed mid-flight by another writer — extremely rare; not worth failing the operator's HTTP request, which already mutated state successfully.

This helper is owned by the route layer and uses `WorkTraceStore`. It is **not** a method on `ConversationStateStore`. The store's responsibility ends at "mutation + initial running-state trace, transactional"; finalize is the route's responsibility (and, for `setOverride`, the store's own post-tx step within the same store method).

### 4.9 Bootstrap wiring

`apps/api/src/app.ts` (where `app.prisma` and `app.workTraceStore` are already decorated):

- Construct `new PrismaConversationStateStore(prisma, workTraceStore)` after `workTraceStore` is constructed (around `app.ts:424`).
- Decorate `app.conversationStateStore`. **Do not** redecorate `app.workTraceStore`; it already exists.
- Add a Fastify type augmentation in the same file extending the existing `declare module "fastify"` block so `app.conversationStateStore` is typed `ConversationStateStore | null`.

Routes `import { ConversationStateStore } from "@switchboard/core/platform"` for the type only. Routes do **not** import `PrismaConversationStateStore` from `@switchboard/db` — that import would couple routes to the implementation and is a lint smell to flag during review.

### 4.10 Route surgery

#### `apps/api/src/routes/conversations.ts`

- PATCH `/:threadId/override` (~line 286): replace direct `findFirst` + `conversationState.update` with `app.conversationStateStore.setOverride(...)`. The route still does the auth check, parses the body, and maps store errors to HTTP codes.
- POST `/:threadId/send` (~line 343): replace direct `findFirst` + `conversationState.update` with `app.conversationStateStore.sendOperatorMessage(...)`. After the store call returns, perform `app.agentNotifier.sendProactive(...)` and the finalize-and-enrich update via `finalizeOperatorTrace(app.workTraceStore, workTraceId, { parameters: enriched, outcome: "completed", executionStartedAt, completedAt, durationMs })`.
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
- [ ] Each of the three operator mutations produces a `WorkTrace` row that ultimately reaches `outcome = "completed"` with `ingressPath = "store_recorded_operator_mutation"`, `mode = "operator_mutation"`, `governanceOutcome = "execute"`, `actor.type = "user"`, `trigger = "api"`, action-kind `intent`, before/after `parameters`, and (for message kinds) `parameters.message` with `redactedPreview` + `bodyHash` + `deliveryAttempted` + `deliveryResult`. The row is initially persisted as `outcome = "running"` and finalized via `WorkTraceStore.update` (which stamps `lockedAt` automatically).
- [ ] `ConversationState` mutation and the **initial** operator-mutation `WorkTrace` insert occur in the same Prisma `$transaction`. The finalize update is a separate transaction; if it fails, the trace exists as `running` permanently (the conversation mutation is still recorded; this is the documented atomicity trade-off in §4.7.1).
- [ ] Finalize and enrichment happen via `WorkTraceStore.update` (the existing surface from PR #308), **not** via any method on `ConversationStateStore`.
- [ ] `WorkTrace.hashInputVersion` exists; existing rows default to `1`; new operator-mutation rows persist with `2`. `buildWorkTraceHashInput` switches excluded-field set on `hashInputVersion`. The pinned-fixture test in the implementation locks down the v1 hash for a representative pre-migration row shape.
- [ ] Tests cover: `ingressPath` defaulting, hash input inclusion, transactional ordering, all three mutation methods, the regression harness asserting routes do not touch `prisma.conversationState.update`.
- [ ] Schema migration `20260429120000_add_worktrace_ingress_path` lands in the same commit as the schema change.
- [ ] Implementation PR test plan lists `pnpm db:check-drift` as a pre-merge follow-up the merger must run.
- [ ] `.audit/08-launch-blocker-sequence.md` Risk #1 entry marked shipped with PR citation + verification date.

## 9. Migration and rollout

- This is a backwards-compatible schema change. Default-backfill means existing services keep functioning during deploy.
- No feature flag is necessary: routes either call the store or they don't, and the store is the only writer of operator-mutation rows. There is no "old vs new" coexistence period.
- Rollback is the standard `git revert` of the implementation PR plus a `DROP COLUMN ingress_path` if the column itself needs to be removed (unlikely in practice).

## 10. Future migration to `PlatformIngress.submit()` (deferred) and other follow-ups

### 10.1 Per-user actor attribution

The current `actor.id = principalIdFromAuth ?? "operator"` is org-scoped, not per-user. To attribute mutations to the specific human who clicked the button:

1. Either: dashboard issues per-user API keys and the API key's `metadata.userId` flows into `principalIdFromAuth`.
2. Or: dashboard adds a custom header (e.g. `x-operator-user-id`) signed by the dashboard's NextAuth session, the API verifies the signature in middleware and exposes `request.operatorUserIdFromAuth`, and the spec records `actor.id` from that.

This is a separate Risk and out of scope for Launch-Risk #1. The acceptance for this slice is "honest at the org level"; per-user attribution is a launch-adjacent improvement.

### 10.2 Operator-mutation reconciliation

If the post-tx finalize update fails for a `setOverride` (or the route's finalize call fails post-delivery), the `WorkTrace` row exists permanently as `outcome: "running"` with `lockedAt: null`. A reconciliation job can detect long-running stalled operator-mutation rows (e.g. `outcome = "running" AND mode = "operator_mutation" AND requestedAt < now() - 5 minutes`) and finalize them as `failed` with an audit-visible diagnostic. Out of scope for this slice; recorded here so the reviewer knows this isn't a hidden gap.

### 10.3 Migration to `PlatformIngress.submit()`

Once operator-dashboard mutations become first-class governed actions:

1. Register the three action kinds with the skill/action runtime.
2. Routes call `PlatformIngress.submit({ intent: "conversation.override.set", ... })` directly.
3. `ingressPath = "platform_ingress"` (the natural default) — no change to existing trace consumers.
4. `ConversationStateStore.setOverride` etc. can either be deprecated or kept as the persistence-layer implementation invoked by the action handler. The Store boundary is preserved either way.
5. The `"operator_mutation"` `ExecutionModeName` literal can be retired or repurposed.

This slice does **not** make any of those changes. The `ingressPath` discriminator + the `mode = "operator_mutation"` + the `running → completed` lifecycle (with `lockedAt` stamped on terminal transition) is the entirety of the bridge.
