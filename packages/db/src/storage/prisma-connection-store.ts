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
        // When no org is specified, only return global connections (null org)
        // to prevent cross-org credential leakage
        organizationId: organizationId ?? null,
      },
    });
    if (!row) return null;
    return toConnectionRecord(row);
  }

  /**
   * Get a connection explicitly marked as global (organizationId = null).
   * Prevents cross-org credential leakage by only returning connections
   * that have no org binding.
   */
  async getByServiceGlobal(serviceId: string): Promise<ConnectionRecord | null> {
    const row = await this.prisma.connection.findFirst({
      where: {
        serviceId,
        organizationId: null,
      },
    });
    if (!row) return null;
    return toConnectionRecord(row);
  }

  async list(organizationId: string): Promise<ConnectionRecord[]> {
    const rows = await this.prisma.connection.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toConnectionRecord);
  }

  async updateStatus(id: string, status: string, organizationId: string | null): Promise<void> {
    // organizationId is part of WHERE for tenant isolation (audit follow-up to TI-7/TI-8).
    // Connection.organizationId is nullable (null = global connection).
    const result = await this.prisma.connection.updateMany({
      where: { id, organizationId },
      data: { status, lastHealthCheck: new Date() },
    });
    if (result.count === 0) {
      throw new Error(`Connection not found or tenant mismatch: ${id}`);
    }
  }

  async delete(id: string, organizationId: string | null): Promise<void> {
    // #643: scope the delete WHERE by organizationId (mirrors updateStatus; the route pre-fetch validated tenancy). organizationId is nullable (null = global connection).
    const result = await this.prisma.connection.deleteMany({ where: { id, organizationId } });
    if (result.count === 0) {
      throw new Error(`Connection not found or tenant mismatch: ${id}`);
    }
  }

  /**
   * Org-scoped read-modify-write of the encrypted credentials blob. Merges `patch`
   * into the existing credentials (preserving other keys) and re-encrypts. Decrypts
   * only after confirming the row is the caller's org AND the expected service, so a
   * cross-org / wrong-service request never touches secret material. Returns:
   *  - "updated"       merged and written
   *  - "not_found"     no row for (id, organizationId), or deleted before the write
   *  - "wrong_service" the row exists but is a different serviceId
   */
  async mergeCredentialsById(
    id: string,
    organizationId: string | null,
    expectedServiceId: string,
    patch: Record<string, unknown>,
  ): Promise<"updated" | "not_found" | "wrong_service"> {
    const row = await this.prisma.connection.findFirst({
      where: { id, organizationId },
      select: { id: true, serviceId: true, credentials: true },
    });
    if (!row) return "not_found";
    if (row.serviceId !== expectedServiceId) return "wrong_service";

    const current =
      typeof row.credentials === "string"
        ? decryptCredentials(row.credentials)
        : (row.credentials as Record<string, unknown>);

    const result = await this.prisma.connection.updateMany({
      where: { id: row.id, organizationId },
      data: { credentials: encryptCredentials({ ...current, ...patch }) },
    });
    if (result.count === 0) return "not_found";
    return "updated";
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
    console.warn(
      `[connection-store] connection ${row.id} uses unencrypted legacy credentials — re-save to encrypt`,
    );
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
