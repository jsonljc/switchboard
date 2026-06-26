import { describe, it, expect, vi } from "vitest";
import { setConversationStatusScoped } from "../set-conversation-status-scoped.js";

function makePrisma() {
  return {
    conversationState: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe("setConversationStatusScoped", () => {
  it("upserts on the per-org compound key and populates org on create (gateway path)", async () => {
    const prisma = makePrisma();
    await setConversationStatusScoped(prisma as never, {
      sessionId: "+6591234567",
      organizationId: "org_a",
      status: "human_override",
      upsertContext: { channel: "whatsapp", principalId: "+6591234567" },
    });

    expect(prisma.conversationState.upsert).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const arg = prisma.conversationState.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({
      organizationId_threadId: { organizationId: "org_a", threadId: "+6591234567" },
    });
    expect(arg.update).toEqual({ status: "human_override" });
    expect(arg.create).toMatchObject({
      threadId: "+6591234567",
      organizationId: "org_a",
      channel: "whatsapp",
      principalId: "+6591234567",
      status: "human_override",
    });
    expect(arg.create.expiresAt).toBeInstanceOf(Date);
    expect(prisma.conversationState.updateMany).not.toHaveBeenCalled();
  });

  it("org-scopes the update-only fallback when no upsertContext (api hook path)", async () => {
    const prisma = makePrisma();
    await setConversationStatusScoped(prisma as never, {
      sessionId: "+6599998888",
      organizationId: "org_b",
      status: "human_override",
    });

    expect(prisma.conversationState.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.conversationState.updateMany).toHaveBeenCalledWith({
      where: { threadId: "+6599998888", organizationId: "org_b" },
      data: { status: "human_override" },
    });
    expect(prisma.conversationState.upsert).not.toHaveBeenCalled();
  });
});
