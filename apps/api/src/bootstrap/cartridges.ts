// ---------------------------------------------------------------------------
// Cartridge registration — bootstrap and register all cartridges
// ---------------------------------------------------------------------------

import { seedDefaultStorage, GuardedCartridge, ProfileLoader } from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import {
  bootstrapDigitalAdsCartridge,
  DEFAULT_DIGITAL_ADS_POLICIES,
  createSnapshotCacheStore,
} from "@switchboard/digital-ads";
import type { MetaAdsWriteProvider } from "@switchboard/digital-ads";
import { bootstrapPaymentsCartridge, DEFAULT_PAYMENTS_POLICIES } from "@switchboard/payments";
import { bootstrapCrmCartridge, DEFAULT_CRM_POLICIES } from "@switchboard/crm";
import {
  bootstrapCustomerEngagementCartridge,
  DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES,
  setEscalationNotifier,
} from "@switchboard/customer-engagement";
import {
  bootstrapRevenueGrowthCartridge,
  DEFAULT_REVENUE_GROWTH_POLICIES,
  MockConnector,
  MetaAdsConnector,
} from "@switchboard/revenue-growth";
import type { CartridgeConnector, RevGrowthDeps } from "@switchboard/revenue-growth";
import type Redis from "ioredis";

interface CartridgeCredentials {
  adsAccessToken?: string;
  adsAccountId?: string;
  stripeSecretKey?: string;
}

export async function resolveCartridgeCredentials(
  prismaClient: import("@switchboard/db").PrismaClient | null,
  logger: { warn: (...args: unknown[]) => void },
): Promise<CartridgeCredentials> {
  let adsAccessToken = process.env["META_ADS_ACCESS_TOKEN"];
  let adsAccountId = process.env["META_ADS_ACCOUNT_ID"];
  let stripeSecretKey = process.env["STRIPE_SECRET_KEY"];

  if (prismaClient) {
    try {
      const { PrismaConnectionStore } = await import("@switchboard/db");
      const connStore = new PrismaConnectionStore(prismaClient);

      const adsCon = await connStore.getByServiceGlobal("meta-ads");
      if (adsCon) {
        adsAccessToken =
          (adsCon.credentials as Record<string, string>).accessToken ?? adsAccessToken;
        adsAccountId = (adsCon.credentials as Record<string, string>).adAccountId ?? adsAccountId;
      }

      const stripeCon = await connStore.getByServiceGlobal("stripe");
      if (stripeCon) {
        stripeSecretKey =
          (stripeCon.credentials as Record<string, string>).secretKey ?? stripeSecretKey;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to load cartridge credentials from DB, using env vars");
    }
  }

  return { adsAccessToken, adsAccountId, stripeSecretKey };
}

export interface CartridgeBootstrapResult {
  adsWriteProvider: MetaAdsWriteProvider | null;
  businessProfile: import("@switchboard/schemas").BusinessProfile | undefined;
}

export async function registerCartridges(
  storage: StorageContext,
  credentials: CartridgeCredentials,
  redis: Redis | null,
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
): Promise<CartridgeBootstrapResult> {
  const isProd = process.env.NODE_ENV === "production";

  // Register digital-ads cartridge
  const { cartridge: adsCartridge, interceptors } = await bootstrapDigitalAdsCartridge({
    accessToken: credentials.adsAccessToken ?? (isProd ? "" : "mock-token-dev-only"),
    adAccountId: credentials.adsAccountId ?? (isProd ? "" : "act_mock_dev_only"),
    requireCredentials: isProd,
    cacheStore: createSnapshotCacheStore(redis ?? undefined),
  });
  storage.cartridges.register("digital-ads", new GuardedCartridge(adsCartridge, interceptors));
  await seedDefaultStorage(storage, DEFAULT_DIGITAL_ADS_POLICIES);
  const adsWriteProvider = adsCartridge.getWriteProvider();

  // Register payments cartridge
  const { cartridge: paymentsCartridge } = await bootstrapPaymentsCartridge({
    secretKey: credentials.stripeSecretKey ?? (isProd ? "" : "mock-key-dev-only"),
    requireCredentials: isProd,
  });
  storage.cartridges.register("payments", new GuardedCartridge(paymentsCartridge));
  await seedDefaultStorage(storage, DEFAULT_PAYMENTS_POLICIES);

  // Register CRM cartridge (built-in, no external credentials needed)
  const { cartridge: crmCartridge } = await bootstrapCrmCartridge();
  storage.cartridges.register("crm", new GuardedCartridge(crmCartridge));
  await seedDefaultStorage(storage, DEFAULT_CRM_POLICIES);

  // Register customer-engagement cartridge
  let businessProfile: import("@switchboard/schemas").BusinessProfile | undefined;
  const profileId = process.env["PROFILE_ID"];
  if (profileId) {
    const profilesDir = new URL("../../../../profiles", import.meta.url).pathname;
    const profileLoader = new ProfileLoader(profilesDir);
    try {
      businessProfile = await profileLoader.load(profileId);
      logger.info({ profileId }, `Business profile "${profileId}" loaded`);
    } catch (err) {
      logger.warn(
        { err, profileId },
        `Failed to load business profile "${profileId}" — using defaults`,
      );
    }
  }

  const { cartridge: peCartridge, interceptors: peInterceptors } =
    await bootstrapCustomerEngagementCartridge(
      { requireCredentials: process.env.NODE_ENV === "production" },
      businessProfile,
    );
  storage.cartridges.register(
    "customer-engagement",
    new GuardedCartridge(peCartridge, peInterceptors),
  );
  await seedDefaultStorage(storage, DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES);

  // Register revenue-growth cartridge
  const revGrowthConnector =
    credentials.adsAccessToken && credentials.adsAccountId
      ? buildMetaAdsConnectorSync(credentials.adsAccessToken, credentials.adsAccountId)
      : new MockConnector();

  const revGrowthDeps = await buildRevGrowthDeps(revGrowthConnector);

  const { cartridge: revGrowthCartridge } = await bootstrapRevenueGrowthCartridge({
    deps: revGrowthDeps,
  });
  storage.cartridges.register("revenue-growth", new GuardedCartridge(revGrowthCartridge));
  await seedDefaultStorage(storage, DEFAULT_REVENUE_GROWTH_POLICIES);

  return { adsWriteProvider, businessProfile };
}

function buildMetaAdsConnectorSync(accessToken: string, adAccountId: string): CartridgeConnector {
  try {
    return new MetaAdsConnector({ accessToken, adAccountId });
  } catch {
    return new MockConnector();
  }
}

async function buildRevGrowthDeps(connector: CartridgeConnector): Promise<RevGrowthDeps> {
  const deps: RevGrowthDeps = { connectors: [connector] };

  try {
    const {
      getDb,
      PrismaInterventionStore,
      PrismaDiagnosticCycleStore,
      PrismaRevenueAccountStore,
      PrismaWeeklyDigestStore,
    } = await import("@switchboard/db");
    const prisma = getDb();
    // Prisma stores satisfy the store interfaces via structural typing at runtime.
    // The Prisma layer deserializes JSON columns as `unknown[]` / `string[]`,
    // which is narrower than the Zod-derived union types in the interface.
    // The cartridge consumes these opaquely, so the cast is safe.
    deps.interventionStore = new PrismaInterventionStore(
      prisma,
    ) as unknown as RevGrowthDeps["interventionStore"];
    deps.cycleStore = new PrismaDiagnosticCycleStore(
      prisma,
    ) as unknown as RevGrowthDeps["cycleStore"];
    deps.accountStore = new PrismaRevenueAccountStore(
      prisma,
    ) as unknown as RevGrowthDeps["accountStore"];
    deps.digestStore = new PrismaWeeklyDigestStore(
      prisma,
    ) as unknown as RevGrowthDeps["digestStore"];
  } catch {
    // Prisma stores not available — run without persistence
  }

  return deps;
}

export async function wireEscalationNotifier(): Promise<void> {
  const { sendProactiveNotification } = await import("../alerts/notifier.js");
  setEscalationNotifier({
    async notify(escalation) {
      const escalationCredentials = {
        slack: process.env["SLACK_BOT_TOKEN"]
          ? { botToken: process.env["SLACK_BOT_TOKEN"] }
          : undefined,
        telegram: process.env["TELEGRAM_BOT_TOKEN"]
          ? { botToken: process.env["TELEGRAM_BOT_TOKEN"] }
          : undefined,
        whatsapp:
          process.env["WHATSAPP_TOKEN"] && process.env["WHATSAPP_PHONE_NUMBER_ID"]
            ? {
                token: process.env["WHATSAPP_TOKEN"],
                phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"],
              }
            : undefined,
      };

      const channels = process.env["ESCALATION_CHANNELS"]?.split(",") ?? ["telegram"];
      const recipients = process.env["ESCALATION_RECIPIENTS"]?.split(",") ?? [];

      if (recipients.length === 0) {
        console.warn("[escalation] No ESCALATION_RECIPIENTS configured — notification skipped");
        return;
      }

      await sendProactiveNotification(
        {
          title: "Customer Escalation",
          body: [
            `Patient: ${escalation.contactId}`,
            `Reason: ${escalation.reason}`,
            escalation.conversationId ? `Conversation: ${escalation.conversationId}` : null,
            `Time: ${escalation.escalatedAt}`,
          ]
            .filter(Boolean)
            .join("\n"),
          severity: "warning",
          channels,
          recipients,
        },
        escalationCredentials,
      );
    },
  });
}
