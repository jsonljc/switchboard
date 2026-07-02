import { resolveMarket, type SupportedCurrency } from "@switchboard/schemas";
import type { GovernanceConfigResolver } from "@switchboard/core/skill-runtime";

/**
 * Builds the per-request currency resolver the money tools (deposit-link,
 * calendar-book) inject. It derives the clinic's settlement currency from the SAME
 * governanceConfig the gates read (keyed by `ctx.deploymentId`), so the charge
 * currency and the gate jurisdiction can never disagree.
 *
 * Fail-closed: a "missing" or "error" resolution returns null, never a guessed
 * currency. The deposit tool turns null into a refusal (no charge); calendar-book
 * turns it into a null currency stamp (the booking still confirms).
 */
export function buildResolveCurrency(
  resolver: GovernanceConfigResolver,
): (deploymentId: string) => Promise<SupportedCurrency | null> {
  return async (deploymentId: string): Promise<SupportedCurrency | null> => {
    const resolution = await resolver(deploymentId);
    if (resolution.status !== "resolved") return null;
    // resolveMarket(config) reads the optional `market` passthrough marker first (null for an
    // unregistered market), else the legacy `jurisdiction`; `?.currency ?? null` is the single
    // fail-closed expression. A `?? config.jurisdiction` fallback would re-open the fail-close
    // (an unregistered market:"TH" config would resolve SGD instead of null).
    return resolveMarket(resolution.config)?.currency ?? null;
  };
}
