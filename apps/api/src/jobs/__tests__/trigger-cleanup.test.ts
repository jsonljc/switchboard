import { describe, it, expect, vi } from "vitest";
import { createTriggerCleanupJob } from "../trigger-cleanup.js";
import type { TriggerStore } from "@switchboard/core";

describe("trigger cleanup job", () => {
  it("calls deleteExpired with current date", async () => {
    const store: Partial<TriggerStore> = {
      deleteExpired: vi.fn(async () => 5),
    };

    const job = createTriggerCleanupJob(store as TriggerStore);
    const deleted = await job();
    expect(deleted).toBe(5);
    expect(store.deleteExpired).toHaveBeenCalledWith(expect.any(Date));
  });
});
