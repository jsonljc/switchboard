import { describe, it, expect } from "vitest";
import { createMockTools } from "../mock-tools.js";
import { ALEX_ALLOWED_TOOL_IDS } from "../grade.js";

// A3 (#785/#786) added a `follow-up` tool to Alex's SKILL.md (frontmatter
// `tools:` + a "Scheduling a follow-up" section). The eval harness must mirror
// it so the executor OFFERS it (buildToolDefinitions reads the injected tool
// map) and the grader treats a follow-up call as an allowed tool — otherwise the
// new capability is untested and a follow-up call would grade as unexpected.
describe("mock-tools — follow-up tool parity with the real Alex skill", () => {
  it("registers a follow-up tool whose followup.schedule operation matches the real schema", () => {
    const { tools } = createMockTools();
    const followUp = tools.get("follow-up");
    expect(followUp).toBeDefined();

    const op = followUp!.operations["followup.schedule"];
    expect(op).toBeDefined();
    expect(op!.effectCategory).toBe("write");

    const schema = op!.inputSchema as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    expect(schema.required).toEqual(["reason", "delay"]);
    expect(schema.properties["reason"]!.enum).toEqual([
      "hesitation",
      "price_concern",
      "timing_not_now",
      "awaiting_info",
      "went_quiet",
    ]);
    expect(schema.properties["delay"]!.enum).toEqual(["in_1_day", "in_3_days", "in_1_week"]);
  });

  it("records a follow-up.followup.schedule invocation in calls[]", async () => {
    const { tools, calls } = createMockTools();
    const op = tools.get("follow-up")!.operations["followup.schedule"]!;

    await op.execute({ reason: "went_quiet", delay: "in_3_days" });

    expect(calls.at(-1)).toMatchObject({
      toolId: "follow-up",
      operation: "followup.schedule",
      name: "follow-up.followup.schedule",
      params: { reason: "went_quiet", delay: "in_3_days" },
    });
  });

  it("includes follow-up in ALEX_ALLOWED_TOOL_IDS (so a follow-up call is not graded as unexpected)", () => {
    expect(ALEX_ALLOWED_TOOL_IDS).toContain("follow-up");
  });
});
