import { describe, it, expect, vi } from "vitest";
import { createTriggerCleanupJob } from "../trigger-cleanup.js";
import type { TriggerStore } from "@switchboard/core";

describe("trigger cleanup job", () => {
  it("calls expireOverdue and deleteExpired with current date", async () => {
    const store: Partial<TriggerStore> = {
      expireOverdue: vi.fn(async () => 2),
      deleteExpired: vi.fn(async () => 5),
    };

    const job = createTriggerCleanupJob(store as TriggerStore);
    const result = await job();
    expect(result).toEqual({ expired: 2, deleted: 5 });
    expect(store.expireOverdue).toHaveBeenCalledWith(expect.any(Date));
    expect(store.deleteExpired).toHaveBeenCalledWith(expect.any(Date));
  });
});
