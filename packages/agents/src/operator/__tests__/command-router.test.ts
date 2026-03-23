import { describe, it, expect, vi } from "vitest";
import { CommandRouter } from "../command-router.js";
import type { CommandRouterDeps } from "../command-router.js";
import type { OperatorCommand } from "@switchboard/schemas";

function makeCommand(overrides: Partial<OperatorCommand> = {}): OperatorCommand {
  return {
    id: "cmd-1",
    requestId: "req-1",
    organizationId: "org-1",
    intent: "show_pipeline",
    entities: [],
    parameters: {},
    parseConfidence: 0.9,
    guardrailResult: {
      canExecute: true,
      requiresConfirmation: false,
      requiresPreview: false,
      warnings: [],
      missingEntities: [],
      riskLevel: "low",
      ambiguityFlags: [],
    },
    status: "confirmed",
    workflowIds: [],
    resultSummary: null,
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

describe("CommandRouter", () => {
  it("routes read-only intents directly to agent query handler", async () => {
    const queryHandler = vi.fn().mockResolvedValue({ totalDeals: 12 });
    const deps: CommandRouterDeps = {
      agentQueryHandlers: { show_pipeline: queryHandler },
    };

    const router = new CommandRouter(deps);
    const result = await router.dispatch(makeCommand({ intent: "show_pipeline" }));

    expect(result.success).toBe(true);
    expect(result.workflowIds).toHaveLength(0);
    expect(queryHandler).toHaveBeenCalledWith("org-1", {}, []);
  });

  it("routes write intents to workflow creation", async () => {
    const workflowSpawner = vi.fn().mockResolvedValue("wf-1");
    const deps: CommandRouterDeps = {
      workflowSpawner,
    };

    const router = new CommandRouter(deps);
    const result = await router.dispatch(
      makeCommand({ intent: "pause_campaigns", entities: [{ type: "campaign", id: "c-1" }] }),
    );

    expect(result.success).toBe(true);
    expect(result.workflowIds).toContain("wf-1");
    expect(workflowSpawner).toHaveBeenCalled();
  });

  it("returns error when no handler found for read-only intent", async () => {
    const router = new CommandRouter({});
    const result = await router.dispatch(makeCommand({ intent: "show_pipeline" }));

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when workflow spawner not available for write intent", async () => {
    const router = new CommandRouter({});
    const result = await router.dispatch(makeCommand({ intent: "pause_campaigns" }));

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
