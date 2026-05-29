# Alex Cockpit A.7c-followup — Typed Pending Approval Payload Emitters

**Date:** 2026-05-15
**Parent spec:** [Alex Cockpit Home — Design Spec](../specs/2026-05-14-alex-cockpit-home-design.md) (§Acceptance criterion 5 — silently unmet until this slice lands)
**Predecessor slices:**

- A.7a — `fix(cockpit): A.7a — metrics agentRole + Alex approvals sort` (#560, squash `fd86ecfe`)
- A.7b — `fix(cockpit): a.7b — approval respond wiring + AlexApprovalRow` (#561, squash)
- A.7c — `feat(cockpit): A.7c — six-kind classification rails (emitter wiring follow-up)` (#563, **rails-only**; emitter producer contract deferred to this slice)

---

## Why this slice lands now

A.7c shipped the **rails** for six-kind approval classification end-to-end (schema → tool-result → server-route projection → wire type → rich adapter → cockpit page swap), but **no production code populates `payload.kind`**. Every approval emitted by the runtime today still surfaces as `kind: "pricing"` via the rich adapter's legacy-fallback path.

The reason is structural, not oversight. The A.7c plan assumed hooks like `deterministic-safety-gate.ts` and `claim-classifier.ts` call `pendingApproval()` directly. They don't. Verified against `main` during A.7c implementation:

- `grep "pendingApproval" packages/core/src/skill-runtime/hooks/` → **empty**
- `grep "pendingApproval" packages/core/src/conversation-lifecycle/qualification/` → **empty**
- The **only** `pendingApproval()` callsite is `packages/core/src/skill-runtime/skill-executor.ts:376`, which synthesizes the tool result from a hook's `HookResult.decision === "pending_approval"` + `HookResult.reason`.

The current `HookResult` shape (`packages/core/src/skill-runtime/types.ts:249`):

```ts
export interface HookResult {
  proceed: boolean;
  reason?: string;
  decision?: "denied" | "pending_approval";
  substituteResult?: ToolResult;
}
```

Hooks signal intent but cannot carry structured payload — only a free-text `reason`. To deliver Critical #3 at the operator level, the `HookResult` **producer contract** must be extended to carry typed payloads, and the central synthesizer at `skill-executor.ts:376` must forward them.

A.7c-followup is small (~150 LOC) but architecturally significant: it's the first typed-overlay on `HookResult`. The Riley-side Wave B precedent for typed overlays (`[[agent-infra-pr3-merged]]` §PR-3.2e's `pilotMode` flag on `inputConfig`) is the closest analogue. This slice deserves its own review surface, which is why it didn't ship inline with A.7c rails.

**Critical #3 status:** Rails merged (#563); producer wiring closes the gap with this slice.

### Downstream consumers

- **Alex cockpit `/alex`** — Directly closes Critical #3. Operators will see regulatory cards in red-urgency, safety-gate cards in their distinct copy, refunds/escalations/qualifications with kind-appropriate CTAs. The umbrella spec's "medical-regulatory red urgency" differentiation point becomes reachable.
- **Riley cockpit `/riley`** — Unaffected at the data-shape level (Riley uses `RileyApprovalKind`, a different enum derived from recommendations, not the alex-side `PendingApprovalKind`). A.7c-followup does not touch `lib/cockpit/riley/**`.
- **Approval store + propose-pipeline** — `createApprovalRequest()` already accepts `ApprovalRequestSchema.payload` (added in A.7c). The hook-payload changes need to thread through to `createApprovalRequest()` so the payload reaches the persisted `Approval.payload` JSON column.
- **Future agent verticals (Mira, etc.)** — Inherit the typed-payload pattern for free. Any future approval kind enum extension reuses the `HookResult.payload` channel.

---

## Slice goal

Close Critical #3 at the operator level by wiring typed approval payloads from hook sources → `HookResult` → `skill-executor.ts` → `pendingApproval()` ToolResult → `propose-pipeline.createApprovalRequest()` → persisted `Approval.payload` → server-route projection → dashboard rich adapter → rendered card.

One sentence: **Wire the producer side of A.7c so non-pricing approvals stop falling through the legacy adapter.**

---

## What ships

A.7c-followup ships as **one PR** (no sub-slicing). All five pieces are tightly coupled — splitting them would leave the runtime in a half-cutover state where some hooks emit `payload.kind` and others don't.

### 1. `HookResult` contract extension

**File:** `packages/core/src/skill-runtime/types.ts`

Add optional `payload?: PendingApprovalPayload` field. The field is meaningful only when `decision === "pending_approval"`; for `decision === "denied"` or `decision === undefined`, the field is ignored by the executor.

```ts
import type { PendingApprovalPayload } from "@switchboard/schemas";

export interface HookResult {
  proceed: boolean;
  reason?: string;
  decision?: "denied" | "pending_approval";
  substituteResult?: ToolResult;
  /**
   * Typed payload forwarded to ToolResult.error.payload when
   * decision === "pending_approval". Optional; absence preserves
   * legacy behavior (renders as kind: "pricing" via fallback).
   */
  payload?: PendingApprovalPayload;
}
```

`LlmHookResult` inherits via `extends HookResult` — no separate change needed.

### 2. `skill-executor.ts:376` payload forwarding

**File:** `packages/core/src/skill-runtime/skill-executor.ts`

Current code (line 375-377):

```ts
} else if (toolHookResult.decision === "pending_approval") {
  result = pendingApproval(toolHookResult.reason ?? "Requires approval");
}
```

Updated:

```ts
} else if (toolHookResult.decision === "pending_approval") {
  result = pendingApproval(
    toolHookResult.reason ?? "Requires approval",
    toolHookResult.payload,
  );
}
```

`pendingApproval(message, payload?)` already accepts the optional second arg (shipped in A.7c at `packages/core/src/skill-runtime/tool-result.ts`).

The `runBeforeToolCallHooks` aggregator (the function returning `toolHookResult`) needs to be inspected: if it merges multiple hook results, the merge strategy for `payload` needs to be defined. Default: **first-payload-wins** (the first hook to emit `payload` claims the kind; subsequent hooks' payloads are ignored). Document this in the aggregator if it isn't already self-evident.

There may be parallel pre-tool / pre-skill / pre-llm hook chains — verify each forwards `payload` symmetrically. Specifically:

- `runBeforeToolCallHooks` (line ~361)
- `runBeforeSkillHooks` (if exists; verify path at implementation time)
- `runBeforeLlmCallHooks` (if applicable; LLM-side approvals are less common but possible)

Each chain that can produce `decision === "pending_approval"` must propagate `payload` to its `pendingApproval()` synthesizer.

### 3. Wire the five hook sources

For each hook that returns `decision: "pending_approval"`, populate `payload.kind` (and optionally `body`/`quote`/`quoteFrom`):

| Hook file                                                                                                                                | Emits kind        | Body source                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts`                                                                     | `"safety-gate"`   | The rule that triggered the gate (rule id + short description) |
| `packages/core/src/skill-runtime/hooks/claim-classifier.ts`                                                                              | `"regulatory"`    | The flagged claim text (from the LLM's classifier output)      |
| `packages/core/src/conversation-lifecycle/qualification/disqualification-resolver.ts` (or wherever qualification approvals originate)    | `"qualification"` | The disqualification reason copy                               |
| Refund-detection emitter (located at implementation time via `rg "refund.*pendingApproval\|pendingApproval.*refund" packages/core/src/`) | `"refund"`        | The refund context (amount, reason if available)               |
| Escalation emitter (located at implementation time via `rg "escalat.*pendingApproval\|pendingApproval.*escalat" packages/core/src/`)     | `"escalation"`    | The escalation trigger copy                                    |

For each: read the hook + its colocated test, write a failing test asserting the emitted `HookResult.payload.kind`, run, see FAIL, populate `payload` in the hook's return, run, see green, commit.

**Verification step before each hook update:** If a hook returns `decision: "pending_approval"` only in some branches, only the approval branch needs the payload. The non-approval branches keep their current return shape.

**Fallback for genuinely missing sources:** If `rg` at implementation time finds no concrete refund or escalation emitter (the brief verified safety-gate + claim-classifier exist; qualification + refund + escalation were unverified), the slice ships with the kinds that have producers and **flags the missing kinds in the PR description**. Per `[[ship-clean-not-followup]]`, this is not a violation — the schema enum + adapter handle those kinds whether or not all emitters wire them; absent emitters are honest about the gap, not deferred TODOs in code.

### 4. Verify `propose-pipeline.createApprovalRequest()` persistence

**File:** `packages/core/src/orchestrator/propose-pipeline.ts`

The pipeline that builds `ApprovalRequest` from a `ToolResult` must forward `result.error?.payload` into `ApprovalRequest.payload`. A.7c already extended `ApprovalRequestSchema` with optional `payload` (in `packages/schemas/src/chat.ts`); this slice verifies the build step actually populates it.

Inspect `createApprovalRequest()` at implementation time. If it currently sets `payload: undefined` or omits the field, update to:

```ts
const approvalRequest: ApprovalRequest = {
  // ...existing fields
  payload: toolResult.error?.payload,
};
```

Add a unit test asserting the round-trip: tool result with `error.payload.kind === "regulatory"` → built `ApprovalRequest.payload.kind === "regulatory"`.

### 5. End-to-end tests

The acceptance criterion is **non-pricing approval kinds render through the rich adapter without legacy fallback.** A unit test per hook is necessary but not sufficient. Add at least one end-to-end integration test that:

1. Invokes a hook that triggers `decision: "pending_approval"` (e.g., a fixture that fails `deterministic-safety-gate`).
2. Asserts the resulting persisted `ApprovalRequest.payload.kind` is `"safety-gate"`.
3. Asserts the `/api/approvals/pending` response includes `kind: "safety-gate"`.
4. Asserts `richPendingApprovalToApprovalView` produces an `AlexApprovalView` with `kind: "safety-gate"` (not `"pricing"` via fallback).

The natural location is `apps/api/src/__tests__/api-approvals.test.ts` (extended) or a new sibling integration test. The test seeds a hook configuration that fires the gate, runs a skill that triggers it, asserts the persisted shape, then queries the dashboard endpoint.

**Sequence-based assertion (preferred over end-to-end if too brittle):** if a full e2e run is fragile under the existing test harness, ship the slice with three layered tests:

- Unit: each hook → `HookResult.payload.kind` correct.
- Unit: `skill-executor.ts` with mocked `HookResult.payload` → `pendingApproval()` called with payload.
- Unit: `createApprovalRequest` with a `ToolResult` containing `error.payload` → `ApprovalRequest.payload` populated.

Three layered unit tests is the floor; one true end-to-end is the ceiling. The PR description names which level shipped.

---

## What does NOT ship in A.7c-followup

Explicit non-goals:

- ❌ **No new approval kinds.** The six-kind enum is locked at A.7c. A.7c-followup wires producers for the existing kinds; it does not add new ones.
- ❌ **No removal of the legacy fallback adapter.** `legacy-pending-approval-to-approval-view.ts` stays on disk for the cutover window. A post-A.7c-followup cleanup PR removes it once production has stabilized on the rich path (~24h after A.7c-followup merges + all in-flight pre-A.7c-followup approvals expire).
- ❌ **No `HookResult.payload` extension to non-approval branches.** The `decision: "denied"` and `decision: undefined` branches do not carry payloads. If future work needs richer denial reasons, that's a separate slice.
- ❌ **No retroactive payload backfill.** Approvals created pre-A.7c-followup keep `payload: null`; the rich adapter's fallback path handles them. No DB migration.
- ❌ **No emitter creation for kinds without sources.** If `rg` finds no concrete emitter for `refund` or `escalation`, those kinds remain unproduced until a future product slice introduces them. Per `[[ship-clean-not-followup]]`: honest gaps over fabricated emitters.
- ❌ **No coverage-threshold lowering.** Per `[[dashboard-coverage-threshold]]`: 40/35/40/40 floor; per `CLAUDE.md`: global 55/50/52/55. The slice halts if any threshold dips.
- ❌ **No spec amendment.** A.7c-followup closes a silently-unmet acceptance criterion. The spec is correct; the implementation drifted.

---

## Adapter-boundary invariant

The shared invariant from A.1–A.7c continues to hold:

> Cockpit UI consumes view-models only. Only files under `apps/dashboard/src/lib/cockpit/**` may import audit-domain types.

A.7c-followup operates **entirely on the producer side** — schemas, core, api. No dashboard files are modified. The adapter-boundary grep is trivially clean.

```bash
git diff origin/main..HEAD -- apps/dashboard/src/components/cockpit apps/dashboard/src/hooks
```

Expected: empty.

### Surface-agnostic backend invariant

Per `[[surface-agnostic-backend]]`: `core/schemas/db/ad-optimizer` must not reference UI surfaces. A.7c-followup edits live under `packages/schemas/src/`, `packages/core/src/skill-runtime/`, `packages/core/src/orchestrator/`, `packages/core/src/conversation-lifecycle/` (qualification), and `apps/api/src/` (tests only). No file references `/alex`, `/riley`, `cockpit`, etc.

```bash
git diff origin/main..HEAD -- packages/ apps/api apps/chat apps/mcp-server | \
  grep -E "^\+.*\b(cockpit|alex|riley)\b" | grep -v "test\|fixture"
```

Expected: empty.

---

## Dependencies

- ✅ A.7c rails merged (#563) — schema + `pendingApproval()` typed payload + `/api/approvals/pending` projection + wire type + rich adapter all on `main`.
- ✅ `PendingApprovalPayload` exported from `@switchboard/schemas`.
- ✅ `pendingApproval(message, payload?)` accepts the optional arg.
- ✅ `ApprovalRequestSchema.payload` optional field exists in `packages/schemas/src/chat.ts`.
- ❌ No spec amendment needed.
- ❌ Independent of Riley work, Mira work, Wave B Riley emitter (already shipping recommendations from Riley each Mon 09:00 UTC per `[[riley-wave-b-pr1-shipped]]`).

---

## Design decisions ratified by this slice

1. **A.7c-followup ships as one PR, not sliced.** The five pieces (HookResult contract, executor forward, hook wiring, pipeline persistence, tests) are tightly coupled. Splitting would leave half-cutover state where the runtime emits `payload.kind` from some sites but the executor ignores it.

2. **First-payload-wins merge strategy for `runBeforeToolCallHooks` aggregator.** Multiple hooks could each return `decision: "pending_approval"` with different payloads. The first one to return `decision: "pending_approval"` claims the kind; later hooks' payloads (if any) are ignored. Document this in the aggregator. Rationale: deterministic, matches existing `reason` semantics (whichever hook fires first claims the reason).

3. **Optional `payload` on `HookResult`, not required.** Backward-compat for hooks that don't yet know about typed payloads. Schema validates absence as legitimate (no `kind` → renders as `pricing` via fallback). No breaking change for downstream hook authors.

4. **Hook updates use TDD per hook.** Five hooks = five test-then-impl-then-commit cycles. One commit per hook. Mirrors the A.7a/A.7b/A.7c per-task commit discipline.

5. **End-to-end vs layered unit tests is implementation-decided.** If the existing test harness supports a clean e2e through a real hook → real executor → real persistence → real route response → real adapter, ship the e2e. If brittle, ship three layered unit tests (per §"5. End-to-end tests"). The PR description names what landed.

6. **Missing-emitter kinds are documented, not fabricated.** If `refund` or `escalation` have no concrete `decision: "pending_approval"` site in `packages/core/src/`, the slice ships with the kinds that do (`safety-gate`, `regulatory`, `qualification`) and the PR description flags the absent ones. Future product slices wire them when the feature lands. Per `[[ship-clean-not-followup]]`.

7. **The legacy fallback adapter stays on disk.** Until ~24h post-merge of A.7c-followup and after all in-flight approvals from before this PR expire, the legacy adapter handles row-views for approvals with `payload: null`. A separate post-A.7c-followup cleanup PR removes it. Same rationale as A.7c Design Decision §8.

8. **No spec amendment.** Critical #3 was a silently-unmet criterion, not a spec defect. The spec's six-kind taxonomy is correct.

---

## Risks specific to A.7c-followup

1. **Hook aggregator merge semantics are ambiguous.** If `runBeforeToolCallHooks` doesn't already document its conflict resolution, this slice introduces a new question: which hook's payload wins when two hooks both return `decision: "pending_approval"`? **Mitigation:** Design Decision §2 picks first-payload-wins; document in the aggregator + add a unit test for the merge case.

2. **`refund` and `escalation` emitter sites may not exist.** The A.7c subagent verified `safety-gate` + `regulatory` + `qualification` (verifying via grep at brief-write time would tighten this). **Mitigation:** Design Decision §6 + the PR description explicitly flags missing kinds; honest gap > fabricated emitter.

3. **`createApprovalRequest` may not forward `payload` today.** A.7c added the schema field but didn't verify that the pipeline populates it. **Mitigation:** Step §4 inspects the function at implementation time + the integration test asserts persistence end-to-end.

4. **Hook tests may use snapshot fixtures that capture `HookResult` shape.** Adding a new optional field shouldn't change snapshots, but it could if snapshots serialize the full object including `undefined` fields. **Mitigation:** run the test sweep early; if a snapshot breaks, regenerate it (the change is benign — optional field appears with `undefined`).

5. **Multiple pre-hook chains may need symmetric updates.** `runBeforeToolCallHooks` is the primary site; if `runBeforeSkillHooks` or `runBeforeLlmCallHooks` also synthesize `pendingApproval()`, they need the same forwarding. **Mitigation:** grep all `pendingApproval(` callsites at implementation time + extend each that consumes `HookResult`.

6. **The integration test fixture for end-to-end may need a full DB + Inngest mock.** Per `[[api-test-mocked-prisma]]`: api tests use mocked Prisma. The e2e might be too fragile to run reliably. **Mitigation:** Design Decision §5 — ship layered units if e2e is brittle.

7. **Dashboard coverage doesn't move** (no dashboard files modified). API + core coverage should hold or improve.

8. **`pnpm reset` mandatory.** A.7c-followup extends `HookResult` (a type in `packages/core`). Schemas package is unchanged but the core package gets a type change; downstream consumers (api, dashboard) typecheck against it. Per `CLAUDE.md`: "If `pnpm typecheck` reports missing exports — run `pnpm reset` first."

9. **CI prettier check + `pnpm format:check` per `[[ci-prettier-not-in-local-lint]]`.**

10. **Auto-merge captures stale HEAD.** Per `[[auto-merge-captures-head-early]]`: manual merge once green, not `--auto`.

---

## Test contract

- **Per-hook unit tests** (one per emitter wired): assert `HookResult.payload.kind === <expected>`.
- **`skill-executor.ts` unit test:** with mocked `runBeforeToolCallHooks` returning `{ decision: "pending_approval", payload: { kind: "regulatory" } }`, assert `pendingApproval(message, payload)` is called with the typed payload.
- **`tool-result.ts` test:** already shipped at A.7c (asserts `pendingApproval()` forwards payload to `ToolResult.error.payload`). Extend if the merge semantics test belongs here.
- **`createApprovalRequest` test:** with `ToolResult.error.payload.kind === "safety-gate"`, assert built `ApprovalRequest.payload.kind === "safety-gate"`.
- **`/api/approvals/pending` integration test:** already shipped at A.7c. Verify it still passes with the producer wiring (no regression).
- **End-to-end test OR three layered unit tests** per Design Decision §5.
- **Manual verification:** trigger a regulatory-claim flow on dev stack → confirm `/alex` renders a red-urgency regulatory card with regulatory CTA copy. Symmetric for each wired kind.

### Pre-merge gates

- `pnpm reset && pnpm typecheck && pnpm lint && pnpm test`
- `pnpm --filter @switchboard/dashboard build` (no dashboard changes, but baseline check per `[[dashboard-build-not-in-ci]]`)
- `pnpm format:check`
- Coverage: core ≥ 65/65/70/65 (per `CLAUDE.md` core-specific floor); dashboard unchanged
- Adapter-boundary grep: zero new audit-domain imports (no dashboard changes)
- Surface-agnostic backend grep: zero new UI-surface references
- Pre-existing flakes per `[[db-integrity-tests-pg-advisory-lock]]` documented as baseline noise

---

## What comes after A.7c-followup

- **Post-A.7c-followup cleanup PR** — delete `legacy-pending-approval-to-approval-view.ts` once all in-flight pre-A.7c-followup approvals have expired (~24h post-merge).
- **Missing-emitter follow-up** — if `refund` and/or `escalation` kinds shipped without producers, a future product slice introduces them when the feature lands. Tracked in the PR description, not as a TODO in code.
- **Phase-A close** — once A.7c-followup merges, **all four Criticals from the 2026-05-15 holistic review are closed at the operator level**. Alex Cockpit Phase A is feature- and correctness-complete. Update `MEMORY.md` accordingly.
- **Post-Phase-A Alex ramps** (deferred per umbrella spec, NOT part of this slice):
  - Auto-resume on `pause N(h)` — adds `pausedUntil` to `HaltProvider` + a scheduler.
  - `brief` / `followup` cron + delivery.
  - `TALKING` status pill wiring.
  - Thread-context wire-through from expanded activity rows to composer's `threadContext`.

---

## Implementation plan

The slice fits inside one focused PR. Tasks below are TDD-ordered.

### Boundary locks (read before every task)

1. **`pnpm reset` is mandatory after each `packages/` edit.** A.7c-followup touches `packages/core`. Without reset, downstream typechecks see stale dist.
2. **No dashboard touches.** A.7c-followup is producer-side. The dashboard already consumes `payload.kind` via A.7c's rich adapter.
3. **TDD discipline.** Failing test → expected failure → impl → green → commit. Per behavior change.
4. **No `--no-verify` or `--auto`.** Manual merge.
5. **Per `[[ship-clean-not-followup]]`:** if an emitter site doesn't exist, document in PR; don't fabricate.

### Precondition checks

- [ ] **Step 0a: Worktree + branch.** Branch: `feat/alex-cockpit-a7c-followup-typed-payload-emitters`, cut off current `origin/main` (which includes #560/#561/#563 + this docs PR's brief once it merges; if the impl PR opens before the docs PR merges, that's fine — implementation doesn't depend on the brief file being on `main`).
- [ ] **Step 0b: Verify A.7c is on `main`.** `grep "pendingApprovalPayloadSchema" packages/schemas/src/approval-lifecycle.ts` → matches. `grep "richPendingApprovalToApprovalView" apps/dashboard/src/components/cockpit/cockpit-page.tsx` → matches.
- [ ] **Step 0c: Verify `HookResult` shape (no `payload` field yet).** `grep -A6 "export interface HookResult" packages/core/src/skill-runtime/types.ts` → confirms no `payload` field today.
- [ ] **Step 0d: Locate emitter sites.**
  - `safety-gate` + `regulatory`: verified at brief-time in `packages/core/src/skill-runtime/hooks/{deterministic-safety-gate,claim-classifier}.ts`. Confirm each returns `{ proceed: false, decision: "pending_approval", reason: ... }`.
  - `qualification`: `rg "decision.*pending_approval" packages/core/src/conversation-lifecycle/qualification/`. If empty, expand search to `packages/core/src/skill-runtime/hooks/` — qualification may have moved.
  - `refund`: `rg "decision.*pending_approval" packages/core/src/ | xargs grep -l refund`. If empty, document gap.
  - `escalation`: `rg "decision.*pending_approval" packages/core/src/ | xargs grep -l escalat`. If empty, document gap.
- [ ] **Step 0e: Locate `createApprovalRequest`.** `grep -rn "createApprovalRequest" packages/core/src/orchestrator/`. Read it; identify whether it currently forwards `error.payload`.
- [ ] **Step 0f: Baseline tests pass.** `pnpm reset && pnpm typecheck && pnpm lint && pnpm test`. Pre-existing flakes per `[[db-integrity-tests-pg-advisory-lock]]` documented as baseline.

### Task 1: Extend `HookResult` (TDD)

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`
- Modify: `packages/core/src/skill-runtime/__tests__/types.test.ts` (if it exists; otherwise the HookResult shape is tested transitively via hook tests)

- [ ] **Step 1.1: Write failing type-shape test.**

If a `types.test.ts` doesn't exist, add a minimal one. Alternative: add the assertion to an existing hook test that constructs `HookResult` literal objects.

```ts
import type { HookResult } from "../types.js";
import type { PendingApprovalPayload } from "@switchboard/schemas";

describe("HookResult", () => {
  it("accepts optional typed payload alongside decision", () => {
    const r: HookResult = {
      proceed: false,
      decision: "pending_approval",
      reason: "Requires regulatory review",
      payload: { kind: "regulatory", body: "Patient asked about FDA approval status." },
    };
    expect(r.payload?.kind).toBe("regulatory");
  });
});
```

- [ ] **Step 1.2: Run, see FAIL** (`payload` not in HookResult).

```bash
pnpm --filter @switchboard/core test -- types.test
```

- [ ] **Step 1.3: Implement.**

```ts
// packages/core/src/skill-runtime/types.ts
import type { PendingApprovalPayload } from "@switchboard/schemas";

export interface HookResult {
  proceed: boolean;
  reason?: string;
  decision?: "denied" | "pending_approval";
  substituteResult?: ToolResult;
  /**
   * Typed payload forwarded to ToolResult.error.payload when
   * decision === "pending_approval". Absent payload preserves
   * legacy behavior (renders as kind: "pricing" via fallback).
   */
  payload?: PendingApprovalPayload;
}
```

- [ ] **Step 1.4: Run, see green. Run `pnpm reset && pnpm typecheck` to confirm downstream packages still compile.**

- [ ] **Step 1.5: Commit.**

```bash
git commit -m "feat(core): extend HookResult with optional typed payload (A.7c-followup)

Forward-compat field. Hooks that don't populate payload preserve
legacy behavior (approval renders as kind: 'pricing' via the rich
adapter's fallback path). Hooks that emit kind/body/quote/quoteFrom
will have those forwarded by skill-executor.ts in the next commit."
```

### Task 2: Forward payload in `skill-executor.ts` (TDD)

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts:376`
- Modify: `packages/core/src/skill-runtime/__tests__/skill-executor.test.ts`

- [ ] **Step 2.1: Write failing test.**

```ts
it("forwards HookResult.payload to pendingApproval when decision is pending_approval", async () => {
  const hookResult: HookResult = {
    proceed: false,
    decision: "pending_approval",
    reason: "Requires regulatory review",
    payload: { kind: "regulatory", body: "FDA approval question" },
  };
  // Construct an executor with a mocked beforeToolCall hook returning hookResult
  // ... (adapt to existing test harness)
  const result = await executeToolCall(/* ... */);
  expect(result.status).toBe("pending_approval");
  expect((result.error as any).payload?.kind).toBe("regulatory");
});
```

- [ ] **Step 2.2: Run, see FAIL.**
- [ ] **Step 2.3: Implement.**

Edit `packages/core/src/skill-runtime/skill-executor.ts:375-377`:

```ts
} else if (toolHookResult.decision === "pending_approval") {
  result = pendingApproval(
    toolHookResult.reason ?? "Requires approval",
    toolHookResult.payload,
  );
}
```

- [ ] **Step 2.4: Run, see green.**
- [ ] **Step 2.5: Audit other pre-hook chains.** `grep -n "pendingApproval(" packages/core/src/skill-runtime/`. For each callsite that consumes a `HookResult.decision === "pending_approval"`, apply the same forwarding. Document in commit body.
- [ ] **Step 2.6: Commit.**

### Task 3a–3e: Wire the five hook sources

Each is a 5-step TDD cycle. Per hook:

- [ ] **Step Xa.1: Read hook + its colocated test.**
- [ ] **Step Xa.2: Write failing test asserting `HookResult.payload.kind === <kind>` (and `payload.body` if applicable).**
- [ ] **Step Xa.3: Run, see FAIL.**
- [ ] **Step Xa.4: Update the hook's return to populate `payload`.**

Example for `deterministic-safety-gate.ts`:

```ts
// Before:
return { proceed: false, decision: "pending_approval", reason: msg };
// After:
return {
  proceed: false,
  decision: "pending_approval",
  reason: msg,
  payload: { kind: "safety-gate" },
};
```

Example for `claim-classifier.ts`:

```ts
return {
  proceed: false,
  decision: "pending_approval",
  reason: `Regulatory: ${claim}`,
  payload: { kind: "regulatory", body: claim },
};
```

- [ ] **Step Xa.5: Run, see green. Commit.**

### Task 4: Verify `createApprovalRequest()` forwards payload (TDD)

**Files:**

- Modify: `packages/core/src/orchestrator/propose-pipeline.ts` (if it doesn't currently forward `payload`)
- Modify: `packages/core/src/orchestrator/__tests__/propose-pipeline.test.ts` (or equivalent)

- [ ] **Step 4.1: Inspect `createApprovalRequest()`** (path verified at Step 0e). If it already reads `toolResult.error?.payload`, jump to Step 4.5 (add test only).
- [ ] **Step 4.2: Write failing test.**

```ts
it("forwards ToolResult.error.payload into ApprovalRequest.payload", () => {
  const toolResult: ToolResult = {
    status: "pending_approval",
    error: {
      code: "APPROVAL_REQUIRED",
      message: "Regulatory review",
      retryable: false,
      payload: { kind: "regulatory", body: "FDA question" },
    },
  };
  const req = createApprovalRequest(/* args */, toolResult);
  expect(req.payload?.kind).toBe("regulatory");
  expect(req.payload?.body).toBe("FDA question");
});
```

- [ ] **Step 4.3: Run, see FAIL** (if payload isn't forwarded).
- [ ] **Step 4.4: Implement.**

```ts
const approvalRequest: ApprovalRequest = {
  // ...existing fields
  payload: toolResult.error?.payload,
};
```

- [ ] **Step 4.5: Run, see green. Commit.**

### Task 5: End-to-end test OR layered unit tests

Per Design Decision §5, choose:

**Path A (preferred if harness supports):** one end-to-end test.

- Seed a hook configuration in `apps/api/src/__tests__/api-approvals.test.ts` that triggers `deterministic-safety-gate`.
- Execute a skill that hits the gate.
- Assert `Approval.payload.kind === "safety-gate"` in the persisted record.
- Query `/api/approvals/pending`, assert response includes `kind: "safety-gate"`.
- (Optional) Construct `richPendingApprovalToApprovalView(response.approvals[0])` and assert `kind: "safety-gate"`.

**Path B (fallback if e2e is brittle):** three layered unit tests already covered by Tasks 2 + 3 + 4.

Document choice in PR description.

### Task 6: Pre-merge gates

- [ ] **Step 6.1: Branch context.** `git branch --show-current` matches `feat/alex-cockpit-a7c-followup-typed-payload-emitters`. `git status --short` clean.
- [ ] **Step 6.2: Full sweep.** `pnpm reset && pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 6.3: Dashboard baseline.** `pnpm --filter @switchboard/dashboard build` (no dashboard changes; sanity check).
- [ ] **Step 6.4: Format.** `pnpm format:check`.
- [ ] **Step 6.5: Coverage.** Core ≥ 65/65/70/65 per `CLAUDE.md`.
- [ ] **Step 6.6: Adapter-boundary grep.** `git diff origin/main..HEAD -- apps/dashboard/` → empty.
- [ ] **Step 6.7: Surface-agnostic grep.** `git diff origin/main..HEAD -- packages/ apps/api apps/chat apps/mcp-server | grep -E "^\+.*\b(cockpit|alex|riley)\b"` → empty (test fixtures may reference `alex` as `agentId`; inspect each match).
- [ ] **Step 6.8: Manual.** Trigger a regulatory-claim flow on dev stack → `/alex` renders red-urgency regulatory card with regulatory CTA copy. Symmetric for safety-gate (and any other wired kinds).

### Task 7: Push + open PR

- [ ] `git push -u origin feat/alex-cockpit-a7c-followup-typed-payload-emitters`
- [ ] `gh pr create --base main --title "feat(core): A.7c-followup — typed pending approval payload emitters" --body "..."`. Body references this brief + parent PR #563, lists wired kinds, flags missing kinds (if any), names test approach (Path A or B). DO NOT use `--auto`.
- [ ] After CI green, manual `gh pr merge --squash --delete-branch`.
- [ ] Update `MEMORY.md`: mark Critical #3 fully closed; mark Alex Cockpit Phase A correctness-complete.

---

## Spec-conflict resolution

None expected. A.7c-followup closes a silently-unmet acceptance criterion; the spec is correct. If implementation reveals a spec defect (e.g., the spec expects a kind that has no semantic source in the runtime), the brief re-opens.

---

## Reference

Holistic code review run 2026-05-15 against `main` at `4ec91ccf` flagged Critical #3 as silently unmet. A.7c rails landed at PR #563 (squash to be recorded once merged) on 2026-05-15 with the explicit deferral of producer wiring to this slice. The A.7c subagent's verification — that hooks signal via `HookResult.decision` not `pendingApproval()` direct calls — is the load-bearing finding behind this brief.

Related: [[alex-cockpit-a7-followup-scope]] (Critical #3 origin), [[verify-against-codebase]] (the A.7c subagent's discipline; same applies here), [[ship-clean-not-followup]] (sober reminder: this slice exists because A.7c shipped rails-only; A.7c-followup closes the loop honestly).
