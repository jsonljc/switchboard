import { describe, it, expect } from "vitest";
import {
  resolveLanguage,
  getLocalizedContent,
  findMissingTranslation,
} from "../bilingual-handler.js";

describe("resolveLanguage", () => {
  it("should default to English with no messages", () => {
    const result = resolveLanguage([], { languages: ["en", "zh"] });
    expect(result).toBe("en");
  });

  it("should detect Chinese from user messages", () => {
    const result = resolveLanguage(
      [
        { role: "user", text: "你好" },
        { role: "assistant", text: "Hi!" },
        { role: "user", text: "请问一下" },
      ],
      { languages: ["en", "zh"] },
    );
    expect(result).toBe("zh");
  });

  it("should fall back to English if detected language is not in config", () => {
    const result = resolveLanguage(
      [{ role: "user", text: "Saya nak tanya boleh buat appointment" }],
      { languages: ["en", "zh"] },
    );
    expect(result).toBe("en");
  });
});

describe("getLocalizedContent", () => {
  it("should return Chinese content when language is zh", () => {
    const content = { en: "Hello", zh: "你好" };
    expect(getLocalizedContent(content, "zh")).toBe("你好");
  });

  it("should fall back to English when no translation exists", () => {
    const content = { en: "Hello" };
    expect(getLocalizedContent(content, "zh")).toBe("Hello");
  });

  it("should return Malay content when available", () => {
    const content = { en: "Hello", ms: "Hai" };
    expect(getLocalizedContent(content, "ms")).toBe("Hai");
  });
});

describe("findMissingTranslation", () => {
  it("should report missing ZH translation", () => {
    const result = findMissingTranslation("greeting", { en: "Hi" }, "zh");
    expect(result).toContain("Missing ZH");
  });

  it("should return null when translation exists", () => {
    const result = findMissingTranslation("greeting", { en: "Hi", zh: "你好" }, "zh");
    expect(result).toBeNull();
  });
});
