import { z } from "zod";

export const GovernanceModeSchema = z.enum(["off", "observe", "enforce"]);
export type GovernanceMode = z.infer<typeof GovernanceModeSchema>;

export const GovernanceConfigSchema = z
  .object({
    jurisdiction: z.enum(["SG", "MY"]),
    clinicType: z.enum(["medical", "nonMedical"]),
    deterministicGate: z
      .object({
        mode: GovernanceModeSchema.default("off"),
      })
      .default({}),
  })
  .passthrough();

export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

/**
 * Single source of truth for "what mode is this deployment in?".
 * Returns "off" when the config is null or the gate sub-block is missing.
 */
export function resolveGovernanceMode(config: GovernanceConfig | null): GovernanceMode {
  return config?.deterministicGate?.mode ?? "off";
}

/**
 * Per-deployment configuration for the Layer 2/3 claim classifier hook
 * (Task 15). Lives under `governanceConfig.claimClassifier` as a passthrough
 * sub-block — no Prisma migration required, the JSON column accepts arbitrary
 * sub-blocks at runtime.
 *
 * Defaults: mode="off" (pure pass-through), latencyBudgetMs=800 (per-turn budget
 * for all sentence classifications combined), model="claude-haiku-4-5-20251001",
 * confidenceThreshold=0.7 (a sub-threshold classification is treated as allow).
 */
export const ClaimClassifierConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
    latencyBudgetMs: z.number().int().positive().default(800),
    model: z.string().min(1).default("claude-haiku-4-5-20251001"),
    // T1.1: a classification below this confidence is not trusted to rewrite or
    // escalate a turn (the hook treats it as allow). De-risks the off->enforce
    // flip; root of over-flag #673. Principled default, not an operator UI knob.
    confidenceThreshold: z.number().min(0).max(1).default(0.7),
  })
  .default({});

export type ClaimClassifierConfig = z.infer<typeof ClaimClassifierConfigSchema>;

/**
 * Single source of truth for "what classifier mode is this deployment in?".
 *
 * The parent GovernanceConfigSchema uses .passthrough() so the claimClassifier
 * sub-block is not validated as part of the parent schema. Callers consume it
 * via this helper which applies defaults when absent.
 */
export function resolveClaimClassifierConfig(
  config: GovernanceConfig | null,
): ClaimClassifierConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.claimClassifier;
  return ClaimClassifierConfigSchema.parse(raw ?? {});
}

/**
 * Per-deployment configuration for the PDPA consent gate (Phase 1c).
 * Lives under `governanceConfig.consentState` as a passthrough sub-block —
 * no Prisma migration of the config column itself; 1b-1's `.passthrough()`
 * already accepts arbitrary sub-blocks.
 *
 * Defaults: mode="off" (pure pass-through; no consent state mutation, no
 * revocation detection, no verdicts). Promote to "observe" for telemetry-only
 * rollout, then "enforce" for production behavior.
 */
export const ConsentStateConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
  })
  .default({});

export type ConsentStateConfig = z.infer<typeof ConsentStateConfigSchema>;

export function resolveConsentStateConfig(config: GovernanceConfig | null): ConsentStateConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.consentState;
  // Fail-safe: a corrupt stored sub-block (bad mode enum, non-object) must NOT throw and crash the
  // booking turn. Coerce to the documented "off" default (no consent-state mutation, no enforcement).
  // This helper is also the PdpaConsentGateHook read site, so the hook inherits the same coercion.
  const parsed = ConsentStateConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    // The fail-open coercion to "off" silently disables PDPA enforcement for this org across the
    // three consent gates (enforcement / revocation / pdpa). Emit telemetry so a corrupt config is
    // not invisible. Log ONLY the Zod issue path+code (field name + validation kind) — never the
    // raw value or Zod message, which can echo stored input; the consentState sub-block carries no
    // PII/PHI (no phone/email/name), but path+code keeps it airtight by construction.
    console.error(
      "[governance-config] corrupt consentState sub-block; failing open to mode=off (PDPA enforcement disabled for this org)",
      { issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
    );
    return { mode: "off" };
  }
  return parsed.data;
}

/**
 * Per-deployment configuration for Robin's no-show recovery campaign cron (v1).
 * Lives under `governanceConfig.recovery` as a passthrough sub-block - no Prisma
 * migration (the parent schema's `.passthrough()` already accepts arbitrary sub-blocks).
 *
 * Defaults: mode="off" (the cron is fully inert: no candidate scan, no campaigns, no sends).
 * Promote to "observe" to count recovery candidates in the cron (telemetry only, no submit),
 * then "enforce" to submit campaigns that PARK for manager approval before any send.
 */
export const RecoveryConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
  })
  .default({});

export type RecoveryConfig = z.infer<typeof RecoveryConfigSchema>;

export function resolveRecoveryConfig(config: GovernanceConfig | null): RecoveryConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.recovery;
  // Fail-CLOSED: a corrupt stored sub-block (bad mode enum, non-object) must NOT throw and crash the
  // cron tick. Coerce to the documented "off" default (no campaigns, no sends - the safe direction for
  // a mass-outbound capability). Log ONLY the Zod issue path+code (no raw value; the sub-block carries
  // no PII) so a corrupt config is not silently inert. Mirrors resolveConsentStateConfig above, which
  // is why logging from this L1 layer is consistent with the established pattern.
  const parsed = RecoveryConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    console.error(
      "[governance-config] corrupt recovery sub-block; failing closed to mode=off (no recovery campaigns for this org)",
      { issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
    );
    return { mode: "off" };
  }
  return parsed.data;
}

/**
 * Per-deployment configuration for the Phase 3a mechanical lifecycle tagging
 * layer. Lives under `governanceConfig.lifecycleTagging.mechanical` as a
 * passthrough sub-block — the parent schema uses `.passthrough()`, no Prisma
 * migration required.
 *
 * Defaults: mode="off" (no lifecycle DB writes, no transitions, no cron sweep
 * for the org). Promote to "on" once the tenant is ready to record mechanical
 * lifecycle state. Phase 3b and 3c will add sibling sub-blocks under
 * `lifecycleTagging` (e.g., `lifecycleTagging.qualification`,
 * `lifecycleTagging.recommendations`).
 *
 * Note: this config uses a binary on/off rather than the off/observe/enforce
 * pattern of `deterministicGate`/`claimClassifier`/`consentState`. Lifecycle
 * tagging has no in-flight side effects to gate — either we are recording
 * transitions or we are not.
 */
export const LifecycleTaggingMechanicalConfigSchema = z
  .object({
    mode: z.enum(["off", "on"]).default("off"),
  })
  .default({});

export type LifecycleTaggingMechanicalConfig = z.infer<
  typeof LifecycleTaggingMechanicalConfigSchema
>;

export function resolveLifecycleTaggingMechanicalConfig(
  config: GovernanceConfig | null,
): LifecycleTaggingMechanicalConfig {
  const lifecycleTagging = (config as unknown as Record<string, unknown> | null)
    ?.lifecycleTagging as Record<string, unknown> | undefined;
  const raw = lifecycleTagging?.mechanical;
  return LifecycleTaggingMechanicalConfigSchema.parse(raw ?? {});
}

/**
 * Per-deployment configuration for the Phase 3b qualification lifecycle tagging
 * layer. Lives under `governanceConfig.lifecycleTagging.qualification` as a
 * passthrough sub-block — the parent schema uses `.passthrough()`, no Prisma
 * migration required.
 *
 * Defaults: mode="off" (no qualification signal recording). Sibling to
 * `lifecycleTagging.mechanical`; both can be enabled independently per org.
 * Binary on/off — either we are recording qualification transitions or we are not.
 */
export const LifecycleTaggingQualificationConfigSchema = z
  .object({
    mode: z.enum(["off", "on"]).default("off"),
  })
  .default({});

export type LifecycleTaggingQualificationConfig = z.infer<
  typeof LifecycleTaggingQualificationConfigSchema
>;

export function resolveLifecycleQualificationConfig(
  config: GovernanceConfig | null,
): LifecycleTaggingQualificationConfig {
  const lifecycleTagging = (config as unknown as Record<string, unknown> | null)
    ?.lifecycleTagging as Record<string, unknown> | undefined;
  const raw = lifecycleTagging?.qualification;
  return LifecycleTaggingQualificationConfigSchema.parse(raw ?? {});
}

export interface ObserveGovernanceConfigInput {
  jurisdiction: "SG" | "MY";
  clinicType: "medical" | "nonMedical";
}

/** ISO-4217 settlement currencies Alex supports, one per market. */
export type SupportedCurrency = "SGD" | "MYR";

/**
 * The clinic's settlement currency, derived from its single market. The mapping is
 * 1:1 by product definition (SG -> SGD, MY -> MYR): a clinic occupies one market and
 * settles one Stripe currency, so currency is a pure function of jurisdiction rather
 * than a second stored field that could drift out of sync with the market.
 *
 * Total over the jurisdiction enum with NO default branch: adding a jurisdiction
 * without a currency is a compile error, so a new market can never silently charge or
 * quote the wrong currency. This is the single chokepoint every money surface resolves
 * through (deposit charge, booked-value stamp, quoted price, dashboard display).
 */
export function currencyForJurisdiction(jurisdiction: "SG" | "MY"): SupportedCurrency {
  switch (jurisdiction) {
    case "SG":
      return "SGD";
    case "MY":
      return "MYR";
  }
}

// A type alias (not an interface) so the value stays assignable to JSON-column
// input types that use index signatures (e.g. Prisma's InputJsonValue).
export type ObserveGovernanceConfig = {
  jurisdiction: "SG" | "MY";
  clinicType: "medical" | "nonMedical";
  deterministicGate: { mode: "observe" };
  claimClassifier: { mode: "observe" };
  consentState: { mode: "observe" };
  whatsappWindow: {
    enabled: boolean;
    mode: "observe";
    allowMarketingTemplateSubstitution: boolean;
  };
  lifecycleTagging: {
    mechanical: { mode: "off" };
    qualification: { mode: "off" };
  };
};

/**
 * Canonical all-gates-observe posture for staged governance rollout: every
 * mode-bearing gate (the shared pre-input/output deterministic gate, the claim
 * classifier, the consent gate, the WhatsApp window gate) runs telemetry-only;
 * lifecycle tagging stays off. Seeds and tests consume THIS factory so the
 * seeded posture, the parity test, and the eval can never drift apart.
 * The off->enforce flip is a deliberate per-gate ops config update on the
 * observe bake, never a default.
 */
export function buildObserveGovernanceConfig(
  input: ObserveGovernanceConfigInput,
): ObserveGovernanceConfig {
  return {
    jurisdiction: input.jurisdiction,
    clinicType: input.clinicType,
    deterministicGate: { mode: "observe" },
    claimClassifier: { mode: "observe" },
    consentState: { mode: "observe" },
    whatsappWindow: {
      enabled: true,
      mode: "observe",
      allowMarketingTemplateSubstitution: false,
    },
    lifecycleTagging: {
      mechanical: { mode: "off" },
      qualification: { mode: "off" },
    },
  };
}
