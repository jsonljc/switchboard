import { describe, it, expect } from "vitest";
import { MockImageGenerator } from "../image-generator.js";

describe("MockImageGenerator", () => {
  it("generates a placeholder image with default dimensions", async () => {
    const generator = new MockImageGenerator();
    const image = await generator.generate("A beautiful sunset");

    expect(image.id).toBe("mock-img-1");
    expect(image.url).toContain("1024x1024");
    expect(image.prompt).toBe("A beautiful sunset");
    expect(image.width).toBe(1024);
    expect(image.height).toBe(1024);
    expect(image.generatedAt).toBeDefined();
  });

  it("generates images with custom dimensions", async () => {
    const generator = new MockImageGenerator();
    const image = await generator.generate("Test", { width: 512, height: 512 });

    expect(image.width).toBe(512);
    expect(image.height).toBe(512);
    expect(image.url).toContain("512x512");
  });

  it("increments call count and image IDs", async () => {
    const generator = new MockImageGenerator();
    const img1 = await generator.generate("First");
    const img2 = await generator.generate("Second");
    const img3 = await generator.generate("Third");

    expect(img1.id).toBe("mock-img-1");
    expect(img2.id).toBe("mock-img-2");
    expect(img3.id).toBe("mock-img-3");
    expect(generator.getCallCount()).toBe(3);
  });

  it("preserves the prompt in the generated image", async () => {
    const generator = new MockImageGenerator();
    const prompt = "A modern office space with creative advertising posters";
    const image = await generator.generate(prompt);
    expect(image.prompt).toBe(prompt);
  });

  it("generates valid ISO datetime for generatedAt", async () => {
    const generator = new MockImageGenerator();
    const image = await generator.generate("Test");
    expect(new Date(image.generatedAt).getTime()).not.toBeNaN();
  });
});
