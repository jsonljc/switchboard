import { describe, expect, it } from "vitest";
import { runMiraCompose, COMPOSE_USER_TURN } from "../run-mira-compose.js";
import { gradeMiraCompose } from "../grade-compose.js";
import type { Temp0Adapter } from "../../alex-conversation/temp0-adapter.js";
import { SCENARIOS } from "../scenarios.js";

const SKILLS_DIR = new URL("../../../skills", import.meta.url).pathname;
const SCENARIO = SCENARIOS[0]!;

/** A fake adapter that returns one canned model text (drives the REAL executor offline). */
function fakeAdapter(text: string): Temp0Adapter {
  return {
    chatWithTools: async () => ({
      content: [{ type: "text" as const, text }],
      stopReason: "end_turn" as const,
      model: "fake-model",
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 },
    }),
  };
}

/** A fake adapter that throws (models a provider rejection / network failure). */
function throwingAdapter(): Temp0Adapter {
  return {
    chatWithTools: async () => {
      throw new Error("provider rejected");
    },
  };
}

const cleanProposeJson = JSON.stringify({
  decision: "propose",
  reason: "Strong frontline demand and a clear desk.",
  brief: {
    productDescription: "A first-visit consult offer for the clinic's most-booked treatment.",
    targetAudience: "First-time injectable clients in Singapore.",
  },
});

describe("runMiraCompose — drives the REAL executor offline (no key)", () => {
  it("a clean propose grades clean through the whole drive→parse path", async () => {
    const out = await runMiraCompose(SCENARIO, {
      adapter: fakeAdapter(cleanProposeJson),
      skillsDir: SKILLS_DIR,
    });
    expect(out.crashed).toBe(false);
    expect(gradeMiraCompose(out).pass).toBe(true);
  });

  it("a bled <intent> tag is stripped by the REAL executor but caught via the side-channel", async () => {
    // The executor strips a well-formed <intent> tag and exposes it as intentClass.
    // gradeMiraCompose must catch the bleed through that side-channel — proves the
    // grader is wired to the executor's real strip behavior, not just raw text.
    const out = await runMiraCompose(SCENARIO, {
      adapter: fakeAdapter(cleanProposeJson + "<intent>appointment-confirm</intent>"),
      skillsDir: SKILLS_DIR,
    });
    expect(out.intentClass).toBe("appointment-confirm");
    const graded = gradeMiraCompose(out);
    expect(graded.pass).toBe(false);
    expect(graded.violations.map((v) => v.code)).toContain("intent-bleed");
  });

  it("a banned claim in the brief survives the executor and fails the grade", async () => {
    const bannedJson = JSON.stringify({
      decision: "propose",
      reason: "Demand is strong.",
      brief: {
        productDescription: "Guaranteed permanent wrinkle removal in one session.",
        targetAudience: "Anyone wanting results.",
      },
    });
    const out = await runMiraCompose(SCENARIO, {
      adapter: fakeAdapter(bannedJson),
      skillsDir: SKILLS_DIR,
    });
    expect(gradeMiraCompose(out).violations.some((v) => v.code.startsWith("banned-claim:"))).toBe(
      true,
    );
  });

  it("a malformed (non-JSON) output fails the shape grade", async () => {
    const out = await runMiraCompose(SCENARIO, {
      adapter: fakeAdapter("I think a Botox campaign would do well this week."),
      skillsDir: SKILLS_DIR,
    });
    expect(gradeMiraCompose(out).violations.map((v) => v.code)).toContain("shape-invalid");
  });

  it("a thrown drive degrades gracefully to crashed (not an unhandled throw)", async () => {
    const out = await runMiraCompose(SCENARIO, {
      adapter: throwingAdapter(),
      skillsDir: SKILLS_DIR,
    });
    expect(out.crashed).toBe(true);
    expect(gradeMiraCompose(out).violations.map((v) => v.code)).toEqual(["crash"]);
  });
});

describe("runMiraCompose — empty-messages defect guard (F1)", () => {
  it("drives the model with a NON-EMPTY user turn", async () => {
    // Production's compose submits NO conversation, so skill-mode passes messages:[] —
    // a live Anthropic call with zero messages is API-rejected (≥1 message required).
    // The harness supplies COMPOSE_USER_TURN; this guard stops a regression back to []
    // that would falsely crash the live leg.
    let seenMessages: ReadonlyArray<{ role: string }> | undefined;
    const spy: Temp0Adapter = {
      chatWithTools: async (params) => {
        seenMessages = params.messages as ReadonlyArray<{ role: string }>;
        return {
          content: [{ type: "text" as const, text: cleanProposeJson }],
          stopReason: "end_turn" as const,
          model: "fake-model",
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
        };
      },
    };
    await runMiraCompose(SCENARIO, { adapter: spy, skillsDir: SKILLS_DIR });
    expect(seenMessages?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(seenMessages?.[0]?.role).toBe("user");
    expect(COMPOSE_USER_TURN.length).toBeGreaterThan(0);
  });
});
