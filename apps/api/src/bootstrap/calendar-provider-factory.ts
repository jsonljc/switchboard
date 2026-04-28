import type { PrismaClient } from "@switchboard/db";
import type { CalendarProvider } from "@switchboard/schemas";

export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

export interface CalendarProviderFactoryDeps {
  prismaClient: PrismaClient;
  // Matches the existing bootstrap logger shape (verified in Task 1).
  logger: { info(msg: string): void; error(msg: string): void };
  // Optional env injection for tests; falls back to process.env.
  env?: { GOOGLE_CALENDAR_CREDENTIALS?: string; GOOGLE_CALENDAR_ID?: string };
}

export function createCalendarProviderFactory(
  deps: CalendarProviderFactoryDeps,
): CalendarProviderFactory {
  // No eviction in beta (~10 orgs, process-lifetime cache mirrors today's
  // singleton lifetime per orgId). Production should add TTL or explicit
  // invalidation if calendar credentials/business hours can rotate at runtime.
  const cache = new Map<string, Promise<CalendarProvider>>();

  const factory: CalendarProviderFactory = (orgId: string) => {
    if (!orgId || typeof orgId !== "string" || orgId.trim() === "") {
      return Promise.reject(new Error("ORG_ID_REQUIRED"));
    }

    const existing = cache.get(orgId);
    if (existing) return existing;

    const promise = resolveForOrg(deps, orgId).catch((error) => {
      cache.delete(orgId);
      throw error;
    });

    cache.set(orgId, promise);
    return promise;
  };

  return factory;
}

async function resolveForOrg(
  _deps: CalendarProviderFactoryDeps,
  _orgId: string,
): Promise<CalendarProvider> {
  // Placeholder — implemented in Task 4.
  throw new Error("NOT_IMPLEMENTED");
}
