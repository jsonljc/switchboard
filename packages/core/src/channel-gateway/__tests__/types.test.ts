import { describe, it, expectTypeOf } from "vitest";
import type { ChannelGatewayConfig, GatewayContactStore } from "../types.js";

describe("GatewayContactStore", () => {
  it("requires findByPhone returning {id} or null", () => {
    expectTypeOf<GatewayContactStore["findByPhone"]>().toEqualTypeOf<
      (orgId: string, phone: string) => Promise<{ id: string } | null>
    >();
  });

  it("requires create returning {id}", () => {
    expectTypeOf<GatewayContactStore["create"]>().toMatchTypeOf<
      (input: {
        organizationId: string;
        phone: string;
        primaryChannel: "whatsapp";
        source: string;
      }) => Promise<{ id: string }>
    >();
  });

  it("ChannelGatewayConfig accepts an optional contactStore", () => {
    expectTypeOf<ChannelGatewayConfig["contactStore"]>().toEqualTypeOf<
      GatewayContactStore | undefined
    >();
  });
});
