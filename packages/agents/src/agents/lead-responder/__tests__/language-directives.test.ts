import { describe, it, expect } from "vitest";
import {
  getLanguageDirective,
  LANGUAGE_DIRECTIVES,
  type SupportedLanguage,
} from "../language-directives.js";

describe("language directives", () => {
  it("returns English directive by default", () => {
    const directive = getLanguageDirective(undefined);
    expect(directive).toContain("English");
  });

  it("returns Malay directive for ms", () => {
    const directive = getLanguageDirective("ms");
    expect(directive).toContain("Malay");
  });

  it("returns Mandarin directive for zh", () => {
    const directive = getLanguageDirective("zh");
    expect(directive).toContain("Mandarin");
  });

  it("returns Singlish directive for en-sg", () => {
    const directive = getLanguageDirective("en-sg");
    expect(directive).toContain("Singlish");
  });

  it("falls back to English for unknown language", () => {
    const directive = getLanguageDirective("fr" as SupportedLanguage);
    expect(directive).toBe(LANGUAGE_DIRECTIVES.en);
  });

  it("exports all 4 language keys", () => {
    expect(Object.keys(LANGUAGE_DIRECTIVES)).toHaveLength(4);
    expect(Object.keys(LANGUAGE_DIRECTIVES)).toEqual(
      expect.arrayContaining(["en", "ms", "zh", "en-sg"]),
    );
  });
});
