import type { PdpaJurisdiction } from "@switchboard/schemas";

/**
 * Deterministic revocation acknowledgment per jurisdiction. No model.
 * Sent by the gateway revocation scanner when an inbound keyword match
 * triggers enforced revocation. Wording deliberately avoids
 * medical/safety/compliance leakage — the user does not need to know which
 * keyword they matched, only that we heard the request.
 */
export const REVOCATION_ACK: Record<PdpaJurisdiction, string> = {
  SG: "Got it — we won't message you further. If you change your mind, you can let the clinic team know directly.",
  MY: "Noted — we'll stop messaging you. To opt back in later, please contact the clinic directly.",
};
