# SP5: Task Recording + Trust Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically record widget conversations as `AgentTask` entries after session timeout, and feed task approvals/rejections into the trust score engine so agents build marketplace reputation from real conversations.

**Architecture:** New `TaskRecorder` module in `apps/chat/src/gateway/` that tracks active sessions, detects 15-minute inactivity timeout, aggregates messages into a transcript, and creates `AgentTask` records. The `ChannelGateway` gets an `onMessageRecorded` callback in its config to notify the recorder after each assistant reply. Trust scoring is already wired via the existing task review API — SP5 just ensures tasks are created from real conversations.

**Tech Stack:** TypeScript, Vitest, PrismaAgentTaskStore

---

## File Structure

| Action | Path                                                         | Responsibility                                          |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------- |
| Create | `apps/chat/src/gateway/task-recorder.ts`                     | Session tracking, timeout detection, AgentTask creation |
| Create | `apps/chat/src/gateway/__tests__/task-recorder.test.ts`      | Task recorder tests                                     |
| Modify | `packages/core/src/channel-gateway/types.ts`                 | Add `onMessageRecorded` callback to config              |
| Modify | `packages/core/src/channel-gateway/channel-gateway.ts`       | Call `onMessageRecorded` after assistant reply          |
| Modify | `apps/chat/src/gateway/chat-server-factory.ts` or equivalent | Wire TaskRecorder into gateway config                   |

---

### Task 1: Add onMessageRecorded Callback to ChannelGateway

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`

- [ ] **Step 1: Read the existing types and gateway**

Read:

- `packages/core/src/channel-gateway/types.ts` — find `ChannelGatewayConfig`
- `packages/core/src/channel-gateway/channel-gateway.ts` — find `onChatExecute`

- [ ] **Step 2: Add callback to ChannelGatewayConfig**

In `packages/core/src/channel-gateway/types.ts`, add to `ChannelGatewayConfig`:

```typescript
/** Called after each assistant message is persisted. Used by TaskRecorder. */
onMessageRecorded?: (info: {
  deploymentId: string;
  listingId: string;
  channel: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
}) => void;
```

- [ ] **Step 3: Call the callback in ChannelGateway**

In `packages/core/src/channel-gateway/channel-gateway.ts`, inside the `onChatExecute` callback (after `addMessage` for the assistant reply), add:

```typescript
this.config.onMessageRecorded?.({
  deploymentId: info.deployment.id,
  listingId: info.deployment.listingId,
  channel: message.channel,
  sessionId: message.sessionId,
  role: "assistant",
  content: reply,
});
```

Also call it after the user message is persisted (step 3 in the pipeline):

```typescript
// After: await this.config.conversationStore.addMessage(conversationId, "user", message.text);
this.config.onMessageRecorded?.({
  deploymentId: info.deployment.id,
  listingId: info.deployment.listingId,
  channel: message.channel,
  sessionId: message.sessionId,
  role: "user",
  content: message.text,
});
```

- [ ] **Step 4: Verify tests pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run`
Expected: All pass (callback is optional, existing tests don't set it)

- [ ] **Step 5: Commit**

```bash
git add packages/core/ && git commit -m "feat(core): add onMessageRecorded callback to ChannelGateway"
```

---

### Task 2: TaskRecorder Module

**Files:**

- Create: `apps/chat/src/gateway/task-recorder.ts`
- Create: `apps/chat/src/gateway/__tests__/task-recorder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/chat/src/gateway/__tests__/task-recorder.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskRecorder } from "../task-recorder.js";

describe("TaskRecorder", () => {
  let recorder: TaskRecorder;
  let mockCreateTask: ReturnType<typeof vi.fn>;
  let mockSubmitOutput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCreateTask = vi.fn().mockResolvedValue({ id: "task-1" });
    mockSubmitOutput = vi.fn().mockResolvedValue({});
    recorder = new TaskRecorder({
      createTask: mockCreateTask,
      submitOutput: mockSubmitOutput,
      sessionTimeoutMs: 1000, // 1 second for testing
      minAssistantMessages: 2,
    });
  });

  afterEach(() => {
    recorder.dispose();
    vi.useRealTimers();
  });

  it("records a task after session timeout", async () => {
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      channel: "web_widget",
      sessionId: "sess-1",
      role: "user",
      content: "Hello",
    });
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      channel: "web_widget",
      sessionId: "sess-1",
      role: "assistant",
      content: "Hi there!",
    });
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      channel: "web_widget",
      sessionId: "sess-1",
      role: "assistant",
      content: "How can I help?",
    });

    await vi.advanceTimersByTimeAsync(1500);

    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-1",
        listingId: "list-1",
        category: "general-inquiry",
      }),
    );
    expect(mockSubmitOutput).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        transcript: expect.arrayContaining([
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ]),
      }),
    );
  });

  it("does not record task with fewer than minAssistantMessages", async () => {
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      channel: "web_widget",
      sessionId: "sess-2",
      role: "user",
      content: "Hi",
    });
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      channel: "web_widget",
      sessionId: "sess-2",
      role: "assistant",
      content: "Hello",
    });

    await vi.advanceTimersByTimeAsync(1500);

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("resets timeout on new messages", async () => {
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      channel: "web_widget",
      sessionId: "sess-3",
      role: "user",
      content: "First",
    });

    await vi.advanceTimersByTimeAsync(800);

    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      channel: "web_widget",
      sessionId: "sess-3",
      role: "assistant",
      content: "Reply 1",
    });
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      channel: "web_widget",
      sessionId: "sess-3",
      role: "assistant",
      content: "Reply 2",
    });

    // Timer was reset — original 1000ms hasn't elapsed from last message
    await vi.advanceTimersByTimeAsync(800);
    expect(mockCreateTask).not.toHaveBeenCalled();

    // Now let it fully expire
    await vi.advanceTimersByTimeAsync(500);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter chat test -- --run task-recorder`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TaskRecorder**

Create `apps/chat/src/gateway/task-recorder.ts`:

```typescript
const DEFAULT_SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MIN_ASSISTANT_MESSAGES = 2;

interface RecordedMessage {
  role: "user" | "assistant";
  content: string;
}

interface SessionState {
  deploymentId: string;
  listingId: string;
  channel: string;
  messages: RecordedMessage[];
  assistantCount: number;
  timer: ReturnType<typeof setTimeout>;
}

interface MessageInfo {
  deploymentId: string;
  listingId: string;
  channel: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
}

interface TaskRecorderConfig {
  createTask: (input: {
    deploymentId: string;
    organizationId?: string;
    listingId: string;
    category: string;
    input?: Record<string, unknown>;
  }) => Promise<{ id: string }>;
  submitOutput: (taskId: string, output: Record<string, unknown>) => Promise<unknown>;
  sessionTimeoutMs?: number;
  minAssistantMessages?: number;
}

export class TaskRecorder {
  private sessions = new Map<string, SessionState>();
  private timeoutMs: number;
  private minAssistantMessages: number;
  private config: TaskRecorderConfig;

  constructor(config: TaskRecorderConfig) {
    this.config = config;
    this.timeoutMs = config.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.minAssistantMessages = config.minAssistantMessages ?? DEFAULT_MIN_ASSISTANT_MESSAGES;
  }

  recordMessage(info: MessageInfo): void {
    const key = `${info.channel}:${info.sessionId}`;
    let session = this.sessions.get(key);

    if (!session) {
      session = {
        deploymentId: info.deploymentId,
        listingId: info.listingId,
        channel: info.channel,
        messages: [],
        assistantCount: 0,
        timer: setTimeout(() => this.flushSession(key), this.timeoutMs),
      };
      this.sessions.set(key, session);
    } else {
      // Reset timeout on each new message
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.flushSession(key), this.timeoutMs);
    }

    session.messages.push({ role: info.role, content: info.content });
    if (info.role === "assistant") {
      session.assistantCount++;
    }
  }

  private async flushSession(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);

    // Skip sessions with too few assistant messages (bounces/test pings)
    if (session.assistantCount < this.minAssistantMessages) return;

    try {
      const task = await this.config.createTask({
        deploymentId: session.deploymentId,
        listingId: session.listingId,
        category: "general-inquiry",
        input: { channel: session.channel },
      });

      await this.config.submitOutput(task.id, {
        transcript: session.messages,
        messageCount: session.messages.length,
        assistantMessageCount: session.assistantCount,
      });
    } catch (err) {
      console.error("[TaskRecorder] Failed to record task:", err);
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.timer);
    }
    this.sessions.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter chat test -- --run task-recorder`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/gateway/ && git commit -m "feat(chat): add TaskRecorder for conversation-to-task recording"
```

---

### Task 3: Wire TaskRecorder into Chat Server

**Files:**

- Modify: `apps/chat/src/` — find where `ChannelGateway` is constructed and pass `onMessageRecorded`

- [ ] **Step 1: Find the gateway construction**

Search for `new ChannelGateway` in `apps/chat/src/` to find where the gateway is instantiated. Read that file.

- [ ] **Step 2: Create and wire TaskRecorder**

In the file that constructs the `ChannelGateway`, add:

```typescript
import { TaskRecorder } from "./gateway/task-recorder.js";
import { PrismaAgentTaskStore } from "@switchboard/db";

const taskStore = new PrismaAgentTaskStore(prisma);

const taskRecorder = new TaskRecorder({
  createTask: (input) =>
    taskStore.create({
      deploymentId: input.deploymentId,
      organizationId: "", // Will be resolved from deployment
      listingId: input.listingId,
      category: input.category,
      input: input.input,
    }),
  submitOutput: (taskId, output) => taskStore.submitOutput(taskId, output),
});

// Pass to ChannelGateway config:
const gateway = new ChannelGateway({
  // ... existing config ...
  onMessageRecorded: (info) => taskRecorder.recordMessage(info),
});
```

Note: The `organizationId` for task creation needs to come from somewhere. Read the `PrismaAgentTaskStore.create` to check if it's required. If so, you may need to look up the deployment's org ID. The `onMessageRecorded` callback only has `deploymentId` — you may need to add `organizationId` to the `DeploymentInfo` type, or look it up in the recorder.

For simplicity, the recorder can query the deployment's org on flush:

```typescript
// In flushSession, before createTask:
const deployment = await prisma.agentDeployment.findUnique({
  where: { id: session.deploymentId },
  select: { organizationId: true },
});
if (!deployment) return;
```

Add `prisma` to the recorder config if needed.

- [ ] **Step 3: Verify**

Run: `npx pnpm@9.15.4 --filter chat typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/chat/src/ && git commit -m "feat(chat): wire TaskRecorder into ChannelGateway"
```

---

## Verification Checklist

1. `npx pnpm@9.15.4 --filter @switchboard/core test -- --run` — all pass
2. `npx pnpm@9.15.4 --filter chat test -- --run task-recorder` — recorder tests pass
3. Task recorder creates `AgentTask` after 15-min inactivity timeout
4. Sessions with <2 assistant messages are filtered out
5. Task review (approve/reject) already feeds into `TrustScoreEngine` via existing API routes — no additional wiring needed for trust scoring
