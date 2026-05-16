# Alex SG/MY Medspa — Phase 3b Implementation Plan: LLM Qualification Sidecar + Operator-Confirmed Disqualification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the qualification + disqualification layer atop Phase 3a's mechanical lifecycle — a strict `<qualification_signals>{...}</qualification_signals>` sidecar emitted by Alex on each turn, a deterministic rule that decides `qualified`, system-proposed disqualifications that require operator confirmation, and a minimal operator review panel. Behind sub-flag `alexMedspaSgMyGovernanceV1.lifecycleTagging.qualification`, default off.

**Architecture:** New `QualificationSignalsSchema` in `packages/schemas`; new `qualificationSignals?` field on `SkillExecutionResult` (precedent: 1d's `intentClass?`); sidecar parser in `packages/core/src/skill-runtime/qualification-sidecar-parser.ts` invoked from `SkillExecutor` post-output; raw + validation status persisted on `WorkTrace.qualificationSignals` (new TEXT column). Lifecycle evaluator (deterministic rule, treatment resolution against `Playbook.services`) and disqualification resolver (operator confirm/dismiss state machine) in `packages/core/src/conversation-lifecycle/qualification/`. `LifecycleWriter` refactored to capability-aware allowlists (`mechanical`, `qualification`) replacing the 3a-named constants; gains an `updateQualificationStatus` method for mutations that change `qualificationStatus` without advancing `currentState`. Two new event hooks register in `apps/api/src/bootstrap/lifecycle.ts` under the qualification sub-flag. New REST routes under `apps/api/src/routes/lifecycle-disqualifications.ts`. Minimal Server Component panel on existing `/operator` page in `apps/dashboard`. Skill prompt + SKILL.md updated for Alex.

**Tech Stack:** TypeScript ESM, Zod, Vitest, Prisma, Fastify, Next.js 14 App Router (Server Components + React Query). No new infra. Follows 3a's `LifecycleWriter` + `LifecycleConfigResolver` + `InMemoryGovernancePostureCache` patterns.

**Spec:** [`docs/superpowers/specs/2026-05-12-alex-medspa-phase-3b-llm-qualification-design.md`](../specs/2026-05-12-alex-medspa-phase-3b-llm-qualification-design.md)

**Parent spec:** [`docs/superpowers/specs/2026-05-12-alex-medspa-phase-3-conversation-lifecycle-design.md`](../specs/2026-05-12-alex-medspa-phase-3-conversation-lifecycle-design.md)

**Prerequisites on `main`:**

Hard prerequisites (3b will not build/test without these):

- Phase 1a (#409), 1b-1 (#429), 1b-2 (#431), 1c (#435)
- Phase 3a — mechanical lifecycle (merged 2026-05-12; commits `af521fdd`, `c29d9549`, `61ac7ad0`)
- Phase 3 design spec + Phase 3a plan — docs PR on its way to main (`worktree-docs+alex-medspa-phase-3-spec`)
- Phase 3b design spec — docs PR on its way to main (`worktree-docs+alex-medspa-phase-3b-spec`)

Soft prerequisite (only for cross-phase test fixtures):

- Phase 1d — WhatsApp window gate + template registry. **Not** required for 3b's core implementation. 1d only matters for cross-phase re-engagement/template integration tests; 3b's qualification + disqualification surface stands alone on 3a's mechanical lifecycle. If 1d hasn't shipped yet, omit cross-phase 1d fixtures from Task 18 and document this in the PR body.

**Out of scope for Phase 3b (deferred — do not bleed in):**

- Recommendations v1 integration (knowledge-gap, drop-off, re-engagement effectiveness, disqualification load) — Phase 3c
- Outbound gating by `qualified` status (observation-only per spec §1)
- Auto-disqualification (operator-confirmed only per spec §1)
- Confidence tiers (`qualified_low/medium/high`) — binary v1
- Contact-level lifecycle (thread-level only)
- Alex Home v2 wiring (separate follow-up PR consuming 3b's API)
- Phase 3a's five deferred hook seats (5a–5e) — each lands as separate small PRs to main
- `PlaybookService.aliases[]` — name-only matching in 3b; aliases deferred until 3c's knowledge-gap data identifies common variants

---

## Pre-flight discovery

**Read before Task 1.** These ground the plan in observed code state.

1. **`PlaybookService` has no `aliases[]` field today.** Schema (`packages/schemas/src/playbook.ts`) defines `{ id, name, price, duration, bookingBehavior, details, status, source }`. Spec §5.1 says `treatmentInterest` must resolve to a "BusinessFacts service or alias". For 3b: match by `Playbook.services[].name` (case-insensitive, exact equality on trimmed strings). Unresolved free-text names leave qualification at its prior value and are surfaced via 3c's knowledge-gap recommendations. Adding `aliases?: z.array(z.string())` is a 3c follow-up once we have data on common variants.
2. **Services live on `Playbook`, not on `BusinessFacts`.** The spec refers to "BusinessFacts services" — the concrete location is `Playbook.services[]`. `PlaybookBusinessFacts` is a separate object containing `serviceArea`, `contactPreference`, etc. The plan resolves against `Playbook.services`. Cross-reference any spec mentions of "BusinessFacts services" to mean `Playbook.services` operationally.
3. **`SkillExecutionResult` is at `packages/core/src/skill-runtime/types.ts:93`.** Existing optional field: `intentClass?: IntentClass` (1d precedent). Phase 3b adds `qualificationSignals?: ParsedQualificationSidecar | null` adjacent to it.
4. **3a's allowlist constants are named `THREE_A_ALLOWED_STATES` / `THREE_A_ALLOWED_TRIGGERS`** in `packages/core/src/conversation-lifecycle/constants.ts`. Task 6 renames them to `MECHANICAL_ALLOWED_STATES` / `MECHANICAL_ALLOWED_TRIGGERS` and adds `QUALIFICATION_ALLOWED_STATES` / `QUALIFICATION_ALLOWED_TRIGGERS`. The rename is purely refactoring — no value changes. All call sites update in the same commit.
5. **`LifecycleWriter` lives at `packages/core/src/conversation-lifecycle/lifecycle-writer.ts`** and currently throws if `toState` or `trigger` is outside the 3a allowlist. Task 7 refactors this to a `capabilities: Set<LifecycleWriteCapability>` parameter on the writer's deps, computes the allowed union per-call, and adds `updateQualificationStatus(input)` as a second public method. The existing `recordTransition` method stays — but its allowlist now checks the union.
6. **`Playbook` is resolved per-org through `apps/api/src/services/playbook-service.ts` (likely) or via a `PlaybookStore` in `packages/db`.** Task 8's treatment resolver depends on a `PlaybookReader` interface that core declares and db implements. Pre-flight in Task 8 includes a 5-minute discovery step to locate the existing playbook reader / store and re-use it; **do not** create a duplicate.
7. **`WorkTrace` model is at `packages/db/prisma/schema.prisma` (search for `model WorkTrace`).** It already uses `String? @db.Text` for JSON-encoded columns (`parameters`, `governanceConstraints`). Task 4 adds `qualificationSignals  String? @db.Text` following the same convention.
8. **Postgres may not be reachable in the implementation environment.** Per `feedback_prisma_migrate_dev_tty.md`, generate the migration with `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel packages/db/prisma/schema.prisma --script` if a live DB is available, or by hand against the column ALTER if not. `pnpm db:generate` must succeed regardless.
9. **`pnpm reset` before Task 1** — clears stale Prisma client and dist; avoids spurious "missing exports from @switchboard/schemas" errors that masquerade as real bugs. Per `MEMORY.md`.

---

## Plan hardening notes

These rules apply across all tasks. Load-bearing for clean execution.

- **No `console.log`.** Use `console.warn` for soft conditions (parser fell through to validation-error path, treatment unresolved). Use `console.error` for unexpected branches (capability gate violation hit by an internal caller). Lint will flag `console.log`.
- **No production `any`.** All reader, writer, parser, evaluator, and hook types are explicitly typed. Test-only narrow casts (`as any` with `eslint-disable-next-line @typescript-eslint/no-explicit-any` on the same line) are permitted in `__tests__/*` files for Prisma mocking, bounded to mock construction.
- **Layer rules** (CLAUDE.md):
  - `packages/schemas` (Layer 1): no `@switchboard/*` imports.
  - `packages/core` (Layer 3): imports schemas + sdk + cartridge-sdk only — **never** `packages/db`.
  - `packages/db` (Layer 4): imports schemas + core; implements core interfaces.
  - `apps/*` (Layer 5): may import anything.
- **Tests use mocked Prisma.** Per `feedback_api_test_mocked_prisma.md`, all `packages/db` adapter tests mock the Prisma client. CI has no Postgres; `pnpm test` must pass without one.
- **`pnpm db:check-drift` requires running PostgreSQL.** If unreachable, follow 3a's pattern — skip locally, document in PR body. At minimum `pnpm db:generate` must succeed after schema edits.
- **All qualification-state mutations go through `LifecycleWriter`.** No code outside `packages/core/src/conversation-lifecycle/` writes to `ConversationLifecycleSnapshot.qualificationStatus` or appends to `ConversationLifecycleTransition` for qualification triggers. Operator confirm/dismiss API handlers call into the lifecycle layer, not Prisma directly.
- **Sidecar parsing/stripping is always-on; lifecycle mutation is flag-gated.** Per spec §7.1: `SkillExecutor` always parses, always strips the block from the user-visible response, and always persists the validation status on `WorkTrace.qualificationSignals` — regardless of `lifecycleTagging.qualification` flag state. Only the lifecycle evaluator's snapshot/transition writes are flag-gated. Asserted by Task 5 (parse-always test) and Task 11 (flag-off no-op test).
- **Monotonic qualificationStatus.** Per spec §5.2: `qualified → unqualified` is never permitted from sidecar evaluation. `proposed_disqualified` is never overwritten by a normal sidecar. The writer enforces these in `updateQualificationStatus` via a deterministic state-table; violations are silent no-ops (expected behavior for thin sidecars on already-qualified threads).
- **Capability violations are loud.** A `mechanical`-only writer asked to emit `qualified` throws `LifecycleCapabilityDenied`. Tests assert the throw. This catches accidental 3a-code-paths-emit-3b-values regressions.
- **`prior_qualification_status` lives in transition evidence.** When `system_proposed_disqualification` writes, evidence captures the snapshot's `qualificationStatus` at write-time so dismiss can restore deterministically (spec §5.3). No new column on the snapshot.
- **Pending-disqualification queries use the doctrine predicate** `qualificationStatus = 'proposed_disqualified' AND currentState != 'disqualified'` (spec §8.1). The plan introduces a single `isPendingDisqualification(snapshot)` helper in `packages/core/src/conversation-lifecycle/qualification/predicates.ts`; all readers reuse it.
- **`/operator` panel is a Server Component** that fetches from `/api/dashboard/lifecycle/disqualifications/pending`. Confirm/Dismiss client-side mutations use React Query (existing dashboard pattern). Optimistic update + revalidate on success. Tests use Vitest + React Testing Library (existing dashboard pattern).
- **Feature flag read per call**, not cached at process start. Per 3a's hardening note.
- **`pnpm --filter @switchboard/dashboard build` before declaring dashboard task complete.** Per `feedback_dashboard_build_not_in_ci.md`, CI runs lint+typecheck but not `next build`; missing `.js` extensions slip past without a local build. Task 13 includes the build step.

---

## File structure

**`packages/schemas/` (Layer 1):**

- `src/qualification-signals.ts` — NEW. `QualificationSignalsSchema`, `QualificationSidecarValidationStatusSchema`, `WorkTraceQualificationSignalsSchema` (the persisted union shape).
- `src/governance-config.ts` — EDIT. Extend `lifecycleTagging` with `qualification: { mode: "off" | "on" }` sub-block + `resolveLifecycleQualificationConfig` helper.
- `src/index.ts` — EDIT. Re-export new types.
- `src/__tests__/qualification-signals.test.ts` — NEW.
- `src/__tests__/governance-config-lifecycle.test.ts` — EDIT. Extend with qualification sub-flag round-trip.

**`packages/core/`:**

- `src/skill-runtime/types.ts` — EDIT. Add `qualificationSignals?: ParsedQualificationSidecar | null` to `SkillExecutionResult`. Add local type alias.
- `src/skill-runtime/qualification-sidecar-parser.ts` — NEW. Strict trailing-block parser, returns `{ visibleResponse, persisted: WorkTraceQualificationSignals }`.
- `src/skill-runtime/__tests__/qualification-sidecar-parser.test.ts` — NEW.
- `src/skill-runtime/skill-executor.ts` — EDIT. Invoke parser post-LLM-output; pass `persisted` to WorkTrace write; attach `parsed.payload` to result if `validationStatus === "ok"`.
- `src/skill-runtime/__tests__/skill-executor-qualification.test.ts` — NEW.
- `src/conversation-lifecycle/constants.ts` — EDIT. Rename `THREE_A_ALLOWED_*` to `MECHANICAL_ALLOWED_*`; add `QUALIFICATION_ALLOWED_*`; add `LifecycleWriteCapability` type re-export.
- `src/conversation-lifecycle/types.ts` — EDIT. Add `LifecycleWriteCapability`, `UpdateQualificationInput`, extend `LifecycleWriterDeps` with `resolveCapabilities`.
- `src/conversation-lifecycle/errors.ts` — EDIT. Add `LifecycleCapabilityDenied` error class.
- `src/conversation-lifecycle/lifecycle-writer.ts` — EDIT. Capability-aware allowlist; new `updateQualificationStatus` method; monotonic guard.
- `src/conversation-lifecycle/__tests__/lifecycle-writer-capabilities.test.ts` — NEW.
- `src/conversation-lifecycle/__tests__/lifecycle-writer-qualification.test.ts` — NEW.
- `src/conversation-lifecycle/qualification/qualification-rule-evaluator.ts` — NEW.
- `src/conversation-lifecycle/qualification/treatment-resolver.ts` — NEW.
- `src/conversation-lifecycle/qualification/disqualification-resolver.ts` — NEW.
- `src/conversation-lifecycle/qualification/predicates.ts` — NEW. `isPendingDisqualification(snapshot)`.
- `src/conversation-lifecycle/qualification/__tests__/qualification-rule-evaluator.test.ts` — NEW.
- `src/conversation-lifecycle/qualification/__tests__/treatment-resolver.test.ts` — NEW.
- `src/conversation-lifecycle/qualification/__tests__/disqualification-resolver.test.ts` — NEW.
- `src/conversation-lifecycle/qualification/__tests__/predicates.test.ts` — NEW.
- `src/conversation-lifecycle/event-hooks/qualification-evaluation-hook.ts` — NEW.
- `src/conversation-lifecycle/event-hooks/disqualification-resolution-hook.ts` — NEW.
- `src/conversation-lifecycle/event-hooks/__tests__/qualification-evaluation-hook.test.ts` — NEW.
- `src/conversation-lifecycle/event-hooks/__tests__/disqualification-resolution-hook.test.ts` — NEW.
- `src/conversation-lifecycle/lifecycle-config-resolver.ts` — EDIT. Resolve qualification sub-flag → capability set.
- `src/conversation-lifecycle/__tests__/lifecycle-config-resolver-qualification.test.ts` — NEW.
- `src/conversation-lifecycle/index.ts` — EDIT. Re-export new modules.

**`packages/db/`:**

- `prisma/schema.prisma` — EDIT. Add `qualificationSignals  String? @db.Text` to `WorkTrace`.
- `prisma/migrations/<ts>_alex_medspa_3b_qualification/migration.sql` — NEW.
- `src/prisma-work-trace-store.ts` — EDIT. Persist + read the new column.
- `src/prisma-playbook-reader.ts` (or existing reader) — EDIT or REUSE per Pre-flight #6.
- `src/__tests__/prisma-work-trace-store-qualification.test.ts` — NEW.

**`apps/api/`:**

- `src/bootstrap/lifecycle.ts` — EDIT. Register the two new hooks under the qualification capability.
- `src/bootstrap/__tests__/lifecycle-qualification.test.ts` — NEW.
- `src/routes/lifecycle-disqualifications.ts` — NEW. GET pending, POST confirm, POST dismiss.
- `src/__tests__/api-lifecycle-disqualifications.test.ts` — NEW.

**`apps/dashboard/`:**

- `src/app/(auth)/operator/_components/proposed-disqualifications-panel.tsx` — NEW. Server Component.
- `src/app/(auth)/operator/_components/disqualification-row.tsx` — NEW. Client Component (Confirm/Dismiss buttons).
- `src/app/(auth)/operator/page.tsx` — EDIT. Mount the panel under the existing operator queue.
- `src/app/(auth)/operator/__tests__/proposed-disqualifications-panel.test.tsx` — NEW.
- `src/app/api/dashboard/lifecycle/disqualifications/route.ts` — NEW. Proxy to api/.
- `src/app/api/dashboard/lifecycle/disqualifications/[threadId]/[action]/route.ts` — NEW. Proxy to api/.
- `src/hooks/use-pending-disqualifications.ts` — NEW. React Query hook.
- `src/hooks/use-resolve-disqualification.ts` — NEW. React Query mutation hook.

**`skills/alex/`:**

- `SKILL.md` — EDIT. Add a `## Qualification signal sidecar` section documenting the exact tag format, schema, emission rule.
- `references/regulatory/sg-rules.md` — EDIT. Brief "Phase 3b observation" note.
- `references/regulatory/my-rules.md` — EDIT. Same.

**Documentation:**

- `CLAUDE.md` — no change in 3b (architectural rules unchanged).

---

## Tasks

### Task 0: Pre-flight workspace setup

**Files:** none modified; commands only.

- [ ] **Step 1: Verify branch context**

```bash
git branch --show-current
git status --short
git log --oneline -5
```

Expected: on `feat/alex-medspa-phase-3b` worktree, clean status, recent commits show 3a merged (`61ac7ad0` or later main tip).

- [ ] **Step 2: Confirm spec + plan committed on main**

```bash
ls docs/superpowers/specs/2026-05-12-alex-medspa-phase-3b-llm-qualification-design.md
ls docs/superpowers/plans/2026-05-12-alex-medspa-phase-3b-llm-qualification.md
```

Expected: both files exist on the current branch.

- [ ] **Step 3: Reset the workspace**

```bash
pnpm reset
```

Expected: completes without error. Clears stale Prisma client + dist; rebuilds schemas → core → db.

- [ ] **Step 4: Baseline test/typecheck**

```bash
pnpm test
pnpm typecheck
```

Expected: both green. Document any pre-existing flakes in the PR body (per `feedback_db_integrity_tests_pg_advisory_lock.md`).

No commit at this step — pre-flight only.

---

### Task 1: Schema — `QualificationSignals` and persisted-shape types

**Files:**
- Create: `packages/schemas/src/qualification-signals.ts`
- Create: `packages/schemas/src/__tests__/qualification-signals.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/src/__tests__/qualification-signals.test.ts
import { describe, expect, it } from "vitest";
import {
  QualificationSignalsSchema,
  QualificationSidecarValidationStatusSchema,
  WorkTraceQualificationSignalsSchema,
} from "../qualification-signals.js";

describe("QualificationSignalsSchema", () => {
  const valid = {
    treatmentInterest: "HIFU",
    preferredTimeWindow: "weekday evenings",
    serviceableMarket: "SG" as const,
    buyingIntent: "soft" as const,
    budgetAcknowledged: null,
    explicitDecline: false,
    disqualifierCandidates: [],
  };

  it("accepts a fully-populated payload", () => {
    expect(QualificationSignalsSchema.parse(valid)).toEqual(valid);
  });

  it("accepts nulls on optional-ish fields", () => {
    const payload = { ...valid, treatmentInterest: null, preferredTimeWindow: null };
    expect(QualificationSignalsSchema.parse(payload).treatmentInterest).toBeNull();
  });

  it("rejects unknown serviceableMarket values", () => {
    expect(() =>
      QualificationSignalsSchema.parse({ ...valid, serviceableMarket: "TH" }),
    ).toThrow();
  });

  it("rejects unknown buyingIntent values", () => {
    expect(() => QualificationSignalsSchema.parse({ ...valid, buyingIntent: "maybe" })).toThrow();
  });

  it("caps disqualifierCandidates at 4 entries", () => {
    const tooMany = Array.from({ length: 5 }, () => ({ type: "out_of_area", evidence: "x" }));
    expect(() =>
      QualificationSignalsSchema.parse({ ...valid, disqualifierCandidates: tooMany }),
    ).toThrow();
  });

  it("caps evidence string at 280 chars", () => {
    const long = "x".repeat(281);
    expect(() =>
      QualificationSignalsSchema.parse({
        ...valid,
        disqualifierCandidates: [{ type: "out_of_area", evidence: long }],
      }),
    ).toThrow();
  });

  it("requires evidence to be non-empty", () => {
    expect(() =>
      QualificationSignalsSchema.parse({
        ...valid,
        disqualifierCandidates: [{ type: "out_of_area", evidence: "" }],
      }),
    ).toThrow();
  });
});

describe("QualificationSidecarValidationStatusSchema", () => {
  it("enumerates ok, multiple_blocks, malformed_json, schema_mismatch", () => {
    for (const s of ["ok", "multiple_blocks", "malformed_json", "schema_mismatch"]) {
      expect(QualificationSidecarValidationStatusSchema.parse(s)).toBe(s);
    }
    expect(() => QualificationSidecarValidationStatusSchema.parse("ok_ish")).toThrow();
  });
});

describe("WorkTraceQualificationSignalsSchema", () => {
  it("accepts the ok shape with a parsed payload", () => {
    const ok = {
      validationStatus: "ok" as const,
      payload: {
        treatmentInterest: "HIFU",
        preferredTimeWindow: null,
        serviceableMarket: "SG" as const,
        buyingIntent: "strong" as const,
        budgetAcknowledged: null,
        explicitDecline: false,
        disqualifierCandidates: [],
      },
    };
    expect(WorkTraceQualificationSignalsSchema.parse(ok)).toEqual(ok);
  });

  it("accepts the multiple_blocks shape with raw text", () => {
    const m = { validationStatus: "multiple_blocks" as const, raw: "<tag>x</tag><tag>y</tag>" };
    expect(WorkTraceQualificationSignalsSchema.parse(m)).toEqual(m);
  });

  it("accepts the malformed_json shape with raw text", () => {
    const m = { validationStatus: "malformed_json" as const, raw: "<tag>{not json}</tag>" };
    expect(WorkTraceQualificationSignalsSchema.parse(m)).toEqual(m);
  });

  it("accepts the schema_mismatch shape with raw + zodError", () => {
    const m = {
      validationStatus: "schema_mismatch" as const,
      raw: "<tag>{}</tag>",
      zodError: { issues: [{ path: ["buyingIntent"], message: "Required" }] },
    };
    expect(WorkTraceQualificationSignalsSchema.parse(m)).toEqual(m);
  });

  it("rejects an ok shape missing payload", () => {
    expect(() =>
      WorkTraceQualificationSignalsSchema.parse({ validationStatus: "ok" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/qualification-signals.test.ts`
Expected: FAIL with "Cannot find module '../qualification-signals.js'"

- [ ] **Step 3: Write the schema module**

```ts
// packages/schemas/src/qualification-signals.ts
import { z } from "zod";

export const QualificationSignalsSchema = z.object({
  treatmentInterest: z.string().nullable(),
  preferredTimeWindow: z.string().nullable(),
  serviceableMarket: z.enum(["SG", "MY", "unknown", "out_of_area"]),
  buyingIntent: z.enum(["none", "soft", "strong"]),
  budgetAcknowledged: z.boolean().nullable(),
  explicitDecline: z.boolean(),
  disqualifierCandidates: z
    .array(
      z.object({
        type: z.enum(["out_of_area", "wrong_treatment", "age_gated", "not_real_lead"]),
        evidence: z.string().min(1).max(280),
      }),
    )
    .max(4),
});
export type QualificationSignals = z.infer<typeof QualificationSignalsSchema>;

export const QualificationSidecarValidationStatusSchema = z.enum([
  "ok",
  "multiple_blocks",
  "malformed_json",
  "schema_mismatch",
]);
export type QualificationSidecarValidationStatus = z.infer<
  typeof QualificationSidecarValidationStatusSchema
>;

/**
 * The shape persisted on `WorkTrace.qualificationSignals` (JSON-encoded TEXT).
 *
 * - `ok` carries the validated payload (consumed by lifecycle evaluator).
 * - `multiple_blocks` / `malformed_json` / `schema_mismatch` carry raw text for
 *   audit replay and a structured discriminant for analytics over sidecar quality.
 *
 * Operational queues MUST NOT scan this column — they query
 * `ConversationLifecycleSnapshot` / `ConversationLifecycleTransition` instead
 * (spec §4.4, §8.1).
 */
export const WorkTraceQualificationSignalsSchema = z.discriminatedUnion("validationStatus", [
  z.object({ validationStatus: z.literal("ok"), payload: QualificationSignalsSchema }),
  z.object({ validationStatus: z.literal("multiple_blocks"), raw: z.string() }),
  z.object({ validationStatus: z.literal("malformed_json"), raw: z.string() }),
  z.object({
    validationStatus: z.literal("schema_mismatch"),
    raw: z.string(),
    zodError: z.unknown(),
  }),
]);
export type WorkTraceQualificationSignals = z.infer<typeof WorkTraceQualificationSignalsSchema>;
```

- [ ] **Step 4: Re-export from the package barrel**

```ts
// packages/schemas/src/index.ts — add to existing exports
export * from "./qualification-signals.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/qualification-signals.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 6: Verify package build**

```bash
pnpm --filter @switchboard/schemas build
pnpm --filter @switchboard/schemas typecheck
```

Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/qualification-signals.ts \
        packages/schemas/src/__tests__/qualification-signals.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(schemas): phase 3b — QualificationSignals + persisted-shape types

Adds QualificationSignalsSchema for the sidecar payload and a
discriminated-union WorkTraceQualificationSignalsSchema covering ok /
multiple_blocks / malformed_json / schema_mismatch states. Disqualifier
candidates capped at 4 per turn; evidence quotes capped at 280 chars to
bound prompt-injection bloat.

Forward-only addition; no existing call sites affected."
```

---

### Task 2: Governance config — `lifecycleTagging.qualification` sub-flag

**Files:**
- Modify: `packages/schemas/src/governance-config.ts`
- Modify: `packages/schemas/src/__tests__/governance-config-lifecycle.test.ts` (created in 3a)

- [ ] **Step 1: Inspect the existing lifecycleTagging block**

```bash
grep -n "lifecycleTagging\|mechanical" packages/schemas/src/governance-config.ts
```

Expected: shows the 3a `mechanical: { mode: "off" | "on" }` shape. Use the same `OffOnModeSchema` (or equivalent literal-union) for the new `qualification` sub-block.

- [ ] **Step 2: Write the failing test**

```ts
// packages/schemas/src/__tests__/governance-config-lifecycle.test.ts — append
import { describe, expect, it } from "vitest";
import { GovernanceConfigSchema, resolveLifecycleQualificationConfig } from "../governance-config.js";

describe("lifecycleTagging.qualification", () => {
  it("accepts on/off modes alongside mechanical", () => {
    const config = GovernanceConfigSchema.parse({
      alexMedspaSgMyGovernanceV1: {
        lifecycleTagging: {
          mechanical: { mode: "on" },
          qualification: { mode: "on" },
        },
      },
    });
    expect(config.alexMedspaSgMyGovernanceV1?.lifecycleTagging?.qualification?.mode).toBe("on");
  });

  it("defaults to off when omitted", () => {
    const config = GovernanceConfigSchema.parse({
      alexMedspaSgMyGovernanceV1: { lifecycleTagging: { mechanical: { mode: "on" } } },
    });
    expect(resolveLifecycleQualificationConfig(config)).toEqual({ mode: "off" });
  });

  it("rejects unknown mode values", () => {
    expect(() =>
      GovernanceConfigSchema.parse({
        alexMedspaSgMyGovernanceV1: {
          lifecycleTagging: { qualification: { mode: "maybe" } },
        },
      }),
    ).toThrow();
  });

  it("resolveLifecycleQualificationConfig returns the configured mode", () => {
    const config = GovernanceConfigSchema.parse({
      alexMedspaSgMyGovernanceV1: { lifecycleTagging: { qualification: { mode: "on" } } },
    });
    expect(resolveLifecycleQualificationConfig(config)).toEqual({ mode: "on" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/governance-config-lifecycle.test.ts`
Expected: FAIL — `qualification` key not defined; helper missing.

- [ ] **Step 4: Extend `governance-config.ts`**

Inside the existing `lifecycleTagging` sub-schema, add a `qualification` field mirroring `mechanical`. Add the helper next to `resolveLifecycleTaggingConfig` (or whatever the 3a accessor was called).

```ts
// packages/schemas/src/governance-config.ts — additions inside lifecycleTagging block
const LifecycleQualificationModeSchema = z.object({
  mode: z.enum(["off", "on"]).default("off"),
});

// inside lifecycleTagging:
//   qualification: LifecycleQualificationModeSchema.optional()

export function resolveLifecycleQualificationConfig(
  config: GovernanceConfig,
): { mode: "off" | "on" } {
  return (
    config.alexMedspaSgMyGovernanceV1?.lifecycleTagging?.qualification ?? { mode: "off" }
  );
}
```

(Adapt to match the existing file's exact structure — the 3a helper's location is the right pattern.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test src/__tests__/governance-config-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify package build**

```bash
pnpm --filter @switchboard/schemas build
```

Expected: success.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/governance-config.ts \
        packages/schemas/src/__tests__/governance-config-lifecycle.test.ts
git commit -m "feat(schemas): phase 3b — lifecycleTagging.qualification sub-flag

Adds the qualification sub-flag (off|on, default off) and a
resolveLifecycleQualificationConfig helper. Sibling to mechanical;
both can be enabled independently. Per-org rollout."
```

---

### Task 3: Prisma — `WorkTrace.qualificationSignals` column + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_alex_medspa_3b_qualification/migration.sql`
- Modify: `packages/db/src/prisma-work-trace-store.ts`
- Create: `packages/db/src/__tests__/prisma-work-trace-store-qualification.test.ts`

- [ ] **Step 1: Locate the WorkTrace model and verify the existing JSON-column pattern**

```bash
grep -n "model WorkTrace\|@db.Text" packages/db/prisma/schema.prisma | head -30
```

Expected: `WorkTrace` uses `String? @db.Text` for `parameters`, `governanceConstraints`, etc. Mirror that pattern.

- [ ] **Step 2: Add the column**

Edit `packages/db/prisma/schema.prisma`. Inside `model WorkTrace`, add (group with other JSON-encoded columns):

```prisma
  // Phase 3b qualification sidecar (audit lineage only). JSON-encoded
  // WorkTraceQualificationSignals; operational queues read lifecycle
  // tables instead. Always populated by SkillExecutor when sidecar is
  // present, regardless of lifecycleTagging.qualification flag state.
  qualificationSignals String? @db.Text
```

- [ ] **Step 3: Generate the Prisma client**

```bash
pnpm db:generate
```

Expected: success. The generated client now exposes `qualificationSignals` on `WorkTrace`.

- [ ] **Step 4: Generate the migration**

If Postgres is reachable:

```bash
mkdir -p packages/db/prisma/migrations/$(date +%Y%m%d%H%M%S)_alex_medspa_3b_qualification
pnpm prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script > packages/db/prisma/migrations/<ts>_alex_medspa_3b_qualification/migration.sql
```

If Postgres is unreachable, write the migration by hand:

```sql
-- packages/db/prisma/migrations/<ts>_alex_medspa_3b_qualification/migration.sql
ALTER TABLE "WorkTrace" ADD COLUMN "qualificationSignals" TEXT;
```

Use the actual timestamp directory name (`YYYYMMDDHHMMSS`).

- [ ] **Step 5: Write the failing store test**

```ts
// packages/db/src/__tests__/prisma-work-trace-store-qualification.test.ts
import { describe, expect, it, vi } from "vitest";
import type { WorkTraceQualificationSignals } from "@switchboard/schemas";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";

function buildMockPrisma() {
  return {
    workTrace: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "wt_1", ...data })),
      findUnique: vi.fn(),
    },
  };
}

describe("PrismaWorkTraceStore — qualificationSignals", () => {
  it("persists an 'ok' payload as JSON", async () => {
    const prisma = buildMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaWorkTraceStore(prisma as any);
    const sig: WorkTraceQualificationSignals = {
      validationStatus: "ok",
      payload: {
        treatmentInterest: "HIFU",
        preferredTimeWindow: null,
        serviceableMarket: "SG",
        buyingIntent: "soft",
        budgetAcknowledged: null,
        explicitDecline: false,
        disqualifierCandidates: [],
      },
    };

    await store.create({
      workUnitId: "wu_1",
      traceId: "tr_1",
      intent: "skill.execute",
      mode: "executed",
      organizationId: "org_1",
      actorId: "alex",
      actorType: "agent",
      trigger: "inbound_message",
      governanceOutcome: "approved",
      riskScore: 0,
      matchedPolicies: "[]",
      outcome: "success",
      qualificationSignals: sig,
    });

    const arg = prisma.workTrace.create.mock.calls[0][0];
    expect(arg.data.qualificationSignals).toBe(JSON.stringify(sig));
  });

  it("persists multiple_blocks shape", async () => {
    const prisma = buildMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaWorkTraceStore(prisma as any);
    const sig: WorkTraceQualificationSignals = {
      validationStatus: "multiple_blocks",
      raw: "<tag>a</tag><tag>b</tag>",
    };
    await store.create({
      workUnitId: "wu_2",
      traceId: "tr_2",
      intent: "skill.execute",
      mode: "executed",
      organizationId: "org_1",
      actorId: "alex",
      actorType: "agent",
      trigger: "inbound_message",
      governanceOutcome: "approved",
      riskScore: 0,
      matchedPolicies: "[]",
      outcome: "success",
      qualificationSignals: sig,
    });
    const arg = prisma.workTrace.create.mock.calls[0][0];
    expect(JSON.parse(arg.data.qualificationSignals)).toEqual(sig);
  });

  it("omits the column entirely when sidecar is null", async () => {
    const prisma = buildMockPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaWorkTraceStore(prisma as any);
    await store.create({
      workUnitId: "wu_3",
      traceId: "tr_3",
      intent: "skill.execute",
      mode: "executed",
      organizationId: "org_1",
      actorId: "alex",
      actorType: "agent",
      trigger: "inbound_message",
      governanceOutcome: "approved",
      riskScore: 0,
      matchedPolicies: "[]",
      outcome: "success",
      qualificationSignals: null,
    });
    const arg = prisma.workTrace.create.mock.calls[0][0];
    expect(arg.data.qualificationSignals).toBeNull();
  });

  // Read-path round-trip and corruption tolerance.

  it("read path returns the parsed WorkTraceQualificationSignals for valid stored JSON", async () => {
    const sig: WorkTraceQualificationSignals = {
      validationStatus: "ok",
      payload: {
        treatmentInterest: "HIFU",
        preferredTimeWindow: null,
        serviceableMarket: "SG",
        buyingIntent: "soft",
        budgetAcknowledged: null,
        explicitDecline: false,
        disqualifierCandidates: [],
      },
    };
    const prisma = buildMockPrisma();
    prisma.workTrace.findUnique.mockResolvedValueOnce({
      id: "wt_42",
      workUnitId: "wu_42",
      // ... other fields the store mapper expects (mirror existing test fixtures) ...
      qualificationSignals: JSON.stringify(sig),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaWorkTraceStore(prisma as any);
    const row = await store.findByWorkUnitId("wu_42");
    expect(row?.qualificationSignals).toEqual(sig);
  });

  it("read path returns null and logs warn when stored JSON is corrupt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prisma = buildMockPrisma();
    prisma.workTrace.findUnique.mockResolvedValueOnce({
      id: "wt_43",
      workUnitId: "wu_43",
      qualificationSignals: "{not json",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaWorkTraceStore(prisma as any);
    const row = await store.findByWorkUnitId("wu_43");
    expect(row?.qualificationSignals).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("read path returns null and logs warn when stored JSON fails schema validation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prisma = buildMockPrisma();
    prisma.workTrace.findUnique.mockResolvedValueOnce({
      id: "wt_44",
      workUnitId: "wu_44",
      // Valid JSON but not a valid WorkTraceQualificationSignals shape (no validationStatus discriminator)
      qualificationSignals: JSON.stringify({ foo: "bar" }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaWorkTraceStore(prisma as any);
    const row = await store.findByWorkUnitId("wu_44");
    expect(row?.qualificationSignals).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

> Note: the read-path tests assume the store exposes a `findByWorkUnitId` (or equivalently named) read method. Match the method name to whatever exists on the 3a store — the round-trip + corruption behavior is what matters; the method name is incidental. If the store has multiple read entry points (e.g. `findByWorkUnitId`, `listByTraceId`), add a matching parse step to each — the parse is in one helper, called everywhere a row is materialized to a typed object.

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-work-trace-store-qualification.test.ts`
Expected: FAIL — `create()` doesn't accept `qualificationSignals`.

- [ ] **Step 7: Extend the store**

Open `packages/db/src/prisma-work-trace-store.ts`. Locate the `create` method (or equivalent name). Add an optional `qualificationSignals?: WorkTraceQualificationSignals | null` to its input type and JSON-stringify it when present (mirror `parameters` / `governanceConstraints` handling).

```ts
// packages/db/src/prisma-work-trace-store.ts — within create()
const data = {
  // ... existing fields
  qualificationSignals: input.qualificationSignals
    ? JSON.stringify(input.qualificationSignals)
    : null,
};
```

Also extend the read path (where rows are mapped back to typed objects) to JSON.parse the column and validate via `WorkTraceQualificationSignalsSchema.safeParse`. Invalid stored JSON → log `console.warn` and return `null` (don't crash audit reads).

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test src/__tests__/prisma-work-trace-store-qualification.test.ts`
Expected: PASS.

- [ ] **Step 9: Verify the broader db test suite still passes**

```bash
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/db typecheck
```

Expected: green (or only the documented `pg_advisory_xact_lock` baseline flake per `feedback_db_integrity_tests_pg_advisory_lock.md`).

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/ \
        packages/db/src/prisma-work-trace-store.ts \
        packages/db/src/__tests__/prisma-work-trace-store-qualification.test.ts
git commit -m "feat(db): phase 3b — WorkTrace.qualificationSignals column + persistence

Adds a String? @db.Text column to WorkTrace for the audit-lineage record
of the per-turn qualification sidecar. PrismaWorkTraceStore.create
JSON-encodes the WorkTraceQualificationSignals discriminated union;
read path parses + validates and returns null on stored-JSON corruption
(non-fatal — audit reads must not crash).

Migration: ALTER TABLE WorkTrace ADD COLUMN qualificationSignals TEXT.
Backfills NULL for existing rows. No data migration."
```

---

### Task 4: Sidecar parser — strict trailing-block extraction

**Files:**
- Create: `packages/core/src/skill-runtime/qualification-sidecar-parser.ts`
- Create: `packages/core/src/skill-runtime/__tests__/qualification-sidecar-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/skill-runtime/__tests__/qualification-sidecar-parser.test.ts
import { describe, expect, it } from "vitest";
import { parseQualificationSidecar } from "../qualification-sidecar-parser.js";

const validJson = JSON.stringify({
  treatmentInterest: "HIFU",
  preferredTimeWindow: "weekday evenings",
  serviceableMarket: "SG",
  buyingIntent: "soft",
  budgetAcknowledged: null,
  explicitDecline: false,
  disqualifierCandidates: [],
});

describe("parseQualificationSidecar — count=0", () => {
  it("returns visibleResponse unchanged + persisted=null", () => {
    const out = parseQualificationSidecar("Hi! How can I help?");
    expect(out.visibleResponse).toBe("Hi! How can I help?");
    expect(out.persisted).toBeNull();
  });
});

describe("parseQualificationSidecar — count=1 valid", () => {
  it("strips the block and persists ok payload", () => {
    const raw = `Sure, weekday evenings work.\n\n<qualification_signals>${validJson}</qualification_signals>`;
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).toBe("Sure, weekday evenings work.");
    expect(out.persisted?.validationStatus).toBe("ok");
    if (out.persisted?.validationStatus === "ok") {
      expect(out.persisted.payload.treatmentInterest).toBe("HIFU");
    }
  });

  it("tolerates leading/trailing whitespace inside the block", () => {
    const raw = `Reply.\n<qualification_signals>\n  ${validJson}\n</qualification_signals>\n`;
    const out = parseQualificationSidecar(raw);
    expect(out.persisted?.validationStatus).toBe("ok");
  });

  it("strips the block even when it appears without a preceding blank line", () => {
    const raw = `Reply.<qualification_signals>${validJson}</qualification_signals>`;
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).toBe("Reply.");
    expect(out.persisted?.validationStatus).toBe("ok");
  });
});

describe("parseQualificationSidecar — count=1 malformed JSON", () => {
  it("strips the block, persists malformed_json, retains raw", () => {
    const raw = "Reply.\n\n<qualification_signals>{not json}</qualification_signals>";
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).toBe("Reply.");
    expect(out.persisted?.validationStatus).toBe("malformed_json");
    if (out.persisted?.validationStatus === "malformed_json") {
      expect(out.persisted.raw).toContain("{not json}");
    }
  });
});

describe("parseQualificationSidecar — count=1 schema mismatch", () => {
  it("persists schema_mismatch with zod error", () => {
    const bad = JSON.stringify({ treatmentInterest: "HIFU" }); // missing required fields
    const raw = `Reply.\n\n<qualification_signals>${bad}</qualification_signals>`;
    const out = parseQualificationSidecar(raw);
    expect(out.persisted?.validationStatus).toBe("schema_mismatch");
  });
});

describe("parseQualificationSidecar — count>1", () => {
  it("strips all blocks, persists multiple_blocks, lifecycle should skip", () => {
    const raw = `Reply.\n<qualification_signals>${validJson}</qualification_signals>\n\nMore.\n<qualification_signals>${validJson}</qualification_signals>`;
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).not.toMatch(/<qualification_signals>/);
    expect(out.persisted?.validationStatus).toBe("multiple_blocks");
  });
});

describe("parseQualificationSidecar — incomplete block", () => {
  it("treats an unclosed opening tag as malformed_json (raw retained, block stripped from response)", () => {
    const raw = "Reply.\n\n<qualification_signals>{incomplete";
    const out = parseQualificationSidecar(raw);
    expect(out.visibleResponse).toBe("Reply.");
    expect(out.persisted?.validationStatus).toBe("malformed_json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/__tests__/qualification-sidecar-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the parser**

```ts
// packages/core/src/skill-runtime/qualification-sidecar-parser.ts
import {
  QualificationSignalsSchema,
  type WorkTraceQualificationSignals,
} from "@switchboard/schemas";

const OPEN_TAG = "<qualification_signals>";
const CLOSE_TAG = "</qualification_signals>";

export interface ParsedSidecar {
  /** The response text safe to send to the contact — never contains tags. */
  visibleResponse: string;
  /**
   * The audit row to persist on WorkTrace.qualificationSignals. `null` means
   * no sidecar tags were present (column stays NULL).
   */
  persisted: WorkTraceQualificationSignals | null;
}

/**
 * Strict trailing-block parser for the Phase 3b qualification sidecar.
 *
 * Rules (spec §4.2):
 *  - count(<qualification_signals>) > 1  → all blocks stripped, persisted=multiple_blocks.
 *  - count == 0                          → response unchanged, persisted=null.
 *  - count == 1, JSON-malformed          → block stripped, persisted=malformed_json.
 *  - count == 1, schema-mismatch         → block stripped, persisted=schema_mismatch.
 *  - count == 1, valid                   → block stripped, persisted=ok with payload.
 *
 * The block is always stripped from `visibleResponse` regardless of validity —
 * contacts must never see protocol leakage on any code path.
 */
export function parseQualificationSidecar(raw: string): ParsedSidecar {
  // Count opening tags. We treat an unmatched open as count=1 (incomplete block).
  const openMatches = raw.match(new RegExp(OPEN_TAG, "g")) ?? [];
  const count = openMatches.length;

  if (count === 0) {
    return { visibleResponse: raw, persisted: null };
  }

  if (count > 1) {
    const stripped = raw
      .replace(new RegExp(`${OPEN_TAG}[\\s\\S]*?${CLOSE_TAG}`, "g"), "")
      .replace(new RegExp(OPEN_TAG, "g"), "") // any unclosed tail
      .trim();
    return {
      visibleResponse: stripped,
      persisted: { validationStatus: "multiple_blocks", raw: extractAllBlocks(raw) },
    };
  }

  // count === 1: extract the block (or the incomplete tail) and strip it.
  const openIdx = raw.indexOf(OPEN_TAG);
  const closeIdx = raw.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);

  const visibleResponse = raw.slice(0, openIdx).trim();

  if (closeIdx === -1) {
    // Unclosed block — treat as malformed.
    const inner = raw.slice(openIdx + OPEN_TAG.length).trim();
    return {
      visibleResponse,
      persisted: { validationStatus: "malformed_json", raw: inner },
    };
  }

  const inner = raw.slice(openIdx + OPEN_TAG.length, closeIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return {
      visibleResponse,
      persisted: { validationStatus: "malformed_json", raw: inner },
    };
  }

  const result = QualificationSignalsSchema.safeParse(parsed);
  if (!result.success) {
    return {
      visibleResponse,
      persisted: { validationStatus: "schema_mismatch", raw: inner, zodError: result.error },
    };
  }

  return {
    visibleResponse,
    persisted: { validationStatus: "ok", payload: result.data },
  };
}

function extractAllBlocks(raw: string): string {
  const blocks: string[] = [];
  const re = new RegExp(`${OPEN_TAG}[\\s\\S]*?(${CLOSE_TAG}|$)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    blocks.push(m[0]);
  }
  return blocks.join("\n---\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/__tests__/qualification-sidecar-parser.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: success.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/qualification-sidecar-parser.ts \
        packages/core/src/skill-runtime/__tests__/qualification-sidecar-parser.test.ts
git commit -m "feat(core): phase 3b — qualification sidecar parser

Strict <qualification_signals>{...}</qualification_signals> parser:
  - count(open tags) > 1     → strip all, persist multiple_blocks
  - count == 0               → response untouched, persisted=null
  - count == 1, bad JSON     → strip, persist malformed_json
  - count == 1, bad schema   → strip, persist schema_mismatch
  - count == 1, valid        → strip, persist ok+payload

Block always stripped from user-visible response on any code path; the
contact never sees protocol leakage."
```

---

### Task 5: `SkillExecutionResult.qualificationSignals` + SkillExecutor integration

**Files:**
- Modify: `packages/core/src/skill-runtime/types.ts`
- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Create: `packages/core/src/skill-runtime/__tests__/skill-executor-qualification.test.ts`

- [ ] **Step 1: Extend `SkillExecutionResult`**

Open `packages/core/src/skill-runtime/types.ts`. Locate `interface SkillExecutionResult`. Add:

```ts
import type { QualificationSignals } from "@switchboard/schemas";

export interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
  trace: SkillExecutionTraceData;
  intentClass?: IntentClass;
  /**
   * Phase 3b. Set when the LLM emitted a single valid
   * <qualification_signals>{...}</qualification_signals> block and it
   * passed schema validation. Consumed by the
   * qualification-evaluation-hook to evaluate the deterministic rule
   * against the latest sidecar. `undefined` means either no sidecar was
   * emitted or it failed validation (see WorkTrace.qualificationSignals
   * for the validation status in either case).
   */
  qualificationSignals?: QualificationSignals;
}
```

- [ ] **Step 1.5: Discover the existing SkillExecutor test harness — MANDATORY before writing any test code**

```bash
ls packages/core/src/skill-runtime/__tests__/
grep -l "SkillExecutor\|new SkillExecutor\|buildSkillExecutor\|makeExecutor" packages/core/src/skill-runtime/__tests__/*.ts
```

Open the most recent / most representative existing test (e.g. `skill-executor.test.ts`). **Reuse its factory / mock construction helper verbatim.** Do not invent a new constructor shape — the illustrative test below shows the *behavior to assert*, not the *construction pattern to copy*. If the existing tests use a factory like `buildExecutorForTest({ ... })` or import a shared fixture module, the 3b test must use the same factory; the only deltas are:

- The `llm.invoke` mock's `response` field needs to be controllable per test (so tests can vary the raw LLM output).
- The `workTraceStore.create` mock needs to be assertable for the `qualificationSignals` argument.

If the existing test pattern doesn't already support those two deltas, extend the shared factory (smallest possible extension; preserve all existing test-call sites) — don't create a parallel factory.

Document the chosen factory in this step's commit (one-line comment at the top of the new test file: `// Reuses buildExecutorForTest() from skill-executor.test.ts — see comment block there for construction details.`).

- [ ] **Step 2: Write the failing executor test**

```ts
// packages/core/src/skill-runtime/__tests__/skill-executor-qualification.test.ts
// Reuses the SkillExecutor test factory established by skill-executor.test.ts.
// The shape below is illustrative — see Step 1.5; replace `makeExecutorWithMocks`
// with the factory name + signature actually used by the existing tests.
import { describe, expect, it, vi } from "vitest";
import { SkillExecutor } from "../skill-executor.js";

function makeExecutorWithMocks(rawLlmResponse: string) {
  const workTraceCreate = vi.fn().mockResolvedValue({ id: "wt_1" });
  const executor = new SkillExecutor({
    // ... existing required deps, mocked to minimally route through ...
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workTraceStore: { create: workTraceCreate } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    llm: { invoke: vi.fn().mockResolvedValue({ response: rawLlmResponse }) } as any,
    // ... other mocks ...
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { executor, workTraceCreate };
}

const validJson = JSON.stringify({
  treatmentInterest: "HIFU",
  preferredTimeWindow: null,
  serviceableMarket: "SG",
  buyingIntent: "strong",
  budgetAcknowledged: null,
  explicitDecline: false,
  disqualifierCandidates: [],
});

describe("SkillExecutor — qualification sidecar integration", () => {
  it("strips the sidecar from the response and attaches the parsed payload to result", async () => {
    const raw = `Sure!\n\n<qualification_signals>${validJson}</qualification_signals>`;
    const { executor, workTraceCreate } = makeExecutorWithMocks(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await executor.execute({} as any);

    expect(result.response).toBe("Sure!");
    expect(result.qualificationSignals).toBeDefined();
    expect(result.qualificationSignals?.treatmentInterest).toBe("HIFU");

    const wtArg = workTraceCreate.mock.calls[0][0];
    expect(wtArg.qualificationSignals.validationStatus).toBe("ok");
  });

  it("persists validation status even for malformed sidecars and does NOT attach payload", async () => {
    const raw = "Sure!\n\n<qualification_signals>{broken</qualification_signals>";
    const { executor, workTraceCreate } = makeExecutorWithMocks(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await executor.execute({} as any);

    expect(result.response).toBe("Sure!");
    expect(result.qualificationSignals).toBeUndefined();
    const wtArg = workTraceCreate.mock.calls[0][0];
    expect(wtArg.qualificationSignals.validationStatus).toBe("malformed_json");
  });

  it("when no sidecar is present, response is unchanged and column stays null", async () => {
    const raw = "Sure, weekday evenings work.";
    const { executor, workTraceCreate } = makeExecutorWithMocks(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await executor.execute({} as any);

    expect(result.response).toBe("Sure, weekday evenings work.");
    expect(result.qualificationSignals).toBeUndefined();
    const wtArg = workTraceCreate.mock.calls[0][0];
    expect(wtArg.qualificationSignals).toBeNull();
  });

  it("parses + strips + persists ALWAYS — regardless of any lifecycleTagging.qualification config", async () => {
    // SkillExecutor is intentionally unaware of the qualification flag.
    // Always-parse-always-strip is a doctrine rule (spec §7.1). Asserted
    // here by exercising the executor with no flag context at all.
    const raw = `Sure!\n\n<qualification_signals>${validJson}</qualification_signals>`;
    const { executor, workTraceCreate } = makeExecutorWithMocks(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await executor.execute({} as any);
    expect(result.response).not.toMatch(/<qualification_signals>/);
    expect(workTraceCreate.mock.calls[0][0].qualificationSignals).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/__tests__/skill-executor-qualification.test.ts`
Expected: FAIL — `qualificationSignals` not handled by executor.

- [ ] **Step 4: Wire the parser into `SkillExecutor`**

Open `packages/core/src/skill-runtime/skill-executor.ts`. Locate the place where the raw LLM response is post-processed (likely near the existing `intentClass` parsing — search for `<intent>` or `parseIntentClass`).

Add after the LLM call returns and **before** any consumer of `response`:

```ts
// 3b: parse + strip qualification sidecar. Always-on; lifecycle layer
// decides separately whether to act on the payload (spec §7.1).
import { parseQualificationSidecar } from "./qualification-sidecar-parser.js";

// ... inside execute() ...
const sidecar = parseQualificationSidecar(rawLlmResponse);
const visibleResponse = sidecar.visibleResponse;
// ... use visibleResponse for downstream tool-calling-adapter, response field, etc.

// Persist on WorkTrace (audit lineage). Always; even when flag is off.
const workTrace = await deps.workTraceStore.create({
  // ... existing fields populated from execution context ...
  qualificationSignals: sidecar.persisted,
});

// Attach parsed payload to the typed result only on validation success.
const result: SkillExecutionResult = {
  response: visibleResponse,
  // ... existing fields ...
  qualificationSignals:
    sidecar.persisted?.validationStatus === "ok" ? sidecar.persisted.payload : undefined,
};
```

Note: existing executor structure may differ — preserve its arrangement and apply the parser at the single point where the raw LLM response is post-processed. The parser invocation must occur **before** the response is handed to any tool-calling adapter, recorded in trace data, or returned to callers.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/skill-runtime/__tests__/skill-executor-qualification.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the broader skill-runtime test suite**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/
```

Expected: green. Existing tests unaffected because sidecar parsing is purely additive (no-op on responses without the tag).

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: success.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts \
        packages/core/src/skill-runtime/skill-executor.ts \
        packages/core/src/skill-runtime/__tests__/skill-executor-qualification.test.ts
git commit -m "feat(core): phase 3b — wire sidecar parser into SkillExecutor

  - SkillExecutionResult gains optional qualificationSignals field
    (precedent: 1d intentClass).
  - SkillExecutor invokes parseQualificationSidecar on raw LLM output
    before producing the visible response.
  - WorkTrace.qualificationSignals is written on every turn (null when
    no block is present). Always-on, not flag-gated — sidecar tags
    must never leak to the contact regardless of qualification config.
  - Result.qualificationSignals is set only when validationStatus='ok'.
    Lifecycle layer consumes it via the qualification-evaluation-hook
    (Task 11)."
```

---

### Task 6: Rename 3a allowlist constants → capability constants

**Files:**
- Modify: `packages/core/src/conversation-lifecycle/constants.ts`
- Modify: `packages/core/src/conversation-lifecycle/lifecycle-writer.ts`
- Modify: `packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer.test.ts` (existing 3a tests)
- Modify: any other 3a references — grep before editing
- Modify: `packages/core/src/conversation-lifecycle/types.ts` — add `LifecycleWriteCapability`

This task is a pure rename + addition. No behavior change. Bundling the rename with the capability addition keeps the diff coherent.

- [ ] **Step 1: Audit all call sites of the 3a constants**

```bash
grep -rn "THREE_A_ALLOWED_STATES\|THREE_A_ALLOWED_TRIGGERS" packages/
```

Expected: hits in `constants.ts` (definition), `lifecycle-writer.ts` (consumer), 3a's tests. Make a note of every file.

- [ ] **Step 2: Add `LifecycleWriteCapability` type**

```ts
// packages/core/src/conversation-lifecycle/types.ts — additions
export type LifecycleWriteCapability = "mechanical" | "qualification";
```

- [ ] **Step 3: Rename + extend constants**

```ts
// packages/core/src/conversation-lifecycle/constants.ts — full replacement of allowlist block
import type {
  ConversationLifecycleState,
  ConversationLifecycleTrigger,
} from "@switchboard/schemas";
import type { LifecycleWriteCapability } from "./types.js";

export const STALLED_THRESHOLD_HOURS = 24;
export const RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS = 7;
export const CRON_LOOKBACK_HOURS = 168;

/**
 * Capability-aware runtime allowlists. The schema permits the full Phase 3
 * enum for forward compatibility; the writer (see lifecycle-writer.ts) only
 * accepts a state/trigger if it appears in the union of allowlists for the
 * caller's enabled capabilities.
 */
export const MECHANICAL_ALLOWED_STATES = new Set<ConversationLifecycleState>([
  "active",
  "stalled",
  "booked",
  "escalated",
]);

export const MECHANICAL_ALLOWED_TRIGGERS = new Set<ConversationLifecycleTrigger>([
  "timer_24h_no_inbound",
  "inbound_after_stalled",
  "inbound_after_re_engagement_template",
  "booking_event_received",
  "governance_verdict_escalate",
  "operator_takeover",
]);

/**
 * Qualification capability adds `qualified` and `disqualified` as
 * advance-able currentState values, and the five qualification triggers.
 * `proposed_disqualified` is intentionally NOT here — it's a
 * qualificationStatus value, not a currentState value (see
 * LifecycleWriter.updateQualificationStatus).
 */
export const QUALIFICATION_ALLOWED_STATES = new Set<ConversationLifecycleState>([
  "qualified",
  "disqualified",
]);

export const QUALIFICATION_ALLOWED_TRIGGERS = new Set<ConversationLifecycleTrigger>([
  "qualification_checklist_met",
  "qualification_checklist_failed",
  "system_proposed_disqualification",
  "operator_confirmed_disqualification",
  "operator_dismissed_disqualification",
]);

const STATES_BY_CAPABILITY: Record<LifecycleWriteCapability, Set<ConversationLifecycleState>> = {
  mechanical: MECHANICAL_ALLOWED_STATES,
  qualification: QUALIFICATION_ALLOWED_STATES,
};

const TRIGGERS_BY_CAPABILITY: Record<LifecycleWriteCapability, Set<ConversationLifecycleTrigger>> = {
  mechanical: MECHANICAL_ALLOWED_TRIGGERS,
  qualification: QUALIFICATION_ALLOWED_TRIGGERS,
};

export function allowedStatesFor(
  capabilities: ReadonlySet<LifecycleWriteCapability>,
): Set<ConversationLifecycleState> {
  const merged = new Set<ConversationLifecycleState>();
  for (const c of capabilities) for (const s of STATES_BY_CAPABILITY[c]) merged.add(s);
  return merged;
}

export function allowedTriggersFor(
  capabilities: ReadonlySet<LifecycleWriteCapability>,
): Set<ConversationLifecycleTrigger> {
  const merged = new Set<ConversationLifecycleTrigger>();
  for (const c of capabilities) for (const t of TRIGGERS_BY_CAPABILITY[c]) merged.add(t);
  return merged;
}
```

- [ ] **Step 4: Update `lifecycle-writer.ts` to use the new helpers**

Open `packages/core/src/conversation-lifecycle/lifecycle-writer.ts`. The writer currently imports `THREE_A_ALLOWED_STATES` / `THREE_A_ALLOWED_TRIGGERS` and checks them inline. For now (this task), replace those imports with the mechanical-only equivalents so behavior is unchanged:

```ts
import { allowedStatesFor, allowedTriggersFor } from "./constants.js";
import type { LifecycleWriteCapability } from "./types.js";

// Existing writer deps — extend with capabilities
export interface LifecycleWriterDeps {
  snapshotStore: LifecycleSnapshotStore;
  transitionStore: LifecycleTransitionStore;
  runInTransaction: RunInTransaction;
  /** Resolves the writer's enabled capabilities for the given org. */
  resolveCapabilities: (organizationId: string) => Promise<ReadonlySet<LifecycleWriteCapability>>;
}

// inside recordTransition(input):
const capabilities = await this.deps.resolveCapabilities(input.organizationId);
const states = allowedStatesFor(capabilities);
const triggers = allowedTriggersFor(capabilities);

if (!states.has(input.toState)) {
  throw new LifecycleCapabilityDenied(
    `toState '${input.toState}' not allowed by capabilities [${[...capabilities].join(",")}]`,
  );
}
if (!triggers.has(input.trigger)) {
  throw new LifecycleCapabilityDenied(
    `trigger '${input.trigger}' not allowed by capabilities [${[...capabilities].join(",")}]`,
  );
}
```

(Bring in `LifecycleCapabilityDenied` from errors.ts — added in Step 5.)

- [ ] **Step 5: Add the new error class**

```ts
// packages/core/src/conversation-lifecycle/errors.ts — additions
export class LifecycleCapabilityDenied extends Error {
  constructor(message: string) {
    super(`LifecycleWriter: ${message}`);
    this.name = "LifecycleCapabilityDenied";
  }
}
```

- [ ] **Step 6: Update existing 3a writer tests to pass `resolveCapabilities`**

Open `packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer.test.ts`. Wherever the writer is constructed in the existing 3a tests, supply a mock `resolveCapabilities` returning `new Set(["mechanical"])`. Example diff:

```ts
const writer = new LifecycleWriter({
  snapshotStore,
  transitionStore,
  runInTransaction,
  resolveCapabilities: async () => new Set(["mechanical"] as const),
});
```

If the existing tests assert that "3a code emitting 3b values throws", keep those assertions — they still pass because `mechanical`-only capabilities exclude qualification states/triggers, but rewrite the expected error type from `Error` to `LifecycleCapabilityDenied`.

- [ ] **Step 7: Run all conversation-lifecycle tests to verify the rename didn't break 3a**

```bash
pnpm --filter @switchboard/core test src/conversation-lifecycle/
```

Expected: all green. If failures, fix the test construction sites only — no production logic changes in this task.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: success.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/conversation-lifecycle/constants.ts \
        packages/core/src/conversation-lifecycle/types.ts \
        packages/core/src/conversation-lifecycle/errors.ts \
        packages/core/src/conversation-lifecycle/lifecycle-writer.ts \
        packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer.test.ts
git commit -m "refactor(core): phase 3b — capability-aware allowlist on LifecycleWriter

Renames THREE_A_ALLOWED_STATES/TRIGGERS to MECHANICAL_ALLOWED_*. Adds
QUALIFICATION_ALLOWED_* and a LifecycleWriteCapability type union.

LifecycleWriter now takes resolveCapabilities(orgId) on deps and computes
the per-call allowed union. Mechanical-only callers retain the 3a
guarantee — qualification states/triggers raise LifecycleCapabilityDenied.

No behavior change for 3a. Sets up Task 7 (updateQualificationStatus +
monotonic guard)."
```

---

### Task 7: `LifecycleWriter.updateQualificationStatus` + monotonic guard

**Files:**
- Modify: `packages/core/src/conversation-lifecycle/lifecycle-writer.ts`
- Modify: `packages/core/src/conversation-lifecycle/types.ts`
- Create: `packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer-capabilities.test.ts`
- Create: `packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer-qualification.test.ts`

- [ ] **Step 1: Define `UpdateQualificationInput`**

```ts
// packages/core/src/conversation-lifecycle/types.ts — additions
import type {
  ConversationLifecycleTrigger,
  ConversationLifecycleActor,
  LifecycleQualificationStatus,
} from "@switchboard/schemas";

export interface UpdateQualificationInput {
  organizationId: string;
  conversationThreadId: string;
  contactId: string;
  /** The target qualificationStatus. currentState is NOT advanced. */
  toQualificationStatus: LifecycleQualificationStatus;
  trigger: ConversationLifecycleTrigger;
  actor: ConversationLifecycleActor;
  evidence: Record<string, unknown>;
  workTraceId?: string | null;
  occurredAt?: Date;
}
```

- [ ] **Step 2: Write the capability-gate failing test**

```ts
// packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer-capabilities.test.ts
import { describe, expect, it, vi } from "vitest";
import { LifecycleWriter } from "../lifecycle-writer.js";
import { LifecycleCapabilityDenied } from "../errors.js";

function makeWriter(caps: ReadonlySet<"mechanical" | "qualification">) {
  const snapshotStore = {
    readInTransaction: vi.fn().mockResolvedValue(null),
    upsertInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const transitionStore = {
    appendInTransaction: vi.fn().mockResolvedValue(undefined),
    listForThread: vi.fn().mockResolvedValue([]),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runInTransaction = async (fn: any) => fn({});
  const writer = new LifecycleWriter({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshotStore: snapshotStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transitionStore: transitionStore as any,
    runInTransaction,
    resolveCapabilities: async () => caps,
  });
  return { writer, snapshotStore, transitionStore };
}

describe("LifecycleWriter — capability gating", () => {
  it("mechanical-only writer rejects qualified toState with LifecycleCapabilityDenied", async () => {
    const { writer } = makeWriter(new Set(["mechanical"] as const));
    await expect(
      writer.recordTransition({
        organizationId: "o",
        conversationThreadId: "t",
        contactId: "c",
        toState: "qualified",
        trigger: "qualification_checklist_met",
        actor: "alex",
        evidence: {},
      }),
    ).rejects.toBeInstanceOf(LifecycleCapabilityDenied);
  });

  it("union writer accepts qualified toState + qualification trigger", async () => {
    const { writer, snapshotStore } = makeWriter(new Set(["mechanical", "qualification"] as const));
    await writer.recordTransition({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toState: "qualified",
      trigger: "qualification_checklist_met",
      actor: "alex",
      evidence: {},
    });
    expect(snapshotStore.upsertInTransaction).toHaveBeenCalled();
  });

  it("qualification-only writer rejects mechanical trigger like timer_24h_no_inbound", async () => {
    const { writer } = makeWriter(new Set(["qualification"] as const));
    await expect(
      writer.recordTransition({
        organizationId: "o",
        conversationThreadId: "t",
        contactId: "c",
        toState: "stalled",
        trigger: "timer_24h_no_inbound",
        actor: "system",
        evidence: {},
      }),
    ).rejects.toBeInstanceOf(LifecycleCapabilityDenied);
  });
});
```

- [ ] **Step 3: Write the monotonic-guard failing test**

```ts
// packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer-qualification.test.ts
import { describe, expect, it, vi } from "vitest";
import { LifecycleWriter } from "../lifecycle-writer.js";
import type { ConversationLifecycleSnapshot } from "@switchboard/schemas";

function makeWriterWithSnapshot(existing: ConversationLifecycleSnapshot | null) {
  const snapshotStore = {
    readInTransaction: vi.fn().mockResolvedValue(existing),
    upsertInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const transitionStore = {
    appendInTransaction: vi.fn().mockResolvedValue(undefined),
    listForThread: vi.fn().mockResolvedValue([]),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runInTransaction = async (fn: any) => fn({});
  const writer = new LifecycleWriter({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshotStore: snapshotStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transitionStore: transitionStore as any,
    runInTransaction,
    resolveCapabilities: async () => new Set(["mechanical", "qualification"] as const),
  });
  return { writer, snapshotStore, transitionStore };
}

const base: Omit<ConversationLifecycleSnapshot, "qualificationStatus"> = {
  conversationThreadId: "t",
  organizationId: "o",
  contactId: "c",
  currentState: "active",
  bookingStatus: "not_booked",
  dropoffReason: null,
  lastTransitionAt: new Date("2026-05-12T00:00:00Z"),
  lastEvaluatedAt: new Date("2026-05-12T00:00:00Z"),
  updatedAt: new Date("2026-05-12T00:00:00Z"),
};

describe("updateQualificationStatus — monotonic guards", () => {
  it("accepts unknown → qualified", async () => {
    const { writer, snapshotStore, transitionStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "unknown",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "qualified",
      trigger: "qualification_checklist_met",
      actor: "alex",
      evidence: {},
    });
    expect(transitionStore.appendInTransaction).toHaveBeenCalled();
    expect(snapshotStore.upsertInTransaction).toHaveBeenCalled();
  });

  it("silently no-ops qualified → unqualified (no transition, no upsert)", async () => {
    const { writer, snapshotStore, transitionStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "qualified",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "unqualified",
      trigger: "qualification_checklist_failed",
      actor: "alex",
      evidence: {},
    });
    expect(transitionStore.appendInTransaction).not.toHaveBeenCalled();
    expect(snapshotStore.upsertInTransaction).not.toHaveBeenCalled();
  });

  it("silently no-ops proposed_disqualified → qualified via sidecar (must go through operator)", async () => {
    const { writer, transitionStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "proposed_disqualified",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "qualified",
      trigger: "qualification_checklist_met",
      actor: "alex",
      evidence: {},
    });
    expect(transitionStore.appendInTransaction).not.toHaveBeenCalled();
  });

  it("operator dismiss restores prior status from evidence", async () => {
    const { writer, snapshotStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "proposed_disqualified",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "qualified", // restoring
      trigger: "operator_dismissed_disqualification",
      actor: "operator",
      evidence: { priorQualificationStatus: "qualified" },
    });
    const upsertArg = snapshotStore.upsertInTransaction.mock.calls[0][1];
    expect(upsertArg.qualificationStatus).toBe("qualified");
  });

  it("system_proposed_disqualification on qualified thread writes proposed_disqualified", async () => {
    const { writer, snapshotStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "qualified",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "proposed_disqualified",
      trigger: "system_proposed_disqualification",
      actor: "alex",
      evidence: { candidateType: "out_of_area", evidenceQuote: "lives in NY" },
    });
    const upsertArg = snapshotStore.upsertInTransaction.mock.calls[0][1];
    expect(upsertArg.qualificationStatus).toBe("proposed_disqualified");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/__tests__/lifecycle-writer-capabilities.test.ts src/conversation-lifecycle/__tests__/lifecycle-writer-qualification.test.ts`
Expected: FAIL — `updateQualificationStatus` method not defined.

- [ ] **Step 5: Implement `updateQualificationStatus` + monotonic guard**

Add the method to `LifecycleWriter` (in `packages/core/src/conversation-lifecycle/lifecycle-writer.ts`):

```ts
import type { LifecycleQualificationStatus } from "@switchboard/schemas";

// inside class LifecycleWriter:
async updateQualificationStatus(input: UpdateQualificationInput): Promise<void> {
  const capabilities = await this.deps.resolveCapabilities(input.organizationId);
  const triggers = allowedTriggersFor(capabilities);
  if (!triggers.has(input.trigger)) {
    throw new LifecycleCapabilityDenied(
      `trigger '${input.trigger}' not allowed by capabilities [${[...capabilities].join(",")}]`,
    );
  }

  const occurredAt = input.occurredAt ?? new Date();

  await this.deps.runInTransaction(async (tx) => {
    const existing = await this.deps.snapshotStore.readInTransaction(
      tx,
      input.conversationThreadId,
    );
    if (existing === null) {
      // Cannot mutate qualification on a non-existent snapshot — caller bug.
      console.warn(
        `[lifecycle] updateQualificationStatus called on missing snapshot ${input.conversationThreadId}; ignoring`,
      );
      return;
    }
    if (!isMonotonicQualificationTransition(existing.qualificationStatus, input)) {
      // Silent no-op — expected behavior for thin sidecars on already-qualified
      // threads. Capability violations are loud; monotonic violations are quiet.
      return;
    }

    const nextSnapshot: ConversationLifecycleSnapshot = {
      ...existing,
      qualificationStatus: input.toQualificationStatus,
      lastEvaluatedAt: occurredAt,
      updatedAt: occurredAt,
    };
    await this.deps.snapshotStore.upsertInTransaction(tx, nextSnapshot);

    const transition: Omit<ConversationLifecycleTransition, "id"> = {
      organizationId: input.organizationId,
      conversationThreadId: input.conversationThreadId,
      contactId: input.contactId,
      // qualificationStatus mutations are recorded with fromState/toState both
      // equal to the current currentState — the transition documents a
      // qualificationStatus change, not a currentState advance. Consumers
      // distinguish by the trigger.
      fromState: existing.currentState,
      toState: existing.currentState,
      trigger: input.trigger,
      evidence: input.evidence,
      actor: input.actor,
      workTraceId: input.workTraceId ?? null,
      occurredAt,
    };
    await this.deps.transitionStore.appendInTransaction(tx, transition);
  });
}
```

Then add the monotonic-guard helper in the same file:

```ts
/**
 * Spec §5.2 monotonic table. Returns true iff the proposed mutation is
 * allowed. Operator-driven mutations (dismiss restoring prior status,
 * confirm advancing to disqualified) are recognized by trigger.
 */
function isMonotonicQualificationTransition(
  current: LifecycleQualificationStatus,
  input: UpdateQualificationInput,
): boolean {
  const target = input.toQualificationStatus;
  const trigger = input.trigger;

  // Operator-driven paths bypass the monotonic-by-sidecar rules.
  if (trigger === "operator_dismissed_disqualification") {
    return current === "proposed_disqualified";
  }
  if (trigger === "operator_confirmed_disqualification") {
    // Handled by recordTransition (advances currentState to disqualified);
    // updateQualificationStatus should not be used for confirm.
    return false;
  }

  // System paths from sidecar evaluation:
  if (current === "proposed_disqualified" && trigger !== "system_proposed_disqualification") {
    return false; // protected from overwrite by normal sidecars
  }

  if (target === "proposed_disqualified") {
    return current !== "proposed_disqualified"; // re-proposal on same thread is no-op
  }

  if (target === "qualified") {
    return current === "unknown" || current === "unqualified" || current === "qualified";
  }

  if (target === "unqualified") {
    return current === "unknown"; // qualified → unqualified is forbidden
  }

  if (target === "unknown") {
    return false; // never regress to unknown
  }

  return false;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/__tests__/lifecycle-writer-capabilities.test.ts src/conversation-lifecycle/__tests__/lifecycle-writer-qualification.test.ts`
Expected: PASS.

- [ ] **Step 7: Run all conversation-lifecycle tests**

```bash
pnpm --filter @switchboard/core test src/conversation-lifecycle/
```

Expected: green; 3a tests unaffected.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: success.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/conversation-lifecycle/types.ts \
        packages/core/src/conversation-lifecycle/lifecycle-writer.ts \
        packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer-capabilities.test.ts \
        packages/core/src/conversation-lifecycle/__tests__/lifecycle-writer-qualification.test.ts
git commit -m "feat(core): phase 3b — LifecycleWriter.updateQualificationStatus + monotonic guard

New method mutates qualificationStatus without advancing currentState.
Used by qualification-evaluation-hook (system proposes) and
disqualification-resolution-hook (operator dismisses).

Monotonic guard enforces spec §5.2:
  - qualified → unqualified always blocked (silent no-op)
  - proposed_disqualified protected from sidecar overwrite
  - operator paths recognized by trigger; dismiss requires prior
    status in evidence

Capability violations are loud (throw); monotonic violations are quiet
(silent no-op) since they are expected behavior, not bugs."
```

---

### Task 8: Treatment resolver — bind treatmentInterest to `Playbook.services`

**Files:**
- Create: `packages/core/src/conversation-lifecycle/qualification/treatment-resolver.ts`
- Create: `packages/core/src/conversation-lifecycle/qualification/__tests__/treatment-resolver.test.ts`

- [ ] **Step 1: Pre-flight — locate the existing playbook reader/store**

```bash
grep -rn "PlaybookStore\|playbookStore\|getPlaybook\|playbook-reader" packages/core/src packages/db/src apps/api/src 2>/dev/null | head -20
```

Expected: identifies how `Playbook` is currently read for a given org. Re-use the existing reader; do **not** create a duplicate. Document the path in Step 2's comment.

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/src/conversation-lifecycle/qualification/__tests__/treatment-resolver.test.ts
import { describe, expect, it } from "vitest";
import { resolveTreatmentInterest } from "../treatment-resolver.js";
import type { Playbook } from "@switchboard/schemas";

function fakePlaybook(serviceNames: string[]): Playbook {
  // Minimal fake — fill in required fields per the Playbook schema.
  // Test-only construction; production code uses the real PlaybookReader.
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    businessIdentity: {} as any,
    services: serviceNames.map((name, i) => ({
      id: `svc_${i}`,
      name,
      bookingBehavior: "ask_first",
      status: "complete",
      source: "manual",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as Playbook;
}

describe("resolveTreatmentInterest", () => {
  it("matches case-insensitively on trimmed name", () => {
    const playbook = fakePlaybook(["HIFU", "Laser Hair Removal"]);
    expect(resolveTreatmentInterest(playbook, "hifu")).toEqual({
      resolved: true,
      serviceId: "svc_0",
      serviceName: "HIFU",
    });
    expect(resolveTreatmentInterest(playbook, "  Laser Hair Removal  ")).toEqual({
      resolved: true,
      serviceId: "svc_1",
      serviceName: "Laser Hair Removal",
    });
  });

  it("returns unresolved for unknown treatment names", () => {
    const playbook = fakePlaybook(["HIFU"]);
    expect(resolveTreatmentInterest(playbook, "laser miracle fat removal")).toEqual({
      resolved: false,
      candidate: "laser miracle fat removal",
    });
  });

  it("returns null-typed result for null input", () => {
    const playbook = fakePlaybook(["HIFU"]);
    expect(resolveTreatmentInterest(playbook, null)).toEqual({
      resolved: false,
      candidate: null,
    });
  });

  it("returns null-typed result for empty/whitespace input", () => {
    const playbook = fakePlaybook(["HIFU"]);
    expect(resolveTreatmentInterest(playbook, "   ")).toEqual({
      resolved: false,
      candidate: null,
    });
  });

  it("returns unresolved when playbook has no services", () => {
    const playbook = fakePlaybook([]);
    expect(resolveTreatmentInterest(playbook, "HIFU")).toEqual({
      resolved: false,
      candidate: "HIFU",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/qualification/__tests__/treatment-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the resolver**

```ts
// packages/core/src/conversation-lifecycle/qualification/treatment-resolver.ts
import type { Playbook } from "@switchboard/schemas";

export type TreatmentResolution =
  | { resolved: true; serviceId: string; serviceName: string }
  | { resolved: false; candidate: string | null };

/**
 * Resolves a sidecar's `treatmentInterest` against `Playbook.services`.
 * Case-insensitive equality on trimmed name. Returns unresolved for
 * free-text candidates that don't match a known service — those leads
 * cannot be marked `qualified` (spec §5.1).
 *
 * Aliases are NOT supported in v1 (PlaybookService schema has no
 * aliases[] field). 3c follow-up will add aliases once knowledge-gap
 * recommendations identify common variants.
 */
export function resolveTreatmentInterest(
  playbook: Playbook,
  treatmentInterest: string | null,
): TreatmentResolution {
  if (treatmentInterest === null) {
    return { resolved: false, candidate: null };
  }
  const trimmed = treatmentInterest.trim();
  if (trimmed.length === 0) {
    return { resolved: false, candidate: null };
  }
  const needle = trimmed.toLowerCase();
  for (const service of playbook.services ?? []) {
    if (service.name.trim().toLowerCase() === needle) {
      return { resolved: true, serviceId: service.id, serviceName: service.name };
    }
  }
  return { resolved: false, candidate: trimmed };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/qualification/__tests__/treatment-resolver.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/conversation-lifecycle/qualification/treatment-resolver.ts \
        packages/core/src/conversation-lifecycle/qualification/__tests__/treatment-resolver.test.ts
git commit -m "feat(core): phase 3b — treatment resolver binds treatmentInterest to Playbook.services

Case-insensitive equality on trimmed service.name. Free-text candidates
that don't match a known service are unresolved — leads cannot qualify
on those (spec §5.1). Aliases deferred to 3c."
```

---

### Task 9: Qualification rule evaluator

**Files:**
- Create: `packages/core/src/conversation-lifecycle/qualification/qualification-rule-evaluator.ts`
- Create: `packages/core/src/conversation-lifecycle/qualification/__tests__/qualification-rule-evaluator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/conversation-lifecycle/qualification/__tests__/qualification-rule-evaluator.test.ts
import { describe, expect, it } from "vitest";
import type { QualificationSignals } from "@switchboard/schemas";
import { evaluateQualification } from "../qualification-rule-evaluator.js";
import type { TreatmentResolution } from "../treatment-resolver.js";

const base: QualificationSignals = {
  treatmentInterest: "HIFU",
  preferredTimeWindow: null,
  serviceableMarket: "SG",
  buyingIntent: "soft",
  budgetAcknowledged: null,
  explicitDecline: false,
  disqualifierCandidates: [],
};

const resolved: TreatmentResolution = { resolved: true, serviceId: "svc_0", serviceName: "HIFU" };
const unresolved: TreatmentResolution = { resolved: false, candidate: "HIFU" };

describe("evaluateQualification", () => {
  it("marks qualified when all clauses pass", () => {
    expect(evaluateQualification(base, resolved)).toEqual({
      verdict: "qualified",
      serviceId: "svc_0",
    });
  });

  it("returns unqualified when treatment is unresolved (even if other clauses pass)", () => {
    expect(evaluateQualification(base, unresolved).verdict).toBe("unqualified");
  });

  it("returns unqualified when serviceableMarket is out_of_area", () => {
    expect(evaluateQualification({ ...base, serviceableMarket: "out_of_area" }, resolved).verdict)
      .toBe("unqualified");
  });

  it("returns unqualified when serviceableMarket is unknown", () => {
    expect(evaluateQualification({ ...base, serviceableMarket: "unknown" }, resolved).verdict)
      .toBe("unqualified");
  });

  it("returns unqualified when buyingIntent is none", () => {
    expect(evaluateQualification({ ...base, buyingIntent: "none" }, resolved).verdict)
      .toBe("unqualified");
  });

  it("returns unqualified when explicitDecline is true", () => {
    expect(evaluateQualification({ ...base, explicitDecline: true }, resolved).verdict)
      .toBe("unqualified");
  });

  it("returns disqualifier_candidates_present when candidates list is non-empty", () => {
    const out = evaluateQualification(
      { ...base, disqualifierCandidates: [{ type: "out_of_area", evidence: "lives in NY" }] },
      resolved,
    );
    expect(out.verdict).toBe("disqualifier_candidates_present");
    if (out.verdict === "disqualifier_candidates_present") {
      expect(out.candidates).toHaveLength(1);
    }
  });

  it("treatmentInterest takes precedence over disqualifier candidates when both fail", () => {
    // If treatment unresolved AND disqualifier candidates present, both reasons exist;
    // verdict prioritizes operator-actionable signal — disqualifier candidates win.
    const out = evaluateQualification(
      {
        ...base,
        treatmentInterest: "vague",
        disqualifierCandidates: [{ type: "out_of_area", evidence: "x" }],
      },
      unresolved,
    );
    expect(out.verdict).toBe("disqualifier_candidates_present");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/qualification/__tests__/qualification-rule-evaluator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the evaluator**

```ts
// packages/core/src/conversation-lifecycle/qualification/qualification-rule-evaluator.ts
import type { QualificationSignals } from "@switchboard/schemas";
import type { TreatmentResolution } from "./treatment-resolver.js";

export type QualificationVerdict =
  | { verdict: "qualified"; serviceId: string }
  | { verdict: "unqualified"; reasons: QualificationFailureReason[] }
  | {
      verdict: "disqualifier_candidates_present";
      candidates: Array<{ type: string; evidence: string }>;
    };

export type QualificationFailureReason =
  | "treatment_unresolved"
  | "out_of_area"
  | "market_unknown"
  | "no_buying_intent"
  | "explicit_decline";

/**
 * Deterministic qualification rule (spec §5.1).
 *
 * Priority of verdicts:
 *  1. `disqualifier_candidates_present` — operator-actionable signal wins.
 *  2. `qualified` — all clauses pass.
 *  3. `unqualified` — at least one clause fails, with reason list.
 */
export function evaluateQualification(
  signals: QualificationSignals,
  treatment: TreatmentResolution,
): QualificationVerdict {
  // (1) Disqualifier candidates take precedence — these need operator review.
  if (signals.disqualifierCandidates.length > 0) {
    return {
      verdict: "disqualifier_candidates_present",
      candidates: signals.disqualifierCandidates,
    };
  }

  const reasons: QualificationFailureReason[] = [];
  if (!treatment.resolved) reasons.push("treatment_unresolved");
  if (signals.serviceableMarket === "out_of_area") reasons.push("out_of_area");
  if (signals.serviceableMarket === "unknown") reasons.push("market_unknown");
  if (signals.buyingIntent === "none") reasons.push("no_buying_intent");
  if (signals.explicitDecline) reasons.push("explicit_decline");

  if (reasons.length === 0 && treatment.resolved) {
    return { verdict: "qualified", serviceId: treatment.serviceId };
  }

  return { verdict: "unqualified", reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/qualification/__tests__/qualification-rule-evaluator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/conversation-lifecycle/qualification/qualification-rule-evaluator.ts \
        packages/core/src/conversation-lifecycle/qualification/__tests__/qualification-rule-evaluator.test.ts
git commit -m "feat(core): phase 3b — deterministic qualification rule evaluator

Maps QualificationSignals + TreatmentResolution to one of three verdicts:
  - disqualifier_candidates_present (operator review needed — wins over
    other reasons because it's operator-actionable)
  - qualified
  - unqualified (with structured reasons for 3c knowledge-gap analytics)

Implements spec §5.1 with explicit reason taxonomy."
```

---

### Task 10: `isPendingDisqualification` predicate + disqualification resolver

**Files:**
- Create: `packages/core/src/conversation-lifecycle/qualification/predicates.ts`
- Create: `packages/core/src/conversation-lifecycle/qualification/__tests__/predicates.test.ts`
- Create: `packages/core/src/conversation-lifecycle/qualification/disqualification-resolver.ts`
- Create: `packages/core/src/conversation-lifecycle/qualification/__tests__/disqualification-resolver.test.ts`

- [ ] **Step 1: Write the predicates failing test**

```ts
// packages/core/src/conversation-lifecycle/qualification/__tests__/predicates.test.ts
import { describe, expect, it } from "vitest";
import type { ConversationLifecycleSnapshot } from "@switchboard/schemas";
import { isPendingDisqualification } from "../predicates.js";

const base: ConversationLifecycleSnapshot = {
  conversationThreadId: "t",
  organizationId: "o",
  contactId: "c",
  currentState: "active",
  qualificationStatus: "unknown",
  bookingStatus: "not_booked",
  dropoffReason: null,
  lastTransitionAt: new Date(),
  lastEvaluatedAt: new Date(),
  updatedAt: new Date(),
};

describe("isPendingDisqualification", () => {
  it("true when qualificationStatus=proposed_disqualified AND currentState!=disqualified", () => {
    expect(
      isPendingDisqualification({ ...base, qualificationStatus: "proposed_disqualified" }),
    ).toBe(true);
  });

  it("false when operator already confirmed (currentState=disqualified)", () => {
    expect(
      isPendingDisqualification({
        ...base,
        qualificationStatus: "proposed_disqualified",
        currentState: "disqualified",
      }),
    ).toBe(false);
  });

  it("false when qualificationStatus is anything other than proposed_disqualified", () => {
    expect(isPendingDisqualification({ ...base, qualificationStatus: "qualified" })).toBe(false);
    expect(isPendingDisqualification({ ...base, qualificationStatus: "unqualified" })).toBe(false);
    expect(isPendingDisqualification({ ...base, qualificationStatus: "unknown" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/qualification/__tests__/predicates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the predicate**

```ts
// packages/core/src/conversation-lifecycle/qualification/predicates.ts
import type { ConversationLifecycleSnapshot } from "@switchboard/schemas";

/**
 * Spec §8.1 query doctrine.
 *
 * Pending proposal = qualificationStatus is `proposed_disqualified` AND
 * the operator has not yet confirmed (currentState is not `disqualified`).
 *
 * Use this predicate for every "pending disqualifications" query —
 * the operator panel, future Recommendations v1 surfaces, ad-hoc analytics.
 * `currentState == "disqualified"` is the canonical operator-confirmed
 * terminal signal; never infer disqualification from qualificationStatus alone.
 */
export function isPendingDisqualification(snapshot: ConversationLifecycleSnapshot): boolean {
  return (
    snapshot.qualificationStatus === "proposed_disqualified" &&
    snapshot.currentState !== "disqualified"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/qualification/__tests__/predicates.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the disqualification-resolver failing test**

```ts
// packages/core/src/conversation-lifecycle/qualification/__tests__/disqualification-resolver.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ConversationLifecycleSnapshot, ConversationLifecycleTransition } from "@switchboard/schemas";
import { DisqualificationResolver } from "../disqualification-resolver.js";

function setup(
  snapshot: ConversationLifecycleSnapshot | null,
  proposedEvidence: { priorQualificationStatus?: "unknown" | "unqualified" | "qualified" } = {
    priorQualificationStatus: "unknown",
  },
) {
  const snapshotStore = { read: vi.fn().mockResolvedValue(snapshot) };
  const transitionStore = {
    listForThread: vi.fn().mockResolvedValue([
      {
        id: "tr_1",
        organizationId: "o",
        conversationThreadId: "t",
        contactId: "c",
        fromState: snapshot?.currentState ?? null,
        toState: snapshot?.currentState ?? "active",
        trigger: "system_proposed_disqualification",
        evidence: proposedEvidence,
        actor: "alex",
        workTraceId: null,
        occurredAt: new Date(),
      } as ConversationLifecycleTransition,
    ]),
  };
  const writer = {
    recordTransition: vi.fn().mockResolvedValue(undefined),
    updateQualificationStatus: vi.fn().mockResolvedValue(undefined),
  };
  const resolver = new DisqualificationResolver({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshotStore: snapshotStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transitionStore: transitionStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writer: writer as any,
  });
  return { resolver, snapshotStore, transitionStore, writer };
}

const baseSnapshot: ConversationLifecycleSnapshot = {
  conversationThreadId: "t",
  organizationId: "o",
  contactId: "c",
  currentState: "active",
  qualificationStatus: "proposed_disqualified",
  bookingStatus: "not_booked",
  dropoffReason: null,
  lastTransitionAt: new Date(),
  lastEvaluatedAt: new Date(),
  updatedAt: new Date(),
};

describe("DisqualificationResolver.confirm", () => {
  it("advances currentState to disqualified when proposal is pending", async () => {
    const { resolver, writer } = setup(baseSnapshot);
    const out = await resolver.confirm({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "confirmed" });
    expect(writer.recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "disqualified",
        trigger: "operator_confirmed_disqualification",
      }),
    );
  });

  it("returns already_applied (idempotent) when thread is already disqualified AND has proposal lineage", async () => {
    // Default setup helper seeds a single system_proposed_disqualification transition,
    // so the lineage check passes.
    const { resolver, writer } = setup({ ...baseSnapshot, currentState: "disqualified" });
    const out = await resolver.confirm({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "already_applied" });
    expect(writer.recordTransition).not.toHaveBeenCalled();
  });

  it("returns conflict already_disqualified when thread is disqualified but no proposal lineage exists", async () => {
    // Forward-compatible guard: future phases may introduce other paths to terminal
    // disqualified (auto-spam, mass-disqualify). In that case, this endpoint must
    // not silently rubber-stamp the prior decision.
    const snapshotStore = { read: vi.fn().mockResolvedValue({ ...baseSnapshot, currentState: "disqualified" }) };
    const transitionStore = { listForThread: vi.fn().mockResolvedValue([]) }; // no proposal lineage
    const writer = {
      recordTransition: vi.fn().mockResolvedValue(undefined),
      updateQualificationStatus: vi.fn().mockResolvedValue(undefined),
    };
    const resolver = new DisqualificationResolver({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore: snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transitionStore: transitionStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writer: writer as any,
    });

    const out = await resolver.confirm({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "conflict", reason: "already_disqualified" });
    expect(writer.recordTransition).not.toHaveBeenCalled();
  });

  it("returns conflict already_booked when thread is booked", async () => {
    const { resolver } = setup({ ...baseSnapshot, currentState: "booked" });
    const out = await resolver.confirm({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "conflict", reason: "already_booked" });
  });

  it("returns not_found when no snapshot exists", async () => {
    const { resolver } = setup(null);
    const out = await resolver.confirm({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "not_found" });
  });

  it("returns not_proposed when qualificationStatus is not proposed_disqualified", async () => {
    const { resolver } = setup({ ...baseSnapshot, qualificationStatus: "qualified" });
    const out = await resolver.confirm({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "conflict", reason: "not_proposed" });
  });

  it("allows confirm from escalated", async () => {
    const { resolver, writer } = setup({ ...baseSnapshot, currentState: "escalated" });
    const out = await resolver.confirm({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "confirmed" });
    expect(writer.recordTransition).toHaveBeenCalled();
  });
});

describe("DisqualificationResolver.dismiss", () => {
  it("restores prior qualificationStatus from latest proposed_disqualification evidence", async () => {
    const { resolver, writer } = setup(
      { ...baseSnapshot, qualificationStatus: "proposed_disqualified" },
      { priorQualificationStatus: "qualified" },
    );
    const out = await resolver.dismiss({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "dismissed", restoredStatus: "qualified" });
    expect(writer.updateQualificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        toQualificationStatus: "qualified",
        trigger: "operator_dismissed_disqualification",
      }),
    );
  });

  it("returns conflict not_proposed when no pending proposal", async () => {
    const { resolver } = setup({ ...baseSnapshot, qualificationStatus: "qualified" });
    const out = await resolver.dismiss({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "conflict", reason: "not_proposed" });
  });

  it("defaults restoredStatus to 'unknown' when evidence omits priorQualificationStatus", async () => {
    const { resolver, writer } = setup({ ...baseSnapshot }, {});
    const out = await resolver.dismiss({ organizationId: "o", conversationThreadId: "t", operatorId: "op_1" });
    expect(out).toEqual({ result: "dismissed", restoredStatus: "unknown" });
    expect(writer.updateQualificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({ toQualificationStatus: "unknown" }),
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/qualification/__tests__/disqualification-resolver.test.ts`
Expected: FAIL.

- [ ] **Step 7: Write the resolver**

```ts
// packages/core/src/conversation-lifecycle/qualification/disqualification-resolver.ts
import type {
  ConversationLifecycleTransition,
  LifecycleQualificationStatus,
} from "@switchboard/schemas";
import type { LifecycleSnapshotStore, LifecycleTransitionStore } from "../types.js";
import type { LifecycleWriter } from "../lifecycle-writer.js";

export interface DisqualificationResolverDeps {
  snapshotStore: Pick<LifecycleSnapshotStore, "read">;
  transitionStore: Pick<LifecycleTransitionStore, "listForThread">;
  writer: Pick<LifecycleWriter, "recordTransition" | "updateQualificationStatus">;
}

export type ConfirmResult =
  | { result: "confirmed" }
  | { result: "already_applied" }
  | { result: "not_found" }
  | { result: "conflict"; reason: "already_booked" | "not_proposed" | "already_disqualified" };

export type DismissResult =
  | { result: "dismissed"; restoredStatus: LifecycleQualificationStatus }
  | { result: "not_found" }
  | { result: "conflict"; reason: "not_proposed" };

export interface ResolveInput {
  organizationId: string;
  conversationThreadId: string;
  operatorId: string;
  operatorNote?: string;
}

export class DisqualificationResolver {
  constructor(private readonly deps: DisqualificationResolverDeps) {}

  async confirm(input: ResolveInput): Promise<ConfirmResult> {
    const snapshot = await this.deps.snapshotStore.read(input.conversationThreadId);
    if (snapshot === null) return { result: "not_found" };

    if (snapshot.currentState === "disqualified") {
      // Lineage-gated idempotency: only return already_applied when this thread's
      // history contains a system_proposed_disqualification. Otherwise the thread
      // reached `disqualified` via some other path (future phase) and this endpoint
      // must not silently approve it.
      const proposalLineageId = await this.findLatestProposalTransitionId(
        input.conversationThreadId,
      );
      if (proposalLineageId !== null) return { result: "already_applied" };
      return { result: "conflict", reason: "already_disqualified" };
    }

    if (snapshot.currentState === "booked") {
      return { result: "conflict", reason: "already_booked" };
    }
    if (snapshot.qualificationStatus !== "proposed_disqualified") {
      return { result: "conflict", reason: "not_proposed" };
    }

    const proposalTransitionId = await this.findLatestProposalTransitionId(
      input.conversationThreadId,
    );

    await this.deps.writer.recordTransition({
      organizationId: input.organizationId,
      conversationThreadId: input.conversationThreadId,
      contactId: snapshot.contactId,
      toState: "disqualified",
      trigger: "operator_confirmed_disqualification",
      actor: "operator",
      evidence: {
        operatorId: input.operatorId,
        confirmedAt: new Date().toISOString(),
        operatorNote: input.operatorNote ?? null,
        proposalTransitionId,
      },
    });

    return { result: "confirmed" };
  }

  async dismiss(input: ResolveInput): Promise<DismissResult> {
    const snapshot = await this.deps.snapshotStore.read(input.conversationThreadId);
    if (snapshot === null) return { result: "not_found" };
    if (snapshot.qualificationStatus !== "proposed_disqualified") {
      return { result: "conflict", reason: "not_proposed" };
    }

    const proposalEvidence = await this.findLatestProposalEvidence(input.conversationThreadId);
    const restoredStatus: LifecycleQualificationStatus =
      isLifecycleQualificationStatus(proposalEvidence?.priorQualificationStatus)
        ? proposalEvidence.priorQualificationStatus
        : "unknown";

    await this.deps.writer.updateQualificationStatus({
      organizationId: input.organizationId,
      conversationThreadId: input.conversationThreadId,
      contactId: snapshot.contactId,
      toQualificationStatus: restoredStatus,
      trigger: "operator_dismissed_disqualification",
      actor: "operator",
      evidence: {
        operatorId: input.operatorId,
        dismissedAt: new Date().toISOString(),
        operatorNote: input.operatorNote ?? null,
      },
    });

    return { result: "dismissed", restoredStatus };
  }

  private async findLatestProposalTransitionId(threadId: string): Promise<string | null> {
    const transitions = await this.deps.transitionStore.listForThread(threadId);
    for (let i = transitions.length - 1; i >= 0; i -= 1) {
      if (transitions[i].trigger === "system_proposed_disqualification") return transitions[i].id;
    }
    return null;
  }

  private async findLatestProposalEvidence(
    threadId: string,
  ): Promise<{ priorQualificationStatus?: LifecycleQualificationStatus } | null> {
    const transitions = await this.deps.transitionStore.listForThread(threadId);
    for (let i = transitions.length - 1; i >= 0; i -= 1) {
      if (transitions[i].trigger === "system_proposed_disqualification") {
        return transitions[i].evidence as { priorQualificationStatus?: LifecycleQualificationStatus };
      }
    }
    return null;
  }
}

function isLifecycleQualificationStatus(v: unknown): v is LifecycleQualificationStatus {
  return v === "unknown" || v === "unqualified" || v === "qualified" || v === "proposed_disqualified";
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/qualification/__tests__/disqualification-resolver.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: success. If `LifecycleSnapshotStore.read` or `LifecycleTransitionStore.listForThread` don't exist as public methods today, add them as part of this task (they're already used by the writer's `rebuildSnapshotFromTransitions`).

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/conversation-lifecycle/qualification/predicates.ts \
        packages/core/src/conversation-lifecycle/qualification/__tests__/predicates.test.ts \
        packages/core/src/conversation-lifecycle/qualification/disqualification-resolver.ts \
        packages/core/src/conversation-lifecycle/qualification/__tests__/disqualification-resolver.test.ts
git commit -m "feat(core): phase 3b — isPendingDisqualification predicate + DisqualificationResolver

Predicate codifies spec §8.1 query doctrine — pending proposal requires
qualificationStatus=proposed_disqualified AND currentState!=disqualified.

Resolver wraps operator confirm/dismiss state machine:
  - confirm: advances currentState to disqualified via writer.recordTransition;
    idempotent when already disqualified; 409 when booked or not_proposed
  - dismiss: restores priorQualificationStatus from latest proposal
    transition's evidence (defaults to 'unknown' if missing); 409 when
    not_proposed"
```

---

### Task 11: `LifecycleConfigResolver` — qualification sub-flag → capability set

**Files:**
- Modify: `packages/core/src/conversation-lifecycle/lifecycle-config-resolver.ts`
- Create: `packages/core/src/conversation-lifecycle/__tests__/lifecycle-config-resolver-qualification.test.ts`

- [ ] **Step 1: Inspect the 3a resolver shape**

```bash
cat packages/core/src/conversation-lifecycle/lifecycle-config-resolver.ts
```

Expected: a class or function that reads `lifecycleTagging.mechanical.mode` per org and returns the mechanical capability. Phase 3b adds the qualification capability alongside.

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/src/conversation-lifecycle/__tests__/lifecycle-config-resolver-qualification.test.ts
import { describe, expect, it, vi } from "vitest";
import { LifecycleConfigResolver } from "../lifecycle-config-resolver.js";

describe("LifecycleConfigResolver — qualification capability", () => {
  function makeResolver(config: unknown) {
    return new LifecycleConfigResolver({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      governanceConfigResolver: { resolve: vi.fn().mockResolvedValue(config) } as any,
    });
  }

  it("returns empty set when both flags are off", async () => {
    const resolver = makeResolver({ alexMedspaSgMyGovernanceV1: { lifecycleTagging: {} } });
    expect(await resolver.resolveCapabilities("o")).toEqual(new Set());
  });

  it("returns {mechanical} when only mechanical is on", async () => {
    const resolver = makeResolver({
      alexMedspaSgMyGovernanceV1: { lifecycleTagging: { mechanical: { mode: "on" } } },
    });
    expect(await resolver.resolveCapabilities("o")).toEqual(new Set(["mechanical"]));
  });

  it("returns {mechanical, qualification} when both are on", async () => {
    const resolver = makeResolver({
      alexMedspaSgMyGovernanceV1: {
        lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
      },
    });
    expect(await resolver.resolveCapabilities("o")).toEqual(
      new Set(["mechanical", "qualification"]),
    );
  });

  it("auto-enables mechanical when qualification is on but mechanical is off (logs warn)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resolver = makeResolver({
      alexMedspaSgMyGovernanceV1: { lifecycleTagging: { qualification: { mode: "on" } } },
    });
    const caps = await resolver.resolveCapabilities("o");
    expect(caps).toEqual(new Set(["mechanical", "qualification"]));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/__tests__/lifecycle-config-resolver-qualification.test.ts`
Expected: FAIL.

- [ ] **Step 4: Extend the resolver**

Adapt the existing `LifecycleConfigResolver` to expose `resolveCapabilities(orgId): Promise<Set<LifecycleWriteCapability>>`. The exact diff depends on the 3a shape; conceptually:

```ts
// packages/core/src/conversation-lifecycle/lifecycle-config-resolver.ts
import type { LifecycleWriteCapability } from "./types.js";

export class LifecycleConfigResolver {
  // existing constructor + deps...

  async resolveCapabilities(organizationId: string): Promise<Set<LifecycleWriteCapability>> {
    const config = await this.deps.governanceConfigResolver.resolve(organizationId);
    const tagging = config?.alexMedspaSgMyGovernanceV1?.lifecycleTagging ?? {};
    const caps = new Set<LifecycleWriteCapability>();

    const mechanicalOn = tagging.mechanical?.mode === "on";
    const qualificationOn = tagging.qualification?.mode === "on";

    if (mechanicalOn) caps.add("mechanical");
    if (qualificationOn) caps.add("qualification");

    // Qualification implies mechanical at the resolver level. If the operator
    // turned qualification on without mechanical, log a warning and infer
    // mechanical — otherwise qualification has no snapshot to mutate.
    if (qualificationOn && !mechanicalOn) {
      console.warn(
        `[lifecycle] org ${organizationId}: lifecycleTagging.qualification=on but mechanical=off; auto-enabling mechanical for this org`,
      );
      caps.add("mechanical");
    }

    return caps;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/__tests__/lifecycle-config-resolver-qualification.test.ts`
Expected: PASS.

- [ ] **Step 6: Run all conversation-lifecycle tests to confirm 3a unaffected**

```bash
pnpm --filter @switchboard/core test src/conversation-lifecycle/
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/conversation-lifecycle/lifecycle-config-resolver.ts \
        packages/core/src/conversation-lifecycle/__tests__/lifecycle-config-resolver-qualification.test.ts
git commit -m "feat(core): phase 3b — LifecycleConfigResolver.resolveCapabilities

Reads lifecycleTagging.mechanical and lifecycleTagging.qualification
sub-flags per org and returns the Set<LifecycleWriteCapability>.

Qualification implies mechanical at the resolver level — turning on
qualification without mechanical auto-enables mechanical (with a
console.warn) since qualification has no snapshot to mutate otherwise."
```

---

### Task 12: Event hook — `qualification-evaluation-hook`

**Files:**
- Create: `packages/core/src/conversation-lifecycle/event-hooks/qualification-evaluation-hook.ts`
- Create: `packages/core/src/conversation-lifecycle/event-hooks/__tests__/qualification-evaluation-hook.test.ts`

This hook fires when `SkillExecutor` produces a `SkillExecutionResult` carrying a validated `qualificationSignals`. It evaluates the rule, then either:
- emits `recordTransition(toState: "qualified", ...)` via writer (rule passes),
- emits `updateQualificationStatus(toQualificationStatus: "proposed_disqualified", ...)` via writer (disqualifier candidates present),
- no-op (rule fails without candidates).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/conversation-lifecycle/event-hooks/__tests__/qualification-evaluation-hook.test.ts
import { describe, expect, it, vi } from "vitest";
import type { QualificationSignals, ConversationLifecycleSnapshot, Playbook } from "@switchboard/schemas";
import { QualificationEvaluationHook } from "../qualification-evaluation-hook.js";

const validSignals: QualificationSignals = {
  treatmentInterest: "HIFU",
  preferredTimeWindow: null,
  serviceableMarket: "SG",
  buyingIntent: "soft",
  budgetAcknowledged: null,
  explicitDecline: false,
  disqualifierCandidates: [],
};

const baseSnapshot: ConversationLifecycleSnapshot = {
  conversationThreadId: "t",
  organizationId: "o",
  contactId: "c",
  currentState: "active",
  qualificationStatus: "unknown",
  bookingStatus: "not_booked",
  dropoffReason: null,
  lastTransitionAt: new Date(),
  lastEvaluatedAt: new Date(),
  updatedAt: new Date(),
};

function setup({
  snapshot,
  playbookServices = ["HIFU"],
  capabilities = new Set(["mechanical", "qualification"] as const),
}: {
  snapshot: ConversationLifecycleSnapshot | null;
  playbookServices?: string[];
  capabilities?: ReadonlySet<"mechanical" | "qualification">;
}) {
  const writer = {
    recordTransition: vi.fn().mockResolvedValue(undefined),
    updateQualificationStatus: vi.fn().mockResolvedValue(undefined),
  };
  const snapshotStore = { read: vi.fn().mockResolvedValue(snapshot) };
  const playbookReader = {
    readForOrganization: vi.fn().mockResolvedValue({
      services: playbookServices.map((name, i) => ({
        id: `svc_${i}`,
        name,
        bookingBehavior: "ask_first",
        status: "complete",
        source: "manual",
      })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as Playbook),
  };
  const configResolver = { resolveCapabilities: vi.fn().mockResolvedValue(capabilities) };

  const hook = new QualificationEvaluationHook({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writer: writer as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshotStore: snapshotStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    playbookReader: playbookReader as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configResolver: configResolver as any,
  });

  return { hook, writer, snapshotStore, playbookReader, configResolver };
}

describe("QualificationEvaluationHook", () => {
  it("no-ops entirely when qualification capability is off", async () => {
    const { hook, writer } = setup({
      snapshot: baseSnapshot,
      capabilities: new Set(["mechanical"] as const),
    });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: validSignals,
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).not.toHaveBeenCalled();
    expect(writer.updateQualificationStatus).not.toHaveBeenCalled();
  });

  it("writes qualified when rule passes", async () => {
    const { hook, writer } = setup({ snapshot: baseSnapshot });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: validSignals,
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "qualified",
        trigger: "qualification_checklist_met",
      }),
    );
  });

  it("writes proposed_disqualified with evidence including priorQualificationStatus", async () => {
    const { hook, writer } = setup({
      snapshot: { ...baseSnapshot, qualificationStatus: "qualified" },
    });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: {
        ...validSignals,
        disqualifierCandidates: [{ type: "out_of_area", evidence: "lives in NY" }],
      },
      workTraceId: "wt_1",
    });
    expect(writer.updateQualificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        toQualificationStatus: "proposed_disqualified",
        trigger: "system_proposed_disqualification",
        evidence: expect.objectContaining({ priorQualificationStatus: "qualified" }),
      }),
    );
  });

  it("does not qualify on unresolved treatmentInterest", async () => {
    const { hook, writer } = setup({ snapshot: baseSnapshot, playbookServices: [] });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: validSignals,
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).not.toHaveBeenCalled();
  });

  it("does not write a transition on a non-trivial-but-unqualified sidecar (no qualified, no proposed)", async () => {
    const { hook, writer } = setup({ snapshot: baseSnapshot });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: { ...validSignals, buyingIntent: "none" },
      workTraceId: "wt_1",
    });
    // Rule fails (no_buying_intent) but no disqualifier candidates -> no writes.
    expect(writer.recordTransition).not.toHaveBeenCalled();
    expect(writer.updateQualificationStatus).not.toHaveBeenCalled();
  });

  it("no-ops when snapshot is missing", async () => {
    const { hook, writer } = setup({ snapshot: null });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: validSignals,
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/event-hooks/__tests__/qualification-evaluation-hook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Define the `PlaybookReader` interface (re-using the existing reader from Pre-flight #6)**

If a `PlaybookReader` interface exists in core, import it. Otherwise declare:

```ts
// packages/core/src/conversation-lifecycle/qualification/types.ts (NEW or append)
import type { Playbook } from "@switchboard/schemas";

export interface PlaybookReader {
  readForOrganization(organizationId: string): Promise<Playbook | null>;
}
```

(In Pre-flight #6, document the existing reader location — if one exists, prefer importing the existing interface over defining a new one.)

- [ ] **Step 4: Write the hook**

```ts
// packages/core/src/conversation-lifecycle/event-hooks/qualification-evaluation-hook.ts
import type { QualificationSignals } from "@switchboard/schemas";
import type { LifecycleSnapshotStore, LifecycleWriteCapability } from "../types.js";
import type { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleConfigResolver } from "../lifecycle-config-resolver.js";
import type { PlaybookReader } from "../qualification/types.js";
import { resolveTreatmentInterest } from "../qualification/treatment-resolver.js";
import { evaluateQualification } from "../qualification/qualification-rule-evaluator.js";

export interface QualificationEvaluationHookDeps {
  writer: Pick<LifecycleWriter, "recordTransition" | "updateQualificationStatus">;
  snapshotStore: Pick<LifecycleSnapshotStore, "read">;
  playbookReader: PlaybookReader;
  configResolver: Pick<LifecycleConfigResolver, "resolveCapabilities">;
}

export interface SidecarEmittedEvent {
  organizationId: string;
  conversationThreadId: string;
  signals: QualificationSignals;
  /** WorkTrace id of the Alex turn that produced this sidecar (audit pointer). */
  workTraceId: string;
}

export class QualificationEvaluationHook {
  constructor(private readonly deps: QualificationEvaluationHookDeps) {}

  async onSidecarEmitted(event: SidecarEmittedEvent): Promise<void> {
    const capabilities = await this.deps.configResolver.resolveCapabilities(event.organizationId);
    if (!capabilities.has("qualification")) {
      // Flag off — lifecycle mutation is skipped. WorkTrace audit persistence
      // (by SkillExecutor in Task 5) is unaffected.
      return;
    }

    const snapshot = await this.deps.snapshotStore.read(event.conversationThreadId);
    if (snapshot === null) {
      // No mechanical snapshot exists for this thread yet. Qualification depends on
      // the mechanical layer initializing the thread; emit nothing.
      console.warn(
        `[lifecycle] qualification-evaluation-hook: no snapshot for thread ${event.conversationThreadId}; skipping`,
      );
      return;
    }

    const playbook = await this.deps.playbookReader.readForOrganization(event.organizationId);
    if (playbook === null) {
      console.warn(
        `[lifecycle] qualification-evaluation-hook: no playbook for org ${event.organizationId}; cannot resolve treatment`,
      );
      return;
    }

    const treatment = resolveTreatmentInterest(playbook, event.signals.treatmentInterest);
    const verdict = evaluateQualification(event.signals, treatment);

    if (verdict.verdict === "qualified") {
      await this.deps.writer.recordTransition({
        organizationId: event.organizationId,
        conversationThreadId: event.conversationThreadId,
        contactId: snapshot.contactId,
        toState: "qualified",
        trigger: "qualification_checklist_met",
        actor: "alex",
        evidence: {
          serviceId: verdict.serviceId,
          serviceableMarket: event.signals.serviceableMarket,
          buyingIntent: event.signals.buyingIntent,
          workTraceId: event.workTraceId,
        },
        workTraceId: event.workTraceId,
      });
      return;
    }

    if (verdict.verdict === "disqualifier_candidates_present") {
      await this.deps.writer.updateQualificationStatus({
        organizationId: event.organizationId,
        conversationThreadId: event.conversationThreadId,
        contactId: snapshot.contactId,
        toQualificationStatus: "proposed_disqualified",
        trigger: "system_proposed_disqualification",
        actor: "alex",
        evidence: {
          // Spec §5.3: store priorQualificationStatus so dismiss can restore.
          priorQualificationStatus: snapshot.qualificationStatus,
          candidates: verdict.candidates,
          workTraceId: event.workTraceId,
        },
        workTraceId: event.workTraceId,
      });
      return;
    }

    // verdict.verdict === "unqualified" — silent no-op for v1 (no transition
    // written; monotonic guard would block qualified→unqualified anyway).
    // 3c may surface knowledge-gap recommendations from the unqualified
    // reasons via separate analytics queries over WorkTrace.
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/event-hooks/__tests__/qualification-evaluation-hook.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/conversation-lifecycle/qualification/types.ts \
        packages/core/src/conversation-lifecycle/event-hooks/qualification-evaluation-hook.ts \
        packages/core/src/conversation-lifecycle/event-hooks/__tests__/qualification-evaluation-hook.test.ts
git commit -m "feat(core): phase 3b — qualification-evaluation-hook

Fires when SkillExecutor produces a SkillExecutionResult carrying a
validated qualificationSignals. Resolves the treatment, evaluates the
rule, then:
  - qualified verdict → writer.recordTransition(toState=qualified)
  - disqualifier candidates → writer.updateQualificationStatus(
      proposed_disqualified) with evidence.priorQualificationStatus
      captured so dismiss can restore
  - unqualified verdict → silent no-op (monotonic guard handles it)

Sub-flag aware: no-ops entirely when qualification capability is off.
WorkTrace audit persistence is unaffected (handled in SkillExecutor)."
```

---

### Task 13: Event hook — `disqualification-resolution-hook`

**Files:**
- Create: `packages/core/src/conversation-lifecycle/event-hooks/disqualification-resolution-hook.ts`
- Create: `packages/core/src/conversation-lifecycle/event-hooks/__tests__/disqualification-resolution-hook.test.ts`

This hook is a thin adapter that the API routes call — it composes the `DisqualificationResolver` with the capability gate. (Could alternatively be implemented as a direct API → resolver call without an intermediate "hook" wrapper; the wrapper exists so bootstrap-wiring can centralize the flag-off short-circuit.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/conversation-lifecycle/event-hooks/__tests__/disqualification-resolution-hook.test.ts
import { describe, expect, it, vi } from "vitest";
import { DisqualificationResolutionHook } from "../disqualification-resolution-hook.js";

function setup(capabilities: ReadonlySet<"mechanical" | "qualification">) {
  const resolver = {
    confirm: vi.fn().mockResolvedValue({ result: "confirmed" }),
    dismiss: vi.fn().mockResolvedValue({ result: "dismissed", restoredStatus: "unknown" }),
  };
  const configResolver = { resolveCapabilities: vi.fn().mockResolvedValue(capabilities) };
  const hook = new DisqualificationResolutionHook({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: resolver as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configResolver: configResolver as any,
  });
  return { hook, resolver, configResolver };
}

describe("DisqualificationResolutionHook", () => {
  it("rejects confirm when qualification capability is off", async () => {
    const { hook, resolver } = setup(new Set(["mechanical"] as const));
    const out = await hook.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "capability_disabled" });
    expect(resolver.confirm).not.toHaveBeenCalled();
  });

  it("delegates confirm to resolver when capability is on", async () => {
    const { hook, resolver } = setup(new Set(["mechanical", "qualification"] as const));
    const out = await hook.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "confirmed" });
    expect(resolver.confirm).toHaveBeenCalled();
  });

  it("rejects dismiss when qualification capability is off", async () => {
    const { hook, resolver } = setup(new Set(["mechanical"] as const));
    const out = await hook.dismiss({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "capability_disabled" });
    expect(resolver.dismiss).not.toHaveBeenCalled();
  });

  it("delegates dismiss to resolver when capability is on", async () => {
    const { hook, resolver } = setup(new Set(["mechanical", "qualification"] as const));
    await hook.dismiss({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(resolver.dismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/event-hooks/__tests__/disqualification-resolution-hook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the hook**

```ts
// packages/core/src/conversation-lifecycle/event-hooks/disqualification-resolution-hook.ts
import type {
  DisqualificationResolver,
  ConfirmResult,
  DismissResult,
  ResolveInput,
} from "../qualification/disqualification-resolver.js";
import type { LifecycleConfigResolver } from "../lifecycle-config-resolver.js";

export interface DisqualificationResolutionHookDeps {
  resolver: Pick<DisqualificationResolver, "confirm" | "dismiss">;
  configResolver: Pick<LifecycleConfigResolver, "resolveCapabilities">;
}

export type HookConfirmResult = ConfirmResult | { result: "capability_disabled" };
export type HookDismissResult = DismissResult | { result: "capability_disabled" };

export class DisqualificationResolutionHook {
  constructor(private readonly deps: DisqualificationResolutionHookDeps) {}

  async confirm(input: ResolveInput): Promise<HookConfirmResult> {
    const caps = await this.deps.configResolver.resolveCapabilities(input.organizationId);
    if (!caps.has("qualification")) return { result: "capability_disabled" };
    return this.deps.resolver.confirm(input);
  }

  async dismiss(input: ResolveInput): Promise<HookDismissResult> {
    const caps = await this.deps.configResolver.resolveCapabilities(input.organizationId);
    if (!caps.has("qualification")) return { result: "capability_disabled" };
    return this.deps.resolver.dismiss(input);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test src/conversation-lifecycle/event-hooks/__tests__/disqualification-resolution-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-export from the lifecycle index barrel**

```ts
// packages/core/src/conversation-lifecycle/index.ts — add exports
export * from "./qualification/treatment-resolver.js";
export * from "./qualification/qualification-rule-evaluator.js";
export * from "./qualification/disqualification-resolver.js";
export * from "./qualification/predicates.js";
export * from "./qualification/types.js";
export * from "./event-hooks/qualification-evaluation-hook.js";
export * from "./event-hooks/disqualification-resolution-hook.js";
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: success.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/conversation-lifecycle/event-hooks/disqualification-resolution-hook.ts \
        packages/core/src/conversation-lifecycle/event-hooks/__tests__/disqualification-resolution-hook.test.ts \
        packages/core/src/conversation-lifecycle/index.ts
git commit -m "feat(core): phase 3b — disqualification-resolution-hook + barrel exports

Thin adapter around DisqualificationResolver that centralizes the
capability-disabled short-circuit. API routes call this hook (Task 15)
rather than the resolver directly — keeps the flag-off path consistent
with the qualification-evaluation hook."
```

---

### Task 14: Bootstrap wiring — register hooks under qualification capability

**Files:**
- Modify: `apps/api/src/bootstrap/lifecycle.ts`
- Modify: `apps/api/src/bootstrap/lifecycle-deps.ts` (if it exists in 3a)
- Create: `apps/api/src/bootstrap/__tests__/lifecycle-qualification.test.ts`

- [ ] **Step 1: Inspect 3a bootstrap shape**

```bash
cat apps/api/src/bootstrap/lifecycle.ts
cat apps/api/src/bootstrap/lifecycle-deps.ts
```

Identify the function that builds `LifecycleWriter` + the existing hook registrations. 3b extends this with `QualificationEvaluationHook`, `DisqualificationResolver`, `DisqualificationResolutionHook`, and the `PlaybookReader` injection. Exposes the hook on the returned bootstrap result for routes (Task 15) to call.

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/bootstrap/__tests__/lifecycle-qualification.test.ts
import { describe, expect, it, vi } from "vitest";
import { bootstrapLifecycle } from "../lifecycle.js";

// NOTE: Adapt the harness to whatever the 3a bootstrap test established.
// This test asserts the 3b additions are present.

describe("bootstrapLifecycle — Phase 3b additions", () => {
  it("exposes a disqualification resolution hook on the returned bootstrap", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrap = await bootstrapLifecycle({} as any);
    expect(bootstrap.disqualificationHook).toBeDefined();
    expect(typeof bootstrap.disqualificationHook.confirm).toBe("function");
    expect(typeof bootstrap.disqualificationHook.dismiss).toBe("function");
  });

  it("exposes the qualification evaluation hook to SkillExecutor wiring", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrap = await bootstrapLifecycle({} as any);
    expect(bootstrap.qualificationEvaluationHook).toBeDefined();
    expect(typeof bootstrap.qualificationEvaluationHook.onSidecarEmitted).toBe("function");
  });

  it("constructs a LifecycleWriter wired to LifecycleConfigResolver.resolveCapabilities", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrap = await bootstrapLifecycle({} as any);
    expect(bootstrap.writer).toBeDefined();
    expect(typeof bootstrap.writer.recordTransition).toBe("function");
    expect(typeof bootstrap.writer.updateQualificationStatus).toBe("function");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/lifecycle-qualification.test.ts`
Expected: FAIL — `disqualificationHook` / `qualificationEvaluationHook` not exposed.

- [ ] **Step 4: Extend the bootstrap**

```ts
// apps/api/src/bootstrap/lifecycle.ts — additions inside bootstrapLifecycle
import { QualificationEvaluationHook } from "@switchboard/core/conversation-lifecycle/event-hooks/qualification-evaluation-hook.js";
import { DisqualificationResolver } from "@switchboard/core/conversation-lifecycle/qualification/disqualification-resolver.js";
import { DisqualificationResolutionHook } from "@switchboard/core/conversation-lifecycle/event-hooks/disqualification-resolution-hook.js";

// Inside the bootstrap function, after constructing snapshotStore, transitionStore,
// writer (already 3a code), and configResolver:

const playbookReader = deps.playbookReader; // injected per Pre-flight #6

const qualificationEvaluationHook = new QualificationEvaluationHook({
  writer,
  snapshotStore,
  playbookReader,
  configResolver,
});

const disqualificationResolver = new DisqualificationResolver({
  snapshotStore,
  transitionStore,
  writer,
});

const disqualificationHook = new DisqualificationResolutionHook({
  resolver: disqualificationResolver,
  configResolver,
});

return {
  // ... existing 3a returns (writer, snapshotStore, etc) ...
  writer,
  qualificationEvaluationHook,
  disqualificationHook,
  disqualificationResolver, // exposed for the API route's direct calls if needed
};
```

The 3b bootstrap **does not** call into `SkillExecutor` directly to subscribe — `SkillExecutor` (Task 5) emits a `SidecarEmittedEvent` through whatever local subscription pattern exists in 3a. If 3a's bootstrap also passes `lifecycleWriter` into `SkillExecutor`, extend that injection to include the `qualificationEvaluationHook` so the executor's post-output flow can call `qualificationEvaluationHook.onSidecarEmitted` when the sidecar parses cleanly. Document the executor's subscription wiring in this step (the executor's hook invocation is added in a sub-step here, not in Task 5, because the executor needs the constructed hook).

- [ ] **Step 5: Wire SkillExecutor → qualification-evaluation-hook**

In `packages/core/src/skill-runtime/skill-executor.ts` (or its construction site in `apps/api/src/bootstrap/skill-mode.ts` if executor construction lives there), inject `qualificationEvaluationHook` and call it after the sidecar parses successfully:

```ts
// After parser produces a validated payload:
if (sidecar.persisted?.validationStatus === "ok") {
  await deps.qualificationEvaluationHook
    .onSidecarEmitted({
      organizationId: executionContext.organizationId,
      conversationThreadId: executionContext.conversationThreadId,
      signals: sidecar.persisted.payload,
      workTraceId: workTrace.id,
    })
    .catch((err: unknown) => {
      // Hook failures must not break the response — log and continue.
      console.warn(
        `[lifecycle] qualification-evaluation-hook failed for thread ${executionContext.conversationThreadId}: ${String(err)}`,
      );
    });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test src/bootstrap/__tests__/lifecycle-qualification.test.ts`
Expected: PASS.

- [ ] **Step 7: Run broader bootstrap tests + typecheck**

```bash
pnpm --filter @switchboard/api test src/bootstrap/
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/core typecheck
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/bootstrap/lifecycle.ts \
        apps/api/src/bootstrap/lifecycle-deps.ts \
        apps/api/src/bootstrap/__tests__/lifecycle-qualification.test.ts \
        packages/core/src/skill-runtime/skill-executor.ts
git commit -m "feat(api): phase 3b — bootstrap wires qualification + disqualification hooks

  - bootstrapLifecycle constructs QualificationEvaluationHook,
    DisqualificationResolver, DisqualificationResolutionHook.
  - SkillExecutor invokes qualificationEvaluationHook.onSidecarEmitted
    after the parser yields a validated payload; hook failures are
    logged-and-swallowed (must not break the response path).
  - Returned bootstrap exposes the disqualification hook for routes
    (Task 15)."
```

---

### Task 15: API routes — pending list + confirm/dismiss

**Files:**
- Create: `apps/api/src/routes/lifecycle-disqualifications.ts`
- Create: `apps/api/src/__tests__/api-lifecycle-disqualifications.test.ts`
- Modify: `apps/api/src/app.ts` (register the new route)

- [ ] **Step 1: Add a `listPending` reader to the snapshot store**

The pending list query uses the spec §8.1 doctrine predicate. Add to the `LifecycleSnapshotStore` interface (in `packages/core/src/conversation-lifecycle/types.ts`):

```ts
import type { ConversationLifecycleSnapshot } from "@switchboard/schemas";

export interface LifecycleSnapshotStore {
  // ... existing methods ...
  listPendingDisqualifications(organizationId: string): Promise<ConversationLifecycleSnapshot[]>;
}
```

And implement in the Prisma adapter (`packages/db/src/prisma-conversation-lifecycle-snapshot-store.ts`):

```ts
async listPendingDisqualifications(organizationId: string): Promise<ConversationLifecycleSnapshot[]> {
  const rows = await this.prisma.conversationLifecycleSnapshot.findMany({
    where: {
      organizationId,
      qualificationStatus: "proposed_disqualified",
      currentState: { not: "disqualified" },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows.map(toSnapshot); // existing row → typed mapping helper
}
```

Add a small store test that asserts the WHERE clause includes the `not: "disqualified"` predicate.

- [ ] **Step 2: Write the failing route test**

```ts
// apps/api/src/__tests__/api-lifecycle-disqualifications.test.ts
import { describe, expect, it } from "vitest";
import { buildTestServer } from "./test-utils.js"; // existing test harness

describe("GET /api/dashboard/lifecycle/disqualifications/pending", () => {
  it("returns 200 with org-scoped pending items", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          qualificationStatus: "proposed_disqualified",
          currentState: "active",
        },
        // confirmed thread — must be excluded
        {
          conversationThreadId: "t2",
          organizationId: "o1",
          qualificationStatus: "proposed_disqualified",
          currentState: "disqualified",
        },
        // other org — must be excluded
        {
          conversationThreadId: "t3",
          organizationId: "o2",
          qualificationStatus: "proposed_disqualified",
          currentState: "active",
        },
      ],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });

    const res = await server.inject({
      method: "GET",
      url: "/api/dashboard/lifecycle/disqualifications/pending",
      headers: seed.authHeaders("o1"),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].conversationThreadId).toBe("t1");

    // Explicit doctrine assertion (spec §8.1): a thread with
    // qualificationStatus=proposed_disqualified AND currentState=disqualified
    // (operator already confirmed) MUST be excluded from the pending list.
    // The fixture above seeds t2 in that exact state. Asserting on
    // conversationThreadId values is a stronger form than length checks:
    expect(body.items.map((i: { conversationThreadId: string }) => i.conversationThreadId))
      .not.toContain("t2");
  });

  it("excludes confirmed disqualified threads (qualificationStatus=proposed_disqualified AND currentState=disqualified)", async () => {
    // Doctrine-bug regression test (spec §8.1). After operator confirm, the
    // snapshot retains qualificationStatus=proposed_disqualified while
    // currentState moves to disqualified. Without the predicate
    // `currentState != 'disqualified'`, the pending list would forever
    // include already-confirmed threads.
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t_confirmed",
          organizationId: "o1",
          qualificationStatus: "proposed_disqualified",
          currentState: "disqualified",
        },
      ],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    const res = await server.inject({
      method: "GET",
      url: "/api/dashboard/lifecycle/disqualifications/pending",
      headers: seed.authHeaders("o1"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it("returns empty list when qualification capability is off", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          qualificationStatus: "proposed_disqualified",
          currentState: "active",
        },
      ],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "off" } },
    });
    const res = await server.inject({
      method: "GET",
      url: "/api/dashboard/lifecycle/disqualifications/pending",
      headers: seed.authHeaders("o1"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });
});

describe("POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm", () => {
  it("returns 200 confirmed when proposal is pending", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          qualificationStatus: "proposed_disqualified",
          currentState: "active",
        },
      ],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/t1/confirm",
      headers: seed.authHeaders("o1"),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe("confirmed");
  });

  it("returns 200 already_applied (idempotent) when thread is already disqualified WITH proposal lineage", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          qualificationStatus: "proposed_disqualified",
          currentState: "disqualified",
        },
      ],
      lifecycleTransitions: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          trigger: "system_proposed_disqualification",
          evidence: { priorQualificationStatus: "unknown" },
        },
      ],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/t1/confirm",
      headers: seed.authHeaders("o1"),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "confirmed", alreadyApplied: true });
  });

  it("returns 409 already_disqualified when thread is disqualified WITHOUT proposal lineage", async () => {
    // Forward-compatible: if a future phase introduces another path to
    // currentState=disqualified (auto-spam, mass-disqualify), confirm must
    // not silently approve it. In 3b this case shouldn't occur in production
    // — every disqualified thread has lineage — but the guard exists.
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t_nolineage",
          organizationId: "o1",
          qualificationStatus: "unknown", // notice: not proposed_disqualified
          currentState: "disqualified",
        },
      ],
      lifecycleTransitions: [], // no proposal transition
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/t_nolineage/confirm",
      headers: seed.authHeaders("o1"),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe("already_disqualified");
  });

  it("returns 409 already_booked when thread is booked", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          qualificationStatus: "proposed_disqualified",
          currentState: "booked",
        },
      ],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/t1/confirm",
      headers: seed.authHeaders("o1"),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe("already_booked");
  });

  it("returns 404 when no snapshot exists for the thread", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/missing/confirm",
      headers: seed.authHeaders("o1"),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 / 404 when capability is off (route surfaces as not-found)", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "off" } },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/t1/confirm",
      headers: seed.authHeaders("o1"),
      payload: {},
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});

describe("POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss", () => {
  it("returns 200 dismissed with restoredStatus from proposal evidence", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          qualificationStatus: "proposed_disqualified",
          currentState: "active",
        },
      ],
      lifecycleTransitions: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          trigger: "system_proposed_disqualification",
          evidence: { priorQualificationStatus: "qualified" },
        },
      ],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/t1/dismiss",
      headers: seed.authHeaders("o1"),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "dismissed", restoredStatus: "qualified" });
  });

  it("returns 409 not_proposed when there's no pending proposal", async () => {
    const { server, seed } = await buildTestServer({
      lifecycleSnapshots: [
        {
          conversationThreadId: "t1",
          organizationId: "o1",
          qualificationStatus: "qualified",
          currentState: "qualified",
        },
      ],
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/dashboard/lifecycle/disqualifications/t1/dismiss",
      headers: seed.authHeaders("o1"),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe("not_proposed");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test src/__tests__/api-lifecycle-disqualifications.test.ts`
Expected: FAIL — routes not registered.

- [ ] **Step 4: Write the route module**

```ts
// apps/api/src/routes/lifecycle-disqualifications.ts
import type { FastifyInstance } from "fastify";
import { isPendingDisqualification } from "@switchboard/core/conversation-lifecycle/qualification/predicates.js";

export interface LifecycleDisqualificationsRouteDeps {
  // From bootstrap (Task 14)
  snapshotStore: { listPendingDisqualifications: (orgId: string) => Promise<unknown[]> };
  transitionStore: {
    findLatestProposal: (
      threadId: string,
    ) => Promise<{ evidence: Record<string, unknown> } | null>;
  };
  disqualificationHook: {
    confirm: (input: {
      organizationId: string;
      conversationThreadId: string;
      operatorId: string;
      operatorNote?: string;
    }) => Promise<
      | { result: "confirmed" }
      | { result: "already_applied" }
      | { result: "not_found" }
      | { result: "conflict"; reason: "already_booked" | "not_proposed" | "already_disqualified" }
      | { result: "capability_disabled" }
    >;
    dismiss: (input: {
      organizationId: string;
      conversationThreadId: string;
      operatorId: string;
      operatorNote?: string;
    }) => Promise<
      | { result: "dismissed"; restoredStatus: string }
      | { result: "not_found" }
      | { result: "conflict"; reason: "not_proposed" }
      | { result: "capability_disabled" }
    >;
  };
}

export async function registerLifecycleDisqualificationsRoutes(
  app: FastifyInstance,
  deps: LifecycleDisqualificationsRouteDeps,
): Promise<void> {
  // GET /api/dashboard/lifecycle/disqualifications/pending
  app.get("/api/dashboard/lifecycle/disqualifications/pending", async (req, reply) => {
    const session = req.session; // existing auth middleware
    const orgId = session.organizationId;

    // Fetch pending snapshots and the latest proposal evidence per thread.
    const snapshots = await deps.snapshotStore.listPendingDisqualifications(orgId);
    const items: Array<Record<string, unknown>> = [];
    for (const snap of snapshots) {
      // The store query already applies the doctrine predicate (§8.1); we
      // assert it again here in dev so a future store regression surfaces.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!isPendingDisqualification(snap as any)) continue;
      const proposal = await deps.transitionStore.findLatestProposal(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (snap as any).conversationThreadId,
      );
      items.push({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conversationThreadId: (snap as any).conversationThreadId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contactId: (snap as any).contactId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentState: (snap as any).currentState,
        evidence: proposal?.evidence ?? null,
      });
    }
    return reply.code(200).send({ items });
  });

  // POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm
  app.post<{
    Params: { threadId: string };
    Body: { operatorNote?: string };
  }>("/api/dashboard/lifecycle/disqualifications/:threadId/confirm", async (req, reply) => {
    const session = req.session;
    const out = await deps.disqualificationHook.confirm({
      organizationId: session.organizationId,
      conversationThreadId: req.params.threadId,
      operatorId: session.userId,
      operatorNote: req.body?.operatorNote,
    });
    if (out.result === "confirmed") return reply.code(200).send({ result: "confirmed" });
    if (out.result === "already_applied")
      return reply.code(200).send({ result: "confirmed", alreadyApplied: true });
    if (out.result === "not_found") return reply.code(404).send({ reason: "not_found" });
    if (out.result === "capability_disabled")
      return reply.code(404).send({ reason: "not_found" });
    // out.result === "conflict" — reasons: already_booked | not_proposed | already_disqualified
    return reply.code(409).send({ reason: out.reason });
  });

  // POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss
  app.post<{
    Params: { threadId: string };
    Body: { operatorNote?: string };
  }>("/api/dashboard/lifecycle/disqualifications/:threadId/dismiss", async (req, reply) => {
    const session = req.session;
    const out = await deps.disqualificationHook.dismiss({
      organizationId: session.organizationId,
      conversationThreadId: req.params.threadId,
      operatorId: session.userId,
      operatorNote: req.body?.operatorNote,
    });
    if (out.result === "dismissed")
      return reply
        .code(200)
        .send({ result: "dismissed", restoredStatus: out.restoredStatus });
    if (out.result === "not_found") return reply.code(404).send({ reason: "not_found" });
    if (out.result === "capability_disabled")
      return reply.code(404).send({ reason: "not_found" });
    return reply.code(409).send({ reason: out.reason });
  });
}
```

- [ ] **Step 5: Register the route in `app.ts`**

```ts
// apps/api/src/app.ts — additions
import { registerLifecycleDisqualificationsRoutes } from "./routes/lifecycle-disqualifications.js";

// Inside the app-building function, after bootstrap completes:
await registerLifecycleDisqualificationsRoutes(app, {
  snapshotStore: bootstrap.snapshotStore,
  transitionStore: bootstrap.transitionStore, // requires findLatestProposal helper
  disqualificationHook: bootstrap.disqualificationHook,
});
```

If `findLatestProposal` doesn't yet exist on the transition store, add it as a small thin adapter (queries `WHERE conversationThreadId = ? AND trigger = 'system_proposed_disqualification' ORDER BY occurredAt DESC LIMIT 1`).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test src/__tests__/api-lifecycle-disqualifications.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: success.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/lifecycle-disqualifications.ts \
        apps/api/src/__tests__/api-lifecycle-disqualifications.test.ts \
        apps/api/src/app.ts \
        packages/core/src/conversation-lifecycle/types.ts \
        packages/db/src/prisma-conversation-lifecycle-snapshot-store.ts \
        packages/db/src/prisma-conversation-lifecycle-transition-store.ts
git commit -m "feat(api): phase 3b — lifecycle disqualifications API routes

  - GET /api/dashboard/lifecycle/disqualifications/pending
    Returns org-scoped pending proposals using the §8.1 doctrine predicate.
  - POST .../:threadId/confirm
    Confirms operator decision; 200 confirmed | 200 already_applied
    (idempotent) | 404 not_found | 409 already_booked / not_proposed.
  - POST .../:threadId/dismiss
    Restores priorQualificationStatus from evidence; 200 dismissed |
    404 not_found | 409 not_proposed.

  Capability-off paths surface as 404 (route appears non-existent to
  consumers — flag-flip is a config event, not an API contract change)."
```

---

### Task 16: Dashboard panel — `/operator` proposed disqualifications

**Files:**
- Create: `apps/dashboard/src/app/(auth)/operator/_components/proposed-disqualifications-panel.tsx`
- Create: `apps/dashboard/src/app/(auth)/operator/_components/disqualification-row.tsx`
- Modify: `apps/dashboard/src/app/(auth)/operator/page.tsx`
- Create: `apps/dashboard/src/app/api/dashboard/lifecycle/disqualifications/route.ts` (Next.js proxy)
- Create: `apps/dashboard/src/app/api/dashboard/lifecycle/disqualifications/[threadId]/[action]/route.ts`
- Create: `apps/dashboard/src/hooks/use-pending-disqualifications.ts`
- Create: `apps/dashboard/src/hooks/use-resolve-disqualification.ts`
- Create: `apps/dashboard/src/app/(auth)/operator/__tests__/proposed-disqualifications-panel.test.tsx`

- [ ] **Step 1: Inspect the existing `/operator` page**

```bash
cat apps/dashboard/src/app/\(auth\)/operator/page.tsx
ls apps/dashboard/src/app/\(auth\)/operator/
```

Identify the page's existing layout / Server Component structure so the new panel slots in without disturbing the existing operator queue.

- [ ] **Step 2: Write the Next.js proxy routes**

```ts
// apps/dashboard/src/app/api/dashboard/lifecycle/disqualifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { proxyToApi } from "@/lib/api-proxy";

export async function GET(req: NextRequest) {
  return proxyToApi(req, "/api/dashboard/lifecycle/disqualifications/pending");
}
```

```ts
// apps/dashboard/src/app/api/dashboard/lifecycle/disqualifications/[threadId]/[action]/route.ts
import { NextRequest } from "next/server";
import { proxyToApi } from "@/lib/api-proxy";

export async function POST(
  req: NextRequest,
  { params }: { params: { threadId: string; action: "confirm" | "dismiss" } },
) {
  if (params.action !== "confirm" && params.action !== "dismiss") {
    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400 });
  }
  return proxyToApi(
    req,
    `/api/dashboard/lifecycle/disqualifications/${params.threadId}/${params.action}`,
  );
}
```

(Adapt to whatever proxy helper the dashboard uses today — match the existing `/api/dashboard/...` proxy pattern.)

- [ ] **Step 3: React Query hooks**

```ts
// apps/dashboard/src/hooks/use-pending-disqualifications.ts
import { useQuery } from "@tanstack/react-query";

export interface PendingDisqualification {
  conversationThreadId: string;
  contactId: string;
  currentState: string;
  evidence:
    | {
        candidates?: Array<{ type: string; evidence: string }>;
        candidateType?: string;
        evidenceQuote?: string;
        priorQualificationStatus?: string;
        workTraceId?: string;
      }
    | null;
}

export function usePendingDisqualifications() {
  return useQuery({
    queryKey: ["lifecycle", "disqualifications", "pending"],
    queryFn: async (): Promise<{ items: PendingDisqualification[] }> => {
      const res = await fetch("/api/dashboard/lifecycle/disqualifications");
      if (!res.ok) throw new Error(`Failed to load pending disqualifications: ${res.status}`);
      return res.json();
    },
  });
}
```

```ts
// apps/dashboard/src/hooks/use-resolve-disqualification.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useResolveDisqualification(
  action: "confirm" | "dismiss",
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, note }: { threadId: string; note?: string }) => {
      const res = await fetch(
        `/api/dashboard/lifecycle/disqualifications/${threadId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operatorNote: note ?? undefined }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        const reason = body?.reason ?? "unknown_error";
        const err = new Error(reason);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any).reason = reason;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any).status = res.status;
        throw err;
      }
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lifecycle", "disqualifications", "pending"] });
    },
  });
}
```

- [ ] **Step 4: Write the panel components**

```tsx
// apps/dashboard/src/app/(auth)/operator/_components/proposed-disqualifications-panel.tsx
"use client";
import { usePendingDisqualifications } from "@/hooks/use-pending-disqualifications";
import { DisqualificationRow } from "./disqualification-row";

export function ProposedDisqualificationsPanel() {
  const { data, isLoading, error } = usePendingDisqualifications();

  if (isLoading) {
    return (
      <section className="border-t pt-6 mt-6">
        <h2 className="section-label">Proposed disqualifications</h2>
        <p className="text-muted-foreground text-sm mt-2">Loading…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="border-t pt-6 mt-6">
        <h2 className="section-label">Proposed disqualifications</h2>
        <p className="text-destructive text-sm mt-2">Could not load proposals.</p>
      </section>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <section className="border-t pt-6 mt-6">
        <h2 className="section-label">Proposed disqualifications</h2>
        <p className="text-muted-foreground text-sm mt-2">No proposals pending.</p>
      </section>
    );
  }

  return (
    <section className="border-t pt-6 mt-6">
      <header className="flex items-baseline justify-between">
        <h2 className="section-label">
          Proposed disqualifications · {items.length} pending
        </h2>
      </header>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2 font-normal">Thread</th>
            <th className="py-2 font-normal">Candidate</th>
            <th className="py-2 font-normal">Evidence</th>
            <th className="py-2 font-normal text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <DisqualificationRow key={item.conversationThreadId} item={item} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

```tsx
// apps/dashboard/src/app/(auth)/operator/_components/disqualification-row.tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { useResolveDisqualification, type PendingDisqualification } from "@/hooks/use-pending-disqualifications";

export function DisqualificationRow({ item }: { item: PendingDisqualification }) {
  const confirm = useResolveDisqualification("confirm");
  const dismiss = useResolveDisqualification("dismiss");
  const [busy, setBusy] = useState(false);

  function describeCandidate(): string {
    const candidates = item.evidence?.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates.map((c) => c.type).join(", ");
    }
    return item.evidence?.candidateType ?? "—";
  }

  function describeQuote(): string {
    const candidates = item.evidence?.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates[0].evidence;
    }
    return item.evidence?.evidenceQuote ?? "";
  }

  async function handle(action: "confirm" | "dismiss") {
    setBusy(true);
    try {
      await (action === "confirm" ? confirm : dismiss).mutateAsync({
        threadId: item.conversationThreadId,
      });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reason = (err as any)?.reason ?? "error";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.status;
      if (status === 409) {
        toast.info(
          reason === "already_booked"
            ? "Thread already booked — proposal dismissed automatically."
            : "Proposal no longer pending.",
        );
      } else {
        toast.error(`Could not ${action}: ${reason}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t">
      <td className="py-3 align-top">
        <code className="text-xs">{item.conversationThreadId.slice(0, 12)}</code>
      </td>
      <td className="py-3 align-top">{describeCandidate()}</td>
      <td className="py-3 align-top max-w-md">
        <span className="text-muted-foreground italic">{describeQuote()}</span>
      </td>
      <td className="py-3 align-top text-right">
        <Button size="sm" variant="default" disabled={busy} onClick={() => handle("confirm")}>
          Confirm
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => handle("dismiss")}
          className="ml-2"
        >
          Dismiss
        </Button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 5: Mount the panel on `/operator`**

```tsx
// apps/dashboard/src/app/(auth)/operator/page.tsx — additions
import { ProposedDisqualificationsPanel } from "./_components/proposed-disqualifications-panel";

// Inside the existing page component, after the existing operator queue render:
<ProposedDisqualificationsPanel />
```

The panel mounts unconditionally — when qualification capability is off, the API returns `items: []` and the panel shows the muted "No proposals pending" empty state. No flag check in the UI (the server is the source of truth).

- [ ] **Step 6: Write the panel test**

```tsx
// apps/dashboard/src/app/(auth)/operator/__tests__/proposed-disqualifications-panel.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposedDisqualificationsPanel } from "../_components/proposed-disqualifications-panel";

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("ProposedDisqualificationsPanel", () => {
  it("renders empty state when no items", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    render(wrap(<ProposedDisqualificationsPanel />));
    expect(await screen.findByText(/No proposals pending/i)).toBeInTheDocument();
  });

  it("renders one row per item with candidate + evidence", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            conversationThreadId: "t1234567890ab",
            contactId: "c1",
            currentState: "active",
            evidence: {
              candidates: [{ type: "out_of_area", evidence: "lives in NY" }],
            },
          },
        ],
      }),
    });
    render(wrap(<ProposedDisqualificationsPanel />));
    expect(await screen.findByText(/out_of_area/)).toBeInTheDocument();
    expect(screen.getByText(/lives in NY/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dismiss/ })).toBeInTheDocument();
  });

  it("invalidates the query on successful confirm", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            conversationThreadId: "t1",
            contactId: "c1",
            currentState: "active",
            evidence: { candidateType: "out_of_area", evidenceQuote: "x" },
          },
        ],
      }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: "confirmed" }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
    global.fetch = fetchMock;

    render(wrap(<ProposedDisqualificationsPanel />));
    const confirm = await screen.findByRole("button", { name: /Confirm/ });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test src/app/\(auth\)/operator/__tests__/proposed-disqualifications-panel.test.tsx`
Expected: PASS.

- [ ] **Step 8: Verify the Next.js build**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: success. Per `feedback_dashboard_build_not_in_ci.md`, this is the only way to catch missing `.js` extensions or Server/Client boundary issues — CI does not run `next build`.

- [ ] **Step 9: Smoke-test the page in dev**

```bash
pnpm --filter @switchboard/dashboard dev &
# wait ~5s, then:
open http://localhost:3002/operator
```

Expected: the existing operator queue renders, and below it the "Proposed disqualifications" panel renders (likely empty since no real data is seeded — empty state shows).

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/lifecycle/ \
        apps/dashboard/src/app/\(auth\)/operator/_components/ \
        apps/dashboard/src/app/\(auth\)/operator/page.tsx \
        apps/dashboard/src/app/\(auth\)/operator/__tests__/ \
        apps/dashboard/src/hooks/use-pending-disqualifications.ts \
        apps/dashboard/src/hooks/use-resolve-disqualification.ts
git commit -m "feat(dashboard): phase 3b — operator panel for proposed disqualifications

  - New panel on /operator (no new top-level route).
  - usePendingDisqualifications + useResolveDisqualification React Query
    hooks; optimistic via mutation + invalidate.
  - Renders empty state when qualification capability is off (API
    returns empty list — no client-side flag check needed).
  - 409 conflict responses surface as toasts ('Thread already booked')
    and refresh the queue."
```

---

### Task 17: Skill prompt + SKILL.md + regulatory reference notes

**Files:**
- Modify: `skills/alex/SKILL.md`
- Modify: `skills/alex/references/regulatory/sg-rules.md`
- Modify: `skills/alex/references/regulatory/my-rules.md`
- Modify: wherever Alex's system prompt is assembled (likely `packages/core/src/skill-runtime/builders/` — discovery in Step 1)

- [ ] **Step 1: Find Alex's system prompt assembly**

```bash
grep -rn "alex\|qualification" packages/core/src/skill-runtime/builders/ packages/core/src/skill-runtime/templates/ skills/alex/ 2>/dev/null | head -30
```

Identify where the skill's system prompt is built. The new sidecar instruction is a small additive fragment, conditionally appended when the org has `lifecycleTagging.qualification` enabled (the prompt can be unconditionally added if the parser is always-on; per spec §7.1 the parse always runs even when flag is off — so adding the instruction unconditionally is fine and simpler).

- [ ] **Step 2: Add the sidecar emission instruction to Alex's prompt**

Append to the appropriate prompt template (preserve existing structure):

```
## Qualification signal sidecar

At the very end of every response, after a blank line, emit exactly one trailing block:

<qualification_signals>
{
  "treatmentInterest": "<service name or null>",
  "preferredTimeWindow": "<free text or null>",
  "serviceableMarket": "SG" | "MY" | "unknown" | "out_of_area",
  "buyingIntent": "none" | "soft" | "strong",
  "budgetAcknowledged": true | false | null,
  "explicitDecline": true | false,
  "disqualifierCandidates": [
    { "type": "out_of_area" | "wrong_treatment" | "age_gated" | "not_real_lead", "evidence": "<short paraphrase>" }
  ]
}
</qualification_signals>

Rules:
- Always emit the block, even when most fields are null (this signals "I considered qualification but had nothing to report this turn").
- Never emit more than one block per response.
- Never put the block inside a markdown code fence.
- `evidence` strings stay under 280 characters.
- `disqualifierCandidates` empty unless the contact gave a clear signal they aren't viable.

The block is for internal lifecycle tracking. The system strips it from the message the contact sees.
```

- [ ] **Step 3: Update `skills/alex/SKILL.md`**

Append a new section near the existing output-contract documentation:

```markdown
## Phase 3b — Qualification signal sidecar

Each response ends with a `<qualification_signals>{...}</qualification_signals>` block
that the system uses to track lead qualification. The block is automatically
stripped before the response is sent to the contact. Operators see qualification
state on internal surfaces only.

Schema:

  treatmentInterest:     string | null   — service name (resolves against
                                            Playbook.services)
  preferredTimeWindow:   string | null   — free text
  serviceableMarket:     "SG" | "MY" | "unknown" | "out_of_area"
  buyingIntent:          "none" | "soft" | "strong"
  budgetAcknowledged:    boolean | null
  explicitDecline:       boolean
  disqualifierCandidates: Array<{ type, evidence }>  — bounded to 4 entries,
                                                       each evidence under 280 chars

Qualification is observation, not a permission gate. Sidecar emission does not
change which messages can be sent; consent (1c) and the WhatsApp window (1d)
continue to govern outbound.

Disqualification is operator-confirmed. The agent surfaces candidates; a human
operator confirms or dismisses the proposal on the /operator dashboard.
```

- [ ] **Step 4: Append the regulatory reference notes**

```markdown
<!-- skills/alex/references/regulatory/sg-rules.md — append -->

## Phase 3b lifecycle observation

The qualification sidecar is observational — it never affects whether a message
can be sent. SG outbound rules (PDPA-compatible messaging opt-in, WhatsApp 24h
window, regulated-claim substantiation) are unchanged by Phase 3b.

Operator-confirmed disqualification: a lead is only marked `disqualified` after
an operator clicks Confirm in /operator. The agent surfaces candidates; it does
not auto-disqualify.
```

```markdown
<!-- skills/alex/references/regulatory/my-rules.md — append -->

## Phase 3b lifecycle observation

The qualification sidecar is observational. MY outbound rules (PDPA consent
state, WhatsApp 24h window, regulated-claim substantiation) are unchanged.

Operator-confirmed disqualification applies in MY identically to SG: agent
surfaces, operator decides.
```

- [ ] **Step 5: Smoke-test the prompt change**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/
```

Expected: green. (Prompt template tests should pick up the new fragment if any tests assert prompt content.)

- [ ] **Step 6: Commit**

```bash
git add skills/alex/SKILL.md \
        skills/alex/references/regulatory/sg-rules.md \
        skills/alex/references/regulatory/my-rules.md \
        packages/core/src/skill-runtime/builders/  # or wherever the prompt fragment lives
git commit -m "feat(skills): phase 3b — Alex sidecar emission contract + regulatory notes

  - SKILL.md documents the sidecar protocol (strict trailing block,
    schema, qualification-is-observation doctrine).
  - System prompt fragment instructs Alex to emit the block on every
    turn. The block is unconditionally stripped from the user-visible
    response by SkillExecutor's parser regardless of flag state.
  - sg-rules.md / my-rules.md note that lifecycle observation does
    not gate outbound; operator confirms disqualification."
```

---

### Task 18: End-to-end integration test

**Files:**
- Create: `apps/api/src/__tests__/integration-lifecycle-3b.test.ts`

Extends 3a's lifecycle integration test (`integration-lifecycle-3a.test.ts` or equivalent — locate during this task's pre-flight) to cover the qualification + disqualification paths through the live writer + stores + hooks.

- [ ] **Step 1: Locate 3a's integration test**

```bash
find apps/api/src/__tests__ -name "*integration-lifecycle*" -o -name "*lifecycle*integration*" 2>/dev/null
```

Note the patterns it uses (mocked Prisma, in-memory stores, etc.) — mirror them.

- [ ] **Step 2: Write the integration test**

```ts
// apps/api/src/__tests__/integration-lifecycle-3b.test.ts
import { describe, expect, it } from "vitest";
import { buildIntegrationHarness } from "./test-utils.js"; // mirrors 3a harness

describe("Phase 3b lifecycle — integration", () => {
  it("active → qualified via sidecar with resolved treatment", async () => {
    const h = await buildIntegrationHarness({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
      playbookServices: ["HIFU"],
    });
    await h.seedThread({ threadId: "t1", organizationId: "o1", contactId: "c1" }); // active

    await h.runAlexTurnWithSidecar("t1", {
      treatmentInterest: "HIFU",
      preferredTimeWindow: null,
      serviceableMarket: "SG",
      buyingIntent: "soft",
      budgetAcknowledged: null,
      explicitDecline: false,
      disqualifierCandidates: [],
    });

    const snap = await h.readSnapshot("t1");
    expect(snap?.currentState).toBe("qualified");
    expect(snap?.qualificationStatus).toBe("unknown"); // currentState advance; status set on Task 7 path
  });

  it("qualified → stalled (24h cron) → active (inbound) preserves qualification context", async () => {
    const h = await buildIntegrationHarness({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
      playbookServices: ["HIFU"],
    });
    await h.seedThread({ threadId: "t1", organizationId: "o1", contactId: "c1" });
    await h.runAlexTurnWithSidecar("t1", {
      treatmentInterest: "HIFU",
      preferredTimeWindow: null,
      serviceableMarket: "SG",
      buyingIntent: "strong",
      budgetAcknowledged: null,
      explicitDecline: false,
      disqualifierCandidates: [],
    });

    await h.advanceClockHours(25);
    await h.runStalledCron();

    let snap = await h.readSnapshot("t1");
    expect(snap?.currentState).toBe("stalled");

    await h.simulateInbound("t1");

    snap = await h.readSnapshot("t1");
    expect(snap?.currentState).toBe("active");
    // qualificationStatus carries across the mechanical transitions (3a behavior).
    // currentState was advanced via 3b path; snapshot's qualificationStatus
    // was set by the writer's qualified-transition path.
  });

  it("active → proposed_disqualified → operator confirm → disqualified terminal", async () => {
    const h = await buildIntegrationHarness({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
      playbookServices: ["HIFU"],
    });
    await h.seedThread({ threadId: "t1", organizationId: "o1", contactId: "c1" });

    await h.runAlexTurnWithSidecar("t1", {
      treatmentInterest: null,
      preferredTimeWindow: null,
      serviceableMarket: "out_of_area",
      buyingIntent: "soft",
      budgetAcknowledged: null,
      explicitDecline: false,
      disqualifierCandidates: [{ type: "out_of_area", evidence: "lives in NY" }],
    });

    let snap = await h.readSnapshot("t1");
    expect(snap?.qualificationStatus).toBe("proposed_disqualified");
    expect(snap?.currentState).toBe("active"); // currentState unchanged

    const resp = await h.apiPostConfirm("t1", { operatorId: "op_1" });
    expect(resp.statusCode).toBe(200);

    snap = await h.readSnapshot("t1");
    expect(snap?.currentState).toBe("disqualified");
  });

  it("qualified → proposed_disqualified → operator dismiss restores qualified", async () => {
    const h = await buildIntegrationHarness({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
      playbookServices: ["HIFU"],
    });
    await h.seedThread({ threadId: "t1", organizationId: "o1", contactId: "c1" });
    // First qualify
    await h.runAlexTurnWithSidecar("t1", {
      treatmentInterest: "HIFU",
      preferredTimeWindow: null,
      serviceableMarket: "SG",
      buyingIntent: "strong",
      budgetAcknowledged: null,
      explicitDecline: false,
      disqualifierCandidates: [],
    });
    // Then a later sidecar surfaces a disqualifier candidate
    await h.runAlexTurnWithSidecar("t1", {
      treatmentInterest: "HIFU",
      preferredTimeWindow: null,
      serviceableMarket: "SG",
      buyingIntent: "soft",
      budgetAcknowledged: null,
      explicitDecline: false,
      disqualifierCandidates: [{ type: "age_gated", evidence: "mentioned under 18" }],
    });

    let snap = await h.readSnapshot("t1");
    expect(snap?.qualificationStatus).toBe("proposed_disqualified");

    const resp = await h.apiPostDismiss("t1", { operatorId: "op_1" });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().restoredStatus).toBe("qualified");

    snap = await h.readSnapshot("t1");
    expect(snap?.qualificationStatus).toBe("qualified");
    expect(snap?.currentState).not.toBe("disqualified");
  });

  it("proposed_disqualified + concurrent booking → snapshot becomes booked; confirm returns 409", async () => {
    const h = await buildIntegrationHarness({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
      playbookServices: ["HIFU"],
    });
    await h.seedThread({ threadId: "t1", organizationId: "o1", contactId: "c1" });
    await h.runAlexTurnWithSidecar("t1", {
      treatmentInterest: null,
      preferredTimeWindow: null,
      serviceableMarket: "out_of_area",
      buyingIntent: "none",
      budgetAcknowledged: null,
      explicitDecline: false,
      disqualifierCandidates: [{ type: "out_of_area", evidence: "lives in NY" }],
    });
    await h.simulateBookingCreated("t1");

    const snap = await h.readSnapshot("t1");
    expect(snap?.currentState).toBe("booked");

    const resp = await h.apiPostConfirm("t1", { operatorId: "op_1" });
    expect(resp.statusCode).toBe(409);
    expect(resp.json().reason).toBe("already_booked");
  });

  it("capability off: sidecar parses + persists on WorkTrace but lifecycle does not mutate", async () => {
    const h = await buildIntegrationHarness({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "off" } },
      playbookServices: ["HIFU"],
    });
    await h.seedThread({ threadId: "t1", organizationId: "o1", contactId: "c1" });
    await h.runAlexTurnWithSidecar("t1", {
      treatmentInterest: "HIFU",
      preferredTimeWindow: null,
      serviceableMarket: "SG",
      buyingIntent: "strong",
      budgetAcknowledged: null,
      explicitDecline: false,
      disqualifierCandidates: [],
    });

    const snap = await h.readSnapshot("t1");
    expect(snap?.currentState).toBe("active");
    expect(snap?.qualificationStatus).toBe("unknown");

    const wt = await h.readLatestWorkTrace("t1");
    const parsed = JSON.parse(wt.qualificationSignals);
    expect(parsed.validationStatus).toBe("ok");
  });

  it("malformed sidecar persists with validation status but never changes the visible response", async () => {
    const h = await buildIntegrationHarness({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
      playbookServices: ["HIFU"],
    });
    await h.seedThread({ threadId: "t1", organizationId: "o1", contactId: "c1" });
    const result = await h.runAlexTurnWithRawResponse(
      "t1",
      "Sure!\n\n<qualification_signals>{not valid json</qualification_signals>",
    );

    expect(result.response).toBe("Sure!");
    expect(result.response).not.toMatch(/<qualification_signals>/);

    const wt = await h.readLatestWorkTrace("t1");
    const parsed = JSON.parse(wt.qualificationSignals);
    expect(parsed.validationStatus).toBe("malformed_json");

    const snap = await h.readSnapshot("t1");
    expect(snap?.qualificationStatus).toBe("unknown");
  });

  it("free-text unresolved treatment does NOT qualify the lead", async () => {
    const h = await buildIntegrationHarness({
      lifecycleTagging: { mechanical: { mode: "on" }, qualification: { mode: "on" } },
      playbookServices: ["HIFU"], // only HIFU configured
    });
    await h.seedThread({ threadId: "t1", organizationId: "o1", contactId: "c1" });
    await h.runAlexTurnWithSidecar("t1", {
      treatmentInterest: "laser miracle fat removal",
      preferredTimeWindow: null,
      serviceableMarket: "SG",
      buyingIntent: "strong",
      budgetAcknowledged: null,
      explicitDecline: false,
      disqualifierCandidates: [],
    });

    const snap = await h.readSnapshot("t1");
    expect(snap?.currentState).toBe("active");
    expect(snap?.qualificationStatus).toBe("unknown");
  });
});
```

The `buildIntegrationHarness` helper extends 3a's harness with:
- `runAlexTurnWithSidecar(threadId, signals)` — simulates an Alex turn whose raw output contains the given sidecar.
- `runAlexTurnWithRawResponse(threadId, raw)` — for malformed-block test coverage.
- `apiPostConfirm` / `apiPostDismiss` — Fastify `.inject()` against the new routes.
- `readLatestWorkTrace` — for asserting audit persistence.

- [ ] **Step 3: Run the integration test**

```bash
pnpm --filter @switchboard/api test src/__tests__/integration-lifecycle-3b.test.ts
```

Expected: PASS (all eight test cases).

- [ ] **Step 4: Run the entire api test suite**

```bash
pnpm --filter @switchboard/api test
```

Expected: green (or only the documented `pg_advisory_xact_lock` baseline flake).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/__tests__/integration-lifecycle-3b.test.ts
git commit -m "test(api): phase 3b — end-to-end lifecycle integration

Covers:
  - active → qualified via valid sidecar
  - qualified → stalled → active path (qualification carries via 3a)
  - active → proposed_disqualified → confirm → disqualified terminal
  - qualified → proposed_disqualified → dismiss → qualified restored
  - proposed_disqualified + booking race → booked wins; confirm 409s
  - capability off → sidecar persists on WorkTrace, lifecycle untouched
  - malformed sidecar → block stripped from response, validationStatus
    recorded, lifecycle untouched
  - unresolved free-text treatment → does not qualify"
```

---

### Task 19: Workspace verification + reference doc updates

**Files:**
- Optional minor README/CLAUDE.md additions
- No source changes — pure verification

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all green except documented baselines.

- [ ] **Step 2: Run typecheck across the workspace**

```bash
pnpm typecheck
```

Expected: success.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: success.

- [ ] **Step 4: Build the dashboard (CI doesn't)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: success. Confirms no missing `.js` extensions or Server/Client boundary regressions.

- [ ] **Step 5: Verify migration runs against a live DB (if available)**

```bash
pnpm db:check-drift
pnpm db:migrate
```

If Postgres is unreachable, skip and document in the PR body that the migration was hand-written (per Task 3) and will apply on first deploy.

- [ ] **Step 6: Update CLAUDE.md / README references if needed**

Confirm:
- No changes to `CLAUDE.md` architectural rules (3b doesn't introduce new doctrine).
- The Phase 3 design spec on main correctly cross-links to this plan once merged.

- [ ] **Step 7: PR body checklist**

When opening the implementation PR, include:

```
## Phase 3b — LLM Qualification Sidecar + Operator-Confirmed Disqualification

Implements the design at
`docs/superpowers/specs/2026-05-12-alex-medspa-phase-3b-llm-qualification-design.md`
per the plan at
`docs/superpowers/plans/2026-05-12-alex-medspa-phase-3b-llm-qualification.md`.

### Surface

- New schema: `QualificationSignals`, `WorkTraceQualificationSignals` discriminated union
- New sub-flag: `alexMedspaSgMyGovernanceV1.lifecycleTagging.qualification` (default off)
- New WorkTrace column: `qualificationSignals` (TEXT, JSON-encoded)
- New core modules: `qualification-sidecar-parser`, `qualification-rule-evaluator`,
  `treatment-resolver`, `disqualification-resolver`, `qualification-evaluation-hook`,
  `disqualification-resolution-hook`, `predicates.isPendingDisqualification`
- Refactored `LifecycleWriter`: capability-aware allowlists (`mechanical`,
  `qualification`); new `updateQualificationStatus` method with monotonic guard
- New API routes under `/api/dashboard/lifecycle/disqualifications/...`
- New `/operator` panel: proposed disqualifications queue
- Alex SKILL.md + system prompt updated for sidecar emission

### Migration

`ALTER TABLE WorkTrace ADD COLUMN qualificationSignals TEXT;`
Backfills NULL. No data migration. [Applied / hand-written, to apply on deploy].

### Test coverage

  - 60+ new unit tests across schemas, parser, evaluator, resolver, predicates,
    writer-capabilities, writer-qualification, hooks, config-resolver
  - 8-case integration test exercising full state machine
  - Dashboard panel test (loading/empty/render/mutation)

### Doctrine adherence

  - Spec §7.1: parser + WorkTrace persistence are flag-independent
  - Spec §8.1: pending-queue query uses currentState != 'disqualified' predicate
  - Spec §5.2 monotonic table enforced in writer
  - Capability violations loud (throw); monotonic violations quiet (no-op)
  - All qualification mutations route through LifecycleWriter
  - WorkTrace is audit lineage only; operational queues read lifecycle tables

### Out of scope (deferred)

- Recommendations v1 integration (Phase 3c)
- Outbound gating by qualified status (observation-only)
- Alex Home v2 wiring (separate PR consuming this API)
- `PlaybookService.aliases[]` (3c follow-up)
- Phase 3a deferred hook seats 5a–5e (separate PRs)
```

- [ ] **Step 8: No commit required** for verification — but if you tweaked README/CLAUDE.md, commit them now with a `docs:` prefix.

---

## Self-review

After the plan is written, fresh-eyes pass against the spec.

**1. Spec coverage** — every spec section maps to at least one task:

| Spec section | Task(s) |
|---|---|
| §1 Problem | (context) |
| §2 Goal item 1 (SkillExecutionResult extension) | Task 5 |
| §2 Goal item 2 (sidecar protocol + strip + persist) | Tasks 4–5 |
| §2 Goal item 3 (WorkTrace column) | Task 3 |
| §2 Goal item 4 (evaluator + transitions) | Tasks 8–9, 12 |
| §2 Goal item 5 (operator confirm/dismiss + panel) | Tasks 10, 13, 15, 16 |
| §2 Goal item 6 (capability-aware writer) | Tasks 6–7 |
| §2 Goal item 7 (observation-only — no outbound gate) | (architectural — no task; no code introduces a gate; integration test asserts qualification doesn't block outbound implicitly via 1c/1d test fixtures) |
| §2 Goal item 8 (sub-flag default off) | Tasks 2, 11; integration test capability-off case (Task 18) |
| §3 Non-goals | (avoided in scope; called out in PR body and out-of-scope section) |
| §4 Sidecar protocol | Tasks 1, 4 |
| §4.4 WorkTrace shape | Tasks 1, 3 |
| §5.1 Determination rule + treatment binding | Tasks 8–9 |
| §5.2 Monotonic table | Task 7 |
| §5.3 System-proposed disqualification + priorQualificationStatus in evidence | Tasks 7, 12 |
| §5.4 Operator confirm/dismiss state machine | Task 10 |
| §6 Capability constants + writer | Tasks 6–7 |
| §6.2 Capability resolution | Task 11 |
| §6.3 updateQualificationStatus method | Task 7 |
| §6.4 Monotonic silent no-op vs loud capability error | Task 7 |
| §7 Event hook + bootstrap | Tasks 12–14 |
| §7.1 Flag-off matrix (parse always, mutation gated) | Tasks 5, 12, 18 |
| §8 API surface | Task 15 |
| §8.1 Pending-queue query doctrine | Tasks 10, 15 |
| §9 Dashboard panel | Task 16 |
| §10 Skill changes | Task 17 |
| §11 Storage | Task 3 |
| §12 Interaction with 1c/1d/3a | Task 18 |
| §13 Test fixtures | All TDD tasks; aggregated in Task 18 |
| §14 Phasing | Task ordering 1–19 |
| §15 Open questions | Q1 resolved in Pre-flight #1 (name-only matching); Q2–Q4 documented as deferred |

**2. Placeholder scan** — no `TBD`, `TODO`, "fill in details", "add appropriate error handling", or "similar to Task N" without code.

**3. Type consistency** — across tasks:
- `LifecycleWriteCapability` referenced consistently as `"mechanical" | "qualification"`.
- `LifecycleQualificationStatus` referenced as `"unknown" | "unqualified" | "qualified" | "proposed_disqualified"`.
- `QualificationSignals` shape stable from Task 1 through Task 18.
- `WorkTraceQualificationSignals` discriminated union shape stable.
- `ConfirmResult` / `DismissResult` shapes match between resolver (Task 10), hook (Task 13), and API route (Task 15).
- `isPendingDisqualification` predicate signature stable.

**4. Ambiguity** — sections that could be interpreted two ways: explicitly resolved.

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-12-alex-medspa-phase-3b-llm-qualification.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task; review between tasks; fast iteration. Use `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in the current session using `superpowers:executing-plans`; batch execution with checkpoints.

Implementation lands on `feat/alex-medspa-phase-3b` (worktree to be created from `main` once spec + plan PRs land).








