import { describe, expect, it } from "vitest";
import { isMainPush, SKIP_MESSAGE } from "../eval-preflight.js";

describe("eval-preflight", () => {
  it("isMainPush is true only for a push to refs/heads/main", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" })).toBe(true);
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feat/x" })).toBe(false);
    expect(isMainPush({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/main" })).toBe(
      false,
    );
    expect(isMainPush({})).toBe(false);
  });

  it("SKIP_MESSAGE names the eval and the missing key", () => {
    expect(SKIP_MESSAGE).toContain("mira-self-brief");
    expect(SKIP_MESSAGE).toContain("ANTHROPIC_API_KEY");
  });
});
