import { describe, it, expect } from "vitest";
import { InMemoryWebhookConfigProvider } from "../providers/webhook-config-provider.js";

describe("InMemoryWebhookConfigProvider", () => {
  it("registers and retrieves webhook configs for an org", () => {
    const provider = new InMemoryWebhookConfigProvider();
    provider.register("org-1", {
      id: "hook-1",
      url: "https://example.com/webhook",
      secret: "s3cret",
      subscribedEvents: ["lead.received", "lead.qualified"],
      criticality: "best_effort",
      enabled: true,
    });

    const configs = provider.listForOrg("org-1");
    expect(configs).toHaveLength(1);
    expect(configs[0]!.id).toBe("hook-1");
  });

  it("converts to router-compatible format", () => {
    const provider = new InMemoryWebhookConfigProvider();
    provider.register("org-1", {
      id: "hook-1",
      url: "https://example.com/webhook",
      secret: "s3cret",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
    });

    const routerConfigs = provider.toRouterConfigs("org-1");
    expect(routerConfigs).toHaveLength(1);
    expect(routerConfigs[0]!.id).toBe("hook-1");
    expect(routerConfigs[0]!.subscribedEvents).toContain("lead.received");
    expect(routerConfigs[0]!.criticality).toBe("required");
  });

  it("returns handler-compatible configs map", () => {
    const provider = new InMemoryWebhookConfigProvider();
    provider.register("org-1", {
      id: "hook-1",
      url: "https://example.com/webhook",
      secret: "s3cret",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
    });

    const handlerConfigs = provider.toHandlerConfigs("org-1");
    expect(handlerConfigs.get("hook-1")).toBeDefined();
    expect(handlerConfigs.get("hook-1")!.secret).toBe("s3cret");
  });

  it("skips disabled webhooks in router configs", () => {
    const provider = new InMemoryWebhookConfigProvider();
    provider.register("org-1", {
      id: "hook-1",
      url: "https://example.com/webhook",
      secret: "s3cret",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: false,
    });

    const routerConfigs = provider.toRouterConfigs("org-1");
    expect(routerConfigs).toHaveLength(1);
    expect(routerConfigs[0]!.enabled).toBe(false);
  });

  it("removes a webhook", () => {
    const provider = new InMemoryWebhookConfigProvider();
    provider.register("org-1", {
      id: "hook-1",
      url: "https://example.com/webhook",
      secret: "s3cret",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
    });

    provider.remove("org-1", "hook-1");
    expect(provider.listForOrg("org-1")).toHaveLength(0);
  });
});
