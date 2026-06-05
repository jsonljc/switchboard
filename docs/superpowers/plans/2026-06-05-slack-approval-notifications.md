# Slack Approval Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real parked approval produces a Slack message whose Approve/Reject buttons drive the already-shipped respond bridge, closing the outbound half of the operator loop.

**Architecture:** An optional `ApprovalNotifier` port on `PlatformIngressConfig` fires at park time (after `createGatedLifecycle`), best-effort. The existing `SlackApprovalNotifier` is hardened (deterministic env-configured target, logged-not-thrown delivery failure, buttons only with a non-empty bindingHash). The tap identity seam is fixed by surfacing the stable channel user id (`principalId`) through `IncomingChannelMessage` so Slack taps bind on `U...` ids as the binding doctrine requires. The API bootstrap injects the notifier when `SLACK_BOT_TOKEN` + `SLACK_APPROVAL_CHANNEL` are both set.

**Tech Stack:** TypeScript ESM (`.js` relative imports), vitest, fastify inject, in-memory lifecycle/storage worlds, Slack `chat.postMessage` Block Kit.

**Spec:** `docs/superpowers/specs/2026-06-05-slack-approval-notifications-design.md`

---

## Conventions (apply to every task)

- Worktree: `.claude/worktrees/slack-approval-notifications`, branches off `origin/main`.
- Before EVERY commit: `git branch --show-current` and `git status --short`.
- Full green gate before every push, from the REPO ROOT:
  `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm arch:check`.
  Known flakes (rerun isolated once before investigating): chat gateway-bridge-attribution, pg_advisory suites, api bootstrap-smoke, api-auth prod-hardening.
- Commitlint: lowercase subject first word; body lines <= 100 chars (use `git commit -F`).
- No em-dashes anywhere (code comments, copy, commit messages, PR bodies).
- After each parent PR squash-merges: `git fetch origin && git rebase --onto origin/main <parent-head-sha> <branch>` for the next branch, re-run the full gate.
- After each merge: confirm ancestry with `git fetch origin && git merge-base --is-ancestor <squash-sha> origin/main`.
- PR train (sequential, file-disjoint): PR-0 docs, PR-1 core notifier + park hook, PR-2 identity seam, PR-3 e2e proof, PR-4 api wiring (ACTIVATING, last, carries the pre-flip checklist).

## File map

| PR   | Files                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-0 | `docs/superpowers/specs/2026-06-05-slack-approval-notifications-design.md`, `docs/superpowers/plans/2026-06-05-slack-approval-notifications.md`                                                                                                                                                                                                                                                                                                 |
| PR-1 | `packages/core/src/notifications/slack-notifier.ts`, `packages/core/src/notifications/index.ts`, `packages/core/src/notifications/__tests__/slack-notifier.test.ts`, `packages/core/src/platform/platform-ingress.ts`, `packages/core/src/platform/__tests__/platform-ingress-approval-notify.test.ts` (new)                                                                                                                                    |
| PR-2 | `packages/core/src/channel-gateway/types.ts`, `packages/core/src/channel-gateway/channel-gateway.ts`, `packages/core/src/channel-gateway/index.ts` (export the parser), `packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts`, `apps/chat/src/routes/slack-form-parser.ts` (new), `apps/chat/src/routes/managed-webhook.ts`, `apps/chat/src/main.ts`, `apps/chat/src/__tests__/managed-webhook-identity.test.ts` (new) |
| PR-3 | `apps/api/src/__tests__/recommendation-handoff-harness.ts`, `apps/api/src/__tests__/recommendation-handoff-lifecycle-world.ts`, `apps/api/src/__tests__/slack-approval-notify-loop.test.ts` (new)                                                                                                                                                                                                                                               |
| PR-4 | `apps/api/src/bootstrap/approval-notifier.ts` (new), `apps/api/src/bootstrap/__tests__/approval-notifier.test.ts` (new), `apps/api/src/app.ts`, `.env.example`, `scripts/env-allowlist.local-readiness.json`                                                                                                                                                                                                                                    |

No file appears in two PRs. PR-2 is compile-independent of PR-1. PR-3 depends on PR-1 (port + notifier options) AND PR-2 (the parser barrel export). PR-4 depends on PR-1.

---

## Task 0: Land the docs PR (spec + this plan)

- [ ] **Step 0.1:** On branch `docs/slack-approval-notifications-spec` (already carries the spec commit), commit this plan:

```bash
git branch --show-current   # expect docs/slack-approval-notifications-spec
git add docs/superpowers/plans/2026-06-05-slack-approval-notifications.md
git commit -m "docs(plans): slack approval notifications implementation plan"
```

- [ ] **Step 0.2:** Push, open the docs-only PR against main, enable auto-merge (squash), confirm merge + ancestry:

```bash
git push -u origin docs/slack-approval-notifications-spec
gh pr create --title "docs: slack approval notifications spec + plan" --body-file <tmpfile>
gh pr merge --squash --auto
```

---

## PR-1: core notifier hardening + park hook (branch `feat/slack-approval-notify-core` off origin/main)

### Task 1: SlackApprovalNotifier hardening

**Files:**

- Modify: `packages/core/src/notifications/slack-notifier.ts`
- Modify: `packages/core/src/notifications/index.ts` (export the options type)
- Test: `packages/core/src/notifications/__tests__/slack-notifier.test.ts`

- [ ] **Step 1.1: Write the failing tests** (append to the existing describe block; add the parser import at top):

```ts
import { parseApprovalResponsePayload } from "../../channel-gateway/approval-response-payload.js";
```

```ts
it("button values round-trip through the REAL approval-response parser", async () => {
  const notifier = new SlackApprovalNotifier("xoxb-test-token");
  await notifier.notify(makeNotification());

  const [, options] = fetchSpy.mock.calls[0]!;
  const body = JSON.parse(options.body);
  const actionsBlock = (body.blocks as Array<{ type: string; elements?: unknown[] }>).find(
    (b) => b.type === "actions",
  )!;
  const elements = actionsBlock.elements as Array<{ action_id: string; value: string }>;

  for (const [actionId, action] of [
    ["approval_approve", "approve"],
    ["approval_reject", "reject"],
  ] as const) {
    const btn = elements.find((e) => e.action_id === actionId)!;
    const parsed = parseApprovalResponsePayload(btn.value);
    expect(parsed).toEqual({ action, approvalId: "appr_1", bindingHash: "hash123" });
  }

  // Mutation proof: the parser genuinely rejects malformed values, so the
  // round-trip assertion above can fail. An extra key must parse to null.
  const approve = elements.find((e) => e.action_id === "approval_approve")!;
  const mutated = JSON.stringify({ ...JSON.parse(approve.value), extra: "x" });
  expect(parseApprovalResponsePayload(mutated)).toBeNull();
});

it("posts to defaultConversationId when configured, ignoring approvers", async () => {
  const notifier = new SlackApprovalNotifier("xoxb-test-token", {
    defaultConversationId: "C_OPS",
  });
  await notifier.notify(makeNotification({ approvers: ["U1", "U2"] }));

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [, options] = fetchSpy.mock.calls[0]!;
  expect(JSON.parse(options.body).channel).toBe("C_OPS");
});

it("does not post when approvers is empty and no default conversation is set", async () => {
  const notifier = new SlackApprovalNotifier("xoxb-test-token");
  await notifier.notify(makeNotification({ approvers: [] }));
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("logs approvalId AND target and resolves on HTTP failure (best-effort, never thrown)", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  const notifier = new SlackApprovalNotifier("xoxb-test-token");

  await expect(notifier.notify(makeNotification())).resolves.toBeUndefined();
  expect(errorSpy).toHaveBeenCalledWith(
    expect.stringContaining("approvalId=appr_1"),
    expect.anything(),
  );
  expect(errorSpy).toHaveBeenCalledWith(
    expect.stringContaining("target=U12345"),
    expect.anything(),
  );
});

it("logs and resolves on a Slack ok:false envelope (HTTP 200)", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchSpy.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: false, error: "channel_not_found" }),
  });
  const notifier = new SlackApprovalNotifier("xoxb-test-token", {
    defaultConversationId: "C_OPS",
  });

  await expect(notifier.notify(makeNotification())).resolves.toBeUndefined();
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("target=C_OPS"), expect.anything());
});

it("renders no action buttons when bindingHash is empty, with the Inbox cue (alert-only)", async () => {
  const notifier = new SlackApprovalNotifier("xoxb-test-token");
  await notifier.notify(makeNotification({ bindingHash: "" }));

  const [, options] = fetchSpy.mock.calls[0]!;
  const body = JSON.parse(options.body);
  const actionsBlock = (body.blocks as Array<{ type: string }>).find((b) => b.type === "actions");
  expect(actionsBlock).toBeUndefined();
  expect(JSON.stringify(body.blocks)).toContain(
    "This approval cannot be actioned from Slack. Open the Inbox to review.",
  );
});

it("renders expiry in hours at or above 3 hours, minutes below", async () => {
  const notifier = new SlackApprovalNotifier("xoxb-test-token");

  await notifier.notify(
    makeNotification({ expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
  );
  let body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
  expect(JSON.stringify(body.blocks)).toContain("24 hours");

  fetchSpy.mockClear();
  await notifier.notify(makeNotification({ expiresAt: new Date(Date.now() + 30 * 60 * 1000) }));
  body = JSON.parse(fetchSpy.mock.calls[0]![1].body);
  expect(JSON.stringify(body.blocks)).toContain("30 minutes");
});
```

The existing fetch stub resolves `{ ok: true, json: async () => ({ ok: true }) }`; add `status: 200` to it so the hardened postMessage accepts it.

- [ ] **Step 1.2:** Run: `pnpm --filter @switchboard/core test -- slack-notifier` and verify the new tests FAIL (no options param, silent failures, buttons always rendered).

- [ ] **Step 1.3: Implement.** Replace `slack-notifier.ts` content with:

```ts
import type { ApprovalNotifier, ApprovalNotification } from "./notifier.js";

export interface SlackNotifierOptions {
  /**
   * The conversation (channel id C... or user id U... for a DM) that approval
   * messages post to. When set it is the ONLY target and notification.approvers
   * is ignored for targeting. When unset, legacy behavior posts to each
   * approvers entry as a Slack conversation id.
   */
  defaultConversationId?: string;
}

export class SlackApprovalNotifier implements ApprovalNotifier {
  private token: string;
  private defaultConversationId: string | undefined;

  constructor(botToken: string, options: SlackNotifierOptions = {}) {
    this.token = botToken;
    this.defaultConversationId = options.defaultConversationId;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const targets = this.defaultConversationId
      ? [this.defaultConversationId]
      : notification.approvers;
    if (targets.length === 0) return;

    const blocks = this.buildBlocks(notification);

    const results = await Promise.allSettled(
      targets.map((conversation) => this.postMessage(conversation, blocks)),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        // Logged, never thrown: a notification is best-effort delivery of an
        // invitation to act (spec section 6). The lifecycle and the dashboard
        // Inbox remain canonical. The target is an operational identifier
        // (debugging aid); never log bindingHash or message content.
        console.error(
          `[SlackApprovalNotifier] send failed (approvalId=${notification.approvalId}, target=${targets[i]})`,
          result.reason,
        );
      }
    });
  }

  private buildBlocks(n: ApprovalNotification): unknown[] {
    const riskEmoji = this.riskEmoji(n.riskCategory);

    const blocks: unknown[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `${riskEmoji} Approval Required`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Risk:*\n${n.riskCategory.toUpperCase()}` },
          { type: "mrkdwn", text: `*Expires in:*\n${this.formatExpiry(n.expiresAt)}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:* ${n.summary}\n*Reason:* ${n.explanation}` },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Envelope: \`${n.envelopeId}\`` }],
      },
    ];

    // Buttons only when actionable: an empty bindingHash (the escalation-handoff
    // shape) cannot form a payload parseApprovalResponsePayload accepts, so render
    // alert-only (with an Inbox cue) instead of buttons whose taps would fall
    // through as raw JSON text.
    if (n.bindingHash.length > 0) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve", emoji: true },
            style: "primary",
            action_id: "approval_approve",
            value: JSON.stringify({
              action: "approve",
              approvalId: n.approvalId,
              bindingHash: n.bindingHash,
            }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Reject", emoji: true },
            style: "danger",
            action_id: "approval_reject",
            value: JSON.stringify({
              action: "reject",
              approvalId: n.approvalId,
              bindingHash: n.bindingHash,
            }),
          },
        ],
      });
    } else {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "This approval cannot be actioned from Slack. Open the Inbox to review.",
          },
        ],
      });
    }

    return blocks;
  }

  private formatExpiry(expiresAt: Date): string {
    const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60000);
    if (minutes >= 180) return `${Math.round(minutes / 60)} hours`;
    return `${minutes} minutes`;
  }

  private riskEmoji(category: string): string {
    switch (category) {
      case "critical":
        return "\u{1F6A8}";
      case "high":
        return "\u{1F534}";
      case "medium":
        return "\u{1F7E1}";
      case "low":
        return "\u{1F7E2}";
      default:
        return "\u{2139}\u{FE0F}";
    }
  }

  private async postMessage(channel: string, blocks: unknown[]): Promise<void> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        channel,
        text: "Approval Required",
        blocks,
      }),
    });
    if (!response.ok) {
      throw new Error(`Slack HTTP error ${response.status}`);
    }
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error ?? "unknown"}`);
    }
  }
}
```

In `packages/core/src/notifications/index.ts`, extend the Slack export line:

```ts
export { SlackApprovalNotifier } from "./slack-notifier.js";
export type { SlackNotifierOptions } from "./slack-notifier.js";
```

- [ ] **Step 1.4:** Run: `pnpm --filter @switchboard/core test -- slack-notifier`. Expected: all PASS (including the pre-existing bindingHash test).

- [ ] **Step 1.5:** Commit:

```bash
git add packages/core/src/notifications/slack-notifier.ts packages/core/src/notifications/index.ts packages/core/src/notifications/__tests__/slack-notifier.test.ts
git commit -m "feat(core): harden SlackApprovalNotifier for parked-approval duty"
```

### Task 2: PlatformIngress park hook

**Files:**

- Modify: `packages/core/src/platform/platform-ingress.ts` (config field + step 6 fire)
- Test: `packages/core/src/platform/__tests__/platform-ingress-approval-notify.test.ts` (new)

- [ ] **Step 2.1: Write the failing test file** (mirrors the focused-suite pattern of `platform-ingress-entitlement.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import { IntentRegistry } from "../intent-registry.js";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import { ApprovalLifecycleService } from "../../approval/lifecycle-service.js";
import { InMemoryLifecycleStore } from "../../approval/in-memory-lifecycle-store.js";
import type { ApprovalNotifier } from "../../notifications/notifier.js";
import type { GovernanceDecision } from "../governance-types.js";
import type { CanonicalSubmitRequest } from "../canonical-request.js";

const CONSTRAINTS = {
  allowedModelTiers: ["default"],
  maxToolCalls: 5,
  maxLlmTurns: 3,
  maxTotalTokens: 4000,
  maxRuntimeMs: 30000,
  maxWritesPerExecution: 2,
  trustLevel: "guided",
} as const;

function requireApprovalDecision(): GovernanceDecision {
  return {
    outcome: "require_approval",
    riskScore: 0.5,
    approvalLevel: "operator",
    approvers: [],
    constraints: { ...CONSTRAINTS, allowedModelTiers: ["default"] },
    matchedPolicies: ["policy.requires-approval"],
  };
}

function executeDecision(): GovernanceDecision {
  return {
    outcome: "execute",
    riskScore: 0,
    budgetProfile: "standard",
    constraints: { ...CONSTRAINTS, allowedModelTiers: ["default"] },
    matchedPolicies: [],
  };
}

function denyDecision(): GovernanceDecision {
  return { outcome: "deny", reasonCode: "BLOCKED", riskScore: 1, matchedPolicies: [] };
}

function makeRequest(): CanonicalSubmitRequest {
  return {
    organizationId: "org_test",
    actor: { id: "system", type: "system" },
    intent: "noop.intent",
    parameters: { a: 1 },
    trigger: "api",
    surface: { surface: "api" },
  };
}

function buildIngress(opts: {
  decision: GovernanceDecision;
  notifier?: ApprovalNotifier;
  withLifecycle?: boolean;
}): PlatformIngress {
  const intentRegistry = new IntentRegistry();
  intentRegistry.register({
    intent: "noop.intent",
    allowedTriggers: ["api"],
    defaultMode: "skill",
    allowedModes: ["skill"],
    executor: { mode: "skill", skillSlug: "noop" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "none",
    idempotent: false,
    timeoutMs: 30000,
    retryable: false,
  });

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register({
    name: "skill",
    execute: vi.fn().mockResolvedValue({
      workUnitId: "wu_1",
      outcome: "completed" as const,
      summary: "ok",
      outputs: {},
      mode: "skill",
      durationMs: 1,
      traceId: "tr_1",
    }),
  });

  return new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: { evaluate: async () => opts.decision },
    deploymentResolver: {
      resolve: async () =>
        ({
          deploymentId: "dep_1",
          organizationId: "org_test",
          agentRosterId: "agent_1",
          skillSlug: "noop",
          agentRole: "responder",
          status: "active",
        }) as never,
    },
    lifecycleService:
      opts.withLifecycle === false
        ? undefined
        : new ApprovalLifecycleService({ store: new InMemoryLifecycleStore() }),
    approvalNotifier: opts.notifier,
  });
}

describe("PlatformIngress park-time approval notification", () => {
  it("fires exactly one notification carrying the lifecycle id and current bindingHash", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ingress = buildIngress({ decision: requireApprovalDecision(), notifier: { notify } });

    const res = await ingress.submit(makeRequest());

    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(notify).toHaveBeenCalledTimes(1);
    const notification = notify.mock.calls[0]![0];
    expect(notification.approvalId).toBe(res.lifecycleId);
    expect(notification.bindingHash).toBe(res.bindingHash);
    expect(notification.envelopeId).toBe(res.workUnit.id);
    // Substring assertions: the summary shape is pilot copy, not a contract.
    expect(notification.summary).toContain("noop.intent");
    expect(notification.summary).toContain("system");
    expect(notification.riskCategory).toBe("medium");
    expect(notification.explanation).toContain("operator");
    expect(notification.expiresAt).toBeInstanceOf(Date);
    expect(notification.approvers).toEqual([]);
  });

  it("falls back to the decision's approvers when routing config has none", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const decision = requireApprovalDecision();
    if (decision.outcome !== "require_approval") throw new Error("unreachable");
    decision.approvers = ["principal-1"];
    const ingress = buildIngress({ decision, notifier: { notify } });

    await ingress.submit(makeRequest());

    expect(notify.mock.calls[0]![0].approvers).toEqual(["principal-1"]);
  });

  it("normalizes an unknown riskCategory on the decision to medium", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const decision = requireApprovalDecision() as GovernanceDecision & Record<string, unknown>;
    decision["riskCategory"] = "banana";
    const ingress = buildIngress({ decision, notifier: { notify } });

    await ingress.submit(makeRequest());

    expect(notify.mock.calls[0]![0].riskCategory).toBe("medium");
  });

  it("passes a known riskCategory through", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const decision = requireApprovalDecision() as GovernanceDecision & Record<string, unknown>;
    decision["riskCategory"] = "high";
    const ingress = buildIngress({ decision, notifier: { notify } });

    await ingress.submit(makeRequest());

    expect(notify.mock.calls[0]![0].riskCategory).toBe("high");
  });

  it("does not notify on an execute outcome", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ingress = buildIngress({ decision: executeDecision(), notifier: { notify } });
    await ingress.submit(makeRequest());
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify on a deny outcome", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ingress = buildIngress({ decision: denyDecision(), notifier: { notify } });
    await ingress.submit(makeRequest());
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify on the legacy no-lifecycle park (nothing a tap could act on)", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const ingress = buildIngress({
      decision: requireApprovalDecision(),
      notifier: { notify },
      withLifecycle: false,
    });
    const res = await ingress.submit(makeRequest());
    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(notify).not.toHaveBeenCalled();
  });

  it("parks identically when no notifier is configured", async () => {
    const ingress = buildIngress({ decision: requireApprovalDecision() });
    const res = await ingress.submit(makeRequest());
    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(res.lifecycleId).toBeDefined();
    expect(res.bindingHash).toBeDefined();
  });

  it("a rejecting notifier is logged and never breaks the park", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notify = vi.fn().mockRejectedValue(new Error("slack down"));
    const ingress = buildIngress({ decision: requireApprovalDecision(), notifier: { notify } });

    const res = await ingress.submit(makeRequest());

    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(res.lifecycleId).toBeDefined();
    // The fire is intentionally not awaited by submit; wait for the catch leg.
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "[PlatformIngress] approval notification failed",
        expect.anything(),
      );
    });
  });

  it("a synchronously-throwing notifier is logged and never breaks the park", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifier: ApprovalNotifier = {
      notify: () => {
        throw new Error("sync explosion");
      },
    };
    const ingress = buildIngress({ decision: requireApprovalDecision(), notifier });

    const res = await ingress.submit(makeRequest());

    if (!res.ok || !("approvalRequired" in res)) throw new Error("expected a parked response");
    expect(res.lifecycleId).toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "[PlatformIngress] approval notification failed",
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2.2:** Run: `pnpm --filter @switchboard/core test -- platform-ingress-approval-notify`. Expected: FAIL (`approvalNotifier` is not a config field; typecheck error or unused option).

- [ ] **Step 2.3: Implement.** In `platform-ingress.ts`:

(a) add the type import after the OperatorAlerter import:

```ts
import type { ApprovalNotifier, ApprovalNotification } from "../notifications/notifier.js";
```

(b) add to `PlatformIngressConfig` after `operatorAlerter?`:

```ts
  /**
   * Optional best-effort notifier fired when a submission parks as a gated
   * lifecycle (require_approval with a lifecycleService). Failures are logged
   * and never affect the park; the dashboard Inbox remains canonical (spec:
   * 2026-06-05-slack-approval-notifications-design.md section 2).
   */
  approvalNotifier?: ApprovalNotifier;
```

(c) add a module-level normalizer next to `jitteredDelayMs` (top of file, after the
delay helpers):

```ts
/**
 * The notification surface renders four known risk categories; anything else
 * (including absent) is schema drift and falls back to "medium" explicitly
 * rather than leaking free-form strings into operator copy.
 */
function normalizeRiskCategory(value: unknown): string {
  return value === "critical" || value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}
```

(d) in step 6, between the `const { lifecycle, revision } = await ...createGatedLifecycle(...)` call and the `return`, insert:

```ts
if (this.config.approvalNotifier) {
  const notification: ApprovalNotification = {
    approvalId: lifecycle.id,
    envelopeId: workUnit.id,
    summary: `${workUnit.intent} (requested by ${workUnit.actor.id})`,
    riskCategory: normalizeRiskCategory((decision as Record<string, unknown>)["riskCategory"]),
    explanation: `Approval level: ${decision.approvalLevel}. Policies: ${
      decision.matchedPolicies.join(", ") || "default"
    }.`,
    bindingHash: revision.bindingHash,
    expiresAt,
    // Routing config wins (it is what the scope snapshot enforces); the
    // governance decision's approvers inform when routing is silent.
    // Informational in the pilot: Slack targeting never reads this field.
    approvers:
      routingConfig.defaultApprovers.length > 0
        ? routingConfig.defaultApprovers
        : decision.approvers,
    evidenceBundle: { intent: workUnit.intent, organizationId: workUnit.organizationId },
  };
  // Fire-and-forget with logged failure (the propose-pipeline precedent).
  // try/catch guards a synchronously-throwing notifier; .catch guards the
  // async leg. Neither can fail the park.
  try {
    this.config.approvalNotifier.notify(notification).catch((err) => {
      console.error("[PlatformIngress] approval notification failed", err);
    });
  } catch (err) {
    console.error("[PlatformIngress] approval notification failed", err);
  }
}
```

- [ ] **Step 2.4:** Run: `pnpm --filter @switchboard/core test -- platform-ingress-approval-notify`. Expected: PASS.

- [ ] **Step 2.5 (mutation check, do not commit):** Temporarily comment out the `this.config.approvalNotifier.notify(...)` call, re-run, confirm the "fires exactly one notification" test REDS, restore.

- [ ] **Step 2.6:** Run the other ingress suites to prove no regression: `pnpm --filter @switchboard/core test -- platform-ingress`. Expected: all PASS.

- [ ] **Step 2.7:** Commit:

```bash
git add packages/core/src/platform/platform-ingress.ts packages/core/src/platform/__tests__/platform-ingress-approval-notify.test.ts
git commit -m "feat(core): notify approval port when a submission parks a gated lifecycle"
```

### Task 3: PR-1 gate + landing

- [ ] **Step 3.1:** Full gate from repo root (see Conventions). Expected: all green.
- [ ] **Step 3.2:** Push, open PR-1 with a body covering: the park-hook decision (spec section 2), notifier hardening (section 6), test evidence. Dispatch a code-review subagent; address findings (verify against code first; push back when wrong).
- [ ] **Step 3.3:** Merge (squash), confirm ancestry, note the squash SHA for the PR-3/PR-4 rebases.

---

## PR-2: tap identity seam (branch `feat/slack-approval-identity-seam` off origin/main)

### Task 4: gateway binds approvals on the stable channel user id

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts` (IncomingChannelMessage)
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts` (approval branch)
- Modify: `packages/core/src/channel-gateway/index.ts` (export `parseApprovalResponsePayload` + its type; PR-3's e2e proof imports the REAL parser from `@switchboard/core`)
- Test: `packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts`

- [ ] **Step 4.1: Write the failing tests** (append to the existing describe block in `channel-gateway-approval.test.ts`):

```ts
describe("approval binding identity (principalId seam)", () => {
  function transportConfig(respond: ReturnType<typeof vi.fn>) {
    return createMockConfig({
      approvalResponseConfig: { transport: { respond } },
    });
  }

  it("binds on principalId when the adapter supplied one (Slack taps)", async () => {
    const respond = vi.fn().mockResolvedValue({ kind: "refused", code: "not_authorized" });
    const gateway = new ChannelGateway(transportConfig(respond));

    await gateway.handleIncoming(
      {
        channel: "slack",
        token: "sw_test",
        sessionId: "C67890",
        principalId: "U12345",
        text: APPROVAL_TEXT,
      },
      { send: vi.fn().mockResolvedValue(undefined) },
    );

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]![0].channelIdentifier).toBe("U12345");
  });

  it("falls back to sessionId when no principalId is present (WhatsApp pin)", async () => {
    const respond = vi.fn().mockResolvedValue({ kind: "refused", code: "not_authorized" });
    const gateway = new ChannelGateway(transportConfig(respond));

    await gateway.handleIncoming(
      { channel: "whatsapp", token: "sw_test", sessionId: "+6591234567", text: APPROVAL_TEXT },
      { send: vi.fn().mockResolvedValue(undefined) },
    );

    expect(respond.mock.calls[0]![0].channelIdentifier).toBe("+6591234567");
  });

  it("non-approval conversation flow still keys on sessionId, ignoring principalId", async () => {
    const config = createMockConfig();
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      {
        channel: "slack",
        token: "sw_test",
        sessionId: "C67890",
        principalId: "U12345",
        text: "hello there",
      },
      { send: vi.fn().mockResolvedValue(undefined) },
    );

    expect(config.conversationStore.getOrCreateBySession).toHaveBeenCalledWith(
      "dep-1",
      "slack",
      "C67890",
    );
  });
});
```

- [ ] **Step 4.2:** Run: `pnpm --filter @switchboard/core test -- channel-gateway-approval`. Expected: FAIL (principalId not a field; channelIdentifier is C67890).

- [ ] **Step 4.3: Implement.** In `types.ts`, add to `IncomingChannelMessage` after `sessionId`:

```ts
  /**
   * Stable channel user identity (Slack U... user id, Telegram from.id).
   * Approval responses bind on this when present; conversation keying and
   * reply routing stay on sessionId. Adapters whose sessionId IS the stable
   * identity (WhatsApp: phone) may omit it.
   */
  principalId?: string;
```

In `channel-gateway.ts`, replace the approval-branch identifier and its comment:

```ts
        // Binding identity: the stable channel USER id when the adapter supplied
        // one (Slack taps surface user.id as principalId while sessionId is the
        // channel), else sessionId (WhatsApp sessionId IS the phone; see
        // resolveContactIdentity.ts). Never an ephemeral message/thread id. See
        // OperatorChannelBinding model docs and bridge spec section 5.
        channel: message.channel,
        channelIdentifier: message.principalId ?? message.sessionId,
```

In `channel-gateway/index.ts`, add next to the `handleApprovalResponse` export block:

```ts
export { parseApprovalResponsePayload } from "./approval-response-payload.js";
export type { ParsedApprovalResponsePayload } from "./approval-response-payload.js";
```

- [ ] **Step 4.4:** Run: `pnpm --filter @switchboard/core test -- channel-gateway`. Expected: PASS (all gateway suites).

- [ ] **Step 4.5:** Commit:

```bash
git add packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/channel-gateway.ts packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts
git commit -m "feat(core): bind channel approvals on the stable channel user id"
```

### Task 5: webhook routes forward principalId (with production-encoding realism)

**Files:**

- Create: `apps/chat/src/routes/slack-form-parser.ts` (parser extraction from main.ts, so tests drive the REAL production form decoder)
- Modify: `apps/chat/src/routes/managed-webhook.ts` (one field)
- Modify: `apps/chat/src/main.ts` (consume the extracted parser + one principalId field, single-tenant telegram path)
- Test: `apps/chat/src/__tests__/managed-webhook-identity.test.ts` (new)

- [ ] **Step 5.0: Extract the form parser** (pure move, no behavior change; main.ts's inline `addContentTypeParser` block at ~69-82 becomes a call). Create `apps/chat/src/routes/slack-form-parser.ts`:

```ts
import type { FastifyInstance } from "fastify";

/**
 * Slack interactivity (block_actions) arrives as application/x-www-form-urlencoded
 * with a `payload` field carrying JSON. Decode it to the parsed payload object and
 * preserve the RAW body on the request for HMAC signature verification: Slack signs
 * the raw form body, not the decoded JSON. Extracted from main.ts so route tests
 * can register the REAL production parser.
 */
export function registerSlackFormEncodedParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        (req as unknown as Record<string, unknown>).rawBody = body;
        const params = new URLSearchParams(body as string);
        const payload = params.get("payload");
        done(null, payload ? JSON.parse(payload) : Object.fromEntries(params));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
}
```

In `main.ts`, replace the inline `app.addContentTypeParser("application/x-www-form-urlencoded", ...)` block with:

```ts
// Parse application/x-www-form-urlencoded (Slack interactive payloads)
registerSlackFormEncodedParser(app);
```

plus the import `import { registerSlackFormEncodedParser } from "./routes/slack-form-parser.js";`. Run `pnpm --filter @switchboard/chat test` to confirm the move broke nothing before proceeding.

- [ ] **Step 5.1: Write the failing test file:**

```ts
import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  registerManagedWebhookRoutes,
  type ManagedWebhookDeps,
} from "../routes/managed-webhook.js";
import type { GatewayEntry } from "../managed/runtime-registry.js";
import { SlackAdapter } from "../adapters/slack.js";
import { registerSlackFormEncodedParser } from "../routes/slack-form-parser.js";
import { createHmac } from "node:crypto";

// The gateway binds approval responses on the stable channel USER id
// (OperatorChannelBinding doctrine; bridge spec section 5). The route must
// forward the adapter's principalId alongside sessionId or Slack taps present
// the channel id and every binding lookup fails closed.

function makeEntry(
  adapter: GatewayEntry["adapter"],
  handleIncoming: ReturnType<typeof vi.fn>,
): GatewayEntry {
  return {
    channel: "slack",
    deploymentConnectionId: "dc-1",
    orgId: "org-1",
    gateway: { handleIncoming } as unknown as GatewayEntry["gateway"],
    adapter,
  };
}

async function buildApp(entry: GatewayEntry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // The REAL production form decoder (extracted from main.ts): block_actions
  // arrive form-encoded; the parser unwraps `payload` and preserves rawBody.
  registerSlackFormEncodedParser(app);
  const deps: ManagedWebhookDeps = {
    registry: { getGatewayByWebhookPath: () => entry },
  };
  registerManagedWebhookRoutes(app, deps);
  await app.ready();
  return app;
}

describe("managed webhook identity forwarding", () => {
  it("forwards the Slack user id as principalId for block_actions taps", async () => {
    // Real adapter, no signing secret: verifyRequest passes in non-production.
    const adapter = new SlackAdapter("xoxb-test") as unknown as GatewayEntry["adapter"];
    const handleIncoming = vi.fn(async () => {});
    const app = await buildApp(makeEntry(adapter, handleIncoming));

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: { "content-type": "application/json" },
      payload: {
        type: "block_actions",
        user: { id: "U12345" },
        channel: { id: "C67890" },
        team: { id: "T11111" },
        actions: [
          {
            action_id: "approval_approve",
            value: JSON.stringify({
              action: "approve",
              approvalId: "lc_1",
              bindingHash: "hash123",
            }),
            type: "button",
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(handleIncoming).toHaveBeenCalledTimes(1);
    const input = handleIncoming.mock.calls[0]![0];
    expect(input.sessionId).toBe("C67890");
    expect(input.principalId).toBe("U12345");
    await app.close();
  });

  it("forwards principalId for events-API messages too", async () => {
    const adapter = new SlackAdapter("xoxb-test") as unknown as GatewayEntry["adapter"];
    const handleIncoming = vi.fn(async () => {});
    const app = await buildApp(makeEntry(adapter, handleIncoming));

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: { "content-type": "application/json" },
      payload: {
        team_id: "T11111",
        event: {
          type: "message",
          client_msg_id: "msg_1",
          ts: "1700000000.000001",
          channel: "C67890",
          user: "U12345",
          text: "hello",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const input = handleIncoming.mock.calls[0]![0];
    expect(input.sessionId).toBe("C67890");
    expect(input.principalId).toBe("U12345");
    await app.close();
  });

  it("a REAL form-encoded signed interactivity POST (the wire shape Slack sends) forwards identity", async () => {
    // Signature verification runs over the RAW form body; the parser must
    // preserve it. This is the production encoding path end to end: form decode
    // -> rawBody HMAC -> adapter parse -> identity forwarding.
    const SIGNING_SECRET = "test-signing-secret";
    const adapter = new SlackAdapter(
      "xoxb-test",
      SIGNING_SECRET,
    ) as unknown as GatewayEntry["adapter"];
    const handleIncoming = vi.fn(async () => {});
    const app = await buildApp(makeEntry(adapter, handleIncoming));

    const interactivityPayload = {
      type: "block_actions",
      user: { id: "U12345" },
      channel: { id: "C67890" },
      team: { id: "T11111" },
      actions: [
        {
          action_id: "approval_approve",
          value: JSON.stringify({ action: "approve", approvalId: "lc_1", bindingHash: "h1" }),
          type: "button",
        },
      ],
    };
    const rawBody = new URLSearchParams({
      payload: JSON.stringify(interactivityPayload),
    }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      "v0=" +
      createHmac("sha256", SIGNING_SECRET).update(`v0:${timestamp}:${rawBody}`).digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(handleIncoming).toHaveBeenCalledTimes(1);
    const input = handleIncoming.mock.calls[0]![0];
    expect(input.sessionId).toBe("C67890");
    expect(input.principalId).toBe("U12345");
    expect(input.text).toBe(
      JSON.stringify({ action: "approve", approvalId: "lc_1", bindingHash: "h1" }),
    );
    await app.close();
  });

  it("a tampered form body fails signature verification (rawBody is what gets signed)", async () => {
    const SIGNING_SECRET = "test-signing-secret";
    const adapter = new SlackAdapter(
      "xoxb-test",
      SIGNING_SECRET,
    ) as unknown as GatewayEntry["adapter"];
    const handleIncoming = vi.fn(async () => {});
    const app = await buildApp(makeEntry(adapter, handleIncoming));

    const rawBody = new URLSearchParams({
      payload: JSON.stringify({ type: "block_actions" }),
    }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      "v0=" +
      createHmac("sha256", SIGNING_SECRET)
        .update(`v0:${timestamp}:${rawBody}DIFFERENT`)
        .digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(401);
    expect(handleIncoming).not.toHaveBeenCalled();
    await app.close();
  });

  it("a stable-identity adapter (WhatsApp shape) yields principalId === sessionId", async () => {
    const adapter = {
      channel: "whatsapp",
      verifyRequest: () => true,
      parseIncomingMessage: () => ({
        id: "wa_1",
        channel: "whatsapp" as const,
        channelMessageId: "wamid.1",
        threadId: "+6591234567",
        principalId: "+6591234567",
        organizationId: null,
        text: "hi",
        attachments: [],
        timestamp: new Date(),
      }),
      extractMessageId: () => null,
      sendTextReply: vi.fn(async () => {}),
    } as unknown as GatewayEntry["adapter"];
    const handleIncoming = vi.fn(async () => {});
    const app = await buildApp({ ...makeEntry(adapter, handleIncoming), channel: "whatsapp" });

    const res = await app.inject({
      method: "POST",
      url: "/webhook/managed/abc",
      headers: { "content-type": "application/json" },
      payload: { any: "thing" },
    });

    expect(res.statusCode).toBe(200);
    const input = handleIncoming.mock.calls[0]![0];
    expect(input.principalId).toBe("+6591234567");
    expect(input.sessionId).toBe("+6591234567");
    await app.close();
  });
});
```

- [ ] **Step 5.2:** Run: `pnpm --filter @switchboard/chat test -- managed-webhook-identity`. Expected: FAIL (`input.principalId` undefined). Note: if `@switchboard/core` dist is stale, run `pnpm --filter @switchboard/core build` first; chat tests read core's dist.

- [ ] **Step 5.3: Implement.** In `managed-webhook.ts`, the `handleIncoming` input gains one field:

```ts
        {
          channel: gatewayEntry.channel,
          token: gatewayEntry.deploymentConnectionId,
          sessionId: threadId,
          principalId: incoming.principalId,
          text: incoming.text,
        },
```

In `main.ts`, the single-tenant telegram path mirrors it:

```ts
await singleTenantGateway.handleIncoming(
  {
    channel: "telegram",
    token: "single-tenant",
    sessionId: threadId,
    principalId: incoming.principalId,
    text: incoming.text,
  },
  replySink,
);
```

- [ ] **Step 5.4:** Run: `pnpm --filter @switchboard/chat test`. Expected: PASS (gateway-bridge-attribution may flake under load; rerun isolated once if so).

- [ ] **Step 5.5:** Commit:

```bash
git add apps/chat/src/routes/slack-form-parser.ts apps/chat/src/routes/managed-webhook.ts apps/chat/src/main.ts apps/chat/src/__tests__/managed-webhook-identity.test.ts
git commit -m "feat(chat): forward stable channel user id to the gateway"
```

### Task 6: PR-2 gate + landing

- [ ] **Step 6.1:** Full gate from repo root. Expected: green.
- [ ] **Step 6.2:** Push, open PR-2 (body: the identity contradiction it fixes, per-channel effects table from spec section 4), code-review subagent, address findings.
- [ ] **Step 6.3:** Merge (squash), confirm ancestry.

---

## PR-3: e2e notify-to-dispatch proof (branch `test/slack-approval-notify-e2e` off origin/main AFTER PR-1 merges)

### Task 7: the loop proof

**Files:**

- Modify: `apps/api/src/__tests__/recommendation-handoff-harness.ts` (opts passthrough)
- Modify: `apps/api/src/__tests__/recommendation-handoff-lifecycle-world.ts` (opts passthrough)
- Create: `apps/api/src/__tests__/slack-approval-notify-loop.test.ts`

- [ ] **Step 7.1:** Extend the harness opts (two passthrough edits):

`recommendation-handoff-harness.ts`:

```ts
export function buildHarness(
  policies: Policy[],
  opts: {
    lifecycleService?: ApprovalLifecycleService;
    approvalNotifier?: import("@switchboard/core/notifications").ApprovalNotifier;
  } = {},
): FullLoopHarness {
```

and in its `new PlatformIngress({...})`:

```ts
    lifecycleService: opts.lifecycleService,
    approvalNotifier: opts.approvalNotifier,
```

`recommendation-handoff-lifecycle-world.ts`:

```ts
export function buildLifecycleWorld(
  opts: { approvalNotifier?: import("@switchboard/core/notifications").ApprovalNotifier } = {},
) {
  const store = new InMemoryLifecycleStore();
  const lifecycleService = new ApprovalLifecycleService({ store });
  const harness = buildHarness([allowPolicy(), approvalPolicy()], {
    lifecycleService,
    approvalNotifier: opts.approvalNotifier,
  });
```

- [ ] **Step 7.2: Write the proof** (`slack-approval-notify-loop.test.ts`):

```ts
/**
 * The outbound twin of chat-approval-bridge-loop.test.ts: prove that the
 * notification a REAL SlackApprovalNotifier sends at park time contains button
 * values that drive the REAL engine through the REAL bridge. Loop under test:
 * park (real cron submit) -> park-hook notification (real notifier, captured
 * chat.postMessage) -> button value -> REAL parseApprovalResponsePayload ->
 * REAL handleApprovalResponse in transport mode -> REAL internal route with a
 * slack U... binding -> server-side re-derivation -> dispatch -> honest reply.
 */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleApprovalResponse,
  HttpApprovalRespondTransport,
  parseApprovalResponsePayload,
  APPROVE_EXECUTED_MSG,
  REJECT_SUCCESS_MSG,
  NOT_AUTHORIZED_MSG,
} from "@switchboard/core";
import type { HandleApprovalResponseConfig, OperatorChannelBindingStore } from "@switchboard/core";
import { SlackApprovalNotifier } from "@switchboard/core/notifications";
import { internalChatApprovalsRoutes } from "../routes/internal-chat-approvals.js";
import { ORG, readerFor } from "./recommendation-handoff-harness.js";
import { buildLifecycleWorld } from "./recommendation-handoff-lifecycle-world.js";
import {
  OPERATOR_PRINCIPAL,
  parkViaCron,
  replyCapture,
  seedOperatorPrincipal,
} from "./chat-approval-world.js";

const SECRET = "bridge-test-secret";
const OPS_CHANNEL = "C_OPS_PILOT";
const SLACK_OPERATOR = "U_OP_1";

/** Org-and-triple-exact binding for the SLACK operator (the bridged authority row). */
function slackBindingStore(): OperatorChannelBindingStore {
  return {
    findActiveBinding: async (q) =>
      q.organizationId === ORG && q.channel === "slack" && q.channelIdentifier === SLACK_OPERATOR
        ? ({ principalId: OPERATOR_PRINCIPAL } as never)
        : null,
  };
}

/** Capture chat.postMessage bodies from the REAL notifier via a stubbed global fetch. */
function stubSlackFetch(opts: { failWith?: number } = {}): Array<Record<string, unknown>> {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (opts.failWith) {
        return new Response("{}", { status: opts.failWith });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
  return posts;
}

function buttonValue(post: Record<string, unknown>, actionId: string): string {
  const blocks = post["blocks"] as Array<{
    type: string;
    elements?: Array<{ action_id: string; value: string }>;
  }>;
  const actions = blocks.find((b) => b.type === "actions");
  const btn = actions?.elements?.find((e) => e.action_id === actionId);
  if (!btn) throw new Error(`button ${actionId} not found in notification`);
  return btn.value;
}

async function buildBridgeApp(w: ReturnType<typeof buildLifecycleWorld>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", null);
  app.decorate("storageContext", w.storage as never);
  app.decorate("workTraceStore", w.harness.traceStore as never);
  app.decorate("lifecycleService", w.lifecycleService as never);
  app.decorate("platformLifecycle", w.platformLifecycle as never);
  app.decorate("sessionManager", null);
  app.decorate("auditLedger", w.ledger as never);
  await app.register(internalChatApprovalsRoutes, {
    prefix: "/api/internal/chat-approvals",
    bindingStore: slackBindingStore(),
  });
  await app.ready();
  return app;
}

function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const res = await app.inject({
      method: "POST",
      url: url.pathname,
      headers,
      payload: init?.body as string,
    });
    return new Response(res.body, { status: res.statusCode });
  }) as typeof fetch;
}

function bridgedConfig(app: FastifyInstance): HandleApprovalResponseConfig {
  return {
    transport: new HttpApprovalRespondTransport({
      baseUrl: "http://api.internal",
      internalApiSecret: SECRET,
      fetchImpl: injectFetch(app),
      retryDelayMs: 1,
    }),
  };
}

async function tapButton(
  w: ReturnType<typeof buildLifecycleWorld>,
  app: FastifyInstance,
  value: string,
  channelIdentifier = SLACK_OPERATOR,
): Promise<string[]> {
  const payload = parseApprovalResponsePayload(value);
  expect(payload).not.toBeNull();
  const { sink, replies } = replyCapture();
  await handleApprovalResponse({
    payload: payload!,
    organizationId: ORG,
    channel: "slack",
    channelIdentifier,
    approvalStore: w.storage.approvals,
    replySink: sink,
    config: bridgedConfig(app),
  });
  return replies;
}

describe("a notifier-built Slack button drives the REAL engine through the REAL bridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("park -> notification -> approve tap -> handler ran -> honest reply", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const posts = stubSlackFetch();
    const notifier = new SlackApprovalNotifier("xoxb-test", {
      defaultConversationId: OPS_CHANNEL,
    });
    const w = buildLifecycleWorld({ approvalNotifier: notifier });
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);

    const parked = await parkViaCron(w);
    await vi.waitFor(() => expect(posts).toHaveLength(1));

    // The notification targeted the configured operator conversation and its
    // approve button value IS the parser-canonical payload for the parked unit.
    expect(posts[0]!["channel"]).toBe(OPS_CHANNEL);
    const approveValue = buttonValue(posts[0]!, "approval_approve");
    expect(parseApprovalResponsePayload(approveValue)).toEqual({
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });

    const replies = await tapButton(w, app, approveValue);

    expect(replies).toEqual([APPROVE_EXECUTED_MSG]);
    // THE HANDLER RAN: the real workflow handler created the Mira job.
    expect(w.harness.jobs).toHaveLength(1);
    const rm = await readerFor(w.harness.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    expect(rm.jobs).toHaveLength(1);
    const trace = (await w.harness.traceStore.getByWorkUnitId(parked.workUnitId))!.trace;
    expect(trace.outcome).toBe("completed");
    expect(trace.approvalRespondedBy).toBe(OPERATOR_PRINCIPAL);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "approved",
    );
    const dispatches = w.store.listDispatchRecords();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.state).toBe("succeeded");
  });

  it("the reject button ends the lifecycle rejected with zero dispatches", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const posts = stubSlackFetch();
    const notifier = new SlackApprovalNotifier("xoxb-test", {
      defaultConversationId: OPS_CHANNEL,
    });
    const w = buildLifecycleWorld({ approvalNotifier: notifier });
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);

    const parked = await parkViaCron(w);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    const rejectValue = buttonValue(posts[0]!, "approval_reject");
    expect(parseApprovalResponsePayload(rejectValue)).toEqual({
      action: "reject",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });

    const replies = await tapButton(w, app, rejectValue);

    expect(replies).toEqual([REJECT_SUCCESS_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "rejected",
    );
    expect(w.store.listDispatchRecords()).toHaveLength(0);
    expect(w.harness.jobs).toHaveLength(0);
  });

  it("an unbound Slack identity refuses NOT_AUTHORIZED and mutates nothing", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const posts = stubSlackFetch();
    const notifier = new SlackApprovalNotifier("xoxb-test", {
      defaultConversationId: OPS_CHANNEL,
    });
    const w = buildLifecycleWorld({ approvalNotifier: notifier });
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);

    const parked = await parkViaCron(w);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    const approveValue = buttonValue(posts[0]!, "approval_approve");

    const replies = await tapButton(w, app, approveValue, "U_INTRUDER");

    expect(replies).toEqual([NOT_AUTHORIZED_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe("pending");
    expect(w.store.listDispatchRecords()).toHaveLength(0);
  });

  it("delivery failure is logged, the park is intact, the Inbox-equivalent state is actionable", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const posts = stubSlackFetch({ failWith: 500 });
    const notifier = new SlackApprovalNotifier("xoxb-test", {
      defaultConversationId: OPS_CHANNEL,
    });
    const w = buildLifecycleWorld({ approvalNotifier: notifier });
    await seedOperatorPrincipal(w);

    const parked = await parkViaCron(w);
    await vi.waitFor(() =>
      expect(
        errorSpy.mock.calls.some((c) => String(c[0]).includes("[SlackApprovalNotifier]")),
      ).toBe(true),
    );

    expect(posts).toHaveLength(1);
    expect(parked.lifecycleId).toBeDefined();
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe("pending");
  });
});
```

- [ ] **Step 7.3:** Run: `pnpm --filter @switchboard/api test -- slack-approval-notify-loop`. Expected: PASS. If `@switchboard/core` exports look stale, `pnpm --filter @switchboard/core build` first.
- [ ] **Step 7.4 (mutation check, do not commit):** In the happy-path test, temporarily change `buttonValue(posts[0]!, "approval_approve")` to append `"x"` to the returned string; the parse assertion must red. Restore.
- [ ] **Step 7.5:** Run the sibling suites that share the harness: `pnpm --filter @switchboard/api test -- recommendation-handoff chat-approval`. Expected: PASS.
- [ ] **Step 7.6:** Commit:

```bash
git add apps/api/src/__tests__/recommendation-handoff-harness.ts apps/api/src/__tests__/recommendation-handoff-lifecycle-world.ts apps/api/src/__tests__/slack-approval-notify-loop.test.ts
git commit -m "test(api): e2e proof notifier-built slack button drives the real engine"
```

- [ ] **Step 7.7:** Full gate, push, PR-3, code-review subagent, merge, ancestry check.

---

## PR-4: api wiring, the ACTIVATING PR (branch `feat/slack-approval-notify-wiring` off origin/main AFTER PR-1 and PR-3 merge)

### Task 8: bootstrap builder + injection + env plumbing

**Files:**

- Create: `apps/api/src/bootstrap/approval-notifier.ts`
- Create: `apps/api/src/bootstrap/__tests__/approval-notifier.test.ts`
- Modify: `apps/api/src/app.ts` (inject at the PlatformIngress construction)
- Modify: `.env.example` (document `SLACK_APPROVAL_CHANNEL`)
- Modify: `scripts/env-allowlist.local-readiness.json` (add `SLACK_APPROVAL_CHANNEL`)

- [ ] **Step 8.1: Write the failing test file** (`apps/api/src/bootstrap/__tests__/approval-notifier.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";
import { SlackApprovalNotifier } from "@switchboard/core/notifications";
import { buildParkedApprovalNotifier } from "../approval-notifier.js";

describe("buildParkedApprovalNotifier", () => {
  it("constructs a SlackApprovalNotifier when both env values are present", () => {
    const info = vi.fn();
    const notifier = buildParkedApprovalNotifier(
      { slackBotToken: "xoxb-1", slackApprovalChannel: "C_OPS" },
      { info },
    );
    expect(notifier).toBeInstanceOf(SlackApprovalNotifier);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Slack enabled"));
  });

  it.each([
    ["token missing", { slackBotToken: undefined, slackApprovalChannel: "C_OPS" }],
    ["channel missing", { slackBotToken: "xoxb-1", slackApprovalChannel: undefined }],
    ["both missing", { slackBotToken: undefined, slackApprovalChannel: undefined }],
    ["empty strings", { slackBotToken: "", slackApprovalChannel: "" }],
  ])("returns undefined and logs when %s", (_name, env) => {
    const info = vi.fn();
    const notifier = buildParkedApprovalNotifier(env, { info });
    expect(notifier).toBeUndefined();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("off"));
  });
});
```

- [ ] **Step 8.2:** Run: `pnpm --filter @switchboard/api test -- approval-notifier`. Expected: FAIL (module not found).

- [ ] **Step 8.3: Implement** `apps/api/src/bootstrap/approval-notifier.ts`:

```ts
import type { ApprovalNotifier } from "@switchboard/core/notifications";
import { SlackApprovalNotifier } from "@switchboard/core/notifications";

export interface ParkedApprovalNotifierEnv {
  slackBotToken: string | undefined;
  slackApprovalChannel: string | undefined;
}

/**
 * Builds the best-effort notifier PlatformIngress fires when a submission parks
 * as a gated lifecycle (spec: 2026-06-05-slack-approval-notifications-design.md
 * section 5). Env-gated pilot posture: one Slack conversation for all parked
 * approvals. SLACK_BOT_TOKEN must be the bot token of the SAME Slack app as the
 * org's managed Slack channel, or button taps are delivered to the wrong app's
 * interactivity URL and never reach the managed webhook. Multi-tenant org-scoped
 * delivery is the named follow-up; this builder is where it would plug in.
 */
export function buildParkedApprovalNotifier(
  env: ParkedApprovalNotifierEnv,
  logger: { info(msg: string): void },
): ApprovalNotifier | undefined {
  if (!env.slackBotToken || !env.slackApprovalChannel) {
    logger.info(
      "Approval notifications: off (set SLACK_BOT_TOKEN and SLACK_APPROVAL_CHANNEL to put parked approvals in front of operators in Slack)",
    );
    return undefined;
  }
  logger.info(
    "Approval notifications: Slack enabled for parked approvals. Ensure this bot token belongs to the same Slack app whose interactivity URL routes to the managed webhook, or button taps will never arrive.",
  );
  return new SlackApprovalNotifier(env.slackBotToken, {
    defaultConversationId: env.slackApprovalChannel,
  });
}
```

- [ ] **Step 8.4:** Run: `pnpm --filter @switchboard/api test -- approval-notifier`. Expected: PASS.

- [ ] **Step 8.5: Inject in `app.ts`.** Immediately before the `const platformIngress = new PlatformIngress({` construction:

```ts
const { buildParkedApprovalNotifier } = await import("./bootstrap/approval-notifier.js");
const approvalNotifier = buildParkedApprovalNotifier(
  {
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackApprovalChannel: process.env.SLACK_APPROVAL_CHANNEL,
  },
  app.log,
);
```

and add to the constructor config after `operatorAlerter,`:

```ts
    approvalNotifier,
```

- [ ] **Step 8.6: Env plumbing.** In `.env.example`, after the `SLACK_SIGNING_SECRET=` line:

```
# Slack conversation (channel id C... or user id U... for a DM) that
# parked-approval Approve/Reject messages post to. Requires SLACK_BOT_TOKEN to
# be the bot token of the SAME Slack app as the org's managed Slack channel
# (interactivity must reach the managed webhook). Unset = notifications off.
SLACK_APPROVAL_CHANNEL=
```

In `scripts/env-allowlist.local-readiness.json`, add `"SLACK_APPROVAL_CHANNEL",` in sorted position (immediately before `"SLACK_BOT_TOKEN",`).

- [ ] **Step 8.7:** Prove the env lint locally: `CI=1 npx tsx scripts/local-verify-fast.ts`. Expected: PASS (env completeness sees the allowlist + .env.example pair; no new routes were added so route-ingress is untouched).

- [ ] **Step 8.8:** Commit:

```bash
git add apps/api/src/bootstrap/approval-notifier.ts apps/api/src/bootstrap/__tests__/approval-notifier.test.ts apps/api/src/app.ts .env.example scripts/env-allowlist.local-readiness.json
git commit -m "feat(api): wire slack parked-approval notifier into platform ingress"
```

- [ ] **Step 8.9:** Full gate, push, PR-4 with the PRE-FLIP CHECKLIST in the body (from spec section 7): respond bridge live (#910), binding row seeded with the U... id (SQL in bridge spec section 5), `SLACK_BOT_TOKEN` = the managed org app's token, `SLACK_APPROVAL_CHANNEL` = the ops conversation id, bot invited to that conversation, then one real parked approval round-tripped END TO END with a REAL button tap (a successful post is NOT sufficient validation: the wrong app's token still posts fine but taps go to the wrong interactivity URL). The body also states the visibility/authority split: Slack channel membership does not grant approval authority; the binding store remains the enforcement point. Code-review subagent, merge, ancestry check.

---

## Final verification (after all merges, on origin/main)

- [ ] `git fetch origin && git checkout origin/main` (detached) in the worktree; run the full gate; run the three new/extended suites by name and capture output for the final report.
- [ ] Worktree teardown: remove the worktree, prune, delete local AND remote feature branches (docs branch included).
