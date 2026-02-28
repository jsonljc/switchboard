import type { PrismaClient } from "@switchboard/db";
import type { ChatRuntime } from "../runtime.js";
import type { ChannelAdapter } from "../adapters/adapter.js";
import { createManagedRuntime } from "../bootstrap.js";
import { TelegramAdapter } from "../adapters/telegram.js";
import { SlackAdapter } from "../adapters/slack.js";
import { PrismaConnectionStore } from "@switchboard/db";

interface ManagedRuntimeEntry {
  runtime: ChatRuntime;
  orgId: string;
  channel: string;
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
  private runtimes = new Map<string, ManagedRuntimeEntry>();

  async loadAll(prisma: PrismaClient): Promise<void> {
    const channels = await prisma.managedChannel.findMany({
      where: { status: "active" },
    });

    for (const ch of channels) {
      try {
        await this.provision(ch, prisma);
      } catch (err) {
        console.error(`[RuntimeRegistry] Failed to load managed channel ${ch.id} (${ch.channel}):`, err);
        await prisma.managedChannel.update({
          where: { id: ch.id },
          data: { status: "error", statusDetail: String(err) },
        });
      }
    }

    console.log(`[RuntimeRegistry] Loaded ${this.runtimes.size} managed runtimes`);
  }

  async provision(managedChannel: ManagedChannelRecord, prisma: PrismaClient): Promise<void> {
    // Remove existing runtime for this path if re-provisioning
    this.runtimes.delete(managedChannel.webhookPath);

    const connectionStore = new PrismaConnectionStore(prisma);
    const connection = await connectionStore.getById(managedChannel.connectionId);
    if (!connection) {
      throw new Error(`Connection ${managedChannel.connectionId} not found`);
    }

    const botToken = connection.credentials["botToken"] as string;
    if (!botToken) {
      throw new Error("Connection missing botToken credential");
    }

    const orgId = managedChannel.organizationId;

    let adapter: ChannelAdapter;
    if (managedChannel.channel === "telegram") {
      const webhookSecret = connection.credentials["webhookSecret"] as string | undefined;
      adapter = new TelegramAdapter(
        botToken,
        async (_principalId: string) => ({ organizationId: orgId }),
        webhookSecret,
      );
    } else if (managedChannel.channel === "slack") {
      const signingSecret = connection.credentials["signingSecret"] as string | undefined;
      const slackAdapter = new SlackAdapter(botToken, signingSecret);
      // Wrap with a fixed org resolver for managed channels
      adapter = Object.assign(slackAdapter, {
        resolveOrganizationId: async () => orgId,
      });
    } else {
      throw new Error(`Unsupported channel: ${managedChannel.channel}`);
    }

    const apiUrl = process.env["SWITCHBOARD_API_URL"];
    if (!apiUrl) {
      throw new Error("SWITCHBOARD_API_URL is required for managed runtimes");
    }

    const runtime = await createManagedRuntime({
      adapter,
      apiUrl,
      apiKey: process.env["SWITCHBOARD_API_KEY"],
    });

    this.runtimes.set(managedChannel.webhookPath, {
      runtime,
      orgId,
      channel: managedChannel.channel,
    });
  }

  getByWebhookPath(path: string): ManagedRuntimeEntry | null {
    return this.runtimes.get(path) ?? null;
  }

  remove(webhookPath: string): void {
    this.runtimes.delete(webhookPath);
  }

  listAll(): Array<{ webhookPath: string; orgId: string; channel: string }> {
    return Array.from(this.runtimes.entries()).map(([webhookPath, entry]) => ({
      webhookPath,
      orgId: entry.orgId,
      channel: entry.channel,
    }));
  }

  get size(): number {
    return this.runtimes.size;
  }
}
