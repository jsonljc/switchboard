import type { PrismaClient } from "@prisma/client";
import { encryptCredentials, decryptCredentials } from "../crypto/credentials.js";

export interface ConnectionRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  organizationId: string | null;
  authType: string;
  credentials: Record<string, unknown>;
  scopes: string[];
  refreshStrategy: string;
  status: string;
  lastHealthCheck: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaConnectionStore {
  constructor(private prisma: PrismaClient) {}

  async save(connection: Omit<ConnectionRecord, "createdAt" | "updatedAt">): Promise<void> {
    const encryptedCreds = encryptCredentials(connection.credentials);

    await this.prisma.connection.upsert({
      where: {
        serviceId_organizationId: {
          serviceId: connection.serviceId,
          organizationId: connection.organizationId ?? "",
        },
      },
      create: {
        id: connection.id,
        serviceId: connection.serviceId,
        serviceName: connection.serviceName,
        organizationId: connection.organizationId,
        authType: connection.authType,
        credentials: encryptedCreds,
        scopes: connection.scopes,
        refreshStrategy: connection.refreshStrategy,
        status: connection.status,
        lastHealthCheck: connection.lastHealthCheck,
      },
      update: {
        serviceName: connection.serviceName,
        authType: connection.authType,
        credentials: encryptedCreds,
        scopes: connection.scopes,
        refreshStrategy: connection.refreshStrategy,
        status: connection.status,
        lastHealthCheck: connection.lastHealthCheck,
      },
    });
  }

  async getById(id: string): Promise<ConnectionRecord | null> {
    const row = await this.prisma.connection.findUnique({ where: { id } });
    if (!row) return null;
    return toConnectionRecord(row);
  }

  async getByService(serviceId: string, organizationId?: string): Promise<ConnectionRecord | null> {
    const row = await this.prisma.connection.findFirst({
      where: {
        serviceId,
        ...(organizationId ? { organizationId } : {}),
      },
    });
    if (!row) return null;
    return toConnectionRecord(row);
  }

  async list(organizationId?: string): Promise<ConnectionRecord[]> {
    const rows = await this.prisma.connection.findMany({
      where: organizationId ? { organizationId } : {},
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toConnectionRecord);
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.prisma.connection.update({
      where: { id },
      data: { status, lastHealthCheck: new Date() },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.connection.delete({ where: { id } });
  }
}

function toConnectionRecord(row: {
  id: string;
  serviceId: string;
  serviceName: string;
  organizationId: string | null;
  authType: string;
  credentials: unknown;
  scopes: string[];
  refreshStrategy: string;
  status: string;
  lastHealthCheck: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ConnectionRecord {
  // Credentials are stored as encrypted base64 string
  let credentials: Record<string, unknown>;
  if (typeof row.credentials === "string") {
    credentials = decryptCredentials(row.credentials);
  } else {
    // Legacy unencrypted JSON — decrypt will fail, treat as plain
    credentials = row.credentials as Record<string, unknown>;
  }

  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    organizationId: row.organizationId,
    authType: row.authType,
    credentials,
    scopes: row.scopes,
    refreshStrategy: row.refreshStrategy,
    status: row.status,
    lastHealthCheck: row.lastHealthCheck,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
