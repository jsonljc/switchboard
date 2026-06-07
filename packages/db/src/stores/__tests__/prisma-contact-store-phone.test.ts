import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaDbClient } from "../../prisma-db.js";
import { PrismaContactStore } from "../prisma-contact-store.js";

const now = new Date("2026-03-25T12:00:00Z");

function makeMockPrisma() {
  return {
    contact: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    organizationId: "org-1",
    name: "John Doe",
    phone: "+6591234567",
    phoneE164: "+6591234567",
    email: "john@example.com",
    primaryChannel: "whatsapp",
    firstTouchChannel: "facebook",
    stage: "new",
    source: "facebook_ad",
    attribution: { fbclid: "abc123", sourceCampaignId: "camp-1" },
    roles: ["lead"],
    messagingOptIn: false,
    messagingOptInAt: null,
    messagingOptInSource: null,
    messagingOptOutAt: null,
    firstContactAt: now,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("PrismaContactStore — phoneE164 derivation", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: PrismaContactStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaContactStore(prisma as unknown as PrismaDbClient);
  });

  it("create derives and persists phoneE164 from the input phone", async () => {
    prisma.contact.create.mockResolvedValue(makeContact({ phone: "+6591234567" }));
    await store.create({
      organizationId: "org-1",
      phone: "+6591234567",
      primaryChannel: "whatsapp",
    });
    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ phoneE164: "+6591234567" }),
    });
  });

  it("create derives +65 for a bare SG 8-digit phone", async () => {
    prisma.contact.create.mockResolvedValue(makeContact({ phone: "91234567" }));
    await store.create({
      organizationId: "org-1",
      phone: "91234567",
      primaryChannel: "whatsapp",
    });
    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ phoneE164: "+6591234567" }),
    });
  });

  it("create writes phoneE164: null when the phone cannot be normalized", async () => {
    prisma.contact.create.mockResolvedValue(makeContact({ phone: "not-a-phone" }));
    await store.create({
      organizationId: "org-1",
      phone: "not-a-phone",
      primaryChannel: "whatsapp",
    });
    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ phoneE164: null }),
    });
  });

  it("findByPhone normalizes the input and queries the phoneE164 column", async () => {
    await store.findByPhone("org-1", "+65 9123 4567");
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", phoneE164: "+6591234567" },
    });
  });

  it("findByPhone falls back to a raw phone match when the input cannot be normalized", async () => {
    await store.findByPhone("org-1", "telegram-handle");
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", phone: "telegram-handle" },
    });
  });

  it("mapRowToContact surfaces phoneE164", async () => {
    prisma.contact.findFirst.mockResolvedValue(makeContact({ phoneE164: "+6591234567" }));
    const result = await store.findById("org-1", "contact-1");
    expect(result!.phoneE164).toBe("+6591234567");
  });
});
