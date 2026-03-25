import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import type { Contact, ContactStage, AttributionChain } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Store Interface (structural match with @switchboard/core)
// ---------------------------------------------------------------------------

interface CreateContactInput {
  organizationId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  primaryChannel: "whatsapp" | "telegram" | "dashboard";
  firstTouchChannel?: string | null;
  source?: string | null;
  attribution?: Record<string, unknown> | null;
  roles?: string[];
}

interface ContactFilters {
  stage?: ContactStage;
  source?: string;
  limit?: number;
  offset?: number;
}

interface ContactStore {
  create(input: CreateContactInput): Promise<Contact>;
  findById(orgId: string, id: string): Promise<Contact | null>;
  findByPhone(orgId: string, phone: string): Promise<Contact | null>;
  updateStage(orgId: string, id: string, stage: ContactStage): Promise<Contact>;
  updateLastActivity(orgId: string, id: string): Promise<void>;
  list(orgId: string, filters?: ContactFilters): Promise<Contact[]>;
}

// ---------------------------------------------------------------------------
// Prisma Store Implementation
// ---------------------------------------------------------------------------

export class PrismaContactStore implements ContactStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateContactInput): Promise<Contact> {
    const id = randomUUID();
    const now = new Date();

    const created = await this.prisma.contact.create({
      data: {
        id,
        organizationId: input.organizationId,
        name: input.name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        primaryChannel: input.primaryChannel,
        firstTouchChannel: input.firstTouchChannel ?? null,
        source: input.source ?? null,
        attribution: input.attribution ? (input.attribution as object) : undefined,
        roles: input.roles ?? ["lead"],
        stage: "new",
        firstContactAt: now,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });

    return mapRowToContact(created);
  }

  async findById(orgId: string, id: string): Promise<Contact | null> {
    const row = await this.prisma.contact.findFirst({
      where: {
        id,
        organizationId: orgId,
      },
    });

    if (!row) return null;
    return mapRowToContact(row);
  }

  async findByPhone(orgId: string, phone: string): Promise<Contact | null> {
    const row = await this.prisma.contact.findFirst({
      where: {
        organizationId: orgId,
        phone,
      },
    });

    if (!row) return null;
    return mapRowToContact(row);
  }

  async updateStage(_orgId: string, id: string, stage: ContactStage): Promise<Contact> {
    const updated = await this.prisma.contact.update({
      where: { id },
      data: {
        stage,
        updatedAt: new Date(),
      },
    });

    return mapRowToContact(updated);
  }

  async updateLastActivity(_orgId: string, id: string): Promise<void> {
    await this.prisma.contact.update({
      where: { id },
      data: {
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async list(orgId: string, filters?: ContactFilters): Promise<Contact[]> {
    const where: Record<string, unknown> = {
      organizationId: orgId,
    };

    if (filters?.stage) {
      where.stage = filters.stage;
    }
    if (filters?.source) {
      where.source = filters.source;
    }

    const rows = await this.prisma.contact.findMany({
      where,
      take: filters?.limit,
      skip: filters?.offset,
      orderBy: { lastActivityAt: "desc" },
    });

    return rows.map(mapRowToContact);
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRowToContact(row: {
  id: string;
  organizationId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  primaryChannel: string;
  firstTouchChannel: string | null;
  stage: string;
  source: string | null;
  attribution: unknown;
  roles: string[];
  firstContactAt: Date;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): Contact {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    primaryChannel: row.primaryChannel as "whatsapp" | "telegram" | "dashboard",
    firstTouchChannel: row.firstTouchChannel,
    stage: row.stage as ContactStage,
    source: row.source,
    attribution: row.attribution as AttributionChain | null | undefined,
    roles: row.roles,
    firstContactAt: row.firstContactAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
