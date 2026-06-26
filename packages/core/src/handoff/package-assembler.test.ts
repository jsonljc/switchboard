import { describe, it, expect } from "vitest";
import { HandoffPackageAssembler, type AssemblerInput } from "./package-assembler.js";

describe("HandoffPackageAssembler (P2-9)", () => {
  const assembler = new HandoffPackageAssembler();
  const baseInput: AssemblerInput = {
    sessionId: "sess_1",
    organizationId: "org_1",
    reason: "negative_sentiment",
    leadSnapshot: { channel: "whatsapp" },
    qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
    messages: [],
  };

  it("carries the agent-supplied summary into conversationSummary.agentSummary", () => {
    const pkg = assembler.assemble({
      ...baseInput,
      agentSummary: "Lead wants laser, asked about pricing twice, getting impatient",
      customerSentiment: "frustrated",
    });
    expect(pkg.conversationSummary.agentSummary).toBe(
      "Lead wants laser, asked about pricing twice, getting impatient",
    );
  });

  it("prefers the agent-supplied sentiment over the keyword estimate", () => {
    const pkg = assembler.assemble({ ...baseInput, customerSentiment: "frustrated" });
    expect(pkg.conversationSummary.sentiment).toBe("frustrated");
  });

  it("falls back to the message-estimated sentiment when none is supplied (unchanged behavior)", () => {
    const pkg = assembler.assemble({
      ...baseInput,
      messages: [{ role: "user", text: "this is the worst, I hate it" }],
    });
    // estimateSentiment maps worst/hate -> "negative" off the last user message
    expect(pkg.conversationSummary.sentiment).toBe("negative");
    expect(pkg.conversationSummary.agentSummary).toBeUndefined();
  });
});
