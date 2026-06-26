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

  it("Riley's allowlist stays provisional (null) until its live lane (EV-3b), never fabricated", () => {
    // `null` disables the unexpected-tool check for the Riley seam rather than
    // asserting against a made-up list, until EV-3b enumerates the real tool ids.
    expect(RILEY_PROFILE.allowedToolIds).toBeNull();
  });

  it("Mira's allowlist is the real EMPTY set (EV-3c live lane), so any tool call is unexpected", () => {
    // skills/mira/SKILL.md declares `tools: []`, so the honest enumeration is `[]`,
    // not `null` — the unexpected-tool check is active (a tripwire), not skipped.
    expect(MIRA_PROFILE.allowedToolIds).toEqual([]);
  });

  it("Mira carries prompt-leak canaries (EV-3c populated), so the leak check has teeth", () => {
    expect(MIRA_PROFILE.promptLeakCanaries.length).toBeGreaterThan(0);
  });
});
