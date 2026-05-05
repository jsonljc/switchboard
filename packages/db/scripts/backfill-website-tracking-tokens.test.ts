import { describe, expect, it, vi } from "vitest";
import { backfillWebsiteTrackingTokens } from "./backfill-website-tracking-tokens.js";

describe("backfillWebsiteTrackingTokens", () => {
  it("populates websiteTrackingToken for orgs that lack one", async () => {
    const updates: Array<{ id: string; data: { websiteTrackingToken: string } }> = [];
    const fakePrisma = {
      organizationConfig: {
        findMany: vi.fn().mockResolvedValue([
          { id: "org-a", websiteTrackingToken: null },
          { id: "org-b", websiteTrackingToken: null },
        ]),
        update: vi.fn(
          async (args: { where: { id: string }; data: { websiteTrackingToken: string } }) => {
            updates.push({ id: args.where.id, data: args.data });
            return null;
          },
        ),
      },
    } as unknown as Parameters<typeof backfillWebsiteTrackingTokens>[0];

    const result = await backfillWebsiteTrackingTokens(fakePrisma);

    expect(result).toEqual({ scanned: 2, updated: 2, skipped: 0 });
    expect(updates).toHaveLength(2);
    expect(updates[0].data.websiteTrackingToken).toMatch(/^[0-9a-f]{64}$/);
    expect(updates[1].data.websiteTrackingToken).toMatch(/^[0-9a-f]{64}$/);
    expect(updates[0].data.websiteTrackingToken).not.toBe(updates[1].data.websiteTrackingToken);
  });

  it("is idempotent — orgs with an existing token are not updated", async () => {
    const fakePrisma = {
      organizationConfig: {
        findMany: vi.fn().mockResolvedValue([
          { id: "org-a", websiteTrackingToken: "existing-token" },
          { id: "org-b", websiteTrackingToken: null },
        ]),
        update: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Parameters<typeof backfillWebsiteTrackingTokens>[0];

    const result = await backfillWebsiteTrackingTokens(fakePrisma);

    expect(result).toEqual({ scanned: 2, updated: 1, skipped: 1 });
    expect(fakePrisma.organizationConfig.update).toHaveBeenCalledTimes(1);
  });
});
