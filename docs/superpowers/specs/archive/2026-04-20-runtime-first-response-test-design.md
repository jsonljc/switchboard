# Runtime First-Response Integration Test

**Date:** 2026-04-20
**Goal:** Prove that when `ChannelGateway.handleIncoming()` receives a message, the real runtime path invokes Alex via live Claude and returns a correct reply through the sink.

## Success Criterion

Two dental scenarios produce correct replies through the full production runtime path: ChannelGateway → PlatformIngress → SkillMode → SkillExecutorImpl → Claude API → replySink.

## Scope

One test file: `packages/core/src/platform/__tests__/runtime-first-response.test.ts`

Single vertical (dental). Stage 2 already covers cross-vertical behavior. Stage 3 proves the runtime wiring works.

## What Is Real vs Mocked

| Component                                             | Real/Mock  | Rationale                                                                                   |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `ChannelGateway`                                      | Real       | Entry point under test                                                                      |
| `PlatformIngress`                                     | Real       | Orchestration wiring                                                                        |
| `IntentRegistry`                                      | Real       | Intent lookup (map-based, no external deps)                                                 |
| `ExecutionModeRegistry`                               | Real       | Mode dispatch (map-based)                                                                   |
| `SkillMode`                                           | Real       | Bridges work unit to executor                                                               |
| `SkillExecutorImpl`                                   | Real       | Multi-turn LLM loop                                                                         |
| `AnthropicToolCallingAdapter` → Claude API            | Real       | Live model response                                                                         |
| `loadSkill("alex")`                                   | Real       | Production skill prompt                                                                     |
| Tools (crm-query, crm-write, escalate, calendar-book) | Mock       | Return canned data, record invocations                                                      |
| `DeploymentResolver`                                  | Mock       | Returns static dental deployment result                                                     |
| `GatewayConversationStore`                            | Mock       | In-memory (getOrCreateBySession, addMessage)                                                |
| `GovernanceGate`                                      | Spy        | Returns `{ outcome: "execute", constraints: {} }`, asserts it was called with correct shape |
| `WorkTraceStore`                                      | Mock       | In-memory array                                                                             |
| Stores (opportunity, contact, businessFacts)          | Not needed | alexBuilder not in production runtime path                                                  |

## Deployment Fixture

Static dental deployment matching the Stage 2 SmileCraft fixture:

```ts
{
  deploymentId: "dep-alex-dental",
  listingId: "list-alex",
  organizationId: "org-smilecraft",
  skillSlug: "alex",
  trustScore: 50,
  trustLevel: "guided",
  persona: {
    businessName: "SmileCraft Dental",
    tone: "friendly, professional, concise — natural Singapore English",
    qualificationCriteria: { service_interest: "interested in a specific service", timing: "looking to book within 2 weeks" },
    disqualificationCriteria: { location: "outside Singapore" },
    escalationRules: { medical_question: true, complaint: true, pricing_exception: true },
    bookingLink: "",
    customInstructions: "",
  },
  deploymentConfig: {},
  policyOverrides: undefined,
}
```

Business facts are injected as a parameter through the `SubmitWorkRequest.parameters.BUSINESS_FACTS` field, matching how ChannelGateway populates parameters in production (via the resolved persona).

## Test Cases

### Scenario 1: Known fact — pricing inquiry

**Input to ChannelGateway.handleIncoming:**

```ts
{
  channel: "whatsapp",
  token: "dep-alex-dental",
  sessionId: "6591234567",
  text: "Hi, how much for teeth whitening?",
}
```

**Assertions:**

1. `replySink.send` called once
2. Reply text contains `388` (the actual price from business facts)
3. Reply is 1-4 sentences
4. Reply does NOT contain tool names (`crm-write`, `escalate`, `calendar-book`)
5. Reply does NOT contain corporate filler (`Great question!`, `I understand your concern`)
6. Governance spy called once — assert `workUnit.intent` is `"alex.respond"` and `workUnit.deployment.skillSlug` is `"alex"`

### Scenario 2: Unknown fact — MediSave inquiry

**Input to ChannelGateway.handleIncoming:**

```ts
{
  channel: "whatsapp",
  token: "dep-alex-dental",
  sessionId: "6591234568",
  text: "Do you accept MediSave for teeth whitening?",
}
```

**Assertions:**

1. `replySink.send` called once
2. Reply does NOT claim MediSave is accepted or rejected
3. Reply does NOT contain "probably", "I think", "usually", "typically"
4. One of:
   - Escalate tool was invoked (mock records the call), OR
   - Reply contains safe fallback phrase ("not certain", "team member", "confirm for you", "check on that", "not sure")
5. Reply is 1-4 sentences
6. Reply does NOT contain tool names
7. Governance spy called once with correct work unit shape

## Mock Tool Recording

All mock tools record invocations in a shared array:

```ts
interface ToolInvocation {
  toolId: string;
  operation: string;
  params: unknown;
}
```

The test inspects this array after execution to determine whether escalation happened. This is cleaner than relying on the `SkillExecutionResult.toolCalls` field (which goes through the executor's internal tracking) — but either approach works since the mock records the call either way.

## Assembly Pattern

Follow the `convergence-e2e.test.ts` pattern for wiring:

1. Create `IntentRegistry`, register `alex.respond` intent
2. Create `SkillMode` with real `SkillExecutorImpl` + `AnthropicToolCallingAdapter` + mock tools + loaded alex skill
3. Create `ExecutionModeRegistry`, register `"skill"` mode
4. Create `PlatformIngress` with intent registry, mode registry, governance spy, trace store
5. Create `ChannelGateway` with mock deployment resolver, in-memory conversation store, and the platform ingress
6. Call `gateway.handleIncoming(message, replySink)` and assert

The ChannelGateway needs to populate `parameters` with business facts and persona config in the `SubmitWorkRequest`. In production, these come from the deployment resolver result. The mock deployment resolver returns the dental fixture, and ChannelGateway builds the request from `resolved.persona`.

**Important:** Check how ChannelGateway builds the `parameters` field in the `SubmitWorkRequest`. It passes `message`, `conversation`, and `persona` — NOT `BUSINESS_FACTS` directly. The skill prompt uses `{{BUSINESS_FACTS}}` which must be populated. Since the alex builder is not in the runtime path, the business facts need to be either:

- Passed as part of `parameters` by the ChannelGateway (check the code), or
- Injected at the SkillMode level

If ChannelGateway doesn't pass business facts, the test will need to verify this gap exists and decide whether to work around it (add BUSINESS_FACTS to parameters manually) or accept that this is a real production gap worth discovering.

## Skip Condition

`ANTHROPIC_API_KEY` required. Tests skip if not set.

## Timeout

60 seconds per test. The full path (gateway → ingress → skill execution → LLM → reply) is longer than a direct executor call.

## Not In Scope

- Cross-vertical coverage (Stage 2)
- Transport/webhook wiring (Stage 1)
- Governance policy testing (separate suite)
- Multi-turn conversations
- Real database or external API calls
- Booking flow

## Exit Criteria

Both scenarios pass with live Claude API. The test proves: a message entering through ChannelGateway traverses the real PlatformIngress → SkillMode → SkillExecutorImpl path, invokes Claude with the Alex prompt, and produces a correct reply through the sink. Governance spy confirms the request shape is correct without evaluating policy.
