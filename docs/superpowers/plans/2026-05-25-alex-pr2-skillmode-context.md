# Alex PR-2: SkillMode context resolution (Critical 1) + coupled fold-ins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Alex's seeded medspa skill pack actually reach the live prompt by wiring context resolution into `SkillMode` (the live execution mode) as a minimal, fail-open mirror of the batch handler — and fold in the three coupled fixes the keystone unblocks (A0 model pin, stub-aware preflight, provision happy-path test).

**Architecture:** `SkillMode` resolves the skill's _knowledge-entry_ context (excluding `business-facts`, which the builder owns) once per inbound message and merges it into the executor's parameters — exactly what `batch-skill-handler.ts:71-85` already does. Resolution is **fail-open** (a miss/error degrades to today's empty-context behavior, never a 500); the advisory knowledge requirements become `required:false`; presence is enforced loudly at provisioning/eval-preflight instead. A `ContextResolverImpl` backed by `PrismaKnowledgeEntryStore` is constructed in the API bootstrap (the first live resolver instance).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, Prisma, `@switchboard/core` + `@switchboard/db`. Spec: `docs/superpowers/specs/2026-05-25-alex-live-integration-fixes-design.md` §2 + §4.

**Branch/base:** create from an up-to-date `origin/main` (`git fetch origin main && git switch -c feat/alex-skillmode-context origin/main`). This is **required** — the A0 fold-ins (Tasks 5-6) touch `evals/alex-conversation/`, which exists only on `origin/main` (A0 #674), not on the diverged local `main`. Independent of PR-1 (disjoint files).

---

## File Structure

- Modify: `skills/alex/SKILL.md` — `required: false` on PLAYBOOK_CONTEXT / POLICY_CONTEXT / QUALIFICATION_CONTEXT + a posture comment.
- Modify: `packages/core/src/platform/modes/skill-mode.ts` — optional `contextResolver` on `SkillModeConfig`; `resolveContextVariables` (knowledge-only, fail-open); merge into executor parameters.
- Modify: `packages/core/src/platform/__tests__/skill-mode.test.ts` — Critical-1 tests (headline merge + business-facts excluded + fail-open).
- Create: `packages/core/src/skill-runtime/__tests__/alex-context-injection-e2e.test.ts` — real resolver + stub store → interpolated prompt contains resolved content.
- Modify: `packages/core/src/skill-runtime/__tests__/alex-skill-loads.test.ts` — assert the `required:false` flags (read the file first; match its existing loader import/helpers).
- Modify: `apps/api/src/bootstrap/skill-mode.ts` — construct `PrismaKnowledgeEntryStore` + `ContextResolverImpl`, pass to `SkillMode`, extend the startup gate-deps assertion.
- Modify: `evals/alex-conversation/run-eval.ts` — split the dual `HAIKU` constant (Alex→Sonnet-4.6, classifier→Haiku); call the new preflight.
- Modify: `evals/alex-conversation/stub-context-store.ts` — `export` `SKILL_PACK_SCOPES`.
- Modify: `evals/alex-conversation/eval-preflight.ts` — `assertSkillPackContentPresent`.
- Create: `evals/alex-conversation/__tests__/eval-preflight.test.ts` — preflight pass/fail.
- Modify: `apps/api/src/__tests__/api-organizations.test.ts` — assert the skill-pack seed ran on the provisioning happy path.

**Task order matters:** Task 1 (SKILL.md `required:false`) and Task 2 (SkillMode fail-open) must land before/with Task 3 (bootstrap wiring) so the newly-wired resolver cannot throw on an unseeded required scope. Tasks 5-7 are independent.

---

## Task 1: Mark advisory knowledge requirements `required:false` in SKILL.md

**Files:**

- Modify: `skills/alex/SKILL.md` (frontmatter `context:` list, lines 54-71)
- Test: `packages/core/src/skill-runtime/__tests__/alex-skill-loads.test.ts` (extend)

The loader defaults `required` to `true` (`packages/schemas/src/knowledge.ts:48`, `skill-loader.ts:49`). Today three of Alex's requirements have no explicit flag and so are `required:true`. Since several scopes are unseeded for most orgs, a `required:true` requirement throwing would (once SkillMode resolves context in Task 2) break a live conversation. These four slots are advisory steering; the claim classifier is the runtime hard gate; presence is enforced at provisioning/preflight.

- [ ] **Step 1: Edit `skills/alex/SKILL.md`**

In the `context:` block (lines 54-71), add `required: false` to the three entries lacking it, and a comment. Result:

```yaml
context:
  # Advisory at runtime: required:false so a missing scope degrades to empty
  # (fail-open) rather than 500-ing a live conversation. The claim classifier is
  # the runtime hard gate; presence is enforced by provisioning + the A0 eval
  # preflight, NOT by failing live traffic. Do not flip these back to required.
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
    required: false
  - kind: policy
    scope: messaging-rules
    inject_as: POLICY_CONTEXT
    required: false
  - kind: business-facts
    scope: operator-approved
    inject_as: BUSINESS_FACTS
    required: true
  - kind: playbook
    scope: qualification-framework
    inject_as: QUALIFICATION_CONTEXT
    required: false
  - kind: policy
    scope: claim-boundaries
    inject_as: CLAIM_BOUNDARIES
    required: false
```

(`business-facts` stays `required:true` — it is builder-owned and filtered out of SkillMode's resolve call regardless. `claim-boundaries` was already `required:false`.)

- [ ] **Step 2: Write the assertion test**

Read `packages/core/src/skill-runtime/__tests__/alex-skill-loads.test.ts` first and match its loader import (the bootstrap imports `loadSkill` from `@switchboard/core/skill-runtime`; the test likely imports from `../skill-loader.js`). Add:

```ts
it("marks advisory knowledge slots required:false (runtime fail-open; provisioning enforces presence)", () => {
  // `skill` = the loaded Alex skill from the existing test setup; adapt the variable name.
  const req = (injectAs: string) => skill.context.find((c) => c.injectAs === injectAs);
  expect(req("PLAYBOOK_CONTEXT")?.required).toBe(false);
  expect(req("POLICY_CONTEXT")?.required).toBe(false);
  expect(req("QUALIFICATION_CONTEXT")?.required).toBe(false);
  expect(req("CLAIM_BOUNDARIES")?.required).toBe(false);
  expect(req("BUSINESS_FACTS")?.required).toBe(true);
});
```

- [ ] **Step 3: Run it — verify it passes**

Run: `pnpm --filter @switchboard/core test alex-skill-loads`
Expected: PASS (the `required:false` flags are read from the edited SKILL.md).

- [ ] **Step 4: Commit**

```bash
git add skills/alex/SKILL.md packages/core/src/skill-runtime/__tests__/alex-skill-loads.test.ts
git commit -m "feat(alex): advisory knowledge context required:false (live fail-open posture)"
```

---

## Task 2: SkillMode resolves + merges knowledge context (fail-open)

**Files:**

- Modify: `packages/core/src/platform/modes/skill-mode.ts`
- Test: `packages/core/src/platform/__tests__/skill-mode.test.ts`

Mirror `batch-skill-handler.ts:71-85`, adapted to SkillMode's division of labor: resolve only `kind !== "business-facts"` (the builder owns `BUSINESS_FACTS`), merge context-wins, and fail open.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/platform/__tests__/skill-mode.test.ts` (the file already defines `makeSkill`, `makeWorkUnit`, `MockExecutor`, `defaultConstraints`, `defaultContext`). Add the schema type import at the top:

```ts
import type { ContextRequirement } from "@switchboard/schemas";
```

Then a new describe block:

```ts
describe("SkillMode context resolution (Critical 1)", () => {
  let executor: MockExecutor;
  beforeEach(() => {
    executor = new MockExecutor();
  });

  const alexLikeContext: ContextRequirement[] = [
    {
      kind: "playbook",
      scope: "objection-handling",
      injectAs: "PLAYBOOK_CONTEXT",
      required: false,
    },
    {
      kind: "business-facts",
      scope: "operator-approved",
      injectAs: "BUSINESS_FACTS",
      required: true,
    },
  ];

  it("merges resolved knowledge context into executor params and excludes business-facts", async () => {
    const contextResolver = {
      resolve: vi.fn().mockResolvedValue({
        variables: { PLAYBOOK_CONTEXT: "OBJECTION PLAYBOOK" },
        metadata: [],
      }),
    };
    const skill = makeSkill({ context: alexLikeContext });
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({ executor, skillsBySlug, contextResolver });

    await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(executor.lastParams?.parameters).toMatchObject({
      PLAYBOOK_CONTEXT: "OBJECTION PLAYBOOK",
    });
    // business-facts requirement filtered OUT of the resolve call (builder owns it)
    expect(contextResolver.resolve).toHaveBeenCalledWith("org-1", [
      {
        kind: "playbook",
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: false,
      },
    ]);
  });

  it("fails open when context resolution throws (no 500, empty context)", async () => {
    const contextResolver = {
      resolve: vi.fn().mockRejectedValue(new Error("knowledge store down")),
    };
    const skill = makeSkill({ context: alexLikeContext });
    const skillsBySlug = new Map<string, SkillDefinition>([[skill.slug, skill]]);
    const mode = new SkillMode({ executor, skillsBySlug, contextResolver });

    const result = await mode.execute(makeWorkUnit(), defaultConstraints, defaultContext);

    expect(result.outcome).toBe("completed"); // did NOT 500
    expect(executor.lastParams?.parameters.PLAYBOOK_CONTEXT).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them — verify they fail**

Run: `pnpm --filter @switchboard/core test skill-mode`
Expected: FAIL — `SkillModeConfig` has no `contextResolver` (type error) and/or resolved vars don't reach `executor.lastParams.parameters`.

- [ ] **Step 3: Implement in `skill-mode.ts`**

Add the import (top of file):

```ts
import type { ContextResolverImpl } from "../../skill-runtime/context-resolver.js";
```

Add the optional field to `SkillModeConfig`:

```ts
export interface SkillModeConfig {
  executor: SkillExecutor;
  skillsBySlug: Map<string, SkillDefinition>;
  builderRegistry?: BuilderRegistry;
  stores?: SkillStores;
  /**
   * Optional curated-knowledge resolver. When present, SkillMode resolves the
   * skill's knowledge-entry context (NOT business-facts — the builder owns
   * BUSINESS_FACTS) and merges it into the executor parameters, mirroring
   * BatchSkillHandler. Omitted in tests / non-resolving deployments → no-op.
   */
  contextResolver?: { resolve: ContextResolverImpl["resolve"] };
}
```

In `execute`, after the `resolveParameters` call, resolve + merge and pass the merged params to the executor:

```ts
const { parameters, injectedPatternIds } = await this.resolveParameters(workUnit, skill);
const contextVariables = await this.resolveContextVariables(workUnit.organizationId, skill);
const mergedParameters = { ...parameters, ...contextVariables };

const result = await this.config.executor.execute({
  skill,
  parameters: mergedParameters,
  messages,
  deploymentId: workUnit.deployment?.deploymentId ?? workUnit.organizationId,
  orgId: workUnit.organizationId,
  trustScore: workUnit.deployment?.trustScore ?? 0,
  trustLevel: constraints.trustLevel,
  sessionId: workUnit.traceId ?? workUnit.id,
});
```

Add the private method (next to `resolveParameters`):

```ts
private async resolveContextVariables(
  orgId: string,
  skill: SkillDefinition,
): Promise<Record<string, string>> {
  if (!this.config.contextResolver) return {}; // no resolver wired → unchanged behavior
  // The builder owns BUSINESS_FACTS; never resolve it here (avoids double-source
  // and the required-business-facts throw). LOAD-BEARING — do not remove the filter.
  const knowledgeReqs = skill.context.filter((r) => r.kind !== "business-facts");
  if (knowledgeReqs.length === 0) return {};
  try {
    const { variables } = await this.config.contextResolver.resolve(orgId, knowledgeReqs);
    return variables;
  } catch (err) {
    // FAIL-OPEN: a live conversation must never 500 on a context-resolution miss.
    // Presence is enforced loudly at provisioning / A0 preflight, not here.
    console.warn(
      `[SkillMode] context resolution failed for ${skill.slug}/${orgId} (continuing with empty context): ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm --filter @switchboard/core test skill-mode`
Expected: PASS — both new tests pass AND every pre-existing SkillMode test (which passes no `contextResolver`) stays green (the no-op path leaves `parameters` exactly as the builder produced).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS.

```bash
git add packages/core/src/platform/modes/skill-mode.ts packages/core/src/platform/__tests__/skill-mode.test.ts
git commit -m "feat(core): SkillMode resolves+merges knowledge context (fail-open, knowledge-only)"
```

---

## Task 3: Wire the resolver into the API bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts`

This is the first live `ContextResolverImpl` construction. Backed by `PrismaKnowledgeEntryStore.findActive` (`packages/db/src/stores/prisma-knowledge-entry-store.ts:29`), which structurally satisfies the resolver's store interface. NO `BusinessFactsStore` is passed.

- [ ] **Step 1: Add the imports**

In the `await import("@switchboard/core/skill-runtime")` destructure (lines ~60-85), add `ContextResolverImpl`. In the `await import("@switchboard/db")` destructure (lines ~89-101), add `PrismaKnowledgeEntryStore`.

- [ ] **Step 2: Construct the store + resolver**

After the other store constructions (near `businessFactsStore`, ~line 121):

```ts
// Live curated-knowledge resolver for SkillMode. Knowledge-entry only — the
// alexBuilder owns BUSINESS_FACTS, so NO BusinessFactsStore is passed here.
const knowledgeEntryStore = new PrismaKnowledgeEntryStore(prismaClient);
const contextResolver = new ContextResolverImpl(knowledgeEntryStore);
```

- [ ] **Step 3: Pass it into SkillMode**

In the `new SkillMode({ ... })` config (lines ~556-591), add the field:

```ts
modeRegistry.register(
  new SkillMode({
    executor: skillExecutor,
    skillsBySlug,
    builderRegistry,
    contextResolver,
    stores: {
      // ... unchanged ...
    },
  }),
);
```

- [ ] **Step 4: Extend the startup gate-deps assertion**

In the `missingGateDeps` block (lines ~596-616), add (so a wiring/package-boundary mistake fails fast at boot rather than silently degrading every conversation to empty context):

```ts
if (!contextResolver) missingGateDeps.push("contextResolver");
```

- [ ] **Step 5: Typecheck + run the bootstrap smoke**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS.
Run: `pnpm --filter @switchboard/api test`
Expected: PASS (the bootstrap-smoke test constructs SkillMode; a recursive npm-warn line may appear but is not a failure).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts
git commit -m "feat(api): construct ContextResolverImpl and wire into SkillMode"
```

---

## Task 4: End-to-end interpolation test (real resolver → populated prompt)

**Files:**

- Create: `packages/core/src/skill-runtime/__tests__/alex-context-injection-e2e.test.ts`

Proves the live path renders resolved content into a slot (the inverse of the existing `alex-claim-boundaries-slot.test.ts`, which characterized the empty case). Uses the real `ContextResolverImpl` + a stub knowledge store + the real Alex `skill.context`.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ContextResolverImpl } from "../context-resolver.js";
import { interpolate } from "../template-engine.js";
import { loadSkill } from "../skill-loader.js"; // confirm export (bootstrap imports loadSkill from the barrel)
import type { KnowledgeKind } from "@switchboard/schemas";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../../skills");

describe("Alex live context injection (end-to-end interpolation)", () => {
  it("renders resolved objection-handling content into the slot (not an empty placeholder)", async () => {
    const skill = loadSkill("alex", SKILLS_DIR);

    // Stub store: one active row for objection-handling, nothing else.
    const store = {
      findActive: async (_orgId: string, filters: Array<{ kind: KnowledgeKind; scope: string }>) =>
        filters
          .filter((f) => f.scope === "objection-handling")
          .map((f) => ({
            kind: f.kind,
            scope: f.scope,
            content: "MEDSPA-OBJECTION-PLAYBOOK-MARKER",
            priority: 0,
            updatedAt: new Date(),
          })),
    };
    const resolver = new ContextResolverImpl(store);

    // Mirror SkillMode: resolve knowledge-entry context only (exclude business-facts).
    const knowledgeReqs = skill.context.filter((r) => r.kind !== "business-facts");
    const { variables } = await resolver.resolve("org_demo", knowledgeReqs);

    // Interpolate a minimal slot template (mirrors alex-claim-boundaries-slot.test.ts).
    const rendered = interpolate(
      "Objections:\n{{PLAYBOOK_CONTEXT}}\n--end--",
      { ...variables },
      [],
    );

    expect(rendered).toContain("MEDSPA-OBJECTION-PLAYBOOK-MARKER");
    expect(rendered).not.toContain("{{PLAYBOOK_CONTEXT}}");
  });
});
```

- [ ] **Step 2: Run it — verify it passes**

Run: `pnpm --filter @switchboard/core test alex-context-injection-e2e`
Expected: PASS. (The other `required:false` reqs return no rows → unset vars → no throw, since none are required after Task 1.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skill-runtime/__tests__/alex-context-injection-e2e.test.ts
git commit -m "test(core): e2e — resolved knowledge content renders into Alex prompt"
```

---

## Task 5: A0 eval — pin Alex to its live model (split the dual constant)

**Files:**

- Modify: `evals/alex-conversation/run-eval.ts`

Live Alex runs on Sonnet-4.6 (no router → adapter default). The eval aliases one `HAIKU` constant for both the Alex run (wrong) and the classifier checker (correct). Split them so fixing one cannot silently change the other.

- [ ] **Step 1: Replace the model-pin constants**

In `run-eval.ts`, replace lines 22-23:

```ts
/** Alex production model (temp-0 adapter pins temperature to 0). */
const HAIKU = "claude-haiku-4-5-20251001";
```

with:

```ts
/** Alex's live model — production wires no router, so the adapter default applies. */
const ALEX_MODEL = "claude-sonnet-4-6";

/** Claim-classifier checker model — matches the production classifier (Haiku). */
const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";
```

(Leave `const SONNET = "claude-sonnet-4-6"` at line 26 — that is the judge model.)

- [ ] **Step 2: Update the two usages**

At the Alex run (line ~205): `model: HAIKU,` → `model: ALEX_MODEL,`.
At the classifier checker (line ~243): `classifierModel: HAIKU,` → `classifierModel: CLASSIFIER_MODEL,`.

- [ ] **Step 3: Typecheck + verify the split**

Run: `pnpm typecheck`
Expected: PASS (no lingering `HAIKU` reference).
Run: `grep -n "ALEX_MODEL\|CLASSIFIER_MODEL\|HAIKU" evals/alex-conversation/run-eval.ts`
Expected: `ALEX_MODEL` used once at the Alex run; `CLASSIFIER_MODEL` used once at the classifier; no bare `HAIKU` remains.

- [ ] **Step 4: Commit**

```bash
git add evals/alex-conversation/run-eval.ts
git commit -m "fix(eval): run Alex on its live model (Sonnet-4.6); keep classifier on Haiku"
```

(No `baseline.json` exists yet, so this invalidates nothing; the eventual live baseline — #672 — must be locked on Sonnet.)

---

## Task 6: A0 eval — stub-aware skill-pack preflight

**Files:**

- Modify: `evals/alex-conversation/stub-context-store.ts` (export `SKILL_PACK_SCOPES`)
- Modify: `evals/alex-conversation/eval-preflight.ts` (`assertSkillPackContentPresent`)
- Modify: `evals/alex-conversation/run-eval.ts` (call it)
- Test: `evals/alex-conversation/__tests__/eval-preflight.test.ts`

The eval is DB-free (context comes from `createStubContextStore`), so the prisma `assertAlexSkillPackSeeded` cannot be used. Implement its intent with a stub-aware non-empty check, reusing the eval's own `SKILL_PACK_SCOPES` (keeps the eval free of a Prisma-heavy `@switchboard/db` dependency; the cross-package scope-list drift is already partly guarded by the eval's `skillContentHash`).

- [ ] **Step 1: Export the scope list**

In `stub-context-store.ts`, change the private `const SKILL_PACK_SCOPES` (line ~55) to `export const SKILL_PACK_SCOPES`.

- [ ] **Step 2: Write the failing test**

Create `evals/alex-conversation/__tests__/eval-preflight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSkillPackContentPresent } from "../eval-preflight.js";

describe("assertSkillPackContentPresent", () => {
  it("resolves when every skill-pack scope has content (real markdown)", async () => {
    await expect(assertSkillPackContentPresent()).resolves.toBeUndefined();
  });

  it("throws a loud, specific error when a skill-pack file is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alex-pack-"));
    writeFileSync(join(dir, "objection-handling.md"), ""); // emptied
    writeFileSync(join(dir, "qualification-framework.md"), "# Qualification\n\nstub");
    writeFileSync(join(dir, "claim-boundaries.md"), "# Claims\n\nstub");
    await expect(assertSkillPackContentPresent(dir)).rejects.toThrow(
      /objection-handling[\s\S]*WITHOUT the medspa playbook/,
    );
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm exec vitest run --config evals/vitest.config.ts evals/alex-conversation/__tests__/eval-preflight.test.ts`
Expected: FAIL (`assertSkillPackContentPresent` not exported).

- [ ] **Step 4: Implement `assertSkillPackContentPresent` in `eval-preflight.ts`**

Append to `eval-preflight.ts`:

```ts
import { createStubContextStore, SKILL_PACK_SCOPES } from "./stub-context-store.js";

/**
 * Loud preflight: refuse to grade Alex unless the medspa skill pack actually has
 * content for every skill-pack scope. Mirrors the INTENT of the prisma
 * assertAlexSkillPackSeeded, but stub-aware (the eval is DB-free). The live
 * SkillMode path fails open + quiet on a context miss (§2.5), so this is where a
 * provisioning/content regression must be impossible to miss.
 *
 * @param refsDir Override the medspa references dir (tests pass a fixture dir).
 */
export async function assertSkillPackContentPresent(refsDir?: string): Promise<void> {
  let store;
  try {
    store = createStubContextStore(refsDir);
  } catch (err) {
    throw new Error(
      `alex-conversation eval preflight: failed to load the medspa skill pack ` +
        `(skills/alex/references/medspa/*.md). Alex would run WITHOUT the medspa playbook. ` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const filters = SKILL_PACK_SCOPES.map((s) => ({ kind: s.kind, scope: s.scope }));
  const rows = await store.findActive("eval-org", filters);
  const byKey = new Map(rows.map((r) => [`${r.kind}::${r.scope}`, r]));
  for (const s of SKILL_PACK_SCOPES) {
    const row = byKey.get(`${s.kind}::${s.scope}`);
    if (!row || row.content.trim().length === 0) {
      throw new Error(
        `alex-conversation eval preflight: skill-pack content missing/empty for ` +
          `${s.kind}/${s.scope} (expected skills/alex/references/medspa/${s.file}). ` +
          `Alex would run WITHOUT the medspa playbook — refusing to grade.`,
      );
    }
  }
}
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `pnpm exec vitest run --config evals/vitest.config.ts evals/alex-conversation/__tests__/eval-preflight.test.ts`
Expected: PASS.

- [ ] **Step 6: Call the preflight in `run-eval.ts`**

Extend the import (line 16) to include `assertSkillPackContentPresent`, then call it in `main()` immediately after the API-key preflight block (after line ~179, before `loadConversationFixtures`):

```ts
// Skill-pack content preflight (offline): refuse to grade Alex with an empty pack.
await assertSkillPackContentPresent();
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add evals/alex-conversation/stub-context-store.ts evals/alex-conversation/eval-preflight.ts evals/alex-conversation/run-eval.ts evals/alex-conversation/__tests__/eval-preflight.test.ts
git commit -m "feat(eval): stub-aware skill-pack content preflight for alex-conversation"
```

---

## Task 7: Provision happy-path test (assert the seed actually ran)

**Files:**

- Modify: `apps/api/src/__tests__/api-organizations.test.ts`

`organizations.ts:89-93` seeds the skill pack in a best-effort try/catch; no test asserts it ran on the happy path (the `knowledgeEntry.upsert` mock at lines 38-40 exists only to prevent a throw). `seedAlexSkillPack` upserts one row per `ALEX_SKILL_PACK_SCOPES` entry (3).

- [ ] **Step 1: Add the assertion**

In the Decision-10 test (`it("seeds the Alex listing+deployment on first config access (Decision 10)", ...)`, line ~135), after the existing `agentDeployment.upsert` assertions (~line 156), add:

```ts
// Skill-pack fold-in: the seed must actually run on the happy path (the route's
// best-effort try/catch would otherwise hide a silent failure). 3 = ALEX_SKILL_PACK_SCOPES.
expect(mockPrisma.knowledgeEntry.upsert).toHaveBeenCalledTimes(3);
```

- [ ] **Step 2: Run it — verify it passes**

Run: `pnpm --filter @switchboard/api test api-organizations`
Expected: PASS (the real medspa markdown exists on disk, so `seedAlexSkillPack` reads it and upserts 3 scopes). If it reports 0 calls, the seed silently failed — which is exactly the regression this test now catches.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/api-organizations.test.ts
git commit -m "test(api): assert Alex skill pack is seeded on provisioning happy path"
```

---

## Self-review checklist (run before handoff)

- Spec coverage: §2.3a SkillMode resolve+merge+fail-open (Task 2) ✓; §2.3b SKILL.md required:false + posture comment (Task 1) ✓; §2.3c bootstrap resolver construction + startup assertion (Task 3) ✓; §2.6 tests — headline/fail-open/business-facts-excluded (Task 2), backward-compat (existing tests, Task 2 Step 4), e2e interpolation (Task 4) ✓; §4.1 A0 model split (Task 5) ✓; §4.2 stub-aware preflight (Task 6) ✓; §4.3 provision happy-path (Task 7) ✓.
- Scope fence: no new tools/ingress/routing; `business-facts` filter is present + tested; no prod-provisioning assertion (deferred); no A0 drift gate (deferred). Does NOT touch the adapter (PR-1).
- Type consistency: `contextResolver?: { resolve: ContextResolverImpl["resolve"] }` matches the batch handler's typing; `resolveContextVariables` returns `Record<string,string>`; `ALEX_MODEL`/`CLASSIFIER_MODEL` replace every `HAIKU` use; `SKILL_PACK_SCOPES` entries expose `{ kind, scope, file }` (used by the preflight).
- No placeholders; every code step has exact code, command, expected output. (Task 1 Step 2 and Task 4 Step 1 note "confirm the loader import/var name against the existing file" — read, don't invent.)
- `.js` import extensions on relative imports; Prettier (double quotes, semis, 100 width); CI has no Postgres (api/core tests use mocked Prisma / stub stores — no live DB).
