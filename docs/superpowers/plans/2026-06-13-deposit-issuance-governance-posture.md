# Deposit-link Issuance Governance Posture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Affirm and lock the autonomous (auto-approve, rides-booking-approval) governance posture for live `deposit.issue`, pinned by tests that drive the REAL governance decision, with the rationale recorded at the code site.

**Architecture:** No production behavior change. The posture is already in code (`effectCategory: "read"`). This plan (1) strengthens the rationale comment in `deposit-link.ts` to capture the go-live decision, and (2) adds governance pin-tests in core and api that exercise the real `getToolGovernanceDecision` + `GovernanceHook.beforeToolCall` over the real tool, plus a port-agnostic proof. Because the tests pin already-correct behavior, each is proven non-vacuous by temporarily breaking the production code and confirming RED, then reverting.

**Tech Stack:** TypeScript, Vitest, pnpm + Turborepo. `@switchboard/core` skill-runtime governance.

---

### Task 1: Core governance-posture pin tests + strengthened rationale comment

**Files:**
- Test: `packages/core/src/skill-runtime/tools/deposit-link.test.ts` (add a describe block + imports)
- Modify: `packages/core/src/skill-runtime/tools/deposit-link.ts:52-55` (comment only)

- [ ] **Step 1: Add imports at the top of the test file**

Add below the existing imports in `deposit-link.test.ts`:

```typescript
import { GovernanceHook } from "../hooks/governance-hook.js";
import { getToolGovernanceDecision } from "../governance.js";
import type { TrustLevel } from "../governance-types.js";
```

- [ ] **Step 2: Write the failing (pin) test — new top-level describe block**

Append to `deposit-link.test.ts`. It reuses the module-level `makeDeps`, `TEST_CONTEXT`:

```typescript
describe("deposit.issue governance posture (rides booking approval, no per-issue gate)", () => {
  const TRUST_LEVELS: TrustLevel[] = ["supervised", "guided", "autonomous"];
  const confirmed = () => makeDeps({ id: "bk_1", organizationId: "org_1", status: "confirmed" });

  it("auto-approves at every trust level via the real policy table", () => {
    const op = createDepositLinkToolFactory(confirmed())(TEST_CONTEXT).operations["deposit.issue"]!;
    for (const trustLevel of TRUST_LEVELS) {
      expect(getToolGovernanceDecision(op, trustLevel)).toBe("auto-approve");
    }
  });

  it("the real GovernanceHook lets deposit.issue proceed (never pending_approval/denied)", async () => {
    const tool = createDepositLinkToolFactory(confirmed())(TEST_CONTEXT);
    const hook = new GovernanceHook(new Map([["deposit-link", tool]]));
    for (const trustLevel of TRUST_LEVELS) {
      const result = await hook.beforeToolCall({
        toolId: "deposit-link",
        operation: "deposit.issue",
        params: { bookingId: "bk_1" },
        effectCategory: "read",
        trustLevel,
      });
      expect(result.proceed).toBe(true);
      expect(result.decision).toBeUndefined();
    }
  });

  it("is port-agnostic: the decision never resolves the payment port (live vs Noop is irrelevant)", async () => {
    const paymentPortFactory = vi.fn(async () => {
      throw new Error("port must not be resolved at governance-decision time");
    });
    const tool = createDepositLinkToolFactory({ ...confirmed(), paymentPortFactory })(TEST_CONTEXT);
    const hook = new GovernanceHook(new Map([["deposit-link", tool]]));
    const result = await hook.beforeToolCall({
      toolId: "deposit-link",
      operation: "deposit.issue",
      params: { bookingId: "bk_1" },
      effectCategory: "read",
      trustLevel: "supervised",
    });
    expect(result.proceed).toBe(true);
    expect(paymentPortFactory).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test — expect PASS (pins existing correct behavior)**

Run: `pnpm --filter @switchboard/core test -- deposit-link`
Expected: PASS. (Pin test of already-correct behavior.)

- [ ] **Step 4: Prove the test is NOT vacuous (see it go RED on a regression)**

Temporarily edit `deposit-link.ts:55` `effectCategory: "read" as const,` to `effectCategory: "external_mutation" as const,`.
Run: `pnpm --filter @switchboard/core test -- deposit-link`
Expected: FAIL on supervised and guided (external_mutation maps to require-approval there), the GovernanceHook test returns `proceed: false`. This confirms the test catches a posture regression.
Then REVERT the edit back to `effectCategory: "read" as const,`.

- [ ] **Step 5: Strengthen the rationale comment in `deposit-link.ts`**

Replace the existing block comment at `deposit-link.ts:52-54` (the lines beginning `// 'read': idempotent external read...`) with:

```typescript
        // effectCategory "read": an idempotent, inbound external read on an
        // already-confirmed booking. It must NOT trigger a new approval (spec
        // §8; design record 2026-06-13-deposit-issuance-governance-posture).
        // Rationale, affirmed at go-live:
        //  - Inbound collection, not outbound spend. The codebase auto-approves
        //    inbound recording that carries money (revenue.record) and
        //    require_approves only OUTBOUND spend (spendBearing, F4 #978). A
        //    deposit link asks the customer to pay the clinic; no money moves
        //    until the customer actively pays.
        //  - It rides a higher governance class: the booking (calendar.book) is
        //    external_mutation; this read is strictly downstream of a confirmed
        //    booking.
        //  - A mid-loop per-issue approval is unrepresentable in skill-mode: a
        //    hook pending_approval is re-injected and the loop continues with no
        //    resume (skill-executor.ts), so require-approval here would block
        //    issuance with no human-approve-then-issue path and break the loop,
        //    not supervise it. The deliberate human control lives at per-org
        //    Stripe provisioning (fail-closed) and at booking confirmation.
        // The EffectCategory union has no 'external_read'; 'read' + idempotent is
        // the honest mapping. The posture is pinned by the governance test in
        // this file.
```

- [ ] **Step 6: Run core tests + typecheck**

Run: `pnpm --filter @switchboard/core test -- deposit-link`
Expected: PASS.
Run: `pnpm --filter @switchboard/core typecheck` (or `pnpm typecheck` if faster path is unavailable)
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/tools/deposit-link.ts packages/core/src/skill-runtime/tools/deposit-link.test.ts
git commit -m "test(core): pin deposit.issue auto-approve governance posture"
```

---

### Task 2: API wiring governance-boundary test

**Files:**
- Test: `apps/api/src/bootstrap/__tests__/deposit-link-wiring.test.ts` (add an import + one test)

- [ ] **Step 1: Add the GovernanceHook import**

Add to the imports at the top of `deposit-link-wiring.test.ts`:

```typescript
import { GovernanceHook } from "@switchboard/core/skill-runtime";
```

- [ ] **Step 2: Write the failing (pin) test inside the existing `describe("buildDepositLinkToolFactory", ...)`**

```typescript
  it("the wired tool auto-approves through the real GovernanceHook at every trust level (no wiring-level override)", async () => {
    const { port } = fakePort();
    const tool = buildDepositLinkToolFactory({
      paymentPortFactory: vi.fn(async () => port),
      findBookingById: vi.fn(async () => confirmed),
    })(CTX);
    const hook = new GovernanceHook(new Map([["deposit-link", tool]]));
    for (const trustLevel of ["supervised", "guided", "autonomous"] as const) {
      const result = await hook.beforeToolCall({
        toolId: "deposit-link",
        operation: "deposit.issue",
        params: { bookingId: "bk_1" },
        effectCategory: "read",
        trustLevel,
      });
      expect(result.proceed).toBe(true);
    }
  });
```

- [ ] **Step 3: Run the test — expect PASS**

Run: `pnpm --filter @switchboard/api test -- deposit-link-wiring`
Expected: PASS.

- [ ] **Step 4: Prove non-vacuous**

Temporarily edit `apps/api/src/bootstrap/deposit-link-wiring.ts` to pass a `governanceOverride` that forces require-approval is not directly available there (the override lives on the core op), so instead temporarily edit `packages/core/src/skill-runtime/tools/deposit-link.ts:55` `effectCategory: "read"` to `"external_mutation"`, rebuild core (`pnpm --filter @switchboard/core build`), and run:
Run: `pnpm --filter @switchboard/api test -- deposit-link-wiring`
Expected: FAIL on supervised/guided (proceed false). Then REVERT the core edit and rebuild core.

- [ ] **Step 5: Run api tests + typecheck**

Run: `pnpm --filter @switchboard/api test -- deposit-link-wiring`
Expected: PASS.
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/__tests__/deposit-link-wiring.test.ts
git commit -m "test(api): pin wired deposit-link auto-approve at the governance boundary"
```

---

## Final verification (before PR)

- [ ] `pnpm --filter @switchboard/core test` and `pnpm --filter @switchboard/api test` green
- [ ] `pnpm typecheck` green
- [ ] `pnpm arch:check` green
- [ ] `pnpm format:check` green
- [ ] `pnpm lint` green
- [ ] No env var added, so `scripts/local-verify-fast.ts` is not required by this change
