import { describe, it, expect } from "vitest";
import { detectLanguage } from "../language-detector.js";

describe("detectLanguage", () => {
  it("should detect English text", () => {
    const result = detectLanguage("Hello, I would like to book an appointment");
    expect(result.detected).toBe("en");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should detect Chinese text", () => {
    const result = detectLanguage("请问价格多少？");
    expect(result.detected).toBe("zh");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should detect mixed text", () => {
    const result = detectLanguage("I want to ask 请问价格 how much");
    expect(result.detected).toBe("mixed");
  });

  it("should detect Malay text", () => {
    const result = detectLanguage("Saya nak tanya boleh buat appointment tak");
    expect(result.detected).toBe("ms");
  });

  it("should handle empty text", () => {
    const result = detectLanguage("");
    expect(result.detected).toBe("en");
    expect(result.confidence).toBe(0);
  });

  it("should handle single word", () => {
    const result = detectLanguage("hi");
    expect(result.detected).toBe("en");
  });
});
