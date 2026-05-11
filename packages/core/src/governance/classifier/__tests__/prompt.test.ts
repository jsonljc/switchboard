import { describe, it, expect } from "vitest";
import {
  CLASSIFIER_PROMPT_VERSION,
  CLASSIFIER_PROMPT_HASH,
  CLASSIFIER_SYSTEM_PROMPT,
} from "../prompt.js";

describe("classifier prompt artifact", () => {
  it("exports a human-readable version string with semver-style suffix", () => {
    expect(CLASSIFIER_PROMPT_VERSION).toMatch(/^claim-classifier@\d+\.\d+\.\d+$/);
  });

  it("exports a 16-char hex hash", () => {
    expect(CLASSIFIER_PROMPT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hash is stable across imports (pure derivation)", async () => {
    const reimport = await import("../prompt.js");
    expect(reimport.CLASSIFIER_PROMPT_HASH).toBe(CLASSIFIER_PROMPT_HASH);
  });

  it("system prompt enumerates all 9 claim types", () => {
    for (const ct of [
      "efficacy",
      "safety-claim",
      "superiority",
      "urgency",
      "testimonial",
      "medical-advice",
      "diagnosis",
      "credentials",
      "none",
    ]) {
      expect(CLASSIFIER_SYSTEM_PROMPT).toContain(ct);
    }
  });

  it("system prompt commits to structured JSON output", () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/JSON|structured/i);
  });
});
