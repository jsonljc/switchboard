import type { PrismaDbClient } from "../prisma-db.js";

// ---------------------------------------------------------------------------
// Prisma Employee Registration Store
// ---------------------------------------------------------------------------

export class PrismaEmployeeStore {
  constructor(private prisma: PrismaDbClient) {}

  async register(
    employeeId: string,
    orgId: string,
    config?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.employeeRegistration.upsert({
      where: {
        employeeId_organizationId: { employeeId, organizationId: orgId },
      },
      create: {
        employeeId,
        organizationId: orgId,
        status: "active",
        config: config ?? {},
        createdAt: now,
        updatedAt: now,
      },
      update: {
        config: config ?? undefined,
        updatedAt: now,
      },
    });
  }

  async getByOrg(orgId: string): Promise<
    Array<{
      id: string;
      employeeId: string;
      organizationId: string;
      status: string;
      config: unknown;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    return this.prisma.employeeRegistration.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
    });
  }

  async getById(
    employeeId: string,
    orgId: string,
  ): Promise<{
    id: string;
    employeeId: string;
    organizationId: string;
    status: string;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    return this.prisma.employeeRegistration.findFirst({
      where: { employeeId, organizationId: orgId },
    });
  }

  async updateStatus(employeeId: string, orgId: string, status: string): Promise<void> {
    const existing = await this.prisma.employeeRegistration.findFirst({
      where: { employeeId, organizationId: orgId },
    });
    if (!existing) {
      throw new Error(`Employee registration not found: ${employeeId} in org ${orgId}`);
    }
    await this.prisma.employeeRegistration.update({
      where: { id: existing.id },
      data: { status, updatedAt: new Date() },
    });
  }

  async updateConfig(
    employeeId: string,
    orgId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.prisma.employeeRegistration.findFirst({
      where: { employeeId, organizationId: orgId },
    });
    if (!existing) {
      throw new Error(`Employee registration not found: ${employeeId} in org ${orgId}`);
    }
    await this.prisma.employeeRegistration.update({
      where: { id: existing.id },
      data: { config, updatedAt: new Date() },
    });
  }
}
