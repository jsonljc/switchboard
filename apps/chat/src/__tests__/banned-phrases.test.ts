import { describe, it, expect } from "vitest";
import { createBannedPhraseFilter } from "../filters/banned-phrases.js";
import type { BannedPhraseConfig } from "../filters/banned-phrases.js";

describe("createBannedPhraseFilter", () => {
  it("filters exact phrase matches (case-insensitive)", () => {
    const config: BannedPhraseConfig = {
      phrases: ["competitor_name", "guaranteed results"],
    };
    const filter = createBannedPhraseFilter(config);

    expect(filter("We are better than competitor_name!")).toBe("We are better than [redacted]!");
    expect(filter("We offer GUARANTEED RESULTS for you")).toBe("We offer [redacted] for you");
  });

  it("filters multiple occurrences", () => {
    const config: BannedPhraseConfig = { phrases: ["bad"] };
    const filter = createBannedPhraseFilter(config);

    expect(filter("bad word and another bad word")).toBe(
      "[redacted] word and another [redacted] word",
    );
  });

  it("uses custom replacement text", () => {
    const config: BannedPhraseConfig = {
      phrases: ["secret"],
      replacement: "***",
    };
    const filter = createBannedPhraseFilter(config);

    expect(filter("This is a secret message")).toBe("This is a *** message");
  });

  it("filters regex patterns", () => {
    const config: BannedPhraseConfig = {
      phrases: [],
      patterns: ["\\b\\d{3}-\\d{2}-\\d{4}\\b"],
    };
    const filter = createBannedPhraseFilter(config);

    expect(filter("SSN: 123-45-6789")).toBe("SSN: [redacted]");
  });

  it("applies both phrases and patterns", () => {
    const config: BannedPhraseConfig = {
      phrases: ["competitor"],
      patterns: ["\\d{4}-\\d{4}-\\d{4}-\\d{4}"],
    };
    const filter = createBannedPhraseFilter(config);

    expect(filter("competitor card 1234-5678-9012-3456")).toBe("[redacted] card [redacted]");
  });

  it("returns text unchanged when no config phrases", () => {
    const config: BannedPhraseConfig = { phrases: [] };
    const filter = createBannedPhraseFilter(config);

    const text = "This is a normal message";
    expect(filter(text)).toBe(text);
  });

  it("handles special regex characters in phrases", () => {
    const config: BannedPhraseConfig = {
      phrases: ["100% success"],
    };
    const filter = createBannedPhraseFilter(config);

    expect(filter("We promise 100% success rate")).toBe("We promise [redacted] rate");
  });

  it("handles empty input text", () => {
    const config: BannedPhraseConfig = { phrases: ["bad"] };
    const filter = createBannedPhraseFilter(config);

    expect(filter("")).toBe("");
  });
});
