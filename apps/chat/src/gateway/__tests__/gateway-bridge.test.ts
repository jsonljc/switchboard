import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpApprovalRespondTransport } from "@switchboard/core";
import { createGatewayBridge } from "../gateway-bridge.js";

describe("createGatewayBridge", () => {
  it("constructs a ChannelGateway with contactStore wired in", () => {
    const fakePrisma = {} as never;
    const fakeIngress = { submit: vi.fn() };

    const gateway = createGatewayBridge(fakePrisma, {
      platformIngress: fakeIngress,
    });

    expect(gateway).toBeDefined();
    // ChannelGateway stores its config on a private `config` field; in tests we
    // reach in to verify the wiring without exposing internals to production.
    const wired = (gateway as unknown as { config: { contactStore?: unknown } }).config;
    expect(wired.contactStore).toBeDefined();
  });
});

describe("createGatewayBridge: approval respond bridge wiring", () => {
  afterEach(() => vi.unstubAllEnvs());

  function build() {
    return createGatewayBridge({} as never, { platformIngress: { submit: vi.fn() } });
  }

  it("wires the transport when SWITCHBOARD_API_URL and INTERNAL_API_SECRET are set", () => {
    vi.stubEnv("SWITCHBOARD_API_URL", "http://api.internal");
    vi.stubEnv("INTERNAL_API_SECRET", "s3cret");
    const gateway = build();
    const config = (
      gateway as unknown as { config: { approvalResponseConfig?: { transport?: unknown } } }
    ).config;
    expect(config.approvalResponseConfig).toBeDefined();
    expect(config.approvalResponseConfig?.transport).toBeInstanceOf(HttpApprovalRespondTransport);
  });

  it("omits the config (fail-closed) when the secret is missing", () => {
    vi.stubEnv("SWITCHBOARD_API_URL", "http://api.internal");
    vi.stubEnv("INTERNAL_API_SECRET", "");
    expect(
      (build() as unknown as { config: { approvalResponseConfig?: unknown } }).config
        .approvalResponseConfig,
    ).toBeUndefined();
  });

  it("omits the config (fail-closed) when the base URL is missing", () => {
    vi.stubEnv("SWITCHBOARD_API_URL", "");
    vi.stubEnv("INTERNAL_API_SECRET", "s3cret");
    expect(
      (build() as unknown as { config: { approvalResponseConfig?: unknown } }).config
        .approvalResponseConfig,
    ).toBeUndefined();
  });
});
