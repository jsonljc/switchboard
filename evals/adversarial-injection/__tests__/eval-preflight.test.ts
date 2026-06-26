import { describe, it, expect } from "vitest";
import { isMainPush, SKIP_MESSAGE } from "../eval-preflight.js";

describe("isMainPush", () => {
  it("is true only for a push to refs/heads/main", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" })).toBe(true);
  });

  it("is false for a pull_request, a non-main ref, or an empty env", () => {
    expect(isMainPush({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/main" })).toBe(
      false,
    );
    expect(isMainPush({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feat/x" })).toBe(false);
    expect(isMainPush({})).toBe(false);
  });

  it("exposes a skip message that names the missing key", () => {
    expect(SKIP_MESSAGE).toMatch(/ANTHROPIC_API_KEY/);
  });
});
