import { describe, it, expect } from "vitest";
import { InMemoryConnectorConfigProvider } from "../providers/connector-config-provider.js";

describe("InMemoryConnectorConfigProvider", () => {
  it("registers and retrieves connector configs for an org", () => {
    const provider = new InMemoryConnectorConfigProvider();
    provider.register("org-1", {
      id: "hubspot-1",
      connectorType: "hubspot",
      subscribedEvents: ["lead.received", "lead.qualified"],
      criticality: "required",
      enabled: true,
      config: { accessToken: "tok-123" },
    });

    const configs = provider.listForOrg("org-1");
    expect(configs).toHaveLength(1);
    expect(configs[0]!.connectorType).toBe("hubspot");
  });

  it("converts to router-compatible format", () => {
    const provider = new InMemoryConnectorConfigProvider();
    provider.register("org-1", {
      id: "hubspot-1",
      connectorType: "hubspot",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
      config: { accessToken: "tok-123" },
    });

    const routerConfigs = provider.toRouterConfigs("org-1");
    expect(routerConfigs).toHaveLength(1);
    expect(routerConfigs[0]!.connectorType).toBe("hubspot");
  });

  it("provides lookup function for dispatch handler", () => {
    const provider = new InMemoryConnectorConfigProvider();
    provider.register("org-1", {
      id: "hubspot-1",
      connectorType: "hubspot",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
      config: { accessToken: "tok-123" },
    });

    const lookup = provider.toLookup("org-1");
    expect(lookup("hubspot-1")).toBeDefined();
    expect(lookup("hubspot-1")!.connectorType).toBe("hubspot");
    expect(lookup("nonexistent")).toBeUndefined();
  });

  it("removes a connector", () => {
    const provider = new InMemoryConnectorConfigProvider();
    provider.register("org-1", {
      id: "hubspot-1",
      connectorType: "hubspot",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
      config: {},
    });

    provider.remove("org-1", "hubspot-1");
    expect(provider.listForOrg("org-1")).toHaveLength(0);
  });
});
