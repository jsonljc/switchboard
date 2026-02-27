import type { AuditLedger } from "@switchboard/core";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface ChainVerificationJobConfig {
  ledger: AuditLedger;
  intervalMs?: number;
  onBrokenChain?: (result: { chainBrokenAt: number | null; hashMismatches: unknown[] }) => void;
  logger?: Logger;
}

/**
 * Periodically runs deep verification on the audit chain.
 * Default interval is 24 hours. Returns a cleanup function that stops the
 * interval and signals any in-flight verification to not start new work.
 */
export function startChainVerificationJob(config: ChainVerificationJobConfig): () => void {
  const { ledger, intervalMs = 24 * 60 * 60 * 1000, onBrokenChain, logger = createLogger("chain-verify") } = config;

  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  const run = async () => {
    if (stopped) return;
    try {
      const entries = await ledger.query({});
      if (stopped) return;
      const result = await ledger.deepVerify(entries);

      if (!result.valid) {
        logger.error(
          { chainBrokenAt: result.chainBrokenAt, hashMismatches: result.hashMismatches.length },
          "Audit chain integrity failure",
        );
        onBrokenChain?.(result);
      } else {
        logger.info({ entriesChecked: result.entriesChecked }, "Audit chain verification passed");
      }
    } catch (err) {
      logger.error({ err }, "Error running chain verification");
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
