// The frame-QA deps factory: empty key = undefined (honest stub everywhere);
// a configured key yields a real extractor + a vision closure bound to it.
import { describe, it, expect, vi } from "vitest";

const callClaudeWithImages = vi.fn().mockResolvedValue({ ok: true });
vi.mock("../stages/call-claude.js", () => ({
  callClaudeWithImages: (opts: unknown) => callClaudeWithImages(opts),
}));

import { buildFrameQaDeps } from "../ugc/frame-qa-deps.js";
import { FfmpegFrameExtractor } from "../ugc/frame-extractor.js";
import { VisionQaResultSchema } from "../ugc/realism-scorer.js";

describe("buildFrameQaDeps", () => {
  it("returns undefined for an empty key (unconfigured dev stays the honest stub)", () => {
    expect(buildFrameQaDeps("")).toBeUndefined();
  });

  it("builds an extractor and a vision closure bound to the key", async () => {
    const deps = buildFrameQaDeps("anthropic-key");
    expect(deps).toBeDefined();
    expect(deps!.frameExtractor).toBeInstanceOf(FfmpegFrameExtractor);

    await deps!.vision({
      images: ["QUJD"],
      userMessage: "judge",
      schema: VisionQaResultSchema,
    });
    expect(callClaudeWithImages).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "anthropic-key",
        images: ["QUJD"],
        userMessage: "judge",
        maxTokens: 1024,
      }),
    );
  });
});
