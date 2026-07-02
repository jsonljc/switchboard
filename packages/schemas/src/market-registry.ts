import type { SupportedCurrency } from "./governance-config.js";
import type { PdpaJurisdiction } from "./pdpa-consent.js";

/**
 * The open, fail-closed market axis that generalizes the closed `Jurisdiction` union
 * (`governance-config.ts`). Where `Jurisdiction` is a compile-time-exhaustive enum with
 * an `assertNever` chokepoint, a `MarketId` is an open string key validated only against
 * this registry: an unregistered id resolves to `null` rather than throwing or falling
 * back to a guess. This is deliberate for the open self-serve path, where a market can
 * be requested before it has been onboarded (currency, PDPA regime, timezone all
 * confirmed): the caller must handle `null`, not assume every market resolves.
 *
 * Seeded with SG and MY only. `SupportedCurrency` intentionally stays `"SGD" | "MYR"`:
 * a third settlement currency is demand-pulled (i.e. added when a funded door needs it),
 * not spun up speculatively on this path. `currencyForJurisdiction` (the existing money
 * chokepoint in `governance-config.ts`) is left untouched by this module; `currencyForMarket`
 * below is pinned to it via a parity test so the two can never silently drift apart.
 */
export type MarketId = string;

export interface Market {
  id: MarketId;
  currency: SupportedCurrency;
  pdpaJurisdiction: PdpaJurisdiction | null;
  loaderJurisdiction: "SG" | "MY";
  timezone: string;
}

const MARKETS: Readonly<Record<string, Market>> = Object.freeze({
  SG: {
    id: "SG",
    currency: "SGD",
    pdpaJurisdiction: "SG",
    loaderJurisdiction: "SG",
    timezone: "Asia/Singapore",
  },
  MY: {
    id: "MY",
    currency: "MYR",
    pdpaJurisdiction: "MY",
    loaderJurisdiction: "MY",
    timezone: "Asia/Kuala_Lumpur",
  },
});

/** The market's settlement currency, or null if the market is not registered. */
export function currencyForMarket(id: MarketId): SupportedCurrency | null {
  return MARKETS[id]?.currency ?? null;
}

/** The full market record, or null if not registered. (id-form; a config-reading
 *  overload is added in a later slice, so keep this parameter a plain MarketId string.) */
export function resolveMarket(id: MarketId): Market | null {
  return MARKETS[id] ?? null;
}
