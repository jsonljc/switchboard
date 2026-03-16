// ---------------------------------------------------------------------------
// Lead Conversation State Machine — lifecycle phases above the flow engine
// ---------------------------------------------------------------------------

import { StateMachine } from "@switchboard/core";
import type { StateMachineConfig, PrimaryMove } from "@switchboard/core";

export enum LeadConversationState {
  IDLE = "IDLE",
  GREETING = "GREETING",
  CLARIFYING = "CLARIFYING",
  QUALIFYING = "QUALIFYING",
  SLOWDOWN_MODE = "SLOWDOWN_MODE",
  OBJECTION_HANDLING = "OBJECTION_HANDLING",
  BOOKING_PUSH = "BOOKING_PUSH",
  AWAITING_BOOKING = "AWAITING_BOOKING",
  POST_BOOKING = "POST_BOOKING",
  FOLLOW_UP_SCHEDULED = "FOLLOW_UP_SCHEDULED",
  ESCALATING = "ESCALATING",
  HUMAN_ACTIVE = "HUMAN_ACTIVE",
  CLOSED_BOOKED = "CLOSED_BOOKED",
  CLOSED_UNRESPONSIVE = "CLOSED_UNRESPONSIVE",
  REACTIVATION = "REACTIVATION",
}

export enum LeadConversationEvent {
  MESSAGE_RECEIVED = "MESSAGE_RECEIVED",
  INTENT_CLASSIFIED = "INTENT_CLASSIFIED",
  QUALIFICATION_SIGNAL_CAPTURED = "QUALIFICATION_SIGNAL_CAPTURED",
  ALL_SIGNALS_CAPTURED = "ALL_SIGNALS_CAPTURED",
  OBJECTION_DETECTED = "OBJECTION_DETECTED",
  OBJECTION_RESOLVED = "OBJECTION_RESOLVED",
  BOOKING_LINK_SENT = "BOOKING_LINK_SENT",
  BOOKING_CONFIRMED = "BOOKING_CONFIRMED",
  HUMAN_REQUESTED = "HUMAN_REQUESTED",
  ESCALATION_TRIGGERED = "ESCALATION_TRIGGERED",
  ENGAGEMENT_DECLINING = "ENGAGEMENT_DECLINING",
  URGENCY_READY_NOW = "URGENCY_READY_NOW",
  SILENCE_24H = "SILENCE_24H",
  SILENCE_72H = "SILENCE_72H",
  REACTIVATION_REPLY = "REACTIVATION_REPLY",
  HUMAN_RELEASED = "HUMAN_RELEASED",
  CONVERSATION_CLOSED = "CONVERSATION_CLOSED",
}

export interface LeadStateMachineContext {
  turnCount: number;
  signalsCaptured: number;
  totalSignals: number;
  engagementLevel: "high" | "medium" | "low" | "declining";
  hasObjection: boolean;
  maxTurnsBeforeEscalation: number;
}

/** Map each state to the primary move the agent should accomplish. */
const STATE_TO_MOVE: Record<LeadConversationState, PrimaryMove> = {
  [LeadConversationState.IDLE]: "greet",
  [LeadConversationState.GREETING]: "greet",
  [LeadConversationState.CLARIFYING]: "clarify",
  [LeadConversationState.QUALIFYING]: "ask_qualification_question",
  [LeadConversationState.SLOWDOWN_MODE]: "acknowledge_and_hold",
  [LeadConversationState.OBJECTION_HANDLING]: "handle_objection",
  [LeadConversationState.BOOKING_PUSH]: "advance_to_booking",
  [LeadConversationState.AWAITING_BOOKING]: "confirm_booking",
  [LeadConversationState.POST_BOOKING]: "confirm_booking",
  [LeadConversationState.FOLLOW_UP_SCHEDULED]: "send_reminder",
  [LeadConversationState.ESCALATING]: "escalate_to_human",
  [LeadConversationState.HUMAN_ACTIVE]: "escalate_to_human",
  [LeadConversationState.CLOSED_BOOKED]: "close",
  [LeadConversationState.CLOSED_UNRESPONSIVE]: "close",
  [LeadConversationState.REACTIVATION]: "reactivate",
};

/** Human-readable goal descriptions per state, used as LLM prompt context. */
export const STATE_GOALS: Record<LeadConversationState, string> = {
  [LeadConversationState.IDLE]: "Build rapport, understand why they're reaching out",
  [LeadConversationState.GREETING]: "Build rapport, understand why they're reaching out",
  [LeadConversationState.CLARIFYING]:
    "Understand which service they need — ask about goals, not just treatments",
  [LeadConversationState.QUALIFYING]:
    "Assess readiness naturally — weave timeline/budget questions into conversation",
  [LeadConversationState.SLOWDOWN_MODE]: "Re-engage with light touch — 'Still thinking about it?'",
  [LeadConversationState.OBJECTION_HANDLING]:
    "Acknowledge concern genuinely, provide relevant info, don't be pushy",
  [LeadConversationState.BOOKING_PUSH]:
    "Guide toward booking — suggest times, explain what to expect, reduce friction",
  [LeadConversationState.AWAITING_BOOKING]: "Be available, answer last questions, don't pressure",
  [LeadConversationState.POST_BOOKING]: "Confirm booking details, set expectations for the visit",
  [LeadConversationState.FOLLOW_UP_SCHEDULED]: "Check in warmly, see if they still need help",
  [LeadConversationState.ESCALATING]:
    "Warm handoff — explain a team member will follow up, set timing expectations",
  [LeadConversationState.HUMAN_ACTIVE]: "A team member is handling this conversation directly",
  [LeadConversationState.CLOSED_BOOKED]: "Booking confirmed — conversation complete",
  [LeadConversationState.CLOSED_UNRESPONSIVE]: "Lead went quiet — conversation closed",
  [LeadConversationState.REACTIVATION]:
    "Welcome them back warmly, understand if their needs changed",
};

export function getGoalForState(state: LeadConversationState): string {
  return STATE_GOALS[state];
}

export function getPrimaryMoveForState(state: LeadConversationState): PrimaryMove {
  return STATE_TO_MOVE[state];
}

export function createLeadStateMachineConfig(): StateMachineConfig<
  LeadConversationState,
  LeadConversationEvent,
  LeadStateMachineContext
> {
  return {
    initialState: LeadConversationState.IDLE,
    transitions: [
      // IDLE -> GREETING on first message
      {
        from: LeadConversationState.IDLE,
        event: LeadConversationEvent.MESSAGE_RECEIVED,
        to: LeadConversationState.GREETING,
      },

      // GREETING -> QUALIFYING after intent classified
      {
        from: LeadConversationState.GREETING,
        event: LeadConversationEvent.INTENT_CLASSIFIED,
        to: LeadConversationState.QUALIFYING,
      },
      // GREETING -> CLARIFYING if intent unclear
      {
        from: LeadConversationState.GREETING,
        event: LeadConversationEvent.MESSAGE_RECEIVED,
        to: LeadConversationState.CLARIFYING,
      },

      // CLARIFYING -> QUALIFYING once intent is clear
      {
        from: LeadConversationState.CLARIFYING,
        event: LeadConversationEvent.INTENT_CLASSIFIED,
        to: LeadConversationState.QUALIFYING,
      },

      // QUALIFYING -> QUALIFYING on partial signal capture
      {
        from: LeadConversationState.QUALIFYING,
        event: LeadConversationEvent.QUALIFICATION_SIGNAL_CAPTURED,
        to: LeadConversationState.QUALIFYING,
        guard: (ctx) => ctx.signalsCaptured < ctx.totalSignals,
      },
      // QUALIFYING -> BOOKING_PUSH when all signals captured
      {
        from: LeadConversationState.QUALIFYING,
        event: LeadConversationEvent.ALL_SIGNALS_CAPTURED,
        to: LeadConversationState.BOOKING_PUSH,
      },
      // QUALIFYING -> OBJECTION_HANDLING on objection
      {
        from: LeadConversationState.QUALIFYING,
        event: LeadConversationEvent.OBJECTION_DETECTED,
        to: LeadConversationState.OBJECTION_HANDLING,
      },
      // QUALIFYING -> SLOWDOWN_MODE on declining engagement
      {
        from: LeadConversationState.QUALIFYING,
        event: LeadConversationEvent.ENGAGEMENT_DECLINING,
        to: LeadConversationState.SLOWDOWN_MODE,
      },
      // QUALIFYING -> BOOKING_PUSH on ready-now urgency
      {
        from: LeadConversationState.QUALIFYING,
        event: LeadConversationEvent.URGENCY_READY_NOW,
        to: LeadConversationState.BOOKING_PUSH,
      },

      // SLOWDOWN_MODE -> QUALIFYING on re-engagement
      {
        from: LeadConversationState.SLOWDOWN_MODE,
        event: LeadConversationEvent.MESSAGE_RECEIVED,
        to: LeadConversationState.QUALIFYING,
      },

      // OBJECTION_HANDLING -> QUALIFYING when objection resolved
      {
        from: LeadConversationState.OBJECTION_HANDLING,
        event: LeadConversationEvent.OBJECTION_RESOLVED,
        to: LeadConversationState.QUALIFYING,
      },
      // OBJECTION_HANDLING -> BOOKING_PUSH if all signals done
      {
        from: LeadConversationState.OBJECTION_HANDLING,
        event: LeadConversationEvent.ALL_SIGNALS_CAPTURED,
        to: LeadConversationState.BOOKING_PUSH,
      },

      // BOOKING_PUSH -> AWAITING_BOOKING once link sent
      {
        from: LeadConversationState.BOOKING_PUSH,
        event: LeadConversationEvent.BOOKING_LINK_SENT,
        to: LeadConversationState.AWAITING_BOOKING,
      },
      // BOOKING_PUSH -> OBJECTION_HANDLING on objection
      {
        from: LeadConversationState.BOOKING_PUSH,
        event: LeadConversationEvent.OBJECTION_DETECTED,
        to: LeadConversationState.OBJECTION_HANDLING,
      },

      // AWAITING_BOOKING -> POST_BOOKING on confirmation
      {
        from: LeadConversationState.AWAITING_BOOKING,
        event: LeadConversationEvent.BOOKING_CONFIRMED,
        to: LeadConversationState.POST_BOOKING,
      },
      // AWAITING_BOOKING -> FOLLOW_UP_SCHEDULED on 24h silence
      {
        from: LeadConversationState.AWAITING_BOOKING,
        event: LeadConversationEvent.SILENCE_24H,
        to: LeadConversationState.FOLLOW_UP_SCHEDULED,
      },

      // POST_BOOKING -> CLOSED_BOOKED
      {
        from: LeadConversationState.POST_BOOKING,
        event: LeadConversationEvent.CONVERSATION_CLOSED,
        to: LeadConversationState.CLOSED_BOOKED,
      },

      // FOLLOW_UP_SCHEDULED -> QUALIFYING on reply
      {
        from: LeadConversationState.FOLLOW_UP_SCHEDULED,
        event: LeadConversationEvent.MESSAGE_RECEIVED,
        to: LeadConversationState.QUALIFYING,
      },
      // FOLLOW_UP_SCHEDULED -> CLOSED_UNRESPONSIVE on 72h silence
      {
        from: LeadConversationState.FOLLOW_UP_SCHEDULED,
        event: LeadConversationEvent.SILENCE_72H,
        to: LeadConversationState.CLOSED_UNRESPONSIVE,
      },

      // Any non-terminal state -> ESCALATING on human request or escalation trigger
      ...[
        LeadConversationState.GREETING,
        LeadConversationState.CLARIFYING,
        LeadConversationState.QUALIFYING,
        LeadConversationState.OBJECTION_HANDLING,
        LeadConversationState.BOOKING_PUSH,
        LeadConversationState.AWAITING_BOOKING,
        LeadConversationState.SLOWDOWN_MODE,
        LeadConversationState.POST_BOOKING,
        LeadConversationState.FOLLOW_UP_SCHEDULED,
        LeadConversationState.REACTIVATION,
      ].flatMap((from) => [
        {
          from,
          event: LeadConversationEvent.HUMAN_REQUESTED,
          to: LeadConversationState.ESCALATING,
        },
        {
          from,
          event: LeadConversationEvent.ESCALATION_TRIGGERED,
          to: LeadConversationState.ESCALATING,
        },
      ]),

      // ESCALATING -> HUMAN_ACTIVE (handoff accepted)
      {
        from: LeadConversationState.ESCALATING,
        event: LeadConversationEvent.MESSAGE_RECEIVED,
        to: LeadConversationState.HUMAN_ACTIVE,
      },

      // HUMAN_ACTIVE -> QUALIFYING (human releases)
      {
        from: LeadConversationState.HUMAN_ACTIVE,
        event: LeadConversationEvent.HUMAN_RELEASED,
        to: LeadConversationState.QUALIFYING,
      },

      // CLOSED_UNRESPONSIVE -> REACTIVATION on re-engagement
      {
        from: LeadConversationState.CLOSED_UNRESPONSIVE,
        event: LeadConversationEvent.REACTIVATION_REPLY,
        to: LeadConversationState.REACTIVATION,
      },
      // REACTIVATION -> QUALIFYING
      {
        from: LeadConversationState.REACTIVATION,
        event: LeadConversationEvent.INTENT_CLASSIFIED,
        to: LeadConversationState.QUALIFYING,
      },
    ],
  };
}

export function createLeadStateMachine(): StateMachine<
  LeadConversationState,
  LeadConversationEvent,
  LeadStateMachineContext
> {
  return new StateMachine(createLeadStateMachineConfig());
}
