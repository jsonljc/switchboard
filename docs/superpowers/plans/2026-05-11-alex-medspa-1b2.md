# Alex SG/MY Medspa — Phase 1b-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Layer 2 claim classifier + Layer 3 substantiation tiers on top of the 1b-1 deterministic safety gate — a `ClaimClassifierHook` registered after `DeterministicSafetyGateHook` that classifies sentences (Haiku 4.5 with prompt caching, per-sentence parallel calls within an 800 ms per-turn budget), resolves against `operator_business_fact` / `approved_compliance_claim` / `regulatory_public_source` tiers, and either allows / rewrites with deterministic templates / escalates per the enforcement matrix.

**Architecture:** Schema extensions in `packages/schemas` (new `claim-classifier.ts` and `substantiation.ts` files, extend `GovernanceVerdictReasonSchema`, add `ClaimClassifierConfigSchema` helper to existing `governance-config.ts`). New classifier package under `packages/core/src/governance/classifier/` for prompt artifact, Anthropic adapter, runner, substantiation resolver, LRU cache, rewrite templates, regulatory sources. Prisma model + impl for `ApprovedComplianceClaim` in `packages/db`. New `ClaimClassifierHook` in `packages/core/src/skill-runtime/hooks/`. Hook registration + classifier dependencies wired in `apps/api/src/bootstrap/skill-mode.ts`. Each hook gets its own `GovernancePostureCache` instance to prevent fail-closed mode-mixing.

**Tech Stack:** TypeScript ESM, Zod, Vitest, Prisma, pnpm workspaces, Turbo, Anthropic SDK (already a dependency). Follows established prisma-store + SkillHook patterns. Prompt caching (`cache_control: { type: "ephemeral" }`) introduced for the first time — guard rails in the test suite.

**Spec:** `docs/superpowers/specs/2026-05-11-alex-medspa-1b2-claim-classifier-design.md`

**Out of scope for Phase 1b-2 (deferred — do not bleed in):**
- Phase 1c — PDPA consent state machine
- Phase 1d — WhatsApp 24h window detection, templates
- Phase 1b-1.5 — regulatory expansion of 1b-1 banned-phrase / escalation-trigger seed tables
- Phase 2 — operator UI for authoring `ApprovedComplianceClaim` rows
- Phase 3 — outcome tagging, pattern detection, recommendations surfacing of repeat classifier rewrites
- Cache invalidation on `ApprovedComplianceClaim` upsert (workaround: process restart / admin endpoint after seed)
- Embedding-based substantiation match (substring is v1)
- Model-generated rewrites (deterministic templates only)
- Per-claim-type mode override (flat `mode` knob in 1b-2)
- Hard CI gate on `pnpm classifier-eval`
- Service-scoped substantiation (no `serviceId` on `ApprovedComplianceClaim`; revisit when a relational `Service` model ships)

---

## Plan hardening notes

These rules apply across all tasks. They are load-bearing for clean execution; review feedback that shaped them is captured here so the executing engineer doesn't have to reconstruct it.

- **Prerequisites: Phase 1a and Phase 1b-1 must be on the working branch before Task 1.** This worktree was created off `main` *before* 1a (PR #409) and 1b-1 merged. Pre-flight resolves the dependency.
- **Schema enum changes are atomic with their consumers.** Task 1 extends `GovernanceVerdictReasonSchema` with four new entries; the same task updates any 1a/1b-1 fixture tests so `packages/schemas` stays green between commits.
- **No `console.log`.** Use `console.error` for fail-open / fail-closed branches, classifier API errors, and loader assertions. Use `console.warn` for soft warnings (duplicate patterns, eval-harness misses). Lint will flag `console.log`.
- **No `any`.** Resolver, classifier, store, and cache types are all explicitly typed. If TypeScript inference produces `any`, refine the type instead of casting.
- **Layer rules.** `packages/schemas` (Layer 1) has no `@switchboard/*` imports. `packages/core` (Layer 3) imports schemas + sdk + cartridge-sdk only — never `packages/db`. Prisma store impls live in `packages/db` (Layer 4) and depend on the interface declared in core.
- **Tests use mocked Prisma.** Per `feedback_api_test_mocked_prisma.md`, db tests mock the Prisma client. Don't require a running PostgreSQL for `pnpm test` to pass.
- **Anthropic SDK calls are mocked in tests.** Classifier tests never hit the real API. The `AnthropicClaimClassifier` interface is the seam — tests inject a mock implementation. Only `pnpm classifier-eval` (Task 18) hits the real API, gated by `EVAL=1` env flag.
- **`pnpm db:check-drift` requires a running PostgreSQL.** If unreachable in the implementation environment (no Docker / no `DATABASE_URL`), follow 1b-1's pattern: skip locally and document in the PR body. Do not commit a generated migration without ever validating it; at minimum, `pnpm db:generate` must succeed.
- **Hook order is part of definition-of-done for Task 16.** Spec Section 7 asserts `DeterministicSafetyGateHook` → `ClaimClassifierHook` → `TracePersistenceHook`. 1b-1 Task 14 verified the framework iterates in registration-array order. Task 16 re-asserts that contract still holds via the registration test.
- **Per-hook posture cache.** Spec Section 6.7 mandates per-hook `GovernancePostureCache` instances (not a shared instance) to prevent fail-closed mode-mixing when hooks are in different modes. Task 16 constructs the second instance.
- **Service-scoping deferred to a future phase.** Codebase verification at plan-write time found no `Service` Prisma model on `main` or on the 1a parent branch. 1b-2 ships **deployment-global substantiation only** — no `serviceId` column on `ApprovedComplianceClaim`, no `serviceContext` on the resolver, no per-turn tool-call lineage tracking. When a future phase lands a relational `Service` model, `serviceId String?` becomes a clean additive migration.
- **Hook contract matches the runtime, not the kickoff spec.** The real `SkillHook.afterSkill` signature is `(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void>` — two args, returns void, hook mutates `result.response` in place. `SkillExecutionResult.response` is a **single string**, not a `messages[]` array. Sentence-level rewrites splice the response string via `string.replace(originalSentence, replacement)`.
- **`SkillHookContext` has no `conversationId`.** The hook uses `ctx.sessionId` as the verdict's `conversationId` (the runtime treats them 1:1 today; same convention as 1b-1's deterministic gate).
- **Conservative seed tables, not placeholders.** Tasks 8, 9 seed `RegulatoryPublicSource` and rewrite templates with real baseline entries (≥3 per category per jurisdiction for regulatory; ≥1 template per `(claimType, jurisdiction)` for rewrites). The PR includes a follow-up note for Phase 1b-2.5 (or rolled into 1b-1.5).
- **Reference markdown stays in sync (informally).** When seed tables land, the `skills/alex/references/regulatory/{sg,my}-rules.md` files (1b-1 added "Runtime banned-phrase enforcement" sections; 1b-2 adds "Runtime claim classification" sections) point at the TS file paths. MD is not load-bearing, not parsed.
- **Verdict persistence policy: match-only on the deterministic gate, classifier-driven only on this hook.** A clean classification (`claimType: "none"`) does NOT persist a verdict. Verdicts are only written when the classifier produces a non-`none` outcome (allow-with-match, rewrite, escalate, timeout, error). Same event-log discipline as 1b-1.
- **Prompt caching is mandatory on every classifier call.** The Anthropic SDK call must set `cache_control: { type: "ephemeral" }` on both the system text and the last (only) tool definition. A regression test in Task 11 inspects the captured request payload.
- **Single shared `Anthropic` client across the process.** Task 16 wires the classifier to the same client used by `apps/api`'s existing chat / agent-runtime adapters. Per-call instantiation is wasteful and breaks prompt caching.

---

## Pre-flight

- [ ] **Step P1: Confirm worktree and branch**

```bash
cd /Users/jasonli/switchboard-alex-medspa-1b2
git branch --show-current
```

Expected: `docs/alex-medspa-1b2-spec`

- [ ] **Step P2: Resolve the 1a + 1b-1 dependencies**

This worktree was created off `main` before PR #409 (Phase 1a) and the 1b-1 implementation merged. Implementation requires both 1a and 1b-1 artifacts to be present.

Three paths — pick whichever applies when you start implementation:

**Path A: both 1a and 1b-1 are now merged into main.** Rebase the 1b-2 branch onto main:

```bash
git fetch origin main
git rebase origin/main
```

Resolve any conflicts (none expected — spec/plan files only on this branch).

**Path B: 1a merged, 1b-1 is still on its feature branch.** Rebase onto main first, then merge or cherry-pick 1b-1:

```bash
git fetch origin main docs/alex-medspa-1b1-spec
git rebase origin/main
# Then pick the 1b-1 implementation commits onto this branch. Use:
git log --oneline origin/docs/alex-medspa-1b1-spec ^origin/main
# Cherry-pick the implementation commits (typically Tasks 1–15 from the 1b-1 plan).
git cherry-pick <commit-range>
```

**Path C: neither merged.** As of plan-write time, `docs/alex-medspa-1b1-spec` is NOT pushed to origin — the 1b-1 implementation lives only in the local worktree at `/Users/jasonli/switchboard-alex-medspa-1b1`. Two sub-paths:

**C1 — push 1b-1 first (preferred):** ask the user to `git push origin docs/alex-medspa-1b1-spec` from that worktree, then follow Path B.

**C2 — cherry-pick from the local 1b-1 worktree directly:**

```bash
git fetch origin docs/alex-medspa-sg-my-spec
git cherry-pick <1a-implementation-commits>   # from origin/docs/alex-medspa-sg-my-spec
# 1b-1 commits live only locally — reference by SHA from the 1b-1 worktree:
git -C /Users/jasonli/switchboard-alex-medspa-1b1 log --oneline origin/docs/alex-medspa-sg-my-spec..
git cherry-pick <1b-1-implementation-commits-by-SHA>
```

Verify after any path:

```bash
ls packages/schemas/src/governance-verdict.ts
ls packages/schemas/src/governance-config.ts
ls packages/schemas/src/reference-metadata.ts
ls -d skills/alex/references/
ls packages/core/src/governance/banned-phrases/
ls packages/core/src/governance/escalation-triggers/
ls packages/core/src/governance/scanner/
ls packages/core/src/governance/governance-verdict-store/
ls packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts
ls packages/db/src/prisma-governance-verdict-store.ts
```

Expected: all paths exist.

- [ ] **Step P3: Initialize worktree**

```bash
pnpm worktree:init
```

Expected: copies `.env`, kills stale dev-port listeners, runs `pnpm db:migrate` if Postgres is reachable. Postgres unreachable is fine for most of this plan; only Task 5's drift check needs it.

- [ ] **Step P4: Verify baseline build**

```bash
pnpm install
pnpm --filter @switchboard/schemas build
pnpm --filter @switchboard/core build
pnpm --filter @switchboard/db build
pnpm typecheck
pnpm test --filter '@switchboard/schemas' --filter '@switchboard/core' --filter '@switchboard/db'
```

Expected: all clean. If `pnpm typecheck` reports missing exports from `@switchboard/schemas`, `@switchboard/db`, or `@switchboard/core`, run `pnpm reset` first.

---

## Task 1: Extend `GovernanceVerdictReasonSchema` with classifier outcomes

**Files:**
- Modify: `packages/schemas/src/governance-verdict.ts`
- Modify: `packages/schemas/src/__tests__/governance-verdict.test.ts`

The 1b-1-extended enum is the starting point (already contains `sensitive_inbound`, `compliance_concern`, `governance_unavailable`, `classifier_timeout`). This task appends four 1b-2-specific reasons.

- [ ] **Step 1: Write the failing tests**

Append to `packages/schemas/src/__tests__/governance-verdict.test.ts`:

```ts
describe("GovernanceVerdictReasonSchema — 1b-2 additions", () => {
  it("accepts unsupported_claim_rewritten", () => {
    const result = GovernanceVerdictReasonSchema.safeParse("unsupported_claim_rewritten");
    expect(result.success).toBe(true);
  });

  it("accepts unsupported_claim_escalated", () => {
    const result = GovernanceVerdictReasonSchema.safeParse("unsupported_claim_escalated");
    expect(result.success).toBe(true);
  });

  it("accepts claim_substantiation_stale", () => {
    const result = GovernanceVerdictReasonSchema.safeParse("claim_substantiation_stale");
    expect(result.success).toBe(true);
  });

  it("accepts classifier_error (distinct from classifier_timeout)", () => {
    const errorParse = GovernanceVerdictReasonSchema.safeParse("classifier_error");
    const timeoutParse = GovernanceVerdictReasonSchema.safeParse("classifier_timeout");
    expect(errorParse.success).toBe(true);
    expect(timeoutParse.success).toBe(true);
  });

  it("rejects unknown reasons", () => {
    const result = GovernanceVerdictReasonSchema.safeParse("not_a_reason");
    expect(result.success).toBe(false);
  });
});
```

The import at the top of the test file is already in place from 1a; if missing, add:

```ts
import { GovernanceVerdictReasonSchema } from "../governance-verdict.js";
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/schemas test -- governance-verdict
```

Expected: the four new `accepts` cases fail with Zod parse errors.

- [ ] **Step 3: Extend the enum**

Edit `packages/schemas/src/governance-verdict.ts`:

```ts
export const GovernanceVerdictReasonSchema = z.enum([
  "allowed",
  "banned_phrase",
  "unsupported_claim",
  "medical_safety_trigger",
  "sensitive_inbound",
  "compliance_concern",
  "governance_unavailable",
  "outside_whatsapp_window",
  "consent_missing",
  "classifier_timeout",
  "classifier_error",              // NEW (1b-2): API failure (not timeout)
  "unsupported_claim_rewritten",   // NEW (1b-2): Layer 3 rewrote — claim sentence swapped
  "unsupported_claim_escalated",   // NEW (1b-2): Layer 3 escalated — non-rewriteable type
  "claim_substantiation_stale",    // NEW (1b-2): source existed but stale
]);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/schemas test -- governance-verdict
pnpm --filter @switchboard/schemas typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/governance-verdict.ts packages/schemas/src/__tests__/governance-verdict.test.ts
git commit -m "feat(schemas): extend GovernanceVerdictReasonSchema with 1b-2 classifier reasons"
```

---

## Task 2: Add `ClaimTypeSchema` and classifier output types

**Files:**
- Create: `packages/schemas/src/claim-classifier.ts`
- Create: `packages/schemas/src/__tests__/claim-classifier.test.ts`
- Modify: `packages/schemas/src/index.ts` — re-export new module

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/__tests__/claim-classifier.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ClaimTypeSchema,
  ClassifierSentenceResultSchema,
  CLASSIFIER_SCHEMA_VERSION,
} from "../claim-classifier.js";

describe("ClaimTypeSchema", () => {
  it.each([
    "efficacy",
    "safety-claim",
    "superiority",
    "urgency",
    "testimonial",
    "medical-advice",
    "diagnosis",
    "credentials",
    "none",
  ])("accepts %s", (value) => {
    expect(ClaimTypeSchema.safeParse(value).success).toBe(true);
  });

  it("rejects unknown claim types", () => {
    expect(ClaimTypeSchema.safeParse("comparative").success).toBe(false);
  });
});

describe("ClassifierSentenceResultSchema", () => {
  it("round-trips a valid result", () => {
    const input = {
      sentence: "Most clients see visible slimming after one session.",
      claimType: "efficacy" as const,
      confidence: 0.92,
    };
    const result = ClassifierSentenceResultSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(
      ClassifierSentenceResultSchema.safeParse({
        sentence: "x",
        claimType: "none",
        confidence: 1.5,
      }).success,
    ).toBe(false);
    expect(
      ClassifierSentenceResultSchema.safeParse({
        sentence: "x",
        claimType: "none",
        confidence: -0.1,
      }).success,
    ).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(
      ClassifierSentenceResultSchema.safeParse({
        sentence: "x",
        claimType: "none",
      }).success,
    ).toBe(false);
  });
});

describe("CLASSIFIER_SCHEMA_VERSION", () => {
  it("exports the v1.0.0 constant", () => {
    expect(CLASSIFIER_SCHEMA_VERSION).toBe("1.0.0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/schemas test -- claim-classifier
```

Expected: module-not-found / import errors.

- [ ] **Step 3: Create the module**

Create `packages/schemas/src/claim-classifier.ts`:

```ts
import { z } from "zod";

export const ClaimTypeSchema = z.enum([
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",
  "none",
]);

export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClassifierSentenceResultSchema = z.object({
  sentence: z.string(),
  claimType: ClaimTypeSchema,
  confidence: z.number().min(0).max(1),
});

export type ClassifierSentenceResult = z.infer<typeof ClassifierSentenceResultSchema>;

export const CLASSIFIER_SCHEMA_VERSION = "1.0.0" as const;
```

- [ ] **Step 4: Re-export from package barrel**

Edit `packages/schemas/src/index.ts` — add:

```ts
export * from "./claim-classifier.js";
```

(Insert in alphabetical order alongside the other `export * from "./..."` lines.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/schemas test -- claim-classifier
pnpm --filter @switchboard/schemas typecheck
pnpm --filter @switchboard/schemas build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/claim-classifier.ts packages/schemas/src/__tests__/claim-classifier.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add ClaimTypeSchema and classifier output types"
```

---

## Task 3: Add substantiation source schemas

**Files:**
- Create: `packages/schemas/src/substantiation.ts`
- Create: `packages/schemas/src/__tests__/substantiation.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/__tests__/substantiation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SubstantiationSourceTypeSchema,
  SubstantiationResolutionSchema,
} from "../substantiation.js";

describe("SubstantiationSourceTypeSchema", () => {
  it.each([
    "operator_business_fact",
    "approved_compliance_claim",
    "regulatory_public_source",
  ])("accepts %s", (value) => {
    expect(SubstantiationSourceTypeSchema.safeParse(value).success).toBe(true);
  });

  it("rejects unknown source types", () => {
    expect(SubstantiationSourceTypeSchema.safeParse("operator_typed").success).toBe(false);
  });
});

describe("SubstantiationResolutionSchema", () => {
  it("accepts a matched resolution", () => {
    const r = SubstantiationResolutionSchema.safeParse({
      status: "matched",
      sourceType: "approved_compliance_claim",
      sourceId: "clm_123",
      matchedText: "visible slimming",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a missing resolution with no source", () => {
    const r = SubstantiationResolutionSchema.safeParse({ status: "missing" });
    expect(r.success).toBe(true);
  });

  it("accepts a stale resolution", () => {
    const r = SubstantiationResolutionSchema.safeParse({
      status: "stale",
      sourceType: "approved_compliance_claim",
      sourceId: "clm_456",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const r = SubstantiationResolutionSchema.safeParse({ status: "uncertain" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/schemas test -- substantiation
```

Expected: module-not-found.

- [ ] **Step 3: Create the module**

Create `packages/schemas/src/substantiation.ts`:

```ts
import { z } from "zod";

export const SubstantiationSourceTypeSchema = z.enum([
  "operator_business_fact",
  "approved_compliance_claim",
  "regulatory_public_source",
]);

export type SubstantiationSourceType = z.infer<typeof SubstantiationSourceTypeSchema>;

export const SubstantiationResolutionSchema = z.object({
  status: z.enum(["matched", "stale", "missing"]),
  sourceType: SubstantiationSourceTypeSchema.optional(),
  sourceId: z.string().optional(),
  matchedText: z.string().optional(),
});

export type SubstantiationResolution = z.infer<typeof SubstantiationResolutionSchema>;
```

- [ ] **Step 4: Re-export from barrel**

Edit `packages/schemas/src/index.ts` — append:

```ts
export * from "./substantiation.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/schemas test -- substantiation
pnpm --filter @switchboard/schemas typecheck
pnpm --filter @switchboard/schemas build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/substantiation.ts packages/schemas/src/__tests__/substantiation.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add substantiation source type + resolution schemas"
```

---

## Task 4: Add `ClaimClassifierConfigSchema` and resolver helper

**Files:**
- Modify: `packages/schemas/src/governance-config.ts`
- Modify: `packages/schemas/src/__tests__/governance-config.test.ts`

The 1b-1 `GovernanceConfigSchema` already uses `.passthrough()` to accept arbitrary sub-blocks. This task adds an additive `ClaimClassifierConfigSchema` sub-schema and a `resolveClaimClassifierConfig` helper, both as new exports. **No edits to `GovernanceConfigSchema` itself; no Prisma migration.**

- [ ] **Step 1: Write the failing tests**

Append to `packages/schemas/src/__tests__/governance-config.test.ts`:

```ts
import {
  ClaimClassifierConfigSchema,
  resolveClaimClassifierConfig,
  GovernanceConfigSchema,
} from "../governance-config.js";

describe("ClaimClassifierConfigSchema", () => {
  it("applies defaults when no fields provided", () => {
    const parsed = ClaimClassifierConfigSchema.parse({});
    expect(parsed).toEqual({
      mode: "off",
      latencyBudgetMs: 800,
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("accepts an explicit enforce config", () => {
    const parsed = ClaimClassifierConfigSchema.parse({
      mode: "enforce",
      latencyBudgetMs: 1200,
      model: "claude-sonnet-4-6",
    });
    expect(parsed).toEqual({
      mode: "enforce",
      latencyBudgetMs: 1200,
      model: "claude-sonnet-4-6",
    });
  });

  it("rejects non-positive latencyBudgetMs", () => {
    expect(ClaimClassifierConfigSchema.safeParse({ latencyBudgetMs: 0 }).success).toBe(false);
    expect(ClaimClassifierConfigSchema.safeParse({ latencyBudgetMs: -1 }).success).toBe(false);
  });

  it("rejects unknown mode", () => {
    expect(ClaimClassifierConfigSchema.safeParse({ mode: "warn" }).success).toBe(false);
  });
});

describe("resolveClaimClassifierConfig", () => {
  it("returns full defaults for null config", () => {
    const resolved = resolveClaimClassifierConfig(null);
    expect(resolved.mode).toBe("off");
    expect(resolved.latencyBudgetMs).toBe(800);
    expect(resolved.model).toBe("claude-haiku-4-5-20251001");
  });

  it("returns defaults when claimClassifier sub-block is absent", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
    });
    const resolved = resolveClaimClassifierConfig(config);
    expect(resolved.mode).toBe("off");
  });

  it("reads enforce mode from passthrough sub-block", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
      claimClassifier: {
        mode: "enforce",
        latencyBudgetMs: 600,
        model: "claude-haiku-4-5-20251001",
      },
    });
    const resolved = resolveClaimClassifierConfig(config);
    expect(resolved.mode).toBe("enforce");
    expect(resolved.latencyBudgetMs).toBe(600);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/schemas test -- governance-config
```

Expected: import errors (`ClaimClassifierConfigSchema`, `resolveClaimClassifierConfig` not exported).

- [ ] **Step 3: Add the helper exports**

Append to `packages/schemas/src/governance-config.ts` (do not edit existing `GovernanceConfigSchema`):

```ts
export const ClaimClassifierConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
    latencyBudgetMs: z.number().int().positive().default(800),
    model: z.string().default("claude-haiku-4-5-20251001"),
  })
  .default({});

export type ClaimClassifierConfig = z.infer<typeof ClaimClassifierConfigSchema>;

/**
 * Resolve the claimClassifier sub-block off a GovernanceConfig.
 *
 * The 1b-1 GovernanceConfigSchema uses .passthrough() so the sub-block is
 * not validated as part of the parent schema. Callers consume it via this
 * helper which applies defaults when absent.
 */
export function resolveClaimClassifierConfig(
  config: GovernanceConfig | null,
): ClaimClassifierConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.claimClassifier;
  return ClaimClassifierConfigSchema.parse(raw ?? {});
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/schemas test -- governance-config
pnpm --filter @switchboard/schemas typecheck
pnpm --filter @switchboard/schemas build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/governance-config.ts packages/schemas/src/__tests__/governance-config.test.ts
git commit -m "feat(schemas): add ClaimClassifierConfigSchema and resolveClaimClassifierConfig helper"
```

---

## Task 5: Prisma migration — `ApprovedComplianceClaim` table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_alex_medspa_1b2_approved_compliance_claim/migration.sql`

- [ ] **Step 1: Add the model**

Edit `packages/db/prisma/schema.prisma` — append (or insert near `GovernanceVerdict` from 1b-1):

```prisma
model ApprovedComplianceClaim {
  id            String   @id @default(cuid())
  deploymentId  String
  jurisdiction  String   // "SG" | "MY"
  claimType     String   // matches ClaimTypeSchema enum
  claimText     String   @db.Text
  reviewedBy    String
  reviewedAt    DateTime
  validUntil    DateTime?
  notes         String?  @db.Text
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  deployment    AgentDeployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)

  @@index([deploymentId, jurisdiction, claimType])
  @@index([deploymentId, validUntil])
}
```

**No `serviceId` column.** The codebase has no `Service` Prisma model — service-scoping is deferred.

Add the reverse relation on `AgentDeployment` (find the existing relation block):

```prisma
model AgentDeployment {
  // ... existing fields ...
  approvedComplianceClaims ApprovedComplianceClaim[]
}
```

- [ ] **Step 2: Regenerate Prisma client**

```bash
pnpm db:generate
```

Expected: client generates without error and now exports `ApprovedComplianceClaim` types.

- [ ] **Step 3: Generate migration SQL**

Per `feedback_prisma_migrate_dev_tty.md`, use the diff workflow (TTY-free):

```bash
mkdir -p packages/db/prisma/migrations/$(date +%Y%m%d%H%M%S)_alex_medspa_1b2_approved_compliance_claim
TS=$(ls packages/db/prisma/migrations | grep alex_medspa_1b2_approved_compliance_claim | tail -1)
pnpm --filter @switchboard/db exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script > packages/db/prisma/migrations/$TS/migration.sql
```

Expected: `migration.sql` contains a `CREATE TABLE "ApprovedComplianceClaim"` plus indexes and FKs.

- [ ] **Step 4: Run drift check (requires Postgres)**

```bash
pnpm db:check-drift
```

Expected: no drift. **If Postgres is unreachable**, skip and document in PR body — same fallback as 1b-1.

- [ ] **Step 5: Apply migration**

```bash
pnpm --filter @switchboard/db exec prisma migrate deploy
```

Expected: migration applied successfully (only when Postgres is reachable).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add ApprovedComplianceClaim model + migration"
```

---

## Task 6: `ApprovedComplianceClaimStore` — interface (core) + Prisma impl (db)

**Files:**
- Create: `packages/core/src/governance/classifier/approved-compliance-claim-store/types.ts`
- Create: `packages/core/src/governance/classifier/approved-compliance-claim-store/index.ts`
- Create: `packages/db/src/prisma-approved-compliance-claim-store.ts`
- Create: `packages/db/src/__tests__/prisma-approved-compliance-claim-store.test.ts`
- Modify: `packages/db/src/index.ts` — re-export

- [ ] **Step 1: Define the interface (core)**

Create `packages/core/src/governance/classifier/approved-compliance-claim-store/types.ts`:

```ts
import type { ClaimType } from "@switchboard/schemas";

export interface ApprovedComplianceClaimQuery {
  deploymentId: string;
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
}

export interface ApprovedComplianceClaimRecord {
  id: string;
  deploymentId: string;
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
  claimText: string;
  reviewedBy: string;
  reviewedAt: string;        // ISO string
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedComplianceClaimStore {
  list(query: ApprovedComplianceClaimQuery): Promise<ApprovedComplianceClaimRecord[]>;
}
```

Create `packages/core/src/governance/classifier/approved-compliance-claim-store/index.ts`:

```ts
export * from "./types.js";
```

- [ ] **Step 2: Re-export from core barrel**

Edit `packages/core/src/governance/index.ts` (or the package's governance barrel) — append:

```ts
export * from "./classifier/approved-compliance-claim-store/index.js";
```

If the governance barrel does not exist yet (1b-1 may have created one at `packages/core/src/governance/index.ts`), check first; otherwise add the export to whichever file re-exports governance modules — mirror 1b-1's `governance-verdict-store` re-export pattern exactly.

- [ ] **Step 3: Write the failing Prisma-impl test**

Create `packages/db/src/__tests__/prisma-approved-compliance-claim-store.test.ts` (mirror `prisma-governance-verdict-store.test.ts` from 1b-1 — mocked Prisma client, not real Postgres):

```ts
import { describe, it, expect, vi } from "vitest";
import { createPrismaApprovedComplianceClaimStore } from "../prisma-approved-compliance-claim-store.js";

function makePrismaMock(rows: unknown[]) {
  return {
    approvedComplianceClaim: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as const;
}

describe("PrismaApprovedComplianceClaimStore.list", () => {
  it("returns rows scoped to deployment + jurisdiction + claimType", async () => {
    const prisma = makePrismaMock([
      {
        id: "clm_1",
        deploymentId: "dep_1",
        jurisdiction: "SG",
        claimType: "efficacy",
        claimText: "visible slimming",
        reviewedBy: "Dr Lim",
        reviewedAt: new Date("2026-05-01T00:00:00.000Z"),
        validUntil: null,
        notes: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = createPrismaApprovedComplianceClaimStore(prisma as any);
    const rows = await store.list({
      deploymentId: "dep_1",
      jurisdiction: "SG",
      claimType: "efficacy",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].claimText).toBe("visible slimming");
    expect(rows[0].reviewedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(prisma.approvedComplianceClaim.findMany).toHaveBeenCalledWith({
      where: {
        deploymentId: "dep_1",
        jurisdiction: "SG",
        claimType: "efficacy",
      },
      orderBy: [{ reviewedAt: "desc" }],
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm --filter @switchboard/db test -- prisma-approved-compliance-claim-store
```

Expected: module-not-found.

- [ ] **Step 5: Implement the Prisma store**

Create `packages/db/src/prisma-approved-compliance-claim-store.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type {
  ApprovedComplianceClaimQuery,
  ApprovedComplianceClaimRecord,
  ApprovedComplianceClaimStore,
} from "@switchboard/core";
import type { ClaimType } from "@switchboard/schemas";

interface PrismaApprovedComplianceClaimRow {
  id: string;
  deploymentId: string;
  jurisdiction: string;
  claimType: string;
  claimText: string;
  reviewedBy: string;
  reviewedAt: Date;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: PrismaApprovedComplianceClaimRow): ApprovedComplianceClaimRecord {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    jurisdiction: row.jurisdiction as "SG" | "MY",
    claimType: row.claimType as ClaimType,
    claimText: row.claimText,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPrismaApprovedComplianceClaimStore(
  prisma: PrismaClient,
): ApprovedComplianceClaimStore {
  return {
    async list(query: ApprovedComplianceClaimQuery): Promise<ApprovedComplianceClaimRecord[]> {
      const rows = await prisma.approvedComplianceClaim.findMany({
        where: {
          deploymentId: query.deploymentId,
          jurisdiction: query.jurisdiction,
          claimType: query.claimType,
        },
        orderBy: [{ reviewedAt: "desc" }],
      });

      return rows.map((row) => toRecord(row as PrismaApprovedComplianceClaimRow));
    },
  };
}
```

Ordered by `reviewedAt DESC` so the most-recently-reviewed claim wins a substring tie.

- [ ] **Step 6: Re-export from db barrel**

Edit `packages/db/src/index.ts` — append:

```ts
export * from "./prisma-approved-compliance-claim-store.js";
```

- [ ] **Step 7: Run tests and typecheck**

```bash
pnpm --filter @switchboard/db test -- prisma-approved-compliance-claim-store
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/db typecheck
pnpm --filter @switchboard/core build
pnpm --filter @switchboard/db build
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/governance/classifier/approved-compliance-claim-store/ packages/db/src/prisma-approved-compliance-claim-store.ts packages/db/src/__tests__/prisma-approved-compliance-claim-store.test.ts packages/db/src/index.ts packages/core/src/governance/index.ts
git commit -m "feat(core,db): ApprovedComplianceClaimStore interface + Prisma impl"
```

---

## Task 7: Extract `splitSentences` to shared utility

**Files:**
- Create: `packages/core/src/governance/text/sentence-splitter.ts`
- Create: `packages/core/src/governance/text/index.ts`
- Modify: `packages/core/src/governance/scanner/escalation-trigger-scanner.ts` — re-point import
- Create: `packages/core/src/governance/text/__tests__/sentence-splitter.test.ts`

1b-1 ships `splitSentences` as a local helper inside `escalation-trigger-scanner.ts`. 1b-2 needs it from two places (escalation-trigger scanner + classifier hook), so extraction is the right move. Behavior unchanged.

- [ ] **Step 1: Locate the existing helper**

```bash
grep -n "splitSentences\|function splitSentences\|const splitSentences" \
  packages/core/src/governance/scanner/escalation-trigger-scanner.ts
```

Expected: finds the local `splitSentences` declaration. Note its full body.

- [ ] **Step 2: Write the failing test in the new location**

Create `packages/core/src/governance/text/__tests__/sentence-splitter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitSentences } from "../sentence-splitter.js";

describe("splitSentences", () => {
  it("splits on period, exclamation, question mark", () => {
    expect(splitSentences("First. Second! Third?")).toEqual([
      "First.",
      "Second!",
      "Third?",
    ]);
  });

  it("treats newlines as sentence boundaries", () => {
    expect(splitSentences("First\nSecond")).toEqual(["First", "Second"]);
  });

  it("returns the whole text as one sentence when no punctuation", () => {
    expect(splitSentences("hello there friend")).toEqual(["hello there friend"]);
  });

  it("trims whitespace and drops empty fragments", () => {
    expect(splitSentences("  a.   b.   ")).toEqual(["a.", "b."]);
  });

  it("returns empty array for empty input", () => {
    expect(splitSentences("")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test -- sentence-splitter
```

Expected: module-not-found.

- [ ] **Step 4: Create the shared util — exact same behavior as the 1b-1 local helper**

Create `packages/core/src/governance/text/sentence-splitter.ts`. Copy the body verbatim from `escalation-trigger-scanner.ts`. The export shape:

```ts
/**
 * Crude sentence splitter shared by 1b-1's escalation-trigger scanner
 * (inbound) and 1b-2's claim classifier (outbound). Greedy split on
 * [.!?\n]+ with whitespace tolerance. Sentence-tokenizer dependency
 * is overkill for short chat text; edge cases (no punctuation, "...",
 * embedded URLs) are accepted false-positive risk covered by fixtures.
 */
export function splitSentences(text: string): readonly string[] {
  if (text.length === 0) return [];
  const fragments: string[] = [];
  let buffer = "";
  for (const ch of text) {
    buffer += ch;
    if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
      const trimmed = buffer.trim();
      if (trimmed.length > 0) fragments.push(trimmed);
      buffer = "";
    }
  }
  const tail = buffer.trim();
  if (tail.length > 0) fragments.push(tail);
  return fragments;
}
```

If the 1b-1 implementation differs (e.g., includes a regex split), match it exactly — do not change behavior. The test assertions above match this canonical body; adjust them if and only if 1b-1's implementation behaves differently. Re-run 1b-1's escalation-trigger tests to confirm parity.

Create `packages/core/src/governance/text/index.ts`:

```ts
export * from "./sentence-splitter.js";
```

- [ ] **Step 5: Re-point `escalation-trigger-scanner.ts`**

Edit `packages/core/src/governance/scanner/escalation-trigger-scanner.ts`:

- Remove the local `splitSentences` function definition.
- Add an import at the top:

```ts
import { splitSentences } from "../text/sentence-splitter.js";
```

- [ ] **Step 6: Run all tests to verify both call sites pass**

```bash
pnpm --filter @switchboard/core test -- sentence-splitter
pnpm --filter @switchboard/core test -- escalation-trigger-scanner
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass. 1b-1's escalation-trigger-scanner test suite is unchanged and still green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/governance/text/ packages/core/src/governance/scanner/escalation-trigger-scanner.ts
git commit -m "refactor(core): extract splitSentences to shared governance/text util"
```

---

## Task 8: `RegulatoryPublicSource` types + loader + SG/MY seed tables

**Files:**
- Create: `packages/core/src/governance/classifier/regulatory-sources/types.ts`
- Create: `packages/core/src/governance/classifier/regulatory-sources/sg.ts`
- Create: `packages/core/src/governance/classifier/regulatory-sources/my.ts`
- Create: `packages/core/src/governance/classifier/regulatory-sources/loader.ts`
- Create: `packages/core/src/governance/classifier/regulatory-sources/index.ts`
- Create: `packages/core/src/governance/classifier/regulatory-sources/__tests__/loader.test.ts`
- Create: `packages/core/src/governance/classifier/regulatory-sources/__tests__/sg.test.ts`
- Create: `packages/core/src/governance/classifier/regulatory-sources/__tests__/my.test.ts`

This task ships **conservative seed tables**, not placeholders. Minimum 3 entries per category per jurisdiction. Follow 1b-1's banned-phrase authoring contract: case-insensitive strings, regex normalized at loader boundary (always `i`, never `g`), unique `id` invariant, `sources` cited.

- [ ] **Step 1: Define types**

Create `packages/core/src/governance/classifier/regulatory-sources/types.ts`:

```ts
export type RegulatoryPublicSourceCategory =
  | "approved_device"          // HSA / MDA device approvals
  | "approved_clinic_claim"    // MOH / KKM licensed claim language
  | "doctor_credential_path"   // SMC / MMC / APC / LCP lookup pattern
  | "named_certification";     // ISO, GMP, public certifications

export interface RegulatoryPublicSourceEntry {
  id: string;
  category: RegulatoryPublicSourceCategory;
  patterns: ReadonlyArray<string | RegExp>;
  jurisdiction: "SG" | "MY";
  authority: string;
  sources: ReadonlyArray<string>;
  notes?: string;
}
```

- [ ] **Step 2: Reuse 1b-1's `normalizeRegex` helper**

Locate it:

```bash
grep -rn "normalizeRegex" packages/core/src/governance/
```

Expected location: `packages/core/src/governance/banned-phrases/loader.ts` (or a shared `regex.ts` util — 1b-1's plan placed it inside the banned-phrases loader). If it's local to the banned-phrases loader, extract it to `packages/core/src/governance/text/regex.ts` (next to `sentence-splitter.ts`) in this step. The export shape:

```ts
export function normalizeRegex(p: RegExp): RegExp {
  const flags = p.flags.replace(/g/g, "");
  return new RegExp(p.source, flags.includes("i") ? flags : flags + "i");
}
```

Update 1b-1's banned-phrases loader to import from `../text/regex.js`. Run `pnpm --filter @switchboard/core test -- banned-phrases` to confirm parity.

- [ ] **Step 3: Write the failing loader test**

Create `packages/core/src/governance/classifier/regulatory-sources/__tests__/loader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadRegulatoryPublicSources } from "../loader.js";

describe("loadRegulatoryPublicSources", () => {
  it("returns a non-empty SG table", () => {
    const sg = loadRegulatoryPublicSources("SG");
    expect(sg.length).toBeGreaterThanOrEqual(12);  // ≥3 entries × 4 categories
  });

  it("returns a non-empty MY table", () => {
    const my = loadRegulatoryPublicSources("MY");
    expect(my.length).toBeGreaterThanOrEqual(12);
  });

  it("freezes the returned array", () => {
    const sg = loadRegulatoryPublicSources("SG");
    expect(Object.isFrozen(sg)).toBe(true);
  });

  it("guarantees unique ids per jurisdiction", () => {
    for (const j of ["SG", "MY"] as const) {
      const ids = new Set<string>();
      for (const entry of loadRegulatoryPublicSources(j)) {
        expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
        ids.add(entry.id);
      }
    }
  });

  it("strips the g flag from all RegExp patterns", () => {
    for (const j of ["SG", "MY"] as const) {
      for (const entry of loadRegulatoryPublicSources(j)) {
        for (const p of entry.patterns) {
          if (p instanceof RegExp) {
            expect(p.flags.includes("g")).toBe(false);
            expect(p.flags.includes("i")).toBe(true);
          }
        }
      }
    }
  });

  it("returns the same frozen instance on repeated calls (memoization)", () => {
    expect(loadRegulatoryPublicSources("SG")).toBe(loadRegulatoryPublicSources("SG"));
  });
});
```

- [ ] **Step 4: Write seed-content tests per jurisdiction**

Create `packages/core/src/governance/classifier/regulatory-sources/__tests__/sg.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadRegulatoryPublicSources } from "../loader.js";
import type { RegulatoryPublicSourceCategory } from "../types.js";

const CATEGORIES: ReadonlyArray<RegulatoryPublicSourceCategory> = [
  "approved_device",
  "approved_clinic_claim",
  "doctor_credential_path",
  "named_certification",
];

describe("SG regulatory public sources", () => {
  it("has at least 3 entries per category", () => {
    const sg = loadRegulatoryPublicSources("SG");
    for (const cat of CATEGORIES) {
      const subset = sg.filter((e) => e.category === cat);
      expect(subset.length, `SG ${cat} entries`).toBeGreaterThanOrEqual(3);
    }
  });

  it("all entries are jurisdiction=SG", () => {
    const sg = loadRegulatoryPublicSources("SG");
    for (const e of sg) expect(e.jurisdiction).toBe("SG");
  });

  it("names HSA, MOH, or SMC as authority", () => {
    const sg = loadRegulatoryPublicSources("SG");
    const authorities = new Set(sg.map((e) => e.authority));
    expect([...authorities].some((a) => /HSA|MOH|SMC/i.test(a))).toBe(true);
  });
});
```

Create the equivalent `my.test.ts` (replace SG → MY, HSA/MOH/SMC → MDA/KKM/MMC).

- [ ] **Step 5: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- regulatory-sources
```

Expected: module-not-found.

- [ ] **Step 6: Create the loader**

Create `packages/core/src/governance/classifier/regulatory-sources/loader.ts`:

```ts
import type { RegulatoryPublicSourceEntry } from "./types.js";
import { SG_REGULATORY_SOURCES } from "./sg.js";
import { MY_REGULATORY_SOURCES } from "./my.js";
import { normalizeRegex } from "../../text/regex.js";

function normalize(
  entries: readonly RegulatoryPublicSourceEntry[],
): readonly RegulatoryPublicSourceEntry[] {
  const ids = new Set<string>();
  const out: RegulatoryPublicSourceEntry[] = [];
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate regulatory source id: ${entry.id}`);
    }
    ids.add(entry.id);
    out.push({
      ...entry,
      patterns: entry.patterns.map((p) => (p instanceof RegExp ? normalizeRegex(p) : p)),
    });
  }
  return Object.freeze(out);
}

const CACHE: Partial<Record<"SG" | "MY", readonly RegulatoryPublicSourceEntry[]>> = {};

export function loadRegulatoryPublicSources(
  jurisdiction: "SG" | "MY",
): readonly RegulatoryPublicSourceEntry[] {
  const cached = CACHE[jurisdiction];
  if (cached) return cached;
  const raw = jurisdiction === "SG" ? SG_REGULATORY_SOURCES : MY_REGULATORY_SOURCES;
  const normalized = normalize(raw);
  CACHE[jurisdiction] = normalized;
  return normalized;
}
```

- [ ] **Step 7: Create the SG seed table**

Create `packages/core/src/governance/classifier/regulatory-sources/sg.ts`:

```ts
import type { RegulatoryPublicSourceEntry } from "./types.js";

// Conservative seed. Not exhaustive — Phase 1b-2.5 expansion pending regulatory review.
// All patterns are case-insensitive; substrings match against classified sentences.
export const SG_REGULATORY_SOURCES: ReadonlyArray<RegulatoryPublicSourceEntry> = [
  // ───── approved_device ─────
  {
    id: "sg_hsa_thermage_flx",
    category: "approved_device",
    patterns: ["Thermage FLX", "thermage flx"],
    jurisdiction: "SG",
    authority: "HSA",
    sources: ["https://www.hsa.gov.sg/medical-devices/find-medical-device-information"],
    notes: "HSA-listed RF skin-tightening device.",
  },
  {
    id: "sg_hsa_ultherapy",
    category: "approved_device",
    patterns: ["Ultherapy", "ultherapy"],
    jurisdiction: "SG",
    authority: "HSA",
    sources: ["https://www.hsa.gov.sg/medical-devices"],
  },
  {
    id: "sg_hsa_picosure",
    category: "approved_device",
    patterns: ["PicoSure", "picosure"],
    jurisdiction: "SG",
    authority: "HSA",
    sources: ["https://www.hsa.gov.sg/medical-devices"],
  },
  // ───── approved_clinic_claim ─────
  {
    id: "sg_moh_licensed_clinic_generic",
    category: "approved_clinic_claim",
    patterns: ["MOH-licensed", "MOH licensed", "licensed by MOH"],
    jurisdiction: "SG",
    authority: "MOH",
    sources: ["https://www.moh.gov.sg/hpp/all-healthcare-professionals/healthcare-services-act"],
    notes: "Generic MOH-licence language. Does NOT prove a specific clinic; clinic-name claims must escalate.",
  },
  {
    id: "sg_moh_hsa_act_generic",
    category: "approved_clinic_claim",
    patterns: ["under the Healthcare Services Act", /\bHCSA\b/i],
    jurisdiction: "SG",
    authority: "MOH",
    sources: ["https://www.moh.gov.sg/hpp/all-healthcare-professionals/healthcare-services-act"],
  },
  {
    id: "sg_moh_aesthetic_practice_guidelines",
    category: "approved_clinic_claim",
    patterns: ["aesthetic practice guidelines", "SMC aesthetic guidelines"],
    jurisdiction: "SG",
    authority: "MOH",
    sources: ["https://www.healthprofessionals.gov.sg/smc"],
  },
  // ───── doctor_credential_path ─────
  {
    id: "sg_smc_registered_generic",
    category: "doctor_credential_path",
    patterns: ["SMC-registered", "SMC registered", "registered with the SMC"],
    jurisdiction: "SG",
    authority: "SMC",
    sources: ["https://www.healthprofessionals.gov.sg/smc/public-register-of-doctors"],
    notes: "Generic SMC-registration language. Named-person credential claims (e.g., 'Dr X is SMC-registered') must escalate unless a named curated entry exists.",
  },
  {
    id: "sg_smc_specialist_register",
    category: "doctor_credential_path",
    patterns: ["SMC specialist register", "specialist register"],
    jurisdiction: "SG",
    authority: "SMC",
    sources: ["https://www.healthprofessionals.gov.sg/smc/public-register-of-doctors"],
  },
  {
    id: "sg_smc_apc",
    category: "doctor_credential_path",
    patterns: [/\bAPC\b/i, "Annual Practising Certificate"],
    jurisdiction: "SG",
    authority: "SMC",
    sources: ["https://www.healthprofessionals.gov.sg/smc"],
  },
  // ───── named_certification ─────
  {
    id: "sg_iso_13485",
    category: "named_certification",
    patterns: ["ISO 13485", "ISO13485"],
    jurisdiction: "SG",
    authority: "ISO",
    sources: ["https://www.iso.org/standard/59752.html"],
  },
  {
    id: "sg_gmp",
    category: "named_certification",
    patterns: [/\bGMP\b/i, "Good Manufacturing Practice"],
    jurisdiction: "SG",
    authority: "ISO/WHO",
    sources: ["https://www.hsa.gov.sg/manufacturing"],
  },
  {
    id: "sg_csi_singapore",
    category: "named_certification",
    patterns: ["CaseTrust", "Singapore Quality Class"],
    jurisdiction: "SG",
    authority: "Enterprise Singapore",
    sources: ["https://www.case.org.sg/"],
  },
];
```

- [ ] **Step 8: Create the MY seed table**

Create `packages/core/src/governance/classifier/regulatory-sources/my.ts`. Mirror the SG structure with MY authorities (MDA, KKM, MMC) and 12 entries (3 per category). Examples:

```ts
import type { RegulatoryPublicSourceEntry } from "./types.js";

export const MY_REGULATORY_SOURCES: ReadonlyArray<RegulatoryPublicSourceEntry> = [
  // ───── approved_device ─────
  {
    id: "my_mda_thermage_flx",
    category: "approved_device",
    patterns: ["Thermage FLX", "thermage flx"],
    jurisdiction: "MY",
    authority: "MDA",
    sources: ["https://www.mda.gov.my/"],
  },
  {
    id: "my_mda_ultherapy",
    category: "approved_device",
    patterns: ["Ultherapy", "ultherapy"],
    jurisdiction: "MY",
    authority: "MDA",
    sources: ["https://www.mda.gov.my/"],
  },
  {
    id: "my_mda_picosure",
    category: "approved_device",
    patterns: ["PicoSure", "picosure"],
    jurisdiction: "MY",
    authority: "MDA",
    sources: ["https://www.mda.gov.my/"],
  },
  // ───── approved_clinic_claim ─────
  {
    id: "my_kkm_act_586",
    category: "approved_clinic_claim",
    patterns: ["Act 586", "Private Healthcare Facilities and Services Act"],
    jurisdiction: "MY",
    authority: "KKM",
    sources: ["https://www.moh.gov.my/index.php/database_stores/store_view/17"],
  },
  {
    id: "my_kkm_licensed_clinic_generic",
    category: "approved_clinic_claim",
    patterns: ["KKM-licensed", "KKM licensed", "licensed by KKM"],
    jurisdiction: "MY",
    authority: "KKM",
    sources: ["https://www.moh.gov.my/"],
    notes: "Generic KKM-licence language. Named-clinic claims must escalate.",
  },
  {
    id: "my_kkm_mab_aesthetic_guidelines",
    category: "approved_clinic_claim",
    patterns: [/\bMAB\b/i, "Malaysian Aesthetic Board"],
    jurisdiction: "MY",
    authority: "MAB",
    sources: ["https://www.moh.gov.my/"],
  },
  // ───── doctor_credential_path ─────
  {
    id: "my_mmc_registered_generic",
    category: "doctor_credential_path",
    patterns: ["MMC-registered", "MMC registered", "registered with the MMC"],
    jurisdiction: "MY",
    authority: "MMC",
    sources: ["https://mmc.gov.my/registered-medical-practitioners/"],
  },
  {
    id: "my_mmc_apc",
    category: "doctor_credential_path",
    patterns: [/\bAPC\b/i, "Annual Practising Certificate"],
    jurisdiction: "MY",
    authority: "MMC",
    sources: ["https://mmc.gov.my/"],
  },
  {
    id: "my_mmc_lcp",
    category: "doctor_credential_path",
    patterns: [/\bLCP\b/i, "Letter of Credentialing and Privileging"],
    jurisdiction: "MY",
    authority: "KKM",
    sources: ["https://www.moh.gov.my/"],
  },
  // ───── named_certification ─────
  {
    id: "my_iso_13485",
    category: "named_certification",
    patterns: ["ISO 13485", "ISO13485"],
    jurisdiction: "MY",
    authority: "ISO",
    sources: ["https://www.iso.org/standard/59752.html"],
  },
  {
    id: "my_gmp",
    category: "named_certification",
    patterns: [/\bGMP\b/i, "Good Manufacturing Practice"],
    jurisdiction: "MY",
    authority: "ISO/WHO",
    sources: ["https://www.mda.gov.my/"],
  },
  {
    id: "my_iso_9001",
    category: "named_certification",
    patterns: ["ISO 9001"],
    jurisdiction: "MY",
    authority: "ISO",
    sources: ["https://www.iso.org/iso-9001-quality-management.html"],
  },
];
```

- [ ] **Step 9: Barrel**

Create `packages/core/src/governance/classifier/regulatory-sources/index.ts`:

```ts
export * from "./types.js";
export { loadRegulatoryPublicSources } from "./loader.js";
```

- [ ] **Step 10: Run all tests**

```bash
pnpm --filter @switchboard/core test -- regulatory-sources
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all green. ≥12 entries per jurisdiction; unique ids; regex g-flag stripped.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/governance/classifier/regulatory-sources/ packages/core/src/governance/text/regex.ts packages/core/src/governance/banned-phrases/loader.ts
git commit -m "feat(core): RegulatoryPublicSource types + SG/MY seed tables + loader"
```

---

## Task 9: Rewrite template types + SG/MY seed tables + loader

**Files:**
- Create: `packages/core/src/governance/classifier/rewrite-templates/types.ts`
- Create: `packages/core/src/governance/classifier/rewrite-templates/sg.ts`
- Create: `packages/core/src/governance/classifier/rewrite-templates/my.ts`
- Create: `packages/core/src/governance/classifier/rewrite-templates/loader.ts`
- Create: `packages/core/src/governance/classifier/rewrite-templates/index.ts`
- Create: `packages/core/src/governance/classifier/rewrite-templates/__tests__/loader.test.ts`
- Create: `packages/core/src/governance/classifier/rewrite-templates/__tests__/sg.test.ts`
- Create: `packages/core/src/governance/classifier/rewrite-templates/__tests__/my.test.ts`

Templates are fat-data: one TS module per jurisdiction, ≥1 template per `(claimType, jurisdiction)` for the four rewriteable claim types. Authors review in PR.

- [ ] **Step 1: Define types**

Create `packages/core/src/governance/classifier/rewrite-templates/types.ts`:

```ts
import type { ClaimType } from "@switchboard/schemas";

export type RewriteableClaimType = Extract<
  ClaimType,
  "efficacy" | "safety-claim" | "superiority" | "urgency"
>;

export interface RewriteTemplateEntry {
  id: string;
  jurisdiction: "SG" | "MY";
  claimType: RewriteableClaimType;
  template: string;
  notes?: string;
}
```

- [ ] **Step 2: Write failing tests**

Create `packages/core/src/governance/classifier/rewrite-templates/__tests__/loader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadRewriteTemplates } from "../loader.js";

const REWRITEABLE = ["efficacy", "safety-claim", "superiority", "urgency"] as const;

describe("loadRewriteTemplates", () => {
  for (const j of ["SG", "MY"] as const) {
    it(`returns one template per rewriteable claim type for ${j}`, () => {
      const templates = loadRewriteTemplates(j);
      for (const ct of REWRITEABLE) {
        const match = templates.find((t) => t.claimType === ct);
        expect(match, `${j} ${ct} template missing`).toBeDefined();
        expect(match!.template.trim().length).toBeGreaterThan(20);
      }
    });
  }

  it("freezes the returned array", () => {
    expect(Object.isFrozen(loadRewriteTemplates("SG"))).toBe(true);
  });

  it("returns the same instance across calls", () => {
    expect(loadRewriteTemplates("SG")).toBe(loadRewriteTemplates("SG"));
  });

  it("guarantees unique ids per jurisdiction", () => {
    for (const j of ["SG", "MY"] as const) {
      const ids = new Set<string>();
      for (const t of loadRewriteTemplates(j)) {
        expect(ids.has(t.id)).toBe(false);
        ids.add(t.id);
      }
    }
  });
});
```

Create `packages/core/src/governance/classifier/rewrite-templates/__tests__/sg.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadRewriteTemplates } from "../loader.js";

describe("SG rewrite templates", () => {
  it("efficacy template references individual variability", () => {
    const t = loadRewriteTemplates("SG").find((e) => e.claimType === "efficacy")!;
    expect(t.template).toMatch(/results vary|individual|doctor/i);
  });

  it("safety-claim template defers to doctor consultation", () => {
    const t = loadRewriteTemplates("SG").find((e) => e.claimType === "safety-claim")!;
    expect(t.template).toMatch(/doctor|consultation|discuss/i);
  });
});
```

Mirror an MY equivalent (`my.test.ts`).

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- rewrite-templates
```

Expected: module-not-found.

- [ ] **Step 4: Implement the loader**

Create `packages/core/src/governance/classifier/rewrite-templates/loader.ts`:

```ts
import type { RewriteTemplateEntry } from "./types.js";
import { SG_REWRITE_TEMPLATES } from "./sg.js";
import { MY_REWRITE_TEMPLATES } from "./my.js";

function normalize(entries: readonly RewriteTemplateEntry[]): readonly RewriteTemplateEntry[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate rewrite-template id: ${entry.id}`);
    ids.add(entry.id);
  }
  return Object.freeze([...entries]);
}

const CACHE: Partial<Record<"SG" | "MY", readonly RewriteTemplateEntry[]>> = {};

export function loadRewriteTemplates(
  jurisdiction: "SG" | "MY",
): readonly RewriteTemplateEntry[] {
  const cached = CACHE[jurisdiction];
  if (cached) return cached;
  const raw = jurisdiction === "SG" ? SG_REWRITE_TEMPLATES : MY_REWRITE_TEMPLATES;
  const normalized = normalize(raw);
  CACHE[jurisdiction] = normalized;
  return normalized;
}
```

- [ ] **Step 5: Create SG seed**

Create `packages/core/src/governance/classifier/rewrite-templates/sg.ts`:

```ts
import type { RewriteTemplateEntry } from "./types.js";

export const SG_REWRITE_TEMPLATES: ReadonlyArray<RewriteTemplateEntry> = [
  {
    id: "sg_efficacy_results_vary",
    jurisdiction: "SG",
    claimType: "efficacy",
    template:
      "Results vary between individuals — the doctor will go through what's realistic for you during consultation.",
    notes: "HSA / SMC aesthetic-practice guideline — avoids implied outcome guarantee.",
  },
  {
    id: "sg_safety_doctor_consult",
    jurisdiction: "SG",
    claimType: "safety-claim",
    template:
      "Suitability and side effects depend on your skin and health — please discuss with the doctor during consultation.",
    notes: "HSA — avoids implied safety/no-side-effects assurance.",
  },
  {
    id: "sg_superiority_fit_consult",
    jurisdiction: "SG",
    claimType: "superiority",
    template:
      "We can share what makes our approach a fit for you — the doctor will walk through it during consultation.",
    notes: "SMC ethical-code — avoids comparative or superlative claim.",
  },
  {
    id: "sg_urgency_availability_check",
    jurisdiction: "SG",
    claimType: "urgency",
    template: "Let me know when works for you and I'll check availability with the team.",
    notes: "HCSA — replaces time-pressure with neutral availability check.",
  },
];
```

- [ ] **Step 6: Create MY seed**

Create `packages/core/src/governance/classifier/rewrite-templates/my.ts`:

```ts
import type { RewriteTemplateEntry } from "./types.js";

export const MY_REWRITE_TEMPLATES: ReadonlyArray<RewriteTemplateEntry> = [
  {
    id: "my_efficacy_results_vary",
    jurisdiction: "MY",
    claimType: "efficacy",
    template:
      "Results differ from person to person — the doctor will walk you through what to expect during consultation.",
    notes: "MAB / MMC ethical guidelines — avoids implied outcome guarantee.",
  },
  {
    id: "my_safety_doctor_consult",
    jurisdiction: "MY",
    claimType: "safety-claim",
    template:
      "Suitability and side effects depend on each person — the doctor will go through this with you during consultation.",
    notes: "MDA — avoids implied safety/no-side-effects assurance.",
  },
  {
    id: "my_superiority_fit_consult",
    jurisdiction: "MY",
    claimType: "superiority",
    template:
      "Happy to share what makes our approach right for you — the doctor will explain during consultation.",
    notes: "MMC ethical-code — avoids comparative or superlative claim.",
  },
  {
    id: "my_urgency_availability_check",
    jurisdiction: "MY",
    claimType: "urgency",
    template: "Tell me a time that works and I'll check with the team.",
    notes: "KKM / Act 586 — replaces time-pressure with neutral availability check.",
  },
];
```

- [ ] **Step 7: Barrel**

Create `packages/core/src/governance/classifier/rewrite-templates/index.ts`:

```ts
export * from "./types.js";
export { loadRewriteTemplates } from "./loader.js";
```

- [ ] **Step 8: Run tests**

```bash
pnpm --filter @switchboard/core test -- rewrite-templates
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/governance/classifier/rewrite-templates/
git commit -m "feat(core): rewrite-template SG/MY seed tables + loader"
```

---

## Task 10: Classifier prompt module

**Files:**
- Create: `packages/core/src/governance/classifier/prompt.ts`
- Create: `packages/core/src/governance/classifier/__tests__/prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/governance/classifier/__tests__/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CLASSIFIER_PROMPT_VERSION,
  CLASSIFIER_PROMPT_HASH,
  CLASSIFIER_SYSTEM_PROMPT,
} from "../prompt.js";

describe("classifier prompt artifact", () => {
  it("exports a human-readable version string with semver-style suffix", () => {
    expect(CLASSIFIER_PROMPT_VERSION).toMatch(/^claim-classifier@\d+\.\d+\.\d+$/);
  });

  it("exports a 16-char hex hash", () => {
    expect(CLASSIFIER_PROMPT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hash is stable across imports (pure derivation)", async () => {
    const reimport = await import("../prompt.js");
    expect(reimport.CLASSIFIER_PROMPT_HASH).toBe(CLASSIFIER_PROMPT_HASH);
  });

  it("system prompt enumerates all 9 claim types", () => {
    for (const ct of [
      "efficacy",
      "safety-claim",
      "superiority",
      "urgency",
      "testimonial",
      "medical-advice",
      "diagnosis",
      "credentials",
      "none",
    ]) {
      expect(CLASSIFIER_SYSTEM_PROMPT).toContain(ct);
    }
  });

  it("system prompt commits to structured JSON output", () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/JSON|structured/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- classifier/prompt
```

Expected: module-not-found.

- [ ] **Step 3: Implement the prompt**

Create `packages/core/src/governance/classifier/prompt.ts`:

```ts
import { createHash } from "node:crypto";
import { CLASSIFIER_SCHEMA_VERSION } from "@switchboard/schemas";

export const CLASSIFIER_PROMPT_VERSION = "claim-classifier@1.0.0" as const;

export const CLASSIFIER_SYSTEM_PROMPT = `You are a regulatory claim-type classifier for medical aesthetic and beauty spa marketing copy in Singapore and Malaysia.

Given a single sentence from an AI assistant's outbound message, classify it into exactly one of these claim types:
- efficacy: claims about treatment results, outcomes, or effectiveness
- safety-claim: claims about safety, side effects, recovery, suitability
- superiority: comparative or superlative claims about clinic, doctor, treatment, or device
- urgency: time-bounded scarcity or pressure
- testimonial: claims that reference what other clients have said, felt, or experienced
- medical-advice: recommendations for treatment, diagnosis, or care plans
- diagnosis: statements identifying or naming a medical condition the user has
- credentials: claims about doctor qualifications, device approvals, or clinic licensing
- none: neutral facts (booking logistics, address, hours), questions, or non-claim conversation

Respond with structured JSON only via the classify_claim tool. No commentary.

The schema version is ${CLASSIFIER_SCHEMA_VERSION}. Confidence is a number in [0, 1].
`.trim();

const CLAIM_TYPES_FOR_HASH = [
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",
  "none",
] as const;

export const CLASSIFIER_PROMPT_HASH = createHash("sha256")
  .update(CLASSIFIER_SYSTEM_PROMPT)
  .update(JSON.stringify(CLAIM_TYPES_FOR_HASH))
  .digest("hex")
  .slice(0, 16);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- classifier/prompt
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/governance/classifier/prompt.ts packages/core/src/governance/classifier/__tests__/prompt.test.ts
git commit -m "feat(core): versioned classifier prompt artifact + sha256 hash"
```

---

## Task 11: `AnthropicClaimClassifier` adapter with prompt caching + strict tool

**Files:**
- Create: `packages/core/src/governance/classifier/anthropic-classifier.ts`
- Create: `packages/core/src/governance/classifier/__tests__/anthropic-classifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/governance/classifier/__tests__/anthropic-classifier.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createAnthropicClaimClassifier } from "../anthropic-classifier.js";

function mockClient(response: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  } as const;
}

const SUCCESS_RESPONSE = {
  content: [
    {
      type: "tool_use",
      name: "classify_claim",
      input: { claimType: "efficacy", confidence: 0.92 },
    },
  ],
};

describe("AnthropicClaimClassifier", () => {
  it("returns a classified result with prompt-version/hash/schema-version stamps", async () => {
    const client = mockClient(SUCCESS_RESPONSE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    const { result, promptVersion, promptHash, schemaVersion, model } = await classifier.classify({
      sentence: "Most clients see visible slimming.",
      model: "claude-haiku-4-5-20251001",
      signal: new AbortController().signal,
    });
    expect(result.claimType).toBe("efficacy");
    expect(result.confidence).toBeCloseTo(0.92);
    expect(promptVersion).toBe("claim-classifier@1.0.0");
    expect(promptHash).toMatch(/^[0-9a-f]{16}$/);
    expect(schemaVersion).toBe("1.0.0");
    expect(model).toBe("claude-haiku-4-5-20251001");
  });

  it("sets cache_control on system text and last tool definition", async () => {
    const client = mockClient(SUCCESS_RESPONSE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    await classifier.classify({
      sentence: "x",
      model: "claude-haiku-4-5-20251001",
      signal: new AbortController().signal,
    });
    const call = client.messages.create.mock.calls[0][0];
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(call.tools[call.tools.length - 1].cache_control).toEqual({ type: "ephemeral" });
    expect(call.tools[0].strict).toBe(true);
    expect(call.tool_choice).toEqual({ type: "tool", name: "classify_claim" });
  });

  it("throws when the response has no classify_claim tool use", async () => {
    const client = mockClient({ content: [{ type: "text", text: "ignored" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    await expect(
      classifier.classify({
        sentence: "x",
        model: "claude-haiku-4-5-20251001",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/classify_claim/);
  });

  it("propagates AbortError when signal is aborted", async () => {
    const ctrl = new AbortController();
    const client = {
      messages: {
        create: vi.fn().mockImplementation(
          () =>
            new Promise((_, reject) => {
              ctrl.signal.addEventListener("abort", () =>
                reject(Object.assign(new Error("Request aborted"), { name: "AbortError" })),
              );
            }),
        ),
      },
    } as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const classifier = createAnthropicClaimClassifier(client as any);
    const promise = classifier.classify({
      sentence: "x",
      model: "claude-haiku-4-5-20251001",
      signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- anthropic-classifier
```

Expected: module-not-found.

- [ ] **Step 3: Implement the adapter**

Create `packages/core/src/governance/classifier/anthropic-classifier.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import {
  ClassifierSentenceResultSchema,
  CLASSIFIER_SCHEMA_VERSION,
  type ClaimType,
  type ClassifierSentenceResult,
} from "@switchboard/schemas";
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_PROMPT_VERSION,
  CLASSIFIER_PROMPT_HASH,
} from "./prompt.js";

export interface ClassifierCallResult {
  result: ClassifierSentenceResult;
  promptVersion: string;
  promptHash: string;
  schemaVersion: string;
  model: string;
}

export interface AnthropicClaimClassifier {
  classify(input: {
    sentence: string;
    model: string;
    signal: AbortSignal;
  }): Promise<ClassifierCallResult>;
}

const CLASSIFIER_TOOL = {
  name: "classify_claim",
  description: "Classify a single sentence into one regulatory claim type.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      claimType: {
        type: "string" as const,
        enum: [
          "efficacy",
          "safety-claim",
          "superiority",
          "urgency",
          "testimonial",
          "medical-advice",
          "diagnosis",
          "credentials",
          "none",
        ],
      },
      confidence: { type: "number" as const, minimum: 0, maximum: 1 },
    },
    required: ["claimType", "confidence"],
  },
};

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: { claimType: ClaimType; confidence: number };
}

export function createAnthropicClaimClassifier(client: Anthropic): AnthropicClaimClassifier {
  return {
    async classify({ sentence, model, signal }): Promise<ClassifierCallResult> {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 256,
          system: [
            {
              type: "text",
              text: CLASSIFIER_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: [
            {
              ...CLASSIFIER_TOOL,
              cache_control: { type: "ephemeral" },
            },
          ],
          tool_choice: { type: "tool", name: "classify_claim" },
          messages: [{ role: "user", content: sentence }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { signal },
      );

      const blocks = (response as { content?: ReadonlyArray<unknown> }).content ?? [];
      const toolUse = blocks.find(
        (b): b is ToolUseBlock =>
          typeof b === "object" &&
          b !== null &&
          (b as { type?: string }).type === "tool_use" &&
          (b as { name?: string }).name === "classify_claim",
      );
      if (!toolUse) {
        throw new Error("Classifier response missing classify_claim tool use");
      }

      const parsed = ClassifierSentenceResultSchema.parse({
        sentence,
        claimType: toolUse.input.claimType,
        confidence: toolUse.input.confidence,
      });

      return {
        result: parsed,
        promptVersion: CLASSIFIER_PROMPT_VERSION,
        promptHash: CLASSIFIER_PROMPT_HASH,
        schemaVersion: CLASSIFIER_SCHEMA_VERSION,
        model,
      };
    },
  };
}
```

The `as any` cast on the `messages.create` argument is the narrow exception needed because `cache_control` and `strict` are present in the wire format but not yet in the SDK's static types for some installed versions. If the installed SDK version supports them natively, remove the cast. This is the only `any` permitted in the file.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- anthropic-classifier
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/governance/classifier/anthropic-classifier.ts packages/core/src/governance/classifier/__tests__/anthropic-classifier.test.ts
git commit -m "feat(core): AnthropicClaimClassifier adapter with prompt caching + strict tool"
```

---

## Task 12: `runClassifier` runner with per-turn budget + parallel calls

**Files:**
- Create: `packages/core/src/governance/classifier/run-classifier.ts`
- Create: `packages/core/src/governance/classifier/__tests__/run-classifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/governance/classifier/__tests__/run-classifier.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runClassifier } from "../run-classifier.js";
import type { AnthropicClaimClassifier } from "../anthropic-classifier.js";

const SUCCESS = {
  result: { sentence: "x", claimType: "efficacy" as const, confidence: 0.9 },
  promptVersion: "claim-classifier@1.0.0",
  promptHash: "0123456789abcdef",
  schemaVersion: "1.0.0",
  model: "claude-haiku-4-5-20251001",
};

function makeClassifier(behavior: (sentence: string, signal: AbortSignal) => Promise<typeof SUCCESS>): AnthropicClaimClassifier {
  return {
    classify: ({ sentence, signal }) => behavior(sentence, signal),
  };
}

describe("runClassifier", () => {
  it("dispatches all sentences in parallel and preserves order", async () => {
    const order: string[] = [];
    const classifier = makeClassifier(async (s) => {
      order.push(`start:${s}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${s}`);
      return { ...SUCCESS, result: { ...SUCCESS.result, sentence: s } };
    });
    const outcomes = await runClassifier({
      sentences: ["a", "b", "c"],
      model: "m",
      latencyBudgetMs: 1000,
      classifier,
    });
    expect(outcomes.map((o) => o.status)).toEqual(["classified", "classified", "classified"]);
    // All starts happen before any end — confirms parallel dispatch.
    const firstEnd = order.findIndex((s) => s.startsWith("end:"));
    const lastStart = order.findIndex((s) => s.startsWith("end:")) - 1; // sloppy proxy
    expect(order.slice(0, 3).every((s) => s.startsWith("start:"))).toBe(true);
  });

  it("returns timeout for sentences that exceed the budget", async () => {
    const classifier = makeClassifier(
      (sentence, signal) =>
        new Promise((resolve, reject) => {
          if (sentence === "slow") {
            signal.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          } else {
            resolve({ ...SUCCESS, result: { ...SUCCESS.result, sentence } });
          }
        }),
    );
    const outcomes = await runClassifier({
      sentences: ["fast1", "slow", "fast2"],
      model: "m",
      latencyBudgetMs: 30,
      classifier,
    });
    expect(outcomes[0].status).toBe("classified");
    expect(outcomes[1].status).toBe("timeout");
    expect(outcomes[2].status).toBe("classified");
  });

  it("returns error for non-abort rejections", async () => {
    const classifier = makeClassifier(async (sentence) => {
      if (sentence === "boom") throw new Error("api failure");
      return { ...SUCCESS, result: { ...SUCCESS.result, sentence } };
    });
    const outcomes = await runClassifier({
      sentences: ["ok", "boom"],
      model: "m",
      latencyBudgetMs: 1000,
      classifier,
    });
    expect(outcomes[0].status).toBe("classified");
    expect(outcomes[1].status).toBe("error");
    if (outcomes[1].status === "error") {
      expect(outcomes[1].error.message).toContain("api failure");
    }
  });

  it("handles empty sentence array", async () => {
    const classifier = makeClassifier(async () => SUCCESS);
    const outcomes = await runClassifier({
      sentences: [],
      model: "m",
      latencyBudgetMs: 1000,
      classifier,
    });
    expect(outcomes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- run-classifier
```

Expected: module-not-found.

- [ ] **Step 3: Implement the runner**

Create `packages/core/src/governance/classifier/run-classifier.ts`:

```ts
import type {
  AnthropicClaimClassifier,
  ClassifierCallResult,
} from "./anthropic-classifier.js";

export interface RunClassifierInput {
  sentences: readonly string[];
  model: string;
  latencyBudgetMs: number;
  classifier: AnthropicClaimClassifier;
}

export type ClassifierOutcome =
  | { status: "classified"; result: ClassifierCallResult }
  | { status: "timeout"; sentence: string }
  | { status: "error"; sentence: string; error: Error };

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "AbortError"
  );
}

export async function runClassifier(
  input: RunClassifierInput,
): Promise<readonly ClassifierOutcome[]> {
  if (input.sentences.length === 0) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), input.latencyBudgetMs);

  try {
    const settled = await Promise.allSettled(
      input.sentences.map((sentence) =>
        input.classifier.classify({ sentence, model: input.model, signal: ctrl.signal }),
      ),
    );

    return settled.map((s, i): ClassifierOutcome => {
      const sentence = input.sentences[i];
      if (s.status === "fulfilled") {
        return { status: "classified", result: s.value };
      }
      const err = s.reason;
      if (isAbortError(err)) return { status: "timeout", sentence };
      return {
        status: "error",
        sentence,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- run-classifier
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/governance/classifier/run-classifier.ts packages/core/src/governance/classifier/__tests__/run-classifier.test.ts
git commit -m "feat(core): runClassifier — parallel dispatch within per-turn latency budget"
```

---

## Task 13: Substantiation LRU cache

**Files:**
- Create: `packages/core/src/governance/classifier/substantiation-cache.ts`
- Create: `packages/core/src/governance/classifier/__tests__/substantiation-cache.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/governance/classifier/__tests__/substantiation-cache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createInMemoryLRU,
  type SubstantiationCacheKey,
} from "../substantiation-cache.js";

const KEY: SubstantiationCacheKey = {
  sentenceHash: "abc123",
  jurisdiction: "SG",
  claimType: "efficacy",
  deploymentId: "dep_1",
};

const VALUE = {
  status: "matched" as const,
  sourceType: "approved_compliance_claim" as const,
  sourceId: "clm_1",
  matchedText: "visible slimming",
};

describe("InMemoryLRU SubstantiationCache", () => {
  it("returns undefined for missing keys", () => {
    const cache = createInMemoryLRU();
    expect(cache.get(KEY)).toBeUndefined();
  });

  it("round-trips a matched resolution", () => {
    const cache = createInMemoryLRU();
    cache.set(KEY, VALUE);
    expect(cache.get(KEY)).toEqual(VALUE);
  });

  it("isolates by deploymentId (multi-tenant safety)", () => {
    const cache = createInMemoryLRU();
    cache.set(KEY, VALUE);
    expect(cache.get({ ...KEY, deploymentId: "dep_2" })).toBeUndefined();
  });

  it("isolates by jurisdiction and claimType", () => {
    const cache = createInMemoryLRU();
    cache.set(KEY, VALUE);
    expect(cache.get({ ...KEY, jurisdiction: "MY" })).toBeUndefined();
    expect(cache.get({ ...KEY, claimType: "safety-claim" })).toBeUndefined();
  });

  it("evicts least-recently-used entries past maxEntries", () => {
    const cache = createInMemoryLRU({ maxEntries: 2 });
    const k1: SubstantiationCacheKey = { ...KEY, sentenceHash: "h1" };
    const k2: SubstantiationCacheKey = { ...KEY, sentenceHash: "h2" };
    const k3: SubstantiationCacheKey = { ...KEY, sentenceHash: "h3" };

    cache.set(k1, VALUE);
    cache.set(k2, VALUE);
    expect(cache.get(k1)).toEqual(VALUE);   // k1 is now most-recently-used
    cache.set(k3, VALUE);                    // evicts k2 (LRU)

    expect(cache.get(k1)).toEqual(VALUE);
    expect(cache.get(k2)).toBeUndefined();
    expect(cache.get(k3)).toEqual(VALUE);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- substantiation-cache
```

Expected: module-not-found.

- [ ] **Step 3: Implement the cache**

Create `packages/core/src/governance/classifier/substantiation-cache.ts`:

```ts
import type { SubstantiationResolution } from "@switchboard/schemas";
import type { ClaimType } from "@switchboard/schemas";

export interface SubstantiationCacheKey {
  sentenceHash: string;
  jurisdiction: "SG" | "MY";
  claimType: ClaimType;
  deploymentId: string;
}

export interface SubstantiationCache {
  get(key: SubstantiationCacheKey): SubstantiationResolution | undefined;
  set(key: SubstantiationCacheKey, value: SubstantiationResolution): void;
}

export interface InMemoryLRUOptions {
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 5000;

function serialize(key: SubstantiationCacheKey): string {
  return `${key.deploymentId}|${key.jurisdiction}|${key.claimType}|${key.sentenceHash}`;
}

export function createInMemoryLRU(opts: InMemoryLRUOptions = {}): SubstantiationCache {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  // JS Map preserves insertion order; deleting and re-inserting moves the key
  // to the end, which is the LRU promotion primitive we need.
  const store = new Map<string, SubstantiationResolution>();

  return {
    get(key) {
      const k = serialize(key);
      const v = store.get(k);
      if (v !== undefined) {
        // Promote to most-recently-used.
        store.delete(k);
        store.set(k, v);
      }
      return v;
    },
    set(key, value) {
      const k = serialize(key);
      if (store.has(k)) store.delete(k);
      store.set(k, value);
      while (store.size > maxEntries) {
        // Evict the oldest key (first inserted).
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- substantiation-cache
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/governance/classifier/substantiation-cache.ts packages/core/src/governance/classifier/__tests__/substantiation-cache.test.ts
git commit -m "feat(core): in-memory LRU SubstantiationCache (match-only, bounded)"
```

---

## Task 14: Substantiation resolver

**Files:**
- Create: `packages/core/src/governance/classifier/substantiation-resolver.ts`
- Create: `packages/core/src/governance/classifier/__tests__/substantiation-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/governance/classifier/__tests__/substantiation-resolver.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createSubstantiationResolver } from "../substantiation-resolver.js";
import { createInMemoryLRU } from "../substantiation-cache.js";
import type { ApprovedComplianceClaimRecord, ApprovedComplianceClaimStore } from "../approved-compliance-claim-store/index.js";
import type { RegulatoryPublicSourceEntry } from "../regulatory-sources/index.js";

const NOW = new Date("2026-05-11T12:00:00.000Z");
const STALE_DATE = new Date("2025-10-01T00:00:00.000Z").toISOString();   // > 180 days ago
const FRESH_DATE = new Date("2026-04-15T00:00:00.000Z").toISOString();   // < 180 days ago

function makeStore(rows: ApprovedComplianceClaimRecord[]): ApprovedComplianceClaimStore {
  return { list: vi.fn().mockResolvedValue(rows) };
}

function freshClaim(overrides: Partial<ApprovedComplianceClaimRecord> = {}): ApprovedComplianceClaimRecord {
  return {
    id: "clm_1",
    deploymentId: "dep_1",
    jurisdiction: "SG",
    claimType: "efficacy",
    claimText: "visible slimming",
    reviewedBy: "Dr Lim",
    reviewedAt: FRESH_DATE,
    validUntil: null,
    notes: null,
    createdAt: FRESH_DATE,
    updatedAt: FRESH_DATE,
    ...overrides,
  };
}

describe("createSubstantiationResolver", () => {
  it("returns matched when an approved_compliance_claim substring-hits the sentence", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim()]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "Most clients see visible slimming after one session.",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("matched");
    expect(res.sourceType).toBe("approved_compliance_claim");
    expect(res.sourceId).toBe("clm_1");
    expect(res.matchedText).toContain("visible slimming");
  });

  it("returns stale when the approved claim is older than 180 days", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim({ reviewedAt: STALE_DATE })]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "visible slimming results",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("stale");
  });

  it("returns stale when validUntil is past", async () => {
    const past = new Date("2026-05-01T00:00:00.000Z").toISOString();
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim({ validUntil: past })]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "visible slimming",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("stale");
  });

  it("returns missing when no source matches", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "anything goes",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing");
  });

  it("falls through tiers for safety-claim: approved → regulatory", async () => {
    const regEntry: RegulatoryPublicSourceEntry = {
      id: "sg_hsa_thermage_flx",
      category: "approved_device",
      patterns: ["Thermage FLX"],
      jurisdiction: "SG",
      authority: "HSA",
      sources: [],
    };
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([]),
      regulatoryLoader: () => [regEntry],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "Our Thermage FLX programme is safe for most skin types.",
      claimType: "safety-claim",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("matched");
    expect(res.sourceType).toBe("regulatory_public_source");
    expect(res.sourceId).toBe("sg_hsa_thermage_flx");
  });

  it("credentials only dispatches to regulatory_public_source", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim({ claimType: "credentials" })]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "Dr Jane is SMC-registered.",
      claimType: "credentials",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing");  // no regulatory match, approved-claim path skipped
  });

  it("testimonial / medical-advice / diagnosis dispatch to no tiers", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim()]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    for (const ct of ["testimonial", "medical-advice", "diagnosis"] as const) {
      const res = await resolver.resolve({
        sentence: "anything",
        claimType: ct,
        jurisdiction: "SG",
        deploymentId: "dep_1",
      });
      expect(res.status).toBe("missing");
    }
  });

  it("caches matched resolutions but not stale/missing", async () => {
    const cache = createInMemoryLRU();
    const list = vi.fn().mockResolvedValue([freshClaim()]);
    const resolver = createSubstantiationResolver({
      approvedClaimStore: { list },
      regulatoryLoader: () => [],
      cache,
      clock: () => NOW,
    });
    await resolver.resolve({
      sentence: "visible slimming",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    await resolver.resolve({
      sentence: "visible slimming",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(list).toHaveBeenCalledTimes(1);  // second call short-circuited via cache
  });

  it("treats approvedClaimStore.list throw as missing (defensive)", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: { list: vi.fn().mockRejectedValue(new Error("db down")) },
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "x",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- substantiation-resolver
```

Expected: module-not-found.

- [ ] **Step 3: Implement the resolver**

Create `packages/core/src/governance/classifier/substantiation-resolver.ts`:

```ts
import { createHash } from "node:crypto";
import type {
  ClaimType,
  SubstantiationResolution,
  SubstantiationSourceType,
} from "@switchboard/schemas";
import type {
  ApprovedComplianceClaimRecord,
  ApprovedComplianceClaimStore,
} from "./approved-compliance-claim-store/index.js";
import type { RegulatoryPublicSourceEntry } from "./regulatory-sources/index.js";
import type { SubstantiationCache } from "./substantiation-cache.js";

const STALENESS_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

const SOURCE_TIERS_BY_CLAIM_TYPE: Record<ClaimType, ReadonlyArray<SubstantiationSourceType>> = {
  efficacy: ["approved_compliance_claim"],
  "safety-claim": ["approved_compliance_claim", "regulatory_public_source"],
  superiority: ["approved_compliance_claim"],
  urgency: ["approved_compliance_claim"],
  testimonial: [],
  "medical-advice": [],
  diagnosis: [],
  credentials: ["regulatory_public_source"],
  none: [],
};

export interface SubstantiationResolverInput {
  sentence: string;
  claimType: ClaimType;
  jurisdiction: "SG" | "MY";
  deploymentId: string;
}

export interface SubstantiationResolver {
  resolve(input: SubstantiationResolverInput): Promise<SubstantiationResolution>;
}

export interface SubstantiationResolverDeps {
  approvedClaimStore: ApprovedComplianceClaimStore;
  regulatoryLoader: (j: "SG" | "MY") => readonly RegulatoryPublicSourceEntry[];
  cache: SubstantiationCache;
  clock: () => Date;
}

function hashSentence(sentence: string): string {
  return createHash("sha256").update(sentence.toLowerCase()).digest("hex").slice(0, 32);
}

function isStale(claim: ApprovedComplianceClaimRecord, now: Date): boolean {
  if (claim.validUntil && new Date(claim.validUntil).getTime() < now.getTime()) return true;
  if (new Date(claim.reviewedAt).getTime() < now.getTime() - STALENESS_WINDOW_MS) return true;
  return false;
}

function matchClaim(
  sentenceLower: string,
  claims: readonly ApprovedComplianceClaimRecord[],
  now: Date,
): SubstantiationResolution | null {
  for (const claim of claims) {
    if (!sentenceLower.includes(claim.claimText.toLowerCase())) continue;
    if (isStale(claim, now)) {
      return {
        status: "stale",
        sourceType: "approved_compliance_claim",
        sourceId: claim.id,
        matchedText: claim.claimText,
      };
    }
    return {
      status: "matched",
      sourceType: "approved_compliance_claim",
      sourceId: claim.id,
      matchedText: claim.claimText,
    };
  }
  return null;
}

function matchRegulatory(
  sentenceLower: string,
  sentenceOriginal: string,
  entries: readonly RegulatoryPublicSourceEntry[],
): SubstantiationResolution | null {
  for (const entry of entries) {
    for (const pattern of entry.patterns) {
      if (typeof pattern === "string") {
        if (sentenceLower.includes(pattern.toLowerCase())) {
          return {
            status: "matched",
            sourceType: "regulatory_public_source",
            sourceId: entry.id,
            matchedText: pattern,
          };
        }
      } else {
        const m = sentenceOriginal.match(pattern);
        if (m) {
          return {
            status: "matched",
            sourceType: "regulatory_public_source",
            sourceId: entry.id,
            matchedText: m[0],
          };
        }
      }
    }
  }
  return null;
}

export function createSubstantiationResolver(
  deps: SubstantiationResolverDeps,
): SubstantiationResolver {
  return {
    async resolve(input): Promise<SubstantiationResolution> {
      const tiers = SOURCE_TIERS_BY_CLAIM_TYPE[input.claimType];
      if (tiers.length === 0) return { status: "missing" };

      const cacheKey = {
        sentenceHash: hashSentence(input.sentence),
        jurisdiction: input.jurisdiction,
        claimType: input.claimType,
        deploymentId: input.deploymentId,
      };

      const cached = deps.cache.get(cacheKey);
      if (cached !== undefined) return cached;

      const sentenceLower = input.sentence.toLowerCase();
      const now = deps.clock();

      for (const tier of tiers) {
        if (tier === "approved_compliance_claim") {
          let claims: readonly ApprovedComplianceClaimRecord[] = [];
          try {
            claims = await deps.approvedClaimStore.list({
              deploymentId: input.deploymentId,
              jurisdiction: input.jurisdiction,
              claimType: input.claimType,
            });
          } catch (err) {
            console.error("[substantiation-resolver] approvedClaimStore.list threw", err);
            continue;  // treat as missing for this tier
          }
          const hit = matchClaim(sentenceLower, claims, now);
          if (hit) {
            if (hit.status === "matched") deps.cache.set(cacheKey, hit);
            return hit;
          }
        } else if (tier === "regulatory_public_source") {
          const entries = deps.regulatoryLoader(input.jurisdiction);
          const hit = matchRegulatory(sentenceLower, input.sentence, entries);
          if (hit) {
            deps.cache.set(cacheKey, hit);
            return hit;
          }
        }
      }

      return { status: "missing" };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- substantiation-resolver
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/governance/classifier/substantiation-resolver.ts packages/core/src/governance/classifier/__tests__/substantiation-resolver.test.ts
git commit -m "feat(core): substantiation resolver with tier dispatch + staleness + cache"
```

---


## Task 15: `ClaimClassifierHook` (the integrating hook)

**Files:**
- Create: `packages/core/src/skill-runtime/hooks/claim-classifier.ts`
- Create: `packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts`
- Modify: `packages/core/src/governance/classifier/index.ts` — barrel

This task wires Tasks 6–14 into a single hook. The implementation has the most surface area; tests below cover the mode matrix × outcome matrix exhaustively.

**Hook contract (verified against `packages/core/src/skill-runtime/types.ts:224-233`):**
- `SkillHook` requires a `name: string` property and an optional `afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void>` method.
- `SkillHookContext` has `{ deploymentId, orgId, skillSlug, skillVersion, sessionId, trustLevel, trustScore }`. **No `conversationId` field** — the hook uses `ctx.sessionId` as the verdict's `conversationId`.
- `SkillExecutionResult.response` is a **single string** (not a `messages[]` array). The hook mutates `result.response` in place; there is no replacement return value.

- [ ] **Step 1: Define the dependency surface and outline behavior**

The hook composes:
- `GovernanceConfigResolver` (existing 1b-1 type)
- `GovernancePostureCache` (separate instance — see Task 16)
- `AnthropicClaimClassifier` (Task 11)
- `SubstantiationResolver` (Task 14)
- `rewriteLoader: (j) => readonly RewriteTemplateEntry[]` (Task 9)
- `GovernanceVerdictStore` (1b-1)
- `HandoffStore` (1b-1)
- `ConversationStateStore` (existing)
- `splitSentences` (Task 7)
- `clock: () => Date`
- `renderHandoff: (input: { jurisdiction; reasonCode }) => string` (1b-1's `renderHandoffTemplate`)

Action per sentence:
- `none` → allow.
- `testimonial | medical-advice | diagnosis | credentials` (no matching regulatory source) → escalate.
- `efficacy | safety-claim | superiority | urgency`: resolve substantiation. Matched → allow. Stale/missing → rewrite via template (escalate if no template).
- `classifier_timeout` / `classifier_error` → escalate.

Whole-response effect:
- Any sentence escalates → replace `result.response` with the handoff template + handoff + `human_override`.
- All allow + any rewrite → `result.response = result.response.replace(originalSentence, replacement)` for each rewrite; no `human_override`.
- All allow → leave `result.response` unchanged.

- [ ] **Step 2: Write the failing tests — config + mode matrix**

Create `packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ClaimClassifierHook } from "../claim-classifier.js";
import type { AnthropicClaimClassifier } from "../../../governance/classifier/anthropic-classifier.js";
import type { SubstantiationResolver } from "../../../governance/classifier/substantiation-resolver.js";
import type { RewriteTemplateEntry } from "../../../governance/classifier/rewrite-templates/index.js";
import type { GovernanceConfigResolver } from "../../../governance/governance-config-resolver.js";
import type { GovernancePostureCache } from "../../../governance/posture-cache.js";
import type { GovernanceVerdictStore } from "../../../governance/governance-verdict-store/index.js";
import type {
  SkillHookContext,
  SkillExecutionResult,
} from "../../types.js";
import type { ClaimType } from "@switchboard/schemas";

function fakeResolver(
  mode: "off" | "observe" | "enforce" | "missing" | "error",
): GovernanceConfigResolver {
  return async () => {
    if (mode === "missing") return { status: "missing" };
    if (mode === "error") return { status: "error", error: new Error("boom") };
    return {
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "off" },
        claimClassifier: { mode, latencyBudgetMs: 800, model: "claude-haiku-4-5-20251001" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    };
  };
}

function fakePostureCache(
  initial?: { mode: "off" | "observe" | "enforce" },
): GovernancePostureCache {
  const map = new Map<
    string,
    { mode: "off" | "observe" | "enforce"; jurisdiction: "SG" | "MY"; clinicType: "medical" | "nonMedical" }
  >();
  if (initial) map.set("dep_1", { mode: initial.mode, jurisdiction: "SG", clinicType: "medical" });
  return {
    remember: (id, posture) => map.set(id, posture),
    lastKnown: (id) => map.get(id),
  };
}

function fakeClassifier(outcomes: Record<string, ClaimType>): AnthropicClaimClassifier {
  return {
    classify: async ({ sentence, model }) => ({
      result: { sentence, claimType: outcomes[sentence] ?? "none", confidence: 0.9 },
      promptVersion: "claim-classifier@1.0.0",
      promptHash: "0123456789abcdef",
      schemaVersion: "1.0.0",
      model,
    }),
  };
}

function throwingClassifier(throwOn: string): AnthropicClaimClassifier {
  return {
    classify: async ({ sentence, model }) => {
      if (sentence === throwOn) throw new Error("api down");
      return {
        result: { sentence, claimType: "none" as const, confidence: 0.9 },
        promptVersion: "claim-classifier@1.0.0",
        promptHash: "0123456789abcdef",
        schemaVersion: "1.0.0",
        model,
      };
    },
  };
}

function fakeResolverSubst(status: "matched" | "stale" | "missing"): SubstantiationResolver {
  return { resolve: async () => ({ status }) };
}

const SG_REWRITES: ReadonlyArray<RewriteTemplateEntry> = [
  {
    id: "sg_efficacy_results_vary",
    jurisdiction: "SG",
    claimType: "efficacy",
    template: "Results vary between individuals — the doctor will go through what's realistic for you during consultation.",
  },
];

function fakeVerdictStore(): GovernanceVerdictStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    save: async (v) => {
      saved.push(v);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { id: `vrd_${saved.length}`, ...v, createdAt: new Date().toISOString() } as any;
    },
    listByConversation: async () => [],
    listByDeployment: async () => [],
  };
}

function fakeHandoffStore() {
  const saved: unknown[] = [];
  return { saved, save: async (h: unknown) => { saved.push(h); } };
}

function fakeConversationStore() {
  const statuses: Record<string, string> = {};
  return {
    setConversationStatus: async (id: string, s: string) => { statuses[id] = s; },
    getStatus: (id: string) => statuses[id],
  };
}

function makeHook(overrides: Partial<{
  configMode: "off" | "observe" | "enforce" | "missing" | "error";
  classifier: AnthropicClaimClassifier;
  classifierOutcomes: Record<string, ClaimType>;
  substantiation: "matched" | "stale" | "missing";
  posture: { mode: "off" | "observe" | "enforce" } | undefined;
  rewrites: ReadonlyArray<RewriteTemplateEntry>;
}> = {}) {
  const mode = overrides.configMode ?? "enforce";
  const classifier = overrides.classifier ?? fakeClassifier(overrides.classifierOutcomes ?? {});
  const substantiation = fakeResolverSubst(overrides.substantiation ?? "missing");
  const verdictStore = fakeVerdictStore();
  const handoffStore = fakeHandoffStore();
  const conversationStore = fakeConversationStore();
  const postureCache = fakePostureCache(overrides.posture);
  const hook = new ClaimClassifierHook({
    governanceConfigResolver: fakeResolver(mode),
    postureCache,
    classifier,
    substantiationResolver: substantiation,
    rewriteLoader: () => overrides.rewrites ?? SG_REWRITES,
    verdictStore,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handoffStore: handoffStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversationStore: conversationStore as any,
    splitSentences: (text: string) =>
      text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    clock: () => new Date("2026-05-11T12:00:00.000Z"),
    renderHandoff: ({ jurisdiction }) =>
      jurisdiction === "SG"
        ? "Thanks for sharing that — this is something the clinic team should advise on directly. I'll get them to follow up with you shortly."
        : "Thanks for sharing that — this is something the clinic team should advise on directly. I'll have them follow up with you shortly.",
  });
  return { hook, verdictStore, handoffStore, conversationStore };
}

const HOOK_CTX: SkillHookContext = {
  deploymentId: "dep_1",
  orgId: "org_1",
  skillSlug: "alex",
  skillVersion: "1.0.0",
  sessionId: "sess_1",
  trustLevel: "supervised",
  trustScore: 0.8,
};

function makeResult(response: string): SkillExecutionResult {
  return {
    response,
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 100,
      turnCount: 1,
      status: "success",
      responseSummary: response.slice(0, 80),
      writeCount: 0,
      governanceDecisions: [],
    },
  };
}

describe("ClaimClassifierHook — name + config + mode matrix", () => {
  it("exposes hook name", () => {
    const { hook } = makeHook({ configMode: "off" });
    expect(hook.name).toBe("claim-classifier");
  });

  it("passes through when config is missing", async () => {
    const { hook, verdictStore } = makeHook({ configMode: "missing" });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
    expect(result.response).toBe("Most clients see results.");
  });

  it("passes through when mode is off", async () => {
    const { hook, verdictStore } = makeHook({ configMode: "off" });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
  });

  it("observe mode persists verdicts but does not modify response", async () => {
    const { hook, verdictStore, handoffStore } = makeHook({
      configMode: "observe",
      classifierOutcomes: { "Visible slimming after one session.": "efficacy" },
      substantiation: "missing",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    expect(result.response).toBe("Visible slimming after one session.");
    expect(handoffStore.saved).toHaveLength(0);
  });

  it("fails open in enforce mode when resolver errors with cold cache", async () => {
    const { hook, verdictStore } = makeHook({ configMode: "error", posture: undefined });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
    expect(result.response).toBe("Most clients see results.");
  });

  it("fails closed when last-known posture is enforce", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      configMode: "error",
      posture: { mode: "enforce" },
    });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.reasonCode).toBe("governance_unavailable");
    expect(v.conversationId).toBe("sess_1");
    expect(handoffStore.saved).toHaveLength(1);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
    expect(result.response).toContain("clinic team");
  });
});

describe("ClaimClassifierHook — outcome matrix in enforce mode", () => {
  it("allows when classifier returns none", async () => {
    const { hook, verdictStore } = makeHook({
      classifierOutcomes: { "Our address is 123 Orchard Road.": "none" },
    });
    const result = makeResult("Our address is 123 Orchard Road.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
    expect(result.response).toBe("Our address is 123 Orchard Road.");
  });

  it("allows when substantiation matches", async () => {
    const { hook, verdictStore } = makeHook({
      classifierOutcomes: { "Visible slimming after one session.": "efficacy" },
      substantiation: "matched",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
  });

  it("rewrites in place when substantiation is missing for rewriteable claim", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      classifierOutcomes: { "Visible slimming after one session.": "efficacy" },
      substantiation: "missing",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.action).toBe("rewrite");
    expect(v.reasonCode).toBe("unsupported_claim_rewritten");
    expect(v.conversationId).toBe("sess_1");
    expect(v.details.promptVersion).toBe("claim-classifier@1.0.0");
    expect(v.details.claimType).toBe("efficacy");
    expect(v.details.originalSentence).toBe("Visible slimming after one session.");
    expect(v.details.rewrittenSentence).toContain("Results vary");
    expect(result.response).toContain("Results vary");
    expect(result.response).not.toContain("Visible slimming");
    expect(handoffStore.saved).toHaveLength(0);
    expect(conversationStore.getStatus("sess_1")).toBeUndefined();
  });

  it("emits claim_substantiation_stale when stale", async () => {
    const { hook, verdictStore } = makeHook({
      classifierOutcomes: { "Visible slimming after one session.": "efficacy" },
      substantiation: "stale",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.reasonCode).toBe("claim_substantiation_stale");
  });

  it("escalates whole response on diagnosis claim type", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      classifier: {
        classify: async ({ sentence, model }) => ({
          result: {
            sentence,
            claimType: sentence.includes("rosacea") ? "diagnosis" : "none",
            confidence: 0.95,
          },
          promptVersion: "claim-classifier@1.0.0",
          promptHash: "0123456789abcdef",
          schemaVersion: "1.0.0",
          model,
        }),
      },
    });
    const result = makeResult("We open at 10am. I think you have rosacea.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.reasonCode).toBe("unsupported_claim_escalated");
    expect(v.details.claimType).toBe("diagnosis");
    expect(handoffStore.saved).toHaveLength(1);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
    expect(result.response).toContain("clinic team");
    expect(result.response).not.toContain("rosacea");
    expect(result.response).not.toContain("10am");
  });

  it("escalates on classifier_error", async () => {
    const { hook, verdictStore, conversationStore } = makeHook({
      classifier: throwingClassifier("This sentence will throw."),
    });
    const result = makeResult("This sentence will throw.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.reasonCode).toBe("classifier_error");
    expect(v.details.errorKind).toBe("api_error");
    expect(v.details.errorMessage).toContain("api down");
    expect(v.details.latencyBudgetMs).toBe(800);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
  });

  it("falls through to escalate when no rewrite template for the claim type", async () => {
    const { hook, verdictStore } = makeHook({
      classifierOutcomes: { "Visible slimming after one session.": "efficacy" },
      substantiation: "missing",
      rewrites: [],   // empty templates
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.action).toBe("escalate");
    expect(v.reasonCode).toBe("unsupported_claim_escalated");
  });
});
```

Add additional sentence-level cases for `testimonial`, `medical-advice`, `classifier_timeout` (force a timeout by setting `latencyBudgetMs: 0` in the config and using a classifier that defers via `signal`). The structure mirrors the `classifier_error` case.

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- claim-classifier
```

Expected: module-not-found.

- [ ] **Step 4: Implement the hook**

Create `packages/core/src/skill-runtime/hooks/claim-classifier.ts`:

```ts
import type {
  GovernanceVerdict,
  GovernanceVerdictReason,
} from "@switchboard/schemas";
import {
  resolveClaimClassifierConfig,
  type ClaimType,
} from "@switchboard/schemas";
import type {
  SkillHook,
  SkillHookContext,
  SkillExecutionResult,
} from "../types.js";
import type { AnthropicClaimClassifier } from "../../governance/classifier/anthropic-classifier.js";
import type { SubstantiationResolver } from "../../governance/classifier/substantiation-resolver.js";
import type { RewriteTemplateEntry } from "../../governance/classifier/rewrite-templates/index.js";
import type { GovernanceVerdictStore } from "../../governance/governance-verdict-store/index.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import type { GovernancePostureCache } from "../../governance/posture-cache.js";
import { runClassifier, type ClassifierOutcome } from "../../governance/classifier/run-classifier.js";

export interface ClaimClassifierHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  postureCache: GovernancePostureCache;
  classifier: AnthropicClaimClassifier;
  substantiationResolver: SubstantiationResolver;
  rewriteLoader: (j: "SG" | "MY") => readonly RewriteTemplateEntry[];
  verdictStore: GovernanceVerdictStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handoffStore: { save(input: any): Promise<void> };
  conversationStore: { setConversationStatus(sessionId: string, status: string): Promise<void> };
  splitSentences: (text: string) => readonly string[];
  clock: () => Date;
  renderHandoff: (input: { jurisdiction: "SG" | "MY"; reasonCode: GovernanceVerdictReason }) => string;
}

type SentenceAction =
  | { kind: "allow" }
  | {
      kind: "rewrite";
      originalSentence: string;
      replacement: string;
      reasonCode: GovernanceVerdictReason;
      details: Record<string, unknown>;
    }
  | {
      kind: "escalate";
      originalSentence: string;
      reasonCode: GovernanceVerdictReason;
      details: Record<string, unknown>;
    };

const REWRITEABLE: ReadonlyArray<ClaimType> = ["efficacy", "safety-claim", "superiority", "urgency"];
const ESCALATE_ONLY: ReadonlyArray<ClaimType> = ["testimonial", "medical-advice", "diagnosis"];

export class ClaimClassifierHook implements SkillHook {
  readonly name = "claim-classifier";

  constructor(private readonly deps: ClaimClassifierHookDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const resolution = await this.deps.governanceConfigResolver(ctx.deploymentId);

    if (resolution.status === "missing") return;
    if (resolution.status === "error") {
      const cached = this.deps.postureCache.lastKnown(ctx.deploymentId);
      if (cached?.mode === "enforce") {
        await this.failClosed(ctx, result, cached.jurisdiction, cached.clinicType);
        return;
      }
      console.error(
        "[claim-classifier] resolver error and posture cache miss/observe/off → fail open",
        resolution.error,
      );
      return;
    }

    const config = resolution.config;
    const classifierConfig = resolveClaimClassifierConfig(config);
    if (classifierConfig.mode === "off") return;

    const jurisdiction = (config as unknown as { jurisdiction: "SG" | "MY" }).jurisdiction;
    const clinicType = (config as unknown as { clinicType: "medical" | "nonMedical" }).clinicType;

    this.deps.postureCache.remember(ctx.deploymentId, {
      mode: classifierConfig.mode,
      jurisdiction,
      clinicType,
    });

    const sentences = this.deps.splitSentences(result.response);
    if (sentences.length === 0) return;

    const outcomes = await runClassifier({
      sentences,
      model: classifierConfig.model,
      latencyBudgetMs: classifierConfig.latencyBudgetMs,
      classifier: this.deps.classifier,
    });

    const actions: SentenceAction[] = [];
    for (let i = 0; i < outcomes.length; i++) {
      actions.push(
        await this.decideAction({
          outcome: outcomes[i],
          sentence: sentences[i],
          jurisdiction,
          deploymentId: ctx.deploymentId,
          latencyBudgetMs: classifierConfig.latencyBudgetMs,
        }),
      );
    }

    const hasEscalate = actions.some((a) => a.kind === "escalate");
    const hasRewrite = actions.some((a) => a.kind === "rewrite");

    if (hasEscalate) {
      await this.applyEscalate({ ctx, result, actions, jurisdiction, clinicType, mode: classifierConfig.mode });
      return;
    }

    if (hasRewrite) {
      await this.applyRewrites({ ctx, result, actions, jurisdiction, clinicType, mode: classifierConfig.mode });
      return;
    }
  }

  private async decideAction(args: {
    outcome: ClassifierOutcome;
    sentence: string;
    jurisdiction: "SG" | "MY";
    deploymentId: string;
    latencyBudgetMs: number;
  }): Promise<SentenceAction> {
    const { outcome, sentence, jurisdiction, deploymentId, latencyBudgetMs } = args;

    if (outcome.status === "timeout") {
      return {
        kind: "escalate",
        originalSentence: sentence,
        reasonCode: "classifier_timeout",
        details: {
          originalSentence: sentence,
          errorKind: "timeout",
          latencyBudgetMs,
          schemaVersion: "1.0.0",
        },
      };
    }

    if (outcome.status === "error") {
      return {
        kind: "escalate",
        originalSentence: sentence,
        reasonCode: "classifier_error",
        details: {
          originalSentence: sentence,
          errorKind: "api_error",
          latencyBudgetMs,
          schemaVersion: "1.0.0",
          errorMessage: outcome.error.message.slice(0, 200),
        },
      };
    }

    const { result, promptVersion, promptHash, schemaVersion, model } = outcome.result;
    const baseDetails: Record<string, unknown> = {
      promptVersion,
      promptHash,
      schemaVersion,
      model,
      claimType: result.claimType,
      confidence: result.confidence,
      originalSentence: sentence,
    };

    if (result.claimType === "none") return { kind: "allow" };

    if (ESCALATE_ONLY.includes(result.claimType)) {
      return {
        kind: "escalate",
        originalSentence: sentence,
        reasonCode: "unsupported_claim_escalated",
        details: baseDetails,
      };
    }

    const resolution = await this.deps.substantiationResolver.resolve({
      sentence,
      claimType: result.claimType,
      jurisdiction,
      deploymentId,
    });

    if (resolution.status === "matched") return { kind: "allow" };

    const detailsWithSource = {
      ...baseDetails,
      matchedSourceId: resolution.sourceId,
      matchedSourceType: resolution.sourceType,
      matchedText: resolution.matchedText,
    };

    if (result.claimType === "credentials") {
      return {
        kind: "escalate",
        originalSentence: sentence,
        reasonCode:
          resolution.status === "stale" ? "claim_substantiation_stale" : "unsupported_claim_escalated",
        details: detailsWithSource,
      };
    }

    if (REWRITEABLE.includes(result.claimType)) {
      const template = this.deps
        .rewriteLoader(jurisdiction)
        .find((t) => t.claimType === result.claimType);
      if (!template) {
        console.error(
          `[claim-classifier] no rewrite template for (${result.claimType}, ${jurisdiction}) — escalating`,
        );
        return {
          kind: "escalate",
          originalSentence: sentence,
          reasonCode: "unsupported_claim_escalated",
          details: detailsWithSource,
        };
      }
      return {
        kind: "rewrite",
        originalSentence: sentence,
        replacement: template.template,
        reasonCode:
          resolution.status === "stale" ? "claim_substantiation_stale" : "unsupported_claim_rewritten",
        details: { ...detailsWithSource, rewrittenSentence: template.template },
      };
    }

    // Unreachable; defensive.
    return {
      kind: "escalate",
      originalSentence: sentence,
      reasonCode: "unsupported_claim_escalated",
      details: detailsWithSource,
    };
  }

  private async failClosed(
    ctx: SkillHookContext,
    result: SkillExecutionResult,
    jurisdiction: "SG" | "MY",
    clinicType: "medical" | "nonMedical",
  ): Promise<void> {
    const handoff = this.deps.renderHandoff({ jurisdiction, reasonCode: "governance_unavailable" });
    const originalText = result.response;

    const verdict: GovernanceVerdict = {
      action: "block",
      reasonCode: "governance_unavailable",
      jurisdiction,
      clinicType,
      sourceGuard: "claim_classifier",
      originalText,
      emittedText: handoff,
      auditLevel: "critical",
      decidedAt: this.deps.clock().toISOString(),
      conversationId: ctx.sessionId,
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.deps.verdictStore.save({ ...verdict, deploymentId: ctx.deploymentId } as any);
    } catch (err) {
      console.error("[claim-classifier] verdictStore.save threw on fail-closed", err);
    }
    try {
      await this.deps.handoffStore.save({
        reason: "compliance_concern",
        deploymentId: ctx.deploymentId,
        sessionId: ctx.sessionId,
        payload: { sourceGuard: "claim_classifier", reasonCode: "governance_unavailable" },
      });
    } catch (err) {
      console.error("[claim-classifier] handoffStore.save threw on fail-closed", err);
    }
    await this.deps.conversationStore.setConversationStatus(ctx.sessionId, "human_override");
    result.response = handoff;
  }

  private async applyEscalate(args: {
    ctx: SkillHookContext;
    result: SkillExecutionResult;
    actions: ReadonlyArray<SentenceAction>;
    jurisdiction: "SG" | "MY";
    clinicType: "medical" | "nonMedical";
    mode: "off" | "observe" | "enforce";
  }): Promise<void> {
    const { ctx, result, actions, jurisdiction, clinicType, mode } = args;
    let firstEscalateVerdictId: string | null = null;
    const decidedAt = this.deps.clock().toISOString();
    const handoff = this.deps.renderHandoff({
      jurisdiction,
      reasonCode: "unsupported_claim_escalated",
    });

    for (const a of actions) {
      if (a.kind !== "escalate") continue;
      const verdict: GovernanceVerdict = {
        action: mode === "observe" ? "allow" : "escalate",
        reasonCode: a.reasonCode,
        jurisdiction,
        clinicType,
        sourceGuard: "claim_classifier",
        originalText: a.originalSentence,
        emittedText: mode === "observe" ? a.originalSentence : handoff,
        auditLevel: mode === "observe" ? "warning" : "critical",
        decidedAt,
        conversationId: ctx.sessionId,
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const saved = (await this.deps.verdictStore.save({
          ...verdict,
          deploymentId: ctx.deploymentId,
          details: a.details,
        } as any)) as { id?: string };
        if (firstEscalateVerdictId === null && saved.id) firstEscalateVerdictId = saved.id;
      } catch (err) {
        console.error("[claim-classifier] verdictStore.save threw on escalate", err);
      }
    }

    if (mode === "observe") return;

    try {
      await this.deps.handoffStore.save({
        reason: "compliance_concern",
        deploymentId: ctx.deploymentId,
        sessionId: ctx.sessionId,
        payload: { sourceGuard: "claim_classifier", verdictId: firstEscalateVerdictId },
      });
    } catch (err) {
      console.error("[claim-classifier] handoffStore.save threw on escalate", err);
    }
    await this.deps.conversationStore.setConversationStatus(ctx.sessionId, "human_override");
    result.response = handoff;
  }

  private async applyRewrites(args: {
    ctx: SkillHookContext;
    result: SkillExecutionResult;
    actions: ReadonlyArray<SentenceAction>;
    jurisdiction: "SG" | "MY";
    clinicType: "medical" | "nonMedical";
    mode: "off" | "observe" | "enforce";
  }): Promise<void> {
    const { ctx, result, actions, jurisdiction, clinicType, mode } = args;
    const decidedAt = this.deps.clock().toISOString();

    for (const a of actions) {
      if (a.kind !== "rewrite") continue;
      const verdict: GovernanceVerdict = {
        action: mode === "observe" ? "allow" : "rewrite",
        reasonCode: a.reasonCode,
        jurisdiction,
        clinicType,
        sourceGuard: "claim_classifier",
        originalText: a.originalSentence,
        emittedText: a.replacement,
        auditLevel: mode === "observe" ? "warning" : "critical",
        decidedAt,
        conversationId: ctx.sessionId,
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.deps.verdictStore.save({
          ...verdict,
          deploymentId: ctx.deploymentId,
          details: a.details,
        } as any);
      } catch (err) {
        console.error("[claim-classifier] verdictStore.save threw on rewrite", err);
      }
    }

    if (mode === "observe") return;

    // Splice replacements into result.response in original-occurrence order.
    let response = result.response;
    for (const a of actions) {
      if (a.kind !== "rewrite") continue;
      response = response.replace(a.originalSentence, a.replacement);
    }
    result.response = response;
  }
}
```

The class uses `readonly name = "claim-classifier"` to satisfy the `SkillHook.name: string` requirement. `afterSkill` mutates `result.response` in place; there is no return value. `conversationId` on every verdict is sourced from `ctx.sessionId` (1:1 mapping in the current runtime).

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- claim-classifier
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass. If a test fails because of slight signature mismatches with 1b-1's actual `GovernanceConfigResolver` / `GovernancePostureCache` exports, align field names — type errors are the test signal.

- [ ] **Step 6: Update governance/classifier barrel**

Edit (or create) `packages/core/src/governance/classifier/index.ts`:

```ts
export * from "./anthropic-classifier.js";
export * from "./approved-compliance-claim-store/index.js";
export * from "./regulatory-sources/index.js";
export * from "./rewrite-templates/index.js";
export * from "./run-classifier.js";
export * from "./substantiation-cache.js";
export * from "./substantiation-resolver.js";
export * from "./prompt.js";
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/hooks/claim-classifier.ts packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts packages/core/src/governance/classifier/index.ts
git commit -m "feat(core): ClaimClassifierHook composing Layer 2 + Layer 3 + rewrite templates"
```

---

## Task 16: Bootstrap wiring — register `ClaimClassifierHook` + second posture cache

**Files:**
- Modify: `apps/api/src/bootstrap/skill-mode.ts`
- Modify: `apps/api/src/bootstrap/__tests__/skill-mode.test.ts` (or the closest existing test)

- [ ] **Step 1: Locate the existing 1b-1 wiring**

```bash
grep -n "DeterministicSafetyGateHook\|InMemoryGovernancePostureCache\|TracePersistenceHook" apps/api/src/bootstrap/skill-mode.ts
```

Note the construction site, the order of the hooks array, and how `GovernanceConfigResolver` is currently built.

- [ ] **Step 2: Write the failing wiring test**

In `apps/api/src/bootstrap/__tests__/skill-mode.test.ts` (or the harness file that asserts hook registration order), add:

```ts
import { describe, it, expect } from "vitest";

describe("skill-mode bootstrap — 1b-2 wiring", () => {
  it("registers ClaimClassifierHook between DeterministicSafetyGateHook and TracePersistenceHook", () => {
    // Use whatever harness already exposes the registered hooks. If the
    // bootstrap returns the hooks array, assert their constructor names in
    // order. Otherwise, instrument the bootstrap to capture them.
    const hooks = /* obtain hooks array from bootstrap */;
    const names = hooks.map((h) => (h as { name?: string }).name ?? h.constructor.name);
    const detIdx = names.indexOf("deterministic-safety-gate");
    const ccIdx = names.indexOf("claim-classifier");
    expect(detIdx).toBeGreaterThanOrEqual(0);
    expect(ccIdx).toBe(detIdx + 1);
    // TracePersistenceHook ordering: only assert if it is registered. On main it is
    // NOT in the hooks array; 1b-1 may or may not add it. The 1b-2 invariant is only
    // that ClaimClassifier runs immediately after DeterministicSafetyGate.
    const trIdx = names.indexOf("trace-persistence");
    if (trIdx >= 0) {
      expect(trIdx).toBeGreaterThan(ccIdx);
    }
  });

  it("constructs separate GovernancePostureCache instances for each hook", () => {
    // Inspect bootstrap construction; assert the cache injected into the
    // classifier hook is NOT the same instance as the one injected into
    // the deterministic gate hook.
  });

  it("injects the same GovernanceConfigResolver into both hooks", () => {
    // Asserts shared-resolver, separate-cache.
  });
});
```

If the bootstrap does not currently export its constructed hook list, add a minimal export (e.g., `export function buildHookChain(...): readonly SkillHook[]`) used by `SkillExecutorImpl` — mirror 1b-1's plan task that introduced (or relied on) the registration-array contract.

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/api test -- skill-mode
```

Expected: tests fail (no ClaimClassifierHook in the chain).

- [ ] **Step 4: Wire dependencies in `skill-mode.ts`**

Edit `apps/api/src/bootstrap/skill-mode.ts`. Adjacent to existing 1b-1 construction, add:

```ts
import { Anthropic } from "@anthropic-ai/sdk";
import {
  createAnthropicClaimClassifier,
  createSubstantiationResolver,
  createInMemoryLRU,
  loadRegulatoryPublicSources,
  loadRewriteTemplates,
} from "@switchboard/core";
import { createPrismaApprovedComplianceClaimStore } from "@switchboard/db";
import { ClaimClassifierHook } from "@switchboard/core/skill-runtime/hooks/claim-classifier.js";
import { InMemoryGovernancePostureCache } from "@switchboard/core";  // 1b-1's impl
import { renderHandoffTemplate } from "@switchboard/core";            // 1b-1's helper

// Reuse the existing process-level Anthropic client (the chat / agent-runtime
// adapters already construct one). If it lives elsewhere in apps/api, import
// or construct once here and share.
const anthropicClient = /* existing shared client */;

const approvedClaimStore = createPrismaApprovedComplianceClaimStore(prisma);
const substantiationCache = createInMemoryLRU();   // bounded 5000 entries
const substantiationResolver = createSubstantiationResolver({
  approvedClaimStore,
  regulatoryLoader: loadRegulatoryPublicSources,
  cache: substantiationCache,
  clock: () => new Date(),
});
const classifier = createAnthropicClaimClassifier(anthropicClient);

// Per-hook posture cache instances — distinct from the 1b-1 deterministic-gate cache.
const deterministicGatePostureCache = /* 1b-1's existing instance */;
const claimClassifierPostureCache = new InMemoryGovernancePostureCache();

const claimClassifierHook = new ClaimClassifierHook({
  governanceConfigResolver,     // shared with 1b-1
  postureCache: claimClassifierPostureCache,
  classifier,
  substantiationResolver,
  rewriteLoader: loadRewriteTemplates,
  verdictStore,                 // shared with 1b-1
  handoffStore,                 // shared
  conversationStore,            // shared
  splitSentences,               // from packages/core/src/governance/text/sentence-splitter
  clock: () => new Date(),
  renderHandoff: renderHandoffTemplate,
});

// Hook array — order matters.
const hooks = [
  deterministicSafetyGateHook,   // 1b-1
  claimClassifierHook,           // 1b-2 — NEW, runs after deterministic gate
  tracePersistenceHook,          // 1b-1 / earlier — runs last, sees post-classifier output
];
```

The exact identifier names in the file may differ (e.g., `deterministicSafetyHook`, `traceHook`). Match the existing names. The structural change is: add construction of `claimClassifierHook` + a second `InMemoryGovernancePostureCache` instance, and insert the hook between the existing deterministic and trace hooks.

- [ ] **Step 5: Add a hook-ordering regression test (if not already covered)**

If 1b-1 already verified the hook framework iterates in registration-array order at `packages/core/src/skill-runtime/types.ts` / `SkillExecutorImpl`, re-run the relevant test from this PR to confirm the new array is consumed correctly. If 1b-1 deferred this, this task does NOT defer further — add the assertion now. Typical shape:

```ts
import { SkillExecutorImpl } from "@switchboard/core";
// Build an executor with three identity-recording hooks in a specific order.
// Run a skill turn. Assert the order they fired in.
```

- [ ] **Step 6: Run all bootstrap + skill-runtime tests**

```bash
pnpm --filter @switchboard/api test -- skill-mode
pnpm --filter @switchboard/core test -- skill-runtime
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/api build
```

Expected: all pass. The 1b-1 deterministic-gate test suite remains green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts apps/api/src/bootstrap/__tests__/skill-mode.test.ts
git commit -m "feat(api): register ClaimClassifierHook + per-hook posture caches in skill-mode bootstrap"
```

---

## Task 17: Reference markdown sync + 1b-2 follow-up doc

**Files:**
- Modify: `skills/alex/references/regulatory/sg-rules.md`
- Modify: `skills/alex/references/regulatory/my-rules.md`
- Create: `docs/superpowers/specs/2026-05-11-alex-medspa-1b2-follow-ups.md`

The markdown is operator-facing prose, not parsed at runtime. The sync is informal.

- [ ] **Step 1: Append "Runtime claim classification" section to SG rules**

Append to `skills/alex/references/regulatory/sg-rules.md`:

```markdown
## Runtime claim classification (Phase 1b-2)

Every outbound model message that survives 1b-1's banned-phrase scanner is
sentence-classified by `ClaimClassifierHook` (Haiku 4.5 with prompt caching).
The classifier maps each sentence to one of:

`efficacy | safety-claim | superiority | urgency | testimonial | medical-advice | diagnosis | credentials | none`

Layer 3 substantiation tiers per claim type:

| Claim type | Required source | If missing |
|---|---|---|
| efficacy / safety-claim / superiority / urgency | `approved_compliance_claim` (operator-authored, named reviewer, <180d) | Rewrite to non-claim template |
| credentials | `regulatory_public_source` (curated SG: HSA / MOH / SMC entries) | Escalate |
| testimonial / medical-advice / diagnosis | none — never auto-answer | Escalate |
| safety-claim | also accepts `regulatory_public_source` | Rewrite if neither tier matches |
| none | n/a | Allow |

Source-of-truth (TS modules):
- Claim-type enum: `packages/schemas/src/claim-classifier.ts`
- Regulatory entries (SG): `packages/core/src/governance/classifier/regulatory-sources/sg.ts`
- Rewrite templates (SG): `packages/core/src/governance/classifier/rewrite-templates/sg.ts`
- Substantiation resolver: `packages/core/src/governance/classifier/substantiation-resolver.ts`
- Hook: `packages/core/src/skill-runtime/hooks/claim-classifier.ts`

This markdown is not parsed at runtime; it documents the runtime behavior for
operator and reviewer reference. Update both this file and the TS modules
together when authoring new rules.
```

- [ ] **Step 2: Append the parallel section to MY rules**

Append to `skills/alex/references/regulatory/my-rules.md` with MY-specific paths (`my.ts`) and authorities (MDA / KKM / MMC / MAB).

- [ ] **Step 3: Create 1b-2 follow-up doc**

Create `docs/superpowers/specs/2026-05-11-alex-medspa-1b2-follow-ups.md`:

```markdown
# Phase 1b-2 — Follow-ups

**Date:** 2026-05-11
**Owner:** TBD (assign at PR review)

## 1. `ApprovedComplianceClaim` seed authorship

The 1b-2 PR ships the store and substantiation resolver but no rows. Pilot
tenant needs an initial set of approved compliance claims for the top
efficacy / safety / superiority statements Alex is observed making during the
1b-2 observe-mode rollout.

- Target tenant: TBD
- Expected first 10 claims: TBD
- Reviewer name + role (stamped into `reviewedBy`): TBD
- Authoring path: `packages/db/prisma/seed-approved-compliance-claims.ts`
  or one-off admin script.

## 2. Phase 1b-2.5 regulatory-source expansion

The 1b-2 seed tables in `packages/core/src/governance/classifier/regulatory-sources/{sg,my}.ts`
are conservative floor coverage (≥3 per category per jurisdiction). A
regulatory consultant should expand to exhaustive coverage of:
- HSA / MDA approved devices (target: ≥20 each jurisdiction)
- Doctor credential paths (named entries for pilot-tenant doctors)
- ISO / GMP / public certifications used in marketing copy

## 3. Cache invalidation on `ApprovedComplianceClaim` upsert

1b-2 ships match-only LRU caching. New approved claims that supersede an
existing match would require invalidation. v1 workaround: process restart
or admin endpoint. Phase 3 should ship event-driven invalidation.

## 4. Confidence threshold tuning

The classifier returns `confidence` but 1b-2 does not gate on it. A future
tuning step could escalate (rather than rewrite) when `confidence < 0.5`.
Eval-harness data informs the threshold.

## 5. Per-claim-type mode override

The `governanceConfig.claimClassifier.mode` is flat in 1b-2. A future
ergonomic could allow per-claim-type promotion (e.g., enforce on urgency
while still observing on efficacy).

## 6. Cross-message service-context tracking

Service-scoped substantiation is deferred entirely in 1b-2 — `ApprovedComplianceClaim`
has no `serviceId` column. Re-introduce when a relational `Service` Prisma model
ships in 1a (or a future phase).

## 7. Persistent `GovernancePostureCache`

Per-process / per-instance cache works for the v1 pilot envelope. At scale,
either a Redis-backed cache or a separate "is governed?" flag column on
`AgentDeployment` becomes the right primitive. Same upgrade path 1b-1 noted.
```

- [ ] **Step 4: Commit**

```bash
git add skills/alex/references/regulatory/sg-rules.md skills/alex/references/regulatory/my-rules.md docs/superpowers/specs/2026-05-11-alex-medspa-1b2-follow-ups.md
git commit -m "docs(alex): 1b-2 reference markdown sync + follow-ups spec"
```

---

## Task 18: Eval harness `pnpm classifier-eval` + golden-set fixture

**Files:**
- Create: `packages/core/src/governance/classifier/eval/golden-set.ts`
- Create: `packages/core/src/governance/classifier/eval/run-eval.ts`
- Create: `packages/core/src/governance/classifier/eval/__tests__/golden-set.test.ts`
- Modify: `packages/core/package.json` — add `classifier-eval` script
- Modify: root `package.json` — add `classifier-eval` proxy script (optional)
- Create: `docs/classifier-eval.md` — short usage README

This task ships **the offline harness only**. It does NOT run in CI by default. Gated by `EVAL=1`.

- [ ] **Step 1: Author the golden set**

Create `packages/core/src/governance/classifier/eval/golden-set.ts`:

```ts
import type { ClaimType } from "@switchboard/schemas";

export interface GoldenSetEntry {
  sentence: string;
  jurisdiction: "SG" | "MY";
  expectedClaimType: ClaimType;
  notes: string;
}

// Conservative seed. ≥40 entries spanning all 9 claim types. Expand as observed
// classifier behavior diverges from expectation.
export const GOLDEN_SET: ReadonlyArray<GoldenSetEntry> = [
  // efficacy
  { sentence: "Most clients see visible slimming after one session.", jurisdiction: "SG", expectedClaimType: "efficacy", notes: "Implied outcome guarantee." },
  { sentence: "You'll see a glow within 48 hours.", jurisdiction: "SG", expectedClaimType: "efficacy", notes: "Outcome assertion." },
  { sentence: "Treatment delivers consistent skin tightening.", jurisdiction: "MY", expectedClaimType: "efficacy", notes: "Outcome assertion." },
  { sentence: "Patients report dramatic results after three sessions.", jurisdiction: "MY", expectedClaimType: "efficacy", notes: "Outcome via report shape." },
  { sentence: "This produces a more sculpted jawline.", jurisdiction: "SG", expectedClaimType: "efficacy", notes: "Outcome assertion." },

  // safety-claim
  { sentence: "The procedure is completely safe.", jurisdiction: "SG", expectedClaimType: "safety-claim", notes: "Absolute safety claim." },
  { sentence: "There are no side effects with our laser.", jurisdiction: "MY", expectedClaimType: "safety-claim", notes: "No-side-effects claim." },
  { sentence: "Downtime is minimal because we use a gentle setting.", jurisdiction: "SG", expectedClaimType: "safety-claim", notes: "Recovery assurance." },
  { sentence: "It's painless for everyone.", jurisdiction: "MY", expectedClaimType: "safety-claim", notes: "Universal-pain-free claim." },
  { sentence: "Suitable for all skin types.", jurisdiction: "SG", expectedClaimType: "safety-claim", notes: "Universal-suitability claim." },

  // superiority
  { sentence: "We're the leading aesthetic clinic in Singapore.", jurisdiction: "SG", expectedClaimType: "superiority", notes: "Comparative superlative." },
  { sentence: "Our doctors are the best in KL.", jurisdiction: "MY", expectedClaimType: "superiority", notes: "Best-of-class claim." },
  { sentence: "This device outperforms anything else on the market.", jurisdiction: "SG", expectedClaimType: "superiority", notes: "Comparative." },
  { sentence: "Nobody else can deliver these results.", jurisdiction: "MY", expectedClaimType: "superiority", notes: "Exclusivity claim." },
  { sentence: "Most advanced laser in the region.", jurisdiction: "SG", expectedClaimType: "superiority", notes: "Superlative." },

  // urgency
  { sentence: "Limited slots today — book now.", jurisdiction: "SG", expectedClaimType: "urgency", notes: "Time-pressure." },
  { sentence: "Offer expires tonight.", jurisdiction: "MY", expectedClaimType: "urgency", notes: "Deadline pressure." },
  { sentence: "Last chance to secure this rate.", jurisdiction: "SG", expectedClaimType: "urgency", notes: "Scarcity pressure." },

  // testimonial
  { sentence: "Many of our clients say it changed their life.", jurisdiction: "SG", expectedClaimType: "testimonial", notes: "Client-experience reference." },
  { sentence: "We've heard from patients that this is the best treatment they've tried.", jurisdiction: "MY", expectedClaimType: "testimonial", notes: "Patient-quote shape." },
  { sentence: "Every client we've treated has loved the outcome.", jurisdiction: "SG", expectedClaimType: "testimonial", notes: "Universal-positive-feedback shape." },

  // medical-advice
  { sentence: "You should start with three sessions, then taper to maintenance.", jurisdiction: "SG", expectedClaimType: "medical-advice", notes: "Treatment plan recommendation." },
  { sentence: "Apply hydrocortisone if the redness persists past 48 hours.", jurisdiction: "MY", expectedClaimType: "medical-advice", notes: "Treatment recommendation." },
  { sentence: "I'd suggest combining laser with PRP for your case.", jurisdiction: "SG", expectedClaimType: "medical-advice", notes: "Personal treatment plan." },

  // diagnosis
  { sentence: "What you're describing sounds like rosacea.", jurisdiction: "SG", expectedClaimType: "diagnosis", notes: "Condition identification." },
  { sentence: "That's likely melasma, given the pigmentation pattern.", jurisdiction: "MY", expectedClaimType: "diagnosis", notes: "Condition identification." },
  { sentence: "You probably have keratosis pilaris.", jurisdiction: "SG", expectedClaimType: "diagnosis", notes: "Condition identification." },

  // credentials
  { sentence: "Dr Jane Lim is SMC-registered with over 15 years' experience.", jurisdiction: "SG", expectedClaimType: "credentials", notes: "Named-doctor credential assertion." },
  { sentence: "Our device is HSA-approved for skin tightening.", jurisdiction: "SG", expectedClaimType: "credentials", notes: "Device-approval claim." },
  { sentence: "The clinic is licensed by KKM under Act 586.", jurisdiction: "MY", expectedClaimType: "credentials", notes: "Clinic-licence claim." },
  { sentence: "Dr Tan holds an APC and is MMC-registered.", jurisdiction: "MY", expectedClaimType: "credentials", notes: "Named-doctor credential." },

  // none — neutral facts and operational replies
  { sentence: "We open from 10am to 8pm, Monday to Saturday.", jurisdiction: "SG", expectedClaimType: "none", notes: "Hours of operation." },
  { sentence: "Our address is 123 Orchard Road, #05-12.", jurisdiction: "SG", expectedClaimType: "none", notes: "Address." },
  { sentence: "The consultation fee is SGD 80.", jurisdiction: "SG", expectedClaimType: "none", notes: "Price fact." },
  { sentence: "Would you prefer a morning or afternoon slot?", jurisdiction: "MY", expectedClaimType: "none", notes: "Booking question." },
  { sentence: "I can email you the consent form.", jurisdiction: "MY", expectedClaimType: "none", notes: "Operational." },
  { sentence: "Sure, I'll check with the team and get back to you.", jurisdiction: "SG", expectedClaimType: "none", notes: "Operational." },
  { sentence: "We have availability this Thursday at 3pm.", jurisdiction: "MY", expectedClaimType: "none", notes: "Availability fact." },
  { sentence: "Sessions typically take 45 minutes.", jurisdiction: "SG", expectedClaimType: "none", notes: "Duration fact." },
  { sentence: "You can find parking in the basement.", jurisdiction: "SG", expectedClaimType: "none", notes: "Operational." },
  { sentence: "I'll let the doctor know you have a question.", jurisdiction: "MY", expectedClaimType: "none", notes: "Operational." },
];
```

- [ ] **Step 2: Write a structural test (always-on)**

Create `packages/core/src/governance/classifier/eval/__tests__/golden-set.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GOLDEN_SET } from "../golden-set.js";

describe("golden set", () => {
  it("has ≥40 entries", () => {
    expect(GOLDEN_SET.length).toBeGreaterThanOrEqual(40);
  });

  it("covers all 9 claim types", () => {
    const seen = new Set(GOLDEN_SET.map((g) => g.expectedClaimType));
    for (const ct of [
      "efficacy",
      "safety-claim",
      "superiority",
      "urgency",
      "testimonial",
      "medical-advice",
      "diagnosis",
      "credentials",
      "none",
    ] as const) {
      expect(seen.has(ct), `golden set missing ${ct}`).toBe(true);
    }
  });

  it("has entries for both jurisdictions", () => {
    const jurisdictions = new Set(GOLDEN_SET.map((g) => g.jurisdiction));
    expect(jurisdictions.has("SG")).toBe(true);
    expect(jurisdictions.has("MY")).toBe(true);
  });
});
```

- [ ] **Step 3: Implement the eval runner (real Anthropic calls; EVAL-gated)**

Create `packages/core/src/governance/classifier/eval/run-eval.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { GOLDEN_SET } from "./golden-set.js";
import { createAnthropicClaimClassifier } from "../anthropic-classifier.js";
import type { ClaimType } from "@switchboard/schemas";

const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"] as const;

interface PerModelResult {
  model: string;
  total: number;
  correct: number;
  errors: number;
  accuracy: number;
  perType: Partial<Record<ClaimType, { total: number; correct: number }>>;
}

interface EvalReport {
  models: readonly PerModelResult[];
  disagreementCount: number;
  disagreementRate: number;
  generatedAt: string;
}

async function evalOne(client: Anthropic, model: string): Promise<PerModelResult> {
  const classifier = createAnthropicClaimClassifier(client);
  const perType: PerModelResult["perType"] = {};
  let correct = 0;
  let errors = 0;
  for (const entry of GOLDEN_SET) {
    try {
      const { result } = await classifier.classify({
        sentence: entry.sentence,
        model,
        signal: new AbortController().signal,
      });
      const t = perType[entry.expectedClaimType] ?? { total: 0, correct: 0 };
      t.total += 1;
      if (result.claimType === entry.expectedClaimType) {
        correct += 1;
        t.correct += 1;
      }
      perType[entry.expectedClaimType] = t;
    } catch (err) {
      console.error(`[eval] ${model} errored on: ${entry.sentence}`, err);
      errors += 1;
    }
  }
  return {
    model,
    total: GOLDEN_SET.length,
    correct,
    errors,
    accuracy: correct / GOLDEN_SET.length,
    perType,
  };
}

export async function runEval(): Promise<EvalReport> {
  if (process.env.EVAL !== "1") {
    throw new Error("Set EVAL=1 to run the classifier eval (consumes Anthropic tokens).");
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY required to run classifier eval.");
  }
  const client = new Anthropic({ apiKey });
  const results: PerModelResult[] = [];
  for (const model of MODELS) {
    results.push(await evalOne(client, model));
  }
  // Crude disagreement count: classify all sentences with both models, compare.
  let disagreement = 0;
  const classifier = createAnthropicClaimClassifier(client);
  for (const entry of GOLDEN_SET) {
    const [a, b] = await Promise.all(
      MODELS.map((m) =>
        classifier
          .classify({ sentence: entry.sentence, model: m, signal: new AbortController().signal })
          .then((r) => r.result.claimType)
          .catch(() => "none" as const),
      ),
    );
    if (a !== b) disagreement += 1;
  }
  return {
    models: results,
    disagreementCount: disagreement,
    disagreementRate: disagreement / GOLDEN_SET.length,
    generatedAt: new Date().toISOString(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEval()
    .then((report) => {
      console.warn(JSON.stringify(report, null, 2));
      for (const m of report.models) {
        const accuracyPct = (m.accuracy * 100).toFixed(1);
        const flag =
          m.accuracy >= 0.85 ? "green" : m.accuracy >= 0.70 ? "warn" : "red";
        console.warn(`${m.model}: accuracy=${accuracyPct}% [${flag}] errors=${m.errors}`);
      }
      const drPct = (report.disagreementRate * 100).toFixed(1);
      const drFlag = report.disagreementRate <= 0.25 ? "green" : "warn";
      console.warn(`inter-model disagreement: ${drPct}% [${drFlag}]`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Add the package script**

`tsx` is in the workspace root `devDependencies` and in `packages/db`. To keep `packages/core`'s script self-contained, add `tsx` to its devDependencies too:

```bash
pnpm --filter @switchboard/core add -D tsx@^4.7.0
```

Then edit `packages/core/package.json` — add to `"scripts"`:

```json
"classifier-eval": "tsx src/governance/classifier/eval/run-eval.ts"
```

Workspace hoisting MAY make tsx available without the explicit devDependency, but adding it locally keeps the script reliable across `node_modules` cleanups.

Optionally add a top-level proxy in the root `package.json`:

```json
"classifier-eval": "pnpm --filter @switchboard/core classifier-eval"
```

- [ ] **Step 5: Author the README**

Create `docs/classifier-eval.md`:

```markdown
# Classifier eval harness

Offline cross-model accuracy check for the Phase 1b-2 claim classifier prompt.

## Usage

```bash
EVAL=1 ANTHROPIC_API_KEY=sk-... pnpm classifier-eval
```

The script:
- Iterates `GOLDEN_SET` (`packages/core/src/governance/classifier/eval/golden-set.ts`).
- Runs each sentence through Haiku 4.5 and Sonnet 4.6.
- Reports per-model accuracy vs `expectedClaimType` and inter-model disagreement.

## When to run

- Before merging any change to:
  - `packages/core/src/governance/classifier/prompt.ts`
  - `packages/schemas/src/claim-classifier.ts` (claim-type enum)
  - `packages/core/src/governance/classifier/eval/golden-set.ts`
- Periodically (manually) to detect Anthropic model drift.

## Soft thresholds

| Signal | Green | Warn | Red |
|---|---|---|---|
| Per-model accuracy | ≥85% | 70–85% | <70% |
| Inter-model disagreement | ≤25% | >25% | n/a |

Not a CI gate. PRs that drop below thresholds should call out the drop in the
PR body.
```

- [ ] **Step 6: Run the structural test**

```bash
pnpm --filter @switchboard/core test -- golden-set
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core build
```

Expected: all pass.

- [ ] **Step 7: Manual smoke (optional, requires real API key)**

```bash
EVAL=1 ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY pnpm classifier-eval
```

Expected: per-model accuracy printed; ≥85% on Haiku 4.5 is the green bar. Capture the report in the PR description if the bar is hit.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/governance/classifier/eval/ packages/core/package.json package.json docs/classifier-eval.md
git commit -m "feat(core): classifier eval harness with cross-model golden-set check"
```

---

## Final verification

- [ ] **Step F1: Full test pass**

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: all green. If any test fails:
1. Check that the 1a/1b-1 dependency rebase / cherry-pick completed cleanly.
2. Run `pnpm reset` if schemas/db/core builds look stale.
3. Re-run the failing package's tests in isolation for clearer output.

- [ ] **Step F2: Verify branch state**

```bash
git log --oneline origin/main..HEAD
git status --short
```

Expected: one commit per task (19 task commits + the spec commit + the review-fix commit on top of any rebased 1a/1b-1 work). Working tree clean.

- [ ] **Step F3: Push and open PR**

```bash
git push -u origin docs/alex-medspa-1b2-spec
gh pr create --title "feat(alex): Phase 1b-2 claim classifier + substantiation tiers" --body "$(cat <<'EOF'
## Summary
- Layer 2 claim classifier (Haiku 4.5, prompt-cached, strict tool use, per-turn 800ms parallel dispatch)
- Layer 3 substantiation: approved_compliance_claim (operator-authored) + regulatory_public_source (curated TS)
- Deterministic per-(claimType, jurisdiction) rewrite templates
- New ClaimClassifierHook registered after DeterministicSafetyGateHook
- Per-hook GovernancePostureCache instances (separate fail-closed posture per hook)
- Versioned prompt artifact with SHA256 hash stamped into every verdict
- Offline `pnpm classifier-eval` harness (soft CI signal, EVAL-gated)

## Spec / Plan
- Spec: `docs/superpowers/specs/2026-05-11-alex-medspa-1b2-claim-classifier-design.md`
- Plan: `docs/superpowers/plans/2026-05-11-alex-medspa-1b2.md`

## Test plan
- [ ] `pnpm test` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] (Optional) `EVAL=1 pnpm classifier-eval` — Haiku 4.5 accuracy ≥85% on golden set
- [ ] Manual: enable governance config in observe mode on a pilot deployment, send a test message containing an unsubstantiated efficacy claim, verify verdict persisted with correct `details` stamps
- [ ] Manual: flip to enforce mode, repeat — verify rewrite is applied in place, output preserved otherwise

## Follow-ups
- See `docs/superpowers/specs/2026-05-11-alex-medspa-1b2-follow-ups.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

---

## Spec coverage map

| Spec section | Plan task |
|---|---|
| §1.1 Extend `GovernanceVerdictReasonSchema` | Task 1 |
| §1.2 `ClaimClassifierConfigSchema` + `resolveClaimClassifierConfig` | Task 4 |
| §1.3 `ApprovedComplianceClaim` Prisma model (no `serviceId`) | Task 5 |
| §1.4 `ClaimTypeSchema`, `ClassifierSentenceResultSchema`, `CLASSIFIER_SCHEMA_VERSION` | Task 2 |
| §1.5 `SubstantiationSourceTypeSchema`, `SubstantiationResolutionSchema` | Task 3 |
| §2.1 Tier 1 `operator_business_fact` (typed, not consumed in 1b-2) | Task 3 (enum) |
| §2.2 Tier 2 `approved_compliance_claim` (deployment-global) | Tasks 5, 6, 14 |
| §2.3 Tier 3 `regulatory_public_source` | Task 8 |
| §2.4 Enforcement matrix | Task 14 (dispatch table) + Task 15 (hook action selection) |
| §3.1 Classifier prompt artifact | Task 10 |
| §3.2 Structured-output Anthropic call + prompt caching + strict tool | Task 11 |
| §3.3 Sentence splitter (extracted shared util) | Task 7 |
| §3.4 Per-turn budget + parallel calls | Task 12 |
| §3.5 Classifier-error vs classifier-timeout vs none | Tasks 12, 15 |
| §4 Substantiation resolver | Task 14 |
| §4.5 LRU cache | Task 13 |
| §5 Rewrite templates | Task 9 |
| §6 `ClaimClassifierHook` (real signature: `afterSkill(ctx, result): Promise<void>`, mutates `result.response`) | Task 15 |
| §6.2 Service-scoping deferred (no `serviceContext` in 1b-2) | n/a — out of scope |
| §6.5 Verdict-detail stamping (incl. timeout/error details with originalSentence, errorKind, latencyBudgetMs) | Task 15 |
| §6.6 Whole-response vs sentence-level effects (single-string mutation) | Task 15 (applyEscalate, applyRewrites) |
| §6.7 Per-hook posture cache | Task 16 (bootstrap construction) + Task 15 (consumer) |
| §7 Hook registration | Task 16 |
| §8 Eval harness | Task 18 |
| §9 Test fixture coverage | Tests in each implementation task |
| §10 Operability (markdown sync, reference docs) | Task 17 |
| Open Question 1 (`Service`-scoped substantiation deferred) | n/a — captured in Task 17 follow-ups |
| Open Question 2 (`ApprovedComplianceClaim` seed authorship) | Task 17 follow-up doc |
| Open Question 3 (eval cost discipline EVAL=1) | Task 18 |
