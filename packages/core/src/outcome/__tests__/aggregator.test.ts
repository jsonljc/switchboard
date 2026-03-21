import { describe, it, expect } from "vitest";
import { OutcomeAggregator } from "../aggregator.js";
import type { ResponseVariantLog } from "@switchboard/schemas";

function makeLog(overrides?: Partial<ResponseVariantLog>): ResponseVariantLog {
  return {
    id: `v_${Math.random()}`,
    sessionId: "s1",
    organizationId: "org1",
    primaryMove: "greet",
    responseText: "Hello!",
    timestamp: new Date(),
    ...overrides,
  };
}

describe("OutcomeAggregator", () => {
  const aggregator = new OutcomeAggregator();

  it("should aggregate empty logs", () => {
    const result = aggregator.aggregateVariants([]);
    expect(result).toEqual([]);
  });

  it("should aggregate by primaryMove and templateId", () => {
    const logs: ResponseVariantLog[] = [
      makeLog({ primaryMove: "greet", templateId: "t1" }),
      makeLog({
        primaryMove: "greet",
        templateId: "t1",
        leadReplyReceived: true,
        leadReplyPositive: true,
      }),
      makeLog({ primaryMove: "greet", templateId: "t2" }),
      makeLog({ primaryMove: "handle_objection" }),
    ];

    const result = aggregator.aggregateVariants(logs);
    expect(result.length).toBe(3);
  });

  it("should calculate reply rate correctly", () => {
    const logs: ResponseVariantLog[] = [
      makeLog({ leadReplyReceived: true, leadReplyPositive: true }),
      makeLog({ leadReplyReceived: true, leadReplyPositive: false }),
      makeLog({ leadReplyReceived: false }),
      makeLog({ leadReplyReceived: false }),
    ];

    const result = aggregator.aggregateVariants(logs);
    expect(result[0]!.totalSent).toBe(4);
    expect(result[0]!.repliesReceived).toBe(2);
    expect(result[0]!.replyRate).toBe(0.5);
    expect(result[0]!.positiveRate).toBe(0.5);
  });

  it("should sort by Wilson lower bound descending", () => {
    const goodLogs = Array.from({ length: 20 }, () =>
      makeLog({
        primaryMove: "greet",
        templateId: "good",
        leadReplyReceived: true,
        leadReplyPositive: true,
      }),
    );
    const badLogs = Array.from({ length: 20 }, () =>
      makeLog({
        primaryMove: "greet",
        templateId: "bad",
        leadReplyReceived: true,
        leadReplyPositive: false,
      }),
    );

    const result = aggregator.aggregateVariants([...goodLogs, ...badLogs]);
    expect(result[0]!.templateId).toBe("good");
    expect(result[0]!.wilsonLowerBound).toBeGreaterThan(result[1]!.wilsonLowerBound);
  });
});
