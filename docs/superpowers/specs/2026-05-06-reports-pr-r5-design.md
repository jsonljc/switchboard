# Reports backend v1 — PR-R5 design

**Status:** Draft
**Date:** 2026-05-06
**Parent spec:** [`2026-05-05-reports-backend-v1-design.md`](./2026-05-05-reports-backend-v1-design.md) §9 PR-R5
**Predecessors merged to `main`:** PR-R1 (#367/#368), PR-R3 (#370), PR-R4 (#371). PR-R2 deferred to Phase D. PR-R6 (PDF + cutover) is the next PR after this one.

---

## 1. Goal

Replace the `STUB_PULLQUOTE` constant in `period-rollup.ts` with a real LLM-generated pull-quote. The pull-quote is the one prose element on `/reports`; everything else (funnel, attribution, campaigns, cost-vs-value) is computed deterministically. The numbers in the pull-quote (`value`, `cost`) come from the deterministic rollup — the LLM only writes the three short prose connectors that wrap them.

## 2. Scope

**In scope**

- New module `packages/core/src/reports/pull-quote-generator.ts` exposing `createPullQuoteGenerator(deps)` which returns `(facts) => Promise<PullQuoteCopy>`.
- New prompt module `packages/core/src/reports/prompts/pull-quote-prompt.ts` (system prompt + `buildUserPrompt(facts)`).
- New tiny `LLMClient` interface in `packages/core/src/reports/interfaces.ts` (one method: `complete(system, user) => Promise<string>`).
- New `pullQuoteGenerator` field on `ReportDependencies`; `period-rollup.ts` calls it and swaps the result into the `pullquote: PullQuoteCopy` field of the rollup payload.
- New Anthropic-backed `LLMClient` constructor (`createAnthropicReportLLMClient(apiKey)`) co-located with the generator, returning a one-method object that wraps `@anthropic-ai/sdk` (already a dep of `@switchboard/core`). No reuse of the conversational `agent-runtime/anthropic-adapter.ts` — that adapter is shaped for chat history and isn't a fit.
- API wiring update in `apps/api/src/routes/dashboard-reports.ts` to construct the LLM client from `ANTHROPIC_API_KEY` and pass it through `ReportDependencies`. When the env var is absent, `llm` is `null` and the generator returns the deterministic template — same behavior as on LLM error.
- Tests: 6 cases for `pull-quote-generator.test.ts`; updated `period-rollup.test.ts` asserting the generator is invoked with the right facts and its output lands in `pullquote`.

**Out of scope (deferred or covered elsewhere)**

- Per-pull-quote cache row. Caching is implicit: `ReportCache` already wraps the entire `ReportData` payload (including `pullquote`) for 1h, so the LLM is hit at most once per `(orgId, window)` per hour without any new cache layer. (Locked in parent spec §3 row 7 / §9 PR-R3.)
- Prompt caching across orgs. Marginal Haiku savings, deferred — not in v1.
- Retries on JSON parse / schema-validation failure. Spec language is "validation failure or LLM error → fallback"; one shot then fallback is the cleanest read.
- WorkTrace recording. Pull-quote generation is on the read path, not a mutating action. `console.warn` covers observability for fallback paths.
- Telemetry / cost tracking for the LLM call. Add when we instrument other read-path LLM calls; not load-bearing for v1.
- PDF rendering. PR-R6.

## 3. Decisions

| #   | Decision                        | Detail                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | LLM provider/model              | **Anthropic Haiku 4.5** (`claude-haiku-4-5-20251001`) via `@anthropic-ai/sdk` — already a `packages/core` dep. Haiku is sufficient for a five-slot templated sentence; reserves Sonnet for tasks where prose quality is load-bearing.                                                                                                                                  |
| 2   | LLM output scope                | LLM writes **only `{ pre, mid, post }`** — the three short prose connectors. `value` and `cost` are formatted by the deterministic rollup (already done in `cost-vs-value-rule.ts`) and merged into `PullQuoteCopy` after validation. User-visible numbers can never drift from the deterministic computation.                                                         |
| 3   | LLM input facts                 | Minimal: `{ periodLabel: string, revenueUsd: number, costUsd: number, savingsUsd: number }`. Prompt formats them into the user message. No funnel deltas, no campaign names, no attribution split — the three slots are too short to fit those, and a wider input surface adds hallucination risk without prose payoff.                                                |
| 4   | Structured-output mechanism     | Plain JSON response + `JSON.parse` + Zod validation. Prefill `{` on the assistant turn to nudge Claude into JSON immediately. Anthropic SDK has no strict JSON mode, and tool-use is overkill for a 3-key schema.                                                                                                                                                      |
| 5   | Failure handling                | One shot, no retry. On any of (LLM error, JSON parse failure, Zod validation failure, `llm === null`) → return the deterministic template. `console.warn` with the failure mode and `orgId` so failures are visible in logs.                                                                                                                                           |
| 6   | DI shape                        | `createPullQuoteGenerator({ llm: LLMClient \| null }) => (facts) => Promise<PullQuoteCopy>`. Mirrors the `createPeriodRollup(deps)` factory pattern used everywhere else in `core/reports/`. `LLMClient` is a one-method interface (`complete(system, user) => Promise<string>`) so tests pass mocks; the Anthropic SDK never enters the rollup module's import graph. |
| 7   | Caching                         | None new. `ReportCache` already covers it for 1h at the `ReportData` level. Pull-quote is one field of that cached payload; the LLM is invoked only on `ReportCache` miss, so reload-stability inside an hour is automatic.                                                                                                                                            |
| 8   | Prompt + system-prompt location | `packages/core/src/reports/prompts/pull-quote-prompt.ts`. Exports `PULL_QUOTE_SYSTEM_PROMPT` (constant) and `buildUserPrompt(facts: PullQuoteFacts): string`. Co-located so prompt iteration is one file, not a search across the package.                                                                                                                             |
| 9   | Voice register                  | Operator deep-dive register: concise, fact-led, third-person describing the team's period. Not the warm narrative voice used on agent-home. Anchored by examples in the system prompt. The slots stay structurally identical so prose can't reorganize the sentence.                                                                                                   |
| 10  | Deterministic template          | Period-aware: `pre = "In ${periodLabel}, your team generated"` / `mid = "in revenue, with Switchboard costing"` / `post = "versus a traditional stack."`. Same five-slot shape; safe under any failure path.                                                                                                                                                           |

## 4. Architecture

### 4.1 Module map

```
packages/core/src/reports/
  prompts/
    pull-quote-prompt.ts            # NEW — system prompt + buildUserPrompt(facts)
    pull-quote-prompt.test.ts       # NEW — buildUserPrompt formatting cases
  pull-quote-generator.ts           # NEW — createPullQuoteGenerator(deps); template fallback;
                                    #       createAnthropicReportLLMClient(apiKey) factory
  pull-quote-generator.test.ts      # NEW — 6 cases (see §6)
  interfaces.ts                     # MODIFIED — add LLMClient, PullQuoteFacts, PullQuoteGenerator
  period-rollup.ts                  # MODIFIED — accept pullQuoteGenerator dep; call it; remove STUB_PULLQUOTE
  period-rollup.test.ts             # MODIFIED — assert generator invoked with right facts; assert output lands in payload.pullquote
  index.ts                          # MODIFIED — export createPullQuoteGenerator, createAnthropicReportLLMClient, LLMClient type
```

```
apps/api/src/routes/
  dashboard-reports.ts              # MODIFIED — construct LLM client (or null) from ANTHROPIC_API_KEY; add pullQuoteGenerator to ReportDependencies
```

### 4.2 Data flow on a cache-miss `/reports` load

1. `dashboard-reports.ts` route reads `ANTHROPIC_API_KEY`. If present, builds an `LLMClient` via `createAnthropicReportLLMClient(apiKey)`. If absent, passes `null`.
2. Route builds the `pullQuoteGenerator` via `createPullQuoteGenerator({ llm })` and adds it to `ReportDependencies`.
3. Route calls `createPeriodRollup(deps)` and runs the rollup.
4. Inside `period-rollup.ts`, after the `Promise.all` of section rollups resolves and the cost-vs-value numbers are known, the rollup builds `PullQuoteFacts` (`{ periodLabel, revenueUsd, costUsd, savingsUsd }`) and awaits `pullQuoteGenerator(facts)`.
5. The generator either returns LLM-written `{ pre, mid, post }` merged with formatted `value`/`cost` strings, or — on any failure — returns the deterministic template. Either way the result is a valid `PullQuoteCopy`.
6. Rollup writes the result into `payload.pullquote` and returns. `dashboard-reports.ts` upserts the whole `payload` into `ReportCache` with 1h TTL.
7. Subsequent loads inside that hour read from `ReportCache` and the LLM is not called.

### 4.3 Layer compliance

- `packages/core` may import `@anthropic-ai/sdk` directly (it already does, in `agent-runtime/anthropic-adapter.ts`). No new layer crossings.
- `pull-quote-generator.ts` is the only file in `core/reports/` that touches `@anthropic-ai/sdk`. Other files in `core/reports/` depend only on the `LLMClient` interface and never import the SDK.
- No schema or DB changes. `PullQuoteCopy` is already defined in `@switchboard/schemas`.
- Surface-agnostic: nothing in `core` references `/reports`, the dashboard, or any UI.

## 5. Interfaces

### 5.1 `LLMClient` (new in `interfaces.ts`)

```ts
export interface LLMClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
```

One method, returns a raw string. The generator parses + validates. Keeps the interface trivially mockable.

### 5.2 `PullQuoteFacts` and `PullQuoteGenerator`

```ts
export interface PullQuoteFacts {
  periodLabel: string; // e.g. "April 2026", "Last week"
  revenueUsd: number; // e.g. 18432.5
  costUsd: number; // e.g. 499
  savingsUsd: number; // e.g. 7501 (alt cost - paid cost)
}

export type PullQuoteGenerator = (facts: PullQuoteFacts) => Promise<PullQuoteCopy>;
```

### 5.3 Generator factory

```ts
export function createPullQuoteGenerator(deps: { llm: LLMClient | null }): PullQuoteGenerator;
```

Internally:

- Format `value = formatUsd(facts.revenueUsd)` and `cost = formatUsd(facts.costUsd)`.
- If `deps.llm == null` → return template.
- Else call `deps.llm.complete(PULL_QUOTE_SYSTEM_PROMPT, buildUserPrompt(facts))`.
- The string returned by `LLMClient.complete` is already prefixed with `{` — the Anthropic-backed implementation re-prepends the prefill (see §5.5), so the generator just calls `JSON.parse(text.trim())` and validates with the Zod schema (3 fields, all non-empty strings, each ≤ 80 chars).
- On success → return `{ pre: parsed.pre, value, mid: parsed.mid, cost, post: parsed.post }`.
- On any failure → `console.warn` with the failure mode (excluding raw user data) and return template.

### 5.4 Deterministic template (private helper)

```ts
function buildTemplate(facts: PullQuoteFacts, value: string, cost: string): PullQuoteCopy {
  return {
    pre: `In ${facts.periodLabel}, your team generated`,
    value,
    mid: "in revenue, with Switchboard costing",
    cost,
    post: "versus a traditional stack.",
  };
}
```

### 5.5 Anthropic-backed `LLMClient`

```ts
export function createAnthropicReportLLMClient(apiKey: string): LLMClient;
```

- Constructs `new Anthropic({ apiKey })` once at factory-call time.
- `complete(system, user)` calls `client.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 256, temperature: 0.4, system, messages: [{ role: "user", content: user }, { role: "assistant", content: "{" }] })`.
- Extracts `response.content[0].text` (the SDK strips the prefilled `{` from the response, so we re-prepend it before returning).
- Throws on any SDK error — generator catches it and falls back.

`temperature: 0.4` keeps prose stable across reloads-within-cache-misses without being so flat the prose feels rote. `max_tokens: 256` is comfortably above three short connectors (~50 tokens) plus JSON syntax.

## 6. Test plan

### 6.1 `pull-quote-generator.test.ts` — 6 cases

All use a hand-rolled mock `LLMClient`. No HTTP, no SDK.

Mock `LLMClient.complete` returns the post-prefill string — i.e. it already includes the leading `{` (since §5.5 specifies the Anthropic-backed implementation re-prepends it). Generator-level tests therefore work with full JSON strings.

1. **Happy path.** Mock returns `'{"pre": "In April 2026, the team closed", "mid": "in revenue, against a Switchboard fee of", "post": "saving roughly $7,500 vs a traditional stack."}'`. Assert returned `PullQuoteCopy` has those three prose fields and the expected formatted `value`/`cost` strings.
2. **LLM throws.** Mock rejects. Assert template returned, with the exact period-aware prose, and `console.warn` called once with `"pull-quote-generator: llm error"` (or similar) and the period passed in. (No org-scoped data is passed to the generator — the rollup hands it pure `PullQuoteFacts`.)
3. **Malformed JSON.** Mock returns `"not json at all"`. Assert template returned, warn called with `"pull-quote-generator: parse failure"`.
4. **Valid JSON, missing fields.** Mock returns `'{"pre": "x"}'` (missing `mid`/`post`). Assert template returned, warn called with `"pull-quote-generator: schema validation failure"`.
5. **Null client.** `createPullQuoteGenerator({ llm: null })`. Assert template returned without invoking any mock; no warn (this is the expected unconfigured path, not an error).
6. **Template determinism.** Two calls with the same facts return identical `PullQuoteCopy` objects. (Cheap regression guard for accidental `Date.now()` or `Math.random()` creeping into the template.)

### 6.2 `pull-quote-prompt.test.ts`

- `buildUserPrompt(facts)` formats numbers as `$X,XXX.XX` (or whatever `formatUsd` returns), includes `periodLabel` verbatim, and never throws on edge cases (zero revenue, zero cost, negative savings if a customer underperforms the alt baseline).

### 6.3 `period-rollup.test.ts` — additions

- New case: with a stub `pullQuoteGenerator` that records its inputs and returns a sentinel `PullQuoteCopy`, assert the rollup invokes it with `{ periodLabel: <expected>, revenueUsd: <from cost-vs-value>, costUsd: <from cost-vs-value>, savingsUsd: <alt − paid> }` and that the sentinel ends up in `payload.pullquote`.
- Existing rollup tests update their stub deps to include `pullQuoteGenerator: async () => STUB_PULLQUOTE` (or move the stub into a test helper).

### 6.4 No new API tests required

`apps/api/src/__tests__/api-reports.test.ts` already covers the `dashboard-reports.ts` route shape (mocked Prisma stores). The added wiring (env-var read, LLM client construction) is small enough to verify by typecheck + a manual staging smoke test against the acceptance criterion.

## 7. Acceptance

In staging with `NEXT_PUBLIC_REPORTS_LIVE=true` and `ANTHROPIC_API_KEY` set:

1. Loading `/reports` for an org produces a pull-quote whose `pre`, `mid`, `post` are LLM-generated (visibly different from the deterministic template's exact text).
2. Reloading `/reports` within 1h returns the identical pull-quote (proves `ReportCache` hit and the LLM is not re-called).
3. Temporarily setting `ANTHROPIC_API_KEY=""` in staging and clearing the cache row produces a pull-quote that exactly matches the deterministic template; `pnpm` API logs show one `console.warn` per render attempt referencing the missing client / fallback path. (Run-once verification — restore the key after.)

## 8. Risks & open notes

- **Prompt drift across model versions.** Mitigated by validation: any output that doesn't match the Zod schema falls back to the template. If Haiku 4.5 → Haiku 5.x changes the prose register, the fallback hides it gracefully and we can iterate the prompt without an outage.
- **Length blowout on long period labels.** "Last 90 days through 2026-04-30" is fine; pathological input would make `pre` grow. Slot length is enforced (`≤ 80 chars`) in validation, and the template trims its prose to be safe.
- **Cost.** Haiku at ~50–100 output tokens per call, capped at one call per `(orgId, window)` per hour. Even at thousands of orgs the bill is negligible compared to chat traffic.
- **Latency.** Adds ~300–700ms to the first render after a cache miss. Acceptable: report renders are explicit user actions ("View reports") not background polls, and subsequent reloads inside the hour are fast.

---

## Appendix A — Branch / PR plan

- **This spec PR**: `docs/reports-pr-r5-spec` → `main`. Adds the spec file only.
- **Implementation PR**: `feat/reports-backend-v1-r5` → `main`, branched off whichever of `main` / PR #373 is current at the time. Adds the four new files and modifies `period-rollup.ts`, `interfaces.ts`, `index.ts`, `dashboard-reports.ts`.
- **PR-R6** (PDF export + cutover) is the next PR after this one and is **out of scope here**.
