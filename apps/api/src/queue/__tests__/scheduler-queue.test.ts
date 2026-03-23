import { describe, it, expect } from "vitest";
import {
  createSchedulerJobData,
  SCHEDULER_QUEUE_NAME,
  computeTimerDelay,
  computeCronRepeatOpts,
} from "../scheduler-queue.js";

describe("scheduler-queue", () => {
  describe("SCHEDULER_QUEUE_NAME", () => {
    it("has the expected queue name", () => {
      expect(SCHEDULER_QUEUE_NAME).toBe("switchboard:scheduler");
    });
  });

  describe("createSchedulerJobData", () => {
    it("creates job data for a timer trigger", () => {
      const data = createSchedulerJobData({
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: { agent: "nurture" } },
      });
      expect(data).toEqual({
        triggerId: "trig-1",
        organizationId: "org-1",
        action: { type: "spawn_workflow", payload: { agent: "nurture" } },
      });
    });
  });

  describe("computeTimerDelay", () => {
    it("returns milliseconds until fireAt", () => {
      const now = new Date("2026-03-23T10:00:00Z");
      const fireAt = new Date("2026-03-23T10:05:00Z");
      const delay = computeTimerDelay(fireAt, now);
      expect(delay).toBe(5 * 60 * 1000);
    });

    it("returns 0 for past dates", () => {
      const now = new Date("2026-03-23T10:00:00Z");
      const fireAt = new Date("2026-03-23T09:00:00Z");
      const delay = computeTimerDelay(fireAt, now);
      expect(delay).toBe(0);
    });
  });

  describe("computeCronRepeatOpts", () => {
    it("returns BullMQ repeat options for cron expression", () => {
      const opts = computeCronRepeatOpts("0 9 * * 1-5");
      expect(opts).toEqual({ pattern: "0 9 * * 1-5" });
    });

    it("includes endDate when expiresAt is provided", () => {
      const expiresAt = new Date("2026-06-01T00:00:00Z");
      const opts = computeCronRepeatOpts("0 9 * * 1-5", expiresAt);
      expect(opts).toEqual({
        pattern: "0 9 * * 1-5",
        endDate: expiresAt,
      });
    });
  });
});
