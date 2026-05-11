import { describe, it, expect } from "vitest";
import { ClaimClassifierHook } from "../claim-classifier.js";
import type { AnthropicClaimClassifier } from "../../../governance/classifier/anthropic-classifier.js";
import type { SubstantiationResolver } from "../../../governance/classifier/substantiation-resolver.js";
import type { RewriteTemplateEntry } from "../../../governance/classifier/rewrite-templates/index.js";
import type { GovernanceConfigResolver } from "../../../governance/governance-config-resolver.js";
import type { GovernancePostureCache } from "../../../governance/posture-cache.js";
import type { GovernanceVerdictStore } from "../../../governance/governance-verdict-store/index.js";
import { splitSentences } from "../../../governance/text/sentence-splitter.js";
import type { SkillHookContext, SkillExecutionResult } from "../../types.js";
import type { ClaimType } from "@switchboard/schemas";

function fakeResolver(
  mode: "off" | "observe" | "enforce" | "missing" | "error",
  latencyBudgetMs = 800,
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
        claimClassifier: { mode, latencyBudgetMs, model: "claude-haiku-4-5-20251001" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    };
  };
}

function fakePostureCache(initial?: {
  mode: "off" | "observe" | "enforce";
}): GovernancePostureCache {
  const map = new Map<
    string,
    {
      mode: "off" | "observe" | "enforce";
      jurisdiction: "SG" | "MY";
      clinicType: "medical" | "nonMedical";
    }
  >();
  if (initial) map.set("dep_1", { mode: initial.mode, jurisdiction: "SG", clinicType: "medical" });
  return {
    remember: (id, posture) => map.set(id, posture),
    lastKnown: (id) => map.get(id),
  };
}

function fakeClassifier(outcomes: Record<string, ClaimType>): AnthropicClaimClassifier {
  return {
    classify: async ({ sentence, model }) => ({
      result: { sentence, claimType: outcomes[sentence] ?? "none", confidence: 0.9 },
      promptVersion: "claim-classifier@1.0.0",
      promptHash: "0123456789abcdef",
      schemaVersion: "1.0.0",
      model,
    }),
  };
}

function throwingClassifier(throwOn: string): AnthropicClaimClassifier {
  return {
    classify: async ({ sentence, model }) => {
      if (sentence === throwOn) throw new Error("api down");
      return {
        result: { sentence, claimType: "none" as const, confidence: 0.9 },
        promptVersion: "claim-classifier@1.0.0",
        promptHash: "0123456789abcdef",
        schemaVersion: "1.0.0",
        model,
      };
    },
  };
}

// Classifier that never resolves until the dispatcher aborts its signal.
// Used to exercise the per-turn latency-budget timeout path in runClassifier.
function hangingClassifier(): AnthropicClaimClassifier {
  return {
    classify: ({ signal }) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  };
}

function fakeResolverSubst(status: "matched" | "stale" | "missing"): SubstantiationResolver {
  return { resolve: async () => ({ status }) };
}

const SG_REWRITES: ReadonlyArray<RewriteTemplateEntry> = [
  {
    id: "sg_efficacy_results_vary",
    jurisdiction: "SG",
    claimType: "efficacy",
    template:
      "Results vary between individuals — the doctor will go through what's realistic for you during consultation.",
  },
];

function fakeVerdictStore(): GovernanceVerdictStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    save: async (v) => {
      saved.push(v);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { id: `vrd_${saved.length}`, ...v, createdAt: new Date().toISOString() } as any;
    },
    listByConversation: async () => [],
    listByDeployment: async () => [],
  };
}

function fakeHandoffStore() {
  const saved: unknown[] = [];
  return {
    saved,
    save: async (h: unknown) => {
      saved.push(h);
    },
  };
}

function fakeConversationStore() {
  const statuses: Record<string, string> = {};
  return {
    setConversationStatus: async (id: string, s: string) => {
      statuses[id] = s;
    },
    getStatus: (id: string) => statuses[id],
  };
}

function makeHook(
  overrides: Partial<{
    configMode: "off" | "observe" | "enforce" | "missing" | "error";
    classifier: AnthropicClaimClassifier;
    classifierOutcomes: Record<string, ClaimType>;
    substantiation: "matched" | "stale" | "missing";
    posture: { mode: "off" | "observe" | "enforce" } | undefined;
    rewrites: ReadonlyArray<RewriteTemplateEntry>;
    latencyBudgetMs: number;
  }> = {},
) {
  const mode = overrides.configMode ?? "enforce";
  const classifier = overrides.classifier ?? fakeClassifier(overrides.classifierOutcomes ?? {});
  const substantiation = fakeResolverSubst(overrides.substantiation ?? "missing");
  const verdictStore = fakeVerdictStore();
  const handoffStore = fakeHandoffStore();
  const conversationStore = fakeConversationStore();
  const postureCache = fakePostureCache(overrides.posture);
  const hook = new ClaimClassifierHook({
    governanceConfigResolver: fakeResolver(mode, overrides.latencyBudgetMs),
    postureCache,
    classifier,
    substantiationResolver: substantiation,
    rewriteLoader: () => overrides.rewrites ?? SG_REWRITES,
    verdictStore,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handoffStore: handoffStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversationStore: conversationStore as any,
    splitSentences,
    clock: () => new Date("2026-05-11T12:00:00.000Z"),
    renderHandoff: ({ jurisdiction }) =>
      jurisdiction === "SG"
        ? "Thanks for sharing that — this is something the clinic team should advise on directly. I'll get them to follow up with you shortly."
        : "Thanks for sharing that — this is something the clinic team should advise on directly. I'll have them follow up with you shortly.",
  });
  return { hook, verdictStore, handoffStore, conversationStore };
}

const HOOK_CTX: SkillHookContext = {
  deploymentId: "dep_1",
  orgId: "org_1",
  skillSlug: "alex",
  skillVersion: "1.0.0",
  sessionId: "sess_1",
  trustLevel: "supervised",
  trustScore: 0.8,
};

function makeResult(response: string): SkillExecutionResult {
  return {
    response,
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 100,
      turnCount: 1,
      status: "success",
      responseSummary: response.slice(0, 80),
      writeCount: 0,
      governanceDecisions: [],
    },
  };
}

describe("ClaimClassifierHook — name + config + mode matrix", () => {
  it("exposes hook name", () => {
    const { hook } = makeHook({ configMode: "off" });
    expect(hook.name).toBe("claim-classifier");
  });

  it("passes through when config is missing", async () => {
    const { hook, verdictStore } = makeHook({ configMode: "missing" });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
    expect(result.response).toBe("Most clients see results.");
  });

  it("passes through when mode is off", async () => {
    const { hook, verdictStore } = makeHook({ configMode: "off" });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
  });

  it("observe mode persists verdicts but does not modify response", async () => {
    const { hook, verdictStore, handoffStore } = makeHook({
      configMode: "observe",
      classifierOutcomes: { "Visible slimming after one session": "efficacy" },
      substantiation: "missing",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    expect(result.response).toBe("Visible slimming after one session.");
    expect(handoffStore.saved).toHaveLength(0);
  });

  it("fails open in enforce mode when resolver errors with cold cache", async () => {
    const { hook, verdictStore } = makeHook({ configMode: "error", posture: undefined });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
    expect(result.response).toBe("Most clients see results.");
  });

  it("fails closed when last-known posture is enforce", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      configMode: "error",
      posture: { mode: "enforce" },
    });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.reasonCode).toBe("governance_unavailable");
    expect(v.conversationId).toBe("sess_1");
    expect(handoffStore.saved).toHaveLength(1);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
    expect(result.response).toContain("clinic team");
  });
});

describe("ClaimClassifierHook — outcome matrix in enforce mode", () => {
  it("allows when classifier returns none", async () => {
    const { hook, verdictStore } = makeHook({
      classifierOutcomes: { "Our address is 123 Orchard Road": "none" },
    });
    const result = makeResult("Our address is 123 Orchard Road.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
    expect(result.response).toBe("Our address is 123 Orchard Road.");
  });

  it("allows when substantiation matches", async () => {
    const { hook, verdictStore } = makeHook({
      classifierOutcomes: { "Visible slimming after one session": "efficacy" },
      substantiation: "matched",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(0);
  });

  it("rewrites in place when substantiation is missing for rewriteable claim", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      classifierOutcomes: { "Visible slimming after one session": "efficacy" },
      substantiation: "missing",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.action).toBe("rewrite");
    expect(v.reasonCode).toBe("unsupported_claim_rewritten");
    expect(v.conversationId).toBe("sess_1");
    expect(v.details.promptVersion).toBe("claim-classifier@1.0.0");
    expect(v.details.claimType).toBe("efficacy");
    expect(v.details.originalSentence).toBe("Visible slimming after one session");
    expect(v.details.rewrittenSentence).toContain("Results vary");
    expect(result.response).toContain("Results vary");
    expect(result.response).not.toContain("Visible slimming");
    expect(handoffStore.saved).toHaveLength(0);
    expect(conversationStore.getStatus("sess_1")).toBeUndefined();
  });

  it("emits claim_substantiation_stale when stale", async () => {
    const { hook, verdictStore } = makeHook({
      classifierOutcomes: { "Visible slimming after one session": "efficacy" },
      substantiation: "stale",
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.reasonCode).toBe("claim_substantiation_stale");
  });

  it("escalates whole response on diagnosis claim type", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      classifier: {
        classify: async ({ sentence, model }) => ({
          result: {
            sentence,
            claimType: sentence.includes("rosacea") ? "diagnosis" : "none",
            confidence: 0.95,
          },
          promptVersion: "claim-classifier@1.0.0",
          promptHash: "0123456789abcdef",
          schemaVersion: "1.0.0",
          model,
        }),
      },
    });
    const result = makeResult("We open at 10am. I think you have rosacea.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.reasonCode).toBe("unsupported_claim_escalated");
    expect(v.details.claimType).toBe("diagnosis");
    expect(handoffStore.saved).toHaveLength(1);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
    expect(result.response).toContain("clinic team");
    expect(result.response).not.toContain("rosacea");
    expect(result.response).not.toContain("10am");
  });

  it("escalates on classifier_error", async () => {
    const { hook, verdictStore, conversationStore } = makeHook({
      classifier: throwingClassifier("This sentence will throw"),
    });
    const result = makeResult("This sentence will throw.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.reasonCode).toBe("classifier_error");
    expect(v.details.errorKind).toBe("api_error");
    expect(v.details.errorMessage).toContain("api down");
    expect(v.details.latencyBudgetMs).toBe(800);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
  });

  it("falls through to escalate when no rewrite template for the claim type", async () => {
    const { hook, verdictStore } = makeHook({
      classifierOutcomes: { "Visible slimming after one session": "efficacy" },
      substantiation: "missing",
      rewrites: [], // empty templates
    });
    const result = makeResult("Visible slimming after one session.");
    await hook.afterSkill!(HOOK_CTX, result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.action).toBe("escalate");
    expect(v.reasonCode).toBe("unsupported_claim_escalated");
  });

  it("escalates without rewriting on testimonial claim type", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      classifierOutcomes: {
        "Sarah lost 8kg in three weeks with our programme": "testimonial",
      },
    });
    const result = makeResult("Sarah lost 8kg in three weeks with our programme.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.action).toBe("escalate");
    expect(v.reasonCode).toBe("unsupported_claim_escalated");
    expect(v.details.claimType).toBe("testimonial");
    expect(handoffStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = handoffStore.saved[0] as any;
    // Real HandoffPackage shape — buildHandoffPackage output.
    expect(h.organizationId).toBe("org_1");
    expect(h.sessionId).toBe("sess_1");
    expect(h.reason).toBe("compliance_concern");
    expect(h.status).toBe("pending");
    expect(h.conversationSummary.turnCount).toBe(1);
    expect(typeof h.id).toBe("string");
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
    expect(result.response).toContain("clinic team");
    expect(result.response).not.toContain("Sarah");
  });

  it("escalates without rewriting on medical-advice claim type", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      classifierOutcomes: {
        "Stop taking your statins before your peel": "medical-advice",
      },
    });
    const result = makeResult("Stop taking your statins before your peel.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.action).toBe("escalate");
    expect(v.reasonCode).toBe("unsupported_claim_escalated");
    expect(v.details.claimType).toBe("medical-advice");
    expect(v.details.originalSentence).toBe("Stop taking your statins before your peel");
    expect(handoffStore.saved).toHaveLength(1);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
    expect(result.response).toContain("clinic team");
    expect(result.response).not.toContain("statins");
  });

  it("escalates on classifier_timeout when latency budget elapses", async () => {
    const { hook, verdictStore, handoffStore, conversationStore } = makeHook({
      classifier: hangingClassifier(),
      latencyBudgetMs: 5,
    });
    const result = makeResult("Most clients see results.");
    await hook.afterSkill!(HOOK_CTX, result);
    expect(verdictStore.saved).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdictStore.saved[0] as any;
    expect(v.action).toBe("escalate");
    expect(v.reasonCode).toBe("classifier_timeout");
    expect(v.details.errorKind).toBe("timeout");
    expect(v.details.latencyBudgetMs).toBe(5);
    expect(v.details.originalSentence).toBe("Most clients see results");
    expect(handoffStore.saved).toHaveLength(1);
    expect(conversationStore.getStatus("sess_1")).toBe("human_override");
    expect(result.response).toContain("clinic team");
  });
});
