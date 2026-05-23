import { describe, expect, it } from "vitest";
import type { RouteTemplates } from "../route-templates.js";

describe("RouteTemplates interface", () => {
  it("accepts an implementation matching the documented shape", () => {
    const fake: RouteTemplates = {
      contactDetail: (id) => `/x/${id}`,
      contactConversations: (id) => `/x/${id}/c`,
      contactConversationDetail: (id, threadId) => `/x/${id}/c/${threadId}`,
    };
    expect(fake.contactDetail("a")).toBe("/x/a");
    expect(fake.contactConversations("b")).toBe("/x/b/c");
    expect(fake.contactConversationDetail("d", "t")).toBe("/x/d/c/t");
  });
});
