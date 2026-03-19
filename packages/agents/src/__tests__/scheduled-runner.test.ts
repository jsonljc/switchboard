import { describe, it, expect, vi } from "vitest";
import { ScheduledRunner } from "../scheduled-runner.js";
import { AgentRegistry } from "../registry.js";
import type { EventLoop } from "../event-loop.js";
import type { AgentContext } from "../ports.js";
import type { RoutedEventEnvelope } from "../events.js";

const ORG = "org-1";

function makeContext(): AgentContext {
  return { organizationId: ORG };
}

function makeRegistry(): AgentRegistry {
  const registry = new AgentRegistry();

  registry.register(ORG, {
    agentId: "realtime-agent",
    version: "0.1.0",
    installed: true,
    status: "active",
    config: {},
    capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    executionMode: "realtime",
  });

  registry.register(ORG, {
    agentId: "scheduled-agent",
    version: "0.1.0",
    installed: true,
    status: "active",
    config: {},
    capabilities: { accepts: ["ad.performance_review"], emits: [], tools: [] },
    executionMode: "scheduled",
  });

  registry.register(ORG, {
    agentId: "hybrid-agent",
    version: "0.1.0",
    installed: true,
    status: "active",
    config: {},
    capabilities: { accepts: ["ad.performance_review"], emits: [], tools: [] },
    executionMode: "hybrid",
  });

  return registry;
}

function makeMockEventLoop(): EventLoop {
  return {
    process: vi.fn(async () => ({ processed: [], depth: 0 })),
  } as unknown as EventLoop;
}

describe("ScheduledRunner", () => {
  describe("runAll", () => {
    it("triggers only scheduled and hybrid agents, not realtime", async () => {
      const registry = makeRegistry();
      const eventLoop = makeMockEventLoop();
      const runner = new ScheduledRunner({ registry, eventLoop });

      const results = await runner.runAll(ORG, makeContext());

      expect(results).toHaveLength(2);
      const agentIds = results.map((r) => r.agentId);
      expect(agentIds).toContain("scheduled-agent");
      expect(agentIds).toContain("hybrid-agent");
      expect(agentIds).not.toContain("realtime-agent");
      expect(results.every((r) => r.triggered)).toBe(true);
    });

    it("creates ad.performance_review events", async () => {
      const registry = makeRegistry();
      const eventLoop = makeMockEventLoop();
      const runner = new ScheduledRunner({ registry, eventLoop });

      await runner.runAll(ORG, makeContext());

      const processFn = eventLoop.process as ReturnType<typeof vi.fn>;
      expect(processFn).toHaveBeenCalledTimes(2);

      for (const call of processFn.mock.calls) {
        const event = call[0] as RoutedEventEnvelope;
        expect(event.eventType).toBe("ad.performance_review");
        expect(event.organizationId).toBe(ORG);
        expect(event.source).toEqual({ type: "system", id: "scheduled-runner" });
        expect(event.payload).toHaveProperty("triggeredBy", "schedule");
      }
    });

    it("captures errors without crashing", async () => {
      const registry = makeRegistry();
      const eventLoop = makeMockEventLoop();
      const processFn = eventLoop.process as ReturnType<typeof vi.fn>;
      processFn
        .mockRejectedValueOnce(new Error("handler exploded"))
        .mockResolvedValueOnce({ processed: [], depth: 0 });

      const runner = new ScheduledRunner({ registry, eventLoop });
      const results = await runner.runAll(ORG, makeContext());

      expect(results).toHaveLength(2);

      const failed = results.find((r) => !r.triggered);
      expect(failed).toBeDefined();
      expect(failed!.error).toBe("handler exploded");

      const succeeded = results.find((r) => r.triggered);
      expect(succeeded).toBeDefined();
    });
  });

  describe("runOne", () => {
    it("triggers a specific agent", async () => {
      const registry = makeRegistry();
      const eventLoop = makeMockEventLoop();
      const runner = new ScheduledRunner({ registry, eventLoop });

      const result = await runner.runOne(ORG, "scheduled-agent", makeContext());

      expect(result.agentId).toBe("scheduled-agent");
      expect(result.triggered).toBe(true);

      const processFn = eventLoop.process as ReturnType<typeof vi.fn>;
      expect(processFn).toHaveBeenCalledTimes(1);

      const event = processFn.mock.calls[0]![0] as RoutedEventEnvelope;
      expect(event.eventType).toBe("ad.performance_review");
      expect(event.payload).toHaveProperty("triggeredBy", "manual");
    });

    it("returns error for non-existent agent", async () => {
      const registry = makeRegistry();
      const eventLoop = makeMockEventLoop();
      const runner = new ScheduledRunner({ registry, eventLoop });

      const result = await runner.runOne(ORG, "ghost-agent", makeContext());

      expect(result.agentId).toBe("ghost-agent");
      expect(result.triggered).toBe(false);
      expect(result.error).toBe("agent_not_found");

      const processFn = eventLoop.process as ReturnType<typeof vi.fn>;
      expect(processFn).not.toHaveBeenCalled();
    });
  });
});
