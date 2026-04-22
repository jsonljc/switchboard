import { describe, it, expect, vi, afterEach } from "vitest";

describe("MCP production mutation guard", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("refuses in-memory mutation mode in production without API delegation", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SWITCHBOARD_API_URL;
    delete process.env.ALLOW_IN_MEMORY_MCP;

    const { buildMutationModeGuard } = await import("../main.js");

    expect(() => buildMutationModeGuard()).toThrow(
      "Production MCP mutation requires SWITCHBOARD_API_URL",
    );
  });

  it("allows production mode when SWITCHBOARD_API_URL is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.SWITCHBOARD_API_URL = "https://api.example.com";

    const { buildMutationModeGuard } = await import("../main.js");

    expect(() => buildMutationModeGuard()).not.toThrow();
  });

  it("allows in-memory mode when ALLOW_IN_MEMORY_MCP is true", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SWITCHBOARD_API_URL;
    process.env.ALLOW_IN_MEMORY_MCP = "true";

    const { buildMutationModeGuard } = await import("../main.js");

    expect(() => buildMutationModeGuard()).not.toThrow();
  });

  it("allows in-memory mode in non-production environments", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SWITCHBOARD_API_URL;

    const { buildMutationModeGuard } = await import("../main.js");

    expect(() => buildMutationModeGuard()).not.toThrow();
  });
});
