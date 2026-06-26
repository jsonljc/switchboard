import { describe, it, expect } from "vitest";
import { SKIP_MESSAGE, isMainPush } from "../eval-preflight.js";

describe("claim-boundary eval-preflight", () => {
  it("pins the SKIPPED message wording", () => {
    expect(SKIP_MESSAGE).toBe("claim-boundary eval skipped: ANTHROPIC_API_KEY is not available");
  });

  it("isMainPush is true only on a push to refs/heads/main", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" })).toBe(true);
    expect(isMainPush({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/main" })).toBe(
      false,
    );
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature" })).toBe(false);
    expect(isMainPush({})).toBe(false);
  });
});
