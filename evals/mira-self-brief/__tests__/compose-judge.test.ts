import { describe, expect, it } from "vitest";
import {
  judgeCompose,
  JUDGE_RUBRIC_VERSION,
  type AnthropicClientLike,
  type JudgeComposeInput,
} from "../compose-judge.js";

const INPUT: JudgeComposeInput = {
  expectedLean: "propose",
  judgeFocus: "Clear desk + strong frontline demand should yield one grounded concept.",
  decision: "propose",
  reason: "HydraFacial books the most and the desk is clear.",
  brief: {
    productDescription: "A first-visit HydraFacial consult offer.",
    targetAudience: "First-time facial clients in Singapore.",
  },
};

function clientReturning(input: unknown): AnthropicClientLike {
  return {
    messages: {
      create: async () => ({ content: [{ type: "tool_use", name: "judge_compose", input }] }),
    },
  };
}

describe("judgeCompose", () => {
  it("returns the structured verdict on a well-formed tool call", async () => {
    const verdict = await judgeCompose(INPUT, {
      client: clientReturning({
        decisionAppropriate: true,
        qualityScore: 4,
        claimClean: true,
        violations: [],
        notes: "Grounded in demand.",
      }),
      model: "claude-sonnet-4-6",
    });
    expect(verdict.qualityScore).toBe(4);
    expect(verdict.decisionAppropriate).toBe(true);
    expect(verdict.claimClean).toBe(true);
    expect(verdict.rubricVersion).toBe(JUDGE_RUBRIC_VERSION);
  });

  it("clamps an out-of-range qualityScore into [0,5]", async () => {
    const verdict = await judgeCompose(INPUT, {
      client: clientReturning({
        decisionAppropriate: true,
        qualityScore: 9,
        claimClean: true,
        violations: [],
        notes: "x",
      }),
      model: "m",
    });
    expect(verdict.qualityScore).toBe(5);
  });

  it("fails closed (score 0) when the client throws", async () => {
    const verdict = await judgeCompose(INPUT, {
      client: {
        messages: {
          create: async () => {
            throw new Error("boom");
          },
        },
      },
      model: "m",
    });
    expect(verdict.qualityScore).toBe(0);
    expect(verdict.violations.some((v) => v.includes("client-error"))).toBe(true);
  });

  it("fails closed when there is no judge tool_use block", async () => {
    const verdict = await judgeCompose(INPUT, {
      client: {
        messages: { create: async () => ({ content: [{ type: "text", text: "no tool" }] }) },
      },
      model: "m",
    });
    expect(verdict.qualityScore).toBe(0);
  });

  it("fails closed when the tool input does not match the schema", async () => {
    const verdict = await judgeCompose(INPUT, {
      client: clientReturning({ qualityScore: "high" }),
      model: "m",
    });
    expect(verdict.qualityScore).toBe(0);
  });
});
