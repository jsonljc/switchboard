import { describe, expect, it } from "vitest";
import type { OrgAgentEnablementRow } from "@switchboard/core";
import { isAgentHomeAccessible } from "../lib/agent-home-access.js";

const enabledRows = (keys: string[]): OrgAgentEnablementRow[] =>
  keys.map((agentKey) => ({
    id: `row-${agentKey}`,
    orgId: "org1",
    agentKey: agentKey as OrgAgentEnablementRow["agentKey"],
    status: "enabled",
    enabledAt: new Date(),
    updatedAt: new Date(),
  }));

describe("isAgentHomeAccessible", () => {
  it("alex/riley always accessible regardless of enablement rows", async () => {
    expect(await isAgentHomeAccessible("alex", "org1", { list: async () => [] })).toBe(true);
    expect(await isAgentHomeAccessible("riley", "org1", { list: async () => [] })).toBe(true);
  });

  it("mira accessible only when an enabled row exists", async () => {
    expect(
      await isAgentHomeAccessible("mira", "org1", {
        list: async () => enabledRows(["mira"]),
      }),
    ).toBe(true);
    expect(
      await isAgentHomeAccessible("mira", "org1", {
        list: async () => enabledRows(["alex"]),
      }),
    ).toBe(false);
    expect(
      await isAgentHomeAccessible("mira", "org1", {
        list: async () => [
          {
            id: "r1",
            orgId: "org1",
            agentKey: "mira" as OrgAgentEnablementRow["agentKey"],
            status: "coming_soon",
            enabledAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    ).toBe(false);
  });

  it("unknown agent → false", async () => {
    expect(await isAgentHomeAccessible("nova", "org1", { list: async () => [] })).toBe(false);
  });
});
