import type { ToolResult } from "../tool-result.js";
import { fail } from "../tool-result.js";
import { getMetrics } from "../../telemetry/metrics.js";
import { evaluateConsentGate } from "@switchboard/schemas";
import type { GovernanceMode, PdpaJurisdiction } from "@switchboard/schemas";

/**
 * F15 — flag-gated consent precondition on booking. INERT BY DEFAULT.
 *
 * Extracted from calendar-book.ts (raw-line budget + cohesion): the booking
 * tool historically never read consent; the only consent surface was an
 * afterSkill OUTBOUND-text hook (PdpaConsentGateHook). This module lets apps/api
 * inject the consent reader + per-deployment consent mode so the tool can
 * fail-closed BEFORE persisting a booking when, and only when, an org has
 * explicitly flipped its consent mode to "enforce".
 *
 * Doctrine: enforcement lives INSIDE the tool (NOT a governance constraint —
 * constraints never reach the executor; see
 * feedback_skill_runtime_two_constraint_regimes). Core stays dep-injected: NO
 * Prisma, NO env. The adapter in apps/api closes the real ContactConsentReader +
 * GovernanceConfigResolver over these methods.
 */

/**
 * Minimal consent-state shape this precondition needs to evaluate the gate. A
 * structural subset of `ContactConsentState` (packages/schemas/pdpa-consent.ts)
 * so the injected reader can return the full state and still satisfy this
 * contract. Timestamps are ISO strings (mirroring `ContactConsentState`, which
 * is what the live `ContactConsentReader` returns) — the field type
 * `evaluateConsentGate` narrows to.
 */
export interface BookingConsentState {
  pdpaJurisdiction: PdpaJurisdiction | null;
  consentGrantedAt: string | null;
  consentRevokedAt: string | null;
}

/**
 * Mode semantics (resolveMode returns the per-deployment consentState mode,
 * default "off"):
 *   - "off"     — the precondition does not even read consent (zero overhead, fully inert)
 *   - "observe" — telemetry-only; never blocks a booking
 *   - "enforce" — a non-affirmative consent state blocks the booking, fail-closed
 */
export interface ConsentPrecondition {
  /**
   * Per-deployment consent mode. Resolved from the deployment's
   * governanceConfig.consentState sub-block (default "off"). When the producer
   * is unset this returns "off" and the gate is inert.
   */
  resolveMode(deploymentId: string): Promise<GovernanceMode>;
  /**
   * Reads the contact's consent state. `orgId` is carried for tenant-scoping /
   * identity even though today's reader keys on contactId alone. Only called
   * when mode !== "off". The helper below treats a read error as a block under
   * enforce (fail-closed) so a missing/erroring contact never silently books.
   */
  read(orgId: string, contactId: string): Promise<BookingConsentState>;
}

const CONSENT_REQUIRED_REMEDIATION =
  "Do not book. The contact has not given the consent this clinic requires. Ask for consent first, or escalate to the operator.";

function consentRequiredFailure(orgId: string, reason: string): ToolResult {
  getMetrics().bookingConsentBlocked.inc({ orgId, reason });
  return fail(
    "CONSENT_REQUIRED",
    "I can't book this in just yet because we don't have the consent we need on file.",
    { modelRemediation: CONSENT_REQUIRED_REMEDIATION, retryable: false },
  );
}

/**
 * F15 — evaluates the flag-gated consent precondition for a booking.
 *
 * Returns a `ToolResult` (the booking MUST abort, write nothing) when the gate
 * blocks, or `null` when the booking may proceed.
 *
 * Inert-by-default contract:
 *   - mode "off" — returns null WITHOUT reading consent (zero overhead). This is
 *     the production default and the reason the gate causes no live behavior
 *     change until an org explicitly flips to "enforce".
 *   - mode "observe" — reads consent for telemetry parity but returns null
 *     (never blocks).
 *   - mode "enforce" — reads consent and BLOCKS (fail-closed, non-retryable)
 *     when it is not affirmative.
 *
 * Affirmative check reuses `evaluateConsentGate` with `messageClass: "proactive"`
 * (NOT a new enum): proactive blocks both `pending` and `revoked`, i.e. it
 * allows only `granted` and `not_applicable` — exactly "affirmative or no PDPA
 * obligation". We deliberately do not introduce a fourth message class.
 */
export async function enforceConsentPrecondition(
  precondition: ConsentPrecondition,
  ids: { deploymentId: string; orgId: string; contactId: string },
): Promise<ToolResult | null> {
  const mode = await precondition.resolveMode(ids.deploymentId);
  // "off" short-circuits before any read — keeps the gate fully inert/no-overhead.
  if (mode === "off") return null;

  // Fail-closed: a read error under enforce must BLOCK (we cannot prove consent),
  // never silently book. Under observe it is swallowed (telemetry-only posture).
  let consent: BookingConsentState;
  try {
    consent = await precondition.read(ids.orgId, ids.contactId);
  } catch (err) {
    if (mode === "enforce") {
      console.error("[calendar-book] consent read failed under enforce; blocking booking", err);
      return consentRequiredFailure(ids.orgId, "read_error");
    }
    return null;
  }

  const decision = evaluateConsentGate({
    contact: {
      pdpaJurisdiction: consent.pdpaJurisdiction,
      consentGrantedAt: consent.consentGrantedAt,
      consentRevokedAt: consent.consentRevokedAt,
    },
    // Reuse proactive semantics: allow only granted / not_applicable; block
    // pending + revoked. A booking is an outbound commitment, so the stricter
    // proactive matrix is the right precondition — no new enum value.
    messageClass: "proactive",
  });

  // observe is telemetry-only: never block, regardless of decision. (The
  // outbound consent gate owns verdict persistence; this precondition adds no
  // behavior in observe so the off->enforce flip is the only live change.)
  if (mode !== "enforce") return null;

  if (decision.action === "block") {
    return consentRequiredFailure(ids.orgId, decision.reasonCode);
  }
  return null;
}
