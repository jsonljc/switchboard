import type { GovernanceConfig, SupportedCurrency } from "./governance-config.js";
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
 *
 * `resolveMarket` accepts either an id-form (`MarketId` string) or a config-form (a stored
 * `GovernanceConfig`). The config-form reads the optional `market` passthrough marker first
 * (mirroring the `vertical` marker read by `resolveVertical`), then falls back to the legacy
 * `jurisdiction` field (SG/MY) when no marker is present: every pre-marker config resolves
 * the same market it always did. The marker is written by the S2-4 provisioning selector;
 * this module only reads it.
 */
export type MarketId = string;

export interface Market {
  readonly id: MarketId;
  readonly currency: SupportedCurrency;
  readonly pdpaJurisdiction: PdpaJurisdiction | null;
  readonly loaderJurisdiction: "SG" | "MY";
  readonly timezone: string;
}

// Null-prototype backing map: a plain object literal inherits from Object.prototype,
// so `MARKETS["constructor"]` (or "__proto__" / "toString" / etc.) would resolve to the
// inherited value instead of undefined, defeating the `?? null` fail-closed fallback below.
// Object.create(null) removes the prototype chain so only explicitly-seeded keys resolve.
const MARKETS: Readonly<Record<MarketId, Market>> = Object.freeze(
  Object.assign(Object.create(null) as Record<MarketId, Market>, {
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
  } satisfies Record<MarketId, Market>),
);

/** The market's settlement currency, or null if the market is not registered. */
export function currencyForMarket(id: MarketId): SupportedCurrency | null {
  return MARKETS[id]?.currency ?? null;
}

/**
 * The full market record, or null if not registered / resolvable.
 *
 * - id-form: `resolveMarket(id)` looks up a `MarketId` string directly.
 * - config-form: `resolveMarket(config)` resolves a market from a stored `GovernanceConfig`:
 *   it reads the optional `market` passthrough marker first, and falls back to the legacy
 *   `jurisdiction` field (SG/MY) when no marker is present. This keeps every existing
 *   (pre-marker) config byte-identical: `jurisdiction` alone still resolves the market it
 *   always did.
 *
 * Both forms fail closed to `null` for an unregistered id: `MARKETS` is the null-prototype
 * map above, so an inherited/unknown key never resolves to a wrong value.
 */
export function resolveMarket(id: MarketId): Market | null;
export function resolveMarket(config: GovernanceConfig | null): Market | null;
export function resolveMarket(arg: MarketId | GovernanceConfig | null): Market | null {
  if (arg === null) return null;
  if (typeof arg === "string") return MARKETS[arg] ?? null;
  // Config form: honor the optional `market` passthrough marker; else fall back to
  // the legacy `jurisdiction` field (SG/MY). An unregistered/absent market fails closed to null.
  const marker = (arg as unknown as Record<string, unknown>).market;
  const key = typeof marker === "string" ? marker : arg.jurisdiction;
  return MARKETS[key] ?? null;
}
