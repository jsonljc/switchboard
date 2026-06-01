import { describe, it, expect } from "vitest";
import { buildFollowUpSendSubmitRequest } from "../followup-send-request.js";

const input = {
  organizationId: "org_1",
  contactId: "contact_1",
  conversationThreadId: "thread_1",
  channel: "whatsapp",
  templateIntentClass: "re-engagement-offer",
  reason: "went_quiet",
  followUpId: "fu_1",
};

describe("buildFollowUpSendSubmitRequest", () => {
  it("uses the seeded 'system' principal so governance can resolve identity (not a bespoke system:* id)", () => {
    const req = buildFollowUpSendSubmitRequest(input, { deploymentId: "dep_1", skillSlug: "alex" });
    expect(req.actor).toEqual({ id: "system", type: "service" });
    expect(req.intent).toBe("conversation.followup.send");
    expect(req.trigger).toBe("schedule");
    expect(req.idempotencyKey).toBe("followup-send:fu_1");
    expect(req.surface).toEqual({ surface: "api" });
    expect(req.parameters).toMatchObject({ contactId: "contact_1", followUpId: "fu_1" });
    expect(req.targetHint).toEqual({ deploymentId: "dep_1", skillSlug: "alex" });
  });

  it("omits targetHint when no deployment resolves", () => {
    const req = buildFollowUpSendSubmitRequest(input, null);
    expect(req.targetHint).toBeUndefined();
  });
});
