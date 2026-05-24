import { describe, it, expect } from "vitest";
import {
  GovernanceHook,
  DeterministicSafetyGateHook,
  ClaimClassifierHook,
  PdpaConsentGateHook,
} from "../index.js";
import type { SkillHook } from "../types.js";

// The concrete hook classes implement only the lifecycle phases they use, so we
// read their prototypes through the SkillHook interface (where every phase is
// optional) to assert which phases are present vs. absent.
const asHook = (proto: object): SkillHook => proto as SkillHook;

/**
 * Compliance-safety invariant behind the SMB launch-posture trust override.
 *
 * Raising a deployment's trust level (e.g. `trustLevelOverride: "autonomous"`)
 * changes only the `beforeToolCall` admission decision — `GovernanceHook` is the
 * sole hook that reads `ctx.trustLevel` (via `getToolGovernanceDecision`). The
 * deny-based compliance floor (banned-phrase scanner, claim classifier, PDPA
 * consent gate) runs as `afterSkill` hooks that inspect the generated output and
 * never consult trust level. Because the hook runner returns early only on
 * `proceed: false`, a hook proceeding never short-circuits later hooks.
 *
 * Therefore: auto-allowing tool calls cannot disable banned-claim / consent
 * blocking. This test pins the phase separation so a future refactor can't
 * silently move a compliance gate onto the trust-gated `beforeToolCall` path.
 */
describe("deny floor is independent of the trust-gated tool-call path", () => {
  it("GovernanceHook is the only hook on the trust-gated beforeToolCall phase", () => {
    expect(typeof asHook(GovernanceHook.prototype).beforeToolCall).toBe("function");
    // GovernanceHook does not also enforce on afterSkill.
    expect(asHook(GovernanceHook.prototype).afterSkill).toBeUndefined();
  });

  it("the compliance-floor hooks enforce on afterSkill, never on beforeToolCall", () => {
    for (const HookClass of [
      DeterministicSafetyGateHook,
      ClaimClassifierHook,
      PdpaConsentGateHook,
    ]) {
      const proto = asHook(HookClass.prototype);
      // afterSkill = scans generated output; this is where banned-phrase / claim /
      // consent blocking lives, gated by governance MODE, not trust level.
      expect(typeof proto.afterSkill).toBe("function");
      // No beforeToolCall ⇒ ctx.trustLevel (and thus the trust override) cannot
      // gate these hooks. The deny floor stands regardless of auto-allow posture.
      expect(proto.beforeToolCall).toBeUndefined();
    }
  });
});
