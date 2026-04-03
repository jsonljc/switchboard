import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

interface CreateDraftInput {
  channel: string;
  format: string;
  content: string;
  status?: string;
  parentDraftId?: string;
}

interface CreateCalendarEntryInput {
  channel: string;
  topic: string;
  scheduledFor: Date;
  draftId?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface DraftRow {
  id: string;
  employeeId: string;
  organizationId: string;
  channel: string;
  format: string;
  content: string;
  status: string;
  feedback: string | null;
  revision: number;
  parentDraftId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CalendarEntryRow {
  id: string;
  employeeId: string;
  organizationId: string;
  channel: string;
  topic: string;
  scheduledFor: Date;
  draftId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Prisma Content Store — CRUD for ContentDraft + ContentCalendarEntry
// ---------------------------------------------------------------------------

export class PrismaContentStore {
  constructor(private prisma: PrismaDbClient) {}

  async createDraft(orgId: string, employeeId: string, draft: CreateDraftInput): Promise<DraftRow> {
    const now = new Date();
    return this.prisma.contentDraft.create({
      data: {
        id: randomUUID(),
        employeeId,
        organizationId: orgId,
        channel: draft.channel,
        format: draft.format,
        content: draft.content,
        status: draft.status ?? "draft",
        parentDraftId: draft.parentDraftId ?? null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async getDraft(id: string): Promise<DraftRow | null> {
    return this.prisma.contentDraft.findFirst({
      where: { id },
    });
  }

  async listDrafts(orgId: string, employeeId: string, status?: string): Promise<DraftRow[]> {
    const where: Record<string, unknown> = {
      organizationId: orgId,
      employeeId,
    };
    if (status) {
      where.status = status;
    }

    return this.prisma.contentDraft.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
  }

  async updateDraftStatus(id: string, status: string, feedback?: string): Promise<DraftRow> {
    const existing = await this.prisma.contentDraft.findFirst({
      where: { id },
    });
    if (!existing) {
      throw new Error(`Content draft not found: ${id}`);
    }

    return this.prisma.contentDraft.update({
      where: { id },
      data: {
        status,
        feedback: feedback ?? existing.feedback,
        updatedAt: new Date(),
      },
    });
  }

  async createCalendarEntry(
    orgId: string,
    employeeId: string,
    entry: CreateCalendarEntryInput,
  ): Promise<CalendarEntryRow> {
    const now = new Date();
    return this.prisma.contentCalendarEntry.create({
      data: {
        id: randomUUID(),
        employeeId,
        organizationId: orgId,
        channel: entry.channel,
        topic: entry.topic,
        scheduledFor: entry.scheduledFor,
        draftId: entry.draftId ?? null,
        status: entry.status ?? "planned",
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async listCalendar(
    orgId: string,
    scheduledAfter?: Date,
    scheduledBefore?: Date,
  ): Promise<CalendarEntryRow[]> {
    const where: Record<string, unknown> = {
      organizationId: orgId,
    };

    if (scheduledAfter || scheduledBefore) {
      const scheduledFor: Record<string, Date> = {};
      if (scheduledAfter) scheduledFor.gte = scheduledAfter;
      if (scheduledBefore) scheduledFor.lte = scheduledBefore;
      where.scheduledFor = scheduledFor;
    }

    return this.prisma.contentCalendarEntry.findMany({
      where,
      orderBy: { scheduledFor: "asc" },
    });
  }
}
