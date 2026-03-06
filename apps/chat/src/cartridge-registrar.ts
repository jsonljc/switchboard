// ---------------------------------------------------------------------------
// Cartridge Registrar — centralises cartridge bootstrap & registration
// ---------------------------------------------------------------------------

import type { StorageContext } from "@switchboard/core";
import type { BusinessProfile } from "@switchboard/schemas";
import { seedDefaultStorage, GuardedCartridge } from "@switchboard/core";
import {
  bootstrapDigitalAdsCartridge,
  DEFAULT_DIGITAL_ADS_POLICIES,
  createSnapshotCacheStore,
} from "@switchboard/digital-ads";
import {
  bootstrapQuantTradingCartridge,
  DEFAULT_TRADING_POLICIES,
} from "@switchboard/quant-trading";
import { bootstrapPaymentsCartridge, DEFAULT_PAYMENTS_POLICIES } from "@switchboard/payments";
import { bootstrapCrmCartridge, DEFAULT_CRM_POLICIES } from "@switchboard/crm";
import type { CrmProviderOptions, CrmProvider } from "@switchboard/crm";
import {
  bootstrapCustomerEngagementCartridge,
  DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES,
} from "@switchboard/customer-engagement";

export interface RegisterCartridgesResult {
  /** The CRM provider instance, if initialized. */
  crmProvider: CrmProvider | null;
}

/**
 * Register all domain cartridges into the provided storage context.
 * When a business profile is provided, it is passed to the customer-engagement cartridge.
 */
export async function registerAllCartridges(
  storage: StorageContext,
  profile?: BusinessProfile,
): Promise<RegisterCartridgesResult> {
  // Digital ads
  const { cartridge: adsCartridge, interceptors } = await bootstrapDigitalAdsCartridge({
    accessToken: process.env["META_ADS_ACCESS_TOKEN"] ?? "mock-token",
    adAccountId: process.env["META_ADS_ACCOUNT_ID"] ?? "act_mock",
    cacheStore: createSnapshotCacheStore(),
  });
  storage.cartridges.register(
    "digital-ads",
    new GuardedCartridge(adsCartridge as any, interceptors),
  );
  await seedDefaultStorage(storage, DEFAULT_DIGITAL_ADS_POLICIES);

  // Quant trading
  const { cartridge: tradingCartridge } = await bootstrapQuantTradingCartridge();
  storage.cartridges.register("quant-trading", new GuardedCartridge(tradingCartridge));
  await seedDefaultStorage(storage, DEFAULT_TRADING_POLICIES);

  // Payments
  const { cartridge: paymentsCartridge } = await bootstrapPaymentsCartridge({
    secretKey: process.env["STRIPE_SECRET_KEY"] ?? "mock-key",
    requireCredentials: process.env.NODE_ENV === "production",
  });
  storage.cartridges.register("payments", new GuardedCartridge(paymentsCartridge));
  await seedDefaultStorage(storage, DEFAULT_PAYMENTS_POLICIES);

  // CRM — use Prisma-backed provider when database is available
  let crmProviderOptions: CrmProviderOptions | undefined;
  if (process.env["DATABASE_URL"]) {
    const { getDb } = await import("@switchboard/db");
    crmProviderOptions = { prisma: getDb() };
  }
  const { cartridge: crmCartridge } = await bootstrapCrmCartridge(undefined, crmProviderOptions);
  storage.cartridges.register("crm", new GuardedCartridge(crmCartridge));
  await seedDefaultStorage(storage, DEFAULT_CRM_POLICIES);

  // Customer engagement
  const { cartridge: peCartridge, interceptors: peInterceptors } =
    await bootstrapCustomerEngagementCartridge(
      {
        requireCredentials: process.env.NODE_ENV === "production",
      },
      profile,
    );
  storage.cartridges.register(
    "customer-engagement",
    new GuardedCartridge(peCartridge, peInterceptors),
  );
  await seedDefaultStorage(storage, DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES);

  return { crmProvider: crmCartridge.getProvider() };
}

/**
 * Default available actions exposed to chat interpreters.
 * Covers all registered cartridge action types.
 */
export const DEFAULT_CHAT_AVAILABLE_ACTIONS: string[] = [
  // Digital ads
  "digital-ads.campaign.pause",
  "digital-ads.campaign.resume",
  "digital-ads.campaign.adjust_budget",
  "digital-ads.adset.pause",
  "digital-ads.adset.resume",
  "digital-ads.adset.adjust_budget",
  "digital-ads.targeting.modify",
  "digital-ads.funnel.diagnose",
  "digital-ads.portfolio.diagnose",
  "digital-ads.snapshot.fetch",
  "digital-ads.structure.analyze",
  // Trading
  "trading.order.market_buy",
  "trading.order.market_sell",
  "trading.order.limit_buy",
  "trading.order.limit_sell",
  "trading.order.cancel",
  "trading.position.close",
  "trading.portfolio.rebalance",
  "trading.risk.set_stop_loss",
  // Payments
  "payments.invoice.create",
  "payments.invoice.void",
  "payments.charge.create",
  "payments.refund.create",
  "payments.subscription.cancel",
  "payments.subscription.modify",
  "payments.link.create",
  "payments.link.deactivate",
  "payments.credit.apply",
  "payments.batch.invoice",
  // CRM
  "crm.contact.search",
  "crm.contact.create",
  "crm.contact.update",
  "crm.deal.list",
  "crm.deal.create",
  "crm.activity.list",
  "crm.activity.log",
  "crm.pipeline.status",
  "crm.pipeline.diagnose",
  "crm.activity.analyze",
];
