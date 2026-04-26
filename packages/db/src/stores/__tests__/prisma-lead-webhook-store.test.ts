import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaLeadWebhookStore } from "../prisma-lead-webhook-store.js";

function makePrisma() {
  return {
    leadWebhook: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh-1",
    organizationId: "org-1",
    label: "Tally Contact Form",
    tokenHash: "hash-abc",
    tokenPrefix: "whk_abcdef",
    sourceType: "tally",
    greetingTemplateName: "lead_welcome",
    status: "active",
    lastUsedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    revokedAt: null,
    ...overrides,
  };
}

describe("PrismaLeadWebhookStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaLeadWebhookStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaLeadWebhookStore(prisma as never);
  });

  describe("create", () => {
    it("creates a webhook with default greetingTemplateName", async () => {
      const row = makeRow();
      prisma.leadWebhook.create.mockResolvedValue(row);

      const result = await store.create({
        organizationId: "org-1",
        label: "Tally Contact Form",
        tokenHash: "hash-abc",
        tokenPrefix: "whk_abcdef",
        sourceType: "tally",
      });

      expect(prisma.leadWebhook.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org-1",
          label: "Tally Contact Form",
          tokenHash: "hash-abc",
          tokenPrefix: "whk_abcdef",
          sourceType: "tally",
          greetingTemplateName: "lead_welcome",
        },
      });
      expect(result.id).toBe("wh-1");
      expect(result.status).toBe("active");
      expect(result.greetingTemplateName).toBe("lead_welcome");
    });

    it("creates a webhook with custom greetingTemplateName", async () => {
      const row = makeRow({ greetingTemplateName: "lead_welcome_zh" });
      prisma.leadWebhook.create.mockResolvedValue(row);

      const result = await store.create({
        organizationId: "org-1",
        label: "Custom template",
        tokenHash: "hash-custom-template",
        tokenPrefix: "whk_ctemp1",
        sourceType: "tally",
        greetingTemplateName: "lead_welcome_zh",
      });

      expect(prisma.leadWebhook.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          greetingTemplateName: "lead_welcome_zh",
        }),
      });
      expect(result.greetingTemplateName).toBe("lead_welcome_zh");
    });
  });

  describe("findByTokenHash", () => {
    it("returns webhook when active and hash matches", async () => {
      const row = makeRow();
      prisma.leadWebhook.findUnique.mockResolvedValue(row);

      const result = await store.findByTokenHash("hash-abc");

      expect(prisma.leadWebhook.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: "hash-abc" },
      });
      expect(result?.id).toBe("wh-1");
    });

    it("returns null when webhook is revoked", async () => {
      const row = makeRow({ status: "revoked" });
      prisma.leadWebhook.findUnique.mockResolvedValue(row);

      const result = await store.findByTokenHash("hash-revoked");

      expect(result).toBeNull();
    });

    it("returns null when webhook not found", async () => {
      prisma.leadWebhook.findUnique.mockResolvedValue(null);

      const result = await store.findByTokenHash("hash-missing");

      expect(result).toBeNull();
    });
  });

  describe("listByOrg", () => {
    it("returns webhooks ordered by createdAt desc", async () => {
      const rows = [makeRow({ id: "wh-2" }), makeRow({ id: "wh-1" })];
      prisma.leadWebhook.findMany.mockResolvedValue(rows);

      const result = await store.listByOrg("org-1");

      expect(prisma.leadWebhook.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("wh-2");
    });

    it("returns empty array when org has no webhooks", async () => {
      prisma.leadWebhook.findMany.mockResolvedValue([]);

      const result = await store.listByOrg("org-empty");

      expect(result).toEqual([]);
    });
  });

  describe("revoke", () => {
    it("updates status to revoked and sets revokedAt", async () => {
      prisma.leadWebhook.update.mockResolvedValue(makeRow({ status: "revoked" }));

      await store.revoke("wh-1");

      expect(prisma.leadWebhook.update).toHaveBeenCalledWith({
        where: { id: "wh-1" },
        data: {
          status: "revoked",
          revokedAt: expect.any(Date),
        },
      });
    });
  });

  describe("touchLastUsed", () => {
    it("updates lastUsedAt timestamp", async () => {
      prisma.leadWebhook.update.mockResolvedValue(makeRow({ lastUsedAt: new Date() }));

      await store.touchLastUsed("wh-1");

      expect(prisma.leadWebhook.update).toHaveBeenCalledWith({
        where: { id: "wh-1" },
        data: {
          lastUsedAt: expect.any(Date),
        },
      });
    });
  });
});
