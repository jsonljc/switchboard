# Alex freeze-gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-risk the claim-classifier `off->enforce` flip by enforcing a confidence floor and narrowing four over-escalation paths, and close the self-disclosed-minor safety gap, all at the live governance layer.

**Architecture:** Two disjoint layers. The **output path** (claim-classifier hook on Alex's drafted reply) gets a confidence floor (T1.1) and paraphrase-tolerant substantiation (T1.2c). The **input path** (deterministic pre-input gate on the user's message) gets narrowed escalation triggers (T1.2a bare anxiety, T1.2b negation guards) and a new self-disclosed-minor trigger (T1.5). Tests at both the unit layer and the production path. The 4 locked medical red flags live in `skills/alex/SKILL.md` (a different layer) and are not touched.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Zod schemas, Vitest, pnpm + Turborepo. Spec: `docs/superpowers/specs/2026-06-03-alex-freeze-gate-design.md`.

---

## File structure

| File                                                                                     | Change                                                     | Task |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---- |
| `packages/schemas/src/governance-config.ts`                                              | add `confidenceThreshold` to `ClaimClassifierConfigSchema` | 1    |
| `packages/schemas/src/__tests__/governance-config.test.ts`                               | update 2 exact-equality cases; add threshold cases         | 1    |
| `packages/core/src/skill-runtime/hooks/claim-classifier.ts`                              | thread + enforce the floor in `decideAction`               | 1    |
| `packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts`               | confidence-controllable classifier + floor cases           | 1    |
| `packages/core/src/governance/escalation-triggers/common.ts`                             | narrow anxiety; add negations; add minor patterns          | 2    |
| `packages/core/src/governance/escalation-triggers/__tests__/common.test.ts`              | **new** unit suite (real triggers x real scanner)          | 2    |
| `packages/core/src/channel-gateway/__tests__/channel-gateway-deterministic-gate.test.ts` | add minor-escalates + anxiety-no-escalate live-path cases  | 2    |
| `packages/core/src/governance/classifier/substantiation-resolver.ts`                     | paraphrase-tolerant `matchClaim`                           | 3    |
| `packages/core/src/governance/classifier/__tests__/substantiation-resolver.test.ts`      | paraphrase cases                                           | 3    |

Run all commands from the worktree root: `/Users/jasonli/switchboard/.claude/worktrees/alex-freeze-gate`.

---

## Task 1: T1.1 enforced confidence floor (output path)

**Files:**

- Modify: `packages/schemas/src/governance-config.ts:37-43` (`ClaimClassifierConfigSchema`)
- Modify: `packages/schemas/src/__tests__/governance-config.test.ts:91-155`
- Modify: `packages/core/src/skill-runtime/hooks/claim-classifier.ts` (lines 82, 107-116, 147-154, 196)
- Test: `packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts`

### Schema

- [ ] **Step 1: Update the two existing exact-equality schema tests to expect the new field**

In `governance-config.test.ts`, the `.toEqual` at lines 94-98 and 107-111 will break once a defaulted field is added. Change both to include `confidenceThreshold: 0.7`:

```ts
it("applies defaults when no fields provided", () => {
  const parsed = ClaimClassifierConfigSchema.parse({});
  expect(parsed).toEqual({
    mode: "off",
    latencyBudgetMs: 800,
    model: "claude-haiku-4-5-20251001",
    confidenceThreshold: 0.7,
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
    confidenceThreshold: 0.7,
  });
});
```

- [ ] **Step 2: Add new threshold cases**

Append inside `describe("ClaimClassifierConfigSchema", ...)`:

```ts
it("defaults confidenceThreshold to 0.7", () => {
  expect(ClaimClassifierConfigSchema.parse({}).confidenceThreshold).toBe(0.7);
});

it("accepts an explicit confidenceThreshold", () => {
  expect(ClaimClassifierConfigSchema.parse({ confidenceThreshold: 0.5 }).confidenceThreshold).toBe(
    0.5,
  );
});

it("rejects a confidenceThreshold outside [0,1]", () => {
  expect(ClaimClassifierConfigSchema.safeParse({ confidenceThreshold: 1.5 }).success).toBe(false);
  expect(ClaimClassifierConfigSchema.safeParse({ confidenceThreshold: -0.1 }).success).toBe(false);
});
```

And inside `describe("resolveClaimClassifierConfig", ...)`:

```ts
it("surfaces confidenceThreshold from the passthrough sub-block (and defaults to 0.7)", () => {
  expect(resolveClaimClassifierConfig(null).confidenceThreshold).toBe(0.7);
  const config = GovernanceConfigSchema.parse({
    jurisdiction: "SG",
    clinicType: "medical",
    claimClassifier: { mode: "enforce", confidenceThreshold: 0.85 },
  });
  expect(resolveClaimClassifierConfig(config).confidenceThreshold).toBe(0.85);
});
```

- [ ] **Step 3: Run the schema tests, verify they FAIL**

Run: `pnpm --filter @switchboard/schemas test governance-config`
Expected: FAIL (the new field does not exist yet; `confidenceThreshold` is `undefined`).

- [ ] **Step 4: Add the schema field**

In `governance-config.ts`, add the field to `ClaimClassifierConfigSchema` and extend the doc-comment's "Defaults:" line:

```ts
export const ClaimClassifierConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
    latencyBudgetMs: z.number().int().positive().default(800),
    model: z.string().min(1).default("claude-haiku-4-5-20251001"),
    // T1.1: a classification below this confidence is not trusted to rewrite or
    // escalate a turn (the hook treats it as allow). De-risks the off->enforce
    // flip; root of over-flag #673. Principled default, not an operator UI knob.
    confidenceThreshold: z.number().min(0).max(1).default(0.7),
  })
  .default({});
```

- [ ] **Step 5: Run the schema tests, verify they PASS**

Run: `pnpm --filter @switchboard/schemas test governance-config`
Expected: PASS.

### Hook

- [ ] **Step 6: Add a confidence-controllable classifier helper + floor tests (failing)**

In `claim-classifier.test.ts`, add this helper near `fakeClassifier` (after line 61):

```ts
function fakeClassifierConf(claimType: ClaimType, confidence: number): AnthropicClaimClassifier {
  return {
    classify: async ({ sentence, model }) => ({
      result: { sentence, claimType, confidence },
      promptVersion: "claim-classifier@1.0.0",
      promptHash: "0123456789abcdef",
      schemaVersion: "1.0.0",
      model,
    }),
  };
}
```

Thread a `confidenceThreshold` override through the harness. Change `fakeResolver` (line 14-31) signature to accept it and emit it into the `claimClassifier` sub-block:

```ts
function fakeResolver(
  mode: "off" | "observe" | "enforce" | "missing" | "error",
  latencyBudgetMs = 800,
  confidenceThreshold?: number,
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
        claimClassifier: {
          mode,
          latencyBudgetMs,
          model: "claude-haiku-4-5-20251001",
          ...(confidenceThreshold !== undefined ? { confidenceThreshold } : {}),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    };
  };
}
```

Add `confidenceThreshold` to the `makeHook` overrides type (line 148-157) and pass it through (line 167):

```ts
    latencyBudgetMs: number;
    confidenceThreshold: number;
  }> = {},
) {
  const mode = overrides.configMode ?? "enforce";
  // ... unchanged ...
  const hook = new ClaimClassifierHook({
    governanceConfigResolver: fakeResolver(
      mode,
      overrides.latencyBudgetMs,
      overrides.confidenceThreshold,
    ),
```

Append a new describe block:

```ts
describe("ClaimClassifierHook — confidence floor (T1.1)", () => {
  it("allows a rewriteable claim below the confidence floor (no rewrite, no verdict)", async () => {
    const { hook, verdictStore, handoffStore } = makeHook({
      classifier: fakeClassifierConf("efficacy", 0.6),
      substantiation: "missing",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
    expect(handoffStore.saved).toHaveLength(0);
    expect(result.response).toBe("Visible slimming after one session.");
  });

  it("allows an escalate-only claim below the floor (uniform floor)", async () => {
    const { hook, verdictStore, conversationStore } = makeHook({
      classifier: fakeClassifierConf("diagnosis", 0.6),
    });
    const result = makeResult("You might have rosacea.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
    expect(conversationStore.getStatus("sess_1")).toBeUndefined();
    expect(result.response).toBe("You might have rosacea.");
  });

  it("still rewrites a rewriteable claim at/above the floor", async () => {
    const { hook, verdictStore } = makeHook({
      classifier: fakeClassifierConf("efficacy", 0.8),
      substantiation: "missing",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictStore.saved[0] as any).action).toBe("rewrite");
  });

  it("still escalates an escalate-only claim at/above the floor", async () => {
    const { hook, verdictStore, conversationStore } = makeHook({
      classifier: fakeClassifierConf("diagnosis", 0.9),
    });
    const result = makeResult("You might have rosacea.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
  });

  it("respects a configured (lower) confidenceThreshold", async () => {
    const { hook, verdictStore } = makeHook({
      classifier: fakeClassifierConf("efficacy", 0.6),
      substantiation: "missing",
      confidenceThreshold: 0.5,
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    // 0.6 >= 0.5 → acts (rewrites)
    expect(verdictStore.saved).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run the hook tests, verify the new block FAILS**

Run: `pnpm --filter @switchboard/core test claim-classifier`
Expected: the new "below the floor" cases FAIL (current hook rewrites/escalates regardless of confidence); existing cases still pass.

- [ ] **Step 8: Enforce the floor in the hook**

In `claim-classifier.ts`:

1. At the `decideAction` call site (currently lines 107-116), add the threshold to the args object:

```ts
actions.push(
  await this.decideAction({
    outcome: outcomes[i] as ClassifierOutcome,
    sentence: sentences[i] as string,
    jurisdiction,
    deploymentId: ctx.deploymentId,
    latencyBudgetMs: classifierConfig.latencyBudgetMs,
    confidenceThreshold: classifierConfig.confidenceThreshold,
  }),
);
```

2. In the `decideAction` signature (lines 147-153) add the param, and destructure it (line 154):

```ts
  private async decideAction(args: {
    outcome: ClassifierOutcome;
    sentence: string;
    jurisdiction: "SG" | "MY";
    deploymentId: string;
    latencyBudgetMs: number;
    confidenceThreshold: number;
  }): Promise<SentenceAction> {
    const { outcome, sentence, jurisdiction, deploymentId, latencyBudgetMs, confidenceThreshold } =
      args;
```

3. Add the floor immediately after the `none` check (current line 196):

```ts
if (result.claimType === "none") return { kind: "allow" };

// T1.1 confidence floor: a sub-threshold classification is not trusted to
// rewrite or escalate a turn. Below the floor we allow the sentence rather
// than acting on a guess. Applies uniformly to all non-"none" claim types;
// error/timeout outcomes above carry no confidence and still escalate.
if (result.confidence < confidenceThreshold) return { kind: "allow" };
```

- [ ] **Step 9: Run the hook tests, verify PASS**

Run: `pnpm --filter @switchboard/core test claim-classifier`
Expected: PASS (all, including existing cases — note the existing rewrite/escalate cases use `fakeClassifier` at confidence 0.9, above the 0.7 default).

- [ ] **Step 10: Typecheck both packages and commit**

Run: `pnpm --filter @switchboard/schemas --filter @switchboard/core typecheck`
Expected: no errors.

```bash
git add packages/schemas/src/governance-config.ts \
  packages/schemas/src/__tests__/governance-config.test.ts \
  packages/core/src/skill-runtime/hooks/claim-classifier.ts \
  packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts
git commit -m "feat(governance): enforce claim-classifier confidence floor (T1.1)"
```

---

## Task 2: T1.2a + T1.2b + T1.5 escalation-trigger narrowing & minor (input path)

**Files:**

- Modify: `packages/core/src/governance/escalation-triggers/common.ts`
- Create: `packages/core/src/governance/escalation-triggers/__tests__/common.test.ts`
- Modify: `packages/core/src/channel-gateway/__tests__/channel-gateway-deterministic-gate.test.ts`

- [ ] **Step 1: Write the unit suite (failing) — real triggers through the real scanner**

Create `packages/core/src/governance/escalation-triggers/__tests__/common.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COMMON_ESCALATION_TRIGGERS } from "../common.js";
import { scanForEscalationTriggers } from "../../scanner/escalation-trigger-scanner.js";

function matchedIds(text: string): string[] {
  return scanForEscalationTriggers(text, COMMON_ESCALATION_TRIGGERS).map((m) => m.entry.id);
}

describe("COMMON_ESCALATION_TRIGGERS — T1.2a bare anxiety narrowing", () => {
  it("does NOT escalate bare aesthetic anxiety (the designed objection)", () => {
    expect(matchedIds("I'm so anxious about how my results will look")).not.toContain(
      "sensitive_keyword_mental_health",
    );
    expect(matchedIds("a bit nervous and anxious about the downtime")).not.toContain(
      "sensitive_keyword_mental_health",
    );
  });

  it("STILL escalates genuine mental-health crisis signals", () => {
    expect(matchedIds("I have an anxiety disorder")).toContain("sensitive_keyword_mental_health");
    expect(matchedIds("I get panic attacks")).toContain("sensitive_keyword_mental_health");
    expect(matchedIds("I feel suicidal")).toContain("sensitive_keyword_mental_health");
    expect(matchedIds("I struggle with depression")).toContain("sensitive_keyword_mental_health");
  });
});

describe("COMMON_ESCALATION_TRIGGERS — T1.2b negation / third-party guards", () => {
  it("does NOT escalate a self-negated condition", () => {
    expect(matchedIds("I'm not diabetic")).not.toContain("sensitive_keyword_medical_condition");
    expect(matchedIds("I don't have diabetes")).not.toContain(
      "sensitive_keyword_medical_condition",
    );
    expect(matchedIds("I have no history of cancer")).not.toContain(
      "sensitive_keyword_medical_condition",
    );
  });

  it("does NOT escalate a third-party (family) condition", () => {
    expect(matchedIds("my mum had cancer")).not.toContain("sensitive_keyword_medical_condition");
    expect(matchedIds("my mother has diabetes")).not.toContain(
      "sensitive_keyword_medical_condition",
    );
  });

  it("STILL escalates a genuine first-person condition", () => {
    expect(matchedIds("I have diabetes")).toContain("sensitive_keyword_medical_condition");
    expect(matchedIds("I'm diabetic, can I get filler?")).toContain(
      "sensitive_keyword_medical_condition",
    );
    expect(matchedIds("I have cancer")).toContain("sensitive_keyword_medical_condition");
  });

  it("scans per-sentence: a first-person condition in its own sentence still escalates", () => {
    expect(matchedIds("My mum had cancer. I have diabetes too.")).toContain(
      "sensitive_keyword_medical_condition",
    );
  });

  it("does NOT escalate a declined treatment combo", () => {
    expect(matchedIds("I'd rather not combine botox and filler")).not.toContain(
      "multi_treatment_combo",
    );
  });

  it("STILL escalates a genuine treatment-combo question", () => {
    expect(matchedIds("can I combine botox and filler the same day?")).toContain(
      "multi_treatment_combo",
    );
  });
});

describe("COMMON_ESCALATION_TRIGGERS — T1.5 self-disclosed minor", () => {
  it("escalates a self-disclosed minor", () => {
    expect(matchedIds("hi I'm 16, can I get fillers?")).toContain("sensitive_keyword_minor");
    expect(matchedIds("I am 15 and want botox")).toContain("sensitive_keyword_minor");
    expect(matchedIds("im 14 is that ok")).toContain("sensitive_keyword_minor");
    expect(matchedIds("I'm a minor")).toContain("sensitive_keyword_minor");
  });

  it("still escalates the existing third-party minor phrasing", () => {
    expect(matchedIds("my daughter is interested")).toContain("sensitive_keyword_minor");
  });

  it("is precise: does NOT fire on adult / non-age uses of the number", () => {
    expect(matchedIds("I have 16 years of experience with botox")).not.toContain(
      "sensitive_keyword_minor",
    );
    expect(matchedIds("I'm 160cm tall")).not.toContain("sensitive_keyword_minor");
    expect(matchedIds("I'm 16 weeks pregnant")).not.toContain("sensitive_keyword_minor");
    expect(matchedIds("I'm 18, can I book?")).not.toContain("sensitive_keyword_minor");
    expect(matchedIds("I lost 16 pounds recently")).not.toContain("sensitive_keyword_minor");
  });
});
```

- [ ] **Step 2: Run the unit suite, verify it FAILS**

Run: `pnpm --filter @switchboard/core test escalation-triggers/__tests__/common`
Expected: FAIL. Current code over-escalates anxiety, lacks negation guards, and misses self-disclosed minors.

- [ ] **Step 3: Update `common.ts`**

Replace the `multi_treatment_combo`, `sensitive_keyword_minor`, `sensitive_keyword_medical_condition`, and `sensitive_keyword_mental_health` entries (current lines 42-70) with:

```ts
  {
    id: "multi_treatment_combo",
    category: "multi_treatment_combo",
    patterns: [
      /\b(combine|stack|together|same day)\b[^.!?]*\b(botox|filler|laser|peel|skinbooster|profhilo)\b/i,
    ],
    // T1.2b: do not escalate when the user is declining a combo.
    negations: [
      /\b(?:not|don'?t|do not|rather not|prefer not|avoid|without|never)\b[^.!?]{0,20}\b(?:combin\w*|stack\w*|together|same day)\b/i,
    ],
  },
  {
    id: "sensitive_keyword_minor",
    category: "sensitive_keyword",
    patterns: [
      /\b(my (daughter|son)|teenage|under ?\s?(16|18))\b/i,
      // T1.5: self-disclosed age 10-17 (numeric or spelled). The unit lookahead
      // rejects duration/measure phrasings ("16 years of experience", "16 weeks",
      // "160cm"); \b after 1[0-7] rejects "160"; 18 is excluded (can consent).
      /\bi(?:'?m| am| was)\s+(?:only\s+|just\s+|almost\s+|nearly\s+|turning\s+)?(1[0-7]|thirteen|fourteen|fifteen|sixteen|seventeen)\b(?!\s*(?:years?\s+of|weeks?|months?|days?|hours?|min(?:ute)?s?|kg|kgs|lbs?|pounds?|stone|cm|%|percent|sessions?|times?|grand|dollars?))/i,
      /\bi(?:'?m| am)\s+(?:a\s+)?(minor|underage|under ?18|not (?:yet )?18|below 18)\b/i,
    ],
  },
  {
    id: "sensitive_keyword_medical_condition",
    category: "sensitive_keyword",
    patterns: [
      /\b(diabet(es|ic)|hypertension|high blood pressure|cancer|chemo(therapy)?|pacemaker|epilepsy|seizures?)\b/i,
    ],
    // T1.2b: suppress clear self-negations and third-party (family-history)
    // attributions. Tight windows keep a genuine first-person condition escalating.
    negations: [
      /\b(?:not|never|don'?t|doesn'?t|do not|does not|isn'?t|aren'?t|haven'?t|hasn'?t)\b[^.!?]{0,12}\b(?:diabet(?:es|ic)|hypertension|high blood pressure|cancer|chemo(?:therapy)?|pacemaker|epilepsy|seizures?)\b/i,
      /\bno\s+(?:history\s+of\s+|family\s+history\s+of\s+|known\s+|prior\s+)?(?:diabet(?:es|ic)|hypertension|high blood pressure|cancer|chemo(?:therapy)?|pacemaker|epilepsy|seizures?)\b/i,
      /\b(?:my|her|his|their|our)\s+(?:mum|mom|mother|father|dad|sister|brother|aunt|uncle|grand(?:ma|pa|mother|father)|cousin|friend|partner|husband|wife|parent|relative)\b[^.!?]{0,16}\b(?:diabet(?:es|ic)|hypertension|high blood pressure|cancer|chemo(?:therapy)?|pacemaker|epilepsy|seizures?)\b/i,
    ],
  },
  // §2.5 conservative seed addition — mental health keywords.
  // T1.2a: bare "anxious"/"anxiety" removed (it is the designed aesthetic-anxiety
  // objection Alex handles); only clinical forms escalate. Suicidal ideation,
  // self-harm, eating disorders, clinical depression, panic attacks, and anxiety
  // disorder require immediate human review.
  {
    id: "sensitive_keyword_mental_health",
    category: "sensitive_keyword",
    patterns: [
      /\b(depress(ed|ion)|suicidal|self.harm|eating disorder|anorexia|bulimia|panic attacks?|anxiety disorder)\b/i,
    ],
    negations: [
      /\b(?:not|never|don'?t|doesn'?t|do not|does not|isn'?t|aren'?t)\b[^.!?]{0,12}\b(?:depress(?:ed|ion)|suicidal|self.harm|eating disorder|anorexia|bulimia|panic attacks?|anxiety disorder)\b/i,
    ],
  },
```

- [ ] **Step 4: Run the unit suite, verify PASS**

Run: `pnpm --filter @switchboard/core test escalation-triggers/__tests__/common`
Expected: PASS. If a negation window is slightly off for a case, tighten/loosen only that window to satisfy both the "does NOT escalate" and the "STILL escalates" assertions (never widen so far that a first-person condition is suppressed).

- [ ] **Step 5: Add the production-path gate cases (failing → passing through the same change)**

These cases were already enabled by Step 3 (triggers are fixed), so write them now and confirm they pass. In `channel-gateway-deterministic-gate.test.ts`, add imports at the top:

```ts
import {
  loadEscalationTriggers,
  _resetEscalationTriggerCache,
} from "../../governance/escalation-triggers/index.js";
```

Append a new describe block at the end of the file (it reuses the file's existing `makeGatewayConfig`, spies, and `beforeEach`):

```ts
describe("ChannelGateway — freeze-gate live path (real triggers)", () => {
  let postureCache: InMemoryGovernancePostureCache;
  let verdictStore: VerdictStoreSpy;
  let handoffStore: HandoffStoreSpy;
  let statusSetter: StatusSetterSpy;
  let sendSpy: Spy;
  let submitSpy: Spy;

  beforeEach(() => {
    _resetEscalationTriggerCache();
    postureCache = new InMemoryGovernancePostureCache();
    verdictStore = makeVerdictStore();
    handoffStore = makeHandoffStore();
    statusSetter = makeStatusSetter();
    sendSpy = vi.fn().mockResolvedValue(undefined);
    submitSpy = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { response: "Hello from agent" }, summary: "ok" },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    });
  });

  function sgEnforceConfig() {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "resolved",
      config: { jurisdiction: "SG", clinicType: "medical", deterministicGate: { mode: "enforce" } },
    });
    return makeGatewayConfig(
      {
        resolver,
        verdictStore,
        postureCache,
        handoffStore,
        statusSetter,
        triggerLoader: (j: "SG" | "MY") => loadEscalationTriggers(j),
      },
      { platformIngress: { submit: submitSpy } },
    );
  }

  it("T1.5: a self-disclosed minor escalates through the real gate", async () => {
    const gw = new ChannelGateway(sgEnforceConfig());
    await gw.handleIncoming(
      {
        channel: "web_widget",
        token: "tok",
        sessionId: "sess-1",
        text: "hi I'm 16, can I get fillers?",
      },
      { send: sendSpy },
    );
    expect(submitSpy).not.toHaveBeenCalled();
    expect(verdictStore.save).toHaveBeenCalledOnce();
    const v = verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(v.action).toBe("escalate");
    expect(v.reasonCode).toBe("sensitive_inbound");
    expect(statusSetter.setConversationStatus).toHaveBeenCalledWith("sess-1", "human_override", {
      channel: "web_widget",
      principalId: "visitor-sess-1",
    });
    expect(handoffStore.save).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]![0]).toContain(SG_HANDOFF_SUBSTRING);
  });

  it("T1.2a: bare aesthetic anxiety does NOT escalate through the real gate", async () => {
    const gw = new ChannelGateway(sgEnforceConfig());
    await gw.handleIncoming(
      {
        channel: "web_widget",
        token: "tok",
        sessionId: "sess-1",
        text: "I'm so anxious about how I'll look after",
      },
      { send: sendSpy },
    );
    expect(submitSpy).toHaveBeenCalled();
    expect(verdictStore.save).not.toHaveBeenCalled();
    expect(statusSetter.setConversationStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the gate tests, verify PASS**

Run: `pnpm --filter @switchboard/core test channel-gateway-deterministic-gate`
Expected: PASS (existing 13 cases + the 2 new ones).

- [ ] **Step 7: Run the loader test (regression) and typecheck, then commit**

Run: `pnpm --filter @switchboard/core test escalation-triggers loader` then `pnpm --filter @switchboard/core typecheck`
Expected: PASS / no errors (loader id-uniqueness and category-coverage invariants still hold).

```bash
git add packages/core/src/governance/escalation-triggers/common.ts \
  packages/core/src/governance/escalation-triggers/__tests__/common.test.ts \
  packages/core/src/channel-gateway/__tests__/channel-gateway-deterministic-gate.test.ts
git commit -m "fix(governance): narrow escalation over-flagging + flag self-disclosed minors (T1.2a/b, T1.5)"
```

---

## Task 3: T1.2c paraphrase-tolerant substantiation (output path)

**Files:**

- Modify: `packages/core/src/governance/classifier/substantiation-resolver.ts`
- Test: `packages/core/src/governance/classifier/__tests__/substantiation-resolver.test.ts`

- [ ] **Step 1: Write paraphrase tests (failing)**

In `substantiation-resolver.test.ts`, append inside `describe("createSubstantiationResolver", ...)`. The shared `freshClaim()` uses `claimText: "visible slimming"`.

```ts
it("matches a reordered/padded paraphrase of an approved claim (no exact substring)", async () => {
  const resolver = createSubstantiationResolver({
    approvedClaimStore: makeStore([freshClaim()]),
    regulatoryLoader: () => [],
    cache: createInMemoryLRU(),
    clock: () => NOW,
  });
  const res = await resolver.resolve({
    // contains both "slimming" and "visible" but not the substring "visible slimming"
    sentence: "The slimming effect is clearly visible after one session.",
    claimType: "efficacy",
    jurisdiction: "SG",
    deploymentId: "dep_1",
  });
  expect(res.status).toBe("matched");
  expect(res.sourceType).toBe("approved_compliance_claim");
});

it("does NOT match when a key claim term is absent (containment < 1)", async () => {
  const resolver = createSubstantiationResolver({
    approvedClaimStore: makeStore([freshClaim()]),
    regulatoryLoader: () => [],
    cache: createInMemoryLRU(),
    clock: () => NOW,
  });
  const res = await resolver.resolve({
    sentence: "Results are clearly visible after one session.", // missing "slimming"
    claimType: "efficacy",
    jurisdiction: "SG",
    deploymentId: "dep_1",
  });
  expect(res.status).toBe("missing");
});

it("does NOT match a negated paraphrase", async () => {
  const resolver = createSubstantiationResolver({
    approvedClaimStore: makeStore([freshClaim()]),
    regulatoryLoader: () => [],
    cache: createInMemoryLRU(),
    clock: () => NOW,
  });
  const res = await resolver.resolve({
    // all tokens present, but negated, and not the exact substring
    sentence: "The slimming is not really visible yet.",
    claimType: "efficacy",
    jurisdiction: "SG",
    deploymentId: "dep_1",
  });
  expect(res.status).toBe("missing");
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @switchboard/core test substantiation-resolver`
Expected: the reordered-paraphrase case FAILS (verbatim substring misses it); the others pass for the wrong reason today (no match at all). All three must hold after the change.

- [ ] **Step 3: Implement paraphrase tolerance in `matchClaim`**

In `substantiation-resolver.ts`, add module-level helpers after `hashSentence` (line 48):

```ts
const SUBSTANTIATION_STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "and",
  "or",
  "is",
  "are",
  "be",
  "with",
  "for",
  "in",
  "on",
  "our",
  "your",
  "you",
  "that",
  "this",
  "it",
  "at",
  "as",
  "by",
  "we",
  "can",
  "will",
  "may",
  "after",
  "from",
  "most",
]);

const NEGATION_RE = /\b(?:not|never|no|isn'?t|aren'?t|doesn'?t|don'?t|cannot|can'?t|without)\b/i;

function significantTokens(textLower: string): string[] {
  return textLower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !SUBSTANTIATION_STOPWORDS.has(t));
}

/**
 * Conservative paraphrase tolerance (T1.2c): an approved claim matches a sentence
 * when EVERY significant claim token is present in the sentence (order-independent)
 * and the sentence is not negated. This catches reordered / word-inserted
 * paraphrases without ever matching a sentence that omits a key claim term. The
 * failure mode of a fuzzy matcher is a false positive (an unsubstantiated claim
 * allowed), so containment is required at 1.0 plus a negation guard.
 */
function paraphraseMatches(sentenceLower: string, claimLower: string): boolean {
  if (NEGATION_RE.test(sentenceLower)) return false;
  const claimTokens = significantTokens(claimLower);
  if (claimTokens.length === 0) return false;
  const sentenceTokens = new Set(significantTokens(sentenceLower));
  return claimTokens.every((t) => sentenceTokens.has(t));
}
```

Then change the `matchClaim` loop guard (current line 62) from:

```ts
if (!sentenceLower.includes(claim.claimText.toLowerCase())) continue;
```

to:

```ts
const claimLower = claim.claimText.toLowerCase();
if (!sentenceLower.includes(claimLower) && !paraphraseMatches(sentenceLower, claimLower)) {
  continue;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @switchboard/core test substantiation-resolver`
Expected: PASS (all, including the pre-existing substring/stale/missing/cache cases).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: no errors.

```bash
git add packages/core/src/governance/classifier/substantiation-resolver.ts \
  packages/core/src/governance/classifier/__tests__/substantiation-resolver.test.ts
git commit -m "fix(governance): paraphrase-tolerant claim substantiation (T1.2c)"
```

---

## Task 4: Full-gate verification

- [ ] **Step 1: Build, typecheck, full test, format, lint**

Run, from the worktree root:

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm format:check && pnpm lint
```

Expected: green. Known pre-existing flakes that are NOT this branch: `apps/chat` gateway-bridge-attribution (passes isolated), db `pg_advisory` integrity tests. If `pnpm lint` flags `max-lines` on `claim-classifier.ts` as an error (>600), split; a 400-line warning is pre-existing and non-blocking.

- [ ] **Step 2: Eval typechecks (evals/ is not typechecked in CI)**

Run:

```bash
pnpm --filter @switchboard/eval-claim-classifier typecheck
pnpm --filter @switchboard/eval-alex-conversation typecheck
```

Expected: no errors. (We add no new eval imports; this guards against an accidental schema-shape break.) Do NOT run/regenerate the classifier eval baseline — it is infra-RED on main (401) and the prompt-hash is unaffected by these changes.

- [ ] **Step 3: Confirm no Prisma drift was introduced**

Run: `git diff --name-only origin/main -- packages/db/prisma`
Expected: empty (no schema change; the `confidenceThreshold` field lives in a JSON passthrough sub-block).

---

## Self-Review

**Spec coverage:** T1.1 → Task 1. T1.2a → Task 2 (mental_health pattern). T1.2b → Task 2 (negations on medical_condition / multi_treatment_combo / mental_health). T1.2c → Task 3. T1.5 → Task 2 (minor patterns + gate case). Live-path tests: Task 1 (hook), Task 2 (gate). Eval-impact guard: Task 4. All spec requirements have a task.

**Placeholder scan:** every code step contains complete code; every run step has an exact command and expected result. No TBD/TODO.

**Type consistency:** `confidenceThreshold` is the name used in the schema, the resolver result, the hook `decideAction` args, and all tests. `paraphraseMatches(sentenceLower, claimLower)` and `significantTokens(textLower)` signatures are consistent between definition and call site. Trigger ids (`sensitive_keyword_minor`, `sensitive_keyword_medical_condition`, `sensitive_keyword_mental_health`, `multi_treatment_combo`) match `common.ts` exactly. `reasonCode` `sensitive_inbound` matches `REASON_CODE_BY_TRIGGER[sensitive_keyword]` in `escalation-triggers/types.ts`.
