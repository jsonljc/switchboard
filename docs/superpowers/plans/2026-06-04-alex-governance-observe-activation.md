# Alex Governance Observe-Mode Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four afterSkill governance gates run on the live Alex path in a strictly log-only observe posture: fix the two gates whose observe is not lead-safe, seed the canonical observe `governanceConfig` on the medspa pilot, prove log-only on the real executor path in the eval, and surface verdicts on a dual-prom counter.

**Architecture:** Observe differs from enforce ONLY by never mutating lead-visible state (response text, conversation status, handoffs); telemetry is identical wherever possible. The posture is one canonical factory in `@switchboard/schemas`, consumed by the seed, the parity test, and the eval. The counter rides the verdict-store `onWrite` seam so it cannot drift from the system of record.

**Tech Stack:** TypeScript ESM (`.js` import extensions), Zod, Prisma (JSON column, NO migration), vitest, prom-client (dual registries: apps/api + apps/chat).

**Spec:** `docs/superpowers/specs/2026-06-04-alex-governance-observe-activation-design.md`

**Worktree:** `/Users/jasonli/switchboard/.claude/worktrees/alex-governance-observe`, branch `feat/alex-governance-observe-activation`, based on origin/main `055a2100`.

**Standing gotchas for every task:**

- ESM `.js` extensions on relative imports. No `console.log` (use `console.warn`/`console.error`). No `any` (tests in this codebase locally disable the rule where stores are unexported; follow the file's existing pattern).
- Evals import core's BUILT `dist/`: run `pnpm --filter @switchboard/core build` after core edits before running eval vitest. Core tests import schemas' `dist/`: run `pnpm --filter @switchboard/schemas build` after schemas edits.
- Commit subjects lowercase, body lines wrapped at 100 chars, no em-dashes anywhere.
- Do NOT commit `.claude/settings.local.json` (harness state).
- Run commits with the repo hooks active (lint-staged formats); if a hook reformats, re-`git add`.

---

### Task 1: `buildObserveGovernanceConfig` factory in schemas

**Files:**

- Modify: `packages/schemas/src/governance-config.ts` (append at end)
- Create: `packages/schemas/src/governance-config.test.ts`

- [x] **Step 1.1: Write the failing test**

Create `packages/schemas/src/governance-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  GovernanceConfigSchema,
  buildObserveGovernanceConfig,
  resolveGovernanceMode,
  resolveClaimClassifierConfig,
  resolveConsentStateConfig,
  resolveLifecycleTaggingMechanicalConfig,
  resolveLifecycleQualificationConfig,
} from "./governance-config.js";

describe("buildObserveGovernanceConfig", () => {
  const cfg = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

  it("parses under GovernanceConfigSchema and keeps the policy fields", () => {
    const parsed = GovernanceConfigSchema.parse(cfg);
    expect(parsed.jurisdiction).toBe("SG");
    expect(parsed.clinicType).toBe("medical");
  });

  it("puts the deterministic gate (input scanner + output safety gate) in observe", () => {
    expect(resolveGovernanceMode(GovernanceConfigSchema.parse(cfg))).toBe("observe");
  });

  it("puts the claim classifier in observe with resolver defaults intact", () => {
    const resolved = resolveClaimClassifierConfig(GovernanceConfigSchema.parse(cfg));
    expect(resolved.mode).toBe("observe");
    expect(resolved.latencyBudgetMs).toBe(800);
    expect(resolved.model).toBe("claude-haiku-4-5-20251001");
    expect(resolved.confidenceThreshold).toBe(0.7);
  });

  it("puts the consent gate in observe", () => {
    expect(resolveConsentStateConfig(GovernanceConfigSchema.parse(cfg)).mode).toBe("observe");
  });

  it("ships the whatsapp window block enabled in observe with marketing substitution off", () => {
    expect(cfg.whatsappWindow).toEqual({
      enabled: true,
      mode: "observe",
      allowMarketingTemplateSubstitution: false,
    });
  });

  it("keeps both lifecycle tagging layers off", () => {
    const parsed = GovernanceConfigSchema.parse(cfg);
    expect(resolveLifecycleTaggingMechanicalConfig(parsed).mode).toBe("off");
    expect(resolveLifecycleQualificationConfig(parsed).mode).toBe("off");
  });

  it("threads MY/nonMedical through unchanged", () => {
    const my = buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "nonMedical" });
    expect(my.jurisdiction).toBe("MY");
    expect(my.clinicType).toBe("nonMedical");
  });
});
```

- [x] **Step 1.2: Run it, verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- governance-config`
Expected: FAIL (`buildObserveGovernanceConfig` is not exported).

- [x] **Step 1.3: Implement the factory**

Append to `packages/schemas/src/governance-config.ts`:

```typescript
export interface ObserveGovernanceConfigInput {
  jurisdiction: "SG" | "MY";
  clinicType: "medical" | "nonMedical";
}

export interface ObserveGovernanceConfig {
  jurisdiction: "SG" | "MY";
  clinicType: "medical" | "nonMedical";
  deterministicGate: { mode: "observe" };
  claimClassifier: { mode: "observe" };
  consentState: { mode: "observe" };
  whatsappWindow: {
    enabled: boolean;
    mode: "observe";
    allowMarketingTemplateSubstitution: boolean;
  };
  lifecycleTagging: {
    mechanical: { mode: "off" };
    qualification: { mode: "off" };
  };
}

/**
 * Canonical all-gates-observe posture for staged governance rollout: every
 * mode-bearing gate (the shared pre-input/output deterministic gate, the claim
 * classifier, the consent gate, the WhatsApp window gate) runs telemetry-only;
 * lifecycle tagging stays off. Seeds and tests consume THIS factory so the
 * seeded posture, the parity test, and the eval can never drift apart.
 * The off->enforce flip is a deliberate per-gate ops config update on the
 * observe bake, never a default.
 */
export function buildObserveGovernanceConfig(
  input: ObserveGovernanceConfigInput,
): ObserveGovernanceConfig {
  return {
    jurisdiction: input.jurisdiction,
    clinicType: input.clinicType,
    deterministicGate: { mode: "observe" },
    claimClassifier: { mode: "observe" },
    consentState: { mode: "observe" },
    whatsappWindow: {
      enabled: true,
      mode: "observe",
      allowMarketingTemplateSubstitution: false,
    },
    lifecycleTagging: {
      mechanical: { mode: "off" },
      qualification: { mode: "off" },
    },
  };
}
```

- [x] **Step 1.4: Run tests, verify pass; rebuild schemas dist**

Run: `pnpm --filter @switchboard/schemas test -- governance-config && pnpm --filter @switchboard/schemas build`
Expected: PASS, build clean.

- [x] **Step 1.5: Commit**

```bash
git add packages/schemas/src/governance-config.ts packages/schemas/src/governance-config.test.ts
git commit -m "feat(schemas): add buildObserveGovernanceConfig posture factory"
```

---

### Task 2: PDPA consent gate observe hardening

**Files:**

- Modify: `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts` (the `decision.action === "block"` branch and the two `else if (consentConfig.mode === "enforce")` disclosure branches)
- Modify: `packages/core/src/skill-runtime/hooks/__tests__/pdpa-consent-gate.test.ts` (extend; reuse `buildDeps`/`SG_CFG`/`ctx` already in the file)

- [x] **Step 2.1: Write the failing tests**

Add to `pdpa-consent-gate.test.ts` (inside the existing `describe("PdpaConsentGateHook")`; mirror the existing revoked/blocked test's consent fixture for `consentRevokedAt`):

```typescript
it("observe mode logs the revoked-race instead of blocking", async () => {
  const { deps, verdictStore, handoffStore, conversationStore } = buildDeps({
    resolution: {
      status: "resolved",
      config: { ...SG_CFG, consentState: { mode: "observe" } },
    },
    consent: {
      pdpaJurisdiction: "SG",
      consentGrantedAt: "2026-05-01T00:00:00.000Z",
      consentRevokedAt: "2026-05-20T00:00:00.000Z",
      consentSource: null,
      aiDisclosureVersionShown: null,
      aiDisclosureShownAt: null,
      consentUpdatedBy: null,
      consentNotes: null,
    },
  });
  const hook = new PdpaConsentGateHook(deps);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = { response: "original reply", toolCalls: [], tokenUsage: {}, trace: [] } as any;

  await hook.afterSkill(ctx, result);

  expect(result.response).toBe("original reply");
  expect(conversationStore.setConversationStatus).not.toHaveBeenCalled();
  expect(handoffStore.save).not.toHaveBeenCalled();
  expect(verdictStore.save).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "allow",
      auditLevel: "warning",
      reasonCode: "consent_revoked",
      details: expect.objectContaining({
        event: "defense_in_depth_revoked_race",
        wouldBlock: true,
      }),
    }),
  );
});

it("observe mode persists the disclosure_not_shown verdict", async () => {
  const { deps, verdictStore } = buildDeps({
    resolution: {
      status: "resolved",
      config: { ...SG_CFG, consentState: { mode: "observe" } },
    },
  });
  const hook = new PdpaConsentGateHook(deps);
  // Response WITHOUT the SG disclosure text; consent fixture has aiDisclosureShownAt null.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = {
    response: "Sure, we have slots on Friday.",
    toolCalls: [],
    tokenUsage: {},
    trace: [],
  } as any;

  await hook.afterSkill(ctx, result);

  expect(result.response).toBe("Sure, we have slots on Friday.");
  expect(verdictStore.save).toHaveBeenCalledWith(
    expect.objectContaining({ reasonCode: "disclosure_not_shown", action: "allow" }),
  );
});

it("observe mode persists the disclosure_version_outdated verdict", async () => {
  const { deps, verdictStore } = buildDeps({
    resolution: {
      status: "resolved",
      config: { ...SG_CFG, consentState: { mode: "observe" } },
    },
    consent: {
      pdpaJurisdiction: "SG",
      consentGrantedAt: null,
      consentRevokedAt: null,
      consentSource: null,
      aiDisclosureVersionShown: "0.0.1",
      aiDisclosureShownAt: "2026-05-01T00:00:00.000Z",
      consentUpdatedBy: null,
      consentNotes: null,
    },
  });
  const hook = new PdpaConsentGateHook(deps);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = {
    response: "Sure, we have slots on Friday.",
    toolCalls: [],
    tokenUsage: {},
    trace: [],
  } as any;

  await hook.afterSkill(ctx, result);

  expect(result.response).toBe("Sure, we have slots on Friday.");
  expect(verdictStore.save).toHaveBeenCalledWith(
    expect.objectContaining({ reasonCode: "disclosure_version_outdated", action: "allow" }),
  );
});
```

Adjust the `details`/version literals to the file's actual fixtures if they differ (read the existing enforce-mode revoked test first; the enforce expectations must stay untouched).

- [x] **Step 2.2: Run, verify the new tests fail**

Run: `pnpm --filter @switchboard/core test -- pdpa-consent-gate`
Expected: the revoked-race observe test FAILS (response was mutated; handoff saved); the two disclosure tests FAIL (no verdict saved in observe).

- [x] **Step 2.3: Implement**

In `pdpa-consent-gate.ts`, replace the start of the `if (decision.action === "block") {` branch so observe records and returns before any mutation:

```typescript
    if (decision.action === "block") {
      // Defense-in-depth: revoked-race (gateway scanner should have caught this already).
      // Observe is telemetry-only: record what enforce WOULD have blocked, mutate nothing.
      if (consentConfig.mode !== "enforce") {
        await this.saveVerdict({
          reasonCode: "consent_revoked",
          action: "allow",
          auditLevel: "warning",
          jurisdiction: config.jurisdiction,
          clinicType: config.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: { event: "defense_in_depth_revoked_race", wouldBlock: true },
          deploymentId: ctx.deploymentId,
        });
        return;
      }
      const originalText = result.response;
      // ... existing enforce block body unchanged from here ...
```

Then change BOTH disclosure verdict branches from `} else if (consentConfig.mode === "enforce") {` to `} else {` (mode is never "off" past the early return, so observe and enforce both persist the verdict; neither branch mutates).

- [x] **Step 2.4: Run the gate suite, verify all pass (enforce behavior unchanged)**

Run: `pnpm --filter @switchboard/core test -- pdpa-consent-gate`
Expected: PASS, including all pre-existing enforce/missing/error tests.

- [x] **Step 2.5: Commit**

```bash
git add packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts packages/core/src/skill-runtime/hooks/__tests__/pdpa-consent-gate.test.ts
git commit -m "fix(core): make pdpa consent gate observe mode strictly log-only"
```

---

### Task 3: Claim classifier observe mode off the hot path

**Files:**

- Modify: `packages/core/src/skill-runtime/hooks/claim-classifier.ts` (refactor `afterSkill`, add `classifyAndApply` + `flushObserveRuns`)
- Modify: `packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts` (new fire-and-forget tests; add `flushObserveRuns()` to existing observe tests)

- [x] **Step 3.1: Write the failing tests**

Add helpers + tests to `claim-classifier.test.ts` (reuse the file's existing `fakeResolver`, `fakePostureCache`, verdict/handoff/conversation fakes, `ctx`, and result builders; the code below names them per the file's conventions, adjust identifiers to match when editing):

```typescript
// Classifier gated on a manually released promise: classify() does not resolve
// until release() is called. Proves observe never awaits the pipeline.
function gatedClassifier(claimType: ClaimType): {
  classifier: AnthropicClaimClassifier;
  release: () => void;
} {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const classifier: AnthropicClaimClassifier = {
    classify: async ({ sentence, model }) => {
      await gate;
      return {
        result: { sentence, claimType, confidence: 0.95 },
        promptVersion: "claim-classifier@1.0.0",
        promptHash: "0123456789abcdef",
        schemaVersion: "1.0.0",
        model,
      };
    },
  };
  return { classifier, release };
}

it("observe mode resolves afterSkill without awaiting the classifier", async () => {
  const { classifier, release } = gatedClassifier("medical-advice");
  // build hook with fakeResolver("observe") and this classifier
  // ... deps per file convention ...
  const result = /* result with response "This will cure your acne." */;

  await hook.afterSkill(HOOK_CTX, result);

  // afterSkill returned while classify() is still gated: nothing persisted yet,
  // response untouched. THIS is the zero-added-latency guarantee.
  expect(result.response).toBe("This will cure your acne.");
  expect(verdictStore.saved).toHaveLength(0);

  release();
  await hook.flushObserveRuns();

  expect(verdictStore.saved).toHaveLength(1);
  expect(verdictStore.saved[0]).toMatchObject({ action: "allow", auditLevel: "warning" });
  expect(result.response).toBe("This will cure your acne.");
  expect(handoffStore.saved).toHaveLength(0);
});

it("observe mode swallows a pipeline failure without touching the reply", async () => {
  // efficacy claim routes through substantiationResolver; make it throw so the
  // pipeline itself rejects (classifier errors are absorbed earlier as outcomes).
  const throwingSubstantiation: SubstantiationResolver = {
    resolve: async () => {
      throw new Error("substantiation backend down");
    },
  };
  // build hook with fakeResolver("observe"), fakeClassifier flagging "efficacy",
  // and throwingSubstantiation ...
  const result = /* response "Visible slimming after one session." */;

  await hook.afterSkill(HOOK_CTX, result);
  await hook.flushObserveRuns(); // must not throw

  expect(result.response).toBe("Visible slimming after one session.");
  expect(handoffStore.saved).toHaveLength(0);
});
```

Also UPDATE every existing observe-mode test in this file to call `await hook.flushObserveRuns();` after `await hook.afterSkill(...)` and before asserting persisted verdicts (fire-and-forget means persistence completes off the awaited path). Enforce-mode tests stay untouched.

- [x] **Step 3.2: Run, verify failures**

Run: `pnpm --filter @switchboard/core test -- claim-classifier`
Expected: new tests FAIL (`flushObserveRuns` not a function; observe currently awaits so `saved` is 1 before release).

- [x] **Step 3.3: Implement the fork**

In `claim-classifier.ts`, add to the class:

```typescript
  private readonly pendingObserveRuns = new Set<Promise<void>>();

  /**
   * Awaits any in-flight observe-mode classification pipelines. Tests use this
   * for determinism; production never needs to await it (observe is telemetry).
   */
  async flushObserveRuns(): Promise<void> {
    await Promise.allSettled([...this.pendingObserveRuns]);
  }
```

Replace the tail of `afterSkill` (everything from `const outcomes = await runClassifier({...})` through the `hasRewrite` block) with:

```typescript
    if (classifierConfig.mode === "observe") {
      // Observe is telemetry-only: run the classification pipeline fire-and-forget so
      // the lead-visible reply pays zero added latency (precedent: the #859 trace
      // recorder on this same path). The pipeline gets a DETACHED result clone, so even
      // a regression in the apply helpers cannot touch the live reply.
      const detached: SkillExecutionResult = { ...result };
      const run = this.classifyAndApply({
        ctx,
        result: detached,
        sentences,
        classifierConfig,
        jurisdiction,
        clinicType,
      }).catch((err) => {
        console.error("[claim-classifier] observe pipeline failed", err);
      });
      this.pendingObserveRuns.add(run);
      void run.finally(() => this.pendingObserveRuns.delete(run));
      return;
    }

    await this.classifyAndApply({ ctx, result, sentences, classifierConfig, jurisdiction, clinicType });
  }

  private async classifyAndApply(args: {
    ctx: SkillHookContext;
    result: SkillExecutionResult;
    sentences: readonly string[];
    classifierConfig: ClaimClassifierConfig;
    jurisdiction: "SG" | "MY";
    clinicType: "medical" | "nonMedical";
  }): Promise<void> {
    const { ctx, result, sentences, classifierConfig, jurisdiction, clinicType } = args;

    const outcomes = await runClassifier({
      sentences,
      model: classifierConfig.model,
      latencyBudgetMs: classifierConfig.latencyBudgetMs,
      classifier: this.deps.classifier,
    });

    const actions: SentenceAction[] = [];
    // outcomes[i] and sentences[i] are always defined — both arrays have the same
    // length by construction (runClassifier maps 1:1 over input.sentences).
    for (let i = 0; i < outcomes.length; i++) {
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
    }

    const hasEscalate = actions.some((a) => a.kind === "escalate");
    const hasRewrite = actions.some((a) => a.kind === "rewrite");

    if (hasEscalate) {
      await this.applyEscalate({
        ctx,
        result,
        actions,
        jurisdiction,
        clinicType,
        mode: classifierConfig.mode,
      });
      return;
    }

    if (hasRewrite) {
      await this.applyRewrites({
        ctx,
        result,
        actions,
        jurisdiction,
        clinicType,
        mode: classifierConfig.mode,
      });
      return;
    }
  }
```

Import `type ClaimClassifierConfig` from `@switchboard/schemas` (extend the existing import line). `runClassifier`'s `sentences` parameter type may need `[...sentences]` if it requires a mutable array; match the existing call.

- [x] **Step 3.4: Run the suite**

Run: `pnpm --filter @switchboard/core test -- claim-classifier`
Expected: PASS (all enforce tests untouched and green; observe tests green with flush).

- [x] **Step 3.5: Commit**

```bash
git add packages/core/src/skill-runtime/hooks/claim-classifier.ts packages/core/src/skill-runtime/hooks/__tests__/claim-classifier.test.ts
git commit -m "feat(core): claim classifier observe mode runs off the hot path"
```

---

### Task 4: Seed the canonical observe config on the medspa pilot

**Files:**

- Create: `packages/db/src/seed/medspa-governance-config.ts`
- Create: `packages/db/src/seed/__tests__/medspa-governance-config.test.ts`
- Modify: `packages/db/prisma/seed-marketplace.ts` (import + the Alex `agentDeployment.upsert` update AND create branches)

- [x] **Step 4.1: Write the failing parity test**

Create `packages/db/src/seed/__tests__/medspa-governance-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  GovernanceConfigSchema,
  buildObserveGovernanceConfig,
  resolveGovernanceMode,
  resolveClaimClassifierConfig,
  resolveConsentStateConfig,
  resolveLifecycleTaggingMechanicalConfig,
  resolveLifecycleQualificationConfig,
} from "@switchboard/schemas";
import type { WhatsAppWindowGateConfig } from "@switchboard/core";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "../medspa-governance-config.js";

// Producer-parity net: the LITERAL value the seed writes must parse and resolve to a
// strictly observe (log-only) posture for every gate. A schema/resolver change that
// silently de-activates or escalates the seeded posture reds this file.
describe("MEDSPA_PILOT_GOVERNANCE_CONFIG (the literal seeded blob)", () => {
  it("is exactly the canonical observe posture for SG/medical", () => {
    expect(MEDSPA_PILOT_GOVERNANCE_CONFIG).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
    );
  });

  it("parses under GovernanceConfigSchema", () => {
    expect(() => GovernanceConfigSchema.parse(MEDSPA_PILOT_GOVERNANCE_CONFIG)).not.toThrow();
  });

  it("resolves observe for every mode-bearing gate and off for lifecycle tagging", () => {
    const parsed = GovernanceConfigSchema.parse(MEDSPA_PILOT_GOVERNANCE_CONFIG);
    expect(resolveGovernanceMode(parsed)).toBe("observe");
    expect(resolveClaimClassifierConfig(parsed).mode).toBe("observe");
    expect(resolveConsentStateConfig(parsed).mode).toBe("observe");
    expect(resolveLifecycleTaggingMechanicalConfig(parsed).mode).toBe("off");
    expect(resolveLifecycleQualificationConfig(parsed).mode).toBe("off");
  });

  it("matches the whatsapp window gate's config block shape (compile-time pin)", () => {
    // The gate casts this block without Zod validation (whatsapp-window-gate.ts
    // resolveConfig); this assignment breaks at typecheck if the gate's config
    // interface gains or renames a required field.
    const block: Omit<WhatsAppWindowGateConfig, "jurisdiction" | "clinicType"> =
      MEDSPA_PILOT_GOVERNANCE_CONFIG.whatsappWindow;
    expect(block).toEqual({
      enabled: true,
      mode: "observe",
      allowMarketingTemplateSubstitution: false,
    });
  });
});
```

(`WhatsAppWindowGateConfig` is exported from the core barrel via skill-runtime. If `@switchboard/core` root does not re-export it, import from `@switchboard/core/skill-runtime`.)

- [x] **Step 4.2: Run, verify it fails**

Run: `pnpm --filter @switchboard/db test -- medspa-governance-config`
Expected: FAIL (module does not exist).

- [x] **Step 4.3: Create the constant**

Create `packages/db/src/seed/medspa-governance-config.ts`:

```typescript
import { buildObserveGovernanceConfig } from "@switchboard/schemas";

/**
 * Seeded governance posture for the medspa pilot (Glow Aesthetics): Singapore
 * jurisdiction, medical clinic, every gate in observe (strictly log-only).
 * Seeding this is what makes the four afterSkill gates RUN; the off->enforce
 * flip stays a deliberate per-gate ops config update gated on the observe bake.
 * See docs/superpowers/specs/2026-06-04-alex-governance-observe-activation-design.md.
 */
export const MEDSPA_PILOT_GOVERNANCE_CONFIG = buildObserveGovernanceConfig({
  jurisdiction: "SG",
  clinicType: "medical",
});
```

- [x] **Step 4.4: Run, verify pass**

Run: `pnpm --filter @switchboard/db test -- medspa-governance-config`
Expected: PASS. (If `@switchboard/schemas` dist is stale, `pnpm --filter @switchboard/schemas build` first.)

- [x] **Step 4.5: Wire the seed**

In `packages/db/prisma/seed-marketplace.ts`:

1. Add the import next to the existing fixture imports at the top:

```typescript
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "../src/seed/medspa-governance-config.js";
```

(Precedent: `prisma/seed.ts` already imports `../src/seed/*.js` modules.)

2. In the Alex deployment upsert (the block keyed on the `alex-conversion` listing, around lines 629-691), add `governanceConfig` to BOTH branches, after `governanceSettings`:

```typescript
      // SMB launch posture: auto-allow Alex's revenue-path tool calls (CRM
      // writes, bookings) without per-action approval. trustScore still rises
      // as earned confidence; this override only sets day-one friction.
      governanceSettings: { trustLevelOverride: "autonomous" },
      // Staged governance rollout: all four afterSkill gates + the pre-input
      // scanner run in observe (log-only). Enforce is an ops flip on the bake.
      governanceConfig: MEDSPA_PILOT_GOVERNANCE_CONFIG,
      connectionIds: [],
```

(The `update` branch carries the existing comment; in `create` add the same `governanceConfig` line. Only the Alex upsert changes; sales-pipeline/Riley/Mira deployments are untouched.)

- [x] **Step 4.6: Typecheck the seed wiring**

Run: `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/db test`
Expected: PASS (Prisma `Json` columns accept the typed literal; db suite has pre-existing pg_advisory/ledger/greeting failures ONLY when Postgres is down: those are documented flakes, everything else green).

- [x] **Step 4.7: Commit**

```bash
git add packages/db/src/seed/medspa-governance-config.ts packages/db/src/seed/__tests__/medspa-governance-config.test.ts packages/db/prisma/seed-marketplace.ts
git commit -m "feat(db): seed observe-mode governanceConfig on the medspa pilot"
```

---

### Task 5: Governance verdict counter (dual-prom, store onWrite seam)

**Files:**

- Modify: `packages/core/src/telemetry/metrics.ts` (interface + in-memory factory)
- Create: `packages/core/src/telemetry/verdict-metrics.ts`
- Create: `packages/core/src/telemetry/verdict-metrics.test.ts`
- Modify: `packages/core/src/telemetry/index.ts` (export the new module)
- Modify: `apps/api/src/metrics.ts` and `apps/chat/src/bootstrap/metrics.ts` (register the counter)
- Modify: `apps/api/src/bootstrap/skill-mode.ts:152` and `apps/chat/src/gateway/gateway-bridge.ts:138` (pass `onWrite`)

- [x] **Step 5.1: Write the failing test**

Create `packages/core/src/telemetry/verdict-metrics.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { setMetrics, createInMemoryMetrics } from "./metrics.js";
import { recordGovernanceVerdictMetric } from "./verdict-metrics.js";
import type { GovernanceVerdictRecord } from "../governance/governance-verdict-store/types.js";

const record: GovernanceVerdictRecord = {
  id: "v1",
  deploymentId: "dep_1",
  conversationId: "sess_1",
  action: "allow",
  reasonCode: "consent_revoked",
  jurisdiction: "SG",
  clinicType: "medical",
  sourceGuard: "consent_gate",
  auditLevel: "warning",
  decidedAt: "2026-06-04T00:00:00.000Z",
  details: null,
  createdAt: "2026-06-04T00:00:00.000Z",
};

afterEach(() => {
  setMetrics(createInMemoryMetrics());
});

describe("recordGovernanceVerdictMetric", () => {
  it("increments the counter with the verdict's label set", async () => {
    const inc = vi.fn();
    setMetrics({
      ...createInMemoryMetrics(),
      governanceVerdictsRecorded: { inc },
    });

    await recordGovernanceVerdictMetric(record);

    expect(inc).toHaveBeenCalledWith({
      deployment_id: "dep_1",
      source_guard: "consent_gate",
      action: "allow",
      audit_level: "warning",
    });
  });
});
```

(Adjust the `GovernanceVerdictRecord` literal to the exact interface fields if any are missing; read `governance-verdict-store/types.ts` when editing.)

- [x] **Step 5.2: Run, verify failures**

Run: `pnpm --filter @switchboard/core test -- verdict-metrics`
Expected: FAIL (module missing; then interface missing the counter).

- [x] **Step 5.3: Implement**

1. `packages/core/src/telemetry/metrics.ts`: add to `SwitchboardMetrics` after `skillLlmCostUsdTotal`:

```typescript
governanceVerdictsRecorded: Counter;
```

and to `createInMemoryMetrics()`:

```typescript
    governanceVerdictsRecorded: new InMemoryCounter(),
```

2. Create `packages/core/src/telemetry/verdict-metrics.ts`:

```typescript
import { getMetrics } from "./metrics.js";
import type { GovernanceVerdictRecord } from "../governance/governance-verdict-store/types.js";

/**
 * Verdict-store onWrite hook: mirrors every persisted GovernanceVerdict row into
 * the process's metrics registry (api and chat both register the counter, so the
 * pre-input gate and the four afterSkill gates are covered wherever they run).
 * Counting at the write seam keeps the metric incapable of drifting from the
 * system of record. Never throws.
 */
export async function recordGovernanceVerdictMetric(
  record: GovernanceVerdictRecord,
): Promise<void> {
  getMetrics().governanceVerdictsRecorded.inc({
    deployment_id: record.deploymentId,
    source_guard: record.sourceGuard,
    action: record.action,
    audit_level: record.auditLevel,
  });
}
```

3. Export it from `packages/core/src/telemetry/index.ts` (mirror the existing export lines).

4. Register the prom counter in BOTH `apps/api/src/metrics.ts` and `apps/chat/src/bootstrap/metrics.ts` `createPromMetrics()` returns, after `skillLlmCostUsdTotal`:

```typescript
    governanceVerdictsRecorded: new PromCounter(
      "switchboard_governance_verdicts_total",
      "Governance gate verdicts persisted, by deployment, source guard, action, and audit level",
      ["deployment_id", "source_guard", "action", "audit_level"],
    ),
```

5. Wire the seam:

`apps/api/src/bootstrap/skill-mode.ts:152`:

```typescript
const governanceVerdictStore = new PrismaGovernanceVerdictStore(prismaClient, {
  onWrite: recordGovernanceVerdictMetric,
});
```

`apps/chat/src/gateway/gateway-bridge.ts:138`:

```typescript
const gatewayGovernanceVerdictStore = new PrismaGovernanceVerdictStore(prisma, {
  onWrite: recordGovernanceVerdictMetric,
});
```

Add `recordGovernanceVerdictMetric` to each file's `@switchboard/core` import.

6. Grep for other `SwitchboardMetrics` literal implementations that now miss the field:

Run: `grep -rln "skillLlmCostUsdTotal" --include="*.ts" packages apps | grep -v dist`
Fix any full-literal constructions (known candidate: `trace-persistence-hook.test.ts`) by adding `governanceVerdictsRecorded` or spreading `createInMemoryMetrics()`.

- [x] **Step 5.4: Run core + both app suites**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/core test -- verdict-metrics && pnpm --filter @switchboard/api test && pnpm --filter @switchboard/chat test`
Expected: PASS (chat `gateway-bridge-attribution` may flake under load: pre-existing; rerun isolated if hit).

- [x] **Step 5.5: Commit**

```bash
git add packages/core/src/telemetry/ apps/api/src/metrics.ts apps/api/src/bootstrap/skill-mode.ts apps/chat/src/bootstrap/metrics.ts apps/chat/src/gateway/gateway-bridge.ts
git commit -m "feat(governance): count persisted verdicts dual-prom via the store onWrite seam"
```

---

### Task 6: Eval observe-mode live-path proof

**Files:**

- Modify: `evals/alex-conversation/__tests__/governed-live-path.test.ts` (new describe block; keep the existing enforce FIRES/BITES block untouched)

- [x] **Step 6.1: Rebuild core dist (eval imports dist, not src)**

Run: `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/core build`

- [x] **Step 6.2: Write the failing-then-green observe test**

Append to `governed-live-path.test.ts`:

```typescript
import {
  ClaimClassifierHook,
  PdpaConsentGateHook,
  WhatsAppWindowGateHook,
} from "@switchboard/core/skill-runtime";
import { buildObserveGovernanceConfig } from "@switchboard/schemas";

// ---------- observe posture: all four gates, strictly log-only ----------
//
// Drives the REAL executor with the REAL four gates in production order
// (safety -> claim -> pdpa -> whatsapp) under the CANONICAL seeded posture
// (buildObserveGovernanceConfig, the same factory the medspa pilot seed uses),
// with every gate's trigger condition firing at once. Lead-safety contract:
// the reply must come back byte-identical, with verdicts recorded and zero
// handoffs/status writes. This is the test that reds if any observe path
// regresses into mutating lead-visible state.

const OBSERVE_CONFIG = buildObserveGovernanceConfig({
  jurisdiction: "SG",
  clinicType: "medical",
});

const CLAIM_SENTENCE = "This treatment will cure your acne for good.";
const OBSERVE_REPLY = `We deliver ${BANNED_PHRASE} for every client. ${CLAIM_SENTENCE}`;

function observeReplyAdapter() {
  return {
    chatWithTools: async () => ({
      content: [{ type: "text" as const, text: OBSERVE_REPLY }],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 10, outputTokens: 8 },
    }),
  };
}

type SavedVerdict = { sourceGuard: string; action: string; auditLevel: string };

function buildObserveGates() {
  const verdicts: SavedVerdict[] = [];
  const verdictStore = {
    save: async (v: SavedVerdict) => {
      verdicts.push(v);
      return {};
    },
  };
  const handoffSaves: unknown[] = [];
  const handoffStore = {
    save: async (h: unknown) => {
      handoffSaves.push(h);
    },
  };
  const statusWrites: unknown[] = [];
  const conversationStore = {
    setConversationStatus: async (...args: unknown[]) => {
      statusWrites.push(args);
    },
  };
  const resolver = async () => ({ status: "resolved" as const, config: OBSERVE_CONFIG });
  const clock = () => new Date("2026-06-04T12:00:00.000Z");

  const safety = new DeterministicSafetyGateHook({
    governanceConfigResolver: resolver,
    bannedPhraseLoader: () => [
      {
        id: "test-guarantee",
        category: "guarantee" as const,
        patterns: [BANNED_PHRASE],
        severity: "block" as const,
      },
    ],
    verdictStore,
    handoffStore,
    conversationStore,
    postureCache: new InMemoryGovernancePostureCache(),
    clock,
  } as never);

  const claim = new ClaimClassifierHook({
    governanceConfigResolver: resolver,
    postureCache: new InMemoryGovernancePostureCache(),
    classifier: {
      classify: async ({ sentence, model }: { sentence: string; model: string }) => ({
        result: {
          sentence,
          claimType: sentence === CLAIM_SENTENCE ? ("medical-advice" as const) : ("none" as const),
          confidence: 0.95,
        },
        promptVersion: "claim-classifier@1.0.0",
        promptHash: "0123456789abcdef",
        schemaVersion: "1.0.0",
        model,
      }),
    },
    substantiationResolver: { resolve: async () => ({ status: "unmatched" as const }) },
    rewriteLoader: () => [],
    verdictStore,
    handoffStore,
    conversationStore,
    splitSentences: (text: string) => text.split(/(?<=[.!?])\s+/),
    clock,
    renderHandoff: () => "handoff",
  } as never);

  const pdpa = new PdpaConsentGateHook({
    governanceConfigResolver: resolver,
    postureCache: new InMemoryGovernancePostureCache(),
    consentService: {
      attachToGovernedInteraction: async () => {},
      recordDisclosureShown: async () => {},
      recordGrant: async () => {},
      recordRevocation: async () => {},
      clearConsent: async () => {},
    },
    contactConsentReader: {
      read: async () => ({
        pdpaJurisdiction: "SG" as const,
        consentGrantedAt: "2026-05-01T00:00:00.000Z",
        consentRevokedAt: "2026-05-20T00:00:00.000Z",
        consentSource: null,
        aiDisclosureVersionShown: null,
        aiDisclosureShownAt: null,
        consentUpdatedBy: null,
        consentNotes: null,
      }),
    },
    sessionContactResolver: async () => "contact-1",
    verdictStore,
    handoffStore,
    conversationStore,
    clock,
  } as never);

  const whatsapp = new WhatsAppWindowGateHook({
    verdictStore,
    handoffStore,
    governanceConfigResolver: resolver,
    postureCache: { lastKnown: () => undefined, remember: () => {} },
    threadStore: {
      // 25h ago: outside the 24h window.
      getLastWhatsAppInboundAt: async () => new Date("2026-06-03T11:00:00.000Z"),
    },
    contactStore: { getMessagingOptInForThread: async () => false },
    channelTypeResolver: { resolve: async () => "whatsapp" },
    clock,
  } as never);

  return { hooks: [safety, claim, pdpa, whatsapp], claim, verdicts, handoffSaves, statusWrites };
}

describe("governed live-path: observe posture is strictly log-only", () => {
  it("returns the reply byte-identical while recording verdicts, with zero handoffs/status writes", async () => {
    const { hooks, claim, verdicts, handoffSaves, statusWrites } = buildObserveGates();
    const executor = new SkillExecutorImpl(observeReplyAdapter(), new Map(), undefined, hooks);

    const result: SkillExecutionResult = await executor.execute({
      ...execParams,
      sessionId: "eval-observe",
    });
    await claim.flushObserveRuns();

    // Lead-safety: byte-identical reply even with every gate's trigger firing.
    expect(result.response).toBe(OBSERVE_REPLY);

    // Telemetry: every gate recorded its would-fire signal.
    const guards = verdicts.map((v) => v.sourceGuard);
    expect(guards).toContain("banned_phrase_scanner");
    expect(guards).toContain("claim_classifier");
    expect(guards).toContain("consent_gate");
    expect(guards).toContain("whatsapp_window");

    // Strictly log-only: nothing escalated, nothing rewritten, nobody handed off.
    expect(handoffSaves).toHaveLength(0);
    expect(statusWrites).toHaveLength(0);
  });
});
```

Merge the imports into the file's existing import statements (one import block per module). Adjust stub literal types to satisfy the dist type surface; the `as never` constructor convention is established in this file.

- [x] **Step 6.3: Run the eval unit suite**

Run: `pnpm exec vitest run --config evals/vitest.config.ts -t "observe posture"`
Expected: PASS. Then run the whole config: `pnpm exec vitest run --config evals/vitest.config.ts`
Expected: PASS (all suites; deterministic, no API key).

- [x] **Step 6.4: Adversarial bite demonstrations (NOT committed)**

1. In `pdpa-consent-gate.ts`, temporarily revert the observe guard (make the revoked-race block unconditional again), `pnpm --filter @switchboard/core build`, rerun Step 6.3.
   Expected: the observe test REDS (response mutated to handoff text). Restore the guard, rebuild, rerun green. Record the red output for the PR body.
2. In `claim-classifier.ts`, temporarily change the observe branch to `await` the pipeline with a hanging classifier... (skip: the unit test in Task 3 already proves non-awaiting deterministically; the PDPA demonstration is the live-path bite). Record outputs.

- [x] **Step 6.5: Commit**

```bash
git add evals/alex-conversation/__tests__/governed-live-path.test.ts
git commit -m "test(evals): observe-posture live-path proof for the four governance gates"
```

---

### Task 7: Full gate, docs, and verification sweep

**Files:** none new (verification + possible small fixes)

- [x] **Step 7.1: Classifier eval invariance check**

Run: `git diff --stat origin/main -- packages/core/src/governance/classifier/ evals/claim-classifier/`
Expected: EMPTY (no classifier-layer or classifier-eval edits; prompt-hash and locked baseline cannot have shifted).

- [x] **Step 7.2: Full local gate**

Run, in order, from the worktree root:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm format:check
pnpm lint
pnpm arch:check
pnpm exec vitest run --config evals/vitest.config.ts
```

Expected: all green. Known pre-existing failures that do NOT block (document in PR if hit): chat `gateway-bridge-attribution` under full-suite load (passes isolated); db `pg_advisory`/ledger/greeting tests without local Postgres (CI mocks Prisma).

- [x] **Step 7.3: Optional Postgres smoke (only if reachable)**

Run: `pg_isready -h localhost 2>/dev/null && pnpm db:seed && node -e "/* select governanceConfig from AgentDeployment for org_demo alex and print */"`
Expected (if Postgres up): seed completes; the Alex deployment row shows the observe blob. Skip silently if Postgres is down (parity test is the gate).

- [x] **Step 7.4: File-size + import-extension sweep on touched files**

Run: `wc -l packages/core/src/skill-runtime/hooks/claim-classifier.ts packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`
Expected: both under 600 raw lines (claim-classifier lands ~460; acceptable, error threshold is 600).

- [x] **Step 7.5: Commit any sweep fixes, then push**

```bash
git push -u origin feat/alex-governance-observe-activation
```

---

## Execution notes

- Tasks 1 and 4/5/6 depend on schemas/core dist rebuilds; never run eval vitest against stale dist.
- Tasks 2, 3 are independent of each other; Task 4 depends on Task 1; Task 6 depends on Tasks 1, 2, 3 (+5 only for the build); Task 5 is independent.
- The PR body must carry: verify-first findings (what #865 already shipped), the re-rank rationale, the bite-demonstration outputs, the runbook (seed command, bake-read SQL + counter, per-gate enforce-flip payloads, rollback), and the blast-radius list from spec section 6.
- NO auto-merge. Human sign-off required.
