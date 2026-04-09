import { describe, it, expect } from "vitest";
import { AgentManifestSchema } from "../manifest.js";

describe("AgentManifestSchema", () => {
  const validManifest = {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    description: "Responds to inbound leads within 60 seconds",
    version: "1.0.0",
    author: "switchboard",
    category: "sales",
    capabilities: {
      required: ["chat"],
      optional: ["browser"],
    },
    connections: {
      required: [{ type: "chat_channel", reason: "To receive and respond to leads" }],
      optional: [{ type: "google_calendar", reason: "To book meetings" }],
    },
    governance: {
      startingAutonomy: "supervised",
      escalateWhen: ["customer_frustrated", "asked_for_human"],
    },
    pricing: { model: "free" },
  };

  it("parses a valid manifest", () => {
    const result = AgentManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it("requires name, slug, description, version, author, category", () => {
    const result = AgentManifestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("defaults capabilities to empty arrays", () => {
    const minimal = {
      name: "Test",
      slug: "test",
      description: "A test agent",
      version: "0.1.0",
      author: "dev",
      category: "general",
    };
    const result = AgentManifestSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities.required).toEqual([]);
      expect(result.data.capabilities.optional).toEqual([]);
    }
  });

  it("defaults governance.startingAutonomy to supervised", () => {
    const minimal = {
      name: "Test",
      slug: "test",
      description: "A test agent",
      version: "0.1.0",
      author: "dev",
      category: "general",
    };
    const result = AgentManifestSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.governance.startingAutonomy).toBe("supervised");
    }
  });

  it("rejects invalid pricing model", () => {
    const bad = { ...validManifest, pricing: { model: "premium" } };
    const result = AgentManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects invalid autonomy level", () => {
    const bad = {
      ...validManifest,
      governance: { ...validManifest.governance, startingAutonomy: "full_auto" },
    };
    const result = AgentManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
