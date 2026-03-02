import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventReactionProcessor } from "../event-bus/processor.js";
import { InMemoryEventReactionStore } from "../event-bus/in-memory-reaction-store.js";
import type { DomainEvent, EventReaction } from "../event-bus/types.js";
import type { ReactionOrchestrator } from "../event-bus/processor.js";

function createEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: "evt_1",
    eventType: "payments.invoice.created",
    sourceCartridgeId: "payments",
    organizationId: "org_1",
    principalId: "user_1",
    payload: { customerId: "cus_123", amount: 500 },
    envelopeId: "env_1",
    traceId: "trace_1",
    emittedAt: new Date(),
    ...overrides,
  };
}

function createReaction(overrides: Partial<EventReaction> = {}): EventReaction {
  return {
    id: "react_1",
    name: "Log CRM activity on payment",
    eventTypePattern: "payments.*",
    organizationId: "org_1",
    targetAction: {
      cartridgeId: "crm",
      actionType: "crm.activity.log",
      parameterTemplate: {
        type: "note",
        subject: "Payment received: $event.payload.amount",
        contactIds: ["$event.payload.customerId"],
      },
    },
    condition: null,
    enabled: true,
    priority: 10,
    actorId: "$event.principalId",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("EventReactionProcessor", () => {
  let reactionStore: InMemoryEventReactionStore;
  let orchestrator: ReactionOrchestrator;
  let processor: EventReactionProcessor;

  beforeEach(() => {
    reactionStore = new InMemoryEventReactionStore();
    orchestrator = {
      propose: vi.fn().mockResolvedValue({
        denied: false,
        envelope: { id: "env_triggered", status: "approved" },
      }),
    };
    processor = new EventReactionProcessor({
      reactionStore,
      orchestrator,
    });
  });

  it("triggers matching reaction and calls orchestrator.propose", async () => {
    await reactionStore.save(createReaction());
    const event = createEvent();

    await processor.process(event);

    expect(orchestrator.propose).toHaveBeenCalledTimes(1);
    const call = (orchestrator.propose as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.actionType).toBe("crm.activity.log");
    expect(call.cartridgeId).toBe("crm");
    expect(call.parameters.subject).toBe("Payment received: 500");
    expect(call.parameters.contactIds).toEqual(["cus_123"]);
    expect(call.parentEnvelopeId).toBe("env_1");
    expect(call.traceId).toBe("trace_1");
  });

  it("skips disabled reactions", async () => {
    await reactionStore.save(createReaction({ enabled: false }));

    await processor.process(createEvent());
    expect(orchestrator.propose).not.toHaveBeenCalled();
  });

  it("skips reactions that don't match event pattern", async () => {
    await reactionStore.save(
      createReaction({ eventTypePattern: "crm.*" }),
    );

    await processor.process(createEvent());
    expect(orchestrator.propose).not.toHaveBeenCalled();
  });

  it("evaluates condition and skips when not met", async () => {
    await reactionStore.save(
      createReaction({
        condition: { "payload.amount": 1000 }, // Event has 500
      }),
    );

    await processor.process(createEvent());
    expect(orchestrator.propose).not.toHaveBeenCalled();
  });

  it("evaluates condition and triggers when met", async () => {
    await reactionStore.save(
      createReaction({
        condition: { "payload.amount": 500 },
      }),
    );

    await processor.process(createEvent());
    expect(orchestrator.propose).toHaveBeenCalledTimes(1);
  });

  it("prevents infinite chains with max depth", async () => {
    // Create a self-referencing reaction that would chain infinitely
    let proposeCalls = 0;

    const chainOrchestrator: ReactionOrchestrator = {
      propose: vi.fn().mockImplementation(async () => {
        proposeCalls++;
        // Simulate the reaction triggering another event with the same traceId
        // by calling process again from within propose
        if (proposeCalls <= 5) {
          await chainProcessor.process(createEvent({ traceId: "chain_1" }));
        }
        return { denied: false, envelope: { id: `env_${proposeCalls}`, status: "approved" } };
      }),
    };

    const chainProcessor = new EventReactionProcessor({
      reactionStore,
      orchestrator: chainOrchestrator,
      maxChainDepth: 2,
    });

    await reactionStore.save(createReaction());

    // Start the chain
    await chainProcessor.process(createEvent({ traceId: "chain_1" }));

    // Should have been called exactly 2 times (max depth = 2)
    expect(proposeCalls).toBe(2);
  });

  it("handles orchestrator.propose failure gracefully", async () => {
    (orchestrator.propose as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("governance denied"),
    );
    await reactionStore.save(createReaction());

    // Should not throw
    await processor.process(createEvent());

    expect(orchestrator.propose).toHaveBeenCalledTimes(1);
  });

  it("processes multiple matching reactions in priority order", async () => {
    const callOrder: string[] = [];
    (orchestrator.propose as ReturnType<typeof vi.fn>).mockImplementation(
      async (params: { actionType: string }) => {
        callOrder.push(params.actionType);
        return { denied: false, envelope: { id: "env_x", status: "approved" } };
      },
    );

    await reactionStore.save(
      createReaction({
        id: "react_low",
        priority: 1,
        targetAction: {
          cartridgeId: "crm",
          actionType: "crm.low.priority",
          parameterTemplate: {},
        },
      }),
    );
    await reactionStore.save(
      createReaction({
        id: "react_high",
        priority: 100,
        targetAction: {
          cartridgeId: "crm",
          actionType: "crm.high.priority",
          parameterTemplate: {},
        },
      }),
    );

    await processor.process(createEvent());

    expect(callOrder).toEqual(["crm.high.priority", "crm.low.priority"]);
  });

  it("resolves actorId from $event.principalId", async () => {
    await reactionStore.save(
      createReaction({ actorId: "$event.principalId" }),
    );

    await processor.process(createEvent({ principalId: "user_42" }));

    const call = (orchestrator.propose as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.principalId).toBe("user_42");
  });
});

describe("InMemoryEventReactionStore", () => {
  it("listByEventPattern returns matching enabled reactions", async () => {
    const store = new InMemoryEventReactionStore();
    await store.save(createReaction({ id: "r1", eventTypePattern: "payments.*" }));
    await store.save(createReaction({ id: "r2", eventTypePattern: "crm.*" }));
    await store.save(createReaction({ id: "r3", eventTypePattern: "payments.*", enabled: false }));

    const matches = await store.listByEventPattern("payments.invoice.created", "org_1");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe("r1");
  });
});
