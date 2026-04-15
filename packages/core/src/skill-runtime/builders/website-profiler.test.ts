import { describe, it, expect, vi } from "vitest";
import { websiteProfilerBuilder } from "./website-profiler.js";

function makeCtx(lastMessage = "Check out https://example.com") {
  return {
    persona: {
      businessName: "TestBiz",
      tone: "professional",
      customInstructions: "Be thorough",
    },
    conversation: {
      id: "conv-1",
      messages: [{ role: "user", content: lastMessage }],
    },
    trust: { score: 50, level: "guided" },
  } as any;
}

const config = { deploymentId: "d1", orgId: "org1", contactId: "contact-1" };
const mockStores = {
  opportunityStore: { findActiveByContact: vi.fn() },
  contactStore: { findById: vi.fn() },
  activityStore: { listByDeployment: vi.fn() },
};

describe("websiteProfilerBuilder", () => {
  it("extracts URL from last message", async () => {
    const result = await websiteProfilerBuilder(makeCtx(), config, mockStores);
    expect(result.TARGET_URL).toBe("https://example.com");
  });

  it("maps persona fields", async () => {
    const result = await websiteProfilerBuilder(makeCtx(), config, mockStores);
    expect(result.BUSINESS_NAME).toBe("TestBiz");
    expect((result.PERSONA_CONFIG as any).tone).toBe("professional");
  });

  it("extracts URL with path", async () => {
    const result = await websiteProfilerBuilder(
      makeCtx("Profile this: https://shop.example.com/about"),
      config,
      mockStores,
    );
    expect(result.TARGET_URL).toBe("https://shop.example.com/about");
  });

  it("returns empty TARGET_URL when no URL in message", async () => {
    const result = await websiteProfilerBuilder(makeCtx("No URL here"), config, mockStores);
    expect(result.TARGET_URL).toBe("");
  });

  it("handles null customInstructions", async () => {
    const ctx = makeCtx();
    ctx.persona.customInstructions = null;
    const result = await websiteProfilerBuilder(ctx, config, mockStores);
    expect((result.PERSONA_CONFIG as any).customInstructions).toBe("");
  });
});
