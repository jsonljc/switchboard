# Reports backend v1 — PR-R5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `STUB_PULLQUOTE` in `period-rollup.ts` with an LLM-generated pull-quote (Anthropic Haiku 4.5) that writes only the three prose connectors; numbers stay deterministic and the existing `ReportCache` provides 1h reload-stability for free.

**Architecture:** New `pull-quote-generator.ts` factory + new `prompts/pull-quote-prompt.ts` module in `packages/core/src/reports/`. Implements the locked `PullQuoteGenerator` type (already in `interfaces.ts` from PR-R1). `LLMClient` is a one-method interface; the Anthropic-backed implementation is co-located in `pull-quote-generator.ts`. On any LLM error / JSON parse failure / Zod schema failure / content-guard rejection → falls back to a period-aware deterministic template with `console.warn`. Missing `ANTHROPIC_API_KEY` falls back **silently** (expected unconfigured state).

**Tech Stack:** TypeScript, Zod (schema validation), `@anthropic-ai/sdk` (already in `packages/core`), Vitest.

**Spec:** [`docs/superpowers/specs/2026-05-06-reports-pr-r5-design.md`](../specs/2026-05-06-reports-pr-r5-design.md).

**Worktree branch (for impl session):** `feat/reports-backend-v1-r5`, branched off `origin/main` (or off PR #373 if still open at execution time).

**Worktree setup:** After `git worktree add ../switchboard-r5 feat/reports-backend-v1-r5`, run `pnpm worktree:init` from the new worktree root (per `CLAUDE.md` Branch & Worktree Doctrine) — copies `.env`, kills stale dev-port listeners, runs `pnpm db:migrate`.

---

## File Structure

**Create:**

- `packages/core/src/reports/prompts/pull-quote-prompt.ts` — `PULL_QUOTE_SYSTEM_PROMPT` constant + `buildUserPrompt(facts)` function
- `packages/core/src/reports/prompts/pull-quote-prompt.test.ts` — prompt-builder unit tests
- `packages/core/src/reports/pull-quote-generator.ts` — generator factory + `windowToLabel` helper + deterministic template + Anthropic-backed `LLMClient` constructor + Zod schema for LLM output
- `packages/core/src/reports/pull-quote-generator.test.ts` — 7 generator cases + SDK prefill round-trip guard

**Modify:**

- `packages/core/src/reports/interfaces.ts` — add `LLMClient` interface; add `pullQuoteGenerator` field to `ReportDependencies` (note: `ReportDependencies` lives in `period-rollup.ts`, not `interfaces.ts`)
- `packages/core/src/reports/period-rollup.ts` — accept `pullQuoteGenerator` dep, call it after section rollups, replace `STUB_PULLQUOTE` constant
- `packages/core/src/reports/period-rollup.test.ts` — add `pullQuoteGenerator` to `makeDeps()`; new test asserting generator invoked with right inputs and result lands in `payload.pullquote`
- `packages/core/src/reports/index.ts` — export `createPullQuoteGenerator`, `createAnthropicReportLLMClient`, type `LLMClient`
- `apps/api/src/routes/dashboard-reports.ts` — read `ANTHROPIC_API_KEY`, build `LLMClient` (or `null`), build `pullQuoteGenerator`, pass through `ReportDependencies`

---

## Task 1: Add `LLMClient` interface to `interfaces.ts`

**Files:**

- Modify: `packages/core/src/reports/interfaces.ts`

- [ ] **Step 1: Verify the locked `PullQuoteGenerator` signature is unchanged**

Run: `grep -n "PullQuoteGenerator" packages/core/src/reports/interfaces.ts`

Expected output should include:

```
export type PullQuoteGenerator = (input: {
  ctx: RollupContext;
  attribution: ReportDataV1["attribution"];
  cost: ReportDataV1["cost"];
  funnelNarrative: ReportDataV1["funnelNarrative"];
}) => Promise<ReportDataV1["pullquote"]>;
```

If it doesn't match, stop and reconcile against the spec — this PR depends on that signature.

- [ ] **Step 2: Add `LLMClient` interface to `interfaces.ts`**

Append the following to the end of `packages/core/src/reports/interfaces.ts` (after the existing `PeriodRollup` type):

```ts
// ---------------------------------------------------------------------------
// LLM client surface (used by pull-quote-generator only)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for a one-shot LLM completion. Implemented in PR-R5 by
 * `createAnthropicReportLLMClient` (Anthropic SDK wrapper). Tests pass mocks.
 *
 * The implementation is responsible for any prefill-handling: callers can
 * assume the returned string is parseable JSON when the prompt asks for JSON.
 */
export interface LLMClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
```

- [ ] **Step 3: Run typecheck to verify the interface compiles**

Run: `pnpm --filter @switchboard/core typecheck`

Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/reports/interfaces.ts
git commit -m "feat(reports): add LLMClient interface for pull-quote generator (pr-r5)"
```

---

## Task 2: Build the prompt module — happy path test first

**Files:**

- Create: `packages/core/src/reports/prompts/pull-quote-prompt.ts`
- Test: `packages/core/src/reports/prompts/pull-quote-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/reports/prompts/pull-quote-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PULL_QUOTE_SYSTEM_PROMPT,
  buildUserPrompt,
  type PullQuoteFacts,
} from "./pull-quote-prompt.js";

describe("PULL_QUOTE_SYSTEM_PROMPT", () => {
  it("instructs the model to output JSON with exactly pre/mid/post keys", () => {
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/JSON/);
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/"pre"/);
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/"mid"/);
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/"post"/);
  });

  it("forbids the model from emitting digits, currency symbols, or metric names", () => {
    expect(PULL_QUOTE_SYSTEM_PROMPT.toLowerCase()).toMatch(
      /no.*(digits|numbers)|do not.*(digits|numbers)/,
    );
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/\$/);
    expect(PULL_QUOTE_SYSTEM_PROMPT.toLowerCase()).toMatch(/roas|cpc|metric/);
  });
});

describe("buildUserPrompt", () => {
  const FACTS: PullQuoteFacts = {
    periodLabel: "this month",
    revenueUsd: 18432.5,
    costUsd: 499,
    savingsUsd: 7501,
  };

  it("includes the period label verbatim", () => {
    expect(buildUserPrompt(FACTS)).toContain("this month");
  });

  it("includes the formatted revenue, cost, and savings as USD strings", () => {
    const prompt = buildUserPrompt(FACTS);
    expect(prompt).toContain("$18,433"); // formatCurrencyUSD rounds >=1000
    expect(prompt).toContain("$499");
    expect(prompt).toContain("$7,501");
  });

  it("does not throw on zero values", () => {
    expect(() =>
      buildUserPrompt({ periodLabel: "this week", revenueUsd: 0, costUsd: 0, savingsUsd: 0 }),
    ).not.toThrow();
  });

  it("does not throw on negative savings", () => {
    expect(() =>
      buildUserPrompt({
        periodLabel: "this quarter",
        revenueUsd: 100,
        costUsd: 999,
        savingsUsd: -200,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- pull-quote-prompt.test.ts`

Expected: FAIL with `Cannot find module './pull-quote-prompt.js'` or similar.

- [ ] **Step 3: Implement `pull-quote-prompt.ts`**

Create `packages/core/src/reports/prompts/pull-quote-prompt.ts`:

```ts
import { formatCurrencyUSD } from "../period-helpers.js";

/**
 * Internal type — the narrow fact set the LLM actually needs.
 * Built by pull-quote-generator from the rich PullQuoteGenerator input.
 */
export interface PullQuoteFacts {
  periodLabel: string; // lowercase, e.g. "this month"
  revenueUsd: number;
  costUsd: number;
  savingsUsd: number;
}

export const PULL_QUOTE_SYSTEM_PROMPT = `You write the prose connectors for a one-sentence pull-quote on a B2B revenue report.

The full sentence has five slots: { pre, value, mid, cost, post }. The "value" and "cost" slots
are filled with formatted dollar numbers by deterministic code — you DO NOT write those.

Your job: write three short prose connectors — pre, mid, post — that read as natural English
when concatenated as: "<pre> <value> <mid> <cost> <post>".

Constraints:
- Output a single JSON object with exactly these three keys: "pre", "mid", "post".
- Each value must be a non-empty string, ≤ 80 characters.
- Voice: operator deep-dive register — concise, fact-led, third-person describing the customer's team.
- Do NOT include any digits (0-9), the dollar sign ($), the percent sign (%), or any metric names
  (ROAS, CPC, CTR, CAC, CPA, ROI). All numbers belong to the deterministic value/cost slots.
- Do NOT make claims you cannot verify from the inputs. Do NOT invent stats.

Example shape (illustrative — your wording will differ based on the period):
{"pre": "This month, your team converted leads", "mid": "in revenue against a Switchboard fee of", "post": "well below traditional staffing costs."}`;

export function buildUserPrompt(facts: PullQuoteFacts): string {
  const revenue = formatCurrencyUSD(facts.revenueUsd);
  const cost = formatCurrencyUSD(facts.costUsd);
  const savings = formatCurrencyUSD(facts.savingsUsd);
  return `Period: ${facts.periodLabel}
Revenue this period: ${revenue}
Switchboard cost this period: ${cost}
Estimated savings vs traditional stack: ${savings}

Write the JSON object now.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- pull-quote-prompt.test.ts`

Expected: PASS, 6 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/prompts/pull-quote-prompt.ts packages/core/src/reports/prompts/pull-quote-prompt.test.ts
git commit -m "feat(reports): pull-quote system prompt + buildUserPrompt (pr-r5)"
```

---

## Task 3: Deterministic template + `windowToLabel` helper (null-client path)

**Files:**

- Create: `packages/core/src/reports/pull-quote-generator.ts`
- Test: `packages/core/src/reports/pull-quote-generator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reports/pull-quote-generator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPullQuoteGenerator } from "./pull-quote-generator.js";
import type { LLMClient } from "./interfaces.js";
import type { ReportDataV1 } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";

const STUB_ATTRIBUTION: ReportDataV1["attribution"] = {
  total: 18432.5,
  delta: { kind: "absolute", value: 1200, direction: "up" },
  riley: { value: 12000, caption: "" },
  alex: { value: 6432.5, caption: "" },
};

const STUB_COST: ReportDataV1["cost"] = {
  paid: 499,
  alt: 8000,
  saving: 7501,
};

const STUB_FUNNEL_NARRATIVE: ReportDataV1["funnelNarrative"] = {
  marker: "",
  text: "",
};

function makeCtx(
  window: "THIS WEEK" | "THIS MONTH" | "THIS QUARTER" = "THIS MONTH",
): RollupContext {
  return {
    orgId: "org-1",
    current: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window,
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  };
}

function makeInput(window: "THIS WEEK" | "THIS MONTH" | "THIS QUARTER" = "THIS MONTH") {
  return {
    ctx: makeCtx(window),
    attribution: STUB_ATTRIBUTION,
    cost: STUB_COST,
    funnelNarrative: STUB_FUNNEL_NARRATIVE,
  };
}

describe("createPullQuoteGenerator — null client path", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the deterministic template when llm is null", async () => {
    const generator = createPullQuoteGenerator({ llm: null });
    const result = await generator(makeInput("THIS MONTH"));

    expect(result).toEqual({
      pre: "This month, your team generated",
      value: "$18,433",
      mid: "in revenue, with Switchboard costing",
      cost: "$499",
      post: "versus a traditional stack.",
    });
  });

  it("does NOT warn when llm is null (expected unconfigured state)", async () => {
    const generator = createPullQuoteGenerator({ llm: null });
    await generator(makeInput());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("uses the right period label for each window value", async () => {
    const generator = createPullQuoteGenerator({ llm: null });

    const week = await generator(makeInput("THIS WEEK"));
    const month = await generator(makeInput("THIS MONTH"));
    const quarter = await generator(makeInput("THIS QUARTER"));

    expect(week.pre).toBe("This week, your team generated");
    expect(month.pre).toBe("This month, your team generated");
    expect(quarter.pre).toBe("This quarter, your team generated");
  });

  it("template output is deterministic (idempotent)", async () => {
    const generator = createPullQuoteGenerator({ llm: null });
    const a = await generator(makeInput());
    const b = await generator(makeInput());
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: FAIL with `Cannot find module './pull-quote-generator.js'`.

- [ ] **Step 3: Implement minimal `pull-quote-generator.ts`**

Create `packages/core/src/reports/pull-quote-generator.ts`:

```ts
import type { ReportDataV1, ReportWindow } from "@switchboard/schemas";
import type { LLMClient, PullQuoteGenerator } from "./interfaces.js";
import type { RollupContext } from "./types.js";
import { formatCurrencyUSD } from "./period-helpers.js";
import type { PullQuoteFacts } from "./prompts/pull-quote-prompt.js";

function windowToLabel(window: ReportWindow): string {
  switch (window) {
    case "THIS WEEK":
      return "this week";
    case "THIS MONTH":
      return "this month";
    case "THIS QUARTER":
      return "this quarter";
  }
}

function buildFacts(input: {
  ctx: RollupContext;
  attribution: ReportDataV1["attribution"];
  cost: ReportDataV1["cost"];
}): PullQuoteFacts {
  if (!input.ctx.current.window) {
    // PullQuoteGenerator is only invoked from period-rollup, which already throws on null window.
    // This branch is defensive only.
    throw new Error("pull-quote-generator: ctx.current.window is required");
  }
  return {
    periodLabel: windowToLabel(input.ctx.current.window),
    revenueUsd: input.attribution.total,
    costUsd: input.cost.paid,
    savingsUsd: input.cost.saving,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildTemplate(
  facts: PullQuoteFacts,
  value: string,
  cost: string,
): ReportDataV1["pullquote"] {
  return {
    pre: `${capitalize(facts.periodLabel)}, your team generated`,
    value,
    mid: "in revenue, with Switchboard costing",
    cost,
    post: "versus a traditional stack.",
  };
}

export function createPullQuoteGenerator(deps: { llm: LLMClient | null }): PullQuoteGenerator {
  return async (input) => {
    const facts = buildFacts(input);
    const value = formatCurrencyUSD(facts.revenueUsd);
    const cost = formatCurrencyUSD(facts.costUsd);

    if (deps.llm == null) {
      return buildTemplate(facts, value, cost);
    }

    // LLM path is added in subsequent tasks. For now, fall through to template.
    return buildTemplate(facts, value, cost);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: PASS, 4 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/pull-quote-generator.ts packages/core/src/reports/pull-quote-generator.test.ts
git commit -m "feat(reports): pull-quote generator — null client + deterministic template (pr-r5)"
```

---

## Task 4: LLM happy path

**Files:**

- Modify: `packages/core/src/reports/pull-quote-generator.ts`
- Modify: `packages/core/src/reports/pull-quote-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `pull-quote-generator.test.ts`:

```ts
function makeMockLLM(reply: string): LLMClient {
  return { complete: vi.fn(async () => reply) };
}

function makeRejectingLLM(error: Error): LLMClient {
  return {
    complete: vi.fn(async () => {
      throw error;
    }),
  };
}

describe("createPullQuoteGenerator — LLM happy path", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns LLM-written prose connectors merged with deterministic value/cost", async () => {
    const llm = makeMockLLM(
      '{"pre": "In April, the team converted leads", "mid": "in revenue against a Switchboard fee of", "post": "well below traditional staffing costs."}',
    );

    const generator = createPullQuoteGenerator({ llm });
    const result = await generator(makeInput());

    expect(result).toEqual({
      pre: "In April, the team converted leads",
      value: "$18,433",
      mid: "in revenue against a Switchboard fee of",
      cost: "$499",
      post: "well below traditional staffing costs.",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("calls LLMClient.complete with the system prompt and a user prompt containing the period label", async () => {
    const completeSpy = vi.fn(async () => '{"pre": "ok pre", "mid": "ok mid", "post": "ok post."}');
    const generator = createPullQuoteGenerator({ llm: { complete: completeSpy } });

    await generator(makeInput("THIS QUARTER"));

    expect(completeSpy).toHaveBeenCalledTimes(1);
    const [system, user] = completeSpy.mock.calls[0]!;
    expect(system).toMatch(/JSON/);
    expect(user).toContain("this quarter");
    expect(user).toContain("$18,433");
    expect(user).toContain("$499");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: FAIL — first test fails because the implementation still falls through to template; second test fails because `complete` is never called.

- [ ] **Step 3: Implement the LLM happy path**

Replace the body of `createPullQuoteGenerator` in `pull-quote-generator.ts`. Add Zod imports and schema at the top of the file (after the existing imports):

```ts
import { z } from "zod";
import { PULL_QUOTE_SYSTEM_PROMPT, buildUserPrompt } from "./prompts/pull-quote-prompt.js";

const LLMOutputSchema = z.object({
  pre: z.string().min(1).max(80),
  mid: z.string().min(1).max(80),
  post: z.string().min(1).max(80),
});
```

Then replace the `createPullQuoteGenerator` function body with:

```ts
export function createPullQuoteGenerator(deps: { llm: LLMClient | null }): PullQuoteGenerator {
  return async (input) => {
    const facts = buildFacts(input);
    const value = formatCurrencyUSD(facts.revenueUsd);
    const cost = formatCurrencyUSD(facts.costUsd);

    if (deps.llm == null) {
      return buildTemplate(facts, value, cost);
    }

    const raw = await deps.llm.complete(PULL_QUOTE_SYSTEM_PROMPT, buildUserPrompt(facts));
    const parsed = JSON.parse(raw.trim());
    const validated = LLMOutputSchema.parse(parsed);

    return {
      pre: validated.pre,
      value,
      mid: validated.mid,
      cost,
      post: validated.post,
    };
  };
}
```

- [ ] **Step 4: Run tests to verify happy-path tests pass**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: 6 PASS (4 prior + 2 new). The implementation will throw on bad LLM output — that's intentional; Task 5 wraps it in a try/catch.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/pull-quote-generator.ts packages/core/src/reports/pull-quote-generator.test.ts
git commit -m "feat(reports): pull-quote LLM happy path with zod validation (pr-r5)"
```

---

## Task 5: Error / parse / schema fallback paths

**Files:**

- Modify: `packages/core/src/reports/pull-quote-generator.ts`
- Modify: `packages/core/src/reports/pull-quote-generator.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `pull-quote-generator.test.ts`:

```ts
describe("createPullQuoteGenerator — fallback paths", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("falls back to template + warns when the LLM throws", async () => {
    const llm = makeRejectingLLM(new Error("network down"));
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month, your team generated");
    expect(result.value).toBe("$18,433");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: "llm-error",
      periodLabel: "this month",
    });
  });

  it("falls back to template + warns when the LLM returns malformed JSON", async () => {
    const llm = makeMockLLM("not json at all");
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month, your team generated");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: "parse-failure",
      periodLabel: "this month",
    });
  });

  it("falls back to template + warns when JSON is valid but missing required fields", async () => {
    const llm = makeMockLLM('{"pre": "x"}');
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month, your team generated");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: "schema-failure",
      periodLabel: "this month",
    });
  });

  it("falls back to template + warns when a slot exceeds the 80-char limit", async () => {
    const longString = "a".repeat(81);
    const llm = makeMockLLM(`{"pre": "${longString}", "mid": "ok mid", "post": "ok post."}`);
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month, your team generated");
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({ kind: "schema-failure" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: 4 new tests FAIL because the current implementation throws (no try/catch).

- [ ] **Step 3: Wrap the LLM path in error handling**

Replace the `createPullQuoteGenerator` body in `pull-quote-generator.ts` with:

```ts
type FailureKind = "llm-error" | "parse-failure" | "schema-failure";

function warnFallback(kind: FailureKind, periodLabel: string): void {
  console.warn({ kind, periodLabel });
}

export function createPullQuoteGenerator(deps: { llm: LLMClient | null }): PullQuoteGenerator {
  return async (input) => {
    const facts = buildFacts(input);
    const value = formatCurrencyUSD(facts.revenueUsd);
    const cost = formatCurrencyUSD(facts.costUsd);
    const template = buildTemplate(facts, value, cost);

    if (deps.llm == null) {
      return template;
    }

    let raw: string;
    try {
      raw = await deps.llm.complete(PULL_QUOTE_SYSTEM_PROMPT, buildUserPrompt(facts));
    } catch {
      warnFallback("llm-error", facts.periodLabel);
      return template;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      warnFallback("parse-failure", facts.periodLabel);
      return template;
    }

    const validated = LLMOutputSchema.safeParse(parsed);
    if (!validated.success) {
      warnFallback("schema-failure", facts.periodLabel);
      return template;
    }

    return {
      pre: validated.data.pre,
      value,
      mid: validated.data.mid,
      cost,
      post: validated.data.post,
    };
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: 10 PASS (6 prior + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/pull-quote-generator.ts packages/core/src/reports/pull-quote-generator.test.ts
git commit -m "feat(reports): pull-quote fallback on llm/parse/schema failure (pr-r5)"
```

---

## Task 6: Content guard (digits / currency / metric tokens)

**Files:**

- Modify: `packages/core/src/reports/pull-quote-generator.ts`
- Modify: `packages/core/src/reports/pull-quote-generator.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `pull-quote-generator.test.ts`:

```ts
describe("createPullQuoteGenerator — content guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const TRIGGERS: Array<{ name: string; mid: string }> = [
    { name: "ascii digit", mid: "in revenue with ROAS up 23 points" },
    { name: "dollar sign", mid: "in revenue, well above $0 baselines" },
    { name: "percent sign", mid: "in revenue, with 5% gain quarter-over-quarter" },
    { name: "metric token roas", mid: "in revenue with strong ROAS performance" },
    { name: "metric token cpc", mid: "in revenue with healthy cpc levels" },
    { name: "metric token roi", mid: "in revenue with above-average roi outcomes" },
  ];

  for (const { name, mid } of TRIGGERS) {
    it(`rejects LLM output containing ${name} and falls back to template`, async () => {
      const llm = makeMockLLM(
        `{"pre": "This month the team closed", "mid": "${mid}", "post": "vs a traditional stack."}`,
      );
      const generator = createPullQuoteGenerator({ llm });

      const result = await generator(makeInput());

      expect(result.pre).toBe("This month, your team generated");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
        kind: "content-guard",
        periodLabel: "this month",
      });
    });
  }

  it("accepts clean prose (no digits, no currency, no metrics)", async () => {
    const llm = makeMockLLM(
      '{"pre": "This month the team turned conversations", "mid": "into revenue, against a Switchboard fee of", "post": "well below conventional staffing costs."}',
    );
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month the team turned conversations");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: the 6 trigger cases FAIL (current code accepts them); the clean-prose case PASSES.

- [ ] **Step 3: Add the content guard**

Add the guard helper and update the `FailureKind` union in `pull-quote-generator.ts`:

```ts
type FailureKind = "llm-error" | "parse-failure" | "schema-failure" | "content-guard";

const CONTENT_GUARD = /[\$0-9%]|roas|cpc|ctr|cac|cpa|roi/i;

function violatesContentGuard(slots: { pre: string; mid: string; post: string }): boolean {
  return (
    CONTENT_GUARD.test(slots.pre) || CONTENT_GUARD.test(slots.mid) || CONTENT_GUARD.test(slots.post)
  );
}
```

Insert the guard check between `validated.success` and the success return inside `createPullQuoteGenerator`:

```ts
if (!validated.success) {
  warnFallback("schema-failure", facts.periodLabel);
  return template;
}

if (violatesContentGuard(validated.data)) {
  warnFallback("content-guard", facts.periodLabel);
  return template;
}

return {
  pre: validated.data.pre,
  value,
  mid: validated.data.mid,
  cost,
  post: validated.data.post,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: 17 PASS (10 prior + 6 trigger + 1 clean-prose).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/pull-quote-generator.ts packages/core/src/reports/pull-quote-generator.test.ts
git commit -m "feat(reports): pull-quote content guard rejects digits/currency/metrics (pr-r5)"
```

---

## Task 7: Anthropic-backed `LLMClient` constructor + SDK prefill round-trip guard

**Files:**

- Modify: `packages/core/src/reports/pull-quote-generator.ts`
- Modify: `packages/core/src/reports/pull-quote-generator.test.ts`

- [ ] **Step 1: Write the failing test**

The Anthropic SDK sets `messages` per-instance (not on the prototype), so we can't reliably monkey-patch it. Instead we factor the SDK constructor through an injectable parameter — clean test seam, no real network. Add this to the imports at the top of `pull-quote-generator.test.ts`:

```ts
import { createAnthropicReportLLMClient } from "./pull-quote-generator.js";
```

Then append at the bottom:

```ts
describe("createAnthropicReportLLMClient", () => {
  it("re-prepends the prefilled '{' so the returned string starts with '{'", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: '"pre": "In April, the team converted leads", "mid": "in revenue against a fee of", "post": "well below traditional costs."}',
        },
      ],
    });
    const FakeAnthropic = vi.fn().mockImplementation(() => ({
      messages: { create },
    }));

    const client = createAnthropicReportLLMClient("test-key", {
      AnthropicCtor: FakeAnthropic as unknown as typeof import("@anthropic-ai/sdk").default,
    });
    const out = await client.complete("system here", "user here");

    expect(out.startsWith("{")).toBe(true);
    expect(FakeAnthropic).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0]?.[0];
    expect(call?.system).toBe("system here");
    expect(call?.model).toBe("claude-haiku-4-5-20251001");
    expect(call?.messages).toEqual([
      { role: "user", content: "user here" },
      { role: "assistant", content: "{" },
    ]);
  });

  it("uses the real Anthropic constructor by default", () => {
    // Smoke check — constructing the client with a real SDK constructor must not throw.
    // We do not invoke .complete() (would hit the network); we only verify wiring.
    const client = createAnthropicReportLLMClient("test-key");
    expect(typeof client.complete).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: FAIL — `createAnthropicReportLLMClient` is not exported yet.

- [ ] **Step 3: Implement `createAnthropicReportLLMClient`**

Add the import at the top of `pull-quote-generator.ts` (with the other imports):

```ts
import Anthropic from "@anthropic-ai/sdk";
```

Append the constants and the factory at the bottom of `pull-quote-generator.ts`:

```ts
const REPORT_LLM_MODEL = "claude-haiku-4-5-20251001";
const REPORT_LLM_MAX_TOKENS = 256;
const REPORT_LLM_TEMPERATURE = 0.4;

export function createAnthropicReportLLMClient(
  apiKey: string,
  options?: { AnthropicCtor?: typeof Anthropic },
): LLMClient {
  const Ctor = options?.AnthropicCtor ?? Anthropic;
  const client = new Ctor({ apiKey });
  return {
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await client.messages.create({
        model: REPORT_LLM_MODEL,
        max_tokens: REPORT_LLM_MAX_TOKENS,
        temperature: REPORT_LLM_TEMPERATURE,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt },
          { role: "assistant", content: "{" },
        ],
      });
      const block = response.content[0];
      const text = block && block.type === "text" ? block.text : "";
      // Re-prepend the prefilled '{' since the SDK strips it from the response.
      return `{${text}`;
    },
  };
}
```

The optional `AnthropicCtor` parameter exists purely as a test seam. Production callers omit it and get the real SDK; the unit test in Step 1 passes a fake.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- pull-quote-generator.test.ts`

Expected: 19 PASS (17 prior + 2 SDK constructor cases).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/pull-quote-generator.ts packages/core/src/reports/pull-quote-generator.test.ts
git commit -m "feat(reports): anthropic-backed LLMClient with prefill round-trip guard (pr-r5)"
```

---

## Task 8: Wire `pullQuoteGenerator` into `period-rollup.ts`

**Files:**

- Modify: `packages/core/src/reports/period-rollup.ts`
- Modify: `packages/core/src/reports/period-rollup.test.ts`

- [ ] **Step 1: Write the failing tests**

Edit `packages/core/src/reports/period-rollup.test.ts`. First update `makeDeps` to include a default stub generator, then add new tests at the bottom of the existing `describe`.

Find this block:

```ts
function makeDeps(overrides?: Partial<ReportDependencies>): ReportDependencies {
  return {
    stores: stubStores(),
    insightsProvider: stubProvider(),
    reportCache: createInMemoryReportCacheStore(),
    baselineStore: createInMemoryBaselineStore(),
    planMonthlyUSD: 299,
    ...overrides,
  };
}
```

Replace with:

```ts
function makeDeps(overrides?: Partial<ReportDependencies>): ReportDependencies {
  const defaultPullQuote: ReportDependencies["pullQuoteGenerator"] = async () => ({
    pre: "Stub pre",
    value: "$0",
    mid: "stub mid",
    cost: "$0",
    post: "stub post.",
  });
  return {
    stores: stubStores(),
    insightsProvider: stubProvider(),
    reportCache: createInMemoryReportCacheStore(),
    baselineStore: createInMemoryBaselineStore(),
    planMonthlyUSD: 299,
    pullQuoteGenerator: defaultPullQuote,
    ...overrides,
  };
}
```

Then add inside the existing `describe("createPeriodRollup", ...)` block:

```ts
it("invokes pullQuoteGenerator with ctx, attribution, cost, and funnelNarrative; result lands in payload.pullquote", async () => {
  const captured: Array<unknown> = [];
  const sentinel = {
    pre: "sentinel pre",
    value: "$5,000",
    mid: "sentinel mid",
    cost: "$299",
    post: "sentinel post.",
  };
  const pullQuoteGenerator: ReportDependencies["pullQuoteGenerator"] = async (input) => {
    captured.push(input);
    return sentinel;
  };

  const rollup = createPeriodRollup(makeDeps({ pullQuoteGenerator }));

  const result = await rollup({
    orgId: "org-1",
    current: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window: "THIS MONTH",
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  });

  expect(captured).toHaveLength(1);
  const input = captured[0] as {
    ctx: { orgId: string; current: { window: string } };
    attribution: { total: number };
    cost: { paid: number };
    funnelNarrative: { text: string };
  };
  expect(input.ctx.orgId).toBe("org-1");
  expect(input.ctx.current.window).toBe("THIS MONTH");
  expect(input.attribution.total).toBe(5000);
  expect(input.cost.paid).toBeGreaterThan(0);
  expect(input.funnelNarrative).toBeDefined();

  expect(result.pullquote).toEqual(sentinel);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @switchboard/core test -- period-rollup.test.ts`

Expected: FAIL — `pullQuoteGenerator` is not yet a field on `ReportDependencies`; or the existing tests fail because `makeDeps` references a nonexistent field. Either way, both the type error and the assertion error are intentional.

- [ ] **Step 3: Add `pullQuoteGenerator` to `ReportDependencies` and call it from the rollup**

Edit `packages/core/src/reports/period-rollup.ts`. Add to imports near the top:

```ts
import type { PullQuoteGenerator } from "./interfaces.js";
```

Update the `ReportDependencies` interface (currently exported from this file):

```ts
export interface ReportDependencies {
  stores: ReportStores;
  insightsProvider: ReportInsightsProvider | null;
  reportCache: ReportCacheStore;
  baselineStore: BaselineStore;
  planMonthlyUSD: number;
  pullQuoteGenerator: PullQuoteGenerator;
}
```

Delete the `STUB_PULLQUOTE` constant (it is no longer referenced).

Replace the body of the returned async function. Find this block:

```ts
const [attribution, funnelResult, costResult, campaigns, managedComparison] = await Promise.all([
  computeAttribution(ctx, deps.stores),
  computeFunnel(ctx, deps.stores, deps.insightsProvider),
  computeCostVsValue(ctx, deps.planMonthlyUSD),
  computeCampaignRollup(ctx, deps.insightsProvider, deps.stores.revenue),
  computeManagedComparison(ctx, deps.insightsProvider, deps.baselineStore, deps.stores),
]);

return {
  label: current.window,
  period: formatDateFolio(current),
  dateFolio: formatDateFolio(current),
  pullquote: STUB_PULLQUOTE,
  attribution,
  funnel: funnelResult.funnel,
  funnelNarrative: funnelResult.funnelNarrative,
  campaigns,
  cost: costResult.cost,
  costNarrative: costResult.costNarrative,
  managedComparison,
};
```

Replace with:

```ts
const [attribution, funnelResult, costResult, campaigns, managedComparison] = await Promise.all([
  computeAttribution(ctx, deps.stores),
  computeFunnel(ctx, deps.stores, deps.insightsProvider),
  computeCostVsValue(ctx, deps.planMonthlyUSD),
  computeCampaignRollup(ctx, deps.insightsProvider, deps.stores.revenue),
  computeManagedComparison(ctx, deps.insightsProvider, deps.baselineStore, deps.stores),
]);

const pullquote = await deps.pullQuoteGenerator({
  ctx,
  attribution,
  cost: costResult.cost,
  funnelNarrative: funnelResult.funnelNarrative,
});

return {
  label: current.window,
  period: formatDateFolio(current),
  dateFolio: formatDateFolio(current),
  pullquote,
  attribution,
  funnel: funnelResult.funnel,
  funnelNarrative: funnelResult.funnelNarrative,
  campaigns,
  cost: costResult.cost,
  costNarrative: costResult.costNarrative,
  managedComparison,
};
```

Also delete the unused `PullQuoteCopy` import at the top if the linter flags it (it may already be imported only for `STUB_PULLQUOTE`).

- [ ] **Step 4: Run all `core/reports/` tests to verify period-rollup is green**

Run: `pnpm --filter @switchboard/core test`

Expected: ALL PASS, including the new pullquote-invocation test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/period-rollup.ts packages/core/src/reports/period-rollup.test.ts
git commit -m "feat(reports): wire pullQuoteGenerator into period-rollup (pr-r5)"
```

---

## Task 9: Export new symbols from `packages/core/src/reports/index.ts`

**Files:**

- Modify: `packages/core/src/reports/index.ts`

- [ ] **Step 1: Add exports**

Append to `packages/core/src/reports/index.ts`:

```ts
export {
  createPullQuoteGenerator,
  createAnthropicReportLLMClient,
} from "./pull-quote-generator.js";
```

(`LLMClient` is already exposed via `export * from "./interfaces.js"` at the top of the file.)

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/core typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/reports/index.ts
git commit -m "feat(reports): export pull-quote generator + anthropic client from core/reports (pr-r5)"
```

---

## Task 10: Wire LLM client into `apps/api/src/routes/dashboard-reports.ts`

**Files:**

- Modify: `apps/api/src/routes/dashboard-reports.ts`

- [ ] **Step 1: Add imports**

In `apps/api/src/routes/dashboard-reports.ts`, extend the existing import from `@switchboard/core/reports` to include the new symbols. Find the existing import block:

```ts
import {
  createPeriodRollup,
  windowToRange,
  priorPeriodRange,
  createInMemoryBaselineStore,
  type ReportDependencies,
  type ReportStores,
  type ReportCacheStore,
  type BaselineStore,
} from "@switchboard/core/reports";
```

Replace with:

```ts
import {
  createPeriodRollup,
  createPullQuoteGenerator,
  createAnthropicReportLLMClient,
  windowToRange,
  priorPeriodRange,
  createInMemoryBaselineStore,
  type LLMClient,
  type ReportDependencies,
  type ReportStores,
  type ReportCacheStore,
  type BaselineStore,
} from "@switchboard/core/reports";
```

- [ ] **Step 2: Build the LLM client + generator and add to deps**

Find the function that constructs `deps: ReportDependencies` (around line 70–88 in the current file). The relevant block looks like:

```ts
const deps: ReportDependencies = {
  stores,
  insightsProvider,
  reportCache: reportCacheStore,
  baselineStore,
  planMonthlyUSD,
};
```

Replace with:

```ts
const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
const llmClient: LLMClient | null = anthropicApiKey
  ? createAnthropicReportLLMClient(anthropicApiKey)
  : null;
const pullQuoteGenerator = createPullQuoteGenerator({ llm: llmClient });

const deps: ReportDependencies = {
  stores,
  insightsProvider,
  reportCache: reportCacheStore,
  baselineStore,
  planMonthlyUSD,
  pullQuoteGenerator,
};
```

- [ ] **Step 3: Verify typecheck + existing API tests still pass**

Run: `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api test`

Expected: PASS. The existing `api-reports.test.ts` doesn't exercise the LLM path (it uses mocked Prisma stores + the rollup runs end-to-end with whatever generator is constructed). With `ANTHROPIC_API_KEY` unset in CI, the generator's null-client path returns the deterministic template — no test changes needed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/dashboard-reports.ts
git commit -m "feat(api): wire pullQuoteGenerator into dashboard-reports route (pr-r5)"
```

---

## Task 11: Final cross-package verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test + typecheck suite for all packages this PR touches**

Run: `pnpm --filter @switchboard/core --filter @switchboard/api typecheck && pnpm --filter @switchboard/core --filter @switchboard/api test`

Expected: PASS.

- [ ] **Step 2: Run lint on the changed packages**

Run: `pnpm --filter @switchboard/core --filter @switchboard/api lint`

Expected: PASS.

- [ ] **Step 3: Confirm no stale references to `STUB_PULLQUOTE`**

Run: `grep -rn "STUB_PULLQUOTE" packages/ apps/`

Expected: no matches.

- [ ] **Step 4: Manual staging acceptance check (per spec §7)**

Pre-reqs: deploy this branch to staging with `NEXT_PUBLIC_REPORTS_LIVE=true` and `ANTHROPIC_API_KEY` set.

1. Load `/reports` for a test org with non-trivial data. Confirm `pre`, `mid`, `post` are not the deterministic template strings ("Your team generated", "in revenue, with Switchboard costing", "versus a traditional stack.").
2. Reload `/reports` immediately. Confirm the pull-quote text is identical (proves `ReportCache` hit).
3. In staging only: temporarily set `ANTHROPIC_API_KEY=""`, clear the cache row for that org+window, reload `/reports`. Confirm the pull-quote matches the deterministic template exactly. Inspect API logs and confirm there is **no** `console.warn` from `pull-quote-generator` for this case (silent fallback). Restore the key and the cache afterwards.

If any acceptance check fails, do not merge — file the failure with reproduction steps and iterate.

---

## Open the PR

After Task 11 passes:

- [ ] Push the branch: `git push -u origin feat/reports-backend-v1-r5`
- [ ] Open a PR with title `feat(reports): pr-r5 — pull-quote llm generator + cache integration` and body referencing both the spec and this plan.

---

## Self-Review Notes

**Spec coverage:**

- Spec §3 row 1 (Haiku 4.5 model) → Task 7 hard-codes `claude-haiku-4-5-20251001`.
- Spec §3 row 2 (LLM writes only pre/mid/post) → Task 4 + 5 merge LLM prose with deterministic value/cost.
- Spec §3 row 3 (minimal facts) → Task 2 prompt + Task 3 `buildFacts` + `windowToLabel`.
- Spec §3 row 4 (JSON + Zod, prefill `{`) → Tasks 4, 5, 7.
- Spec §3 row 5 (failure handling: warn except null) → Tasks 3 (silent null), 5 (warn paths).
- Spec §3 row 6 (DI shape) → Task 4 + Task 8.
- Spec §3 row 7 (no new cache) → no task needed (relies on existing `ReportCache`).
- Spec §3 row 8 (prompt location) → Task 2.
- Spec §3 row 9 (voice register) → encoded in `PULL_QUOTE_SYSTEM_PROMPT` (Task 2).
- Spec §3 row 10 (deterministic template) → Task 3.
- Spec §3 row 11 (content guard) → Task 6.
- Spec §5.1 (`LLMClient`) → Task 1.
- Spec §5.2 (`PullQuoteFacts` internal, `PullQuoteGenerator` already locked) → Task 2 + 3.
- Spec §5.3 (factory + flow) → Tasks 3–6.
- Spec §5.4 (template helper) → Task 3.
- Spec §5.5 (Anthropic-backed LLMClient) → Task 7.
- Spec §6.1 (7 generator cases) → Tasks 3, 4, 5, 6 collectively cover all cases.
- Spec §6.2 (prompt builder tests) → Task 2.
- Spec §6.3 (period-rollup integration test) → Task 8.
- Spec §6.4 (no new API tests) → Task 10 verifies existing tests still pass.
- Spec §6.5 (SDK prefill round-trip guard) → Task 7.
- Spec §7 (acceptance) → Task 11.
