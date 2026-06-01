import { describe, it, expect, beforeEach, vi } from "vitest";
import { createScheduleFollowUpToolFactory } from "./schedule-follow-up.js";
import type { SkillRequestContext } from "../types.js";

function makeDeps() {
  return {
    followUpStore: {
      create: vi.fn().mockResolvedValue({ id: "fu_1" }),
      findPendingForContact: vi.fn().mockResolvedValue(null),
    },
    now: () => new Date("2026-06-01T00:00:00.000Z"),
  };
}

const CTX: SkillRequestContext = {
  sessionId: "thread_1",
  orgId: "org_1",
  deploymentId: "dep_1",
  workUnitId: "wu_1",
  contactId: "contact_1",
};

describe("schedule-follow-up tool", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("factory returns a tool with id 'follow-up' and a write-effect schedule op", () => {
    const tool = createScheduleFollowUpToolFactory(deps)(CTX);
    expect(tool.id).toBe("follow-up");
    expect(tool.operations["followup.schedule"]!.effectCategory).toBe("write");
    expect(tool.operations["followup.schedule"]!.idempotent).toBe(true);
  });

  it("fails closed when no contact is bound to the conversation", async () => {
    const tool = createScheduleFollowUpToolFactory(deps)({ ...CTX, contactId: undefined });
    const r = await tool.operations["followup.schedule"]!.execute({
      reason: "hesitation",
      delay: "in_3_days",
    });
    expect(r.status).toBe("error");
    expect(r.error!.code).toBe("MISSING_CONTACT");
    expect(deps.followUpStore.create).not.toHaveBeenCalled();
  });

  it("schedules a follow-up using trusted ctx ids, computing dueAt + dedupeKey from delay", async () => {
    const tool = createScheduleFollowUpToolFactory(deps)(CTX);
    const r = await tool.operations["followup.schedule"]!.execute({
      reason: "price_concern",
      delay: "in_3_days",
      note: "wants pricing on weekend",
    });
    expect(r.status).toBe("success");
    expect(r.data).toEqual({
      followUpId: "fu_1",
      scheduledFor: "2026-06-04T00:00:00.000Z",
      status: "scheduled",
    });
    expect(deps.followUpStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        contactId: "contact_1",
        conversationThreadId: "thread_1",
        sessionId: "thread_1",
        deploymentId: "dep_1",
        workUnitId: "wu_1",
        channel: "whatsapp",
        reason: "price_concern",
        templateIntentClass: "re-engagement-offer",
        dueAt: new Date("2026-06-04T00:00:00.000Z"),
        dedupeKey: "followup:org_1:contact_1:2026-06-04",
      }),
    );
  });

  it("is idempotent — returns already_scheduled when a pending follow-up exists", async () => {
    deps.followUpStore.findPendingForContact.mockResolvedValue({ id: "fu_existing" });
    const tool = createScheduleFollowUpToolFactory(deps)(CTX);
    const r = await tool.operations["followup.schedule"]!.execute({
      reason: "went_quiet",
      delay: "in_1_day",
    });
    expect(r.status).toBe("success");
    expect(r.data).toEqual({ followUpId: "fu_existing", status: "already_scheduled" });
    expect(deps.followUpStore.create).not.toHaveBeenCalled();
  });
});
