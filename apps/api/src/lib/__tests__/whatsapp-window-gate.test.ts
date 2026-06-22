import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@switchboard/db";
import { isRecipientWithinOrgWindow } from "../whatsapp-window-gate.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Minimal prisma stub: only `conversationThread.findFirst` is exercised. `impl`
 * receives the exact args object the gate builds, so a test can both assert the
 * org-scoped `where` and return a per-org timestamp.
 */
function makePrisma(
  impl: (args: {
    where: { organizationId: string; lifecycleContact: unknown };
    orderBy: unknown;
    select: unknown;
  }) => { lastWhatsAppInboundAt: Date | null } | null,
): { prisma: PrismaClient; findFirst: ReturnType<typeof vi.fn> } {
  const findFirst = vi.fn(async (args: never) => impl(args));
  const prisma = { conversationThread: { findFirst } } as unknown as PrismaClient;
  return { prisma, findFirst };
}

describe("isRecipientWithinOrgWindow", () => {
  it("uses the REPLYING org's inbound timestamp, not the freshest cross-org row", async () => {
    // One customer phone, two tenants: org B messaged recently, org A 48h ago.
    const phone = "+6591234567";
    const byOrg: Record<string, Date> = {
      orgB: new Date(Date.now() - 60 * 1000), // 1 min ago → inside window
      orgA: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48h ago → outside window
    };
    const { prisma, findFirst } = makePrisma((args) => ({
      lastWhatsAppInboundAt: byOrg[args.where.organizationId] ?? null,
    }));

    // Org B replies → gated on B's own recent inbound → within window.
    await expect(isRecipientWithinOrgWindow(prisma, phone, "orgB")).resolves.toBe(true);
    // Org A replies to the same phone → gated on A's stale inbound → outside.
    await expect(isRecipientWithinOrgWindow(prisma, phone, "orgA")).resolves.toBe(false);

    // Each query is scoped to the replying org (never an unscoped cross-org read).
    expect(findFirst.mock.calls[0]![0].where.organizationId).toBe("orgB");
    expect(findFirst.mock.calls[1]![0].where.organizationId).toBe("orgA");
  });

  it("reads ConversationThread.lastWhatsAppInboundAt, matching the phone on phoneE164 or phone", async () => {
    const { prisma, findFirst } = makePrisma(() => ({ lastWhatsAppInboundAt: new Date() }));

    await isRecipientWithinOrgWindow(prisma, "+6591234567", "orgB");

    const args = findFirst.mock.calls[0]![0];
    expect(args.where).toMatchObject({
      organizationId: "orgB",
      lifecycleContact: { OR: [{ phoneE164: "+6591234567" }, { phone: "+6591234567" }] },
    });
    expect(args.orderBy).toEqual({ lastWhatsAppInboundAt: "desc" });
    expect(args.select).toEqual({ lastWhatsAppInboundAt: true });
  });

  it("returns false at the 24h boundary and within it", async () => {
    const justInside = makePrisma(() => ({
      lastWhatsAppInboundAt: new Date(Date.now() - (WINDOW_MS - 60_000)),
    }));
    const justOutside = makePrisma(() => ({
      lastWhatsAppInboundAt: new Date(Date.now() - (WINDOW_MS + 60_000)),
    }));
    await expect(isRecipientWithinOrgWindow(justInside.prisma, "+65900", "orgB")).resolves.toBe(
      true,
    );
    await expect(isRecipientWithinOrgWindow(justOutside.prisma, "+65900", "orgB")).resolves.toBe(
      false,
    );
  });

  it("fails closed (no query) when organizationId is missing", async () => {
    const { prisma, findFirst } = makePrisma(() => ({ lastWhatsAppInboundAt: new Date() }));
    await expect(isRecipientWithinOrgWindow(prisma, "+6591234567", undefined)).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("fails closed when prisma is unavailable", async () => {
    await expect(isRecipientWithinOrgWindow(null, "+6591234567", "orgB")).resolves.toBe(false);
  });

  it("fails closed when no matching thread exists for the org", async () => {
    const { prisma } = makePrisma(() => null);
    await expect(isRecipientWithinOrgWindow(prisma, "+6591234567", "orgB")).resolves.toBe(false);
  });

  it("fails closed when the matching thread has a null inbound timestamp (CTWA-only lead)", async () => {
    const { prisma } = makePrisma(() => ({ lastWhatsAppInboundAt: null }));
    await expect(isRecipientWithinOrgWindow(prisma, "+6591234567", "orgB")).resolves.toBe(false);
  });
});
