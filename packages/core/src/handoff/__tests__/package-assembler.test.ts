import { describe, it, expect } from "vitest";
import { HandoffPackageAssembler } from "../package-assembler.js";

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
});
