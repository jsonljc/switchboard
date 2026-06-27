import { describe, it, expect, vi } from "vitest";
import { runConsentRevocationGate } from "../consent-revocation-gate.js";
import {
  InMemoryGovernancePostureCache,
  type GovernancePosture,
} from "../../governance/posture-cache.js";
import { loadRevocationKeywords } from "../../consent/revocation-keywords/loader.js";
import type { GovernanceConfigResolution } from "../../governance/governance-config-resolver.js";

/**
 * EV-9a / GOV-1 — PINS the INBOUND consent revocation gate's FAIL-OPEN behavior on a
 * governance-config resolver error (`consent-revocation-gate.ts:31-55`).
 *
 * SURFACE (consent stop-zone). This file deliberately pins a fail-OPEN: on a governance
 * resolver outage the gate returns "proceed" and never scans for / records the inbound
 * revocation. So an inbound "STOP" arriving during the outage is DROPPED — the revocation
 * is not honored. Under a healthy resolver the identical "STOP" IS honored ("revoked" +
 * recordRevocation; pinned in `pre-input-consent-gate.test.ts`). That gap is real PDPA
 * exposure: a customer's revocation can be silently lost during a governance-store outage.
 *
 * It is pinned here as the CURRENT, DELIBERATE behavior (it mirrors the EGRESS twin,
 * `consent-enforcement-gate.test.ts:150-187`) so any future fail-CLOSED change
 * (optimistically capture the revocation, or queue it for replay) is an explicit,
 * test-flagged decision instead of silent drift. The egress complement already pinned this
 * branch; the inbound revocation gate did not — that is the GOV-1 gap. Flagged for human
 * review in the PR body: is dropping an inbound STOP during an outage worth flipping closed?
 */

const ERROR_RESOLUTION: GovernanceConfigResolution = {
  status: "error",
  error: new Error("governance store unavailable"),
};

const SG_ENFORCE_RESOLVED: GovernanceConfigResolution = {
  status: "resolved",
  config: {
    jurisdiction: "SG",
    clinicType: "medical",
    deterministicGate: { mode: "off" },
    consentState: { mode: "enforce" },
  },
};

const ENFORCE_POSTURE: GovernancePosture = {
  mode: "enforce",
  jurisdiction: "SG",
  clinicType: "medical",
};

const FIXED_NOW = new Date("2026-05-11T10:00:00Z");

/** A real revocation keyword — honored ("revoked") under a healthy resolver in enforce mode. */
const REVOCATION_STOP = "STOP messaging me";

const buildDeps = (resolution: GovernanceConfigResolution) => {
  const governanceConfigResolver = vi.fn().mockResolvedValue(resolution);
  const consentService = {
    attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
    recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
    recordGrant: vi.fn().mockResolvedValue(undefined),
    recordRevocation: vi.fn().mockResolvedValue(undefined),
    clearConsent: vi.fn().mockResolvedValue(undefined),
  };
  const verdictStore = { save: vi.fn().mockResolvedValue({}) };
  const postureCache = new InMemoryGovernancePostureCache();
  const sessionContactResolver = vi.fn().mockResolvedValue("c1");
  const replySink = { send: vi.fn().mockResolvedValue(undefined) };
  return {
    cfg: {
      governanceConfigResolver,
      consentService,
      postureCache,
      revocationKeywordLoader: loadRevocationKeywords,
      sessionContactResolver,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      verdictStore: verdictStore as any,
      clock: () => FIXED_NOW,
    },
    replySink,
    consentService,
    verdictStore,
    postureCache,
  };
};

describe("runConsentRevocationGate — resolver-error fail-open (EV-9a / GOV-1, SURFACE)", () => {
  it("resolver error + cached ENFORCE posture: proceeds, emits a critical governance_unavailable verdict, and DROPS the STOP (no revocation recorded, no ack)", async () => {
    const { cfg, replySink, consentService, verdictStore, postureCache } =
      buildDeps(ERROR_RESOLUTION);
    // A prior healthy turn cached an enforce posture for this deployment.
    postureCache.remember("d1", ENFORCE_POSTURE);

    const out = await runConsentRevocationGate({
      cfg,
      inboundText: REVOCATION_STOP,
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      replySink: replySink as any,
    });

    // FAIL-OPEN: the gate proceeds rather than capturing the revocation.
    expect(out).toBe("proceed");
    // PDPA exposure made explicit: the inbound STOP is neither recorded nor acknowledged.
    expect(consentService.recordRevocation).not.toHaveBeenCalled();
    expect(replySink.send).not.toHaveBeenCalled();

    // ...but the fail-open IS audited as a critical row, attributed off the cached enforce posture.
    expect(verdictStore.save).toHaveBeenCalledTimes(1);
    expect(verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "d1",
        sourceGuard: "consent_gate",
        action: "allow",
        reasonCode: "governance_unavailable",
        auditLevel: "critical",
        jurisdiction: "SG",
        clinicType: "medical",
        conversationId: "sess1",
        originalText: REVOCATION_STOP,
        decidedAt: FIXED_NOW.toISOString(),
        details: { event: "gateway_resolver_error_fail_open" },
      }),
    );
  });

  it("resolver error + NO cached posture (cold cache): proceeds, logs, emits NO verdict, and DROPS the STOP", async () => {
    const { cfg, replySink, consentService, verdictStore } = buildDeps(ERROR_RESOLUTION);
    // Cache left empty — no prior posture for this deployment.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await runConsentRevocationGate({
      cfg,
      inboundText: REVOCATION_STOP,
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      replySink: replySink as any,
    });

    expect(out).toBe("proceed");
    expect(consentService.recordRevocation).not.toHaveBeenCalled();
    expect(replySink.send).not.toHaveBeenCalled();
    // Log-only allow: with no cached enforce posture there is nothing to attribute an audit row to.
    expect(verdictStore.save).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("resolver error; no cached enforce posture"),
    );
    errorSpy.mockRestore();
  });

  it("resolver error + cached OBSERVE posture is NOT an enforce posture: stays log-only (no critical verdict)", async () => {
    // Pins the `cached?.mode === "enforce"` check: a cached *observe* posture takes the same
    // log-only branch as a cold cache — only a cached *enforce* posture produces the audit row.
    const { cfg, replySink, verdictStore, postureCache } = buildDeps(ERROR_RESOLUTION);
    postureCache.remember("d1", {
      mode: "observe",
      jurisdiction: "MY",
      clinicType: "nonMedical",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await runConsentRevocationGate({
      cfg,
      inboundText: REVOCATION_STOP,
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      replySink: replySink as any,
    });

    expect(out).toBe("proceed");
    expect(verdictStore.save).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("resolver error; no cached enforce posture"),
    );
    errorSpy.mockRestore();
  });

  it("SURFACE: the SAME inbound STOP is HONORED under a healthy resolver but DROPPED under a resolver error (pinned fail-open; candidate to flip fail-closed)", async () => {
    // The fail-open-vs-fail-closed choice made explicit and self-contained. A fail-CLOSED
    // alternative would optimistically capture the revocation (or queue it) so an outage never
    // loses a STOP. Pinned as-is pending that human call — see PR body.

    // Healthy resolver, enforce mode: the revocation IS honored.
    const healthy = buildDeps(SG_ENFORCE_RESOLVED);
    const honored = await runConsentRevocationGate({
      cfg: healthy.cfg,
      inboundText: REVOCATION_STOP,
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      replySink: healthy.replySink as any,
    });
    expect(honored).toBe("revoked");
    expect(healthy.consentService.recordRevocation).toHaveBeenCalledTimes(1);

    // Resolver outage, identical input: the revocation is silently DROPPED.
    const broken = buildDeps(ERROR_RESOLUTION);
    broken.postureCache.remember("d1", ENFORCE_POSTURE);
    const dropped = await runConsentRevocationGate({
      cfg: broken.cfg,
      inboundText: REVOCATION_STOP,
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      replySink: broken.replySink as any,
    });
    expect(dropped).not.toBe("revoked");
    expect(dropped).toBe("proceed");
    expect(broken.consentService.recordRevocation).not.toHaveBeenCalled();
  });
});
