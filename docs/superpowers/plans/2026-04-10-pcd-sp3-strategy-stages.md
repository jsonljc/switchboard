# PCD SP3: Strategy Stages (1-3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three no-op stage stubs (trends, hooks, scripts) with real Claude-powered implementations, producing the first shippable product: Brief → creative angles, platform hooks, and ad scripts.

**Architecture:** Each stage becomes its own file under `packages/core/src/creative-pipeline/stages/`. All three use a shared `callClaude` helper that wraps the Anthropic SDK — keeping prompt construction in each stage file and LLM mechanics in one place. The dispatcher (`run-stage.ts`) delegates to stage-specific modules. Each stage receives the brief + previous stage output and returns structured data matching the existing Zod schemas from `@switchboard/schemas`.

**Tech Stack:** Anthropic SDK (`@anthropic-ai/sdk` — already a dependency of `@switchboard/core`), Zod for output validation, existing `CreativeJob` schemas

**Spec:** `docs/superpowers/specs/2026-04-08-performance-creative-director-design.md` — Sections 4.1, 4.2, 4.3

---

## File Structure

| Action | File                                                                   | Responsibility                                                              |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Create | `packages/core/src/creative-pipeline/stages/call-claude.ts`            | Shared Claude API helper — system prompt + JSON extraction + Zod validation |
| Create | `packages/core/src/creative-pipeline/stages/trend-analyzer.ts`         | Stage 1: Analyze brief → angles, audience insights, trend signals           |
| Create | `packages/core/src/creative-pipeline/stages/hook-generator.ts`         | Stage 2: Angles → platform-specific hooks scored against format rules       |
| Create | `packages/core/src/creative-pipeline/stages/script-writer.ts`          | Stage 3: Top hooks → full ad scripts with timing structure                  |
| Create | `packages/core/src/creative-pipeline/__tests__/call-claude.test.ts`    | Unit tests for Claude helper                                                |
| Create | `packages/core/src/creative-pipeline/__tests__/trend-analyzer.test.ts` | Unit tests for Stage 1                                                      |
| Create | `packages/core/src/creative-pipeline/__tests__/hook-generator.test.ts` | Unit tests for Stage 2                                                      |
| Create | `packages/core/src/creative-pipeline/__tests__/script-writer.test.ts`  | Unit tests for Stage 3                                                      |
| Modify | `packages/core/src/creative-pipeline/stages/run-stage.ts`              | Swap no-op stubs for real stage imports; accept LLM dependency              |
| Modify | `packages/core/src/creative-pipeline/creative-job-runner.ts`           | Pass API key / LLM config through to runStage                               |
| Modify | `packages/core/src/creative-pipeline/index.ts`                         | Export new stage modules                                                    |
| Modify | `apps/api/src/bootstrap/inngest.ts`                                    | Pass ANTHROPIC_API_KEY into job runner                                      |

---

## Key Design Decisions

### LLM Dependency Injection

The stages need an Anthropic API key to call Claude. Rather than reading `process.env` deep inside stage code, we inject an `LLMConfig` through the call chain:

```
inngest.ts (reads env) → createCreativeJobRunner(jobStore, llmConfig) → executeCreativePipeline → runStage(stage, input, llmConfig)
```

This keeps stages testable — tests inject a mock `callClaude` function instead of hitting a real API.

### Structured Output Strategy

Each stage uses a consistent pattern:

1. Build a detailed system prompt with output schema described in natural language
2. Send a single user message (the brief + previous outputs)
3. Extract JSON from Claude's response (handle markdown code fences)
4. Validate with the corresponding Zod schema
5. Return typed output or throw with a descriptive error

No retry logic in SP3 — Inngest handles retries at the step level (3 retries configured in SP2).

### Testing Strategy

All stage tests mock `callClaude` — no real API calls in tests. Each test verifies:

1. The system prompt contains the right instructions
2. The user message contains the brief data
3. Valid Claude responses are parsed and validated correctly
4. Invalid/malformed responses throw descriptive errors

---

### Task 1: Create Shared Claude Helper

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/call-claude.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/call-claude.test.ts`

The `callClaude` helper wraps the Anthropic SDK, sends a system+user prompt, extracts JSON from the response, and validates it against a Zod schema.

- [ ] **Step 1: Write the failing test**

````typescript
// packages/core/src/creative-pipeline/__tests__/call-claude.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { callClaude, extractJson } from "../stages/call-claude.js";
import { z } from "zod";

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn(() => ({
      messages: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

describe("extractJson", () => {
  it("extracts JSON from markdown code fence", () => {
    const text = 'Here is the result:\n```json\n{"key": "value"}\n```';
    expect(extractJson(text)).toBe('{"key": "value"}');
  });

  it("extracts raw JSON object", () => {
    const text = '{"key": "value"}';
    expect(extractJson(text)).toBe('{"key": "value"}');
  });

  it("extracts JSON object surrounded by text", () => {
    const text = 'Sure, here you go: {"key": "value"} Hope that helps!';
    expect(extractJson(text)).toBe('{"key": "value"}');
  });

  it("throws when no JSON found", () => {
    expect(() => extractJson("No JSON here")).toThrow("No JSON object found in response");
  });
});

describe("callClaude", () => {
  const TestSchema = z.object({ name: z.string(), score: z.number() });

  it("sends prompt and parses valid response", async () => {
    const { __mockCreate } = await import("@anthropic-ai/sdk");
    const mockCreate = __mockCreate as ReturnType<typeof vi.fn>;
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"name": "test", "score": 42}' }],
    });

    const result = await callClaude({
      apiKey: "test-key",
      systemPrompt: "You are a test assistant.",
      userMessage: "Do the thing.",
      schema: TestSchema,
      model: "claude-sonnet-4-5-20250514",
      maxTokens: 4096,
    });

    expect(result).toEqual({ name: "test", score: 42 });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-5-20250514",
        max_tokens: 4096,
        system: "You are a test assistant.",
        messages: [{ role: "user", content: "Do the thing." }],
      }),
    );
  });

  it("handles response wrapped in code fence", async () => {
    const { __mockCreate } = await import("@anthropic-ai/sdk");
    const mockCreate = __mockCreate as ReturnType<typeof vi.fn>;
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '```json\n{"name": "fenced", "score": 1}\n```' }],
    });

    const result = await callClaude({
      apiKey: "test-key",
      systemPrompt: "Test",
      userMessage: "Test",
      schema: TestSchema,
    });

    expect(result).toEqual({ name: "fenced", score: 1 });
  });

  it("throws on schema validation failure", async () => {
    const { __mockCreate } = await import("@anthropic-ai/sdk");
    const mockCreate = __mockCreate as ReturnType<typeof vi.fn>;
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"name": "test"}' }], // missing score
    });

    await expect(
      callClaude({
        apiKey: "test-key",
        systemPrompt: "Test",
        userMessage: "Test",
        schema: TestSchema,
      }),
    ).rejects.toThrow();
  });

  it("throws on empty response", async () => {
    const { __mockCreate } = await import("@anthropic-ai/sdk");
    const mockCreate = __mockCreate as ReturnType<typeof vi.fn>;
    mockCreate.mockResolvedValue({
      content: [],
    });

    await expect(
      callClaude({
        apiKey: "test-key",
        systemPrompt: "Test",
        userMessage: "Test",
        schema: TestSchema,
      }),
    ).rejects.toThrow("Empty response from Claude");
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/call-claude.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

````typescript
// packages/core/src/creative-pipeline/stages/call-claude.ts
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const DEFAULT_MAX_TOKENS = 4096;

export interface CallClaudeOptions<T extends z.ZodType> {
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  schema: T;
  model?: string;
  maxTokens?: number;
}

/**
 * Extract a JSON object from Claude's text response.
 * Handles: raw JSON, ```json fenced blocks, JSON embedded in prose.
 */
export function extractJson(text: string): string {
  // Try markdown code fence first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try raw JSON object (greedy match from first { to last })
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  throw new Error("No JSON object found in response");
}

/**
 * Call Claude with a system prompt and user message, parse the response
 * as JSON, and validate against a Zod schema.
 */
export async function callClaude<T extends z.ZodType>(
  options: CallClaudeOptions<T>,
): Promise<z.infer<T>> {
  const client = new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: options.systemPrompt,
    messages: [{ role: "user", content: options.userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Empty response from Claude");
  }

  const jsonStr = extractJson(textBlock.text);
  const parsed = JSON.parse(jsonStr);
  return options.schema.parse(parsed);
}
````

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/call-claude.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add shared Claude helper for creative pipeline stages"
```

---

### Task 2: Implement Stage 1 — Trend Analyzer

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/trend-analyzer.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/trend-analyzer.test.ts`

The Trend Analyzer takes a brief (product description, target audience, platforms) and produces creative angles, audience insights, and trend signals.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/creative-pipeline/__tests__/trend-analyzer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTrendAnalyzer, buildTrendPrompt } from "../stages/trend-analyzer.js";
import type { TrendAnalysisOutput } from "@switchboard/schemas";

// Mock the callClaude helper
vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

describe("buildTrendPrompt", () => {
  it("includes product description and target audience", () => {
    const { systemPrompt, userMessage } = buildTrendPrompt({
      productDescription: "AI scheduling tool for salons",
      targetAudience: "Salon owners aged 30-50",
      platforms: ["meta", "tiktok"],
    });

    expect(systemPrompt).toContain("performance creative strategist");
    expect(systemPrompt).toContain("awarenessLevel");
    expect(userMessage).toContain("AI scheduling tool for salons");
    expect(userMessage).toContain("Salon owners aged 30-50");
    expect(userMessage).toContain("meta");
    expect(userMessage).toContain("tiktok");
  });
});

describe("runTrendAnalyzer", () => {
  const mockOutput: TrendAnalysisOutput = {
    angles: [
      {
        theme: "Time savings",
        motivator: "Reduce no-shows by 60%",
        platformFit: "meta",
        rationale: "Problem-aware audience responds to quantified benefits",
      },
    ],
    audienceInsights: {
      awarenessLevel: "problem_aware",
      topDrivers: ["time savings", "reduced no-shows"],
      objections: ["cost", "learning curve"],
    },
    trendSignals: [
      { platform: "meta", trend: "Before/after transformations", relevance: "High visual impact" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude and returns validated trend analysis", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockOutput);

    const result = await runTrendAnalyzer(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "Salon owners",
        platforms: ["meta"],
      },
      "test-api-key",
    );

    expect(result.angles).toHaveLength(1);
    expect(result.angles[0].theme).toBe("Time savings");
    expect(result.audienceInsights.awarenessLevel).toBe("problem_aware");
    expect(result.trendSignals).toHaveLength(1);

    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        systemPrompt: expect.stringContaining("performance creative strategist"),
        userMessage: expect.stringContaining("AI scheduling tool"),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/trend-analyzer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/creative-pipeline/stages/trend-analyzer.ts
import { callClaude } from "./call-claude.js";
import { TrendAnalysisOutput } from "@switchboard/schemas";

interface TrendBrief {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
}

export function buildTrendPrompt(brief: TrendBrief): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = `You are an expert performance creative strategist who analyzes products, audiences, and platform trends to identify winning creative angles for paid advertising.

Your job is to analyze the provided brief and return a JSON object with exactly this structure:

{
  "angles": [
    {
      "theme": "A short creative theme name",
      "motivator": "The core audience motivator this angle taps into",
      "platformFit": "Which platform this angle works best on",
      "rationale": "Why this angle will work for this audience"
    }
  ],
  "audienceInsights": {
    "awarenessLevel": "unaware" | "problem_aware" | "solution_aware" | "product_aware" | "most_aware",
    "topDrivers": ["Top 3-5 purchase drivers"],
    "objections": ["Top 3-5 objections or hesitations"]
  },
  "trendSignals": [
    {
      "platform": "Platform name",
      "trend": "Current trend on this platform",
      "relevance": "How this trend connects to the product"
    }
  ]
}

Guidelines:
- Generate 3-5 creative angles, each tied to a different audience motivator
- Assess the audience's awareness level based on the product category
- Identify platform-specific trends that the creative can leverage
- Be specific and actionable — avoid generic advice
- Respond ONLY with the JSON object, no surrounding text`;

  const userMessage = `Analyze this brief and produce creative strategy output:

**Product:** ${brief.productDescription}

**Target Audience:** ${brief.targetAudience}

**Platforms:** ${brief.platforms.join(", ")}`;

  return { systemPrompt, userMessage };
}

export async function runTrendAnalyzer(
  brief: TrendBrief,
  apiKey: string,
): Promise<TrendAnalysisOutput> {
  const { systemPrompt, userMessage } = buildTrendPrompt(brief);

  return callClaude({
    apiKey,
    systemPrompt,
    userMessage,
    schema: TrendAnalysisOutput,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/trend-analyzer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add Stage 1 trend analyzer with Claude integration"
```

---

### Task 3: Implement Stage 2 — Hook Generator

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/hook-generator.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/hook-generator.test.ts`

The Hook Generator takes Stage 1 angles + platform selection and produces scored hooks per angle with platform-specific rules.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/creative-pipeline/__tests__/hook-generator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runHookGenerator, buildHookPrompt } from "../stages/hook-generator.js";
import type { HookGeneratorOutput, TrendAnalysisOutput } from "@switchboard/schemas";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

const mockTrendOutput: TrendAnalysisOutput = {
  angles: [
    {
      theme: "Time savings",
      motivator: "Reduce no-shows",
      platformFit: "meta",
      rationale: "Problem-aware audience",
    },
  ],
  audienceInsights: {
    awarenessLevel: "problem_aware",
    topDrivers: ["time savings"],
    objections: ["cost"],
  },
  trendSignals: [{ platform: "meta", trend: "UGC style", relevance: "High" }],
};

describe("buildHookPrompt", () => {
  it("includes platform-specific rules and angles from Stage 1", () => {
    const { systemPrompt, userMessage } = buildHookPrompt(
      { productDescription: "AI tool", targetAudience: "SMBs", platforms: ["meta", "tiktok"] },
      mockTrendOutput,
    );

    expect(systemPrompt).toContain("hook copywriter");
    expect(systemPrompt).toContain("pattern interrupt");
    expect(systemPrompt).toContain("Meta cold");
    expect(systemPrompt).toContain("TikTok");
    expect(userMessage).toContain("Time savings");
  });
});

describe("runHookGenerator", () => {
  const mockOutput: HookGeneratorOutput = {
    hooks: [
      {
        angleRef: "0",
        text: "Still losing 30% of bookings to no-shows?",
        type: "question",
        platformScore: 8,
        rationale: "Question hooks perform well for problem-aware Meta audiences",
      },
    ],
    topCombos: [{ angleRef: "0", hookRef: "0", score: 8 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude with trend output and returns validated hooks", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockOutput);

    const result = await runHookGenerator(
      { productDescription: "AI tool", targetAudience: "SMBs", platforms: ["meta"] },
      mockTrendOutput,
      "test-api-key",
    );

    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0].type).toBe("question");
    expect(result.topCombos).toHaveLength(1);

    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        systemPrompt: expect.stringContaining("hook copywriter"),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/hook-generator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/creative-pipeline/stages/hook-generator.ts
import { callClaude } from "./call-claude.js";
import { HookGeneratorOutput } from "@switchboard/schemas";
import type { TrendAnalysisOutput } from "@switchboard/schemas";

interface HookBrief {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
}

export function buildHookPrompt(
  brief: HookBrief,
  trendOutput: TrendAnalysisOutput,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are an expert performance ad hook copywriter. You generate scroll-stopping hooks for paid social ads.

Your job is to take creative angles from a trend analysis and generate 3 hook variants per angle, scored against platform-specific rules.

## Platform Rules

- **Meta cold (prospecting):** Pattern interrupt — stop the scroll. Bold claims, surprising stats, or visual disruption.
- **Meta retargeting:** Social proof — testimonials, case studies, "Join X others who..."
- **YouTube skippable:** Problem or question in first 2 seconds. No logo in first 2s. Hook must earn the watch.
- **YouTube Shorts:** Native UGC feel. Raw, authentic, first-person.
- **TikTok:** Curiosity + native feel. "I can't believe...", "POV:", trending audio hooks.

## Hook Types

- "pattern_interrupt" — Visual or verbal disruption that stops scrolling
- "question" — Opens a loop the viewer needs closed
- "bold_statement" — Controversial or surprising claim

## Output Format

Return a JSON object with exactly this structure:

{
  "hooks": [
    {
      "angleRef": "Index of the angle from the trend analysis (0-based string)",
      "text": "The hook text (first 1-3 seconds of the ad)",
      "type": "pattern_interrupt" | "question" | "bold_statement",
      "platformScore": 1-10,
      "rationale": "Why this hook works for the target platform"
    }
  ],
  "topCombos": [
    {
      "angleRef": "Index of the angle",
      "hookRef": "Index of the hook in the hooks array (0-based string)",
      "score": 1-10
    }
  ]
}

Guidelines:
- Generate 3 hooks per angle (one of each type when possible)
- Score each hook 1-10 for its target platform fit
- topCombos should rank the top 3-5 best angle+hook combinations
- Be specific to the product — no generic hooks
- Respond ONLY with the JSON object`;

  const userMessage = `Generate hooks based on this trend analysis:

**Product:** ${brief.productDescription}
**Audience:** ${brief.targetAudience}
**Platforms:** ${brief.platforms.join(", ")}

**Creative Angles from Stage 1:**
${trendOutput.angles.map((a, i) => `${i}. Theme: "${a.theme}" | Motivator: "${a.motivator}" | Platform Fit: ${a.platformFit} | Rationale: ${a.rationale}`).join("\n")}

**Audience Insights:**
- Awareness Level: ${trendOutput.audienceInsights.awarenessLevel}
- Top Drivers: ${trendOutput.audienceInsights.topDrivers.join(", ")}
- Objections: ${trendOutput.audienceInsights.objections.join(", ")}

**Trend Signals:**
${trendOutput.trendSignals.map((t) => `- ${t.platform}: ${t.trend} (${t.relevance})`).join("\n")}`;

  return { systemPrompt, userMessage };
}

export async function runHookGenerator(
  brief: HookBrief,
  trendOutput: TrendAnalysisOutput,
  apiKey: string,
): Promise<HookGeneratorOutput> {
  const { systemPrompt, userMessage } = buildHookPrompt(brief, trendOutput);

  return callClaude({
    apiKey,
    systemPrompt,
    userMessage,
    schema: HookGeneratorOutput,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/hook-generator.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add Stage 2 hook generator with platform-specific rules"
```

---

### Task 4: Implement Stage 3 — Script Writer

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/script-writer.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/script-writer.test.ts`

The Script Writer takes top hook combos + brand voice and produces full ad scripts with timing structure.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/creative-pipeline/__tests__/script-writer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScriptWriter, buildScriptPrompt } from "../stages/script-writer.js";
import type {
  ScriptWriterOutput,
  TrendAnalysisOutput,
  HookGeneratorOutput,
} from "@switchboard/schemas";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

const mockTrendOutput: TrendAnalysisOutput = {
  angles: [
    {
      theme: "Time savings",
      motivator: "Reduce no-shows",
      platformFit: "meta",
      rationale: "Problem-aware",
    },
  ],
  audienceInsights: {
    awarenessLevel: "problem_aware",
    topDrivers: ["time savings"],
    objections: ["cost"],
  },
  trendSignals: [],
};

const mockHookOutput: HookGeneratorOutput = {
  hooks: [
    {
      angleRef: "0",
      text: "Still losing bookings to no-shows?",
      type: "question",
      platformScore: 8,
      rationale: "Question hooks work well for Meta",
    },
  ],
  topCombos: [{ angleRef: "0", hookRef: "0", score: 8 }],
};

describe("buildScriptPrompt", () => {
  it("includes timing structure and hooks from Stage 2", () => {
    const { systemPrompt, userMessage } = buildScriptPrompt(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
        brandVoice: "Professional but approachable",
      },
      mockTrendOutput,
      mockHookOutput,
    );

    expect(systemPrompt).toContain("scriptwriter");
    expect(systemPrompt).toContain("hook");
    expect(systemPrompt).toContain("timing");
    expect(userMessage).toContain("Still losing bookings");
    expect(userMessage).toContain("Professional but approachable");
  });

  it("handles null brand voice", () => {
    const { userMessage } = buildScriptPrompt(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
        brandVoice: null,
      },
      mockTrendOutput,
      mockHookOutput,
    );

    expect(userMessage).not.toContain("Brand Voice:");
  });
});

describe("runScriptWriter", () => {
  const mockOutput: ScriptWriterOutput = {
    scripts: [
      {
        hookRef: "0",
        fullScript:
          "[Hook] Still losing bookings to no-shows?\n[Problem] Every empty chair costs you $50...",
        timing: [
          { section: "hook", startSec: 0, endSec: 3, content: "Still losing bookings?" },
          { section: "problem", startSec: 3, endSec: 8, content: "Every empty chair costs $50" },
          { section: "solution", startSec: 8, endSec: 18, content: "AI scheduling reduces..." },
          { section: "proof", startSec: 18, endSec: 25, content: "500+ salons trust us" },
          { section: "cta", startSec: 25, endSec: 30, content: "Try free for 14 days" },
        ],
        format: "feed_video",
        platform: "meta",
        productionNotes: "Use before/after split screen for problem section",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude with hooks and returns validated scripts", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockOutput);

    const result = await runScriptWriter(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
        brandVoice: null,
      },
      mockTrendOutput,
      mockHookOutput,
      "test-api-key",
    );

    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0].timing).toHaveLength(5);
    expect(result.scripts[0].format).toBe("feed_video");

    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        systemPrompt: expect.stringContaining("scriptwriter"),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/script-writer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/creative-pipeline/stages/script-writer.ts
import { callClaude } from "./call-claude.js";
import { ScriptWriterOutput } from "@switchboard/schemas";
import type { TrendAnalysisOutput, HookGeneratorOutput } from "@switchboard/schemas";

interface ScriptBrief {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
}

export function buildScriptPrompt(
  brief: ScriptBrief,
  trendOutput: TrendAnalysisOutput,
  hookOutput: HookGeneratorOutput,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are an expert performance ad scriptwriter. You write full ad scripts optimized for paid social platforms.

Your job is to take the top hook+angle combinations and write complete ad scripts with precise timing structure.

## Script Timing Structure (30-second format)

Every script follows this structure:
- **Hook** (0-3s): The opening hook that stops scrolling
- **Problem** (3-8s): Agitate the pain point
- **Solution** (8-18s): Present the product as the solution
- **Proof** (18-25s): Social proof, results, testimonials
- **CTA** (25-30s): Clear call to action

Adapt timing for different formats:
- **Stories/Shorts (15s):** Compress to Hook 0-2s, Problem 2-5s, Solution 5-10s, CTA 10-15s (skip proof)
- **YouTube skippable (60s):** Expand each section proportionally

## Ad Formats

- "feed_video" — Standard feed video (1:1 or 4:5), 15-30s
- "stories" — Full-screen vertical (9:16), 15s
- "skippable" — YouTube pre-roll, 15-60s
- "shorts" — YouTube Shorts / TikTok, 15-60s vertical

## Output Format

Return a JSON object with exactly this structure:

{
  "scripts": [
    {
      "hookRef": "Index of the hook used (0-based string)",
      "fullScript": "The complete script text with section markers",
      "timing": [
        { "section": "hook", "startSec": 0, "endSec": 3, "content": "Script content for this section" },
        { "section": "problem", "startSec": 3, "endSec": 8, "content": "..." },
        { "section": "solution", "startSec": 8, "endSec": 18, "content": "..." },
        { "section": "proof", "startSec": 18, "endSec": 25, "content": "..." },
        { "section": "cta", "startSec": 25, "endSec": 30, "content": "..." }
      ],
      "format": "feed_video" | "stories" | "skippable" | "shorts",
      "platform": "Platform name",
      "productionNotes": "Visual direction, filming style, or editing notes"
    }
  ]
}

Guidelines:
- Write 1 script per top combo (up to 5 scripts)
- Match format to platform (stories for Meta/TikTok, skippable for YouTube)
- Include specific production notes for each script
- Write in the brand's voice if provided, otherwise use a direct, benefit-focused tone
- Respond ONLY with the JSON object`;

  const topCombos = hookOutput.topCombos.slice(0, 5);

  const hookDetails = topCombos
    .map((combo) => {
      const hook = hookOutput.hooks[parseInt(combo.hookRef, 10)];
      const angle = trendOutput.angles[parseInt(combo.angleRef, 10)];
      return `- Hook "${hook?.text}" (type: ${hook?.type}) for angle "${angle?.theme}" | Score: ${combo.score}`;
    })
    .join("\n");

  let userMessage = `Write ad scripts for these top hook+angle combinations:

**Product:** ${brief.productDescription}
**Audience:** ${brief.targetAudience}
**Platforms:** ${brief.platforms.join(", ")}`;

  if (brief.brandVoice) {
    userMessage += `\n**Brand Voice:** ${brief.brandVoice}`;
  }

  userMessage += `

**Audience Awareness:** ${trendOutput.audienceInsights.awarenessLevel}
**Key Drivers:** ${trendOutput.audienceInsights.topDrivers.join(", ")}
**Objections to Address:** ${trendOutput.audienceInsights.objections.join(", ")}

**Top Hook+Angle Combos (write one script each):**
${hookDetails}`;

  return { systemPrompt, userMessage };
}

export async function runScriptWriter(
  brief: ScriptBrief,
  trendOutput: TrendAnalysisOutput,
  hookOutput: HookGeneratorOutput,
  apiKey: string,
): Promise<ScriptWriterOutput> {
  const { systemPrompt, userMessage } = buildScriptPrompt(brief, trendOutput, hookOutput);

  return callClaude({
    apiKey,
    systemPrompt,
    userMessage,
    schema: ScriptWriterOutput,
    maxTokens: 8192, // Scripts are longer — need more output tokens
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/__tests__/script-writer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add Stage 3 script writer with timing structure"
```

---

### Task 5: Wire Real Stages into Dispatcher

**Files:**

- Modify: `packages/core/src/creative-pipeline/stages/run-stage.ts`
- Modify: `packages/core/src/creative-pipeline/__tests__/run-stage.test.ts`

Replace the no-op stubs for stages 1-3 with real implementations. Stages 4-5 remain as no-op stubs (shipped in SP4-SP5). The `runStage` function signature changes to accept an `apiKey` parameter.

- [ ] **Step 1: Update the run-stage.ts dispatcher**

Replace the contents of `packages/core/src/creative-pipeline/stages/run-stage.ts`:

```typescript
// packages/core/src/creative-pipeline/stages/run-stage.ts
import type {
  TrendAnalysisOutput,
  HookGeneratorOutput,
  ScriptWriterOutput,
  StoryboardOutput,
  VideoProducerOutput,
} from "@switchboard/schemas";
import { runTrendAnalyzer } from "./trend-analyzer.js";
import { runHookGenerator } from "./hook-generator.js";
import { runScriptWriter } from "./script-writer.js";

export interface StageInput {
  jobId: string;
  brief: {
    productDescription: string;
    targetAudience: string;
    platforms: string[];
    brandVoice?: string | null;
  };
  previousOutputs: Record<string, unknown>;
  apiKey: string;
}

type StageOutput =
  | TrendAnalysisOutput
  | HookGeneratorOutput
  | ScriptWriterOutput
  | StoryboardOutput
  | VideoProducerOutput;

const STAGE_ORDER = ["trends", "hooks", "scripts", "storyboard", "production"] as const;
export type StageName = (typeof STAGE_ORDER)[number];

export function getNextStage(current: StageName): StageName | "complete" {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return "complete";
  return STAGE_ORDER[idx + 1] as StageName;
}

/**
 * Dispatch a pipeline stage by name.
 * Stages 1-3 use Claude. Stages 4-5 remain as no-op stubs (SP4-SP5).
 */
export async function runStage(stage: string, input: StageInput): Promise<StageOutput> {
  switch (stage) {
    case "trends":
      return runTrendAnalyzer(
        {
          productDescription: input.brief.productDescription,
          targetAudience: input.brief.targetAudience,
          platforms: input.brief.platforms,
        },
        input.apiKey,
      );

    case "hooks": {
      const trendsOutput = input.previousOutputs["trends"] as TrendAnalysisOutput;
      if (!trendsOutput) throw new Error("hooks stage requires trends output");
      return runHookGenerator(
        {
          productDescription: input.brief.productDescription,
          targetAudience: input.brief.targetAudience,
          platforms: input.brief.platforms,
        },
        trendsOutput,
        input.apiKey,
      );
    }

    case "scripts": {
      const trends = input.previousOutputs["trends"] as TrendAnalysisOutput;
      const hooks = input.previousOutputs["hooks"] as HookGeneratorOutput;
      if (!trends || !hooks) throw new Error("scripts stage requires trends and hooks output");
      return runScriptWriter(
        {
          productDescription: input.brief.productDescription,
          targetAudience: input.brief.targetAudience,
          platforms: input.brief.platforms,
          brandVoice: input.brief.brandVoice ?? null,
        },
        trends,
        hooks,
        input.apiKey,
      );
    }

    case "storyboard":
      return {
        storyboards: [
          {
            scriptRef: "0",
            scenes: [
              {
                sceneNumber: 1,
                description: "[placeholder] Scene description — SP4",
                visualDirection: "placeholder",
                duration: 3,
                textOverlay: null,
                referenceImageUrl: null,
              },
            ],
          },
        ],
      };

    case "production":
      return {
        videos: [
          {
            storyboardRef: "0",
            videoUrl: "https://placeholder.example.com/video.mp4",
            thumbnailUrl: "https://placeholder.example.com/thumb.jpg",
            format: "9:16",
            duration: 30,
            platform: "meta",
          },
        ],
        staticFallbacks: [],
      };

    default:
      throw new Error(`Unknown stage: ${stage}`);
  }
}
```

- [ ] **Step 2: Update the run-stage tests**

The existing tests mock at the stage level. For stages 1-3, they need to mock `callClaude` since the real stages call it. Update `packages/core/src/creative-pipeline/__tests__/run-stage.test.ts`:

```typescript
// packages/core/src/creative-pipeline/__tests__/run-stage.test.ts
import { describe, it, expect, vi } from "vitest";
import { runStage, getNextStage } from "../stages/run-stage.js";
import type { TrendAnalysisOutput, HookGeneratorOutput } from "@switchboard/schemas";

// Mock callClaude so stages 1-3 don't hit real API
vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

const baseBrief = {
  productDescription: "AI tool",
  targetAudience: "SMBs",
  platforms: ["meta"] as string[],
  brandVoice: null,
};

const baseInput = {
  jobId: "job_1",
  brief: baseBrief,
  previousOutputs: {} as Record<string, unknown>,
  apiKey: "test-key",
};

const mockTrendsOutput: TrendAnalysisOutput = {
  angles: [{ theme: "T", motivator: "M", platformFit: "meta", rationale: "R" }],
  audienceInsights: {
    awarenessLevel: "problem_aware",
    topDrivers: ["d"],
    objections: ["o"],
  },
  trendSignals: [{ platform: "meta", trend: "t", relevance: "r" }],
};

const mockHooksOutput: HookGeneratorOutput = {
  hooks: [{ angleRef: "0", text: "Hook", type: "question", platformScore: 8, rationale: "R" }],
  topCombos: [{ angleRef: "0", hookRef: "0", score: 8 }],
};

describe("runStage", () => {
  it("runs trends stage via Claude", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue(mockTrendsOutput);

    const result = await runStage("trends", baseInput);

    expect(result).toHaveProperty("angles");
    expect(result).toHaveProperty("audienceInsights");
    expect(result).toHaveProperty("trendSignals");
  });

  it("runs hooks stage via Claude with trends output", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue(mockHooksOutput);

    const result = await runStage("hooks", {
      ...baseInput,
      previousOutputs: { trends: mockTrendsOutput },
    });

    expect(result).toHaveProperty("hooks");
    expect(result).toHaveProperty("topCombos");
  });

  it("throws if hooks stage missing trends output", async () => {
    await expect(runStage("hooks", baseInput)).rejects.toThrow("requires trends output");
  });

  it("runs scripts stage via Claude with trends + hooks output", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
      scripts: [
        {
          hookRef: "0",
          fullScript: "Script",
          timing: [{ section: "hook", startSec: 0, endSec: 3, content: "Hook" }],
          format: "feed_video",
          platform: "meta",
          productionNotes: "Notes",
        },
      ],
    });

    const result = await runStage("scripts", {
      ...baseInput,
      previousOutputs: { trends: mockTrendsOutput, hooks: mockHooksOutput },
    });

    expect(result).toHaveProperty("scripts");
  });

  it("throws if scripts stage missing required outputs", async () => {
    await expect(runStage("scripts", baseInput)).rejects.toThrow(
      "requires trends and hooks output",
    );
  });

  it("returns placeholder for storyboard (SP4)", async () => {
    const result = await runStage("storyboard", baseInput);
    expect(result).toHaveProperty("storyboards");
  });

  it("returns placeholder for production (SP5)", async () => {
    const result = await runStage("production", baseInput);
    expect(result).toHaveProperty("videos");
    expect(result).toHaveProperty("staticFallbacks");
  });

  it("throws for unknown stage", async () => {
    await expect(runStage("unknown" as never, baseInput)).rejects.toThrow("Unknown stage: unknown");
  });
});

describe("getNextStage", () => {
  it("returns hooks after trends", () => expect(getNextStage("trends")).toBe("hooks"));
  it("returns scripts after hooks", () => expect(getNextStage("hooks")).toBe("scripts"));
  it("returns storyboard after scripts", () => expect(getNextStage("scripts")).toBe("storyboard"));
  it("returns complete after production", () =>
    expect(getNextStage("production")).toBe("complete"));
});
```

- [ ] **Step 3: Run all creative pipeline tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): wire real Claude stages 1-3 into pipeline dispatcher"
```

---

### Task 6: Thread API Key Through Job Runner

**Files:**

- Modify: `packages/core/src/creative-pipeline/creative-job-runner.ts`
- Modify: `packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`

The `executeCreativePipeline` function needs to pass `apiKey` into `runStage`. The API key comes from the environment and is injected via the Inngest bootstrap.

- [ ] **Step 1: Update creative-job-runner.ts**

Replace the full contents of `packages/core/src/creative-pipeline/creative-job-runner.ts`:

```typescript
// packages/core/src/creative-pipeline/creative-job-runner.ts
import { inngestClient } from "./inngest-client.js";
import { runStage, getNextStage } from "./stages/run-stage.js";
import type { StageName } from "./stages/run-stage.js";
import type { CreativeJob } from "@switchboard/schemas";

const STAGES: StageName[] = ["trends", "hooks", "scripts", "storyboard", "production"];

// 24-hour timeout for buyer approval between stages
const APPROVAL_TIMEOUT = "24h";

interface LLMConfig {
  apiKey: string;
}

interface JobStore {
  findById(id: string): Promise<CreativeJob | null>;
  updateStage(
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
  ): Promise<CreativeJob>;
  stop(id: string, stoppedAt: string): Promise<CreativeJob>;
}

interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string; match: string },
  ) => Promise<{ data: { action: string } } | null>;
}

interface JobEventData {
  jobId: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
}

/**
 * Core pipeline logic extracted for testability.
 * Called by the Inngest function handler with real step tools,
 * or by tests with mocked step tools.
 */
export async function executeCreativePipeline(
  eventData: JobEventData,
  step: StepTools,
  jobStore: JobStore,
  llmConfig: LLMConfig,
): Promise<void> {
  const job = await step.run("load-job", () => jobStore.findById(eventData.jobId));

  if (!job) {
    throw new Error(`Creative job not found: ${eventData.jobId}`);
  }

  let stageOutputs: Record<string, unknown> = (job.stageOutputs ?? {}) as Record<string, unknown>;

  for (const stage of STAGES) {
    // Run the stage
    const output = await step.run(`stage-${stage}`, () =>
      runStage(stage, {
        jobId: job.id,
        brief: {
          productDescription: job.productDescription,
          targetAudience: job.targetAudience,
          platforms: job.platforms,
          brandVoice: job.brandVoice,
        },
        previousOutputs: stageOutputs,
        apiKey: llmConfig.apiKey,
      }),
    );

    // Persist output
    stageOutputs = { ...stageOutputs, [stage]: output };
    const nextStage = getNextStage(stage);

    await step.run(`save-${stage}`, () => jobStore.updateStage(job.id, nextStage, stageOutputs));

    // After the last stage, no approval needed
    if (nextStage === "complete") break;

    // Wait for buyer approval before proceeding
    const approval = await step.waitForEvent(`wait-approval-${stage}`, {
      event: "creative-pipeline/stage.approved",
      timeout: APPROVAL_TIMEOUT,
      match: "data.jobId",
    });

    // Timeout or explicit stop → halt pipeline
    if (!approval || approval.data.action === "stop") {
      await step.run(`stop-at-${stage}`, () => jobStore.stop(job.id, stage));
      return;
    }
  }
}

/**
 * Inngest function definition. Wired into the serve handler in apps/api.
 * The jobStore and llmConfig dependencies are injected at registration time.
 */
export function createCreativeJobRunner(jobStore: JobStore, llmConfig: LLMConfig) {
  return inngestClient.createFunction(
    {
      id: "creative-job-runner",
      name: "Creative Pipeline Job Runner",
      retries: 3,
      triggers: [{ event: "creative-pipeline/job.submitted" }],
    },
    async ({ event, step }: { event: { data: JobEventData }; step: StepTools }) => {
      await executeCreativePipeline(event.data, step, jobStore, llmConfig);
    },
  );
}
```

- [ ] **Step 2: Update the job runner tests**

Replace the full contents of `packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts`.

**Important:** Since `executeCreativePipeline` now calls real stage implementations (which import `callClaude`), the test must mock `runStage` to avoid importing the Anthropic SDK:

```typescript
// packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCreativePipeline } from "../creative-job-runner.js";

// Mock runStage so tests don't import the real stage implementations (which need Anthropic SDK)
vi.mock("../stages/run-stage.js", async () => {
  const actual =
    await vi.importActual<typeof import("../stages/run-stage.js")>("../stages/run-stage.js");
  return {
    ...actual,
    runStage: vi.fn().mockResolvedValue({ placeholder: true }),
  };
});

function createMockStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
    waitForEvent: vi.fn(
      () => ({ data: { action: "continue" } }) as { data: { action: string } } | null,
    ),
  };
}

function createMockJobStore() {
  return {
    findById: vi.fn(),
    updateStage: vi.fn(),
    stop: vi.fn(),
  };
}

describe("executeCreativePipeline", () => {
  let step: ReturnType<typeof createMockStep>;
  let jobStore: ReturnType<typeof createMockJobStore>;
  const llmConfig = { apiKey: "test-key" };

  const jobData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  const mockJob = {
    id: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
    productDescription: "AI scheduling tool",
    targetAudience: "Small business owners",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    currentStage: "trends",
    stageOutputs: {},
    stoppedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    step = createMockStep();
    jobStore = createMockJobStore();
    jobStore.findById.mockResolvedValue(mockJob);
    jobStore.updateStage.mockImplementation((_id, stage, outputs) => ({
      ...mockJob,
      currentStage: stage,
      stageOutputs: outputs,
    }));
  });

  it("runs all 5 stages when buyer approves each", async () => {
    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

    // 1 load-job + 5 stage runs + 5 save calls = 11 step.run calls
    // + 4 waitForEvent calls (no wait after production)
    expect(step.run).toHaveBeenCalledTimes(11);
    expect(step.waitForEvent).toHaveBeenCalledTimes(4);
  });

  it("stops pipeline when buyer sends stop action", async () => {
    // Approve trends, then stop at hooks
    step.waitForEvent
      .mockResolvedValueOnce({ data: { action: "continue" } })
      .mockResolvedValueOnce({ data: { action: "stop" } });

    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

    // 1 load-job + trends run + save + hooks run + save + stop = 6 step.runs
    expect(step.run).toHaveBeenCalledTimes(6);
    expect(step.waitForEvent).toHaveBeenCalledTimes(2);
    expect(jobStore.stop).toHaveBeenCalledWith("job_1", "hooks");
  });

  it("stops pipeline on waitForEvent timeout (null event)", async () => {
    // First wait returns null (timeout)
    step.waitForEvent.mockResolvedValueOnce(null);

    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

    // 1 load-job + trends run + save + stop = 4 step.runs, 1 waitForEvent
    expect(step.run).toHaveBeenCalledTimes(4);
    expect(jobStore.stop).toHaveBeenCalledWith("job_1", "trends");
  });

  it("throws if job not found", async () => {
    jobStore.findById.mockResolvedValue(null);

    await expect(
      executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig),
    ).rejects.toThrow("Creative job not found: job_1");
  });
});
```

- [ ] **Step 3: Update inngest.ts bootstrap**

Replace the full contents of `apps/api/src/bootstrap/inngest.ts`. Note: the API key is passed as `process.env["ANTHROPIC_API_KEY"] ?? ""` rather than blocking Inngest registration entirely — this keeps other Inngest functions working in dev environments without the key. Stage functions will fail at runtime if called without a valid key.

```typescript
// apps/api/src/bootstrap/inngest.ts
import type { FastifyInstance } from "fastify";
import inngestFastify from "inngest/fastify";
import { PrismaCreativeJobStore } from "@switchboard/db";
import { inngestClient, createCreativeJobRunner } from "@switchboard/core/creative-pipeline";

export async function registerInngest(app: FastifyInstance): Promise<void> {
  if (!app.prisma) {
    app.log.warn("Inngest: skipping registration — no database connection");
    return;
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
  if (!apiKey) {
    app.log.warn(
      "Inngest: ANTHROPIC_API_KEY not set — creative pipeline stages will fail at runtime",
    );
  }

  const jobStore = new PrismaCreativeJobStore(app.prisma);

  await app.register(inngestFastify, {
    client: inngestClient,
    functions: [createCreativeJobRunner(jobStore, { apiKey })],
  });

  app.log.info("Inngest serve handler registered at /api/inngest");
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose src/creative-pipeline/
```

Expected: all tests pass.

- [ ] **Step 5: Verify typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core exec tsc --noEmit && npx pnpm@9.15.4 --filter @switchboard/core build && npx pnpm@9.15.4 --filter @switchboard/api exec tsc --noEmit 2>&1 | grep "creative-pipeline\|inngest"
```

Expected: no errors related to creative pipeline.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: thread API key through creative pipeline job runner"
```

---

### Task 7: Update Barrel Exports

**Files:**

- Modify: `packages/core/src/creative-pipeline/index.ts`

- [ ] **Step 1: Add new exports**

```typescript
// packages/core/src/creative-pipeline/index.ts
export { inngestClient } from "./inngest-client.js";
export type { CreativePipelineEvents } from "./inngest-client.js";
export { createCreativeJobRunner, executeCreativePipeline } from "./creative-job-runner.js";
export { runStage, getNextStage } from "./stages/run-stage.js";
export type { StageName, StageInput } from "./stages/run-stage.js";
export { callClaude, extractJson } from "./stages/call-claude.js";
export { runTrendAnalyzer, buildTrendPrompt } from "./stages/trend-analyzer.js";
export { runHookGenerator, buildHookPrompt } from "./stages/hook-generator.js";
export { runScriptWriter, buildScriptPrompt } from "./stages/script-writer.js";
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): export stage modules from creative-pipeline barrel"
```

---

### Task 8: Full Integration Verification

- [ ] **Step 1: Run all core tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --reporter=verbose
```

Expected: all tests pass (existing + new creative pipeline tests).

- [ ] **Step 2: Run API tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api test -- --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 3: Full typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core --filter @switchboard/schemas --filter @switchboard/db typecheck
```

Expected: no type errors.

- [ ] **Step 4: Run linter**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core lint
```

Expected: no lint errors.

- [ ] **Step 5: Verify commit history**

```bash
git log --oneline -10
```

Expected: clean commit history with SP3 changes following conventional commits.

---

## Summary of Changes

```
Brief submitted
  → Inngest fires creative-job-runner
    → Stage 1 (Trend Analyzer):
        Claude analyzes brief → angles, audience insights, trend signals
    → Buyer approves → Stage 2 (Hook Generator):
        Claude generates hooks per angle, scored against platform rules
    → Buyer approves → Stage 3 (Script Writer):
        Claude writes full scripts with timing structure per top combo
    → Buyer approves → Stage 4 (storyboard — still no-op, SP4)
    → Buyer approves → Stage 5 (production — still no-op, SP5)
```

**First shippable product:** A buyer submits a brief and receives creative strategy (angles + hooks + scripts) — the core value proposition of the Performance Creative Director.
