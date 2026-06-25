import type { GovernanceGateUnit } from "@switchboard/schemas";

/** The producer signals a gate depends on to enforce safely. */
export interface GateProducerSignals {
  approvedPriceCount: number;
  approvedClaimCount: number;
  approvedTemplateCount: number;
}

export interface GateEnforceReadiness {
  ready: boolean;
  blockingReason: string | null;
}

const READY: GateEnforceReadiness = { ready: true, blockingReason: null };

/**
 * Decides whether a gate may be flipped to `enforce`, given its producer signals.
 *
 * REFUSE-by-default when the producer the gate reads is empty (fail-safe: enforcing
 * an empty-producer gate would over-block legitimate replies). `consent` is the
 * principled exception: its enforce is fail-safe by construction (it blocks only a
 * revoked-contact race; the disclosure path never blocks, even in enforce), so no
 * producer gate applies. Each unit is gated ONLY by its own producer.
 *
 * This is the authoritative readiness decision. The flip handler (slice 3) calls it
 * server-side to REFUSE an unready enforce flip; the readiness endpoint calls it to
 * display the same verdict. Same function, so display and enforcement cannot drift.
 */
export function evaluateGateEnforceReadiness(
  unit: GovernanceGateUnit,
  signals: GateProducerSignals,
): GateEnforceReadiness {
  switch (unit) {
    case "deterministic":
      return signals.approvedPriceCount > 0
        ? READY
        : {
            ready: false,
            blockingReason:
              "Add at least one approved service price before enforcing — otherwise every priced reply is blocked.",
          };
    case "claims":
      return signals.approvedClaimCount > 0
        ? READY
        : {
            ready: false,
            blockingReason:
              "Add at least one approved compliance claim before enforcing — otherwise every efficacy claim is escalated.",
          };
    case "whatsapp":
      return signals.approvedTemplateCount > 0
        ? READY
        : {
            ready: false,
            blockingReason:
              "Approve at least one WhatsApp template before enforcing — otherwise out-of-window replies are blocked.",
          };
    case "consent":
      return READY;
  }
}
