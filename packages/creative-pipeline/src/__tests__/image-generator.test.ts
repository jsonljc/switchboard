// packages/core/src/creative-pipeline/__tests__/image-generator.test.ts
import { describe, it, expect, vi } from "vitest";
import { DalleImageGenerator } from "../stages/image-generator.js";

const mockGenerate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn(() => ({
    images: { generate: mockGenerate },
  })),
}));

describe("DalleImageGenerator", () => {
  it("returns image URL on successful generation", async () => {
    mockGenerate.mockResolvedValue({
      data: [{ url: "https://oaidalleapiprodscus.blob.core.windows.net/image.png" }],
    });

    const generator = new DalleImageGenerator("test-openai-key");
    const url = await generator.generate("A product photo on white background");

    expect(url).toBe("https://oaidalleapiprodscus.blob.core.windows.net/image.png");
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "dall-e-3",
        prompt: "A product photo on white background",
        n: 1,
        size: "1024x1024",
        style: "vivid",
      }),
    );
  });

  it("throws when API returns no image data", async () => {
    mockGenerate.mockResolvedValue({ data: [] });

    const generator = new DalleImageGenerator("test-openai-key");
    await expect(generator.generate("test prompt")).rejects.toThrow(
      "No image data returned from DALL-E",
    );
  });

  it("throws when API returns no URL", async () => {
    mockGenerate.mockResolvedValue({ data: [{ url: undefined }] });

    const generator = new DalleImageGenerator("test-openai-key");
    await expect(generator.generate("test prompt")).rejects.toThrow(
      "No image URL returned from DALL-E",
    );
  });

  it("propagates OpenAI SDK errors", async () => {
    mockGenerate.mockRejectedValue(new Error("429 Too Many Requests"));

    const generator = new DalleImageGenerator("test-openai-key");
    await expect(generator.generate("test prompt")).rejects.toThrow("429 Too Many Requests");
  });
});
