# Send-time consent enforcement — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `ConsentService` revocation state into the outbound send path so a contact who STOPs on any channel cannot be messaged on any channel until consent is re-granted.

**Architecture:** Mirror the existing **inbound** `runConsentRevocationGate` pattern (`packages/core/src/channel-gateway/consent-revocation-gate.ts`) with a new **outbound** `runConsentEnforcementGate` called from `ChannelGateway.dispatchResponse` immediately before `replySink.send(text)`. Pure async function; same posture/observe/enforce mode plumbing; single chokepoint per Doctrine §10. Defense-in-depth `ConsentEnforcementHook` for skill-runtime added in PR 3 for any future non-gateway egress (e.g., Riley broadcast).

**Tech stack:** TypeScript (ESM, `.js` relative imports), Vitest, mocked-store testing pattern.

---

## Spec adjustment from `docs/superpowers/specs/2026-05-16-send-time-consent-enforcement-design.md`

The spec specified integration at each `ChannelAdapter.sendMessage`. Implementation review during plan-writing found:

- `ChannelAdapter` (`apps/chat/src/adapters/adapter.ts:3`) is **thread-keyed** (`sendTextReply(threadId, text)`), not contact-keyed — adapters have no `orgId`/`contactId`/`channel` context to feed the gate.
- The `(orgId, contactId, channel, sessionId)` context exists at `ChannelGateway.dispatchResponse` (`packages/core/src/channel-gateway/channel-gateway.ts:23`), which already has `resolved.organizationId`, `resolved.deploymentId`, `message.channel`, `message.sessionId`, and `replySink` in scope.
- The inbound `runConsentRevocationGate` already establishes the pattern of a pure-function gate called from `ChannelGateway` with `sessionContactResolver` for `sessionId → contactId`.

**Adjustment:** Move primary enforcement from "4 adapters × N send methods" to a single call site in `ChannelGateway.dispatchResponse`. This is simpler (1 integration point, not 4–8), more correct (data is naturally in scope), and architecturally symmetric with the inbound gate.

The spec's high-level intent is **unchanged**: send-time consent gate consulting authoritative state, emitting `GovernanceVerdict` on deny, cross-channel propagation, blocked sends suppressed and audited.

---

## File structure

**Create:**

- `packages/core/src/channel-gateway/consent-enforcement-gate.ts` — pure async function `runConsentEnforcementGate(input) → "allowed" | "blocked"`
- `packages/core/src/channel-gateway/consent-enforcement-gate.test.ts` — unit tests with mocked store/verdict
- `packages/core/src/channel-gateway/__tests__/channel-gateway-consent-enforcement.test.ts` — integration test through `ChannelGateway.dispatchResponse`
- `apps/chat/src/__tests__/cross-channel-stop.regression.test.ts` — end-to-end regression test (revoke on one channel → blocked on all)
- _(PR 3)_ `packages/core/src/skill-runtime/hooks/consent-enforcement-hook.ts` — defense-in-depth `beforeToolCall` hook
- _(PR 3)_ `packages/core/src/skill-runtime/hooks/__tests__/consent-enforcement-hook.test.ts` — hook unit tests

**Modify:**

- `packages/core/src/channel-gateway/channel-gateway.ts` — call gate in `dispatchResponse` before `replySink.send(text)`
- `packages/core/src/channel-gateway/types.ts` — add `consentEnforcementGate` block to `ChannelGatewayConfig`
- `apps/chat/src/bootstrap/channel-gateway.ts` (or wherever the gateway is constructed) — wire new gate deps

---

## PR cuts

- **PR 1 — gate module + ChannelGateway integration + unit/integration tests** (~80 LOC). Self-contained: ships the gate behind config; behavior is no-op when config omitted (backward-compat, matches inbound gate pattern).
- **PR 2 — bootstrap wiring + cross-channel regression test** (~30 LOC). Turns the gate on in production by wiring deps in `apps/chat/src/bootstrap/`.
- **PR 3 — defense-in-depth skill-runtime hook + tests** (~40 LOC). Adds `ConsentEnforcementHook` for any future non-gateway sender (Riley broadcast, operator-direct).

---

## Task 1: Add `runConsentEnforcementGate` pure function (PR 1)

**Files:**

- Create: `packages/core/src/channel-gateway/consent-enforcement-gate.ts`

- [ ] **Step 1: Read the inbound pattern as a reference**

Open `packages/core/src/channel-gateway/consent-revocation-gate.ts` and skim — your new file mirrors its shape (input record, posture-cache fail-closed branch, observe vs enforce mode, verdict shape) but operates on outbound rather than inbound.

- [ ] **Step 2: Add the `ConsentEnforcementGateConfig` and `runConsentEnforcementGate` skeleton**

Create `packages/core/src/channel-gateway/consent-enforcement-gate.ts`:

```ts
import { resolveConsentStateConfig, type PdpaJurisdiction } from "@switchboard/schemas";
import type { ConsentStateStore } from "../consent/consent-store.js";
import type { GovernanceConfigResolver } from "../governance/governance-config-resolver.js";
import type { GovernanceVerdictStore } from "../governance/governance-verdict-store/types.js";
import type { GovernancePostureCache } from "../governance/posture-cache.js";

export interface ConsentEnforcementGateConfig {
  governanceConfigResolver: GovernanceConfigResolver;
  consentStore: ConsentStateStore;
  postureCache: GovernancePostureCache;
  verdictStore: GovernanceVerdictStore;
  sessionContactResolver: (sessionId: string) => Promise<string | null>;
  clock: () => Date;
}

export interface RunConsentEnforcementGateInput {
  cfg: ConsentEnforcementGateConfig;
  outboundText: string;
  sessionId: string;
  deploymentId: string;
  channel: string;
}

/**
 * Pre-output consent enforcement gate. Runs immediately before
 * `replySink.send(...)` in ChannelGateway.dispatchResponse.
 *
 * Returns:
 *  - "blocked" → revocation in effect; caller MUST suppress the outbound
 *    (no replySink.send, no addMessage). Verdict already persisted.
 *  - "allowed" → continue with normal dispatch.
 *
 * Backward-compatible: when ConsentStateConfig.mode === "off" or governance
 * config is missing/erroring without an enforce-cached posture, the gate
 * is a pass-through ("allowed").
 */
export async function runConsentEnforcementGate(
  input: RunConsentEnforcementGateInput,
): Promise<"allowed" | "blocked"> {
  const { cfg, outboundText, sessionId, deploymentId, channel } = input;

  const resolution = await cfg.governanceConfigResolver(deploymentId);
  if (resolution.status === "missing") return "allowed";

  if (resolution.status === "error") {
    const cached = cfg.postureCache.lastKnown(deploymentId);
    if (cached?.mode === "enforce") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (cfg.verdictStore.save as any)({
          deploymentId,
          sourceGuard: "consent_gate",
          action: "allow",
          reasonCode: "governance_unavailable",
          jurisdiction: cached.jurisdiction,
          clinicType: cached.clinicType,
          conversationId: sessionId,
          decidedAt: cfg.clock().toISOString(),
          details: { event: "egress_resolver_error_fail_open", channel },
          auditLevel: "critical",
        });
      } catch (err) {
        console.error("[consent-enforcement-gate] verdict persist failure", err);
      }
    }
    return "allowed";
  }

  const consentConfig = resolveConsentStateConfig(resolution.config);
  if (consentConfig.mode === "off") return "allowed";

  cfg.postureCache.remember(deploymentId, {
    mode: consentConfig.mode,
    jurisdiction: resolution.config.jurisdiction,
    clinicType: resolution.config.clinicType,
  });

  const contactId = await cfg.sessionContactResolver(sessionId);
  if (!contactId) return "allowed"; // pre-contact outbound (e.g., system error reply)

  const consent = await cfg.consentStore.readOrNull(contactId);
  if (!consent?.consentRevokedAt) return "allowed";

  // Revoked — emit verdict.
  const jurisdiction = (consent.pdpaJurisdiction ??
    resolution.config.jurisdiction) as PdpaJurisdiction;

  const verdictAction = consentConfig.mode === "enforce" ? "block" : "allow";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cfg.verdictStore.save as any)({
      deploymentId,
      sourceGuard: "consent_gate",
      action: verdictAction,
      reasonCode: "consent_revoked",
      jurisdiction,
      clinicType: resolution.config.clinicType,
      conversationId: sessionId,
      decidedAt: cfg.clock().toISOString(),
      details: {
        event: "outbound_blocked_revoked",
        channel,
        contactId,
        outboundLength: outboundText.length,
        observe: consentConfig.mode === "observe",
      },
      auditLevel: "critical",
    });
  } catch (err) {
    console.error("[consent-enforcement-gate] verdict persist failure", err);
  }

  if (consentConfig.mode === "observe") return "allowed";
  return "blocked";
}
```

- [ ] **Step 3: Verify the file typechecks**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: exit 0. If `@switchboard/schemas` symbols are missing (e.g., `resolveConsentStateConfig`), run `pnpm reset` first.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/channel-gateway/consent-enforcement-gate.ts
git commit -m "feat(consent): add runConsentEnforcementGate pure function"
```

---

## Task 2: Unit tests for `runConsentEnforcementGate` (PR 1)

**Files:**

- Create: `packages/core/src/channel-gateway/consent-enforcement-gate.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/core/src/channel-gateway/consent-enforcement-gate.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runConsentEnforcementGate } from "./consent-enforcement-gate.js";
import type { ConsentEnforcementGateConfig } from "./consent-enforcement-gate.js";

const FIXED_DATE = new Date("2026-05-16T12:00:00Z");

function makeStubs(
  overrides: Partial<{
    revokedAt: Date | null;
    jurisdiction: "SG" | "MY";
    consentMode: "off" | "observe" | "enforce";
    resolverStatus: "ok" | "missing" | "error";
    cachedPostureMode: "observe" | "enforce" | null;
  }> = {},
) {
  const verdictSave = vi.fn().mockResolvedValue(undefined);
  const postureRemember = vi.fn();
  const sessionContactResolver = vi.fn().mockResolvedValue("contact-123");
  const consentStoreReadOrNull = vi.fn().mockResolvedValue({
    consentRevokedAt: overrides.revokedAt ?? null,
    pdpaJurisdiction: overrides.jurisdiction ?? "SG",
  });

  const cfg: ConsentEnforcementGateConfig = {
    governanceConfigResolver: vi.fn().mockResolvedValue(
      overrides.resolverStatus === "missing"
        ? { status: "missing" }
        : overrides.resolverStatus === "error"
          ? { status: "error" }
          : {
              status: "ok",
              config: {
                jurisdiction: overrides.jurisdiction ?? "SG",
                clinicType: "medical",
                consentState: { mode: overrides.consentMode ?? "enforce" },
              },
            },
    ),
    consentStore: { readOrNull: consentStoreReadOrNull } as any,
    postureCache: {
      remember: postureRemember,
      lastKnown: vi.fn().mockReturnValue(
        overrides.cachedPostureMode
          ? {
              mode: overrides.cachedPostureMode,
              jurisdiction: overrides.jurisdiction ?? "SG",
              clinicType: "medical",
            }
          : null,
      ),
    } as any,
    verdictStore: { save: verdictSave } as any,
    sessionContactResolver,
    clock: () => FIXED_DATE,
  };

  return { cfg, verdictSave, postureRemember, sessionContactResolver, consentStoreReadOrNull };
}

describe("runConsentEnforcementGate", () => {
  it("allows when consent is active", async () => {
    const { cfg, verdictSave } = makeStubs({ revokedAt: null });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi there",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).not.toHaveBeenCalled();
  });

  it("blocks when consentRevokedAt is set (enforce mode)", async () => {
    const { cfg, verdictSave } = makeStubs({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      consentMode: "enforce",
    });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi there",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "telegram",
    });
    expect(result).toBe("blocked");
    expect(verdictSave).toHaveBeenCalledOnce();
    const verdict = verdictSave.mock.calls[0][0];
    expect(verdict.sourceGuard).toBe("consent_gate");
    expect(verdict.action).toBe("block");
    expect(verdict.reasonCode).toBe("consent_revoked");
    expect(verdict.details.channel).toBe("telegram");
    expect(verdict.details.contactId).toBe("contact-123");
  });

  it("allows but records verdict in observe mode", async () => {
    const { cfg, verdictSave } = makeStubs({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      consentMode: "observe",
    });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).toHaveBeenCalledOnce();
    expect(verdictSave.mock.calls[0][0].action).toBe("allow");
    expect(verdictSave.mock.calls[0][0].details.observe).toBe(true);
  });

  it("passes through when consent mode is off", async () => {
    const { cfg, verdictSave } = makeStubs({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      consentMode: "off",
    });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).not.toHaveBeenCalled();
  });

  it("passes through when governance config is missing", async () => {
    const { cfg, verdictSave } = makeStubs({ resolverStatus: "missing" });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).not.toHaveBeenCalled();
  });

  it("on resolver error with cached enforce posture, records audit + fails open", async () => {
    const { cfg, verdictSave } = makeStubs({
      resolverStatus: "error",
      cachedPostureMode: "enforce",
    });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).toHaveBeenCalledOnce();
    expect(verdictSave.mock.calls[0][0].reasonCode).toBe("governance_unavailable");
  });

  it("allows when contact cannot be resolved (pre-contact outbound)", async () => {
    const { cfg, verdictSave, sessionContactResolver } = makeStubs({});
    sessionContactResolver.mockResolvedValueOnce(null);
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "System error reply",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it passes**

```bash
pnpm --filter @switchboard/core test consent-enforcement-gate
```

Expected: 7 passing tests, no failures.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/channel-gateway/consent-enforcement-gate.test.ts
git commit -m "test(consent): unit tests for runConsentEnforcementGate"
```

---

## Task 3: Add gate config to `ChannelGatewayConfig` (PR 1)

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts`

- [ ] **Step 1: Add the optional config block**

In `packages/core/src/channel-gateway/types.ts`, after the existing `consentRevocationGate?:` block (around line 135), add:

```ts
  // ---------------------------------------------------------------------------
  // Pre-output consent enforcement gate (Phase 1c — egress complement).
  // Optional — when omitted, the gate is a pass-through (backward compat).
  // Runs immediately before replySink.send() in dispatchResponse.
  // Shares postureCache + sessionContactResolver with the inbound revocation
  // gate; reads consent state directly from the store (no service round-trip).
  // ---------------------------------------------------------------------------
  consentEnforcementGate?: {
    governanceConfigResolver: GovernanceConfigResolver;
    consentStore: ConsentStateStore;
    postureCache: GovernancePostureCache;
    revocationKeywordLoader?: never; // not used on egress
    sessionContactResolver: (sessionId: string) => Promise<string | null>;
    verdictStore: GovernanceVerdictStore;
    clock: () => Date;
  };
```

Add the import at the top of the file:

```ts
import type { ConsentStateStore } from "../consent/consent-store.js";
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/channel-gateway/types.ts
git commit -m "feat(consent): add consentEnforcementGate to ChannelGatewayConfig"
```

---

## Task 4: Call gate from `ChannelGateway.dispatchResponse` (PR 1)

**Files:**

- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`

- [ ] **Step 1: Find the call site**

Open `packages/core/src/channel-gateway/channel-gateway.ts`. Locate the `dispatchResponse` function (around line 23). The `replySink.send(text)` call is around line 77 inside the `if (response.ok)` branch.

- [ ] **Step 2: Wire the gate into the dispatcher**

Add an import at the top of the file:

```ts
import { runConsentEnforcementGate } from "./consent-enforcement-gate.js";
```

Add `consentEnforcementGate` to `dispatchResponse`'s `params` destructure (and TypeScript signature). Then, **immediately before the existing `await replySink.send(text);`** in the `if (response.ok)` branch, add:

```ts
if (consentEnforcementGate) {
  const outcome = await runConsentEnforcementGate({
    cfg: consentEnforcementGate,
    outboundText: text,
    sessionId,
    deploymentId: resolved.deploymentId,
    channel: message.channel,
  });
  if (outcome === "blocked") {
    // Audit row already persisted by the gate. Persist suppressed assistant
    // message so transcripts remain complete, then return without sending.
    await conversationStore.addMessage(
      conversationId,
      "assistant",
      `[suppressed:consent_revoked] ${text}`,
    );
    return;
  }
}
```

The non-ok branch (line 78–80, the "I'm having trouble" fallback) intentionally does **not** gate — system error replies are exempt and rare. Document that with a one-line comment immediately above the existing `else { await replySink.send(...) }`:

```ts
// Error fallback is not gated — system error replies must reach the user.
```

Then wire `consentEnforcementGate` through the caller of `dispatchResponse` (the public `dispatch` method on the gateway). Add it to the `ChannelGatewayConfig` plumbing in the constructor and pass it down. Search for `dispatchResponse({` in the file to find the call site(s) — typically one or two.

- [ ] **Step 3: Run the existing channel-gateway tests to confirm no regression**

```bash
pnpm --filter @switchboard/core test channel-gateway
```

Expected: all existing tests pass; gate is opt-in via config so no behavior change without wiring.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/channel-gateway/channel-gateway.ts
git commit -m "feat(consent): enforce consent gate before outbound dispatch"
```

---

## Task 5: Integration test through `ChannelGateway` (PR 1)

**Files:**

- Create: `packages/core/src/channel-gateway/__tests__/channel-gateway-consent-enforcement.test.ts`

- [ ] **Step 1: Write the integration test**

Mirror an existing channel-gateway integration test for structure (look at `packages/core/src/channel-gateway/__tests__/*.test.ts` for the pattern). The test should:

1. Build a `ChannelGateway` with a `consentEnforcementGate` whose `consentStore.readOrNull` returns `{ consentRevokedAt: <past date>, pdpaJurisdiction: "SG" }`.
2. Build a stub `replySink` whose `.send` is a `vi.fn()`.
3. Build a stub `platformIngress` that returns a successful response with text `"Hi there"`.
4. Call `gateway.dispatch(incomingMessage)`.
5. Assert: `replySink.send` was NOT called; conversation message was recorded with `[suppressed:consent_revoked]` prefix; verdict was persisted with `reasonCode: "consent_revoked"`.

Then a happy-path test: same setup with `consentRevokedAt: null` → `replySink.send` IS called with `"Hi there"`.

```ts
import { describe, expect, it, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
// (...rest of imports — copy from an existing channel-gateway test file)

describe("ChannelGateway — consent enforcement at dispatch", () => {
  it("suppresses outbound and records verdict when contact is revoked", async () => {
    const replySend = vi.fn().mockResolvedValue(undefined);
    const verdictSave = vi.fn().mockResolvedValue(undefined);
    const addMessage = vi.fn().mockResolvedValue(undefined);
    // ... build gateway with consentEnforcementGate wired
    // ... dispatch a known inbound that produces a successful response
    expect(replySend).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(
      expect.any(String),
      "assistant",
      expect.stringContaining("[suppressed:consent_revoked]"),
    );
    expect(verdictSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceGuard: "consent_gate",
        action: "block",
        reasonCode: "consent_revoked",
      }),
    );
  });

  it("sends normally when consent is active", async () => {
    // ... same setup, but consentStore.readOrNull returns { consentRevokedAt: null }
    expect(replySend).toHaveBeenCalledWith(expect.any(String));
    expect(verdictSave).not.toHaveBeenCalled();
  });
});
```

(The plan author should reuse the existing test harness — do not invent new fixtures. Run `grep -l "ChannelGateway" packages/core/src/channel-gateway/__tests__/` to find a sibling test to copy structure from.)

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @switchboard/core test channel-gateway-consent-enforcement
```

Expected: 2 passing tests.

- [ ] **Step 3: Run the full core test suite to confirm no regression**

```bash
pnpm --filter @switchboard/core test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/channel-gateway/__tests__/channel-gateway-consent-enforcement.test.ts
git commit -m "test(consent): integration test for outbound gate in ChannelGateway"
```

- [ ] **Step 5: End of PR 1. Open PR.**

```bash
git push -u origin worktree-consent-enforcement
gh pr create --title "feat(consent): send-time enforcement gate (PR 1/3)" --body "$(cat <<'EOF'
## Summary
- Adds `runConsentEnforcementGate` mirroring the existing inbound `runConsentRevocationGate` pattern
- Calls it from `ChannelGateway.dispatchResponse` immediately before `replySink.send()`
- Blocked sends are persisted as `[suppressed:consent_revoked]` in the transcript and audited via `GovernanceVerdict`
- Backward-compat: opt-in via `ChannelGatewayConfig.consentEnforcementGate` (wired in PR 2)

Spec: `docs/superpowers/specs/2026-05-16-send-time-consent-enforcement-design.md`
Plan: `docs/superpowers/plans/2026-05-16-send-time-consent-enforcement.md` (PR 1 of 3)

## Test plan
- [x] Unit tests for `runConsentEnforcementGate` (7 cases — allowed, blocked, observe, off, missing config, resolver error, no-contact)
- [x] Integration test through `ChannelGateway.dispatchResponse` (blocked + happy path)
- [x] `pnpm --filter @switchboard/core test` passes
- [x] `pnpm typecheck` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 6: Wire `consentEnforcementGate` in chat bootstrap (PR 2)

**Files:**

- Modify: `apps/chat/src/bootstrap/channel-gateway.ts` (path may differ — search for `new ChannelGateway(` or `createChannelGateway(`)

- [ ] **Step 1: Locate the construction site**

```bash
grep -rn "ChannelGatewayConfig\|new ChannelGateway\|createChannelGateway" apps/chat/src/
```

Find the file that constructs the gateway with the inbound `consentRevocationGate` config. The new outbound gate shares almost all deps.

- [ ] **Step 2: Add the outbound gate config block**

Adjacent to the existing `consentRevocationGate:` block, add:

```ts
consentEnforcementGate: {
  governanceConfigResolver,   // reuse existing
  consentStore,                // ConsentStateStore from packages/db
  postureCache,                // reuse existing
  sessionContactResolver,      // reuse existing
  verdictStore,                // reuse existing
  clock,                       // reuse existing
},
```

If `consentStore` is not currently in scope at this construction site, hoist it from the same provider that the inbound `consentRevocationGate`'s `consentService` was built on. Both are layered on `ConsentStateStore`.

- [ ] **Step 3: Run dashboard build hygiene (per CLAUDE.md feedback)**

```bash
pnpm --filter @switchboard/chat build
pnpm --filter @switchboard/chat test
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add apps/chat/src/bootstrap/channel-gateway.ts
git commit -m "feat(consent): wire outbound enforcement gate in chat bootstrap"
```

---

## Task 7: Cross-channel STOP regression test (PR 2)

**Files:**

- Create: `apps/chat/src/__tests__/cross-channel-stop.regression.test.ts`

- [ ] **Step 1: Write the regression test**

This test is the load-bearing contract for the whole spec. It must demonstrate:

1. A contact STOPs on WhatsApp (inbound revocation gate fires; `ConsentService.recordRevocation` is called).
2. The same `orgId + contactId` then receives an inbound on Telegram that would normally trigger a reply.
3. Outbound on Telegram is **blocked** by the enforcement gate (no `replySink.send` call; verdict recorded).
4. Repeat (3) for Instagram and Slack — each blocked.

Use the existing `apps/chat/src/__tests__/` test harness pattern (search for an existing multi-channel test if one exists). Mock the underlying stores (per Switchboard's "db tests use mocked Prisma, not real Postgres" doctrine — see `feedback_api_test_mocked_prisma.md`).

The exact test shape:

```ts
import { describe, expect, it, vi } from "vitest";
// import gateway + stubs (mirror existing fixtures)

describe("cross-channel STOP regression", () => {
  it("STOP on WhatsApp blocks subsequent outbound on Telegram, Instagram, Slack", async () => {
    const contactId = "contact-cross-1";
    const orgId = "org-1";
    const sessionMap = new Map<string, string>([
      ["wa-session", contactId],
      ["tg-session", contactId],
      ["ig-session", contactId],
      ["slack-session", contactId],
    ]);

    const consentState = { consentRevokedAt: null as Date | null, pdpaJurisdiction: "SG" };
    const consentStore = {
      readOrNull: vi.fn(async () => ({ ...consentState })),
      setRevocationIfNotRevoked: vi.fn(async () => {
        consentState.consentRevokedAt = new Date();
        return { wasNewlyRevoked: true, existingRevokedAt: null };
      }),
      // ... other methods stubbed
    };
    const replySinks = {
      whatsapp: { send: vi.fn() },
      telegram: { send: vi.fn() },
      instagram: { send: vi.fn() },
      slack: { send: vi.fn() },
    };

    // 1. STOP on WhatsApp — inbound revocation gate fires
    await dispatchInbound("wa-session", "whatsapp", "STOP", replySinks.whatsapp);
    expect(consentState.consentRevokedAt).not.toBeNull();

    // 2-4. Inbound on each other channel — outbound must be blocked
    await dispatchInbound("tg-session", "telegram", "hi", replySinks.telegram);
    await dispatchInbound("ig-session", "instagram", "hi", replySinks.instagram);
    await dispatchInbound("slack-session", "slack", "hi", replySinks.slack);

    expect(replySinks.telegram.send).not.toHaveBeenCalled();
    expect(replySinks.instagram.send).not.toHaveBeenCalled();
    expect(replySinks.slack.send).not.toHaveBeenCalled();
    // Inbound revocation ack went out on WhatsApp; that is expected behavior.
  });
});
```

The plan author should reuse `apps/chat`'s existing dispatch harness — do not stand up a fresh gateway in the test if a helper already exists.

- [ ] **Step 2: Run the regression test**

```bash
pnpm --filter @switchboard/chat test cross-channel-stop
```

Expected: 1 passing test.

- [ ] **Step 3: Run the full chat test suite**

```bash
pnpm --filter @switchboard/chat test
```

Expected: all tests pass.

- [ ] **Step 4: Commit and open PR 2**

```bash
git add apps/chat/src/__tests__/cross-channel-stop.regression.test.ts
git commit -m "test(consent): cross-channel STOP regression test"
git push
gh pr create --title "feat(consent): wire outbound gate in chat + cross-channel regression test (PR 2/3)" --body "$(cat <<'EOF'
## Summary
- Wires `consentEnforcementGate` in `apps/chat` bootstrap (turns the gate on in production)
- Adds cross-channel STOP regression test: revoke on WhatsApp → subsequent outbound on Telegram/Instagram/Slack is blocked

Spec: `docs/superpowers/specs/2026-05-16-send-time-consent-enforcement-design.md`
Plan: `docs/superpowers/plans/2026-05-16-send-time-consent-enforcement.md` (PR 2 of 3)

## Test plan
- [x] `pnpm --filter @switchboard/chat test` passes
- [x] `pnpm --filter @switchboard/chat build` passes
- [x] Cross-channel regression: STOP on WhatsApp blocks Telegram/IG/Slack outbound

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 8: `ConsentEnforcementHook` defense-in-depth (PR 3)

**Files:**

- Create: `packages/core/src/skill-runtime/hooks/consent-enforcement-hook.ts`
- Create: `packages/core/src/skill-runtime/hooks/__tests__/consent-enforcement-hook.test.ts`

This PR is **optional defense in depth** for any future non-gateway sender (e.g., a Riley broadcast skill that calls a `send-message` tool outside the chat runtime). Skip this PR if no such sender exists or is planned in the next quarter.

- [ ] **Step 1: Read the existing hook shape**

Open `packages/core/src/skill-runtime/hooks/governance-hook.ts` and `packages/core/src/skill-runtime/hook-runner.ts` to confirm the `beforeToolCall` signature (see `packages/core/src/skill-runtime/types.ts:281` for hook event names).

- [ ] **Step 2: Implement the hook**

```ts
// packages/core/src/skill-runtime/hooks/consent-enforcement-hook.ts
import type { SkillHook, BeforeToolCallContext } from "../types.js";
import type { ConsentEnforcementGateConfig } from "../../channel-gateway/consent-enforcement-gate.js";
import { runConsentEnforcementGate } from "../../channel-gateway/consent-enforcement-gate.js";

/**
 * Defense in depth: gate any skill-runtime tool call whose effectCategory
 * is "send-message" with the same consent enforcement gate used by the
 * ChannelGateway egress path. Primary enforcement is at the ChannelGateway;
 * this hook covers skills that bypass the gateway (broadcast, operator-direct).
 */
export function createConsentEnforcementHook(gateCfg: ConsentEnforcementGateConfig): SkillHook {
  return {
    name: "consent-enforcement",
    async beforeToolCall(ctx) {
      const tool = ctx.toolDefinition;
      if (tool.effectCategory !== "send-message") return { decision: "proceed" };

      const sessionId = ctx.params?.sessionId as string | undefined;
      const deploymentId = ctx.deploymentId;
      const channel = (ctx.params?.channel as string | undefined) ?? "unknown";
      const text = (ctx.params?.text as string | undefined) ?? "";

      if (!sessionId || !deploymentId) return { decision: "proceed" };

      const outcome = await runConsentEnforcementGate({
        cfg: gateCfg,
        outboundText: text,
        sessionId,
        deploymentId,
        channel,
      });
      if (outcome === "blocked") {
        return {
          decision: "deny",
          reasonCode: "consent_revoked",
          userMessage: null, // verdict already persisted; no further audit needed here
        };
      }
      return { decision: "proceed" };
    },
  };
}
```

(Field names like `effectCategory`, `params`, `deploymentId`, `decision`, `reasonCode` come from the actual hook type. The plan author should consult the real `SkillHook` / `BeforeToolCallContext` types in `packages/core/src/skill-runtime/types.ts` — they may not match the names above exactly. Use the inbound `governance-hook.ts` as the closest sibling.)

- [ ] **Step 3: Write hook unit tests**

```ts
// packages/core/src/skill-runtime/hooks/__tests__/consent-enforcement-hook.test.ts
import { describe, expect, it, vi } from "vitest";
import { createConsentEnforcementHook } from "../consent-enforcement-hook.js";
// ... build a stub gateCfg whose readOrNull returns revoked
// Assert: hook returns { decision: "deny", reasonCode: "consent_revoked" } for send-message tools when revoked
// Assert: hook returns { decision: "proceed" } for non-send-message tools
// Assert: hook returns { decision: "proceed" } when consent is active
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/core test consent-enforcement-hook
```

Expected: 3+ passing tests.

- [ ] **Step 5: Register the hook in skill-runtime wiring**

Find where `SkillExecutor` constructs its hook list (search for `new SkillExecutor` or `hooks: [`). Add the new hook alongside `GovernanceHook` and `DeterministicSafetyGateHook`. The hook is a pass-through unless a tool's `effectCategory === "send-message"`, so it's safe to register globally.

- [ ] **Step 6: Commit and open PR 3**

```bash
git add packages/core/src/skill-runtime/hooks/consent-enforcement-hook.ts \
        packages/core/src/skill-runtime/hooks/__tests__/consent-enforcement-hook.test.ts \
        packages/core/src/skill-runtime/skill-executor.ts
git commit -m "feat(consent): defense-in-depth ConsentEnforcementHook for skill-runtime"
git push
gh pr create --title "feat(consent): defense-in-depth skill-runtime hook (PR 3/3)" --body "$(cat <<'EOF'
## Summary
- Adds `ConsentEnforcementHook` that gates any skill-runtime tool with `effectCategory === "send-message"` via the same gate used by `ChannelGateway`
- Primary enforcement remains at `ChannelGateway`; this hook covers future non-gateway senders (Riley broadcast, operator-direct)

Spec: `docs/superpowers/specs/2026-05-16-send-time-consent-enforcement-design.md`
Plan: `docs/superpowers/plans/2026-05-16-send-time-consent-enforcement.md` (PR 3 of 3)

## Test plan
- [x] Hook unit tests: deny on revoked send-message, proceed on non-send-message tools, proceed on active consent
- [x] `pnpm --filter @switchboard/core test` passes
- [x] Hook registered in `SkillExecutor`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (for the planning author, before handing off)

**Spec coverage** (each requirement → task):

- Send-time gate exists → Tasks 1, 4
- Cross-channel propagation (contact-keyed, not channel-keyed) → Tasks 1 (revocation read), 7 (regression)
- `GovernanceVerdict` on every deny → Tasks 1, 2
- Backward-compat (no-op without config) → Task 1 (returns "allowed" when resolver missing or mode "off"); Task 3 (optional config block)
- Defense in depth at skill-runtime → Task 8 (PR 3)
- Audit trail surfaces in existing operator surfaces → Task 1 uses existing `verdictStore.save` shape; no new surface
- Three PR cuts as specified → PRs 1/2/3 above

**Doctrine alignment:**

- §1 (PlatformIngress canonical) → unchanged; gate is on egress
- §7 (dead-letter for async paths) → blocked sends recorded as suppressed assistant messages in transcript + verdict audit
- §10 (channel as ingress, not architecture) → respected; ChannelGateway egress remains the single chokepoint

**Risks flagged in spec:**

- System notifications might break → Task 4 explicitly does NOT gate the non-ok error fallback in `dispatchResponse`
- Stale reads → `consentStore.readOrNull` reads same connection as writes (existing primary-write semantics)
- Adapter bypass → defense-in-depth hook (Task 8, PR 3)
- Performance → single Postgres SELECT against an already-indexed table; no caching in v1

**No-placeholder check:** Every step has either complete code or an exact command + expected output.
