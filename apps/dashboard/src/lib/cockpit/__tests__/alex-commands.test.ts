import { describe, expect, it } from "vitest";
import { ALEX_COMMANDS, ALEX_COMPOSER_PLACEHOLDER } from "../alex-commands";

describe("ALEX_COMMANDS", () => {
  it("has 14 entries", () => {
    expect(ALEX_COMMANDS).toHaveLength(14);
  });

  it("declares every locked command id exactly once", () => {
    const ids = ALEX_COMMANDS.map((c) => c.id);
    const expected = [
      "pause-1h",
      "pause-3pm",
      "resume",
      "halt",
      "brief-noon",
      "brief-eod",
      "fu-named",
      "reply-named",
      "hold-named",
      "stop-founder",
      "raise-rule",
      "open-settings",
      "open-rules",
      "open-meta",
    ];
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups every entry into one of control/thread/rules/nav", () => {
    for (const c of ALEX_COMMANDS) {
      expect(["control", "thread", "rules", "nav"]).toContain(c.group);
    }
  });

  it("exports the locked composer placeholder string", () => {
    expect(ALEX_COMPOSER_PLACEHOLDER).toMatch(/Tell Alex what to do/);
    expect(ALEX_COMPOSER_PLACEHOLDER).toMatch(/pause an hour/);
    expect(ALEX_COMPOSER_PLACEHOLDER).toMatch(/follow up with Maya/);
  });
});
