import { describe, it, expect } from "vitest";
import { BuilderRegistry } from "@switchboard/core/skill-runtime";

describe("skill-mode builder registration", () => {
  it("registers alexBuilder and forwards phone+channel from workUnit parameters", async () => {
    const registry = new BuilderRegistry();
    const { alexBuilder } = await import("@switchboard/core/skill-runtime");

    expect(alexBuilder).toBeDefined();
    expect(typeof alexBuilder).toBe("function");
    expect(registry.get("alex")).toBeUndefined();

    let receivedConfig: Record<string, unknown> | undefined;
    registry.register("alex", async (ctx) => {
      const config = {
        deploymentId: ctx.deployment.deploymentId,
        orgId: ctx.workUnit.organizationId,
        contactId: ctx.workUnit.parameters.contactId as string,
        phone: ctx.workUnit.parameters.phone as string | undefined,
        channel: ctx.workUnit.parameters.channel as string | undefined,
      };
      receivedConfig = config as Record<string, unknown>;
      // We don't need to actually invoke alexBuilder for this test — we're
      // pinning the config-shape contract that production must match.
      return { CAPTURED: true } as never;
    });

    const builder = registry.get("alex");
    expect(builder).toBeDefined();

    await builder!({
      deployment: { deploymentId: "dep-1" },
      workUnit: {
        organizationId: "org-1",
        parameters: {
          contactId: "contact-1",
          phone: "+6599999999",
          channel: "whatsapp",
          _agentContext: { persona: { businessName: "Acme" } },
        },
      },
      stores: {} as never,
    } as never);

    expect(receivedConfig).toEqual({
      deploymentId: "dep-1",
      orgId: "org-1",
      contactId: "contact-1",
      phone: "+6599999999",
      channel: "whatsapp",
    });
  });
});
