# LLM-Driven Conversations with Flow Guardrails

## Problem

The lead bot uses scripted templates with 3 qualification questions and keyword-matched objection handling. Real prospects hit its limits within 3-4 messages. It feels like filling out a form, not talking to a person.

## Solution

Let the LLM drive the conversation while the existing state machine controls lifecycle transitions. The state machine decides **when** to transition (qualifying → booking → escalation). The LLM decides **what to say** within each state.

## Architecture

```
Inbound message
  → Intent classifier (existing regex — fast, free)
  → ConversationRouter (existing — manages state machine + flow position)
  → NEW: LLMConversationEngine
      Inputs:
        - Current state + goal
        - Business profile (services, FAQs, hours, pricing)
        - Conversation history (last 10 messages)
        - Lead profile (what we know so far)
        - Objection context (if detected)
      Output:
        - Natural language response
  → Existing safety filters (medical claims, banned phrases, prompt injection)
  → Typing delay → Send
```

Signal extraction stays rule-based in the router. The router parses transition signals (booking intent, objection keywords, medical risk, escalation request), advances the state machine, then passes `{ state, goal, signals }` to the LLM engine instead of returning a template string.

## State-to-Goal Mapping

| State              | LLM Goal                                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| GREETING           | Build rapport, understand why they're reaching out                             |
| CLARIFYING         | Understand which service they need — ask about goals, not just treatments      |
| QUALIFYING         | Assess readiness naturally — weave timeline/budget questions into conversation |
| BOOKING_PUSH       | Guide toward booking — suggest times, explain what to expect, reduce friction  |
| OBJECTION_HANDLING | Acknowledge concern genuinely, provide relevant info, don't be pushy           |
| AWAITING_BOOKING   | Be available, answer last questions, don't pressure                            |
| SLOWDOWN_MODE      | Re-engage with light touch — "Still thinking about it?"                        |
| ESCALATING         | Warm handoff — explain a team member will follow up, set timing expectations   |

## System Prompt

```
You are {persona_name} at {business_name}. You're the friendly face
people first talk to — warm, helpful, and genuinely happy to help.

You talk like a real person at a local clinic, not a chatbot. Short
sentences. Natural responses. If someone says "hi" you don't launch
into a pitch — you just say hi back and ask how you can help.

## What you know
- Services: {services_with_prices}
- Hours: {hours}
- Location: {address}
- Booking: {booking_method}

{faq_section}

## About this person
{lead_profile_or "This is a new conversation."}

## How to behave
- Be brief. 1-2 sentences usually. 3 max if they asked something detailed.
- Match their energy. If they're casual, be casual. If they're formal, adjust.
- Don't sell. Help. If they're a good fit, the booking happens naturally.
- Say "let me check with the team" if you're unsure. Never guess.
- If they mention anything medical (medications, pregnancy, conditions),
  let them know a provider will follow up personally.
- Use their name sometimes, not every message.

## Right now
{state_goal}
```

**User prompt** (per message):

```
Conversation so far:
{last_10_messages}

Their latest message: "{user_message}"

{objection_guidance_if_detected}

Respond naturally. Stay focused on: {state_goal}
```

## Model

Claude Haiku via existing modelRouter. ~$0.01/conversation. Max 200 output tokens. Temperature 0.6.

## What Changes vs. What Stays

### No modifications

- Lead state machine (15 states, transitions)
- Intent classifier (regex)
- Safety filters (medical claims, banned phrases, prompt injection)
- Session store (Redis/in-memory)
- Typing delay, dedup, attribution tracking
- Cadence worker, silence detector

### New

- `apps/chat/src/conversation/llm-conversation-engine.ts` — takes state + context, calls Haiku, returns response

### Modified

- `apps/chat/src/handlers/lead-handler.ts` — pass to LLM engine instead of returning template
- `cartridges/customer-engagement/src/conversation/router.ts` — expose state goal, allow LLM path
- `cartridges/customer-engagement/src/conversation/lead-state-machine.ts` — add goal descriptions per state

## Estimated Scope

~3 files new/modified, ~200-300 lines of code.
