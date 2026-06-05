import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_STATE_VOUCH_DAYS,
  OPERATIONAL_STATE_VOUCH_MS,
} from "../operational-state-policy.js";

describe("operational-state staleness policy (riley v3 slice 4c)", () => {
  it("pins the vouch window at 14 days (two weekly-audit cycles; the longest attribution half-window)", () => {
    expect(OPERATIONAL_STATE_VOUCH_DAYS).toBe(14);
  });

  it("derives the millisecond form from the day form (single source of truth)", () => {
    expect(OPERATIONAL_STATE_VOUCH_MS).toBe(OPERATIONAL_STATE_VOUCH_DAYS * 24 * 60 * 60 * 1000);
  });
});
