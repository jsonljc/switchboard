import { describe, it, expect, vi, afterEach } from "vitest";

describe("MCP mutation guard", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("requires SWITCHBOARD_API_URL in all environments", async () => {
    delete process.env.SWITCHBOARD_API_URL;

    const { buildMutationModeGuard } = await import("../main.js");

    expect(() => buildMutationModeGuard()).toThrow(
      "SWITCHBOARD_API_URL is required. The MCP server delegates all operations to the Switchboard API.",
    );
  });

  it("allows operation when SWITCHBOARD_API_URL is set", async () => {
    process.env.SWITCHBOARD_API_URL = "https://api.example.com";

    const { buildMutationModeGuard } = await import("../main.js");

    expect(() => buildMutationModeGuard()).not.toThrow();
  });
});
