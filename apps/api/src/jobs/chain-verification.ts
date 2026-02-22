import type { AuditLedger } from "@switchboard/core";

export interface ChainVerificationJobConfig {
  ledger: AuditLedger;
  intervalMs?: number;
  onBrokenChain?: (result: { chainBrokenAt: number | null; hashMismatches: unknown[] }) => void;
}

/**
 * Periodically runs deep verification on the audit chain.
 * Default interval is 24 hours. Returns a cleanup function.
 */
export function startChainVerificationJob(config: ChainVerificationJobConfig): () => void {
  const { ledger, intervalMs = 24 * 60 * 60 * 1000, onBrokenChain } = config;

  const run = async () => {
    try {
      const entries = await ledger.query({});
      const result = await ledger.deepVerify(entries);

      if (!result.valid) {
        console.error(
          `[chain-verify] ALERT: Audit chain integrity failure! ` +
          `chainBrokenAt=${result.chainBrokenAt}, hashMismatches=${result.hashMismatches.length}`,
        );
        onBrokenChain?.(result);
      } else {
        console.log(`[chain-verify] OK: ${result.entriesChecked} entries verified`);
      }
    } catch (err) {
      console.error("[chain-verify] Error running verification:", err);
    }
  };

  // Run once on startup
  run();

  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
