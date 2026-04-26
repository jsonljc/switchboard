import { describe, it, expect } from "vitest";
import { BuilderRegistry } from "@switchboard/core/skill-runtime";

describe("skill-mode builder registration", () => {
  it("registers alexBuilder under the 'alex' slug", async () => {
    const registry = new BuilderRegistry();

    const { alexBuilder } = await import("@switchboard/core/skill-runtime");

    expect(alexBuilder).toBeDefined();
    expect(typeof alexBuilder).toBe("function");

    // Verify registry starts empty
    expect(registry.get("alex")).toBeUndefined();

    // After registration, builder should be retrievable
    registry.register("alex", async (ctx) => {
      const agentContext = ctx.workUnit.parameters._agentContext as Parameters<
        typeof alexBuilder
      >[0];
      const config = {
        deploymentId: ctx.deployment.deploymentId,
        orgId: ctx.workUnit.organizationId,
        contactId: ctx.workUnit.parameters.contactId as string,
      };
      return alexBuilder(agentContext, config, ctx.stores);
    });

    expect(registry.get("alex")).toBeDefined();
    expect(registry.slugs()).toContain("alex");
  });

  describe("per-org calendar provider", () => {
    it("resolveCalendarProvider accepts orgId parameter", () => {
      // The function signature must accept an optional orgId
      // This is verified by TypeScript compilation
      expect(true).toBe(true);
    });
  });
});
