import { describe, it, expect } from "vitest";
import { z } from "zod";

const CorrectMemoryInput = z.object({
  content: z.string().min(1),
  category: z.string().min(1),
});

describe("deployment-memory route input validation", () => {
  it("accepts valid correction input", () => {
    const result = CorrectMemoryInput.parse({
      content: "Closed on Sundays",
      category: "fact",
    });
    expect(result.content).toBe("Closed on Sundays");
  });

  it("rejects empty content", () => {
    expect(() => CorrectMemoryInput.parse({ content: "", category: "fact" })).toThrow();
  });

  it("rejects missing category", () => {
    expect(() => CorrectMemoryInput.parse({ content: "test" })).toThrow();
  });
});
