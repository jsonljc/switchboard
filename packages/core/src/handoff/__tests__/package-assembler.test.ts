import { describe, it, expect } from "vitest";
import { HandoffPackageAssembler, type AssemblerInput } from "../package-assembler.js";

describe("HandoffPackageAssembler", () => {
  const assembler = new HandoffPackageAssembler();

  it("should assemble a basic handoff package", () => {
    const pkg = assembler.assemble({
      sessionId: "session_123",
      organizationId: "org_456",
      reason: "human_requested",
      leadSnapshot: {
        name: "John",
        channel: "whatsapp",
        serviceInterest: "whitening",
      },
      qualificationSnapshot: {
        signalsCaptured: { timeline: "soon" },
        qualificationStage: "qualifying",
        leadScore: 65,
      },
      messages: [
        { role: "user", text: "Hi, I'm interested in whitening" },
        { role: "assistant", text: "Great! Tell me more." },
        { role: "user", text: "How much does it cost?" },
        { role: "assistant", text: "Starting at $350." },
        { role: "user", text: "That's too expensive, can I speak to someone?" },
      ],
    });

    expect(pkg.id).toMatch(/^handoff_/);
    expect(pkg.sessionId).toBe("session_123");
    expect(pkg.status).toBe("pending");
    expect(pkg.reason).toBe("human_requested");
    expect(pkg.leadSnapshot.name).toBe("John");
    expect(pkg.conversationSummary.turnCount).toBe(3); // 3 user messages
    expect(pkg.conversationSummary.keyTopics).toContain("pricing");
    expect(pkg.conversationSummary.sentiment).toBe("neutral");
    expect(pkg.slaDeadlineAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("should detect objections in messages", () => {
    const pkg = assembler.assemble({
      sessionId: "s1",
      organizationId: "o1",
      reason: "complex_objection",
      leadSnapshot: { channel: "telegram" },
      qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "qualifying" },
      messages: [
        { role: "user", text: "That's too expensive, I can't afford it" },
        { role: "user", text: "I'm also scared of the procedure" },
      ],
    });

    expect(pkg.conversationSummary.objectionHistory).toContain("price concern");
    expect(pkg.conversationSummary.objectionHistory).toContain("anxiety");
  });

  it("should generate pricing-focused suggested opening", () => {
    const pkg = assembler.assemble({
      sessionId: "s1",
      organizationId: "o1",
      reason: "human_requested",
      leadSnapshot: { channel: "whatsapp" },
      qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "qualifying" },
      messages: [{ role: "user", text: "How much does it cost?" }],
    });

    expect(pkg.conversationSummary.suggestedOpening).toContain("pricing");
  });

  it("should respect custom SLA minutes", () => {
    const pkg = assembler.assemble({
      sessionId: "s1",
      organizationId: "o1",
      reason: "human_requested",
      leadSnapshot: { channel: "telegram" },
      qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "qualifying" },
      messages: [],
      slaMinutes: 60,
    });

    const expectedDeadline = Date.now() + 60 * 60 * 1000;
    expect(pkg.slaDeadlineAt.getTime()).toBeCloseTo(expectedDeadline, -3);
  });

  // P2-9: escalate has no transcript, so it supplies the summary + sentiment
  // directly. They must be carried into the handoff (not dropped), and the agent's
  // sentiment read preferred over the empty-transcript keyword estimate.
  describe("agent-supplied summary + sentiment (P2-9)", () => {
    const baseInput: AssemblerInput = {
      sessionId: "sess_1",
      organizationId: "org_1",
      reason: "negative_sentiment",
      leadSnapshot: { channel: "whatsapp" },
      qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
      messages: [],
    };

    it("carries the agent summary into conversationSummary.agentSummary", () => {
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

    it("falls back to the message-estimated sentiment when none is supplied", () => {
      const pkg = assembler.assemble({
        ...baseInput,
        messages: [{ role: "user", text: "this is the worst, I hate it" }],
      });
      expect(pkg.conversationSummary.sentiment).toBe("negative");
      expect(pkg.conversationSummary.agentSummary).toBeUndefined();
    });

    it.each(["negative", "frustrated", "angry"])(
      "opens empathetically for a %s sentiment",
      (sentiment) => {
        const pkg = assembler.assemble({ ...baseInput, customerSentiment: sentiment });
        expect(pkg.conversationSummary.suggestedOpening).toContain(
          "I understand there have been some concerns",
        );
      },
    );

    it("keeps the neutral/positive opening generic", () => {
      const pkg = assembler.assemble({ ...baseInput, customerSentiment: "positive" });
      expect(pkg.conversationSummary.suggestedOpening).not.toContain(
        "I understand there have been some concerns",
      );
    });
  });
});
