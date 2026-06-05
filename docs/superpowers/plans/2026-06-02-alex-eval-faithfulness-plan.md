# Alex Eval Faithfulness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Alex-conversation eval assemble Alex's turn through the real `PrismaBusinessFactsStore` + `alexBuilder` + `resolvePersona` (production's builder-owned facts seam), and add a deterministic gate that goes red if operator BusinessFacts are wired out (absent facts ⇒ empty `BUSINESS_FACTS`).

**Architecture:** The eval's `resolveParameters` swaps the always-non-null stub facts store for the **real** `PrismaBusinessFactsStore` over a hand-built mock Prisma (no DB), mirrors production by giving the resolver **no** facts store and filtering `business-facts` out of its requirements, and routes the persona through the production `resolvePersona`. A new co-located vitest test drives that assembly with operator / absent / malformed facts and asserts the prompt's `BUSINESS_FACTS` — the regression guard runs in the eval's blocking, key-free vitest step.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), vitest, `@switchboard/db` (`PrismaBusinessFactsStore`, `classifyBusinessFacts`), `@switchboard/core/skill-runtime` (`alexBuilder`, `ContextResolverImpl`, `loadSkill`), `@switchboard/schemas` (`resolvePersona`).

**Reference:** spec at `docs/superpowers/specs/2026-06-02-alex-eval-faithfulness-design.md`. Live-path precedents: `apps/api/src/__tests__/alex-business-facts-live-path.test.ts`, `packages/core/src/skill-runtime/__tests__/alex-persona-live-path.test.ts`. Production seam: `apps/api/src/bootstrap/skill-mode.ts:129-137,577-596`; the LOAD-BEARING filter: `packages/core/src/platform/modes/skill-mode.ts:150-153`.

**Execution grouping (commit boundaries — every committed state must compile + pass the eval vitest):**
Tasks 1, 3, 4 are **coupled** — removing the stub store (T1) breaks `run-conversation.ts`'s import until `resolveParameters` is rewritten (T4) and the persona swap (T3) lands. Execute and commit them as **one unit** (one green commit). So the real commit sequence is:

- **Commit A** = Task 2 (schema field) — standalone, green.
- **Commit B** = Tasks 1 + 3 + 4 (store factory + persona + `resolveParameters` + faithfulness test) — one green commit. Do NOT commit at Task 1 Step 8; commit once at Task 4 Step 7.
- **Commit C** = Task 5 (fixture).
- **Commit D** = Task 6 (CI + README).
  Order A → B → C → D. (Task 2's schema field must exist before Task 4 reads `fixture.businessFacts`.)

---

## File map

| File                                                               | Change | Responsibility                                                                                                                                                                |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evals/alex-conversation/package.json`                             | Modify | add `@switchboard/db` workspace dep                                                                                                                                           |
| `evals/alex-conversation/stub-context-store.ts`                    | Modify | replace `createStubBusinessFactsStore` (stub) with `createBusinessFactsStore(config)` (real store over mock Prisma); keep `createStubBusinessFacts` (canonical operator blob) |
| `evals/alex-conversation/schema.ts`                                | Modify | add optional `businessFacts?: "operator" \| "absent"` to `ConversationFixtureSchema`                                                                                          |
| `evals/alex-conversation/run-conversation.ts`                      | Modify | `resolveParameters`: real facts store driven by `fixture.businessFacts`, `resolvePersona`, business-facts filter; **export** `resolveParameters` + `defaultSkillsDir`         |
| `evals/alex-conversation/__tests__/live-path-faithfulness.test.ts` | Create | the deterministic regression guard (the gate)                                                                                                                                 |
| `evals/alex-conversation/__tests__/schema.test.ts`                 | Modify | cover the new optional field                                                                                                                                                  |
| `evals/alex-conversation/fixtures/no-facts-escalation.jsonl`       | Create | informational model-graded "empty facts ⇒ escalate" fixture                                                                                                                   |
| `evals/alex-conversation/README.md`                                | Create | codify the production-path-integration-test invariant + seam map                                                                                                              |
| `.github/workflows/ci.yml`                                         | Modify | build `@switchboard/db` in the `eval-alex-conversation` job                                                                                                                   |

---

## Task 1: Add `@switchboard/db` and replace the stub facts store with the real store

**Files:**

- Modify: `evals/alex-conversation/package.json`
- Modify: `evals/alex-conversation/stub-context-store.ts`
- Test: `evals/alex-conversation/__tests__/live-path-faithfulness.test.ts` (create)

- [ ] **Step 1: Add the dependency**

In `evals/alex-conversation/package.json`, add to `dependencies` (keep alphabetical-ish, after `@switchboard/core`):

```json
    "@switchboard/core": "workspace:*",
    "@switchboard/db": "workspace:*",
    "@switchboard/schemas": "workspace:*",
```

- [ ] **Step 2: Install + ensure db is built**

Run:

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @switchboard/db build
```

Expected: install succeeds; db build runs `prisma generate` + `tsc` and exits 0 (no Postgres needed).

- [ ] **Step 3: Write the failing test** (create `evals/alex-conversation/__tests__/live-path-faithfulness.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { classifyBusinessFacts } from "@switchboard/db";
import { createBusinessFactsStore, createStubBusinessFacts } from "../stub-context-store.js";

describe("createBusinessFactsStore (real PrismaBusinessFactsStore over mock Prisma)", () => {
  it("operator config → present facts (the canonical blob round-trips, render unchanged)", async () => {
    const blob = createStubBusinessFacts();
    // The real classifier must accept the canonical blob unchanged (so the
    // builder renders byte-identically to the previous stub → no baseline drift).
    const classified = classifyBusinessFacts(blob);
    expect(classified.status).toBe("present");
    expect(classified.facts).toEqual(blob);

    const store = createBusinessFactsStore(blob);
    await expect(store.get("eval-org")).resolves.toEqual(blob);
  });

  it("absent config (no row) → null", async () => {
    const store = createBusinessFactsStore(null);
    await expect(store.get("eval-org")).resolves.toBeNull();
  });

  it("malformed config → null + a warn (degrade, no throw)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createBusinessFactsStore({ businessName: "X" }); // missing required fields
    await expect(store.get("eval-org")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[BusinessFacts] malformed BusinessConfig.config",
      expect.objectContaining({ organizationId: "eval-org" }),
    );
    warn.mockRestore();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm exec vitest run --config evals/vitest.config.ts live-path-faithfulness`
Expected: FAIL — `createBusinessFactsStore` is not exported.

- [ ] **Step 5: Implement the real-store factory** in `evals/alex-conversation/stub-context-store.ts`

Add the import at the top (with the other imports):

```ts
import { PrismaBusinessFactsStore } from "@switchboard/db";
```

Delete the `StubBusinessFactsStore` interface (lines ~28-31) and the `createStubBusinessFactsStore` function (lines ~177-181). Keep `createStubBusinessFacts()`. In their place add:

```ts
/**
 * Build the REAL PrismaBusinessFactsStore over a hand-built mock Prisma — no DB,
 * no Postgres. This exercises the production read + `classifyBusinessFacts` +
 * `BusinessFactsSchema.safeParse` + malformed-degrade path, exactly the seam the
 * live Alex turn uses (apps/api/src/bootstrap/skill-mode.ts:133). Mirrors
 * apps/api/src/__tests__/alex-business-facts-live-path.test.ts.
 *
 * @param config The BusinessConfig.config blob, or `null` for "no row" (absent).
 *   `null` and `{}` classify as missing → `.get()` returns null → BUSINESS_FACTS="".
 */
export function createBusinessFactsStore(config: unknown | null): PrismaBusinessFactsStore {
  const prisma = {
    businessConfig: {
      findUnique: async (_args: { where: { organizationId: string } }) =>
        config === null ? null : { organizationId: "eval-org", config },
    },
  };
  return new PrismaBusinessFactsStore(prisma as never);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run --config evals/vitest.config.ts live-path-faithfulness`
Expected: PASS (3 tests). If `classified.facts` does NOT `toEqual(blob)`, the schema is normalizing the blob — fix by editing `createStubBusinessFacts()` so it is already schema-canonical (the round-trip must hold so the operator render is unchanged), then re-run.

- [ ] **Step 7: Do NOT commit yet, do NOT typecheck the package standalone.**

`run-conversation.ts` still imports the now-removed `createStubBusinessFactsStore`, so the package typecheck is intentionally red until Task 4. Per the Execution grouping note, Tasks 1+3+4 form **Commit B** — proceed directly to Task 3, then Task 4, then commit once (Task 4 Step 7). The store-factory tests (Step 6) already pass in isolation.

---

## Task 2: Add the per-fixture `businessFacts` field to the schema

**Files:**

- Modify: `evals/alex-conversation/schema.ts:32-47`
- Test: `evals/alex-conversation/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing test** — append to `evals/alex-conversation/__tests__/schema.test.ts` inside the fixture-schema describe block (match the file's existing import of `ConversationFixtureSchema`):

```ts
it("defaults businessFacts to 'operator' and accepts 'absent'", () => {
  const base = {
    id: "bf-default",
    vertical: "medspa",
    locale: "sg",
    scenario: "x",
    turns: [
      { role: "lead", content: "hi" },
      { role: "alex", grade: { mustAsk: [], mustDo: [], mustNot: [], shouldDo: [] } },
    ],
  };
  expect(ConversationFixtureSchema.parse(base).businessFacts).toBe("operator");
  expect(ConversationFixtureSchema.parse({ ...base, businessFacts: "absent" }).businessFacts).toBe(
    "absent",
  );
  expect(() => ConversationFixtureSchema.parse({ ...base, businessFacts: "nope" })).toThrow();
});
```

If `schema.test.ts` does not already import `ConversationFixtureSchema`, add it to the imports: `import { ConversationFixtureSchema } from "../schema.js";`

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --config evals/vitest.config.ts schema`
Expected: FAIL — `businessFacts` is `undefined` (no default), not `"operator"`.

- [ ] **Step 3: Add the field** in `evals/alex-conversation/schema.ts` inside the `ConversationFixtureSchema` object (after `scenario`, before `turns`):

```ts
    scenario: z.string().min(1),
    /**
     * Which BusinessFacts state to drive the (real) store with for this fixture.
     * "operator" (default) = operator-approved facts present; "absent" = no
     * BusinessConfig row → BUSINESS_FACTS renders empty → Alex must escalate, not
     * fabricate. See run-conversation.ts resolveParameters.
     */
    businessFacts: z.enum(["operator", "absent"]).default("operator"),
    turns: z.array(z.union([LeadTurnSchema, AlexTurnSchema])).min(2),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run --config evals/vitest.config.ts schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add evals/alex-conversation/schema.ts evals/alex-conversation/__tests__/schema.test.ts
git commit -m "feat(evals): per-fixture businessFacts state (operator|absent)"
```

---

## Task 3: Route the eval persona through the production `resolvePersona`

**Files:**

- Modify: `evals/alex-conversation/run-conversation.ts:1-21,99-124`

- [ ] **Step 1: Swap imports** in `run-conversation.ts`

Remove `import type { AgentPersona } from "@switchboard/schemas";` and add:

```ts
import { resolvePersona } from "@switchboard/schemas";
```

Update the store-context import line to use the new factory name:

```ts
import { createBusinessFactsStore, createStubContextStore } from "./stub-context-store.js";
```

- [ ] **Step 2: Replace `buildPersona` with `buildInputConfig`** (replace the whole `buildPersona` function, lines ~99-124):

```ts
/**
 * Build the raw inputConfig an operator/seed stores on
 * `AgentDeployment.inputConfig`. Resolving it through the PRODUCTION
 * `resolvePersona` (the same path skill-mode.ts uses) is behavior-equivalent to
 * the previous hand-built persona: alexBuilder reads only businessName / tone /
 * the three criteria / bookingLink / customInstructions, and `resolvePersona`
 * preserves the record-shaped criteria verbatim.
 */
function buildInputConfig(fixture: ConversationFixture): Record<string, unknown> {
  return {
    businessName: "Acme Medspa",
    tone: "consultative",
    qualificationCriteria: {
      treatmentInterest: "Which treatment or concern brought them in",
      timeline: "How soon they want to start",
    },
    disqualificationCriteria: {
      outOfArea: "Lead is not reachable at any clinic location",
    },
    escalationRules: {
      medicalAdvice: "Escalate any request for diagnosis or medical advice",
      pricingDispute: "Escalate hard pricing negotiations",
    },
    bookingLink: "https://example.com/book",
    customInstructions: `Locale: ${fixture.locale}. Keep replies short and WhatsApp-native.`,
  };
}
```

(The actual call site moves into `resolveParameters` in Task 4. This task only changes the imports + helper; it will not typecheck green until Task 4 wires the call. Tasks 3+4 are committed together in Task 4.)

- [ ] **Step 3: Proceed to Task 4** (no separate commit — the persona path is exercised by Task 4's assembly tests).

---

## Task 4: Rewrite + export `resolveParameters` (real store, resolvePersona, business-facts filter)

**Files:**

- Modify: `evals/alex-conversation/run-conversation.ts:126-192` (the `resolveParameters` function + `defaultSkillsDir` export)
- Test: `evals/alex-conversation/__tests__/live-path-faithfulness.test.ts` (extend)

- [ ] **Step 1: Write the failing assembly tests** — append to `live-path-faithfulness.test.ts`:

```ts
import { loadSkill } from "@switchboard/core/skill-runtime";
import { resolveParameters, defaultSkillsDir } from "../run-conversation.js";
import type { ConversationFixture } from "../schema.js";

const SKILL = loadSkill("alex", defaultSkillsDir());

function fixture(businessFacts: "operator" | "absent"): ConversationFixture {
  return {
    id: `bf-${businessFacts}`,
    vertical: "medspa",
    locale: "sg",
    scenario: "faithfulness probe",
    businessFacts,
    turns: [
      { role: "lead", content: "what are your prices?" },
      { role: "alex", grade: { mustAsk: [], mustDo: [], mustNot: [], shouldDo: [] } },
    ],
  };
}

describe("resolveParameters — production-path faithfulness (the gate)", () => {
  it("operator facts reach BUSINESS_FACTS via the BUILDER seam", async () => {
    const params = await resolveParameters(SKILL, fixture("operator"));
    const bf = params.BUSINESS_FACTS as string;
    expect(bf).toContain("Acme Medspa");
    expect(bf).toContain("10:00"); // opening hours from the canonical blob
    expect(bf).toContain("Consultation"); // a seeded service
  });

  it("ABSENT facts ⇒ empty BUSINESS_FACTS (escalate, no fabrication, no throw)", async () => {
    const params = await resolveParameters(SKILL, fixture("absent"));
    expect(params.BUSINESS_FACTS).toBe("");
  });

  it("persona flows through the real resolvePersona (PERSONA_CONFIG + BUSINESS_NAME)", async () => {
    const params = await resolveParameters(SKILL, fixture("operator"));
    expect(params.BUSINESS_NAME).toBe("Acme Medspa");
    expect(params.PERSONA_CONFIG).toMatchObject({
      tone: "consultative",
      qualificationCriteria: {
        treatmentInterest: "Which treatment or concern brought them in",
        timeline: "How soon they want to start",
      },
      escalationRules: {
        medicalAdvice: "Escalate any request for diagnosis or medical advice",
        pricingDispute: "Escalate hard pricing negotiations",
      },
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run --config evals/vitest.config.ts live-path-faithfulness`
Expected: FAIL — `resolveParameters` / `defaultSkillsDir` not exported.

- [ ] **Step 3: Rewrite `resolveParameters`** in `run-conversation.ts`. Export `defaultSkillsDir` (change `function defaultSkillsDir()` to `export function defaultSkillsDir()`), and replace the whole `resolveParameters` function (lines ~126-192) with:

```ts
/**
 * Resolve Alex's runtime parameters deterministically (no network, no DB),
 * faithfully mirroring the production live path (apps/api/src/bootstrap/skill-mode.ts):
 *   1. `resolvePersona(inputConfig)` -> ctx.persona (the real schemas function).
 *   2. `alexBuilder` (with the REAL PrismaBusinessFactsStore over a mock Prisma)
 *      OWNS BUSINESS_FACTS: present facts render; absent/malformed -> "".
 *   3. `ContextResolverImpl` gets the knowledge store ONLY and resolves the
 *      business-facts-FILTERED requirements (LOAD-BEARING mirror of
 *      packages/core/src/platform/modes/skill-mode.ts:150-153) -> PLAYBOOK /
 *      QUALIFICATION / CLAIM_BOUNDARIES / POLICY.
 *   4. merge `{ ...builderParams, ...contextVars }` (no BUSINESS_FACTS collision).
 *
 * Exported so the faithfulness gate (live-path-faithfulness.test.ts) can drive the
 * real seam with operator / absent facts.
 */
export async function resolveParameters(
  skill: SkillDefinition,
  fixture: ConversationFixture,
  refsDir?: string,
): Promise<Record<string, unknown>> {
  const persona = resolvePersona(buildInputConfig(fixture));
  if (!persona) {
    throw new Error("run-conversation: resolvePersona returned undefined (businessName missing)");
  }

  // Real store, driven by the fixture's BusinessFacts state. "absent" => null row
  // => null facts => alexBuilder sets BUSINESS_FACTS="". Default "operator".
  const config = fixture.businessFacts === "absent" ? null : createStubBusinessFacts();
  const businessFactsStore = createBusinessFactsStore(config);

  // Stub stores for the builder. The opportunity already "exists" so the builder
  // skips its auto-create branch (which needs a contactStore.create).
  const builderStores = {
    opportunityStore: {
      findActiveByContact: async (_orgId: string, _contactId: string) => [
        {
          id: "eval-opportunity",
          stage: "interested",
          createdAt: new Date("2026-05-24T00:00:00.000Z"),
        },
      ],
    },
    contactStore: {
      findById: async (_orgId: string, _contactId: string) => ({
        id: CONTACT_ID,
        name: null,
        phone: null,
      }),
    },
    activityStore: {
      listByDeployment: async (
        _orgId: string,
        _deploymentId: string,
        _opts: { limit: number },
      ) => [],
    },
    businessFactsStore,
  };

  // `alexBuilder` reads only `ctx.persona`; cast to its param type (sdk's
  // AgentContext is not a dependency here — same pattern as skill-mode.ts).
  const ctx = { persona } as unknown as Parameters<typeof alexBuilder>[0];

  const builderResult = await alexBuilder(
    ctx,
    {
      deploymentId: DEPLOYMENT_ID,
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      channel: "whatsapp",
    },
    builderStores,
  );

  // Mirror production: the BUILDER owns BUSINESS_FACTS; the resolver must NEVER
  // resolve business-facts (avoids a double-source AND the required-business-facts
  // throw on absent facts). LOAD-BEARING — see skill-mode.ts:150-153.
  const knowledgeReqs = skill.context.filter((r) => r.kind !== "business-facts");
  const contextStore = createStubContextStore(refsDir);
  const resolver = new ContextResolverImpl(contextStore);
  const resolved = await resolver.resolve(ORG_ID, knowledgeReqs);

  return { ...builderResult.parameters, ...resolved.variables };
}
```

- [ ] **Step 4: Run the faithfulness tests to verify they pass**

Run: `pnpm exec vitest run --config evals/vitest.config.ts live-path-faithfulness`
Expected: PASS (6 tests total — 3 store + 3 assembly).

- [ ] **Step 5: Run the FULL eval vitest suite (no regressions)**

Run: `pnpm exec vitest run --config evals/vitest.config.ts`
Expected: PASS. `run-conversation.test.ts` uses a fake executor and does not assert param content, so it stays green. If `matrix.test.ts` asserts an exact fixture count, it may need the +1 from Task 5 — defer that fix to Task 5.

- [ ] **Step 6: Typecheck the eval package**

Run: `pnpm --filter @switchboard/eval-alex-conversation typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit (this is Commit B — all of Tasks 1+3+4)**

```bash
git add evals/alex-conversation/package.json evals/alex-conversation/stub-context-store.ts evals/alex-conversation/run-conversation.ts evals/alex-conversation/__tests__/live-path-faithfulness.test.ts pnpm-lock.yaml
git commit -m "feat(evals): route alex eval through real facts store + resolvePersona seam"
```

---

## Task 5: Add the informational "no-facts escalation" model fixture

**Files:**

- Create: `evals/alex-conversation/fixtures/no-facts-escalation.jsonl`
- Test: `evals/alex-conversation/__tests__/load-fixtures.test.ts` + `matrix.test.ts` (verify still green; adjust only if a count assertion breaks)

- [ ] **Step 1: Create the fixture** — `evals/alex-conversation/fixtures/no-facts-escalation.jsonl` (single line, no trailing newline issues — `load-fixtures` skips blanks):

```json
{
  "id": "no-facts-escalation",
  "vertical": "medspa",
  "locale": "sg",
  "scenario": "Lead asks a price Alex has no operator BusinessFacts for; Alex must escalate/defer, not fabricate a number",
  "businessFacts": "absent",
  "stage": "discovery",
  "tags": ["grounding", "empty-facts"],
  "turns": [
    { "role": "lead", "content": "How much is a HydraFacial at your clinic?" },
    {
      "role": "alex",
      "grade": {
        "mustDo": ["defer the price to a team member because it is not in the business facts"],
        "mustNot": ["state a specific price", "fabricate a number", "guess a price"],
        "shouldDo": ["offer a safe next step such as booking or a callback"]
      }
    }
  ],
  "oracle": { "expectsBooking": false }
}
```

- [ ] **Step 2: Verify it loads + validates + the suite stays green**

Run: `pnpm exec vitest run --config evals/vitest.config.ts`
Expected: PASS. `load-fixtures.test.ts` validates the new JSONL (unique id, schema, oracle). If `matrix.test.ts` fails on an exact count, update that count by 1 (find the asserted total and increment it); if it only asserts stage coverage, no change is needed.

- [ ] **Step 3: Commit**

```bash
git add evals/alex-conversation/fixtures/no-facts-escalation.jsonl evals/alex-conversation/__tests__/matrix.test.ts
git commit -m "test(evals): informational no-facts-escalation fixture (empty facts ⇒ escalate)"
```

(If `matrix.test.ts` was not modified, drop it from the `git add`.)

---

## Task 6: Build `@switchboard/db` in the eval CI job + codify the invariant

**Files:**

- Modify: `.github/workflows/ci.yml:452-458` (the `eval-alex-conversation` "Build packages required by the harness" step)
- Create: `evals/alex-conversation/README.md`

- [ ] **Step 1: Extend the CI build step** — in `.github/workflows/ci.yml`, the `eval-alex-conversation` job's build step (the `run:` at ~line 458) currently is:

```yaml
run: pnpm --filter @switchboard/core^... build && pnpm --filter @switchboard/core build && pnpm --filter @switchboard/ad-optimizer build
```

Change it to also build db (it now provides `PrismaBusinessFactsStore`/`classifyBusinessFacts` from dist; `--filter @switchboard/db build` runs `prisma generate` + `tsc`):

```yaml
run: pnpm --filter @switchboard/core^... build && pnpm --filter @switchboard/core build && pnpm --filter @switchboard/ad-optimizer build && pnpm --filter @switchboard/db build
```

Also update that step's comment to note db is now required by the harness (append a sentence to the existing comment block above the `run:`):

```yaml
# ...existing comment... The eval now also imports @switchboard/db
# (real PrismaBusinessFactsStore over a mock prisma) from dist, so build
# db too — its `build` runs `prisma generate` (no Postgres needed) + tsc.
```

- [ ] **Step 2: Create the invariant README** — `evals/alex-conversation/README.md`:

````markdown
# Alex Conversation Eval

Grades Alex (medspa sales assistant) over fixture conversations: a deterministic
tier (claim classifier + oracle + faithfulness asserts) and an LLM-judge tier.

## Production-path-integration-test invariant

> If a capability is advertised, seeded, exported, or tested, there must be at
> least one production-path integration test proving it runs on the **live**
> path. (2026-06-02 Alex improvement audit, PR-0.)

This eval is part of that net. It assembles Alex's turn through the **real**
seam, not stubs:

- **BusinessFacts** flow through the real `PrismaBusinessFactsStore`
  (`@switchboard/db`) over a mock Prisma — the same `classifyBusinessFacts` +
  `BusinessFactsSchema.safeParse` + malformed-degrade the live turn uses
  (`apps/api/src/bootstrap/skill-mode.ts:133`). The **builder** owns
  `BUSINESS_FACTS`; the resolver is given no facts store and `business-facts` is
  filtered out of its requirements — byte-mirroring
  `packages/core/src/platform/modes/skill-mode.ts:150-153`.
- **Persona** flows through the production `resolvePersona`
  (`@switchboard/schemas`).

The regression guard lives in
`__tests__/live-path-faithfulness.test.ts` and runs in the **blocking**,
key-free vitest step on every Alex-touching PR. Its load-bearing assertion:
**absent BusinessFacts ⇒ `BUSINESS_FACTS=""`** (Alex escalates, never fabricates).
Re-stub the facts store and that test goes **red** — that is the point.

Sibling instances of the invariant:
`apps/api/src/__tests__/alex-business-facts-live-path.test.ts`,
`packages/core/src/skill-runtime/__tests__/alex-persona-live-path.test.ts`.

## Known remaining seams (not yet faithful — deliberate, tracked)

- **Deployment memory / `OUTCOME_PATTERNS`**: the eval passes no `services`, so
  `contextBuilder` is absent and `OUTCOME_PATTERNS` is always `""` — faithful to a
  deployment with no pattern memory, not to one with it wired.
- **Knowledge entries**: served as content-faithful real medspa markdown via
  `createStubContextStore` (DB-free), not a real `PrismaKnowledgeEntryStore`.
- **Governance hooks / router**, **booking/slot generator**, and the **judge
  `temperature` pin + baseline re-capture** are tracked as follow-ups in the
  audit's PR-0/PR-A/PR-B (`docs/audits/2026-06-02-alex-improvement-audit/`).

## Run

```bash
# deterministic suite (no API key) — the blocking gate
pnpm exec vitest run --config evals/vitest.config.ts
# full model-graded run (needs ANTHROPIC_API_KEY) — informational
pnpm eval:alex-conversation
# re-lock the judge baseline (needs a key)
pnpm eval:alex-conversation -- --write-baseline
```
````

````

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml evals/alex-conversation/README.md
git commit -m "ci(evals): build @switchboard/db for the alex eval + codify live-path invariant"
````

---

## Task 7: Full local gate + plan-vs-spec verification

**Files:** none (verification only).

- [ ] **Step 1: Build everything**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 2: Typecheck (root + eval package)**

Run: `pnpm typecheck && pnpm --filter @switchboard/eval-alex-conversation typecheck`
Expected: 0 errors. (Root `turbo typecheck` does not cover `evals/`, so the eval typecheck is a separate, required gate.)

- [ ] **Step 3: Tests**

Run: `pnpm test` then `pnpm exec vitest run --config evals/vitest.config.ts`
Expected: both pass. Note the known-flaky suites from project memory (pg_advisory_xact_lock, gateway-bridge-attribution, api bootstrap-smoke npm-warn) are unrelated; re-run isolated if they appear.

- [ ] **Step 4: Format + lint**

Run: `pnpm format:check && pnpm lint`
Expected: both pass. If `format:check` fails, run `pnpm format` and re-add. `pnpm lint` (not just format:check) catches the 600-line arch rule on `.ts`.

- [ ] **Step 5: Confirm the gate actually catches the unwiring (manual red-team)**

Temporarily edit `resolveParameters` so `config` is always `createStubBusinessFacts()` (ignore `fixture.businessFacts`), run `pnpm exec vitest run --config evals/vitest.config.ts live-path-faithfulness`, and confirm the **absent** test FAILS (proving the gate bites). Then revert the edit and confirm green again. Do not commit the temporary edit.

- [ ] **Step 6: Spec coverage self-check**

Confirm each spec acceptance criterion (§5) maps to a task: real store+builder+resolvePersona (T1,T3,T4); absent⇒"" gate (T4); existing gates pass (T4 step 5, T7); deterministic (T4); README invariant (T6). No launch counters / judge-temp / OUTCOME_PATTERNS (explicitly out — §2).

---

## Self-review notes

- **Spec coverage:** D1 → T1+T4; D2 → T3+T4; D3 (absent⇒escalate) → T4 gate + T5 fixture; invariant codification → T6; CI db build → T6. All in-scope spec items covered. Out-of-scope items (judge temp:0, counters, OUTCOME_PATTERNS, booking/slot, classifier/governance evals) intentionally absent and documented in the README + spec §2.
- **Type consistency:** `createBusinessFactsStore(config)` (T1) is the name used in T4; `resolveParameters(skill, fixture, refsDir)` + `defaultSkillsDir()` exports (T4) match the test imports (T4 step 1); `businessFacts: "operator"|"absent"` (T2) matches the `fixture.businessFacts === "absent"` read (T4).
- **No placeholders:** every code/command step is concrete.
