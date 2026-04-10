// packages/core/src/creative-pipeline/__tests__/run-stage.test.ts
import { describe, it, expect } from "vitest";
import { runStage } from "../stages/run-stage.js";

describe("runStage", () => {
  it("returns placeholder output for trends stage", async () => {
    const result = await runStage("trends", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("angles");
    expect(result).toHaveProperty("audienceInsights");
    expect(result).toHaveProperty("trendSignals");
  });

  it("returns placeholder output for hooks stage", async () => {
    const result = await runStage("hooks", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("hooks");
    expect(result).toHaveProperty("topCombos");
  });

  it("returns placeholder output for scripts stage", async () => {
    const result = await runStage("scripts", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("scripts");
  });

  it("returns placeholder output for storyboard stage", async () => {
    const result = await runStage("storyboard", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("storyboards");
  });

  it("returns placeholder output for production stage", async () => {
    const result = await runStage("production", {
      jobId: "job_1",
      brief: {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      previousOutputs: {},
    });

    expect(result).toHaveProperty("videos");
    expect(result).toHaveProperty("staticFallbacks");
  });

  it("throws for unknown stage", async () => {
    await expect(
      runStage("unknown" as never, {
        jobId: "job_1",
        brief: {
          productDescription: "AI tool",
          targetAudience: "SMBs",
          platforms: ["meta"],
        },
        previousOutputs: {},
      }),
    ).rejects.toThrow("Unknown stage: unknown");
  });
});
