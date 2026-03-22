import { describe, it, expect, vi } from "vitest";
import { LlmUsageLogger, type LlmUsageEntry } from "../llm-usage-logger.js";

describe("LlmUsageLogger", () => {
  it("logs a usage entry via the provided sink", async () => {
    const entries: LlmUsageEntry[] = [];
    const logger = new LlmUsageLogger({
      sink: async (e) => {
        entries.push(e);
      },
    });

    await logger.log({
      orgId: "org-1",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 100,
      outputTokens: 50,
      taskType: "lead-qualification",
      durationMs: 320,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.model).toBe("claude-haiku-4-5-20251001");
  });

  it("does not throw if sink fails, but warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new LlmUsageLogger({
      sink: async () => {
        throw new Error("DB down");
      },
    });

    await expect(
      logger.log({
        orgId: "org-1",
        model: "test",
        inputTokens: 1,
        outputTokens: 1,
        taskType: "test",
      }),
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
