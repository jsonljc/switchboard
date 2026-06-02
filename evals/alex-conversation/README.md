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
