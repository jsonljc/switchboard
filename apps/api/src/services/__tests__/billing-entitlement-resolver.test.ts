import { describe, it, expect } from "vitest";
import { PrismaBillingEntitlementResolver } from "../billing-entitlement-resolver.js";

interface FakeOrgRow {
  subscriptionStatus: string;
  entitlementOverride: boolean;
}

function makePrisma(rows: Record<string, FakeOrgRow | null>) {
  return {
    organizationConfig: {
      findUnique: async ({ where }: { where: { id: string } }) => rows[where.id] ?? null,
    },
  };
}

describe("PrismaBillingEntitlementResolver", () => {
  it("returns blocked when org config is missing", async () => {
    const resolver = new PrismaBillingEntitlementResolver(makePrisma({}) as never);
    const result = await resolver.resolve("org_missing");
    expect(result).toEqual({
      entitled: false,
      reason: "blocked",
      blockedStatus: "missing",
    });
  });

  it("returns entitled for active subscription", async () => {
    const resolver = new PrismaBillingEntitlementResolver(
      makePrisma({
        org_a: { subscriptionStatus: "active", entitlementOverride: false },
      }) as never,
    );
    const result = await resolver.resolve("org_a");
    expect(result).toEqual({ entitled: true, reason: "active" });
  });

  it("returns entitled for entitlementOverride even when canceled", async () => {
    const resolver = new PrismaBillingEntitlementResolver(
      makePrisma({
        org_b: { subscriptionStatus: "canceled", entitlementOverride: true },
      }) as never,
    );
    const result = await resolver.resolve("org_b");
    expect(result).toEqual({ entitled: true, reason: "override" });
  });

  it("returns blocked for canceled without override", async () => {
    const resolver = new PrismaBillingEntitlementResolver(
      makePrisma({
        org_c: { subscriptionStatus: "canceled", entitlementOverride: false },
      }) as never,
    );
    const result = await resolver.resolve("org_c");
    expect(result).toEqual({
      entitled: false,
      reason: "blocked",
      blockedStatus: "canceled",
    });
  });

  it("only selects the two columns it needs", async () => {
    let capturedSelect: unknown;
    const prisma = {
      organizationConfig: {
        findUnique: async (args: { where: { id: string }; select?: unknown }) => {
          capturedSelect = args.select;
          return { subscriptionStatus: "active", entitlementOverride: false };
        },
      },
    };
    const resolver = new PrismaBillingEntitlementResolver(prisma as never);
    await resolver.resolve("org_a");
    expect(capturedSelect).toEqual({ subscriptionStatus: true, entitlementOverride: true });
  });
});
