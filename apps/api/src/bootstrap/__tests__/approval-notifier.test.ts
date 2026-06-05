import { describe, it, expect, vi } from "vitest";
import { SlackApprovalNotifier } from "@switchboard/core/notifications";
import { buildParkedApprovalNotifier } from "../approval-notifier.js";

describe("buildParkedApprovalNotifier", () => {
  it("constructs a SlackApprovalNotifier when both env values are present", () => {
    const info = vi.fn();
    const notifier = buildParkedApprovalNotifier(
      { slackBotToken: "xoxb-1", slackApprovalChannel: "C_OPS" },
      { info },
    );
    expect(notifier).toBeInstanceOf(SlackApprovalNotifier);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Slack enabled"));
    // The enable log restates the same-app constraint (spec section 5): the
    // posting token must belong to the app whose interactivity URL routes to
    // the managed webhook, or taps never arrive.
    expect(info).toHaveBeenCalledWith(expect.stringContaining("interactivity"));
  });

  it.each([
    ["token missing", { slackBotToken: undefined, slackApprovalChannel: "C_OPS" }],
    ["channel missing", { slackBotToken: "xoxb-1", slackApprovalChannel: undefined }],
    ["both missing", { slackBotToken: undefined, slackApprovalChannel: undefined }],
    ["empty strings", { slackBotToken: "", slackApprovalChannel: "" }],
  ])("returns undefined and logs when %s", (_name, env) => {
    const info = vi.fn();
    const notifier = buildParkedApprovalNotifier(env, { info });
    expect(notifier).toBeUndefined();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("off"));
  });
});
