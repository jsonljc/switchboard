import { describe, it, expect, vi } from "vitest";
import { FollowupAgent } from "../followup/index.js";
import { RetentionAgent } from "../retention/index.js";

describe("FollowupAgent", () => {
  const review = {
    platform: "mock" as const,
    sendReviewRequest: vi.fn().mockResolvedValue({ requestId: "req-1", status: "sent" }),
    respondToReview: vi.fn().mockResolvedValue({ success: true }),
    getReviews: vi.fn().mockResolvedValue([]),
    checkHealth: vi.fn().mockResolvedValue({ status: "healthy" }),
  };

  it("should handle treatment.log action", async () => {
    const agent = new FollowupAgent(review, "loc-1");
    const result = await agent.execute(
      "customer-engagement.treatment.log",
      { contactId: "c-1", serviceType: "cleaning", value: 200 },
      {},
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("cleaning");
  });

  it("should handle review.request action", async () => {
    const agent = new FollowupAgent(review, "loc-1");
    const result = await agent.execute(
      "customer-engagement.review.request",
      { contactId: "c-1" },
      {},
    );
    expect(result.success).toBe(true);
  });

  it("should handle review.respond action", async () => {
    const agent = new FollowupAgent(review, "loc-1");
    const result = await agent.execute(
      "customer-engagement.review.respond",
      { reviewId: "rev-1", responseText: "Thanks!" },
      {},
    );
    expect(result.success).toBe(true);
  });

  it("should return failure for unknown action", async () => {
    const agent = new FollowupAgent(review, "loc-1");
    const result = await agent.execute("unknown.action", {}, {});
    expect(result.success).toBe(false);
    expect(result.summary).toContain("cannot handle");
  });

  it("should declare correct stages", () => {
    const agent = new FollowupAgent(review, "loc-1");
    expect(agent.stages).toContain("service_completed");
    expect(agent.stages).toContain("repeat_customer");
    expect(agent.type).toBe("followup");
  });
});

describe("RetentionAgent", () => {
  it("should handle cadence.start action", async () => {
    const agent = new RetentionAgent();
    const result = await agent.execute(
      "customer-engagement.cadence.start",
      { contactId: "c-1", cadenceTemplateId: "reactivation-30" },
      {},
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("reactivation-30");
  });

  it("should handle cadence.stop action", async () => {
    const agent = new RetentionAgent();
    const result = await agent.execute(
      "customer-engagement.cadence.stop",
      { cadenceInstanceId: "cad-1", reason: "patient responded" },
      {},
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("cad-1");
  });

  it("should return failure for unknown action", async () => {
    const agent = new RetentionAgent();
    const result = await agent.execute("unknown.action", {}, {});
    expect(result.success).toBe(false);
    expect(result.summary).toContain("cannot handle");
  });

  it("should declare correct stages", () => {
    const agent = new RetentionAgent();
    expect(agent.stages).toContain("dormant");
    expect(agent.stages).toContain("lost");
    expect(agent.type).toBe("retention");
  });
});
