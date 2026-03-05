import { describe, it, expect } from "vitest";
import { ToolRegistry, matchGlob, matchesAny } from "../index.js";
import type { CartridgeManifest } from "@switchboard/schemas";

function makeMockManifest(
  id: string,
  actions: Array<{ actionType: string; description?: string }>,
): CartridgeManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: `Test cartridge ${id}`,
    actions: actions.map((a) => ({
      actionType: a.actionType,
      name: a.actionType,
      description: a.description ?? `Action ${a.actionType}`,
      parametersSchema: {},
      baseRiskCategory: "low" as const,
      reversible: false,
    })),
    requiredConnections: [],
    defaultPolicies: [],
  };
}

describe("matchGlob", () => {
  it("matches wildcard *", () => {
    expect(matchGlob("*", "anything")).toBe(true);
  });

  it("matches exact string", () => {
    expect(matchGlob("crm.contact.search", "crm.contact.search")).toBe(true);
  });

  it("matches prefix with wildcard", () => {
    expect(matchGlob("crm.*", "crm.contact.search")).toBe(true);
    expect(matchGlob("crm.*", "crm.deal.list")).toBe(true);
  });

  it("does not match different prefix", () => {
    expect(matchGlob("crm.*", "customer-engagement.appointment.book")).toBe(false);
  });

  it("matches nested wildcard", () => {
    expect(matchGlob("crm.contact.*", "crm.contact.search")).toBe(true);
    expect(matchGlob("crm.contact.*", "crm.deal.list")).toBe(false);
  });
});

describe("matchesAny", () => {
  it("returns true if any pattern matches", () => {
    expect(matchesAny("crm.contact.search", ["crm.*", "ads.*"])).toBe(true);
  });

  it("returns false if no pattern matches", () => {
    expect(matchesAny("crm.contact.search", ["ads.*", "payments.*"])).toBe(false);
  });
});

describe("ToolRegistry", () => {
  it("registers tools from a cartridge manifest", () => {
    const registry = new ToolRegistry();
    const manifest = makeMockManifest("crm", [
      { actionType: "crm.contact.search" },
      { actionType: "crm.deal.list" },
    ]);
    registry.registerCartridge("crm", manifest);

    expect(registry.size).toBe(2);
    expect(registry.has("crm.contact.search")).toBe(true);
    expect(registry.has("crm.deal.list")).toBe(true);
  });

  it("returns all tools", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge(
      "crm",
      makeMockManifest("crm", [{ actionType: "crm.contact.search" }]),
    );
    registry.registerCartridge(
      "ads",
      makeMockManifest("ads", [{ actionType: "ads.campaign.pause" }]),
    );

    const all = registry.getAllTools();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.actionType).sort()).toEqual([
      "ads.campaign.pause",
      "crm.contact.search",
    ]);
  });

  it("unregisters a cartridge", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge(
      "crm",
      makeMockManifest("crm", [{ actionType: "crm.contact.search" }]),
    );
    expect(registry.size).toBe(1);

    registry.unregisterCartridge("crm");
    expect(registry.size).toBe(0);
    expect(registry.has("crm.contact.search")).toBe(false);
  });

  it("filters tools by include patterns", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge(
      "crm",
      makeMockManifest("crm", [
        { actionType: "crm.contact.search" },
        { actionType: "crm.deal.list" },
      ]),
    );
    registry.registerCartridge(
      "ads",
      makeMockManifest("ads", [{ actionType: "ads.campaign.pause" }]),
    );

    const filtered = registry.getFilteredTools({ include: ["crm.*"] });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((t) => t.actionType.startsWith("crm."))).toBe(true);
  });

  it("excludes tools matching exclude patterns", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge(
      "pe",
      makeMockManifest("pe", [
        { actionType: "customer-engagement.appointment.book" },
        { actionType: "customer-engagement.internal.debug" },
      ]),
    );

    const filtered = registry.getFilteredTools({
      include: ["customer-engagement.*"],
      exclude: ["customer-engagement.internal.*"],
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.actionType).toBe("customer-engagement.appointment.book");
  });

  it("applies aliases to filtered tools", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge(
      "pe",
      makeMockManifest("pe", [{ actionType: "customer-engagement.appointment.book" }]),
    );

    const filtered = registry.getFilteredTools({
      include: ["customer-engagement.*"],
      aliases: { book_appointment: "customer-engagement.appointment.book" },
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.alias).toBe("book_appointment");
  });

  it("resolves alias to canonical action type", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge(
      "pe",
      makeMockManifest("pe", [{ actionType: "customer-engagement.appointment.book" }]),
    );

    const filter = {
      include: ["customer-engagement.*"],
      aliases: { book_appointment: "customer-engagement.appointment.book" },
    };

    expect(registry.resolveActionType("book_appointment", filter)).toBe(
      "customer-engagement.appointment.book",
    );
    expect(registry.resolveActionType("customer-engagement.appointment.book")).toBe(
      "customer-engagement.appointment.book",
    );
    expect(registry.resolveActionType("unknown_action")).toBeNull();
  });

  it("detects duplicate action types across cartridges", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge("crm", makeMockManifest("crm", [{ actionType: "shared.action" }]));
    registry.registerCartridge("ads", makeMockManifest("ads", [{ actionType: "shared.action" }]));

    const duplicates = registry.findDuplicates();
    expect(duplicates).toContain("shared.action");
  });

  it("returns cartridge IDs", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge(
      "crm",
      makeMockManifest("crm", [{ actionType: "crm.contact.search" }]),
    );
    registry.registerCartridge(
      "ads",
      makeMockManifest("ads", [{ actionType: "ads.campaign.pause" }]),
    );

    expect(registry.getCartridgeIds().sort()).toEqual(["ads", "crm"]);
  });

  it("getTool returns registered tool", () => {
    const registry = new ToolRegistry();
    registry.registerCartridge(
      "crm",
      makeMockManifest("crm", [{ actionType: "crm.contact.search" }]),
    );

    const tool = registry.getTool("crm.contact.search");
    expect(tool).toBeDefined();
    expect(tool!.cartridgeId).toBe("crm");
    expect(tool!.actionType).toBe("crm.contact.search");
  });

  it("getTool returns undefined for missing tool", () => {
    const registry = new ToolRegistry();
    expect(registry.getTool("nonexistent")).toBeUndefined();
  });
});
