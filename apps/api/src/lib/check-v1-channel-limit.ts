import { decryptCredentials, type PrismaDbClient } from "@switchboard/db";

/**
 * v1 channel-limit precheck for the provision route.
 *
 * Spec Decision 9: one managed channel per (organizationId, channel). The
 * schema enforces `@@unique([organizationId, channel])`, so without this
 * helper a same-channel retry would surface as a Prisma 500. The helper
 * returns a discriminated result the route uses to decide whether to:
 *
 *   - fall through to the create path  (kind: "no_existing")
 *   - return the existing row idempotently  (kind: "existing_idempotent")
 *   - reject with a structured v1-limit message  (kind: "v1_limit_reject")
 *
 * For WhatsApp specifically, when an incoming `phoneNumberId` is provided,
 * the helper decrypts the existing Connection's credentials and compares
 * `phoneNumberId` only — never logs the decrypted payload, never echoes a
 * credential value in any returned `statusDetail`. Undecryptable existing
 * credentials are treated as v1-limit-reject (safer than silently
 * overwriting). For non-WhatsApp channels (or WhatsApp without an incoming
 * phoneNumberId), any second attempt collapses to idempotent retry.
 *
 * Tests cover the three branches in
 * `apps/api/src/__tests__/provision-end-to-end.test.ts`.
 */
export interface ChannelProvisionResponse {
  id: string | null;
  channel: string;
  botUsername: string | null;
  webhookPath: string | null;
  webhookRegistered: boolean;
  status: "active" | "error";
  statusDetail: string | null;
  lastHealthCheck: string | null;
  createdAt: string;
}

export type CheckV1ChannelLimitResult =
  | { kind: "no_existing" }
  | { kind: "existing_idempotent"; result: ChannelProvisionResponse }
  | { kind: "v1_limit_reject"; result: ChannelProvisionResponse };

const V1_WHATSAPP_LIMIT_DETAIL =
  "v1 limit: this organization already has a WhatsApp channel connected. Multi-number support is not available in v1.";

export async function checkV1ChannelLimit(args: {
  prisma: PrismaDbClient;
  organizationId: string;
  channel: string;
  incomingPhoneNumberId: string | null;
}): Promise<CheckV1ChannelLimitResult> {
  const { prisma, organizationId, channel, incomingPhoneNumberId } = args;

  const existing = await prisma.managedChannel.findFirst({
    where: { organizationId, channel },
  });
  if (!existing) {
    return { kind: "no_existing" };
  }

  // ManagedChannel.connectionId is a String FK without a Prisma @relation,
  // so look up the Connection separately to read its encrypted credentials.
  const existingConnection = await prisma.connection.findUnique({
    where: { id: existing.connectionId },
  });

  if (channel === "whatsapp" && incomingPhoneNumberId) {
    let existingPhoneNumberId: string | null = null;
    try {
      if (!existingConnection) throw new Error("connection missing");
      if (typeof existingConnection.credentials !== "string") {
        throw new Error("credentials not a string");
      }
      const existingDecrypted = decryptCredentials(existingConnection.credentials) as {
        phoneNumberId?: unknown;
      };
      if (
        typeof existingDecrypted.phoneNumberId === "string" &&
        existingDecrypted.phoneNumberId.length > 0
      ) {
        existingPhoneNumberId = existingDecrypted.phoneNumberId;
      }
    } catch {
      // Fall through to v1-limit reject (safer than overwriting). Never log
      // the credential payload — only the failure mode matters here.
      existingPhoneNumberId = null;
    }

    if (existingPhoneNumberId !== null && existingPhoneNumberId === incomingPhoneNumberId) {
      return {
        kind: "existing_idempotent",
        result: buildExistingResponse(existing, "active", "existing channel returned"),
      };
    }
    return {
      kind: "v1_limit_reject",
      result: {
        id: existing.id,
        channel: existing.channel,
        botUsername: existing.botUsername,
        webhookPath: existing.webhookPath,
        webhookRegistered: false,
        status: "error",
        statusDetail: V1_WHATSAPP_LIMIT_DETAIL,
        lastHealthCheck: null,
        createdAt: existing.createdAt.toISOString(),
      },
    };
  }

  // Non-WhatsApp, or WhatsApp without an incoming phoneNumberId: idempotent.
  return {
    kind: "existing_idempotent",
    result: buildExistingResponse(existing, "active", "existing channel returned"),
  };
}

function buildExistingResponse(
  existing: {
    id: string;
    channel: string;
    botUsername: string | null;
    webhookPath: string;
    webhookRegistered: boolean;
    lastHealthCheck: Date | null;
    createdAt: Date;
  },
  status: "active",
  statusDetail: string,
): ChannelProvisionResponse {
  return {
    id: existing.id,
    channel: existing.channel,
    botUsername: existing.botUsername,
    webhookPath: existing.webhookPath,
    webhookRegistered: existing.webhookRegistered,
    status,
    statusDetail,
    lastHealthCheck: existing.lastHealthCheck?.toISOString() ?? null,
    createdAt: existing.createdAt.toISOString(),
  };
}
