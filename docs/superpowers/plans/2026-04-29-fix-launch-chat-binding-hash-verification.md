# Block Chat Approval Payloads from Conversational Ingress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intercept approval-shaped JSON payloads (`{action,approvalId,bindingHash}`) at `ChannelGateway` so they never reach `PlatformIngress.submit()` or the LLM. All terminal cases (not-found, org-mismatch, hash-mismatch, hash-match, store-throws) reply once and return. Reject button payloads in the three notifiers gain `bindingHash` for parity with Approve.

**Architecture:** Gateway-internal (A1) detection placement — a strict-shape parser helper runs at the top of `handleIncoming` after deployment resolve and pause handling but before contact identity / persistence / submit. A thin handler reads from `ApprovalStore.getById`, compares supplied vs stored `bindingHash` via `timingSafeEqual` with length pre-check, and emits one of four constant reply messages. No lifecycle mutation from chat in this slice.

**Tech Stack:** TypeScript ESM, vitest, Node `node:crypto`, Prisma (chat side wiring only). pnpm + Turborepo monorepo (`@switchboard/core`, `@switchboard/db`, `apps/chat`).

**Spec:** `docs/superpowers/specs/2026-04-29-fix-launch-chat-binding-hash-verification-design.md`

**Audit reference:** `.audit/08-launch-blocker-sequence.md` Risk #4.

**Branch:** `fix/launch-chat-binding-hash-verification` (per audit). The spec and this plan land on `main` as their own focused docs-only PRs first; the implementation worktree branches from `main` after the docs PRs merge.

---

## Prerequisites

- [ ] **P1: Verify spec and plan are merged to `main`**

```bash
git checkout main && git pull
ls docs/superpowers/specs/2026-04-29-fix-launch-chat-binding-hash-verification-design.md
ls docs/superpowers/plans/2026-04-29-fix-launch-chat-binding-hash-verification.md
```

Expected: both files present on `main`.

- [ ] **P2: Create implementation worktree off `main`**

```bash
git worktree add .worktrees/chat-binding-hash -b fix/launch-chat-binding-hash-verification main
cd .worktrees/chat-binding-hash
pnpm install
pnpm reset
```

Expected: worktree at `.worktrees/chat-binding-hash` on a fresh branch from `main`. `pnpm reset` clears `dist/` and rebuilds schemas → core → db.

- [ ] **P3: Run baseline tests to confirm green start**

```bash
pnpm --filter @switchboard/core test
pnpm --filter chat test
pnpm typecheck
```

Expected: all pass on the fresh branch (no diff yet).

---

## Task 1: WhatsApp notifier — add `bindingHash` to Reject button payload

**Files:**

- Modify: `packages/core/src/notifications/whatsapp-notifier.ts:60-66`
- Modify: `apps/chat/src/__tests__/whatsapp-notifier.test.ts:67-76`

- [ ] **Step 1: Update the existing reject-button assertion to require `bindingHash` (write the failing assertion)**

Edit `apps/chat/src/__tests__/whatsapp-notifier.test.ts` — extend the existing `"includes approve and reject buttons with correct payloads"` test by adding one assertion line. Replace:

```ts
    const rejectData = JSON.parse(rejectBtn.reply.id);
    expect(rejectData.action).toBe("reject");
    expect(rejectData.approvalId).toBe("appr_1");
  });
```

with:

```ts
    const rejectData = JSON.parse(rejectBtn.reply.id);
    expect(rejectData.action).toBe("reject");
    expect(rejectData.approvalId).toBe("appr_1");
    expect(rejectData.bindingHash).toBe("hash123");
  });
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter chat test -- whatsapp-notifier
```

Expected: FAIL — `expect(rejectData.bindingHash).toBe("hash123")` receives `undefined`.

- [ ] **Step 3: Update the WhatsApp notifier to emit `bindingHash` on the Reject button**

Edit `packages/core/src/notifications/whatsapp-notifier.ts` — locate the Reject button in the `buttons` array (around line 64) and replace:

```ts
            {
              type: "reply",
              reply: {
                id: JSON.stringify({ action: "reject", approvalId: n.approvalId }),
                title: "Reject",
              },
            },
```

with:

```ts
            {
              type: "reply",
              reply: {
                id: JSON.stringify({
                  action: "reject",
                  approvalId: n.approvalId,
                  bindingHash: n.bindingHash,
                }),
                title: "Reject",
              },
            },
```

- [ ] **Step 4: Rebuild core (the chat app consumes built output) and re-run the test**

```bash
pnpm --filter @switchboard/core build
pnpm --filter chat test -- whatsapp-notifier
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/notifications/whatsapp-notifier.ts \
        apps/chat/src/__tests__/whatsapp-notifier.test.ts
git commit -m "fix(chat): include bindingHash in WhatsApp Reject button payload"
```

---

## Task 2: Telegram notifier — add `bindingHash` to Reject button payload (new test file)

**Files:**

- Create: `packages/core/src/notifications/__tests__/telegram-notifier.test.ts`
- Modify: `packages/core/src/notifications/telegram-notifier.ts:60-65`

- [ ] **Step 1: Create the new test file with parity coverage (failing)**

Create `packages/core/src/notifications/__tests__/telegram-notifier.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramApprovalNotifier } from "../telegram-notifier.js";
import type { ApprovalNotification } from "../notifier.js";

describe("TelegramApprovalNotifier", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
  });

  function makeNotification(overrides: Partial<ApprovalNotification> = {}): ApprovalNotification {
    return {
      approvalId: "appr_1",
      envelopeId: "env_1",
      summary: "Pause campaign ABC",
      explanation: "Budget exceeds limit",
      riskCategory: "medium",
      bindingHash: "hash123",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      approvers: ["12345"],
      evidenceBundle: {},
      ...overrides,
    };
  }

  it("emits Approve and Reject button payloads that both include bindingHash", async () => {
    const notifier = new TelegramApprovalNotifier("test_bot_token");

    await notifier.notify(makeNotification());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(options.body);

    const buttons = body.reply_markup.inline_keyboard.flat() as Array<{
      text: string;
      callback_data: string;
    }>;
    const approveBtn = buttons.find((b) => b.text === "Approve");
    const rejectBtn = buttons.find((b) => b.text === "Reject");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    const approveData = JSON.parse(approveBtn!.callback_data);
    expect(approveData).toEqual({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });

    const rejectData = JSON.parse(rejectBtn!.callback_data);
    expect(rejectData).toEqual({
      action: "reject",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @switchboard/core test -- telegram-notifier
```

Expected: FAIL — `rejectData` is `{ action: "reject", approvalId: "appr_1" }` (missing `bindingHash`).

- [ ] **Step 3: Update Telegram notifier to emit `bindingHash` on Reject button**

Edit `packages/core/src/notifications/telegram-notifier.ts` — in `buildButtons()`, replace the Reject button object:

```ts
        {
          text: "Reject",
          callback_data: JSON.stringify({
            action: "reject",
            approvalId: n.approvalId,
          }),
        },
```

with:

```ts
        {
          text: "Reject",
          callback_data: JSON.stringify({
            action: "reject",
            approvalId: n.approvalId,
            bindingHash: n.bindingHash,
          }),
        },
```

- [ ] **Step 4: Re-run the test and verify it passes**

```bash
pnpm --filter @switchboard/core test -- telegram-notifier
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/notifications/telegram-notifier.ts \
        packages/core/src/notifications/__tests__/telegram-notifier.test.ts
git commit -m "fix(chat): include bindingHash in Telegram Reject button payload"
```

---

## Task 3: Slack notifier — add `bindingHash` to Reject button payload (new test file)

**Files:**

- Create: `packages/core/src/notifications/__tests__/slack-notifier.test.ts`
- Modify: `packages/core/src/notifications/slack-notifier.ts` (Reject button block)

- [ ] **Step 1: Create the new test file with parity coverage (failing)**

Create `packages/core/src/notifications/__tests__/slack-notifier.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackApprovalNotifier } from "../slack-notifier.js";
import type { ApprovalNotification } from "../notifier.js";

describe("SlackApprovalNotifier", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchSpy);
  });

  function makeNotification(overrides: Partial<ApprovalNotification> = {}): ApprovalNotification {
    return {
      approvalId: "appr_1",
      envelopeId: "env_1",
      summary: "Pause campaign ABC",
      explanation: "Budget exceeds limit",
      riskCategory: "medium",
      bindingHash: "hash123",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      approvers: ["U12345"],
      evidenceBundle: {},
      ...overrides,
    };
  }

  it("emits Approve and Reject button payloads that both include bindingHash", async () => {
    const notifier = new SlackApprovalNotifier("xoxb-test-token");

    await notifier.notify(makeNotification());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(options.body);

    const actionsBlock = (body.blocks as Array<{ type: string; elements?: unknown[] }>).find(
      (b) => b.type === "actions",
    );
    expect(actionsBlock).toBeDefined();
    const elements = actionsBlock!.elements as Array<{
      action_id: string;
      value: string;
    }>;
    const approveBtn = elements.find((e) => e.action_id === "approval_approve");
    const rejectBtn = elements.find((e) => e.action_id === "approval_reject");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    const approveData = JSON.parse(approveBtn!.value);
    expect(approveData).toEqual({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });

    const rejectData = JSON.parse(rejectBtn!.value);
    expect(rejectData).toEqual({
      action: "reject",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm --filter @switchboard/core test -- slack-notifier
```

Expected: FAIL — `rejectData` lacks `bindingHash`.

- [ ] **Step 3: Update Slack notifier to emit `bindingHash` on Reject button**

Edit `packages/core/src/notifications/slack-notifier.ts` — in `buildBlocks()`, locate the Reject button element and replace its `value`:

```ts
            value: JSON.stringify({
              action: "reject",
              approvalId: n.approvalId,
            }),
```

with:

```ts
            value: JSON.stringify({
              action: "reject",
              approvalId: n.approvalId,
              bindingHash: n.bindingHash,
            }),
```

- [ ] **Step 4: Re-run the test and verify it passes**

```bash
pnpm --filter @switchboard/core test -- slack-notifier
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/notifications/slack-notifier.ts \
        packages/core/src/notifications/__tests__/slack-notifier.test.ts
git commit -m "fix(chat): include bindingHash in Slack Reject button payload"
```

---

## Task 4: Strict-shape parser helper

**Files:**

- Create: `packages/core/src/channel-gateway/approval-response-payload.ts`
- Create: `packages/core/src/channel-gateway/__tests__/approval-response-payload.test.ts`

- [ ] **Step 1: Write the failing parser test file**

Create `packages/core/src/channel-gateway/__tests__/approval-response-payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseApprovalResponsePayload } from "../approval-response-payload.js";

describe("parseApprovalResponsePayload", () => {
  it("returns payload for a valid approve JSON", () => {
    const text = JSON.stringify({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });
    expect(parseApprovalResponsePayload(text)).toEqual({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });
  });

  it("returns payload for a valid reject JSON", () => {
    const text = JSON.stringify({
      action: "reject",
      approvalId: "appr_2",
      bindingHash: "hash456",
    });
    expect(parseApprovalResponsePayload(text)).toEqual({
      action: "reject",
      approvalId: "appr_2",
      bindingHash: "hash456",
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseApprovalResponsePayload("not json {")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(parseApprovalResponsePayload("hello there")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseApprovalResponsePayload("")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseApprovalResponsePayload(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseApprovalResponsePayload(undefined)).toBeNull();
  });

  it("returns null for JSON arrays", () => {
    expect(parseApprovalResponsePayload(JSON.stringify(["approve", "appr_1", "h"]))).toBeNull();
  });

  it("returns null for JSON strings", () => {
    expect(parseApprovalResponsePayload(JSON.stringify("approve"))).toBeNull();
  });

  it("returns null for JSON numbers", () => {
    expect(parseApprovalResponsePayload(JSON.stringify(42))).toBeNull();
  });

  it("returns null for JSON null", () => {
    expect(parseApprovalResponsePayload(JSON.stringify(null))).toBeNull();
  });

  it("returns null when action is missing", () => {
    const text = JSON.stringify({ approvalId: "appr_1", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null for unknown action 'deny'", () => {
    const text = JSON.stringify({ action: "deny", approvalId: "appr_1", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null for unknown action 'patch'", () => {
    const text = JSON.stringify({ action: "patch", approvalId: "appr_1", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null for unknown action 'approved'", () => {
    const text = JSON.stringify({ action: "approved", approvalId: "appr_1", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when approvalId is missing", () => {
    const text = JSON.stringify({ action: "approve", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when approvalId is empty", () => {
    const text = JSON.stringify({ action: "approve", approvalId: "", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when approvalId is not a string", () => {
    const text = JSON.stringify({ action: "approve", approvalId: 123, bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when bindingHash is missing", () => {
    const text = JSON.stringify({ action: "approve", approvalId: "appr_1" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when bindingHash is empty", () => {
    const text = JSON.stringify({ action: "approve", approvalId: "appr_1", bindingHash: "" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when bindingHash is not a string", () => {
    const text = JSON.stringify({ action: "approve", approvalId: "appr_1", bindingHash: 0 });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when an extra field is present (strict shape)", () => {
    const text = JSON.stringify({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "h",
      extra: "nope",
    });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails (module not yet defined)**

```bash
pnpm --filter @switchboard/core test -- approval-response-payload
```

Expected: FAIL — module `../approval-response-payload.js` not found.

- [ ] **Step 3: Implement the parser**

Create `packages/core/src/channel-gateway/approval-response-payload.ts`:

```ts
export type ParsedApprovalResponsePayload = {
  action: "approve" | "reject";
  approvalId: string;
  bindingHash: string;
};

const ALLOWED_KEYS = new Set(["action", "approvalId", "bindingHash"]);

export function parseApprovalResponsePayload(
  text: string | null | undefined,
): ParsedApprovalResponsePayload | null {
  if (typeof text !== "string" || text.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) return null;
  }

  const { action, approvalId, bindingHash } = obj;
  if (action !== "approve" && action !== "reject") return null;
  if (typeof approvalId !== "string" || approvalId.length === 0) return null;
  if (typeof bindingHash !== "string" || bindingHash.length === 0) return null;

  return { action, approvalId, bindingHash };
}
```

- [ ] **Step 4: Run the parser test and verify it passes**

```bash
pnpm --filter @switchboard/core test -- approval-response-payload
```

Expected: PASS — all 22 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel-gateway/approval-response-payload.ts \
        packages/core/src/channel-gateway/__tests__/approval-response-payload.test.ts
git commit -m "feat(chat): add strict-shape approval response payload parser"
```

---

## Task 5: Approval response handler

**Files:**

- Create: `packages/core/src/channel-gateway/handle-approval-response.ts`
- Create: `packages/core/src/channel-gateway/__tests__/handle-approval-response.test.ts`

- [ ] **Step 1: Write the failing handler test file**

Create `packages/core/src/channel-gateway/__tests__/handle-approval-response.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  handleApprovalResponse,
  NOT_FOUND_MSG,
  STALE_MSG,
  DASHBOARD_HANDOFF_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
} from "../handle-approval-response.js";
import type { ApprovalStore } from "../../storage/interfaces.js";
import type { ReplySink } from "../types.js";
import type { ParsedApprovalResponsePayload } from "../approval-response-payload.js";

const PAYLOAD: ParsedApprovalResponsePayload = {
  action: "approve",
  approvalId: "appr_1",
  bindingHash: "hash123",
};

function makeApproval(
  overrides: Partial<{ bindingHash: string; organizationId: string | null }> = {},
) {
  return {
    request: {
      id: "appr_1",
      bindingHash: overrides.bindingHash ?? "hash123",
    } as never,
    state: { status: "pending", version: 0 } as never,
    envelopeId: "env_1",
    organizationId: overrides.organizationId === undefined ? "org-1" : overrides.organizationId,
  };
}

function makeStore(getById: ApprovalStore["getById"]): ApprovalStore {
  return {
    save: vi.fn(),
    getById,
    updateState: vi.fn(),
    listPending: vi.fn(),
  };
}

function makeReplySink(): { sink: ReplySink; sendSpy: ReturnType<typeof vi.fn> } {
  const sendSpy = vi.fn().mockResolvedValue(undefined);
  return { sink: { send: sendSpy }, sendSpy };
}

describe("handleApprovalResponse", () => {
  it("replies NOT_FOUND_MSG when approval is missing", async () => {
    const getById = vi.fn().mockResolvedValue(null);
    const store = makeStore(getById);
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(getById).toHaveBeenCalledWith("appr_1");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("replies NOT_FOUND_MSG on org mismatch (does not leak existence)", async () => {
    const store = makeStore(
      vi.fn().mockResolvedValue(makeApproval({ organizationId: "org-other" })),
    );
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("replies NOT_FOUND_MSG when stored organizationId is null", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval({ organizationId: null })));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("replies STALE_MSG on binding-hash mismatch", async () => {
    const store = makeStore(
      vi.fn().mockResolvedValue(makeApproval({ bindingHash: "differenthash" })),
    );
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies STALE_MSG when stored bindingHash is not a non-empty string (defensive)", async () => {
    const malformed = makeApproval();
    (malformed.request as unknown as Record<string, unknown>).bindingHash = "";
    const store = makeStore(vi.fn().mockResolvedValue(malformed));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies STALE_MSG when supplied and stored hashes have different lengths (no throw)", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval({ bindingHash: "short" })));
    const { sink, sendSpy } = makeReplySink();

    await expect(
      handleApprovalResponse({
        payload: PAYLOAD, // bindingHash length 7
        organizationId: "org-1",
        approvalStore: store,
        replySink: sink,
      }),
    ).resolves.toBeUndefined();

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
  });

  it("replies DASHBOARD_HANDOFF_MSG on binding-hash match", async () => {
    const store = makeStore(vi.fn().mockResolvedValue(makeApproval()));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(DASHBOARD_HANDOFF_MSG);
  });

  it("replies APPROVAL_LOOKUP_ERROR_MSG when getById throws", async () => {
    const store = makeStore(vi.fn().mockRejectedValue(new Error("db down")));
    const { sink, sendSpy } = makeReplySink();

    await handleApprovalResponse({
      payload: PAYLOAD,
      organizationId: "org-1",
      approvalStore: store,
      replySink: sink,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(APPROVAL_LOOKUP_ERROR_MSG);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails (module not yet defined)**

```bash
pnpm --filter @switchboard/core test -- handle-approval-response
```

Expected: FAIL — module `../handle-approval-response.js` not found.

- [ ] **Step 3: Implement the handler**

Create `packages/core/src/channel-gateway/handle-approval-response.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import type { ApprovalStore } from "../storage/interfaces.js";
import type { ReplySink } from "./types.js";
import type { ParsedApprovalResponsePayload } from "./approval-response-payload.js";

export const NOT_FOUND_MSG =
  "I couldn't find this approval. It may have expired, been completed, or been replaced. Open the latest approval and try again.";

export const STALE_MSG =
  "This approval link is no longer valid. It may have expired or been replaced by a newer approval. Open the latest approval and try again.";

export const DASHBOARD_HANDOFF_MSG =
  "Approval buttons in chat are being upgraded. Please approve or reject this from the dashboard for now.";

export const APPROVAL_LOOKUP_ERROR_MSG =
  "I couldn't verify this approval right now. Please open the dashboard and try again.";

export async function handleApprovalResponse(params: {
  payload: ParsedApprovalResponsePayload;
  organizationId: string;
  approvalStore: ApprovalStore;
  replySink: ReplySink;
}): Promise<void> {
  const { payload, organizationId, approvalStore, replySink } = params;

  let approval: Awaited<ReturnType<ApprovalStore["getById"]>>;
  try {
    approval = await approvalStore.getById(payload.approvalId);
  } catch {
    await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
    return;
  }

  if (!approval) {
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  if (approval.organizationId !== organizationId) {
    await replySink.send(NOT_FOUND_MSG);
    return;
  }

  const stored = approval.request.bindingHash;
  const supplied = payload.bindingHash;

  if (typeof stored !== "string" || stored.length === 0) {
    await replySink.send(STALE_MSG);
    return;
  }

  if (stored.length !== supplied.length) {
    await replySink.send(STALE_MSG);
    return;
  }

  const matches = timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(supplied, "utf8"));
  if (!matches) {
    await replySink.send(STALE_MSG);
    return;
  }

  await replySink.send(DASHBOARD_HANDOFF_MSG);
}
```

- [ ] **Step 4: Run the handler test and verify it passes**

```bash
pnpm --filter @switchboard/core test -- handle-approval-response
```

Expected: PASS — all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel-gateway/handle-approval-response.ts \
        packages/core/src/channel-gateway/__tests__/handle-approval-response.test.ts
git commit -m "feat(chat): add gateway approval response handler with bindingHash check"
```

---

## Task 6: Add required `approvalStore` field to `ChannelGatewayConfig`

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `packages/core/src/channel-gateway/index.ts`
- Modify: `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts` (factory only — gateway tests added in Task 7)
- Modify: `packages/core/src/channel-gateway/__tests__/concurrency.test.ts` (if it instantiates `ChannelGateway`; otherwise skip)
- Modify: `packages/core/src/channel-gateway/__tests__/override-race.test.ts` (if it instantiates `ChannelGateway`; otherwise skip)

- [ ] **Step 1: Add the field to `ChannelGatewayConfig`**

Edit `packages/core/src/channel-gateway/types.ts`. Add this import near the top with the existing imports:

```ts
import type { ApprovalStore } from "../storage/interfaces.js";
```

Then in the `ChannelGatewayConfig` interface, add a new required field after the existing `contactStore?` field (or anywhere inside the interface — placement is cosmetic):

```ts
/** Read-only approval lookup for binding-hash verification of
      approval-shaped channel payloads. Required so verification
      cannot be silently skipped by misconfiguration. */
approvalStore: ApprovalStore;
```

- [ ] **Step 2: Re-export `ApprovalStore` from the channel-gateway barrel**

Edit `packages/core/src/channel-gateway/index.ts`. Add to the existing type re-export block:

```ts
export type { ApprovalStore } from "../storage/interfaces.js";
```

- [ ] **Step 3: Update the gateway test factory to inject a mock `approvalStore`**

Edit `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`. In the `createMockConfig` function, before the spread, add:

```ts
    approvalStore: {
      save: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn(),
      listPending: vi.fn(),
    },
```

So the function looks like:

```ts
function createMockConfig(overrides: Partial<ChannelGatewayConfig> = {}): ChannelGatewayConfig {
  return {
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue(createMockResolverResult()),
      resolveByDeploymentId: vi.fn().mockResolvedValue(createMockResolverResult()),
      resolveByOrgAndSlug: vi.fn().mockResolvedValue(createMockResolverResult()),
    },
    platformIngress: {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { response: "Hello from agent" },
          summary: "Responded to user",
        },
        workUnit: { id: "wu-1", traceId: "trace-1" },
      }),
    },
    approvalStore: {
      save: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn(),
      listPending: vi.fn(),
    },
    ...overrides,
  };
}
```

- [ ] **Step 4: Update any other ChannelGateway-instantiating sites (tests OR app code)**

Search wider — multiline constructor calls and app-level callers can hide outside `packages/core/src`:

```bash
grep -rln "new ChannelGateway(" . --include="*.ts" | grep -v node_modules | grep -v dist
grep -rln "ChannelGateway({" . --include="*.ts" | grep -v node_modules | grep -v dist
```

For each file listed (excluding the one updated in Step 3), open it and ensure the config passed to `new ChannelGateway(...)` contains an `approvalStore` field. If a test file uses its own factory, add the same `approvalStore` mock object as in Step 3. If a test file instantiates inline, add the field inline. If an app-level caller is found other than `apps/chat/src/gateway/gateway-bridge.ts` (which is wired in Task 8), wire `PrismaApprovalStore` from `@switchboard/db` there as well.

- [ ] **Step 5: Run typecheck and gateway tests**

```bash
pnpm --filter @switchboard/core build
pnpm --filter @switchboard/core test -- channel-gateway
pnpm typecheck
```

Expected: tests pass; typecheck reports no missing-property errors. If `apps/chat` or other consumers fail typecheck because they construct `ChannelGateway` without `approvalStore`, that is expected — Task 8 wires the production caller.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/channel-gateway/types.ts \
        packages/core/src/channel-gateway/index.ts \
        packages/core/src/channel-gateway/__tests__/
git commit -m "feat(chat): require approvalStore on ChannelGatewayConfig"
```

---

## Task 7: Wire interception into `ChannelGateway.handleIncoming`

**Files:**

- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`
- Modify: `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts` (add approval-branch test cases)

- [ ] **Step 1: Add the failing gateway-behavior test cases**

Edit `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`. At the top, ensure these imports exist (add what's missing):

```ts
import {
  NOT_FOUND_MSG,
  STALE_MSG,
  DASHBOARD_HANDOFF_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
} from "../handle-approval-response.js";
```

Then append a new `describe` block to the file (before the closing `});` of the outer `describe("ChannelGateway", ...)`):

```ts
describe("ChannelGateway approval-payload interception", () => {
  const APPROVAL_TEXT = JSON.stringify({
    action: "approve",
    approvalId: "appr_1",
    bindingHash: "hash123",
  });

  function makeMessage(): IncomingChannelMessage {
    return {
      channel: "whatsapp",
      token: "sw_test",
      sessionId: "sess-1",
      text: APPROVAL_TEXT,
    };
  }

  function makeApprovalRecord(
    overrides: Partial<{ bindingHash: string; organizationId: string | null }> = {},
  ) {
    return {
      request: {
        id: "appr_1",
        bindingHash: overrides.bindingHash ?? "hash123",
      } as never,
      state: { status: "pending", version: 0 } as never,
      envelopeId: "env_1",
      organizationId: overrides.organizationId === undefined ? "org-1" : overrides.organizationId,
    };
  }
  // (Same shape as makeApproval() in handle-approval-response.test.ts —
  // single-write override for bindingHash and organizationId, no
  // post-spread rewrites.)

  it("does not call platformIngress.submit, conversationStore.addMessage, or onTyping for any approval branch (not-found)", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const onTyping = vi.fn();
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn(),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn(),
        listPending: vi.fn(),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy, onTyping });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
    expect(onTyping).not.toHaveBeenCalled();
  });

  it("replies NOT_FOUND_MSG on org mismatch", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn(),
        getById: vi.fn().mockResolvedValue(makeApprovalRecord({ organizationId: "org-other" })),
        updateState: vi.fn(),
        listPending: vi.fn(),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("replies STALE_MSG on hash mismatch", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn(),
        getById: vi.fn().mockResolvedValue(makeApprovalRecord({ bindingHash: "differenthash1" })),
        updateState: vi.fn(),
        listPending: vi.fn(),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(STALE_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("replies DASHBOARD_HANDOFF_MSG on hash match", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn(),
        getById: vi.fn().mockResolvedValue(makeApprovalRecord()),
        updateState: vi.fn(),
        listPending: vi.fn(),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(DASHBOARD_HANDOFF_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("replies APPROVAL_LOOKUP_ERROR_MSG and does not fall through to chat when store throws", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn(),
        getById: vi.fn().mockRejectedValue(new Error("db down")),
        updateState: vi.fn(),
        listPending: vi.fn(),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(makeMessage(), { send: sendSpy });

    expect(sendSpy).toHaveBeenCalledWith(APPROVAL_LOOKUP_ERROR_MSG);
    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("propagates replySink.send error and does not fall through to chat", async () => {
    const submit = vi.fn();
    const addMessage = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn(),
        getById: vi.fn().mockResolvedValue(null),
        updateState: vi.fn(),
        listPending: vi.fn(),
      },
    });

    const gateway = new ChannelGateway(config);
    await expect(
      gateway.handleIncoming(makeMessage(), {
        send: vi.fn().mockRejectedValue(new Error("network down")),
      }),
    ).rejects.toThrow("network down");

    expect(submit).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("does not invoke approval interception for non-approval text (regression)", async () => {
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        outcome: "completed",
        outputs: { response: "Hello there" },
        summary: "Responded",
      },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    });
    const addMessage = vi.fn();
    const getById = vi.fn();
    const config = createMockConfig({
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
        addMessage,
      },
      platformIngress: { submit },
      approvalStore: {
        save: vi.fn(),
        getById,
        updateState: vi.fn(),
        listPending: vi.fn(),
      },
    });

    const gateway = new ChannelGateway(config);
    await gateway.handleIncoming(
      { channel: "whatsapp", token: "sw_test", sessionId: "sess-1", text: "hello" },
      { send: sendSpy },
    );

    expect(getById).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalled(); // existing inbound persistence path runs
    expect(sendSpy).toHaveBeenCalledWith("Hello there");
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

```bash
pnpm --filter @switchboard/core test -- channel-gateway
```

Expected: FAIL — the approval-branch tests fail because `handleIncoming` doesn't intercept yet (it submits the JSON text as a normal message). The "does not invoke approval interception for non-approval text" test should already pass because the current code never touches `approvalStore`.

- [ ] **Step 3: Wire interception into `handleIncoming`**

Edit `packages/core/src/channel-gateway/channel-gateway.ts`. Add the two new imports near the top of the file:

```ts
import { parseApprovalResponsePayload } from "./approval-response-payload.js";
import { handleApprovalResponse } from "./handle-approval-response.js";
```

Then in `handleIncoming`, after the existing `// 3b. Check for human override` block (which ends with the `if (status === "human_override") return;`) and **before** the `// 3c. Resolve contact identity` block, add:

```ts
// 3b-2. Intercept approval-shaped payloads. Once parsed, the branch is
// terminal: no onTyping, no inbound persistence, no submit, no LLM.
const approvalPayload = parseApprovalResponsePayload(message.text);
if (approvalPayload) {
  await handleApprovalResponse({
    payload: approvalPayload,
    organizationId: resolved.organizationId,
    approvalStore: this.config.approvalStore,
    replySink,
  });
  return;
}
```

- [ ] **Step 4: Re-run tests and verify all pass**

```bash
pnpm --filter @switchboard/core build
pnpm --filter @switchboard/core test -- channel-gateway
```

Expected: PASS — all approval-branch cases plus the regression test.

- [ ] **Step 5: Run the full core test suite to catch any cross-test fallout**

```bash
pnpm --filter @switchboard/core test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/channel-gateway/channel-gateway.ts \
        packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts
git commit -m "feat(chat): intercept approval payloads at gateway, terminal branch"
```

---

## Task 8: Wire `PrismaApprovalStore` into `apps/chat` gateway-bridge

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`

- [ ] **Step 1: Verify the build break that confirms the wiring is needed**

```bash
pnpm --filter chat typecheck
```

Expected: FAIL — `apps/chat/src/gateway/gateway-bridge.ts` constructs `new ChannelGateway({...})` without `approvalStore`, which is now required.

- [ ] **Step 2: Import `PrismaApprovalStore` and pass it to the constructor**

Edit `apps/chat/src/gateway/gateway-bridge.ts`. Find the existing import line for `@switchboard/db`:

```ts
import {
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaContactStore,
} from "@switchboard/db";
```

Add `PrismaApprovalStore` to that named-import list:

```ts
import {
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaContactStore,
  PrismaApprovalStore,
} from "@switchboard/db";
```

Then locate the `return new ChannelGateway({...})` call and add the new field:

```ts
return new ChannelGateway({
  deploymentResolver,
  platformIngress,
  conversationStore: new PrismaGatewayConversationStore(prisma),
  contactStore: new PrismaContactStore(prisma),
  approvalStore: new PrismaApprovalStore(prisma),
  onMessageRecorded: (info) => {
    taskRecorder.recordMessage(info);
    lifecycleTracker.recordMessage({
      sessionKey: `${info.deploymentId}:${info.channel}:${info.sessionId}`,
      deploymentId: info.deploymentId,
      organizationId: info.organizationId,
      channelType: info.channel,
      sessionId: info.sessionId,
      role: info.role,
      content: info.content,
    });
  },
});
```

- [ ] **Step 3: Re-run typecheck and chat tests**

```bash
pnpm --filter chat typecheck
pnpm --filter chat test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts
git commit -m "feat(chat): wire PrismaApprovalStore into ChannelGateway"
```

---

## Task 9: Audit doc — record follow-up identity-binding slice

**Files:**

- Modify: `.audit/08-launch-blocker-sequence.md`

- [ ] **Step 1: Locate Risk #4 and append the follow-up entry below it**

Edit `.audit/08-launch-blocker-sequence.md`. After the closing `---` of Risk #4 ("Chat approval binding hash not verified (asymmetry)") and before the section heading for Risk #5 ("Rate limits not per-endpoint"), insert:

```markdown
### 4a. **Follow-up: Chat Approval Response Identity Binding** _(deferred from Risk 4)_

**Goal:** Enable deterministic approve/reject execution from chat without bypassing responder authorization.

**Required before enabling chat approval execution:**

- Resolve inbound chat sender to Contact.
- Map Contact to authorized responder principal.
- Pass `respondedBy` into the same responder authorization path used by API approvals.
- Share approval response execution helper between API and chat.
- Preserve terminal approval-payload branch: no LLM, no `PlatformIngress.submit`, no normal chat persistence.
- Add lifecycle mutation tests for approve/reject from chat.
- Do not introduce `skipResponderAuth` or channel-possession-only authorization.

**Effort:** M (chat identity → contact → principal → authorization → lifecycle mutation).

**Dependencies:** Risk 4 must ship first (this slice extends the gateway terminal branch into a deterministic lifecycle call once a verified principal exists).

**Branch slug:** `feat/chat-approval-response-identity-binding`

**Acceptance:** Chat approve/reject buttons mutate approval lifecycle state via the same authorization path as the API. Hash match no longer returns the dashboard-handoff message; it executes the approval. No `skipResponderAuth` flag exists in the codebase.

---
```

- [ ] **Step 2: Commit**

```bash
git add .audit/08-launch-blocker-sequence.md
git commit -m "docs(audit): record chat approval identity-binding follow-up"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full build + typecheck + tests**

```bash
pnpm reset
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Expected: all green.

- [ ] **Step 2: Verify the spec invariant holds end-to-end (manual scan)**

```bash
grep -rn "platformIngress.submit\|approvalStore" packages/core/src/channel-gateway/channel-gateway.ts
```

Expected: the approval-payload branch returns before any `submit` call. Visually confirm the flow matches the spec architecture diagram: parser → handler → reply → return.

- [ ] **Step 3: Confirm branch context and push**

```bash
git branch --show-current
git status --short
git log --oneline main..HEAD
```

Expected: on `fix/launch-chat-binding-hash-verification`, no unstaged changes, ~6 commits visible (one per Task 1-9).

```bash
git push -u origin fix/launch-chat-binding-hash-verification
```

- [ ] **Step 4: Open PR**

```bash
gh pr create \
  --base main \
  --title "Block chat approval payloads from conversational ingress" \
  --body "$(cat <<'EOF'
## Summary

- Intercept approval-shaped payloads (`{action,approvalId,bindingHash}`) at `ChannelGateway` so they never reach `PlatformIngress.submit()` or the LLM.
- Add strict-shape parser, terminal-branch handler, and required `approvalStore` dependency on `ChannelGatewayConfig`.
- Fix WhatsApp/Telegram/Slack notifier Reject buttons to include `bindingHash` for parity with Approve.

This slice does not execute approvals from chat. Lifecycle mutation is deferred to the follow-up identity-binding slice (recorded in `.audit/08-launch-blocker-sequence.md` §4a).

Closes Risk #4 from `.audit/08-launch-blocker-sequence.md`.
Spec: `docs/superpowers/specs/2026-04-29-fix-launch-chat-binding-hash-verification-design.md`
Plan: `docs/superpowers/plans/2026-04-29-fix-launch-chat-binding-hash-verification.md`

## Test plan

- [ ] `pnpm --filter @switchboard/core test -- channel-gateway` (interception + regression)
- [ ] `pnpm --filter @switchboard/core test -- approval-response-payload` (parser strictness)
- [ ] `pnpm --filter @switchboard/core test -- handle-approval-response` (handler outcomes)
- [ ] `pnpm --filter chat test -- whatsapp-notifier` (WhatsApp Reject parity — test lives in apps/chat)
- [ ] `pnpm --filter @switchboard/core test -- telegram-notifier` (Telegram Reject parity)
- [ ] `pnpm --filter @switchboard/core test -- slack-notifier` (Slack Reject parity)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean
EOF
)"
```

---

## Self-review

**Spec coverage:** spot-checked each spec section against tasks:

- _Strict-shape parser, all 22 cases_ → Task 4.
- _Handler with 5 reply outcomes + length-mismatch guard_ → Task 5.
- _Required `approvalStore` on `ChannelGatewayConfig`_ → Task 6.
- _`handleIncoming` interception placement (after pause, before contact identity)_ → Task 7 Step 3.
- _Gateway terminal-branch invariant tests across all 5 outcome cases + reply-throw + non-approval regression + onTyping not called_ → Task 7 Step 1.
- _`PrismaApprovalStore` wired in `apps/chat/src/gateway/gateway-bridge.ts`_ → Task 8.
- _WhatsApp/Telegram/Slack Reject button bindingHash parity (3 emitters, 3 tests)_ → Tasks 1, 2, 3.
- _Audit follow-up entry_ → Task 9.
- _Final lint/typecheck/build_ → Task 10.

**Placeholder scan:** none — all tasks have exact code blocks, file paths, commands, and expected outputs.

**Type/name consistency:**

- `parseApprovalResponsePayload` (Task 4) ↔ same name in Task 5 import ↔ same in Task 7 import. ✅
- `handleApprovalResponse` ↔ `handleApprovalResponse` import in Task 7 Step 3. ✅
- `ParsedApprovalResponsePayload` ↔ same import in Task 5. ✅
- Constants `NOT_FOUND_MSG`, `STALE_MSG`, `DASHBOARD_HANDOFF_MSG`, `APPROVAL_LOOKUP_ERROR_MSG` defined in Task 5 Step 3, imported by Task 7 Step 1 from `../handle-approval-response.js`. ✅
- `ApprovalStore` from `../storage/interfaces.js` consistently imported. ✅
- `approvalStore` field name consistent on `ChannelGatewayConfig`, in tests, and in `gateway-bridge.ts`. ✅

No issues found.
