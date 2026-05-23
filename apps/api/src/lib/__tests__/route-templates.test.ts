import { describe, expect, it } from "vitest";
import { dashboardRouteTemplates } from "../route-templates.js";

describe("dashboardRouteTemplates", () => {
  it("contactDetail returns /contacts/<id>", () => {
    expect(dashboardRouteTemplates.contactDetail("c-abc")).toBe("/contacts/c-abc");
  });

  it("contactConversations returns /contacts/<id>/conversations", () => {
    expect(dashboardRouteTemplates.contactConversations("c-abc")).toBe(
      "/contacts/c-abc/conversations",
    );
  });

  it("contactConversationDetail returns /contacts/<id>/conversations/<threadId>", () => {
    expect(dashboardRouteTemplates.contactConversationDetail("c-abc", "t-1")).toBe(
      "/contacts/c-abc/conversations/t-1",
    );
  });

  it("does not crash on empty id (constant-level safety, even though no PR-2.5 caller passes empty)", () => {
    // adaptHandoff in PR-2.5 tightens its guard so it never calls this with
    // an empty contact id (it returns null instead). The constant must still
    // not crash on empty inputs in case a future caller is less careful —
    // this is a safety lock, not a contract some caller actively depends on.
    expect(dashboardRouteTemplates.contactConversationDetail("", "t-1")).toBe(
      "/contacts//conversations/t-1",
    );
  });
});
