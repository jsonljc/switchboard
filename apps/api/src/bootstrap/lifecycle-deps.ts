// ---------------------------------------------------------------------------
// Lifecycle Deps Factory — builds ContactLifecycleService + FallbackHandler
// ---------------------------------------------------------------------------
// Used by API to enable contact lifecycle management.
// Returns null when required config is missing, allowing degraded boot.
// ---------------------------------------------------------------------------

import {
  PrismaContactStore,
  PrismaOpportunityStore,
  PrismaRevenueStore,
  PrismaOwnerTaskStore,
} from "@switchboard/db";
import {
  ContactLifecycleService,
  FallbackHandler,
  DEFAULT_STAGE_HANDLER_MAP,
} from "@switchboard/core";
import type { OwnerTaskStore } from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";
import { ContactResolver } from "./contact-resolver.js";

export interface LifecycleDeps {
  lifecycleService: ContactLifecycleService;
  fallbackHandler: FallbackHandler;
  ownerTaskStore: OwnerTaskStore;
  contactResolver: ContactResolver;
}

export function buildLifecycleDeps(prisma: PrismaClient): LifecycleDeps | null {
  try {
    const contactStore = new PrismaContactStore(prisma);
    const opportunityStore = new PrismaOpportunityStore(prisma);
    const revenueStore = new PrismaRevenueStore(prisma);
    const ownerTaskStore = new PrismaOwnerTaskStore(prisma);

    const lifecycleService = new ContactLifecycleService({
      contactStore,
      opportunityStore,
      revenueStore,
      ownerTaskStore,
    });

    const fallbackHandler = new FallbackHandler({
      ownerTaskStore,
      stageHandlerMap: DEFAULT_STAGE_HANDLER_MAP,
    });

    const contactResolver = new ContactResolver(lifecycleService);

    return { lifecycleService, fallbackHandler, ownerTaskStore, contactResolver };
  } catch (err) {
    console.error("[lifecycle-deps] Failed to build lifecycle dependencies:", err);
    return null;
  }
}
