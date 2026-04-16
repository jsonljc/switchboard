# UGC v2 SP4 — Scripting Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the scripting phase — takes planning output (structures + casting assignments + identity plans) and produces fully-formed `CreativeSpec[]` ready for production. Each spec includes a UGC-native script, scene style, and direction.

**Architecture:** Three components: (1) UGC script writer — calls Claude with creator personality, imperfection profile, and friction constraints to produce UGC-native scripts; (2) UGC director — pure function that generates scene style and direction from creator bible + structure; (3) Scripting phase — composes writer + director, mints specIds, and assembles CreativeSpecs.

**Tech Stack:** TypeScript ESM, Claude API (via existing `callClaude`), Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-04-15-ugc-v2-creative-system-design.md` — Sections 3.5 (phase contracts), 4.7 (script writer & director), 6.3 (SceneStyle & UGCDirection)

---

## File Map

### New files

| File                                                                      | Responsibility                                                                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/ugc-script-writer.ts`            | Builds UGC prompt with creator voice, imperfections, friction constraints → calls Claude → returns script text |
| `packages/core/src/creative-pipeline/ugc/ugc-director.ts`                 | Pure function: generates SceneStyle + UGCDirection from creator bible + structure                              |
| `packages/core/src/creative-pipeline/ugc/phases/scripting.ts`             | Scripting phase: iterates castings, calls writer + director, mints specIds, assembles CreativeSpecs            |
| `packages/core/src/creative-pipeline/__tests__/ugc-script-writer.test.ts` | Tests (mocks call-claude)                                                                                      |
| `packages/core/src/creative-pipeline/__tests__/ugc-director.test.ts`      | Tests (pure function, no mocks)                                                                                |
| `packages/core/src/creative-pipeline/__tests__/scripting-phase.test.ts`   | Tests (mocks script writer)                                                                                    |

### Modified files

| File                                                        | Change                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts` | Add scripting case to `executePhase` switch, add `llmConfig` to deps/context |
| `packages/core/src/creative-pipeline/index.ts`              | Export SP4 modules                                                           |

---

## Task 1: UGC Director

Pure function, no LLM dependency. Build first because the scripting phase needs it.

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/ugc-director.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/ugc-director.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/ugc-director.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateDirection } from "../ugc/ugc-director.js";

const baseCreator = {
  personality: { energy: "conversational" as const, deliveryStyle: "friendly" },
  appearanceRules: {
    hairStates: ["down", "ponytail"],
    wardrobePalette: ["earth_tones", "denim"],
  },
  environmentSet: ["kitchen", "living_room", "outdoor_patio"],
};

const baseStructure = {
  id: "confession",
  name: "Confession / Authentic Story",
  sections: [
    {
      name: "hook",
      purposeGuide: "Vulnerable admission",
      durationRange: [3, 5] as [number, number],
    },
    {
      name: "story",
      purposeGuide: "Personal narrative",
      durationRange: [8, 15] as [number, number],
    },
  ],
};

describe("generateDirection", () => {
  it("returns sceneStyle and ugcDirection", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "instagram_reels",
      ugcFormat: "talking_head",
    });
    expect(result.sceneStyle).toBeDefined();
    expect(result.ugcDirection).toBeDefined();
  });

  it("selects environment from creator's environmentSet", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(baseCreator.environmentSet).toContain(result.sceneStyle.environment);
  });

  it("selects wardrobe from creator's wardrobePalette", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(result.sceneStyle.wardrobeSelection.length).toBeGreaterThan(0);
    for (const item of result.sceneStyle.wardrobeSelection) {
      expect(baseCreator.appearanceRules.wardrobePalette).toContain(item);
    }
  });

  it("selects hairState from creator's hairStates", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(baseCreator.appearanceRules.hairStates).toContain(result.sceneStyle.hairState);
  });

  it("uses natural lighting for UGC", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(["natural", "ambient", "golden_hour", "overcast"]).toContain(result.sceneStyle.lighting);
  });

  it("maps energy level from creator personality", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(result.ugcDirection.energyLevel).toBe("medium"); // "conversational" maps to medium
  });

  it("uses selfie camera for talking_head format", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "instagram_reels",
      ugcFormat: "talking_head",
    });
    expect(result.sceneStyle.cameraAngle).toBe("selfie");
  });

  it("uses handheld camera movement for UGC", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "lifestyle",
    });
    expect(["handheld", "slow_pan"]).toContain(result.sceneStyle.cameraMovement);
  });

  it("sets forbidden framing for UGC authenticity", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(result.ugcDirection.forbiddenFraming.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement ugc-director.ts**

Create `packages/core/src/creative-pipeline/ugc/ugc-director.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/ugc-director.ts

// ── Types ──

interface CreatorDirectionInput {
  personality: { energy: string; deliveryStyle: string };
  appearanceRules: {
    hairStates: string[];
    wardrobePalette: string[];
  };
  environmentSet: string[];
}

interface StructureDirectionInput {
  id: string;
  name: string;
  sections: Array<{ name: string; purposeGuide: string; durationRange: [number, number] }>;
}

export interface DirectionInput {
  creator: CreatorDirectionInput;
  structure: StructureDirectionInput;
  platform: string;
  ugcFormat: string;
}

export interface SceneStyle {
  lighting: "natural" | "ambient" | "golden_hour" | "overcast" | "ring_light";
  cameraAngle: "selfie" | "eye_level" | "slight_low" | "over_shoulder";
  cameraMovement: "handheld" | "static_tripod" | "slow_pan" | "none";
  environment: string;
  wardrobeSelection: string[];
  hairState: string;
  props: string[];
}

export interface UgcDirection {
  hookType: "direct_camera" | "mid_action" | "reaction" | "text_overlay_start";
  eyeContact: "camera" | "off_camera" | "mixed";
  energyLevel: "low" | "medium" | "high";
  pacingNotes: string;
  imperfections: {
    hesitationDensity: number;
    sentenceRestartRate: number;
    microPauseDensity: number;
    fillerDensityTarget: number;
    fragmentationTarget: number;
  };
  adLibPermissions: string[];
  forbiddenFraming: string[];
}

export interface DirectionOutput {
  sceneStyle: SceneStyle;
  ugcDirection: UgcDirection;
}

// ── Deterministic selection helpers ──

function pickFrom<T>(arr: T[], seed: number = 0): T {
  return arr[seed % arr.length];
}

// ── Energy mapping ──

function mapEnergy(energy: string): "low" | "medium" | "high" {
  switch (energy) {
    case "calm":
      return "low";
    case "conversational":
      return "medium";
    case "energetic":
      return "high";
    case "intense":
      return "high";
    default:
      return "medium";
  }
}

// ── UGC-native lighting (never studio) ──

const UGC_LIGHTING: Array<"natural" | "ambient" | "golden_hour" | "overcast"> = [
  "natural",
  "ambient",
  "golden_hour",
  "overcast",
];

// ── Camera mapping by format ──

function getCameraAngle(format: string): SceneStyle["cameraAngle"] {
  switch (format) {
    case "talking_head":
      return "selfie";
    case "lifestyle":
      return "eye_level";
    case "product_in_hand":
      return "slight_low";
    case "multi_shot":
      return "eye_level";
    default:
      return "eye_level";
  }
}

function getCameraMovement(format: string): SceneStyle["cameraMovement"] {
  switch (format) {
    case "talking_head":
      return "handheld";
    case "lifestyle":
      return "slow_pan";
    case "product_in_hand":
      return "handheld";
    case "multi_shot":
      return "handheld";
    default:
      return "handheld";
  }
}

// ── Hook type by structure ──

function getHookType(structureId: string): UgcDirection["hookType"] {
  switch (structureId) {
    case "confession":
    case "social_proof":
      return "direct_camera";
    case "demo_first":
    case "before_after":
      return "mid_action";
    case "myth_buster":
    case "mistake":
      return "reaction";
    default:
      return "direct_camera";
  }
}

// ── Default imperfection profile ──

const DEFAULT_IMPERFECTIONS = {
  hesitationDensity: 0.15,
  sentenceRestartRate: 0.1,
  microPauseDensity: 0.2,
  fillerDensityTarget: 0.2,
  fragmentationTarget: 0.3,
};

/**
 * Generates SceneStyle and UGCDirection from creator bible + structure.
 * Pure function — no LLM calls, fully deterministic.
 */
export function generateDirection(input: DirectionInput): DirectionOutput {
  const { creator, structure, ugcFormat } = input;

  const sceneStyle: SceneStyle = {
    lighting: pickFrom(UGC_LIGHTING),
    cameraAngle: getCameraAngle(ugcFormat),
    cameraMovement: getCameraMovement(ugcFormat),
    environment: pickFrom(creator.environmentSet),
    wardrobeSelection: creator.appearanceRules.wardrobePalette.slice(0, 2),
    hairState: pickFrom(creator.appearanceRules.hairStates),
    props: [],
  };

  const ugcDirection: UgcDirection = {
    hookType: getHookType(structure.id),
    eyeContact: ugcFormat === "talking_head" ? "camera" : "mixed",
    energyLevel: mapEnergy(creator.personality.energy),
    pacingNotes: `Match ${creator.personality.deliveryStyle} delivery style`,
    imperfections: DEFAULT_IMPERFECTIONS,
    adLibPermissions: ["natural reactions", "brief asides"],
    forbiddenFraming: [
      "no studio lighting",
      "no centered framing",
      "no professional backdrop",
      "no teleprompter eye movement",
    ],
  };

  return { sceneStyle, ugcDirection };
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run ugc-director
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/ugc-director.ts packages/core/src/creative-pipeline/__tests__/ugc-director.test.ts
git commit -m "feat(core): add UGC director — generates scene style and direction from creator bible"
```

---

## Task 2: UGC Script Writer

LLM-dependent — uses existing `callClaude` from shared stages. Tests mock `call-claude.js`.

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/ugc-script-writer.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/ugc-script-writer.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/ugc-script-writer.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildUgcScriptPrompt, runUgcScriptWriter } from "../ugc/ugc-script-writer.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    text: "Hey so I've been meaning to tell you about this thing...",
    language: "en",
  }),
}));

const baseBrief = {
  productDescription: "AI scheduling tool",
  targetAudience: "Small business owners",
  brandVoice: null as string | null,
};

const baseCreator = {
  name: "Sofia",
  personality: {
    energy: "conversational",
    deliveryStyle: "friendly",
    catchphrases: ["honestly though", "no cap"],
    forbiddenPhrases: ["limited time offer"],
  },
};

const baseStructure = {
  id: "confession",
  name: "Confession / Authentic Story",
  sections: [
    {
      name: "hook",
      purposeGuide: "Vulnerable admission",
      durationRange: [3, 5] as [number, number],
    },
    {
      name: "story",
      purposeGuide: "Personal narrative",
      durationRange: [8, 15] as [number, number],
    },
    {
      name: "reveal",
      purposeGuide: "Product as turning point",
      durationRange: [5, 10] as [number, number],
    },
    { name: "cta", purposeGuide: "Invitation to try", durationRange: [3, 5] as [number, number] },
  ],
};

describe("buildUgcScriptPrompt", () => {
  it("includes creator personality in prompt", () => {
    const { systemPrompt } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
    });
    expect(systemPrompt).toContain("Sofia");
    expect(systemPrompt).toContain("conversational");
    expect(systemPrompt).toContain("honestly though");
  });

  it("includes forbidden phrases", () => {
    const { systemPrompt } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
    });
    expect(systemPrompt).toContain("limited time offer");
  });

  it("includes script constraints from funnel frictions", () => {
    const { userMessage } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: ["set clear expectations early"],
      hookDirectives: ["increase hook novelty"],
    });
    expect(userMessage).toContain("set clear expectations early");
    expect(userMessage).toContain("increase hook novelty");
  });

  it("includes structure sections in prompt", () => {
    const { userMessage } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
    });
    expect(userMessage).toContain("hook");
    expect(userMessage).toContain("Vulnerable admission");
  });

  it("includes imperfection guidelines", () => {
    const { systemPrompt } = buildUgcScriptPrompt({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
    });
    expect(systemPrompt).toContain("filler");
    expect(systemPrompt).toContain("hesitation");
  });
});

describe("runUgcScriptWriter", () => {
  it("calls callClaude and returns script result", async () => {
    const result = await runUgcScriptWriter({
      brief: baseBrief,
      creator: baseCreator,
      structure: baseStructure,
      scriptConstraints: [],
      hookDirectives: [],
      apiKey: "test-key",
    });
    expect(result).toBeDefined();
    expect(result.text).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement ugc-script-writer.ts**

Create `packages/core/src/creative-pipeline/ugc/ugc-script-writer.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/ugc-script-writer.ts
import { callClaude } from "../stages/call-claude.js";
import { z } from "zod";

// ── Types ──

interface ScriptBrief {
  productDescription: string;
  targetAudience: string;
  brandVoice: string | null;
}

interface ScriptCreator {
  name: string;
  personality: {
    energy: string;
    deliveryStyle: string;
    catchphrases?: string[];
    forbiddenPhrases?: string[];
  };
}

interface ScriptStructure {
  id: string;
  name: string;
  sections: Array<{ name: string; purposeGuide: string; durationRange: [number, number] }>;
}

export interface UgcScriptInput {
  brief: ScriptBrief;
  creator: ScriptCreator;
  structure: ScriptStructure;
  scriptConstraints: string[];
  hookDirectives: string[];
  apiKey: string;
}

// ── Output schema (simple for SP4 — just the script text) ──

const UgcScriptOutputSchema = z.object({
  text: z.string(),
  language: z.string().default("en"),
  claimsPolicyTag: z.string().optional(),
});

export type UgcScriptOutput = z.infer<typeof UgcScriptOutputSchema>;

// ── Prompt builder ──

export function buildUgcScriptPrompt(input: Omit<UgcScriptInput, "apiKey">): {
  systemPrompt: string;
  userMessage: string;
} {
  const { brief, creator, structure, scriptConstraints, hookDirectives } = input;

  const catchphrases = creator.personality.catchphrases?.join(", ") ?? "none";
  const forbidden = creator.personality.forbiddenPhrases?.join(", ") ?? "none";

  const systemPrompt = `You are writing a UGC ad script as ${creator.name}, a ${creator.personality.energy} creator with a ${creator.personality.deliveryStyle} delivery style.

## Creator Voice
- Energy: ${creator.personality.energy}
- Style: ${creator.personality.deliveryStyle}
- Catchphrases to naturally include: ${catchphrases}
- NEVER use these phrases: ${forbidden}

## UGC Authenticity Rules
- Write like a real person talking, NOT like ad copy
- Include natural filler words (um, like, honestly, you know) at 15-25% density
- Add hesitation points — places where the speaker pauses mid-thought
- Include sentence fragments and incomplete thoughts that get restarted
- Allow micro pauses between ideas (marked with ...)
- FORBIDDEN: "limited time offer", "act now", "don't miss out", "click the link below"
- The script should feel like someone talking to a friend, not reading a teleprompter

## Output Format
Return a JSON object:
{
  "text": "The complete script text with natural speech patterns",
  "language": "en"
}

Respond ONLY with the JSON object.`;

  // Build structure guidance
  const sectionGuide = structure.sections
    .map((s) => `- **${s.name}** (${s.durationRange[0]}-${s.durationRange[1]}s): ${s.purposeGuide}`)
    .join("\n");

  let userMessage = `Write a UGC script for this ad:

**Product:** ${brief.productDescription}
**Audience:** ${brief.targetAudience}
${brief.brandVoice ? `**Brand Voice:** ${brief.brandVoice}` : ""}

**Ad Structure (${structure.name}):**
${sectionGuide}`;

  if (scriptConstraints.length > 0) {
    userMessage += `\n\n**Script Constraints:**\n${scriptConstraints.map((c) => `- ${c}`).join("\n")}`;
  }

  if (hookDirectives.length > 0) {
    userMessage += `\n\n**Hook Directives:**\n${hookDirectives.map((d) => `- ${d}`).join("\n")}`;
  }

  return { systemPrompt, userMessage };
}

// ── Runner ──

export async function runUgcScriptWriter(input: UgcScriptInput): Promise<UgcScriptOutput> {
  const { systemPrompt, userMessage } = buildUgcScriptPrompt(input);

  return callClaude({
    apiKey: input.apiKey,
    systemPrompt,
    userMessage,
    schema: UgcScriptOutputSchema,
    maxTokens: 4096,
  });
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run ugc-script-writer
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/ugc-script-writer.ts packages/core/src/creative-pipeline/__tests__/ugc-script-writer.test.ts
git commit -m "feat(core): add UGC script writer — Claude-powered UGC-native script generation"
```

---

## Task 3: Scripting Phase

Composes writer + director into ScriptingInput → ScriptingOutput.

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/phases/scripting.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/scripting-phase.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/scripting-phase.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { executeScriptingPhase, type ScriptingInput } from "../ugc/phases/scripting.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn().mockResolvedValue({
    text: "Hey so honestly I need to tell you about this scheduling tool...",
    language: "en",
  }),
}));

function makeCreator(id: string) {
  return {
    id,
    name: `Creator ${id}`,
    personality: { energy: "conversational", deliveryStyle: "friendly" },
    appearanceRules: { hairStates: ["down"], wardrobePalette: ["earth_tones"] },
    environmentSet: ["kitchen"],
  };
}

function makeStructure(id: string) {
  return {
    structureId: id,
    template: {
      id,
      name: `Structure ${id}`,
      sections: [
        { name: "hook", purposeGuide: "Open strong", durationRange: [3, 5] as [number, number] },
        { name: "body", purposeGuide: "Main content", durationRange: [10, 20] as [number, number] },
        { name: "cta", purposeGuide: "Close", durationRange: [3, 5] as [number, number] },
      ],
      platformAffinity: {},
      funnelFrictionAffinity: {},
    },
    score: 0.9,
  };
}

describe("executeScriptingPhase", () => {
  const baseInput: ScriptingInput = {
    planningOutput: {
      structures: [makeStructure("confession")],
      castingAssignments: [{ creatorId: "cr_1", structureId: "confession", score: 0.9 }],
      identityPlans: [
        {
          creatorId: "cr_1",
          primaryStrategy: "reference_conditioning",
          fallbackChain: ["asset_reuse"],
          constraints: {
            maxIdentityDrift: 0.5,
            lockHairState: false,
            lockWardrobe: false,
            requireExactReuse: false,
          },
        },
      ],
    },
    brief: {
      productDescription: "AI scheduling tool",
      targetAudience: "Small business owners",
      platforms: ["meta"],
      creatorPoolIds: ["cr_1"],
      ugcFormat: "talking_head",
    },
    creatorPool: [makeCreator("cr_1")] as any,
    creativeWeights: {
      structurePriorities: {},
      motivatorPriorities: {},
      scriptConstraints: [],
      hookDirectives: [],
    },
    apiKey: "test-key",
  };

  it("produces one CreativeSpec per casting assignment", async () => {
    const result = await executeScriptingPhase(baseInput);
    expect(result.specs).toHaveLength(1);
  });

  it("each spec has a unique specId", async () => {
    const inputWith2 = {
      ...baseInput,
      planningOutput: {
        ...baseInput.planningOutput,
        castingAssignments: [
          { creatorId: "cr_1", structureId: "confession", score: 0.9 },
          { creatorId: "cr_2", structureId: "social_proof", score: 0.8 },
        ],
        structures: [makeStructure("confession"), makeStructure("social_proof")],
        identityPlans: [
          {
            creatorId: "cr_1",
            primaryStrategy: "reference_conditioning" as const,
            fallbackChain: [],
            constraints: {
              maxIdentityDrift: 0.5,
              lockHairState: false,
              lockWardrobe: false,
              requireExactReuse: false,
            },
          },
          {
            creatorId: "cr_2",
            primaryStrategy: "reference_conditioning" as const,
            fallbackChain: [],
            constraints: {
              maxIdentityDrift: 0.5,
              lockHairState: false,
              lockWardrobe: false,
              requireExactReuse: false,
            },
          },
        ],
      },
      creatorPool: [makeCreator("cr_1"), makeCreator("cr_2")] as any,
    };
    const result = await executeScriptingPhase(inputWith2);
    expect(result.specs).toHaveLength(2);
    expect(result.specs[0].specId).not.toBe(result.specs[1].specId);
  });

  it("spec includes script, style, direction, and identity constraints", async () => {
    const result = await executeScriptingPhase(baseInput);
    const spec = result.specs[0];
    expect(spec.script.text).toBeTruthy();
    expect(spec.style).toBeDefined();
    expect(spec.direction).toBeDefined();
    expect(spec.identityConstraints).toBeDefined();
    expect(spec.mode).toBe("ugc");
  });

  it("returns empty specs when no casting assignments", async () => {
    const emptyInput = {
      ...baseInput,
      planningOutput: { ...baseInput.planningOutput, castingAssignments: [], identityPlans: [] },
    };
    const result = await executeScriptingPhase(emptyInput);
    expect(result.specs).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement scripting.ts**

Create `packages/core/src/creative-pipeline/ugc/phases/scripting.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/phases/scripting.ts
import { createId } from "@paralleldrive/cuid2";
import type { CreatorIdentity, CreativeWeights, IdentityPlan } from "@switchboard/schemas";
import type { CastingAssignment } from "../scene-caster.js";
import type { StructureSelection } from "../structure-engine.js";
import { runUgcScriptWriter } from "../ugc-script-writer.js";
import { generateDirection } from "../ugc-director.js";

// ── Types ──

interface UgcBriefInput {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  creatorPoolIds: string[];
  ugcFormat: string;
  brandVoice?: string | null;
}

interface PlanningOutputInput {
  structures: StructureSelection[];
  castingAssignments: CastingAssignment[];
  identityPlans: IdentityPlan[];
}

export interface ScriptingInput {
  planningOutput: PlanningOutputInput;
  brief: UgcBriefInput;
  creatorPool: CreatorIdentity[];
  creativeWeights: CreativeWeights;
  apiKey: string;
}

interface CreativeSpecOutput {
  specId: string;
  deploymentId?: string;
  mode: "ugc";
  creatorId: string;
  structureId: string;
  motivator: string;
  platform: string;
  script: { text: string; language: string; claimsPolicyTag?: string };
  style: Record<string, unknown>;
  direction: Record<string, unknown>;
  format: string;
  identityConstraints: Record<string, unknown>;
  continuityConstraints?: Record<string, unknown>;
  renderTargets: { aspect: string; durationSec: number };
  qaThresholds: { faceSimilarityMin: number; realismMin: number };
  providersAllowed: string[];
  campaignTags: Record<string, string>;
}

export interface ScriptingOutput {
  specs: CreativeSpecOutput[];
}

// ── Helpers ──

function findCreator(pool: CreatorIdentity[], id: string): CreatorIdentity | undefined {
  return pool.find((c) => c.id === id);
}

function findStructure(
  structures: StructureSelection[],
  id: string,
): StructureSelection | undefined {
  return structures.find((s) => s.structureId === id);
}

function findIdentityPlan(plans: IdentityPlan[], creatorId: string): IdentityPlan | undefined {
  return plans.find((p) => p.creatorId === creatorId);
}

function mapPlatformToUgc(platform: string): string {
  switch (platform) {
    case "meta":
      return "meta_feed";
    case "tiktok":
      return "tiktok";
    default:
      return "meta_feed";
  }
}

function estimateDuration(sections: Array<{ durationRange: [number, number] }>): number {
  return sections.reduce((sum, s) => sum + (s.durationRange[0] + s.durationRange[1]) / 2, 0);
}

// ── Phase execution ──

export async function executeScriptingPhase(input: ScriptingInput): Promise<ScriptingOutput> {
  const { planningOutput, brief, creatorPool, creativeWeights, apiKey } = input;
  const { castingAssignments, structures, identityPlans } = planningOutput;

  if (castingAssignments.length === 0) {
    return { specs: [] };
  }

  const ugcPlatform = mapPlatformToUgc(brief.platforms[0] ?? "meta");
  const specs: CreativeSpecOutput[] = [];

  for (const casting of castingAssignments) {
    const creator = findCreator(creatorPool, casting.creatorId);
    const structure = findStructure(structures, casting.structureId);
    const identityPlan = findIdentityPlan(identityPlans, casting.creatorId);

    if (!creator || !structure) continue;

    // Generate script via Claude
    const scriptResult = await runUgcScriptWriter({
      brief: {
        productDescription: brief.productDescription,
        targetAudience: brief.targetAudience,
        brandVoice: brief.brandVoice ?? null,
      },
      creator: {
        name: creator.name,
        personality: creator.personality as {
          energy: string;
          deliveryStyle: string;
          catchphrases?: string[];
          forbiddenPhrases?: string[];
        },
      },
      structure: {
        id: structure.template.id,
        name: structure.template.name,
        sections: structure.template.sections,
      },
      scriptConstraints: creativeWeights.scriptConstraints,
      hookDirectives: creativeWeights.hookDirectives,
      apiKey,
    });

    // Generate direction (pure function)
    const { sceneStyle, ugcDirection } = generateDirection({
      creator: {
        personality: creator.personality as { energy: string; deliveryStyle: string },
        appearanceRules: creator.appearanceRules as {
          hairStates: string[];
          wardrobePalette: string[];
        },
        environmentSet: creator.environmentSet,
      },
      structure: {
        id: structure.template.id,
        name: structure.template.name,
        sections: structure.template.sections,
      },
      platform: ugcPlatform,
      ugcFormat: brief.ugcFormat,
    });

    const specId = createId();
    const durationSec = estimateDuration(structure.template.sections);

    specs.push({
      specId,
      mode: "ugc",
      creatorId: casting.creatorId,
      structureId: casting.structureId,
      motivator: "general",
      platform: ugcPlatform,
      script: {
        text: scriptResult.text,
        language: scriptResult.language,
        claimsPolicyTag: scriptResult.claimsPolicyTag,
      },
      style: sceneStyle as unknown as Record<string, unknown>,
      direction: ugcDirection as unknown as Record<string, unknown>,
      format: brief.ugcFormat,
      identityConstraints: identityPlan
        ? (identityPlan.constraints as unknown as Record<string, unknown>)
        : { strategy: "reference_conditioning", maxIdentityDrift: 0.5 },
      renderTargets: {
        aspect: "9:16",
        durationSec,
      },
      qaThresholds: {
        faceSimilarityMin: 0.7,
        realismMin: 0.5,
      },
      providersAllowed: ["kling"],
      campaignTags: {},
    });
  }

  return { specs };
}
```

NOTE: This file imports from `@paralleldrive/cuid2`. Check if this package is already in the monorepo. If not, use a simple ID generator instead:

```typescript
// If @paralleldrive/cuid2 is not available, use this instead:
function createId(): string {
  return `spec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
```

Read the root `package.json` or `packages/core/package.json` to check for `@paralleldrive/cuid2`. If it's not there, use the simple generator.

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run scripting-phase
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/phases/scripting.ts packages/core/src/creative-pipeline/__tests__/scripting-phase.test.ts
git commit -m "feat(core): add scripting phase — produces CreativeSpecs from planning output via Claude"
```

---

## Task 4: Wire Scripting Phase into Runner + Exports

**Files:**

- Modify: `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts`
- Modify: `packages/core/src/creative-pipeline/index.ts`

- [ ] **Step 1: Add scripting case to executePhase**

In `ugc-job-runner.ts`, update the `executePhase` function to add a `"scripting"` case:

```typescript
    case "scripting": {
      const planningOutput = ctx.previousPhaseOutputs.planning as Record<string, unknown>;
      const ugcConfig = (ctx.job.ugcConfig ?? {}) as Record<string, unknown>;
      const brief = (ugcConfig.brief ?? {}) as Record<string, unknown>;
      const { executeScriptingPhase } = await import("./phases/scripting.js");
      return await executeScriptingPhase({
        planningOutput: planningOutput as any,
        brief: brief as any,
        creatorPool: ctx.context.creatorPool as any[],
        creativeWeights: ctx.context.creativeWeights as any,
        apiKey: ctx.context.apiKey,
      });
    }
```

Also update `UgcPipelineContext` to include `creativeWeights` and `apiKey`:

```typescript
interface UgcPipelineContext {
  creatorPool: unknown[];
  trustLevel: number;
  deploymentType: string;
  funnelFrictions: unknown[];
  providerCapabilities: unknown[];
  creativeWeights: unknown;
  apiKey: string;
}
```

Update `preloadContext` to populate `creativeWeights` (from translating funnelFrictions):

```typescript
import { translateFrictions } from "./funnel-friction-translator.js";
import type { FunnelFriction } from "@switchboard/schemas";
```

And in the return:

```typescript
    creativeWeights: translateFrictions([] as FunnelFriction[]), // SP8 adds real frictions
    apiKey: deps.llmConfig?.apiKey ?? "",
```

Add `llmConfig` to `UgcPipelineDeps`:

```typescript
interface UgcPipelineDeps {
  jobStore: UgcJobStore;
  creatorStore: CreatorStore;
  deploymentStore: DeploymentStore;
  llmConfig?: { apiKey: string };
}
```

- [ ] **Step 2: Update barrel exports**

Add to `packages/core/src/creative-pipeline/index.ts`:

```typescript
export { generateDirection } from "./ugc/ugc-director.js";
export { buildUgcScriptPrompt, runUgcScriptWriter } from "./ugc/ugc-script-writer.js";
export { executeScriptingPhase } from "./ugc/phases/scripting.js";
export type { ScriptingInput, ScriptingOutput } from "./ugc/phases/scripting.js";
```

- [ ] **Step 3: Update inngest.ts wiring to pass llmConfig**

In `apps/api/src/bootstrap/inngest.ts`, update the `createUgcJobRunner` call to pass `llmConfig`:

```typescript
      createUgcJobRunner({ jobStore, creatorStore, deploymentStore, llmConfig: { apiKey } }),
```

- [ ] **Step 4: Run UGC runner tests to check no regression**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run ugc-job-runner
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts packages/core/src/creative-pipeline/index.ts apps/api/src/bootstrap/inngest.ts
git commit -m "feat(core): wire scripting phase into UGC runner, export SP4 modules"
```

---

## Task 5: Full Build + Test Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test 2>&1 | tail -80
```

- [ ] **Step 2: Run typecheck + lint**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck 2>&1 | tail -40
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint 2>&1 | tail -40
```

- [ ] **Step 3: Fix any SP4-related issues, commit if needed**
