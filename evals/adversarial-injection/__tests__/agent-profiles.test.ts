import { describe, it, expect } from "vitest";
import { ALEX_PROFILE, RILEY_PROFILE, MIRA_PROFILE, PROFILES_BY_SEAM } from "../agent-profiles.js";
import { InjectionSeamSchema } from "../schema.js";
import { ALEX_ALLOWED_TOOL_IDS } from "../../alex-conversation/grade.js";

describe("agent profiles", () => {
  it("Alex's allowlist mirrors the real Alex tool set (single source of truth, no drift)", () => {
    expect(ALEX_PROFILE.allowedToolIds).toEqual([...ALEX_ALLOWED_TOOL_IDS]);
  });

  it("Alex carries prompt-leak canaries, so the leak check has teeth", () => {
    expect(ALEX_PROFILE.promptLeakCanaries.length).toBeGreaterThan(0);
  });

  it("PROFILES_BY_SEAM resolves every declared seam to its own profile", () => {
    for (const seam of InjectionSeamSchema.options) {
      const profile = PROFILES_BY_SEAM[seam];
      expect(profile).toBeDefined();
      expect(profile.seam).toBe(seam);
    }
  });

  it("Riley and Mira allowlists are explicitly provisional (null), never fabricated", () => {
    // Their live lanes (EV-3b Riley / EV-3c Mira) enumerate the real tool ids.
    // Until then `null` disables the unexpected-tool check for those seams rather
    // than asserting against a made-up list.
    expect(RILEY_PROFILE.allowedToolIds).toBeNull();
    expect(MIRA_PROFILE.allowedToolIds).toBeNull();
  });
});
