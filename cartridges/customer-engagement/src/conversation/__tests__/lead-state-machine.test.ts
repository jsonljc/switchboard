import { describe, it, expect } from "vitest";
import {
  createLeadStateMachine,
  LeadConversationState,
  LeadConversationEvent,
  getPrimaryMoveForState,
  getGoalForState,
} from "../lead-state-machine.js";
import type { LeadStateMachineContext } from "../lead-state-machine.js";

function makeContext(overrides?: Partial<LeadStateMachineContext>): LeadStateMachineContext {
  return {
    turnCount: 0,
    signalsCaptured: 0,
    totalSignals: 3,
    engagementLevel: "medium",
    hasObjection: false,
    maxTurnsBeforeEscalation: 15,
    ...overrides,
  };
}

describe("LeadStateMachine", () => {
  it("should start in IDLE state", () => {
    const machine = createLeadStateMachine();
    expect(machine.currentState).toBe(LeadConversationState.IDLE);
  });

  it("should transition IDLE -> GREETING on first message", async () => {
    const machine = createLeadStateMachine();
    const result = await machine.transition(LeadConversationEvent.MESSAGE_RECEIVED, makeContext());
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.GREETING);
  });

  it("should transition GREETING -> QUALIFYING on intent classified", async () => {
    const machine = createLeadStateMachine();
    await machine.transition(LeadConversationEvent.MESSAGE_RECEIVED, makeContext());
    const result = await machine.transition(LeadConversationEvent.INTENT_CLASSIFIED, makeContext());
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.QUALIFYING);
  });

  it("should transition QUALIFYING -> BOOKING_PUSH when all signals captured", async () => {
    const machine = createLeadStateMachine();
    await machine.transition(LeadConversationEvent.MESSAGE_RECEIVED, makeContext());
    await machine.transition(LeadConversationEvent.INTENT_CLASSIFIED, makeContext());
    const result = await machine.transition(
      LeadConversationEvent.ALL_SIGNALS_CAPTURED,
      makeContext({ signalsCaptured: 3, totalSignals: 3 }),
    );
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.BOOKING_PUSH);
  });

  it("should transition QUALIFYING -> OBJECTION_HANDLING on objection", async () => {
    const machine = createLeadStateMachine();
    await machine.transition(LeadConversationEvent.MESSAGE_RECEIVED, makeContext());
    await machine.transition(LeadConversationEvent.INTENT_CLASSIFIED, makeContext());
    const result = await machine.transition(
      LeadConversationEvent.OBJECTION_DETECTED,
      makeContext({ hasObjection: true }),
    );
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.OBJECTION_HANDLING);
  });

  it("should transition QUALIFYING -> SLOWDOWN_MODE on declining engagement", async () => {
    const machine = createLeadStateMachine();
    await machine.transition(LeadConversationEvent.MESSAGE_RECEIVED, makeContext());
    await machine.transition(LeadConversationEvent.INTENT_CLASSIFIED, makeContext());
    const result = await machine.transition(
      LeadConversationEvent.ENGAGEMENT_DECLINING,
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.SLOWDOWN_MODE);
  });

  it("should transition BOOKING_PUSH -> AWAITING_BOOKING -> POST_BOOKING", async () => {
    const machine = createLeadStateMachine();
    machine.hydrate(LeadConversationState.BOOKING_PUSH);

    await machine.transition(LeadConversationEvent.BOOKING_LINK_SENT, makeContext());
    expect(machine.currentState).toBe(LeadConversationState.AWAITING_BOOKING);

    await machine.transition(LeadConversationEvent.BOOKING_CONFIRMED, makeContext());
    expect(machine.currentState).toBe(LeadConversationState.POST_BOOKING);
  });

  it("should transition to ESCALATING on human request from QUALIFYING", async () => {
    const machine = createLeadStateMachine();
    machine.hydrate(LeadConversationState.QUALIFYING);

    const result = await machine.transition(LeadConversationEvent.HUMAN_REQUESTED, makeContext());
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.ESCALATING);
  });

  it("should handle reactivation flow", async () => {
    const machine = createLeadStateMachine();
    machine.hydrate(LeadConversationState.CLOSED_UNRESPONSIVE);

    await machine.transition(LeadConversationEvent.REACTIVATION_REPLY, makeContext());
    expect(machine.currentState).toBe(LeadConversationState.REACTIVATION);

    await machine.transition(LeadConversationEvent.INTENT_CLASSIFIED, makeContext());
    expect(machine.currentState).toBe(LeadConversationState.QUALIFYING);
  });

  it("should transition to ESCALATING on human request from GREETING", async () => {
    const machine = createLeadStateMachine();
    machine.hydrate(LeadConversationState.GREETING);
    const result = await machine.transition(LeadConversationEvent.HUMAN_REQUESTED, makeContext());
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.ESCALATING);
  });

  it("should transition to ESCALATING on human request from POST_BOOKING", async () => {
    const machine = createLeadStateMachine();
    machine.hydrate(LeadConversationState.POST_BOOKING);
    const result = await machine.transition(LeadConversationEvent.HUMAN_REQUESTED, makeContext());
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.ESCALATING);
  });

  it("should transition to ESCALATING on human request from FOLLOW_UP_SCHEDULED", async () => {
    const machine = createLeadStateMachine();
    machine.hydrate(LeadConversationState.FOLLOW_UP_SCHEDULED);
    const result = await machine.transition(LeadConversationEvent.HUMAN_REQUESTED, makeContext());
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.ESCALATING);
  });

  it("should transition to ESCALATING on ESCALATION_TRIGGERED from GREETING", async () => {
    const machine = createLeadStateMachine();
    machine.hydrate(LeadConversationState.GREETING);
    const result = await machine.transition(
      LeadConversationEvent.ESCALATION_TRIGGERED,
      makeContext(),
    );
    expect(result.success).toBe(true);
    expect(machine.currentState).toBe(LeadConversationState.ESCALATING);
  });

  it("should map states to primary moves", () => {
    expect(getPrimaryMoveForState(LeadConversationState.GREETING)).toBe("greet");
    expect(getPrimaryMoveForState(LeadConversationState.QUALIFYING)).toBe(
      "ask_qualification_question",
    );
    expect(getPrimaryMoveForState(LeadConversationState.BOOKING_PUSH)).toBe("advance_to_booking");
    expect(getPrimaryMoveForState(LeadConversationState.ESCALATING)).toBe("escalate_to_human");
    expect(getPrimaryMoveForState(LeadConversationState.SLOWDOWN_MODE)).toBe(
      "acknowledge_and_hold",
    );
  });
});

describe("getGoalForState", () => {
  it("returns a goal string for every state", () => {
    for (const state of Object.values(LeadConversationState)) {
      const goal = getGoalForState(state);
      expect(goal).toBeTruthy();
      expect(typeof goal).toBe("string");
    }
  });

  it("returns qualifying goal for QUALIFYING state", () => {
    const goal = getGoalForState(LeadConversationState.QUALIFYING);
    expect(goal).toContain("readiness");
  });
});
