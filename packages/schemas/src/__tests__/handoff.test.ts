import { describe, expect, it } from "vitest";
import {
  HandoffSchema,
  HandoffReasonSchema,
  HandoffStatusSchema,
  type Handoff,
} from "../handoff.js";

describe("HandoffReasonSchema", () => {
  it.each([
    "human_requested",
    "max_turns_exceeded",
    "complex_objection",
    "negative_sentiment",
    "compliance_concern",
    "booking_failure",
    "escalation_timeout",
    "missing_knowledge",
    "outside_whatsapp_window",
    "medical_safety",
  ])("accepts %s", (reason) => {
    expect(HandoffReasonSchema.safeParse(reason).success).toBe(true);
  });

  it("rejects unknown reasons", () => {
    expect(HandoffReasonSchema.safeParse("definitely_not_a_reason").success).toBe(false);
  });
});

describe("HandoffStatusSchema", () => {
  it.each(["pending", "assigned", "active", "released"])("accepts %s", (status) => {
    expect(HandoffStatusSchema.safeParse(status).success).toBe(true);
  });
});

describe("HandoffSchema", () => {
  const baseHandoff: Handoff = {
    id: "h_1",
    sessionId: "session_1",
    organizationId: "org_a",
    reason: "human_requested",
    status: "pending",
    leadSnapshot: { channel: "whatsapp" },
    qualificationSnapshot: {
      signalsCaptured: {},
      qualificationStage: "QUALIFYING",
    },
    conversationSummary: {
      turnCount: 5,
      keyTopics: ["pricing"],
      objectionHistory: [],
      sentiment: "neutral",
    },
    slaDeadlineAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
  };

  it("parses a minimal valid handoff", () => {
    expect(HandoffSchema.safeParse(baseHandoff).success).toBe(true);
  });

  it("parses a handoff with optional acknowledgedAt + full lead snapshot", () => {
    const full: Handoff = {
      ...baseHandoff,
      acknowledgedAt: new Date(),
      leadSnapshot: {
        leadId: "lead_1",
        name: "Alice",
        phone: "+65...",
        email: "a@example.com",
        serviceInterest: "consultation",
        channel: "whatsapp",
        source: "instagram_ad",
      },
      qualificationSnapshot: {
        signalsCaptured: { interest: "high" },
        qualificationStage: "QUALIFIED",
        leadScore: 0.8,
      },
      conversationSummary: {
        turnCount: 8,
        keyTopics: ["pricing", "availability"],
        objectionHistory: ["too_expensive"],
        sentiment: "positive",
        suggestedOpening: "Hi Alice, ...",
      },
    };
    expect(HandoffSchema.safeParse(full).success).toBe(true);
  });

  it("rejects missing required leadSnapshot.channel", () => {
    const broken = { ...baseHandoff, leadSnapshot: {} };
    expect(HandoffSchema.safeParse(broken).success).toBe(false);
  });
});
