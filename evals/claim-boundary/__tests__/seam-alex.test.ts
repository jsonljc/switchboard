import { describe, it, expect } from "vitest";
import type { SkillExecutionResult } from "@switchboard/core/skill-runtime";
import { buildClaimFixture, runClaimCaseOff } from "../seam-alex.js";
import { gradeClaim } from "../grade-claim.js";
import { CORPUS } from "../corpus.js";
import { ConversationFixtureSchema } from "../../alex-conversation/schema.js";
import type { ExecutorLike } from "../../alex-conversation/run-conversation.js";

/** Minimal valid SkillExecutionResult carrying a canned reply (no tool calls). */
function fakeResult(response: string): SkillExecutionResult {
  return {
    response,
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    trace: {
      durationMs: 0,
      turnCount: 1,
      status: "success",
      responseSummary: response.slice(0, 64),
      writeCount: 0,
      governanceDecisions: [],
      qualificationSignals: null,
    },
  };
}

/** A fake Alex returning a canned reply with NO Anthropic client (the offline OFF seam). */
const cannedExecutor = (response: string): ExecutorLike => ({
  execute: async () => fakeResult(response),
});

const throwingExecutor: ExecutorLike = {
  execute: async () => {
    throw new Error("simulated executor failure");
  },
};

const find = (id: string) => {
  const c = CORPUS.find((x) => x.id === id);
  if (!c) throw new Error(`corpus case not found: ${id}`);
  return c;
};

describe("buildClaimFixture", () => {
  it("puts the bait payload in the inbound lead turn and ends on an Alex turn", () => {
    const c = find("efficacy-guarantee-clearance");
    const f = buildClaimFixture(c.payload, c.id);
    expect(f.vertical).toBe("medspa");
    expect(f.turns[0]).toEqual({ role: "lead", content: c.payload });
    expect(f.turns[f.turns.length - 1]!.role).toBe("alex");
  });

  it("builds a ConversationFixtureSchema-valid fixture for every corpus case", () => {
    for (const c of CORPUS) {
      const parsed = ConversationFixtureSchema.safeParse(buildClaimFixture(c.payload, c.id));
      expect(parsed.success, `fixture for "${c.id}" must be schema-valid`).toBe(true);
    }
  });
});

describe("classifier-OFF offline teeth (real conversation loop, injected executor) → gradeClaim", () => {
  it("PASSES a resistant Alex reply driven through the real conversation loop", async () => {
    const c = find("efficacy-guarantee-clearance");
    const output = await runClaimCaseOff(c.payload, c.id, {
      executor: cannedExecutor(c.resistantSentence),
    });
    expect(output.crashed).toBe(false);
    expect(gradeClaim(output, c.expect).pass).toBe(true);
  });

  it("FAILS a compromised reply that asserts the prohibited claim (deliberately weakened Alex)", async () => {
    const c = find("efficacy-guarantee-clearance");
    const output = await runClaimCaseOff(c.payload, c.id, {
      executor: cannedExecutor(c.prohibitedSentence),
    });
    const r = gradeClaim(output, c.expect);
    expect(r.pass).toBe(false);
    expect(
      r.violations.some(
        (v) =>
          v.code.startsWith("prohibited-claim:") || v.code.startsWith("forbidden-claim-phrase:"),
      ),
    ).toBe(true);
  });

  it("catches a compromised claim for EVERY taxonomy case through the real loop", async () => {
    for (const c of CORPUS) {
      const compromised = await runClaimCaseOff(c.payload, c.id, {
        executor: cannedExecutor(c.prohibitedSentence),
      });
      expect(
        gradeClaim(compromised, c.expect).pass,
        `"${c.id}" compromised reply slipped past the grader`,
      ).toBe(false);

      const resistant = await runClaimCaseOff(c.payload, c.id, {
        executor: cannedExecutor(c.resistantSentence),
      });
      expect(
        gradeClaim(resistant, c.expect).pass,
        `"${c.id}" resistant reply was wrongly flagged`,
      ).toBe(true);
    }
  });

  it("records a crash (not a process abort) when the agent path throws", async () => {
    const c = find("safety-no-side-effects");
    const output = await runClaimCaseOff(c.payload, c.id, { executor: throwingExecutor });
    expect(output.crashed).toBe(true);
    expect(gradeClaim(output, c.expect).violations.map((v) => v.code)).toContain("crash");
  });
});
