import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isUsableConnectionStatus } from "@switchboard/schemas";
import { encryptCredentials, decryptCredentials } from "../crypto/credentials.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// A Stripe secret key (sk_) or restricted key (rk_). Restricted keys are preferred for
// least privilege: they can be scoped to the connected account this Connection acts on.
function isStripeSecretKey(value: unknown): value is string {
  return isNonEmptyString(value) && (value.startsWith("sk_") || value.startsWith("rk_"));
}

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

  /**
   * Org-scoped finder for Riley's credential resolver fallback (Tier-0 PR 0.1).
   * Returns the RAW encrypted credentials blob (no decrypt) so the resolver can
   * run it through the same decrypt as the deployment-scoped path, yielding one
   * credential shape (integration-review seam #2). Skips a dead-token row
   * (expired/revoked/needs_reauth, via the shared isUsableConnectionStatus
   * predicate) so a dead token is never handed back (it would otherwise poison
   * the weekly fleet audit). Returns null when the row is absent, dead, or
   * stores non-string (legacy unencrypted) credentials.
   */
  async findByServiceId(
    serviceId: string,
    organizationId: string,
  ): Promise<{ credentials: string } | null> {
    const row = await this.prisma.connection.findFirst({
      where: { serviceId, organizationId },
      select: { credentials: true, status: true },
    });
    if (!row) return null;
    if (!isUsableConnectionStatus(row.status)) return null;
    if (typeof row.credentials !== "string") return null;
    return { credentials: row.credentials };
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

  /**
   * Provision (create-or-update) the org's `stripe` Connection for the no-PMS deposit loop.
   * Persists encrypted {connectedAccountId, secretKey} and sets externalAccountId :=
   * connectedAccountId. That single source of truth satisfies BOTH the #999 payment-port
   * factory guard (creds.connectedAccountId === externalAccountId) and the settlement
   * webhook's org resolution (Connection by serviceId "stripe" + externalAccountId ===
   * event.account). Deriving externalAccountId here makes drift structurally impossible for
   * rows this writer creates; the factory guard stays as defense-in-depth against other
   * sources of inconsistency.
   *
   * Credential model: secretKey is the PER-ORG Stripe secret (sk_) or restricted (rk_) key
   * that authorizes action on the connected account — the deliberate model the merged factory
   * builds the live client from (payment-port-factory.ts), NOT a platform/global key. The
   * platform STRIPE_SECRET_KEY is a separate concern (billing + webhook verification).
   *
   * Fail-closed: throws on incomplete/implausible input so a partial provision is never
   * persisted. Write-only: returns {id, created}, never the secret (connection GETs redact
   * the whole credentials blob). Re-provision merges into existing creds, preserving any
   * other keys (e.g. a webhookSecret a future writer may add). The pre-read + upsert is NOT
   * atomic (mirrors mergeCredentialsById); acceptable for a rare, single-operator path. If a
   * concurrent stripe-credential writer is ever added, wrap this in a row-locked transaction.
   */
  async provisionStripeConnection(args: {
    organizationId: string;
    connectedAccountId: string;
    secretKey: string;
  }): Promise<{ id: string; created: boolean }> {
    const { organizationId, connectedAccountId, secretKey } = args;
    if (!isNonEmptyString(organizationId)) {
      throw new Error("provisionStripeConnection: organizationId is required");
    }
    if (!isNonEmptyString(connectedAccountId) || !connectedAccountId.startsWith("acct_")) {
      throw new Error(
        "provisionStripeConnection: connectedAccountId must be a non-empty Stripe account id (acct_...)",
      );
    }
    if (!isStripeSecretKey(secretKey)) {
      throw new Error(
        "provisionStripeConnection: secretKey must be a Stripe secret (sk_...) or restricted (rk_...) key",
      );
    }

    // Org-scoped pre-read for the credential merge; decrypt only our org's row. Mirror
    // mergeCredentialsById's read: decrypt an encrypted string, or carry a legacy unencrypted
    // object through (do NOT discard its keys — that would silently drop a preserved field).
    const existing = await this.prisma.connection.findFirst({
      where: { serviceId: "stripe", organizationId },
      select: { id: true, credentials: true },
    });
    const existingCreds = existing
      ? typeof existing.credentials === "string"
        ? decryptCredentials(existing.credentials)
        : (existing.credentials as Record<string, unknown>)
      : {};
    const encrypted = encryptCredentials({ ...existingCreds, connectedAccountId, secretKey });

    // Fields written on BOTH branches, defined once so create and update cannot drift.
    const writeFields = {
      serviceName: "stripe",
      authType: "api_key",
      credentials: encrypted,
      status: "connected",
      externalAccountId: connectedAccountId,
    };

    const row = await this.prisma.connection.upsert({
      where: { serviceId_organizationId: { serviceId: "stripe", organizationId } },
      create: {
        id: `conn_${randomUUID()}`,
        serviceId: "stripe",
        organizationId,
        scopes: [],
        ...writeFields,
      },
      update: writeFields,
      select: { id: true },
    });

    // `created` is advisory: derived from the pre-read, not race-authoritative.
    return { id: row.id, created: existing === null };
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
