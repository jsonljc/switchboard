# Conversation Quality Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 5 critical conversation quality issues that would make the AI sales agent fail in real conversations.

**Architecture:** All fixes are in the customer-engagement cartridge and chat app. No new dependencies. Each fix is independent and can be committed separately.

**Tech Stack:** TypeScript, Vitest, existing conversation engine + router

---

## The 5 Fixes

| #   | Issue                                                                      | Impact                                                        |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `contactName` is set to user ID ("7001"), not their real name              | Bot says "I understand your concern, 7001"                    |
| 2   | Objection handling sends literal `{{objectionResponse}}` — never populated | Bot sends placeholder text to real prospects                  |
| 3   | Intent classifier catches "how much" as objection, not question            | Pricing questions trigger objection flow instead of answering |
| 4   | FAQ match short-circuits router — no `stateGoal` returned, LLM skipped     | FAQ answers bypass LLM natural tone, feel robotic             |
| 5   | No "I don't know" path — unmatched questions fall through silently         | Bot ignores questions and continues qualification script      |

---

### Task 1: Fix contactName Bug — Use Real Name from Channel Metadata

**Files:**

- Modify: `cartridges/customer-engagement/src/conversation/router.ts:444-446`
- Test: `cartridges/customer-engagement/src/conversation/__tests__/router.test.ts`

The adapters (Telegram, WhatsApp) already extract the real name into `message.metadata["contactName"]`. The router ignores this and uses `message.from` (a user ID like "7001").

**Step 1: Add `metadata` to `InboundMessage` interface**

In `router.ts`, the `InboundMessage` interface (line 20) needs an optional `metadata` field:

```typescript
export interface InboundMessage {
  channelId: string;
  channelType: "sms" | "web_chat" | "instagram_dm" | "facebook_messenger" | "whatsapp" | "telegram";
  body: string;
  from: string;
  timestamp: Date;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
}
```

**Step 2: Fix `createSession` to use metadata contactName**

In `createSession` (line 444), change:

```typescript
// Before:
contactName: message.from,

// After:
contactName: (message.metadata?.["contactName"] as string) ?? message.from,
```

**Step 3: Also update contactName when NLP extracts a name mid-conversation**

In `handleMessage` (around line 191, where `nlpResult.extractedVariables` are set), add after `Object.assign(state.variables, nlpResult.extractedVariables)`:

```typescript
// Update contactName if NLP extracted a name (e.g., "my name is Sarah")
if (nlpResult.extractedVariables["name"]) {
  state.variables["contactName"] = nlpResult.extractedVariables["name"];
}
```

**Step 4: Write tests**

Add to `router.test.ts`:

```typescript
it("uses metadata contactName instead of user ID", async () => {
  const response = await router.handleMessage({
    channelId: "test-channel",
    channelType: "whatsapp",
    body: "hi",
    from: "7001",
    timestamp: new Date(),
    metadata: { contactName: "Sarah" },
  });
  expect(response.variables?.["contactName"]).toBe("Sarah");
});

it("falls back to message.from when metadata has no contactName", async () => {
  const response = await router.handleMessage({
    channelId: "test-channel-2",
    channelType: "telegram",
    body: "hello",
    from: "12345",
    timestamp: new Date(),
  });
  expect(response.variables?.["contactName"]).toBe("12345");
});
```

**Step 5: Run tests**

Run: `pnpm --filter @switchboard/customer-engagement test`
Expected: All pass

**Step 6: Commit**

```bash
git commit -m "fix: use real contact name from channel metadata instead of user ID"
```

---

### Task 2: Wire Objection Trees to Objection Handling Flow

**Files:**

- Modify: `cartridges/customer-engagement/src/conversation/router.ts` (around line 175-200)
- Test: `cartridges/customer-engagement/src/conversation/__tests__/router.test.ts`

**Problem:** When intent is classified as `objection`, the state machine transitions to `OBJECTION_HANDLING`, but:

1. The `objectionHandlingFlow` template expects `{{objectionResponse}}` variable — never set
2. The `matchObjection()` function exists but is never called from the router
3. Profile-specific `objectionTrees` are defined but unused

**Step 1: Add `objectionTrees` to `ConversationRouterConfig`**

```typescript
export interface ConversationRouterConfig {
  // ... existing fields ...
  /** Objection trees for keyword-matched objection handling */
  objectionTrees?: import("../agents/intake/objection-trees.js").ObjectionMatch[];
}
```

Add to constructor:

```typescript
private readonly objectionTrees: import("../agents/intake/objection-trees.js").ObjectionMatch[];

// In constructor:
this.objectionTrees = config.objectionTrees ?? [];
```

**Step 2: Populate `objectionResponse` variable when objection intent detected**

In `handleMessage`, after NLP processing (around line 200), before the flow execution loop, add:

```typescript
// Wire objection response when intent is objection
if (classification.intent === "objection") {
  const { matchObjection } = await import("../agents/intake/objection-trees.js");
  const objMatch = matchObjection(
    message.body,
    this.objectionTrees.length > 0 ? this.objectionTrees : undefined,
  );
  if (objMatch) {
    state.variables["objectionCategory"] = objMatch.category;
    state.variables["objectionResponse"] = objMatch.response;
    state.variables["objectionFollowUp"] = objMatch.followUp;
  }
}
```

**Important:** Use a static import instead of dynamic `await import(...)` since this is a cartridge-internal import. Add at the top of the file:

```typescript
import { matchObjection } from "../agents/intake/objection-trees.js";
```

Then the inline code becomes:

```typescript
if (classification.intent === "objection") {
  const objMatch = matchObjection(
    message.body,
    this.objectionTrees.length > 0 ? this.objectionTrees : undefined,
  );
  if (objMatch) {
    state.variables["objectionCategory"] = objMatch.category;
    state.variables["objectionResponse"] = objMatch.response;
    state.variables["objectionFollowUp"] = objMatch.followUp;
  }
}
```

**Step 3: Pass objectionTrees from bootstrap into the router**

In `apps/chat/src/bootstrap.ts`, where `leadRouter` is created (search for `new ConversationRouter`), add `objectionTrees` from the resolved profile:

```typescript
objectionTrees: resolvedProfile?.profile.objectionTrees ?? [],
```

**Step 4: Write tests**

```typescript
it("populates objectionResponse variable when objection detected", async () => {
  const router = new ConversationRouter({
    sessionStore,
    flows: new Map([["main", mainFlow]]),
    defaultFlowId: "main",
    objectionTrees: [
      {
        category: "price",
        keywords: ["expensive", "cost", "afford"],
        response: "We offer payment plans.",
        followUp: "Want to learn more?",
      },
    ],
  });

  // First message creates session
  await router.handleMessage({
    channelId: "objection-test",
    channelType: "whatsapp",
    body: "hi",
    from: "user1",
    timestamp: new Date(),
  });

  // Second message with objection
  const response = await router.handleMessage({
    channelId: "objection-test",
    channelType: "whatsapp",
    body: "this is too expensive for me",
    from: "user1",
    timestamp: new Date(),
  });

  expect(response.variables?.["objectionResponse"]).toBe("We offer payment plans.");
  expect(response.variables?.["objectionCategory"]).toBe("price");
});
```

**Step 5: Run tests**

Run: `pnpm --filter @switchboard/customer-engagement test`
Expected: All pass

**Step 6: Commit**

```bash
git commit -m "fix: wire objection trees to router — populate objectionResponse variable"
```

---

### Task 3: Fix Intent Classifier — Don't Classify Pricing Questions as Objections

**Files:**

- Modify: `cartridges/customer-engagement/src/conversation/intent-classifier.ts:74-79`
- Test: `cartridges/customer-engagement/src/conversation/__tests__/intent-classifier.test.ts`

**Problem:** The objection patterns include `/how (?:much|long|painful)/i` which catches legitimate questions like "how much does Botox cost?" as objections. Since objection patterns come before question patterns (first-match-wins), real questions never reach the question intent.

**Step 1: Write failing tests**

Create or add to `intent-classifier.test.ts`:

```typescript
import { MessageIntentClassifier } from "../intent-classifier.js";

describe("MessageIntentClassifier", () => {
  const classifier = new MessageIntentClassifier();

  it("classifies 'how much does Botox cost?' as question, not objection", () => {
    const result = classifier.classify("how much does Botox cost?");
    expect(result.intent).toBe("question");
  });

  it("classifies 'how long does the treatment take?' as question, not objection", () => {
    const result = classifier.classify("how long does the treatment take?");
    expect(result.intent).toBe("question");
  });

  it("classifies 'how painful is it?' as question, not objection", () => {
    const result = classifier.classify("how painful is it?");
    expect(result.intent).toBe("question");
  });

  it("still classifies 'I'm worried about the cost' as objection", () => {
    const result = classifier.classify("I'm worried about the cost");
    expect(result.intent).toBe("objection");
  });

  it("still classifies 'that's too expensive' as objection", () => {
    const result = classifier.classify("that's too expensive");
    expect(result.intent).toBe("objection");
  });

  it("classifies 'hi' as freeform_answer (no greeting intent)", () => {
    const result = classifier.classify("hi");
    expect(result.intent).toBe("freeform_answer");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/customer-engagement test -- intent-classifier`
Expected: First 3 tests FAIL (classified as "objection" instead of "question")

**Step 3: Fix the objection patterns**

Remove `how (?:much|long|painful)` from objection patterns. These are questions, not objections. The key difference: an objection expresses resistance ("too expensive", "I'm scared"), while a question seeks information ("how much does it cost?").

Change line 77 from:

```typescript
/(?:what if|but what|how (?:much|long|painful))/i,
```

to:

```typescript
/(?:what if|but what)/i,
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/customer-engagement test -- intent-classifier`
Expected: All pass

**Step 5: Commit**

```bash
git commit -m "fix: don't classify pricing/duration questions as objections in intent classifier"
```

---

### Task 4: Make FAQ Responses Flow Through LLM for Natural Tone

**Files:**

- Modify: `cartridges/customer-engagement/src/conversation/router.ts:158-173`
- Test: `cartridges/customer-engagement/src/conversation/__tests__/router.test.ts`

**Problem:** FAQ matching short-circuits the router — returns immediately without advancing the flow, without setting `stateGoal`, and without giving the LLM engine a chance to make the response sound natural. The FAQ answer is returned verbatim as a cold, robotic block of text.

**Step 1: Include stateGoal and machineState in FAQ responses**

Change the FAQ response block (lines 158-173) to include state context:

```typescript
// Step 2.5: FAQ matching — if FAQs are configured, try to answer directly before flow
if (this.faqs.length > 0) {
  const faqResult = matchFAQ(message.body, this.faqs);
  if (faqResult.tier === "direct" || faqResult.tier === "caveat") {
    const faqResponse = formatFAQResponse(faqResult, this.businessName);
    if (faqResponse) {
      return {
        handled: true,
        responses: [faqResponse],
        escalated: false,
        completed: false,
        sessionId: session.id,
        machineState: session.machineState,
        stateGoal: session.machineState
          ? getGoalForState(session.machineState as LeadConversationState)
          : undefined,
        faqContext: faqResponse,
      };
    }
  }
}
```

**Step 2: Add `faqContext` to `RouterResponse` interface**

```typescript
export interface RouterResponse {
  // ... existing fields ...
  /** FAQ answer text, when response came from FAQ matching (allows LLM to rephrase) */
  faqContext?: string;
}
```

**Step 3: Update lead-handler to use FAQ context with LLM**

In `apps/chat/src/handlers/lead-handler.ts`, in the LLM generation block, when `faqContext` is present, include it in the LLM context so the LLM can rephrase the FAQ answer naturally:

```typescript
// When FAQ provided the answer, include it as context for the LLM to rephrase
if (routerResponse.faqContext) {
  llmCtx.objectionContext = `Answer this based on: ${routerResponse.faqContext}`;
}
```

**Step 4: Write test**

```typescript
it("includes stateGoal and machineState in FAQ responses", async () => {
  const router = new ConversationRouter({
    sessionStore,
    flows: new Map([["main", mainFlow]]),
    defaultFlowId: "main",
    faqs: [
      {
        id: "faq-1",
        question: "What are your hours?",
        answer: "We are open Monday to Friday, 9am to 5pm.",
        topic: "hours",
      },
    ],
  });

  // Create session first
  await router.handleMessage({
    channelId: "faq-test",
    channelType: "whatsapp",
    body: "hi",
    from: "user1",
    timestamp: new Date(),
  });

  // Ask FAQ question
  const response = await router.handleMessage({
    channelId: "faq-test",
    channelType: "whatsapp",
    body: "What are your hours?",
    from: "user1",
    timestamp: new Date(),
  });

  expect(response.handled).toBe(true);
  expect(response.faqContext).toBeDefined();
  expect(response.stateGoal).toBeDefined();
});
```

**Step 5: Run tests**

Run: `pnpm --filter @switchboard/customer-engagement test`
Expected: All pass

**Step 6: Commit**

```bash
git commit -m "fix: include state context in FAQ responses for LLM natural rephrasing"
```

---

### Task 5: Add "I Don't Know" Graceful Handling

**Files:**

- Modify: `cartridges/customer-engagement/src/conversation/router.ts`
- Modify: `cartridges/customer-engagement/src/conversation/lead-state-machine.ts`
- Test: `cartridges/customer-engagement/src/conversation/__tests__/router.test.ts`

**Problem:** When a prospect asks a question that doesn't match any FAQ and isn't an objection, the bot ignores the question entirely and continues the qualification script. This feels terrible — the prospect asks "do you do microblading?" and the bot responds "What timeframe are you looking at?"

**Step 1: Add unknown question detection in the router**

In `handleMessage`, after the FAQ matching block and before the flow execution, add detection for unmatched questions:

```typescript
// Step 2.6: Handle questions that didn't match any FAQ
if (
  this.faqs.length > 0 &&
  classification.intent === "question" &&
  !state.variables["faqAnswered"]
) {
  // Question asked but no FAQ match — set context for LLM to handle gracefully
  state.variables["unansweredQuestion"] = message.body;
}
```

**Step 2: Add `unansweredQuestion` to `RouterResponse`**

```typescript
export interface RouterResponse {
  // ... existing fields ...
  /** Unanswered question text, when a question didn't match any FAQ */
  unansweredQuestion?: string;
}
```

Populate it in the return statement (around line 284):

```typescript
unansweredQuestion: currentState.variables["unansweredQuestion"] as string | undefined,
```

**Step 3: Handle in lead-handler**

In `apps/chat/src/handlers/lead-handler.ts`, when building the LLM context, include unanswered question info:

```typescript
if (routerResponse.unansweredQuestion) {
  llmCtx.objectionContext =
    `They asked a question you don't have a specific answer for: "${routerResponse.unansweredQuestion}". ` +
    `Acknowledge their question honestly — say something like "Let me check with the team on that" or ` +
    `"I'll have someone get back to you on that." Don't ignore it or change the subject.`;
}
```

**Step 4: Write test**

```typescript
it("flags unanswered questions for graceful handling", async () => {
  const router = new ConversationRouter({
    sessionStore,
    flows: new Map([["main", mainFlow]]),
    defaultFlowId: "main",
    faqs: [
      {
        id: "faq-1",
        question: "What are your hours?",
        answer: "9-5 weekdays.",
        topic: "hours",
      },
    ],
  });

  await router.handleMessage({
    channelId: "unknown-q",
    channelType: "telegram",
    body: "hi",
    from: "user1",
    timestamp: new Date(),
  });

  const response = await router.handleMessage({
    channelId: "unknown-q",
    channelType: "telegram",
    body: "Do you offer microblading?",
    from: "user1",
    timestamp: new Date(),
  });

  expect(response.unansweredQuestion).toBe("Do you offer microblading?");
});
```

**Step 5: Run tests**

Run: `pnpm --filter @switchboard/customer-engagement test && pnpm --filter @switchboard/chat test`
Expected: All pass

**Step 6: Run full typecheck and test suite**

Run: `pnpm typecheck && pnpm test`
Expected: All pass

**Step 7: Commit**

```bash
git commit -m "fix: add graceful 'I don't know' handling for unmatched questions"
```

---

## Verification Checklist

After all 5 tasks:

1. `pnpm typecheck` passes (all 24 packages)
2. `pnpm test` passes (all ~4277 tests)
3. Manually trace these conversation scenarios through the code:
   - WhatsApp user "Sarah" sends "hi" → bot uses "Sarah" not her phone number
   - User says "this is too expensive" → bot gets matched objection response, not `{{objectionResponse}}`
   - User asks "how much does Botox cost?" → classified as question, not objection
   - User asks "What are your hours?" → FAQ answer includes stateGoal for LLM rephrasing
   - User asks "Do you do microblading?" → bot acknowledges the question instead of ignoring it

## Files Summary

| Action | File                                                                                  | Task       |
| ------ | ------------------------------------------------------------------------------------- | ---------- |
| MODIFY | `cartridges/customer-engagement/src/conversation/router.ts`                           | 1, 2, 4, 5 |
| MODIFY | `cartridges/customer-engagement/src/conversation/intent-classifier.ts`                | 3          |
| MODIFY | `apps/chat/src/handlers/lead-handler.ts`                                              | 4, 5       |
| MODIFY | `apps/chat/src/bootstrap.ts`                                                          | 2          |
| TEST   | `cartridges/customer-engagement/src/conversation/__tests__/router.test.ts`            | 1, 2, 4, 5 |
| TEST   | `cartridges/customer-engagement/src/conversation/__tests__/intent-classifier.test.ts` | 3          |
