import { describe, it, expect } from "vitest";
import { isFinalBullMqJobAttempt } from "../bullmq-attempts.js";

describe("isFinalBullMqJobAttempt", () => {
  it("treats current attempt as attemptsMade + 1 (BullMQ semantics)", () => {
    expect(isFinalBullMqJobAttempt({ attemptsMade: 0, opts: { attempts: 3 } })).toBe(false);
    expect(isFinalBullMqJobAttempt({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
    expect(isFinalBullMqJobAttempt({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(true);
  });

  it("uses opts.attempts when set", () => {
    expect(isFinalBullMqJobAttempt({ attemptsMade: 3, opts: { attempts: 5 } })).toBe(false);
    expect(isFinalBullMqJobAttempt({ attemptsMade: 4, opts: { attempts: 5 } })).toBe(true);
  });

  it("falls back when opts.attempts is missing", () => {
    expect(isFinalBullMqJobAttempt({ attemptsMade: 2 }, 3)).toBe(true);
    expect(isFinalBullMqJobAttempt({ attemptsMade: 1 }, 3)).toBe(false);
  });
});
