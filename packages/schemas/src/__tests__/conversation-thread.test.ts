import { describe, it, expect } from "vitest";
import {
  ThreadStageSchema,
  SentimentTrendSchema,
  AgentContextDataSchema,
  FollowUpScheduleSchema,
  ConversationThreadSchema,
} from "../conversation-thread.js";

describe("ConversationThread schemas", () => {
  it("validates ThreadStage enum", () => {
    expect(ThreadStageSchema.parse("new")).toBe("new");
    expect(ThreadStageSchema.parse("responding")).toBe("responding");
    expect(ThreadStageSchema.parse("nurturing")).toBe("nurturing");
    expect(() => ThreadStageSchema.parse("invalid")).toThrow();
  });

  it("validates SentimentTrend enum", () => {
    expect(SentimentTrendSchema.parse("positive")).toBe("positive");
    expect(() => SentimentTrendSchema.parse("angry")).toThrow();
  });

  it("validates AgentContextData with defaults", () => {
    const result = AgentContextDataSchema.parse({});
    expect(result.objectionsEncountered).toEqual([]);
    expect(result.preferencesLearned).toEqual({});
    expect(result.offersMade).toEqual([]);
    expect(result.topicsDiscussed).toEqual([]);
    expect(result.sentimentTrend).toBe("unknown");
  });

  it("validates full AgentContextData", () => {
    const data = {
      objectionsEncountered: ["too expensive", "not sure about timing"],
      preferencesLearned: { time: "mornings", treatment: "facial" },
      offersMade: [{ description: "Summer special 20% off", date: new Date() }],
      topicsDiscussed: ["pricing", "availability"],
      sentimentTrend: "positive",
    };
    const result = AgentContextDataSchema.parse(data);
    expect(result.objectionsEncountered).toHaveLength(2);
    expect(result.sentimentTrend).toBe("positive");
  });

  it("validates FollowUpSchedule", () => {
    const schedule = {
      nextFollowUpAt: new Date(),
      reason: "Follow up on pricing question",
      cadenceId: "cad-1",
    };
    const result = FollowUpScheduleSchema.parse(schedule);
    expect(result.reason).toBe("Follow up on pricing question");
    expect(result.cadenceId).toBe("cad-1");
  });

  it("validates ConversationThread", () => {
    const thread = {
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "responding",
      assignedAgent: "lead-responder",
      agentContext: {},
      currentSummary: "",
      followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
      lastOutcomeAt: null,
      messageCount: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = ConversationThreadSchema.parse(thread);
    expect(result.stage).toBe("responding");
    expect(result.messageCount).toBe(3);
  });

  it("rejects ConversationThread with invalid stage", () => {
    expect(() =>
      ConversationThreadSchema.parse({
        id: "t-1",
        contactId: "c-1",
        organizationId: "org-1",
        stage: "invalid_stage",
        assignedAgent: "lead-responder",
        agentContext: {},
        currentSummary: "",
        followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
        lastOutcomeAt: null,
        messageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow();
  });
});
