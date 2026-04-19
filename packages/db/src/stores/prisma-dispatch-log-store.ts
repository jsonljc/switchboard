import type { PrismaDbClient } from "../prisma-db.js";

interface DispatchLogInput {
  eventId: string;
  platform: string;
  status: string;
  errorMessage?: string | null;
  responsePayload?: unknown;
}

export class PrismaDispatchLogStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(input: DispatchLogInput) {
    return this.prisma.dispatchLog.create({
      data: {
        eventId: input.eventId,
        platform: input.platform,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        responsePayload:
          (input.responsePayload as Record<string, string | number | boolean | null>) ?? null,
      },
    });
  }

  async countByPlatformAndStatus(platform: string, status: string, from: Date, to: Date) {
    return this.prisma.dispatchLog.count({
      where: { platform, status, attemptedAt: { gte: from, lte: to } },
    });
  }
}
