// ---------------------------------------------------------------------------
// Tests: Communication Risk
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { computeCommunicationRisk } from "../core/scoring/communication-risk.js";
import type { CommunicationRiskInput } from "../core/scoring/communication-risk.js";

const safeInput: CommunicationRiskInput = {
  consentStatus: "active",
  messagesSentToday: 0,
  messagesSentThisWeek: 0,
  lastMessageSentAt: null,
  sentimentScore: 0.5,
  complaintCount: 0,
  optOutRequested: false,
};

describe("computeCommunicationRisk", () => {
  it("should return 'safe' for normal conditions", () => {
    const result = computeCommunicationRisk(safeInput);
    expect(result.level).toBe("safe");
    expect(result.maxMessagesPerDay).toBe(5);
  });

  it("should block when consent is revoked", () => {
    const result = computeCommunicationRisk({
      ...safeInput,
      consentStatus: "revoked",
    });
    expect(result.level).toBe("blocked");
    expect(result.maxMessagesPerDay).toBe(0);
  });

  it("should block when opt-out is requested", () => {
    const result = computeCommunicationRisk({
      ...safeInput,
      optOutRequested: true,
    });
    expect(result.level).toBe("blocked");
  });

  it("should block when consent is expired", () => {
    const result = computeCommunicationRisk({
      ...safeInput,
      consentStatus: "expired",
    });
    expect(result.level).toBe("blocked");
  });

  it("should restrict when consent is pending", () => {
    const result = computeCommunicationRisk({
      ...safeInput,
      consentStatus: "pending",
    });
    expect(result.level).toBe("restricted");
    expect(result.maxMessagesPerDay).toBe(1);
  });

  it("should escalate to caution with complaints", () => {
    const result = computeCommunicationRisk({
      ...safeInput,
      complaintCount: 1,
    });
    expect(result.level).toBe("caution");
  });

  it("should escalate to restricted with many complaints", () => {
    const result = computeCommunicationRisk({
      ...safeInput,
      complaintCount: 3,
    });
    expect(result.level).toBe("restricted");
  });

  it("should restrict when daily limit is reached", () => {
    const result = computeCommunicationRisk({
      ...safeInput,
      messagesSentToday: 5,
    });
    expect(result.level).toBe("restricted");
    expect(result.maxMessagesPerDay).toBe(0);
  });

  it("should flag negative sentiment", () => {
    const result = computeCommunicationRisk({
      ...safeInput,
      sentimentScore: -0.6,
    });
    expect(result.level).toBe("restricted");
  });
});
