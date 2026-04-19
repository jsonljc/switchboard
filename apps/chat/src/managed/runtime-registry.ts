import type { PrismaClient } from "@switchboard/db";
import type { ChannelAdapter } from "../adapters/adapter.js";
import type { ChannelGateway } from "@switchboard/core";
import { TelegramAdapter } from "../adapters/telegram.js";
import { SlackAdapter } from "../adapters/slack.js";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";
import { PrismaConnectionStore, decryptCredentials } from "@switchboard/db";

interface GatewayEntry {
  gateway: ChannelGateway;
  adapter: ChannelAdapter;
  deploymentConnectionId: string;
  channel: string;
  orgId?: string;
}

export interface ManagedChannelRecord {
  id: string;
  organizationId: string;
  channel: string;
  connectionId: string;
  botUsername: string | null;
  webhookPath: string;
  webhookRegistered: boolean;
  status: string;
  statusDetail: string | null;
}

export class RuntimeRegistry {
  private gatewayEntries = new Map<string, GatewayEntry>();

  async loadAll(prisma: PrismaClient, gateway: ChannelGateway): Promise<void> {
    const channels = await prisma.managedChannel.findMany({
      where: { status: "active" },
    });

    for (const ch of channels) {
      try {
        await this.provision(ch, prisma, gateway);
      } catch (err) {
        console.error(
          `[RuntimeRegistry] Failed to load managed channel ${ch.id} (${ch.channel}):`,
          err,
        );
        await prisma.managedChannel.update({
          where: { id: ch.id },
          data: { status: "error", statusDetail: String(err) },
        });
      }
    }

    console.warn(`[RuntimeRegistry] Loaded ${this.gatewayEntries.size} gateway entries`);
  }

  async provision(
    managedChannel: ManagedChannelRecord,
    prisma: PrismaClient,
    gateway: ChannelGateway,
  ): Promise<void> {
    this.gatewayEntries.delete(managedChannel.webhookPath);

    const connectionStore = new PrismaConnectionStore(prisma);
    const connection = await connectionStore.getById(managedChannel.connectionId);
    if (!connection) {
      throw new Error(`Connection ${managedChannel.connectionId} not found`);
    }

    const adapter = this.createAdapterForConnection(
      managedChannel.channel,
      connection.credentials,
      managedChannel.organizationId,
    );
    if (!adapter) {
      throw new Error(`Unsupported channel: ${managedChannel.channel}`);
    }

    this.gatewayEntries.set(managedChannel.webhookPath, {
      gateway,
      adapter,
      deploymentConnectionId: managedChannel.connectionId,
      channel: managedChannel.channel,
      orgId: managedChannel.organizationId,
    });
  }

  async loadGatewayConnections(prisma: PrismaClient, gateway: ChannelGateway): Promise<void> {
    const connections = await prisma.deploymentConnection.findMany({
      where: { status: "active" },
    });
    for (const conn of connections) {
      try {
        const creds = decryptCredentials(conn.credentials);
        const adapter = this.createAdapterForConnection(conn.type, creds);
        if (!adapter) {
          console.warn(
            `[RuntimeRegistry] Unsupported gateway channel type: ${conn.type}, skipping ${conn.id}`,
          );
          continue;
        }
        const webhookPath = `/webhook/managed/${conn.id}`;
        this.gatewayEntries.set(webhookPath, {
          gateway,
          adapter,
          deploymentConnectionId: conn.id,
          channel: conn.type,
        });
      } catch (err) {
        console.error(`[RuntimeRegistry] Failed to load gateway connection ${conn.id}:`, err);
      }
    }
  }

  getGatewayByWebhookPath(path: string): GatewayEntry | null {
    return this.gatewayEntries.get(path) ?? null;
  }

  async provisionGatewayConnection(
    connection: { id: string; type?: string; credentials: string },
    _prisma: PrismaClient,
    gateway: ChannelGateway,
  ): Promise<void> {
    const creds = decryptCredentials(connection.credentials);
    const type = connection.type ?? "telegram";
    const adapter = this.createAdapterForConnection(type, creds);
    if (!adapter) throw new Error(`Unsupported or misconfigured channel: ${type}`);
    const webhookPath = `/webhook/managed/${connection.id}`;
    this.gatewayEntries.set(webhookPath, {
      gateway,
      adapter,
      deploymentConnectionId: connection.id,
      channel: type,
    });
  }

  remove(webhookPath: string): void {
    this.gatewayEntries.delete(webhookPath);
  }

  listAll(): Array<{ webhookPath: string; orgId?: string; channel: string }> {
    return Array.from(this.gatewayEntries.entries()).map(([webhookPath, entry]) => ({
      webhookPath,
      orgId: entry.orgId,
      channel: entry.channel,
    }));
  }

  get size(): number {
    return this.gatewayEntries.size;
  }

  private createAdapterForConnection(
    type: string,
    creds: Record<string, unknown>,
    orgId?: string,
  ): ChannelAdapter | null {
    if (type === "telegram") {
      const botToken = creds["botToken"] as string;
      if (!botToken) return null;
      const webhookSecret = creds["webhookSecret"] as string | undefined;
      return new TelegramAdapter(
        botToken,
        async () => ({ organizationId: orgId ?? "gateway" }),
        webhookSecret,
      );
    }
    if (type === "whatsapp") {
      const token = creds["token"] as string;
      const phoneNumberId = creds["phoneNumberId"] as string;
      if (!token || !phoneNumberId) return null;
      const appSecret = creds["appSecret"] as string | undefined;
      const verifyToken = creds["verifyToken"] as string | undefined;
      const wa = new WhatsAppAdapter({ token, phoneNumberId, appSecret, verifyToken });
      return Object.assign(wa, {
        resolveOrganizationId: async () => orgId ?? "gateway",
      }) as ChannelAdapter;
    }
    if (type === "slack") {
      const botToken = creds["botToken"] as string;
      if (!botToken) return null;
      const signingSecret = creds["signingSecret"] as string | undefined;
      const slack = new SlackAdapter(botToken, signingSecret);
      return Object.assign(slack, {
        resolveOrganizationId: async () => orgId ?? "gateway",
      }) as ChannelAdapter;
    }
    return null;
  }
}
