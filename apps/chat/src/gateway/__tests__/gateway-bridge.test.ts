import { describe, it, expect, vi } from "vitest";
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
