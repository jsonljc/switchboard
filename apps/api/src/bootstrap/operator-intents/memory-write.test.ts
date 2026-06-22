import { describe, it, expect, vi } from "vitest";
import {
  buildMemoryWriteHandler,
  MEMORY_WRITE_INTENT,
  type MemoryWriteStore,
} from "./memory-write.js";

function workUnit(parameters: Record<string, unknown>, orgId = "org_1", actorId = "system") {
  return {
    organizationId: orgId,
    actor: { id: actorId, type: "system" as const },
    intent: MEMORY_WRITE_INTENT,
    parameters,
  } as never;
}
function makeStore(): { create: ReturnType<typeof vi.fn> } & MemoryWriteStore {
  return { create: vi.fn<MemoryWriteStore["create"]>().mockResolvedValue({ id: "mem_1" }) };
}
const valid = {
  deploymentId: "dep_1",
  category: "fact",
  content: "Closed on Sundays",
  source: "conversation-compounding",
};

describe("buildMemoryWriteHandler", () => {
  it("writes through the store with the AUTHENTICATED org (never a body field) + provenance", async () => {
    const store = makeStore();
    const res = await buildMemoryWriteHandler(store).execute(
      workUnit({ ...valid, confidence: 0.8 }, "org_42"),
    );
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toMatchObject({ id: "mem_1", source: "conversation-compounding" });
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_42",
        deploymentId: "dep_1",
        category: "fact",
        content: "Closed on Sundays",
        source: "conversation-compounding",
        confidence: 0.8,
      }),
    );
  });
  it("defaults canonicalKey to null when omitted", async () => {
    const store = makeStore();
    await buildMemoryWriteHandler(store).execute(workUnit(valid));
    expect(store.create.mock.calls[0]![0].canonicalKey).toBeNull();
  });
  it("throws (Zod) on invalid params without calling the store", async () => {
    const store = makeStore();
    await expect(
      buildMemoryWriteHandler(store).execute(workUnit({ ...valid, source: "bogus" })),
    ).rejects.toThrow();
    expect(store.create).not.toHaveBeenCalled();
  });
});
