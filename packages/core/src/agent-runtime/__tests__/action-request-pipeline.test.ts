import { describe, it, expect, vi } from "vitest";
import { ActionRequestPipeline } from "../action-request-pipeline.js";
import type { ActionRequestPipelineConfig } from "../action-request-pipeline.js";

function makeConfig(overrides?: Partial<ActionRequestPipelineConfig>): ActionRequestPipelineConfig {
  return {
    trustScore: 0,
    trustLevel: "supervised",
    actionRequestStore: {
      create: vi.fn().mockResolvedValue({ id: "ar_1", status: "pending" }),
      updateStatus: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

describe("ActionRequestPipeline", () => {
  it("queues actions when supervised", async () => {
    const config = makeConfig({ trustLevel: "supervised", trustScore: 10 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
    });

    expect(result.decision).toBe("queue");
    expect(config.actionRequestStore.create).toHaveBeenCalled();
  });

  it("executes actions when autonomous", async () => {
    const config = makeConfig({ trustLevel: "autonomous", trustScore: 80 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
    });

    expect(result.decision).toBe("execute");
  });

  it("executes actions when guided", async () => {
    const config = makeConfig({ trustLevel: "guided", trustScore: 40 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "telegram",
      payload: { content: "Hello" },
    });

    expect(result.decision).toBe("execute");
  });

  it("always executes in sandbox surface", async () => {
    const config = makeConfig({ trustLevel: "supervised", trustScore: 0 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "send_message",
      surface: "test_chat",
      payload: { content: "Hello" },
    });

    expect(result.decision).toBe("execute");
  });

  it("always allows file reads regardless of trust", async () => {
    const config = makeConfig({ trustLevel: "supervised", trustScore: 0 });
    const pipeline = new ActionRequestPipeline(config);

    const result = await pipeline.evaluate({
      deploymentId: "dep_1",
      type: "read_file",
      surface: "google_drive",
      payload: { path: "doc.md" },
    });

    expect(result.decision).toBe("execute");
  });
});
