/**
 * EV-14 / CHAN-3 — RuntimeRegistry routes each webhook to the CORRECT org.
 *
 * The managed-channel webhook path is the per-tenant entry point: an inbound
 * arriving on org A's webhook path must be attributed to org A, never org B.
 * `provision()` binds `orgId = managedChannel.organizationId` to the channel's
 * `webhookPath`; `getGatewayByWebhookPath()` returns that per-path entry, and the
 * adapter's `resolveOrganizationId()` resolves the same org. This drives the REAL
 * RuntimeRegistry with a two-org dataset. TEST-ONLY.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimeRegistry, type ManagedChannelRecord } from "../managed/runtime-registry.js";
import type { PrismaClient } from "@switchboard/db";
import type { ChannelGateway } from "@switchboard/core";

const ORG_A = "org_A";
const ORG_B = "org_B";
const PATH_A = "/webhook/managed/conn_a";
const PATH_B = "/webhook/managed/conn_b";

function managedChannel(
  orgId: string,
  connectionId: string,
  webhookPath: string,
): ManagedChannelRecord {
  return {
    id: `mc_${connectionId}`,
    organizationId: orgId,
    channel: "telegram",
    connectionId,
    botUsername: `bot_${connectionId}`,
    webhookPath,
    webhookRegistered: true,
    status: "active",
    statusDetail: null,
  };
}

/** Prisma fake: connection.findUnique returns plain-object credentials so
 *  toConnectionRecord takes the legacy-plain branch (no decryption key needed). */
function fakePrisma(): PrismaClient {
  const connections: Record<string, { id: string; credentials: Record<string, unknown> }> = {
    conn_a: { id: "conn_a", credentials: { botToken: "tok_a" } },
    conn_b: { id: "conn_b", credentials: { botToken: "tok_b" } },
  };
  return {
    connection: {
      findUnique: vi.fn(
        async (args: { where: { id: string } }) => connections[args.where.id] ?? null,
      ),
    },
    managedChannel: { update: vi.fn(async () => ({})) },
  } as unknown as PrismaClient;
}

describe("CHAN-3 RuntimeRegistry org isolation", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // toConnectionRecord warns on legacy unencrypted creds — expected in this fake.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("binds each webhook path to its own org (no cross-org delivery)", async () => {
    const registry = new RuntimeRegistry();
    const prisma = fakePrisma();
    const gateway = {} as unknown as ChannelGateway;

    await registry.provision(managedChannel(ORG_A, "conn_a", PATH_A), prisma, gateway);
    await registry.provision(managedChannel(ORG_B, "conn_b", PATH_B), prisma, gateway);

    const entryA = registry.getGatewayByWebhookPath(PATH_A);
    const entryB = registry.getGatewayByWebhookPath(PATH_B);

    expect(entryA?.orgId).toBe(ORG_A);
    expect(entryB?.orgId).toBe(ORG_B);
    // The cross-tenant property: A's path never resolves to B's org and vice versa.
    expect(entryA?.orgId).not.toBe(ORG_B);
    expect(entryB?.orgId).not.toBe(ORG_A);
  });

  it("the per-path adapter resolves its own org (inbound attribution is org-correct)", async () => {
    const registry = new RuntimeRegistry();
    const prisma = fakePrisma();
    const gateway = {} as unknown as ChannelGateway;

    await registry.provision(managedChannel(ORG_A, "conn_a", PATH_A), prisma, gateway);
    await registry.provision(managedChannel(ORG_B, "conn_b", PATH_B), prisma, gateway);

    const adapterA = registry.getGatewayByWebhookPath(PATH_A)!.adapter;
    const adapterB = registry.getGatewayByWebhookPath(PATH_B)!.adapter;

    // TelegramAdapter.resolveOrganizationId -> principalLookup().organizationId,
    // which the registry wires to the channel's own org.
    await expect(adapterA.resolveOrganizationId!("any-principal")).resolves.toBe(ORG_A);
    await expect(adapterB.resolveOrganizationId!("any-principal")).resolves.toBe(ORG_B);
  });

  it("listAll maps every path to the correct org", async () => {
    const registry = new RuntimeRegistry();
    const prisma = fakePrisma();
    const gateway = {} as unknown as ChannelGateway;

    await registry.provision(managedChannel(ORG_A, "conn_a", PATH_A), prisma, gateway);
    await registry.provision(managedChannel(ORG_B, "conn_b", PATH_B), prisma, gateway);

    const all = registry.listAll();
    expect(all).toContainEqual({ webhookPath: PATH_A, orgId: ORG_A, channel: "telegram" });
    expect(all).toContainEqual({ webhookPath: PATH_B, orgId: ORG_B, channel: "telegram" });
  });

  it("removing one org's path leaves the other org's path intact", async () => {
    const registry = new RuntimeRegistry();
    const prisma = fakePrisma();
    const gateway = {} as unknown as ChannelGateway;

    await registry.provision(managedChannel(ORG_A, "conn_a", PATH_A), prisma, gateway);
    await registry.provision(managedChannel(ORG_B, "conn_b", PATH_B), prisma, gateway);

    registry.remove(PATH_A);

    expect(registry.getGatewayByWebhookPath(PATH_A)).toBeNull();
    expect(registry.getGatewayByWebhookPath(PATH_B)?.orgId).toBe(ORG_B);
  });
});
