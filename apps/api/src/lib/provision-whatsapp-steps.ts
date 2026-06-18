/**
 * WhatsApp-specific provisioning steps extracted from the POST /provision route.
 *
 * Handles three sequential concerns for a newly-created WhatsApp
 * ManagedChannel + Connection:
 *  1. Meta env validation (WHATSAPP_GRAPH_TOKEN / WHATSAPP_APP_SECRET).
 *  2. Customer credential decryption.
 *  3. WABA lookup + webhook override registration via Graph API.
 *  4. Synchronous health probe (phone-number readiness check).
 *
 * Each concern collapses to a `StepResult`. The caller (organizations.ts)
 * maps the results to a `ResolveInput` and hands them off to
 * `resolveProvisionStatus`. The DB writes for `lastHealthCheck` happen here
 * because they are bounded to the WhatsApp path.
 *
 * IMPORTANT: this module must remain pure-move relative to the inline logic it
 * replaces — zero behavior change, only file boundary change.
 */

import type { PrismaClient } from "@switchboard/db";
import { decryptCredentials } from "@switchboard/db";
import { fetchWabaIdFromToken, registerWebhookOverride } from "./whatsapp-meta.js";
import { probeWhatsAppHealth } from "./whatsapp-health-probe.js";
import type { StepResult } from "./resolve-provision-status.js";

export interface ProvisionWhatsAppStepsInput {
  apiVersion: string;
  /**
   * CHAT_PUBLIC_URL / SWITCHBOARD_CHAT_URL from env. May be undefined if not
   * configured — the helper uses it only as the webhook URL base for Meta
   * registration.
   */
  chatUrl: string | undefined;
  /** Encrypted credential blob stored on the Connection row. */
  encrypted: string;
  connectionId: string;
  managedChannelId: string;
  webhookPath: string;
  prisma: PrismaClient;
}

export interface ProvisionWhatsAppStepsResult {
  metaConfig: StepResult;
  metaRegister: StepResult;
  healthProbe: StepResult;
  webhookRegistered: boolean;
  lastHealthCheckIso: string | null;
}

export async function provisionWhatsAppSteps(
  input: ProvisionWhatsAppStepsInput,
): Promise<ProvisionWhatsAppStepsResult> {
  const { apiVersion, chatUrl, encrypted, connectionId, managedChannelId, webhookPath, prisma } =
    input;

  let metaConfig: StepResult = { kind: "ok", reason: null };
  let metaRegister: StepResult = { kind: "ok", reason: null };
  let healthProbe: StepResult = { kind: "ok", reason: null };
  let webhookRegistered = false;
  let lastHealthCheckIso: string | null = null;

  let customerToken: string | undefined;
  let customerPhoneNumberId: string | undefined;

  const appToken = process.env.WHATSAPP_GRAPH_TOKEN;
  const verifyToken = process.env.WHATSAPP_APP_SECRET;

  if (!appToken || !verifyToken) {
    const missing: string[] = [];
    if (!appToken) missing.push("WHATSAPP_GRAPH_TOKEN");
    if (!verifyToken) missing.push("WHATSAPP_APP_SECRET");
    metaConfig = {
      kind: "fail",
      reason: `config_error_meta: missing ${missing.join(" / ")}`,
    };
  }

  // Always attempt to decrypt so the health probe can run even if
  // meta env is missing (probe only needs customer token).
  try {
    const decrypted = decryptCredentials(encrypted) as {
      token?: unknown;
      phoneNumberId?: unknown;
    };
    if (typeof decrypted.token === "string" && decrypted.token.length > 0) {
      customerToken = decrypted.token;
    }
    if (typeof decrypted.phoneNumberId === "string" && decrypted.phoneNumberId.length > 0) {
      customerPhoneNumberId = decrypted.phoneNumberId;
    }
  } catch (decryptErr) {
    metaConfig = {
      kind: "fail",
      reason: `Failed to decrypt customer credentials: ${
        decryptErr instanceof Error ? decryptErr.message : "unknown error"
      }`,
    };
  }

  // Run Meta registration only when we have meta env, chat url (for building
  // the webhook URL), and a customer token.
  if (metaConfig.kind === "ok" && appToken && verifyToken) {
    if (!chatUrl) {
      // chatConfig already failed above; skip meta call (no URL to register).
      metaRegister = {
        kind: "fail",
        reason: "Meta registration skipped: chat config missing webhook base URL",
      };
    } else if (!customerToken) {
      metaRegister = {
        kind: "fail",
        reason: "Meta registration skipped: customer credentials missing 'token' field",
      };
    } else {
      const wabaResult = await fetchWabaIdFromToken({
        apiVersion,
        appToken,
        userToken: customerToken,
      });
      if (!wabaResult.ok) {
        metaRegister = {
          kind: "fail",
          reason: `Meta WABA lookup (/debug_token) failed: ${wabaResult.reason}`,
        };
      } else {
        const reg = await registerWebhookOverride({
          apiVersion,
          userToken: customerToken,
          wabaId: wabaResult.wabaId,
          webhookUrl: `${chatUrl}${webhookPath}`,
          verifyToken,
        });
        if (reg.ok) {
          metaRegister = { kind: "ok", reason: null };
          webhookRegistered = true;
        } else {
          metaRegister = {
            kind: "fail",
            reason: `Meta /subscribed_apps failed: ${reg.reason}`,
          };
        }
      }
    }
  } else if (metaConfig.kind === "fail") {
    // Meta env missing — register can't run. Mark failed; resolver
    // will pick config_error (precedes pending_meta_register).
    metaRegister = {
      kind: "fail",
      reason: "Meta registration skipped: meta config missing",
    };
  }

  // ── Synchronous WhatsApp health probe (best-effort) ──
  if (customerToken && customerPhoneNumberId) {
    const probe = await probeWhatsAppHealth({
      apiVersion,
      userToken: customerToken,
      phoneNumberId: customerPhoneNumberId,
    });
    if (probe.ok) {
      lastHealthCheckIso = probe.checkedAt.toISOString();
      await prisma.connection.update({
        where: { id: connectionId },
        data: { lastHealthCheck: probe.checkedAt },
      });
      await prisma.managedChannel.update({
        where: { id: managedChannelId },
        data: { lastHealthCheck: probe.checkedAt },
      });
    } else {
      healthProbe = {
        kind: "fail",
        reason: `Health probe failed: ${probe.reason}`,
      };
    }
  }

  return { metaConfig, metaRegister, healthProbe, webhookRegistered, lastHealthCheckIso };
}
