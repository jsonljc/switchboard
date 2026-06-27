import { describe, it, expect } from "vitest";
import { selfExecutionEnvEnabled } from "./self-execution-flags.js";

// EV-11 pre-flip gate - MONEY-8 (flag-default-OFF, env half). The per-org∧dep composition is pinned
// in packages/ad-optimizer inngest-functions-handoff.test.ts (dep absent ⇒ never wired, flag off ⇒
// never wired); this pins the OTHER half - the env kill switch is strictly fail-closed, so a fleet
// never self-executes real money on a mis-set flag.
describe("selfExecutionEnvEnabled - MONEY-8 strict default-OFF env kill switch", () => {
  const REALLOCATE = "RILEY_REALLOCATE_SELF_EXECUTION_ENABLED";
  const PAUSE = "RILEY_PAUSE_SELF_EXECUTION_ENABLED";

  it('enables ONLY on the exact string "true"', () => {
    expect(selfExecutionEnvEnabled({ [REALLOCATE]: "true" }, REALLOCATE)).toBe(true);
  });

  it("is OFF when the flag is unset (default-OFF: no submitter wired)", () => {
    expect(selfExecutionEnvEnabled({}, REALLOCATE)).toBe(false);
  });

  // Fail-closed on every non-"true" value: a `!== "false"` / Boolean() regression would flip several
  // of these to true and silently arm fleet-wide self-execution.
  it.each(["false", "1", "0", "TRUE", "True", "yes", "on", "enabled", " true", "true ", ""])(
    'is OFF (fail-closed) for the non-"true" value %p',
    (value) => {
      expect(selfExecutionEnvEnabled({ [REALLOCATE]: value }, REALLOCATE)).toBe(false);
    },
  );

  it("gates each self-execution flag independently by key", () => {
    const env = { [PAUSE]: "true", [REALLOCATE]: "false" };
    expect(selfExecutionEnvEnabled(env, PAUSE)).toBe(true);
    expect(selfExecutionEnvEnabled(env, REALLOCATE)).toBe(false);
  });
});
