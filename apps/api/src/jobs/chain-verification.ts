import type { AuditLedger } from "@switchboard/core";

export interface ChainVerificationJobConfig {
  ledger: AuditLedger;
  intervalMs?: number;
  onBrokenChain?: (result: { chainBrokenAt: number | null; hashMismatches: unknown[] }) => void;
}

/**
 * Periodically runs deep verification on the audit chain.
 * Default interval is 24 hours. Returns a cleanup function that stops the
 * interval and signals any in-flight verification to not start new work.
 */
export function startChainVerificationJob(config: ChainVerificationJobConfig): () => void {
  const { ledger, intervalMs = 24 * 60 * 60 * 1000, onBrokenChain } = config;

  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  const run = async () => {
    if (stopped) return;
    try {
      const entries = await ledger.query({});
      if (stopped) return;
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
  inFlightPromise = run();

  const timer = setInterval(() => {
    inFlightPromise = run();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
    if (inFlightPromise) {
      inFlightPromise.catch(() => {});
    }
  };
}
