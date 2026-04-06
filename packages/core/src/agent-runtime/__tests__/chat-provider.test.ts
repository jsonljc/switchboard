import { describe, it, expect, vi } from "vitest";
import { CloudChatProvider } from "../chat-provider.js";
import type { ActionRequestPipeline, EvaluationResult } from "../action-request-pipeline.js";

function createMockPipeline(decision: "execute" | "queue" = "execute") {
  return {
    evaluate: vi.fn().mockResolvedValue({
      decision,
      reason: decision === "execute" ? "autonomous" : "supervised",
      actionRequestId: decision === "queue" ? "ar_1" : undefined,
    } satisfies EvaluationResult),
  } as unknown as ActionRequestPipeline;
}

describe("CloudChatProvider", () => {
  it("sends message when pipeline says execute", async () => {
    const pipeline = createMockPipeline("execute");
    const onExecute = vi.fn();
    const provider = new CloudChatProvider({
      deploymentId: "dep_1",
      surface: "telegram",
      pipeline,
      onExecute,
    });

    await provider.send("Hello");

    expect(pipeline.evaluate).toHaveBeenCalledWith({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
    });
    expect(onExecute).toHaveBeenCalledWith("Hello");
  });

  it("does not execute when pipeline says queue", async () => {
    const pipeline = createMockPipeline("queue");
    const onExecute = vi.fn();
    const provider = new CloudChatProvider({
      deploymentId: "dep_1",
      surface: "telegram",
      pipeline,
      onExecute,
    });

    await provider.send("Hello");

    expect(onExecute).not.toHaveBeenCalled();
  });
});
