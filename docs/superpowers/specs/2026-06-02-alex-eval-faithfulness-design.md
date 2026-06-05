# Alex Eval Faithfulness (PR-0 — eval-faithfulness slice) — Design

**Date:** 2026-06-02
**Branch:** `feat/alex-eval-faithfulness` (off `origin/main` @ 2300097a)
**Audit:** `docs/audits/2026-06-02-alex-improvement-audit/` (PR-0, "Faithful eval + launch counters")
**Status:** decisions locked by best judgment under the requester's standing "don't check back until shipped" authorization. Each decision records its rationale so a reviewer can challenge it.

---

## 1. Problem

The audit's systemic theme: **Alex appears governed, grounded, and measurable while the live path doesn't actually use those systems**, and the green Alex-conversation eval can't see the seam — so manual audits keep finding "built-but-unwired" nets (BusinessFacts was one such gap, now fixed by #813 + the operator editor #828).

This slice makes the **Alex-conversation eval faithful to the live `store → alexBuilder → prompt` seam**, so a green eval would go **red** if a grounding net (starting with operator BusinessFacts) were wired out. It converts the "unwired net" class from _manually-audited_ to _automatically-caught_.

### What the eval bypasses today (verified against current `origin/main`)

`#794` already routed the eval through the **real `alexBuilder`** and **real `ContextResolverImpl`** — so the audit's "`run-conversation.ts:174` resolvePersona bypass" line is now **stale**. The remaining, verified divergences from production:

| #   | Seam                                 | Production (`apps/api/src/bootstrap/skill-mode.ts`)                                                                                                                                                                                                                                                                          | Eval today (`evals/alex-conversation/run-conversation.ts`)                                                                                                                                                                                                                                      |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **BusinessFacts source + ownership** | The **builder** owns `BUSINESS_FACTS` via `new PrismaBusinessFactsStore(prisma)` (`.get()` → `classifyBusinessFacts` → `BusinessFactsSchema.safeParse`). `ContextResolverImpl` is built with **no** facts store and `SkillMode` **filters `business-facts` out** of the resolver (`skill-mode.ts:152`, marked LOAD-BEARING). | A hand-built **stub** (`createStubBusinessFactsStore`) that **always returns a hardcoded non-null blob**, passed **into the resolver** (`new ContextResolverImpl(contextStore, businessFactsStore)`), which then **produces and overrides** `BUSINESS_FACTS` (merge precedence: resolved wins). |
| D2  | **Persona resolution**               | `resolvePersona(deployment.inputConfig)` (the real `@switchboard/schemas` function).                                                                                                                                                                                                                                         | A hand-rolled `AgentPersona` literal (`buildPersona`), never touching `resolvePersona`.                                                                                                                                                                                                         |
| D3  | **Empty-facts behavior**             | Builder + null facts ⇒ `BUSINESS_FACTS=""` (no throw) ⇒ SKILL.md "Business Knowledge Rules" force Alex to **escalate, not fabricate**.                                                                                                                                                                                       | Resolver + `required:true` + null facts ⇒ `ContextResolutionError` **thrown** (the run crashes) — so the "empty facts ⇒ escalate" path can never be observed, and the stub can never _be_ empty anyway.                                                                                         |

**Key convergence:** fixing D1 (mirror production's builder-owned facts seam) is _exactly_ what makes D3's empty-facts regression guard meaningful. They are the same change.

---

## 2. Scope (locked)

### In scope — the eval-faithfulness slice of PR-0

1. **Mirror production's BusinessFacts seam (D1).** In the eval's parameter assembly:
   - Build `businessFactsStore = new PrismaBusinessFactsStore(mockPrisma)` — the **real** store from `@switchboard/db`, over a hand-built `{ businessConfig: { findUnique } }` mock (no DB), exactly the pattern in `apps/api/src/__tests__/alex-business-facts-live-path.test.ts`.
   - Pass that store to **`alexBuilder` only** (it owns `BUSINESS_FACTS`).
   - Construct `ContextResolverImpl` **without** a facts store and **filter `business-facts` out** of `skill.context` before `resolve()` — byte-mirroring `skill-mode.ts:152`.
2. **Route persona through `resolvePersona` (D2).** Replace `buildPersona`'s literal with `resolvePersona(inputConfig)`, where `inputConfig` is crafted to resolve to a persona **behavior-equivalent** to today's (so existing fixtures' prompts are unchanged). The real resolver now runs in the eval.
3. **Per-fixture BusinessFacts state.** Add an optional, backward-compatible fixture field `businessFacts?: "operator" | "absent"` (default `"operator"`). `"operator"` ⇒ the mock returns the canonical medspa config; `"absent"` ⇒ the mock returns `null` (no `BusinessConfig` row).
4. **Deterministic regression guard (the gate).** A co-located vitest test (`evals/alex-conversation/__tests__/business-facts-faithfulness.test.ts`) that drives the **exported `resolveParameters`** through the real store→builder seam and asserts:
   - operator facts ⇒ `parameters.BUSINESS_FACTS` contains the rendered facts (hours, services) **and is produced by the builder seam** (the resolver does not emit it);
   - **absent facts ⇒ `parameters.BUSINESS_FACTS === ""`** (no fabrication, no throw) — _the unwired-net assertion_;
   - malformed config ⇒ degrades to `""` (mirrors the live-path test, end-to-end through the eval's assembly);
   - behavior-preservation: the operator render is byte-identical to today's stub render; `resolvePersona(inputConfig)` yields the expected 7-field persona.
   - **Why this is the right gate:** it runs in the eval's **blocking** vitest step on every Alex-touching PR (no API key, deterministic). Re-stubbing the store to a hardcoded blob makes the absent-case assertion fail ⇒ **red**. This is the audit's "the invariant test fails if a capability is wired out."
5. **Model-graded "no-facts escalation" fixture (secondary, informational).** A new fixture (`businessFacts: "absent"`) where the lead asks a factual question (pricing/hours) and the grade requires escalation/deferral (`mustDo`) and forbids fabricating a price/hour (`mustNot`). Proves the behavior end-to-end when an API key is present. It runs only in the **`continue-on-error` informational** step and is **info-only** vs the baseline (a new scenario can never red the gate) — so it cannot break CI or move the bake.
6. **Codify the production-path-integration-test invariant.** Add `evals/alex-conversation/README.md` stating the invariant ("every advertised Alex capability has a production-path integration test; the eval routes the real store→builder→prompt seam") with the current seam map and the list of instances (`alex-business-facts-live-path.test.ts`, `alex-persona-live-path.test.ts`, this eval's faithfulness test). This is the durable fix for the _class_.

### Out of scope (deliberate — documented as fast-follows / separate PRs)

- **Judge `temperature:0` + Alex-baseline re-capture** (PR-0 item 2). Pinning the judge changes its verdicts ⇒ requires a **keyed** baseline re-capture to land cleanly. It is orthogonal to the store seam, and this no-DB slice does not assume an `ANTHROPIC_API_KEY`. _Fast-follow_ (bundled with the baseline re-lock). Note: it cannot red the gate today anyway (the live step is `continue-on-error`), so deferring loses no safety.
- **Launch counters + alert surface** (PR-0 item 4) — emits from the **live** Alex path; different blast radius; overlaps other Alex sessions. Separate PR.
- **Deployment-memory / `OUTCOME_PATTERNS` faithfulness.** The eval passes no `services`, so `OUTCOME_PATTERNS` is always `""` — faithful to a deployment with **no** `contextBuilder`, but not to one with pattern memory wired. Wiring a real `ContextBuilder` is a larger lift; learning-loop closure is explicitly _Later_ in the audit. Documented as a known remaining seam in the README.
- **Booking / slot-generator mock faithfulness** (PR-0 item 3). Making the slot mock reproduce the real generator would reproduce the _unfixed_ slot bug and turn existing booking fixtures **red** before PR-A fixes the generator — violating "existing gates pass." Coordinate with PR-A/PR-B.
- **Governance gate / router-on eval variant** — the audit places this _after_ PR-0 (freeze gate), not in it.
- **Knowledge store as a real `PrismaKnowledgeEntryStore`.** `createStubContextStore` already serves **byte-identical real seeded markdown** (content-faithful, DB-free); only the store _class_ differs, and there is no empty-state regression to catch there. Swapping it for a mocked-Prisma knowledge store is cost with no faithfulness gain for this slice. Kept as a content-faithful stub; documented.
- **Classifier / governance-decision evals.** Separate CI jobs + baselines; the classifier is mid-**bake** (≥2026-06-06) and its path filter excludes `evals/alex-conversation/**` — untouched by construction.

---

## 3. Design

### 3.1 Components touched

```
evals/alex-conversation/
  run-conversation.ts        — resolveParameters: real facts store, resolvePersona, business-facts filter; EXPORT it
  stub-context-store.ts      — replace createStubBusinessFactsStore (stub) with a real-store factory over mock Prisma;
                               keep createStubBusinessFacts (the canonical operator blob) + createStubContextStore (knowledge)
  schema.ts                  — add optional `businessFacts?: "operator" | "absent"` to ConversationFixtureSchema
  fixtures/no-facts-escalation.jsonl   — NEW model-graded fixture (businessFacts: "absent")
  __tests__/business-facts-faithfulness.test.ts — NEW deterministic regression guard (the gate)
  __tests__/run-conversation.test.ts   — update if it asserts the old facts/persona seam (it does not assert param content today)
  __tests__/schema.test.ts             — add coverage for the new optional field
  package.json               — add "@switchboard/db": "workspace:*"
  README.md                  — NEW: codify the production-path-integration-test invariant + seam map
.github/workflows/ci.yml     — eval-alex-conversation build step: also build @switchboard/db (prisma generate)
docs/superpowers/specs|plans — this spec + the plan
```

### 3.2 Data flow (after)

```
fixture.businessFacts ("operator"|"absent")
        │
        ▼
mock Prisma { businessConfig.findUnique → operator? {config: BLOB} : null }
        │
        ▼
new PrismaBusinessFactsStore(mockPrisma)         ← real store, real classifyBusinessFacts + safeParse
        │  .get(orgId)                              null when absent/malformed
        ▼
alexBuilder(ctx={persona: resolvePersona(inputConfig)}, config, {…, businessFactsStore})
        │   BUSINESS_FACTS = facts ? renderBusinessFacts(facts) : ""    ← builder owns it
        ▼
ContextResolverImpl(knowledgeStore)              ← NO facts store
   .resolve(orgId, skill.context.filter(r => r.kind !== "business-facts"))   ← business-facts filtered (LOAD-BEARING mirror)
        │   PLAYBOOK_CONTEXT / QUALIFICATION_CONTEXT / CLAIM_BOUNDARIES / POLICY_CONTEXT
        ▼
parameters = { ...builderResult.parameters, ...resolved.variables }   ← no BUSINESS_FACTS collision now
        ▼
SkillExecutor (temp-0 adapter, mock tools, no hooks) → Alex turn
```

### 3.3 `resolveParameters` (exported) — signature

```ts
export async function resolveParameters(
  skill: SkillDefinition,
  fixture: ConversationFixture,
  refsDir?: string,
): Promise<Record<string, unknown>>;
```

Internally: pick `config = fixture.businessFacts === "absent" ? null : createStubBusinessFacts()`; build the real store over `mockBusinessConfigPrisma(config)`; `persona = resolvePersona(buildInputConfig(fixture))` (guard `undefined`); pass the store to `alexBuilder` only; construct `ContextResolverImpl(knowledgeStore)` and resolve the **business-facts-filtered** requirements. Returns the merged parameters.

### 3.4 Behavior preservation (so existing fixtures + baseline don't move)

- Existing fixtures omit `businessFacts` ⇒ default `"operator"` ⇒ the mock returns `createStubBusinessFacts()` (today's exact blob) ⇒ `classifyBusinessFacts` parses it ⇒ `renderBusinessFacts` produces the **same** string the stub produced today. Locked by a test asserting `renderBusinessFacts(classify(blob).facts) === renderBusinessFacts(blob)` and `classify(blob).status === "present"`.
- `resolvePersona(inputConfig)` yields the same 7 fields `alexBuilder` reads (`businessName`, `tone`, the three criteria objects, `bookingLink`, `customInstructions`). Dropped fields (`businessType`, `productService`, `valueProposition`, ids, timestamps) were never read. Locked by a test asserting the resolved persona deep-equals the expected 7-field object.
- Net: existing fixtures' prompts are byte-identical ⇒ the (informational) judge baseline does not move ⇒ no re-capture needed.

### 3.5 Determinism & PII

- Alex model stays temp-0 (`createTemp0Adapter`). The regression gate is a deterministic unit test (no model). Fixtures are fixed text.
- The operator blob and the new fixture use **fake** clinic data (Acme/Glow names, fake Orchard addresses, `+65…` test phones) — no real PII. Scrubbed before commit.

---

## 4. Testing strategy

- **Deterministic gate (blocking, no key):** `business-facts-faithfulness.test.ts` — operator/absent/malformed assertions + behavior-preservation locks (above). Runs in the eval vitest step on every Alex-path PR.
- **Existing eval unit tests:** must stay green (`run-conversation.test.ts`, `schema.test.ts`, `load-fixtures.test.ts`, `oracle.test.ts`, `matrix.test.ts`, etc.). Updated only where they assert the changed seam.
- **Model-graded (informational, key-gated):** the `no-facts-escalation` fixture exercises the end-to-end escalation behavior; info-only vs baseline.
- **Full local gate:** `pnpm build && pnpm typecheck && pnpm test && pnpm format:check && pnpm lint`, **plus** `pnpm --filter @switchboard/eval-alex-conversation typecheck` (CI does not typecheck evals) and `pnpm exec vitest run --config evals/vitest.config.ts`.

---

## 5. Acceptance criteria (the contract)

1. The Alex eval assembles Alex's turn through the **real `alexBuilder` + real `PrismaBusinessFactsStore`** (mock Prisma) + **real `resolvePersona`**, with production's builder-owned / resolver-filtered facts seam.
2. A deliberately-unwired net — **absent BusinessFacts ⇒ `BUSINESS_FACTS=""` (escalate, no fabrication)** — is asserted by the eval's deterministic gate and goes **red** if the store is re-stubbed.
3. Existing eval gates still pass; the classifier bake is untouched; no Alex-baseline re-capture required.
4. Deterministic (temp-0; the gate is model-free).
5. All green: `pnpm build && typecheck && test && format:check && lint` + the eval vitest suite + eval typecheck.
6. PR to `main`, **no auto-merge**.

---

## 6. Risks & mitigations

| Risk                                                                     | Mitigation                                                                                                                                                              |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adding `@switchboard/db` to evals needs db built (prisma generate) in CI | Add `pnpm --filter @switchboard/db build` to the eval job's build step; verified `pnpm build` succeeds **without Postgres** (generate needs only the schema).           |
| Eval TS isn't typechecked in CI (vitest esbuild strips types)            | Run `pnpm --filter @switchboard/eval-alex-conversation typecheck` locally as a hard gate; consider adding a CI typecheck step only if the package is already clean.     |
| Persona/facts change moves the informational baseline                    | Behavior-preserving by construction + locked by tests (§3.4); the live step is `continue-on-error` regardless.                                                          |
| `classifyBusinessFacts` drift vs the eval                                | The eval imports the **real** store (no clone) — zero drift.                                                                                                            |
| Other active sessions (Riley/Mira/wave-1)                                | Disjoint: changes are confined to `evals/alex-conversation/**`, the eval's `package.json`, and one CI build line. No dashboard, no live Alex path, no Riley/Mira files. |
