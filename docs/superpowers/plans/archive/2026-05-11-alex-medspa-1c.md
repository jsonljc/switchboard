# Alex SG/MY Medspa — Phase 1c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PDPA consent state as first-class data on `Contact` (jurisdiction-tagged, distinct from existing `Contact.messagingOptIn` WhatsApp-channel consent), a versioned AI disclosure tracker, a `PdpaConsentGateHook` in the skill-runtime chain after the 1b-2 classifier, an inbound revocation keyword scanner in the channel-gateway (running before the 1b-1 escalation gate), a `ConsentService` as the sole mutation seat, and a `/api/admin/consent/*` admin endpoint contract. All behind `governanceConfig.consentState.mode` (off/observe/enforce), default off.

**Architecture:** Schema extensions in `packages/schemas` (new `pdpa-consent.ts` with the canonical `evaluateConsentGate` helper; extend `GovernanceVerdictReasonSchema`; add `ConsentStateConfigSchema` + `resolveConsentStateConfig` to existing `governance-config.ts`). New consent package under `packages/core/src/consent/` for errors, disclosure copy, revocation keyword tables, revocation scanner, revocation ack copy, `ContactConsentReader` interface, and `ConsentService` factory. Prisma Contact extension + migration in `packages/db`, plus Prisma adapters for `ContactConsentReader` and the `ConsentService` mutation surface. New `PdpaConsentGateHook` in `packages/core/src/skill-runtime/hooks/`. Channel-gateway revocation scanner inserted into the existing `runPreInputGate` flow (before the 1b-1 escalation gate). Admin endpoint at `apps/api/src/routes/admin-consent.ts`. Bootstrap wiring in `apps/api/src/bootstrap/skill-mode.ts` with a third `InMemoryGovernancePostureCache` instance (consentState-mode scoped, shared between gateway revocation scanner and runtime hook).

**Tech Stack:** TypeScript ESM, Zod, Vitest, Prisma, pnpm workspaces, Turbo, Fastify (admin route). Follows established `prisma-store` + `SkillHook` + `runPreInputGate` patterns. No model calls — entirely deterministic.

**Spec:** `docs/superpowers/specs/2026-05-11-alex-medspa-1c-consent-state-design.md`

**Out of scope for Phase 1c (deferred — do not bleed in):**

- Phase 1d — WhatsApp 24h window detection, template registration, proactive sender (`messageClass: "proactive"` call site)
- Phase 2 — operator dashboard surface for consent state, revocation history, disclosure timeline
- Phase 3 — outcome tagging, pattern detection on consent-revoked conversations
- Marketing-vs-data-processing two-axis consent
- Re-grant after revocation by user text (admin `clearConsent` resets cycle)
- Hardened (non-substring) disclosure detection
- Revocation-intent classifier
- Multi-deployment jurisdiction reconciliation per Contact
- Multi-match revocation analytics (`matches[0]` only in 1c)
- Dashboard UI for admin endpoints
- Persistent / cross-instance posture cache

---

## Plan hardening notes

These rules apply across all tasks. They are load-bearing for clean execution.

- **Prerequisites: Phase 1a (PR #409), 1b-1 (#429), 1b-2 (#431) are all on `main`.** Pre-flight rebases this branch onto `main` so the consent gate is layered atop the deterministic gate + classifier + their shared infrastructure (`GovernanceConfigResolver`, `GovernanceVerdictStore`, `GovernancePostureCache`, `buildHandoffPackage`, `runPreInputGate`, `renderHandoffTemplate`).
- **Schema enum changes are atomic with their consumers.** Task 1 extends `GovernanceVerdictReasonSchema` with six new entries; the same commit updates any fixture tests that exhaustively enumerate reasons so `packages/schemas` stays green between commits.
- **No `console.log`.** Use `console.error` for fail-open / fail-closed branches, jurisdiction-mismatch handling, persistence-failure-of-action paths. Use `console.warn` for soft authoring warnings (e.g., duplicate revocation-keyword patterns). Lint will flag `console.log`.
- **No production `any`.** Resolver, service, store, and reader types in `src/` are explicitly typed. Test-only narrow casts via `as any` (with an `eslint-disable-next-line @typescript-eslint/no-explicit-any` comment on the same line) are permitted in `__tests__/*` files for mocking Prisma and constructing minimal `SkillHookContext` / `SkillExecutionResult` fixtures. The escape is bounded to mock construction; do not propagate `any` into the system under test.
- **Layer rules.** `packages/schemas` (Layer 1) has no `@switchboard/*` imports. `packages/core` (Layer 3) imports schemas + sdk + cartridge-sdk only — never `packages/db`. Prisma adapters for the `ConsentService` mutation surface and `ContactConsentReader` live in `packages/db` (Layer 4) and depend on interfaces declared in core.
- **Tests use mocked Prisma.** Per `feedback_api_test_mocked_prisma.md`, db tests mock the Prisma client. Don't require a running PostgreSQL for `pnpm test` to pass.
- **`pnpm db:check-drift` requires a running PostgreSQL.** If unreachable in the implementation environment, follow 1b-1's pattern: skip locally and document in the PR body. At minimum `pnpm db:generate` must succeed after schema edits.
- **Hook order is part of definition-of-done for Task 13.** Spec Section 7 asserts `DeterministicSafetyGateHook` → `ClaimClassifierHook` → `PdpaConsentGateHook` → `TracePersistenceHook`. Task 13's registration test re-asserts this contract: a test fails if any new hook lands between `PdpaConsentGateHook` and `TracePersistenceHook`.
- **Third posture cache instance.** Spec Section 7 mandates a third `InMemoryGovernancePostureCache` (distinct from 1b-1's `deterministicGate` cache and 1b-2's `claimClassifier` cache), shared between the gateway revocation scanner and the runtime hook (both consult `consentState.mode`). Task 13 constructs this instance.
- **Hook contract matches the runtime.** `SkillHook.afterSkill(ctx, result): Promise<void>` — two args, returns void, mutates `result.response` in place. `SkillExecutionResult.response` is a **single string** (defense-in-depth revoked block replaces the whole string with the handoff template; rewrites are not used in 1c). `SkillHookContext` has no `conversationId` — verdict's `conversationId` is sourced from `ctx.sessionId`, same convention as 1b-1/1b-2.
- **Revocation runs before the 1b-1 escalation gate** in the gateway. Spec Section 6.1 + Section 6.3. Concrete insertion point: `packages/core/src/channel-gateway/channel-gateway.ts` immediately before the existing `runPreInputGate(...)` call (~line 186). Task 11 captures this.
- **Disclosure validation NEVER blocks.** Even in enforce mode, `disclosure_not_shown` and `disclosure_version_outdated` are `auditLevel: "warning"` verdicts that pass `result.response` through unchanged. Disclosure drift must never cause production outage. Asserted by a dedicated test branch in Task 10.
- **`ConsentJurisdictionMismatch` inside the hook does not block** but emits `auditLevel: "critical"` verdict with `reasonCode: "jurisdiction_mismatch"` + `console.error`. Same Task 10. Admin endpoint surface (Task 12) maps the throw to HTTP 400.
- **Revocation is idempotent.** Second `recordRevocation` is a no-op (first timestamp preserved). Test-asserted in Task 9.
- **Disclosure ↔ consent structural separation.** No service method writes both. Dedicated orthogonality test suite in Task 9.
- **`pdpaJurisdiction` is immutable after first non-null write in v1.** Service throws `ConsentJurisdictionMismatch` on divergent input. Codified by comment on Prisma field + service-side throw + test.
- **Conservative seed tables, not placeholders.** Task 6 seeds revocation keyword tables with real baseline entries per Section 4.2; Task 7 ships disclosure + ack copy per Section 4.1/4.3.
- **Reference markdown stays in sync (informally).** When seed tables land, the `skills/alex/references/regulatory/{sg,my}-rules.md` files gain a "Runtime PDPA consent gate" section that points at the TS file paths. MD is not load-bearing, not parsed. Task 14 covers this.

---

## File structure

**`packages/schemas/` (Layer 1):**

- `src/pdpa-consent.ts` — NEW. Jurisdiction / status / source enums, `ContactConsentStateSchema`, `AI_DISCLOSURE_VERSIONS`, `MessageClass`, `ConsentGateDecision`, `evaluateConsentGate`, `deriveConsentStatus`.
- `src/governance-verdict.ts` — extend `GovernanceVerdictReasonSchema` (six new entries).
- `src/governance-config.ts` — extend with `ConsentStateConfigSchema` + `resolveConsentStateConfig` helper.
- `src/index.ts` — re-export new types.
- `src/__tests__/pdpa-consent.test.ts` — NEW. Schema round-trips, `deriveConsentStatus`, `evaluateConsentGate` exhaustive matrix.
- `src/__tests__/governance-config.test.ts` — extend with consent-state sub-block tests.

**`packages/db/`:**

- `prisma/schema.prisma` — extend `Contact` model with eight nullable PDPA fields + two indexes.
- `prisma/migrations/<timestamp>_alex_medspa_1c_pdpa_contact/migration.sql` — NEW migration.
- `src/prisma-contact-consent-reader.ts` — NEW Prisma adapter for `ContactConsentReader`.
- `src/prisma-consent-store.ts` — NEW Prisma adapter for the `ConsentService` mutation surface.
- `src/__tests__/prisma-contact-consent-reader.test.ts` — NEW.
- `src/__tests__/prisma-consent-store.test.ts` — NEW.

**`packages/core/src/consent/` (NEW directory):**

- `errors.ts` — `ConsentJurisdictionMismatch`, `ConsentRevokedCannotRegrant`, `ContactNotFound`.
- `disclosure-copy.ts` — `DISCLOSURE_COPY` per-jurisdiction records.
- `revocation-ack.ts` — `REVOCATION_ACK` per-jurisdiction records.
- `revocation-keywords/types.ts` — `RevocationKeywordEntry`.
- `revocation-keywords/common.ts` — jurisdiction-agnostic baseline.
- `revocation-keywords/sg.ts` — SG-specific.
- `revocation-keywords/my.ts` — MY-specific.
- `revocation-keywords/loader.ts` — `loadRevocationKeywords(jurisdiction)` + boot-time assertions.
- `revocation-keywords/index.ts` — barrel.
- `scanner/revocation-keyword-scanner.ts` — `scanForRevocationKeywords(text, entries)` pure function.
- `contact-consent-reader.ts` — `ContactConsentReader` interface.
- `consent-store.ts` — `ConsentStateStore` interface (Prisma-impl seam).
- `consent-service.ts` — `ConsentService` interface + factory (the sole mutation seat).
- `__tests__/` for each of the above.

**`packages/core/src/skill-runtime/hooks/`:**

- `pdpa-consent-gate.ts` — NEW. `PdpaConsentGateHook`.
- `__tests__/pdpa-consent-gate.test.ts` — NEW.

**`packages/core/src/channel-gateway/`:**

- `pre-input-gate.ts` — extend to call the consent revocation scanner before the existing escalation-trigger scan.
- `types.ts` — extend `ChannelGatewayConfig` with new consent-related deps.
- `__tests__/pre-input-gate-consent.test.ts` — NEW.

**`apps/api/`:**

- `src/routes/admin-consent.ts` — NEW. Four routes (`grant`, `revoke`, `clear`, GET state).
- `src/bootstrap/skill-mode.ts` — wire ConsentService, third posture cache, `PdpaConsentGateHook`, and gateway revocation scanner deps.
- `src/__tests__/admin-consent.test.ts` — NEW.
- `src/__tests__/skill-mode-hook-ordering.test.ts` — extend (or NEW if not present) to assert the four-hook chain ordering invariant.

**Documentation:**

- `skills/alex/references/regulatory/sg-rules.md` — append "Runtime PDPA consent gate (1c)" section.
- `skills/alex/references/regulatory/my-rules.md` — same.
- `docs/superpowers/plans/2026-05-11-alex-medspa-1c-followups.md` — NEW. Pilot-tenant disclosure-copy reviewer, regulatory-review handoff for revocation keywords, Phase 1d's `messageClass: "proactive"` call site.

---

## Pre-flight

- [ ] **Step P1: Confirm worktree and branch**

```bash
cd /Users/jasonli/switchboard
git branch --show-current
```

Expected: `docs/alex-medspa-1c-consent-spec`

- [ ] **Step P2: Confirm prerequisites on `main`**

```bash
git fetch origin main
git log --oneline origin/main | head -5
ls packages/schemas/src/governance-config.ts
ls packages/core/src/governance/governance-config-resolver.ts
ls packages/core/src/governance/posture-cache.ts
ls packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts
ls packages/core/src/skill-runtime/hooks/claim-classifier.ts
ls packages/core/src/handoff/build-handoff-package.ts
ls packages/core/src/channel-gateway/pre-input-gate.ts
ls packages/core/src/governance/governance-verdict-store/types.ts
```

Expected: all paths exist; recent commits include `6468e763 feat(alex): SG/MY medspa Phase 1b-2`, `d817a62f feat(alex): SG/MY medspa Phase 1b-1`, `446ff379 feat(alex): SG/MY medspa Phase 1a`.

- [ ] **Step P3: Rebase onto `main`**

```bash
git rebase origin/main
```

Resolve any conflicts (none expected — only `docs/superpowers/specs/2026-05-11-alex-medspa-1c-consent-state-design.md` on this branch).

- [ ] **Step P4: Install + baseline build**

```bash
pnpm install
pnpm reset
pnpm typecheck
pnpm test
```

Expected: clean baseline. If anything is red on `main`, fix before continuing — do not start 1c implementation on a broken baseline.

---

## Task 1: Extend `GovernanceVerdictReasonSchema` with 1c consent reasons

**Files:**

- Modify: `packages/schemas/src/governance-verdict.ts`
- Modify (if exhaustive enum tests exist): `packages/schemas/src/__tests__/governance-verdict.test.ts`
- Test: `packages/schemas/src/__tests__/governance-verdict.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/schemas/src/__tests__/governance-verdict.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GovernanceVerdictReasonSchema } from "../governance-verdict.js";

describe("GovernanceVerdictReasonSchema — Phase 1c additions", () => {
  it.each([
    "consent_pending",
    "consent_revoked",
    "disclosure_not_shown",
    "disclosure_version_outdated",
    "consent_cycle_reset",
    "jurisdiction_mismatch",
  ])("accepts %s", (reason) => {
    expect(GovernanceVerdictReasonSchema.parse(reason)).toBe(reason);
  });

  it("still accepts pre-1c reasons", () => {
    expect(GovernanceVerdictReasonSchema.parse("allowed")).toBe("allowed");
    expect(GovernanceVerdictReasonSchema.parse("banned_phrase")).toBe("banned_phrase");
    expect(GovernanceVerdictReasonSchema.parse("classifier_timeout")).toBe("classifier_timeout");
  });

  it("rejects unknown reasons", () => {
    expect(() => GovernanceVerdictReasonSchema.parse("not_a_reason")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test -- governance-verdict
```

Expected: 6 new cases fail with Zod parse errors (`consent_pending`, `consent_revoked`, etc. not in enum).

- [ ] **Step 3: Add the six reasons to the enum**

Edit `packages/schemas/src/governance-verdict.ts`:

```ts
export const GovernanceVerdictReasonSchema = z.enum([
  "allowed",
  "banned_phrase",
  "unsupported_claim",
  "medical_safety_trigger",
  "sensitive_inbound",
  "compliance_concern",
  "governance_unavailable",
  "outside_whatsapp_window",
  "consent_missing",
  "classifier_timeout",
  "classifier_error",
  "unsupported_claim_rewritten",
  "unsupported_claim_escalated",
  "claim_substantiation_stale",
  // Phase 1c additions
  "consent_pending",
  "consent_revoked",
  "disclosure_not_shown",
  "disclosure_version_outdated",
  "consent_cycle_reset",
  "jurisdiction_mismatch",
]);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/schemas test -- governance-verdict
```

Expected: PASS.

- [ ] **Step 5: Rebuild schemas package**

```bash
pnpm --filter @switchboard/schemas build
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/governance-verdict.ts packages/schemas/src/__tests__/governance-verdict.test.ts
git commit -m "feat(schemas): extend governanceverdictreasonschema with 1c consent reasons"
```

Note: commitlint requires lowercase subject. The subject above uses lowercase except for backticks; if commitlint rejects, use plain words: `feat(schemas): extend governance verdict reason schema with 1c consent reasons`.

---

## Task 2: New `packages/schemas/src/pdpa-consent.ts` — types + canonical helpers

**Files:**

- Create: `packages/schemas/src/pdpa-consent.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/__tests__/pdpa-consent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/pdpa-consent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PdpaJurisdictionSchema,
  ConsentStatusSchema,
  ConsentSourceSchema,
  ContactConsentStateSchema,
  AI_DISCLOSURE_VERSIONS,
  deriveConsentStatus,
  evaluateConsentGate,
  type ContactConsentState,
} from "../pdpa-consent.js";

describe("PdpaJurisdictionSchema", () => {
  it.each(["SG", "MY"])("accepts %s", (j) => {
    expect(PdpaJurisdictionSchema.parse(j)).toBe(j);
  });
  it("rejects unknown jurisdictions", () => {
    expect(() => PdpaJurisdictionSchema.parse("US")).toThrow();
  });
});

describe("ConsentSourceSchema", () => {
  it.each([
    "whatsapp_quick_reply",
    "ig_dm_reply",
    "web_form",
    "operator_recorded",
    "inbound_keyword_revocation",
    "operator_recorded_revocation",
  ])("accepts %s", (s) => {
    expect(ConsentSourceSchema.parse(s)).toBe(s);
  });
});

describe("ContactConsentStateSchema", () => {
  it("round-trips null-everywhere state", () => {
    const empty: ContactConsentState = {
      pdpaJurisdiction: null,
      consentGrantedAt: null,
      consentRevokedAt: null,
      consentSource: null,
      aiDisclosureVersionShown: null,
      aiDisclosureShownAt: null,
      consentUpdatedBy: null,
      consentNotes: null,
    };
    expect(ContactConsentStateSchema.parse(empty)).toEqual(empty);
  });

  it("round-trips fully-populated state", () => {
    const full: ContactConsentState = {
      pdpaJurisdiction: "MY",
      consentGrantedAt: "2026-05-11T10:00:00.000Z",
      consentRevokedAt: null,
      consentSource: "whatsapp_quick_reply",
      aiDisclosureVersionShown: "my-disclosure@1.0.0",
      aiDisclosureShownAt: "2026-05-11T09:59:00.000Z",
      consentUpdatedBy: "system:skill_runtime",
      consentNotes: null,
    };
    expect(ContactConsentStateSchema.parse(full)).toEqual(full);
  });
});

describe("AI_DISCLOSURE_VERSIONS", () => {
  it("exports SG and MY constants", () => {
    expect(AI_DISCLOSURE_VERSIONS.SG).toBe("sg-disclosure@1.0.0");
    expect(AI_DISCLOSURE_VERSIONS.MY).toBe("my-disclosure@1.0.0");
  });
});

describe("deriveConsentStatus", () => {
  it("null jurisdiction → not_applicable", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: null,
        consentGrantedAt: null,
        consentRevokedAt: null,
      }),
    ).toBe("not_applicable");
  });

  it("jurisdiction set, no grant, no revoke → pending", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: "SG",
        consentGrantedAt: null,
        consentRevokedAt: null,
      }),
    ).toBe("pending");
  });

  it("grant set, no revoke → granted", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: "MY",
        consentGrantedAt: new Date("2026-05-01"),
        consentRevokedAt: null,
      }),
    ).toBe("granted");
  });

  it("revoke set → revoked (even with grant present)", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: "MY",
        consentGrantedAt: new Date("2026-05-01"),
        consentRevokedAt: new Date("2026-05-10"),
      }),
    ).toBe("revoked");
  });

  it("revoke wins even when revoke timestamp predates grant (defensive)", () => {
    expect(
      deriveConsentStatus({
        pdpaJurisdiction: "MY",
        consentGrantedAt: new Date("2026-05-10"),
        consentRevokedAt: new Date("2026-05-01"),
      }),
    ).toBe("revoked");
  });
});

describe("evaluateConsentGate", () => {
  const base = { pdpaJurisdiction: null, consentGrantedAt: null, consentRevokedAt: null };

  // 8-case matrix: 4 statuses × 2 message classes
  it("operational + not_applicable → allow", () => {
    expect(evaluateConsentGate({ contact: base, messageClass: "operational" })).toEqual({
      action: "allow",
      status: "not_applicable",
    });
  });

  it("operational + pending → allow", () => {
    expect(
      evaluateConsentGate({
        contact: { pdpaJurisdiction: "SG", consentGrantedAt: null, consentRevokedAt: null },
        messageClass: "operational",
      }),
    ).toEqual({ action: "allow", status: "pending" });
  });

  it("operational + granted → allow", () => {
    expect(
      evaluateConsentGate({
        contact: {
          pdpaJurisdiction: "MY",
          consentGrantedAt: new Date("2026-05-01"),
          consentRevokedAt: null,
        },
        messageClass: "operational",
      }),
    ).toEqual({ action: "allow", status: "granted" });
  });

  it("operational + revoked → block (consent_revoked)", () => {
    expect(
      evaluateConsentGate({
        contact: {
          pdpaJurisdiction: "MY",
          consentGrantedAt: new Date("2026-05-01"),
          consentRevokedAt: new Date("2026-05-10"),
        },
        messageClass: "operational",
      }),
    ).toEqual({ action: "block", status: "revoked", reasonCode: "consent_revoked" });
  });

  it("proactive + not_applicable → allow", () => {
    expect(evaluateConsentGate({ contact: base, messageClass: "proactive" })).toEqual({
      action: "allow",
      status: "not_applicable",
    });
  });

  it("proactive + pending → block (consent_pending)", () => {
    expect(
      evaluateConsentGate({
        contact: { pdpaJurisdiction: "SG", consentGrantedAt: null, consentRevokedAt: null },
        messageClass: "proactive",
      }),
    ).toEqual({ action: "block", status: "pending", reasonCode: "consent_pending" });
  });

  it("proactive + granted → allow", () => {
    expect(
      evaluateConsentGate({
        contact: {
          pdpaJurisdiction: "MY",
          consentGrantedAt: new Date("2026-05-01"),
          consentRevokedAt: null,
        },
        messageClass: "proactive",
      }),
    ).toEqual({ action: "allow", status: "granted" });
  });

  it("proactive + revoked → block (consent_revoked)", () => {
    expect(
      evaluateConsentGate({
        contact: {
          pdpaJurisdiction: "MY",
          consentGrantedAt: null,
          consentRevokedAt: new Date("2026-05-10"),
        },
        messageClass: "proactive",
      }),
    ).toEqual({ action: "block", status: "revoked", reasonCode: "consent_revoked" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test -- pdpa-consent
```

Expected: file-not-found / module-not-found errors.

- [ ] **Step 3: Create `packages/schemas/src/pdpa-consent.ts`**

```ts
import { z } from "zod";

export const PdpaJurisdictionSchema = z.enum(["SG", "MY"]);
export type PdpaJurisdiction = z.infer<typeof PdpaJurisdictionSchema>;

export const ConsentStatusSchema = z.enum(["not_applicable", "pending", "granted", "revoked"]);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

export const ConsentSourceSchema = z.enum([
  "whatsapp_quick_reply",
  "ig_dm_reply",
  "web_form",
  "operator_recorded",
  "inbound_keyword_revocation",
  "operator_recorded_revocation",
]);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

export const ContactConsentStateSchema = z.object({
  pdpaJurisdiction: PdpaJurisdictionSchema.nullable(),
  consentGrantedAt: z.string().datetime().nullable(),
  consentRevokedAt: z.string().datetime().nullable(),
  consentSource: ConsentSourceSchema.nullable(),
  aiDisclosureVersionShown: z.string().nullable(),
  aiDisclosureShownAt: z.string().datetime().nullable(),
  consentUpdatedBy: z.string().nullable(),
  consentNotes: z.string().nullable(),
});
export type ContactConsentState = z.infer<typeof ContactConsentStateSchema>;

/**
 * Versioned per-jurisdiction AI disclosure copy. Stamped onto Contact when shown.
 * Regulatory artifact — PR review is the change-management surface, NOT per-tenant config.
 */
export const AI_DISCLOSURE_VERSIONS = {
  SG: "sg-disclosure@1.0.0",
  MY: "my-disclosure@1.0.0",
} as const;

export type MessageClass = "operational" | "proactive";

export type ConsentGateDecision =
  | { action: "allow"; status: ConsentStatus }
  | {
      action: "block";
      status: ConsentStatus;
      reasonCode: "consent_pending" | "consent_revoked";
    };

/**
 * Single source of truth: revocation precedence enforced by construction.
 * Revoked short-circuits before granted is consulted.
 *
 * Re-grant after revocation is NOT supported by this function — admin
 * clearConsent must explicitly null both timestamps to start a fresh cycle.
 */
export function deriveConsentStatus(c: {
  pdpaJurisdiction: PdpaJurisdiction | null;
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
}): ConsentStatus {
  if (!c.pdpaJurisdiction) return "not_applicable";
  if (c.consentRevokedAt) return "revoked";
  if (c.consentGrantedAt) return "granted";
  return "pending";
}

/**
 * Canonical consent-gate policy. Imported by:
 *   - PdpaConsentGateHook (always passes messageClass="operational")
 *   - Phase 1d proactive sender (passes messageClass="proactive")
 *   - admin / dashboard preview surfaces
 *
 * Matrix (jurisdiction-agnostic — SG/MY substantive difference is expressed
 * by WHEN grant capture is requested, not by branching here):
 *
 * | messageClass | not_applicable | pending                  | granted | revoked                  |
 * |--------------|----------------|--------------------------|---------|--------------------------|
 * | operational  | allow          | allow                    | allow   | block (consent_revoked)¹ |
 * | proactive    | allow          | block (consent_pending)  | allow   | block (consent_revoked)  |
 *
 * ¹ Defense-in-depth: gateway revocation scanner flips conversation to
 *   human_override which upstream-suppresses bot turns. Hook still blocks on
 *   revoked to catch races between gateway intake and skill emission.
 */
export function evaluateConsentGate(input: {
  contact: Pick<
    ContactConsentState,
    "pdpaJurisdiction" | "consentGrantedAt" | "consentRevokedAt"
  > & {
    consentGrantedAt: Date | string | null;
    consentRevokedAt: Date | string | null;
  };
  messageClass: MessageClass;
}): ConsentGateDecision {
  const status = deriveConsentStatus(input.contact);

  if (status === "revoked") {
    return { action: "block", status, reasonCode: "consent_revoked" };
  }
  if (input.messageClass === "proactive" && status === "pending") {
    return { action: "block", status, reasonCode: "consent_pending" };
  }
  return { action: "allow", status };
}
```

- [ ] **Step 4: Add exports to `packages/schemas/src/index.ts`**

Append to the existing exports:

```ts
export * from "./pdpa-consent.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @switchboard/schemas test -- pdpa-consent
pnpm --filter @switchboard/schemas build
```

Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/pdpa-consent.ts packages/schemas/src/index.ts packages/schemas/src/__tests__/pdpa-consent.test.ts
git commit -m "feat(schemas): add pdpa consent types and canonical gate helpers"
```

---

## Task 3: Extend `governance-config.ts` with `ConsentStateConfigSchema`

**Files:**

- Modify: `packages/schemas/src/governance-config.ts`
- Modify: `packages/schemas/src/__tests__/governance-config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/schemas/src/__tests__/governance-config.test.ts`:

```ts
import {
  ConsentStateConfigSchema,
  resolveConsentStateConfig,
  GovernanceConfigSchema,
} from "../governance-config.js";

describe("ConsentStateConfigSchema", () => {
  it("defaults mode to off", () => {
    expect(ConsentStateConfigSchema.parse({})).toEqual({ mode: "off" });
  });

  it("accepts explicit observe / enforce", () => {
    expect(ConsentStateConfigSchema.parse({ mode: "observe" })).toEqual({ mode: "observe" });
    expect(ConsentStateConfigSchema.parse({ mode: "enforce" })).toEqual({ mode: "enforce" });
  });

  it("rejects unknown modes", () => {
    expect(() => ConsentStateConfigSchema.parse({ mode: "audit" })).toThrow();
  });
});

describe("resolveConsentStateConfig", () => {
  it("returns default when config is null", () => {
    expect(resolveConsentStateConfig(null)).toEqual({ mode: "off" });
  });

  it("returns default when sub-block is absent", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "SG",
      clinicType: "medical",
    });
    expect(resolveConsentStateConfig(config)).toEqual({ mode: "off" });
  });

  it("reads sub-block via passthrough", () => {
    const config = GovernanceConfigSchema.parse({
      jurisdiction: "MY",
      clinicType: "nonMedical",
      consentState: { mode: "enforce" },
    });
    expect(resolveConsentStateConfig(config)).toEqual({ mode: "enforce" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test -- governance-config
```

Expected: fails with import errors (`ConsentStateConfigSchema` and `resolveConsentStateConfig` not exported).

- [ ] **Step 3: Add to `packages/schemas/src/governance-config.ts`**

Append below the existing exports:

```ts
/**
 * Per-deployment configuration for the PDPA consent gate (Phase 1c).
 * Lives under `governanceConfig.consentState` as a passthrough sub-block —
 * no Prisma migration of the config column itself; 1b-1's `.passthrough()`
 * already accepts arbitrary sub-blocks.
 *
 * Defaults: mode="off" (pure pass-through; no consent state mutation, no
 * revocation detection, no verdicts). Promote to "observe" for telemetry-only
 * rollout, then "enforce" for production behavior.
 */
export const ConsentStateConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
  })
  .default({});

export type ConsentStateConfig = z.infer<typeof ConsentStateConfigSchema>;

export function resolveConsentStateConfig(config: GovernanceConfig | null): ConsentStateConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.consentState;
  return ConsentStateConfigSchema.parse(raw ?? {});
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/schemas test -- governance-config
pnpm --filter @switchboard/schemas build
```

Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/governance-config.ts packages/schemas/src/__tests__/governance-config.test.ts
git commit -m "feat(schemas): add consentstateconfig sub-block and resolver"
```

---

## Task 4: Prisma — Contact PDPA fields + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (`Contact` model)
- Create: `packages/db/prisma/migrations/<timestamp>_alex_medspa_1c_pdpa_contact/migration.sql`

- [ ] **Step 1: Edit `packages/db/prisma/schema.prisma`**

Inside `model Contact { ... }`, before the `@@unique` / `@@index` declarations, add:

```prisma
  // PDPA consent state (Phase 1c). Jurisdiction-tagged data-subject consent.
  // Distinct from `messagingOptIn` (WhatsApp 24h template-send consent).
  // pdpaJurisdiction is immutable after first non-null write in v1 — only
  // ConsentService mutates these; service throws ConsentJurisdictionMismatch
  // on attempt to write a different jurisdiction.
  pdpaJurisdiction         String?
  consentGrantedAt         DateTime?
  consentRevokedAt         DateTime?
  consentSource            String?
  aiDisclosureVersionShown String?
  aiDisclosureShownAt      DateTime?
  consentUpdatedBy         String?
  consentNotes             String?   @db.Text
```

Then add two new index lines alongside the existing `@@index` declarations:

```prisma
  @@index([organizationId, pdpaJurisdiction, consentRevokedAt])
  @@index([organizationId, pdpaJurisdiction, consentGrantedAt])
```

- [ ] **Step 2: Generate the migration SQL**

If Postgres reachable:

```bash
pnpm db:migrate-diff --name alex_medspa_1c_pdpa_contact
```

Or fall back to the established TTY-free workflow:

```bash
cd packages/db
pnpm prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/$(date +%Y%m%d%H%M%S)_alex_medspa_1c_pdpa_contact/migration.sql
```

The generated SQL should contain eight `ALTER TABLE "Contact" ADD COLUMN ...` statements plus two `CREATE INDEX` statements. No data backfill.

If Postgres unreachable, hand-author the migration file at `packages/db/prisma/migrations/<timestamp>_alex_medspa_1c_pdpa_contact/migration.sql`:

```sql
ALTER TABLE "Contact" ADD COLUMN "pdpaJurisdiction" TEXT;
ALTER TABLE "Contact" ADD COLUMN "consentGrantedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "consentRevokedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "consentSource" TEXT;
ALTER TABLE "Contact" ADD COLUMN "aiDisclosureVersionShown" TEXT;
ALTER TABLE "Contact" ADD COLUMN "aiDisclosureShownAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "consentUpdatedBy" TEXT;
ALTER TABLE "Contact" ADD COLUMN "consentNotes" TEXT;

CREATE INDEX "Contact_organizationId_pdpaJurisdiction_consentRevokedAt_idx"
  ON "Contact"("organizationId", "pdpaJurisdiction", "consentRevokedAt");
CREATE INDEX "Contact_organizationId_pdpaJurisdiction_consentGrantedAt_idx"
  ON "Contact"("organizationId", "pdpaJurisdiction", "consentGrantedAt");
```

- [ ] **Step 3: Regenerate Prisma client + check drift**

```bash
pnpm db:generate
```

Expected: clean.

If Postgres reachable:

```bash
pnpm db:check-drift
```

Expected: no drift after the migration is applied.

- [ ] **Step 4: Rebuild db package**

```bash
pnpm --filter @switchboard/db build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add pdpa consent state fields to contact"
```

---

## Task 5: `packages/core/src/consent/errors.ts`

**Files:**

- Create: `packages/core/src/consent/errors.ts`
- Test: `packages/core/src/consent/__tests__/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/consent/__tests__/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  ContactNotFound,
} from "../errors.js";

describe("ConsentJurisdictionMismatch", () => {
  it("carries stamped + provided properties", () => {
    const err = new ConsentJurisdictionMismatch({
      contactId: "c1",
      stamped: "SG",
      provided: "MY",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConsentJurisdictionMismatch");
    expect(err.contactId).toBe("c1");
    expect(err.stamped).toBe("SG");
    expect(err.provided).toBe("MY");
  });
});

describe("ConsentRevokedCannotRegrant", () => {
  it("carries contactId and revokedAt", () => {
    const at = new Date("2026-05-10");
    const err = new ConsentRevokedCannotRegrant({ contactId: "c1", revokedAt: at });
    expect(err.name).toBe("ConsentRevokedCannotRegrant");
    expect(err.contactId).toBe("c1");
    expect(err.revokedAt).toEqual(at);
  });
});

describe("ContactNotFound", () => {
  it("carries contactId", () => {
    const err = new ContactNotFound({ contactId: "c1" });
    expect(err.name).toBe("ContactNotFound");
    expect(err.contactId).toBe("c1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test -- consent/__tests__/errors
```

Expected: module-not-found.

- [ ] **Step 3: Create `packages/core/src/consent/errors.ts`**

```ts
import type { PdpaJurisdiction } from "@switchboard/schemas";

export class ConsentJurisdictionMismatch extends Error {
  readonly contactId: string;
  readonly stamped: PdpaJurisdiction;
  readonly provided: PdpaJurisdiction;
  constructor(input: { contactId: string; stamped: PdpaJurisdiction; provided: PdpaJurisdiction }) {
    super(
      `Consent jurisdiction mismatch on contact ${input.contactId}: stamped=${input.stamped}, provided=${input.provided}`,
    );
    this.name = "ConsentJurisdictionMismatch";
    this.contactId = input.contactId;
    this.stamped = input.stamped;
    this.provided = input.provided;
  }
}

export class ConsentRevokedCannotRegrant extends Error {
  readonly contactId: string;
  readonly revokedAt: Date;
  constructor(input: { contactId: string; revokedAt: Date }) {
    super(
      `Contact ${input.contactId} has revoked consent at ${input.revokedAt.toISOString()}; use clearConsent to start a fresh cycle.`,
    );
    this.name = "ConsentRevokedCannotRegrant";
    this.contactId = input.contactId;
    this.revokedAt = input.revokedAt;
  }
}

export class ContactNotFound extends Error {
  readonly contactId: string;
  constructor(input: { contactId: string }) {
    super(`Contact not found: ${input.contactId}`);
    this.name = "ContactNotFound";
    this.contactId = input.contactId;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/core test -- consent/__tests__/errors
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/consent/errors.ts packages/core/src/consent/__tests__/errors.test.ts
git commit -m "feat(core): add consent service error classes"
```

---

## Task 6: Disclosure copy + revocation ack

**Files:**

- Create: `packages/core/src/consent/disclosure-copy.ts`
- Create: `packages/core/src/consent/revocation-ack.ts`
- Test: `packages/core/src/consent/__tests__/disclosure-copy.test.ts`
- Test: `packages/core/src/consent/__tests__/revocation-ack.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/consent/__tests__/disclosure-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AI_DISCLOSURE_VERSIONS } from "@switchboard/schemas";
import { DISCLOSURE_COPY } from "../disclosure-copy.js";

describe("DISCLOSURE_COPY", () => {
  it("has SG and MY records with the AI_DISCLOSURE_VERSIONS version", () => {
    expect(DISCLOSURE_COPY.SG.version).toBe(AI_DISCLOSURE_VERSIONS.SG);
    expect(DISCLOSURE_COPY.MY.version).toBe(AI_DISCLOSURE_VERSIONS.MY);
  });

  it("SG text introduces Alex as the clinic's AI assistant (transparency posture)", () => {
    expect(DISCLOSURE_COPY.SG.text).toMatch(/AI assistant/i);
    expect(DISCLOSURE_COPY.SG.text).toMatch(/clinic/i);
  });

  it("MY text includes the explicit consent prompt (PDPA explicit-consent regime)", () => {
    expect(DISCLOSURE_COPY.MY.text).toMatch(/AI assistant/i);
    expect(DISCLOSURE_COPY.MY.text).toMatch(/Reply OK/i);
    expect(DISCLOSURE_COPY.MY.text).toMatch(/STOP/i);
  });

  it("matches frozen snapshots (prevents accidental copy drift)", () => {
    expect(DISCLOSURE_COPY).toMatchSnapshot();
  });
});
```

`packages/core/src/consent/__tests__/revocation-ack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { REVOCATION_ACK } from "../revocation-ack.js";

describe("REVOCATION_ACK", () => {
  it("acknowledges revocation without medical/safety language", () => {
    expect(REVOCATION_ACK.SG).toMatch(/won't message you/i);
    expect(REVOCATION_ACK.MY).toMatch(/stop messaging/i);
  });

  it("matches frozen snapshots", () => {
    expect(REVOCATION_ACK).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- consent/__tests__/disclosure-copy consent/__tests__/revocation-ack
```

Expected: module-not-found.

- [ ] **Step 3: Create `packages/core/src/consent/disclosure-copy.ts`**

```ts
import { AI_DISCLOSURE_VERSIONS, type PdpaJurisdiction } from "@switchboard/schemas";

/**
 * Versioned AI disclosure copy per jurisdiction.
 *
 * SG is a transparency disclosure aligned with PDPC's 2024 AI advisory.
 * MY includes the consent prompt because MY PDPA requires explicit consent
 * before personal-data processing.
 *
 * v1 deterministic heuristic, not compliance-proof validation — punctuation,
 * whitespace, and markdown drift will break PdpaConsentGateHook substring
 * detection. Hardened detection is deferred until disclosure copy stabilizes.
 *
 * Regulatory-review handoff: conservative seed copy. See
 * `docs/superpowers/plans/2026-05-11-alex-medspa-1c-followups.md` for the
 * named reviewer + target window before pilot.
 */
export const DISCLOSURE_COPY: Record<PdpaJurisdiction, { version: string; text: string }> = {
  SG: {
    version: AI_DISCLOSURE_VERSIONS.SG,
    text: "Hi, I'm Alex — the clinic's AI assistant. I can help with bookings and general questions, and a clinic team member will step in for anything medical.",
  },
  MY: {
    version: AI_DISCLOSURE_VERSIONS.MY,
    text: "Hi, I'm Alex — the clinic's AI assistant. To follow up with you and share booking info, the clinic needs your okay to process your details. Reply OK to continue, or STOP at any time to opt out.",
  },
};
```

- [ ] **Step 4: Create `packages/core/src/consent/revocation-ack.ts`**

```ts
import type { PdpaJurisdiction } from "@switchboard/schemas";

/**
 * Deterministic revocation acknowledgment per jurisdiction. No model.
 * Sent by the gateway revocation scanner when an inbound keyword match
 * triggers enforced revocation. Wording deliberately avoids
 * medical/safety/compliance leakage — the user does not need to know which
 * keyword they matched, only that we heard the request.
 */
export const REVOCATION_ACK: Record<PdpaJurisdiction, string> = {
  SG: "Got it — we won't message you further. If you change your mind, you can let the clinic team know directly.",
  MY: "Noted — we'll stop messaging you. To opt back in later, please contact the clinic directly.",
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- consent/__tests__/disclosure-copy consent/__tests__/revocation-ack
```

Expected: PASS (snapshots auto-create on first run).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/consent/disclosure-copy.ts packages/core/src/consent/revocation-ack.ts packages/core/src/consent/__tests__/disclosure-copy.test.ts packages/core/src/consent/__tests__/revocation-ack.test.ts packages/core/src/consent/__tests__/__snapshots__
git commit -m "feat(core): add pdpa disclosure copy and revocation ack templates"
```

---

## Task 7: Revocation keyword tables + loader + scanner

**Files:**

- Create: `packages/core/src/consent/revocation-keywords/types.ts`
- Create: `packages/core/src/consent/revocation-keywords/common.ts`
- Create: `packages/core/src/consent/revocation-keywords/sg.ts`
- Create: `packages/core/src/consent/revocation-keywords/my.ts`
- Create: `packages/core/src/consent/revocation-keywords/loader.ts`
- Create: `packages/core/src/consent/revocation-keywords/index.ts`
- Create: `packages/core/src/consent/scanner/revocation-keyword-scanner.ts`
- Tests: `packages/core/src/consent/revocation-keywords/__tests__/loader.test.ts`, `packages/core/src/consent/scanner/__tests__/revocation-keyword-scanner.test.ts`

- [ ] **Step 1: Write failing test for the loader**

`packages/core/src/consent/revocation-keywords/__tests__/loader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadRevocationKeywords } from "../loader.js";

describe("loadRevocationKeywords", () => {
  it("returns a frozen array for SG", () => {
    const entries = loadRevocationKeywords("SG");
    expect(Object.isFrozen(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("returns a frozen array for MY", () => {
    const entries = loadRevocationKeywords("MY");
    expect(Object.isFrozen(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("all entries have unique ids within a jurisdiction", () => {
    for (const j of ["SG", "MY"] as const) {
      const entries = loadRevocationKeywords(j);
      const ids = entries.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("regex patterns are normalized: case-insensitive, no global flag", () => {
    for (const j of ["SG", "MY"] as const) {
      for (const entry of loadRevocationKeywords(j)) {
        for (const p of entry.patterns) {
          if (p instanceof RegExp) {
            expect(p.flags).toContain("i");
            expect(p.flags).not.toContain("g");
          }
        }
      }
    }
  });

  it("is memoized — second call returns the same reference", () => {
    expect(loadRevocationKeywords("SG")).toBe(loadRevocationKeywords("SG"));
  });

  it("includes baseline STOP and unsubscribe across both jurisdictions", () => {
    for (const j of ["SG", "MY"] as const) {
      const entries = loadRevocationKeywords(j);
      const haystack = entries.flatMap((e) => e.patterns.map((p) => String(p)));
      expect(haystack.some((s) => /STOP/i.test(s))).toBe(true);
      expect(haystack.some((s) => /unsubscribe/i.test(s))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test -- revocation-keywords
```

Expected: module-not-found.

- [ ] **Step 3: Create `packages/core/src/consent/revocation-keywords/types.ts`**

```ts
import type { PdpaJurisdiction } from "@switchboard/schemas";

export interface RevocationKeywordEntry {
  /** Stable id, e.g. "stop_baseline", "my_berhenti". */
  id: string;
  patterns: ReadonlyArray<string | RegExp>;
  jurisdiction: PdpaJurisdiction | "both";
  notes?: string;
}
```

- [ ] **Step 4: Create `packages/core/src/consent/revocation-keywords/common.ts`**

```ts
import type { RevocationKeywordEntry } from "./types.js";

/**
 * Jurisdiction-agnostic baseline. English revocation phrases that apply
 * equally in SG and MY. Conservative: false-positive revoke is worse than
 * missed revoke (1b-1 escalation triggers catch nuanced complaints anyway).
 */
export const commonRevocationKeywords: ReadonlyArray<RevocationKeywordEntry> = [
  {
    id: "stop_baseline",
    patterns: [/\bSTOP\b/i],
    jurisdiction: "both",
    notes: "Universal opt-out keyword across WhatsApp / SMS conventions.",
  },
  {
    id: "unsubscribe",
    patterns: [/\bunsubscribe\b/i],
    jurisdiction: "both",
  },
  {
    id: "remove_me",
    patterns: [/remove me/i],
    jurisdiction: "both",
  },
  {
    id: "dont_contact_me",
    patterns: [/don't (contact|message) me/i, /do not (contact|message) me/i],
    jurisdiction: "both",
  },
  {
    id: "opt_out",
    patterns: [/opt[- ]?out/i],
    jurisdiction: "both",
  },
];
```

- [ ] **Step 5: Create `packages/core/src/consent/revocation-keywords/sg.ts`**

```ts
import type { RevocationKeywordEntry } from "./types.js";

/**
 * SG-specific revocation phrasing. Includes Malay phrases used colloquially
 * in SG conversations and SG-register English phrases.
 */
export const sgRevocationKeywords: ReadonlyArray<RevocationKeywordEntry> = [
  {
    id: "sg_jangan_hubungi",
    patterns: [/\bjangan hubungi\b/i],
    jurisdiction: "SG",
    notes: "Malay 'don't contact' — used colloquially by SG residents.",
  },
  {
    id: "sg_cancel_messages",
    patterns: [/\bcancel\b.*\b(messages?|whatsapp|sms)\b/i],
    jurisdiction: "SG",
  },
];
```

- [ ] **Step 6: Create `packages/core/src/consent/revocation-keywords/my.ts`**

```ts
import type { RevocationKeywordEntry } from "./types.js";

/**
 * MY-specific revocation phrasing in Bahasa Malaysia.
 */
export const myRevocationKeywords: ReadonlyArray<RevocationKeywordEntry> = [
  {
    id: "my_berhenti",
    patterns: [/\bberhenti\b/i],
    jurisdiction: "MY",
    notes: "Bahasa 'stop'.",
  },
  {
    id: "my_tarik_balik",
    patterns: [/\btarik balik\b/i],
    jurisdiction: "MY",
    notes: "Bahasa 'withdraw'.",
  },
  {
    id: "my_jangan_hantar",
    patterns: [/\bjangan hantar\b/i],
    jurisdiction: "MY",
    notes: "Bahasa 'don't send'.",
  },
];
```

- [ ] **Step 7: Create `packages/core/src/consent/revocation-keywords/loader.ts`**

```ts
import type { PdpaJurisdiction } from "@switchboard/schemas";
import { normalizeRegex } from "../../governance/banned-phrases/loader.js";
import { commonRevocationKeywords } from "./common.js";
import { sgRevocationKeywords } from "./sg.js";
import { myRevocationKeywords } from "./my.js";
import type { RevocationKeywordEntry } from "./types.js";

function normalizeEntry(entry: RevocationKeywordEntry): RevocationKeywordEntry {
  const patterns = entry.patterns.map((p) => (p instanceof RegExp ? normalizeRegex(p) : p));
  return Object.freeze({
    ...entry,
    patterns: Object.freeze([...patterns]),
  });
}

function buildJurisdictionTable(j: PdpaJurisdiction): ReadonlyArray<RevocationKeywordEntry> {
  const jurisdictionEntries = j === "SG" ? sgRevocationKeywords : myRevocationKeywords;
  const merged = [...commonRevocationKeywords, ...jurisdictionEntries].map(normalizeEntry);

  // Boot-time invariant: unique ids.
  const ids = new Set<string>();
  for (const e of merged) {
    if (ids.has(e.id)) {
      throw new Error(`Duplicate revocation keyword id "${e.id}" in jurisdiction ${j}`);
    }
    ids.add(e.id);
  }

  return Object.freeze(merged);
}

const tableCache = new Map<PdpaJurisdiction, ReadonlyArray<RevocationKeywordEntry>>();

export function loadRevocationKeywords(
  jurisdiction: PdpaJurisdiction,
): ReadonlyArray<RevocationKeywordEntry> {
  let cached = tableCache.get(jurisdiction);
  if (!cached) {
    cached = buildJurisdictionTable(jurisdiction);
    tableCache.set(jurisdiction, cached);
  }
  return cached;
}
```

If `normalizeRegex` is not exported from `packages/core/src/governance/banned-phrases/loader.ts`, inline the same logic:

```ts
function normalizeRegex(p: RegExp): RegExp {
  const flags = p.flags.replace(/g/g, "");
  return new RegExp(p.source, flags.includes("i") ? flags : flags + "i");
}
```

(Check 1b-1's loader first — it almost certainly exports this; if it doesn't, this is the moment to extract it as a shared util at `packages/core/src/governance/regex/normalize.ts`.)

- [ ] **Step 8: Create `packages/core/src/consent/revocation-keywords/index.ts`**

```ts
export * from "./types.js";
export * from "./loader.js";
```

- [ ] **Step 9: Run loader test**

```bash
pnpm --filter @switchboard/core test -- revocation-keywords
```

Expected: PASS.

- [ ] **Step 10: Write failing scanner test**

`packages/core/src/consent/scanner/__tests__/revocation-keyword-scanner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scanForRevocationKeywords } from "../revocation-keyword-scanner.js";
import { loadRevocationKeywords } from "../../revocation-keywords/loader.js";

describe("scanForRevocationKeywords", () => {
  const sg = loadRevocationKeywords("SG");
  const my = loadRevocationKeywords("MY");

  it("matches STOP case-insensitively", () => {
    const matches = scanForRevocationKeywords("stop messaging me", sg);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].entry.id).toBe("stop_baseline");
  });

  it("matches MY-specific berhenti", () => {
    const matches = scanForRevocationKeywords("berhenti hantar pesanan", my);
    expect(matches.some((m) => m.entry.id === "my_berhenti")).toBe(true);
  });

  it("returns multiple matches in order when both fire", () => {
    const matches = scanForRevocationKeywords("STOP and please unsubscribe me", sg);
    const ids = matches.map((m) => m.entry.id);
    expect(ids).toContain("stop_baseline");
    expect(ids).toContain("unsubscribe");
  });

  it.each([
    "I'll stop by tomorrow",
    "Remove me from the waitlist for now",
    "berhenti makan ubat",
    "Can I have a stoppage for two weeks?",
    "Please cancel the appointment, not the messages",
  ])("does not match benign sentence: %s", (text) => {
    const matches = scanForRevocationKeywords(text, my);
    // None of the strict-anchored keywords should hit these phrasings.
    // If this test ever fails, tighten the regex anchors — false-positive
    // revoke is worse than missed revoke.
    expect(matches.length).toBe(0);
  });

  it("returns empty array on no match", () => {
    expect(scanForRevocationKeywords("hi looking to book a facial", sg)).toEqual([]);
  });
});
```

Note: some of the "benign" cases may legitimately fail if a baseline pattern is too loose (e.g., `/\bberhenti\b/i` matches "berhenti makan ubat" because `berhenti` is a standalone word). If so, tighten the SG/MY entries before passing this test — that is the entire point of having the conservative seed.

If a test entry like `"berhenti makan ubat"` is unreachable without adding context (e.g., requiring `/\bberhenti\b.*\b(hantar|pesanan|mesej)\b/i` instead), revise the keyword pattern accordingly. Document the trade-off in the entry's `notes`.

- [ ] **Step 11: Run scanner test to verify it fails**

```bash
pnpm --filter @switchboard/core test -- revocation-keyword-scanner
```

Expected: module-not-found.

- [ ] **Step 12: Create `packages/core/src/consent/scanner/revocation-keyword-scanner.ts`**

```ts
import type { RevocationKeywordEntry } from "../revocation-keywords/types.js";

export interface RevocationKeywordMatch {
  entry: RevocationKeywordEntry;
  matched: string;
  index: number;
}

/**
 * Scan inbound text for revocation keyword matches.
 * Pure function. NOT sentence-bounded — revocation in any sentence of the
 * inbound counts (user intent is the message, not the surrounding clauses).
 *
 * Returns ALL matches; caller uses `matches[0]` in 1c (multi-match analytics
 * deferred).
 */
export function scanForRevocationKeywords(
  text: string,
  entries: ReadonlyArray<RevocationKeywordEntry>,
): RevocationKeywordMatch[] {
  const matches: RevocationKeywordMatch[] = [];
  const lower = text.toLowerCase();

  for (const entry of entries) {
    for (const pattern of entry.patterns) {
      if (typeof pattern === "string") {
        const idx = lower.indexOf(pattern.toLowerCase());
        if (idx >= 0) {
          matches.push({ entry, matched: text.slice(idx, idx + pattern.length), index: idx });
          break; // one match per entry is enough
        }
      } else {
        // RegExp — already normalized to case-insensitive, non-global at load time.
        const result = pattern.exec(text);
        if (result) {
          matches.push({ entry, matched: result[0], index: result.index });
          break;
        }
      }
    }
  }
  return matches;
}
```

- [ ] **Step 13: Run scanner test to verify it passes**

```bash
pnpm --filter @switchboard/core test -- revocation-keyword-scanner
```

Expected: PASS. If a benign-input case fails, tighten the keyword regex (e.g., add context requirements to `my_berhenti`) and rerun.

- [ ] **Step 14: Rebuild core package**

```bash
pnpm --filter @switchboard/core build
```

Expected: clean.

- [ ] **Step 15: Commit**

```bash
git add packages/core/src/consent/revocation-keywords packages/core/src/consent/scanner
git commit -m "feat(core): add revocation keyword tables loader and scanner"
```

---

## Task 8: `ContactConsentReader` interface + Prisma adapter

**Files:**

- Create: `packages/core/src/consent/contact-consent-reader.ts`
- Create: `packages/db/src/prisma-contact-consent-reader.ts`
- Test: `packages/db/src/__tests__/prisma-contact-consent-reader.test.ts`

- [ ] **Step 1: Create the interface in core**

`packages/core/src/consent/contact-consent-reader.ts`:

```ts
import type { ContactConsentState } from "@switchboard/schemas";
import { ContactNotFound } from "./errors.js";

/**
 * Read-side view of a Contact's consent state. The runtime hook and admin
 * endpoint consume this; never imports Prisma directly (Layer 3 rule).
 */
export interface ContactConsentReader {
  /** Throws ContactNotFound if no row exists. */
  read(contactId: string): Promise<ContactConsentState>;
}

export { ContactNotFound };
```

- [ ] **Step 2: Write failing Prisma-adapter test**

`packages/db/src/__tests__/prisma-contact-consent-reader.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createPrismaContactConsentReader } from "../prisma-contact-consent-reader.js";
import { ContactNotFound } from "@switchboard/core";

describe("createPrismaContactConsentReader", () => {
  it("returns ContactConsentState shape on success", async () => {
    const prisma = {
      contact: {
        findUnique: vi.fn().mockResolvedValue({
          pdpaJurisdiction: "MY",
          consentGrantedAt: new Date("2026-05-01T00:00:00Z"),
          consentRevokedAt: null,
          consentSource: "whatsapp_quick_reply",
          aiDisclosureVersionShown: "my-disclosure@1.0.0",
          aiDisclosureShownAt: new Date("2026-04-29T00:00:00Z"),
          consentUpdatedBy: "system:skill_runtime",
          consentNotes: null,
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const reader = createPrismaContactConsentReader({ prisma });
    const state = await reader.read("c1");
    expect(state.pdpaJurisdiction).toBe("MY");
    expect(state.consentGrantedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(state.consentRevokedAt).toBeNull();
  });

  it("throws ContactNotFound when row is missing", async () => {
    const prisma = {
      contact: { findUnique: vi.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const reader = createPrismaContactConsentReader({ prisma });
    await expect(reader.read("missing")).rejects.toBeInstanceOf(ContactNotFound);
  });
});
```

- [ ] **Step 3: Verify it fails**

```bash
pnpm --filter @switchboard/db test -- prisma-contact-consent-reader
```

Expected: module-not-found.

- [ ] **Step 4: Create `packages/db/src/prisma-contact-consent-reader.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import type { ContactConsentState, PdpaJurisdiction, ConsentSource } from "@switchboard/schemas";
import { ContactNotFound, type ContactConsentReader } from "@switchboard/core";

interface Deps {
  prisma: PrismaClient;
}

export function createPrismaContactConsentReader(deps: Deps): ContactConsentReader {
  return {
    async read(contactId: string): Promise<ContactConsentState> {
      const row = await deps.prisma.contact.findUnique({
        where: { id: contactId },
        select: {
          pdpaJurisdiction: true,
          consentGrantedAt: true,
          consentRevokedAt: true,
          consentSource: true,
          aiDisclosureVersionShown: true,
          aiDisclosureShownAt: true,
          consentUpdatedBy: true,
          consentNotes: true,
        },
      });
      if (!row) throw new ContactNotFound({ contactId });

      return {
        pdpaJurisdiction: row.pdpaJurisdiction as PdpaJurisdiction | null,
        consentGrantedAt: row.consentGrantedAt ? row.consentGrantedAt.toISOString() : null,
        consentRevokedAt: row.consentRevokedAt ? row.consentRevokedAt.toISOString() : null,
        consentSource: row.consentSource as ConsentSource | null,
        aiDisclosureVersionShown: row.aiDisclosureVersionShown,
        aiDisclosureShownAt: row.aiDisclosureShownAt ? row.aiDisclosureShownAt.toISOString() : null,
        consentUpdatedBy: row.consentUpdatedBy,
        consentNotes: row.consentNotes,
      };
    },
  };
}
```

- [ ] **Step 5: Verify tests pass**

```bash
pnpm --filter @switchboard/db test -- prisma-contact-consent-reader
pnpm --filter @switchboard/db build
```

Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/consent/contact-consent-reader.ts packages/db/src/prisma-contact-consent-reader.ts packages/db/src/__tests__/prisma-contact-consent-reader.test.ts
git commit -m "feat(db): add prisma contact consent reader"
```

---

## Task 9: `ConsentStateStore` interface + Prisma impl + `ConsentService` factory

This task is the largest single deliverable in 1c. The service is the **sole mutation seat** for consent state — five public methods plus an internal `ensureJurisdictionStamped` helper, each with invariant assertions and verdict emission. The mutation surface is split into:

- `ConsentStateStore` (interface, core) — narrow Prisma seam.
- `prisma-consent-store.ts` (impl, db) — Prisma updates.
- `consent-service.ts` (core) — factory composing the store, verdict store, conversation status setter, handoff store.

**Files:**

- Create: `packages/core/src/consent/consent-store.ts`
- Create: `packages/db/src/prisma-consent-store.ts`
- Create: `packages/core/src/consent/consent-service.ts`
- Create: `packages/db/src/__tests__/prisma-consent-store.test.ts`
- Create: `packages/core/src/consent/__tests__/consent-service.test.ts`

### 9.1 `ConsentStateStore` interface

- [ ] **Step 1: Create `packages/core/src/consent/consent-store.ts`**

```ts
import type { ContactConsentState, PdpaJurisdiction, ConsentSource } from "@switchboard/schemas";

/**
 * Narrow seam for ConsentService mutations. Implemented in @switchboard/db.
 * No business logic lives here — the service composes this store with the
 * verdict store + conversation status setter + handoff store to enforce
 * invariants and emit audit rows.
 */
export interface ConsentStateStore {
  /** Read current state without throwing on missing — returns null. */
  readOrNull(contactId: string): Promise<ContactConsentState | null>;

  /** Set pdpaJurisdiction only if currently null. No-op if already stamped to
   *  the same value. Throws if stamped to a different value (caller wraps). */
  setJurisdictionIfNull(contactId: string, jurisdiction: PdpaJurisdiction): Promise<void>;

  /** Atomic disclosure-fields update. Does not touch consent timestamps. */
  setDisclosure(input: {
    contactId: string;
    version: string;
    shownAt: Date;
    actor: string;
  }): Promise<void>;

  /** Atomic grant update. Caller has already verified revokedAt is null. */
  setGrant(input: {
    contactId: string;
    grantedAt: Date;
    source: ConsentSource;
    actor: string;
    notes?: string;
  }): Promise<void>;

  /** Atomic revocation update. Idempotent at the SQL level: only sets
   *  consentRevokedAt if currently null (use a conditional WHERE clause). */
  setRevocationIfNotRevoked(input: {
    contactId: string;
    revokedAt: Date;
    source: ConsentSource;
    actor: string;
    notes?: string;
  }): Promise<{ wasNewlyRevoked: boolean; existingRevokedAt: Date | null }>;

  /** Clear both consent timestamps. Preserves jurisdiction + disclosure fields. */
  clearConsentTimestamps(input: {
    contactId: string;
    actor: string;
    notes: string;
  }): Promise<{ previousGrantedAt: Date | null; previousRevokedAt: Date | null }>;
}
```

### 9.2 Prisma impl

- [ ] **Step 2: Write failing test**

`packages/db/src/__tests__/prisma-consent-store.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createPrismaConsentStore } from "../prisma-consent-store.js";

const buildPrisma = (
  overrides: Partial<{
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  }> = {},
) =>
  ({
    contact: {
      findUnique: overrides.findUnique ?? vi.fn(),
      update: overrides.update ?? vi.fn(),
      updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("createPrismaConsentStore", () => {
  it("setJurisdictionIfNull writes when current jurisdiction is null", async () => {
    const update = vi.fn();
    const prisma = buildPrisma({
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update,
    });
    const store = createPrismaConsentStore({ prisma });
    await store.setJurisdictionIfNull("c1", "SG");
    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", pdpaJurisdiction: null },
      data: { pdpaJurisdiction: "SG" },
    });
  });

  it("setRevocationIfNotRevoked reports wasNewlyRevoked=true when count=1", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ consentRevokedAt: null }) // pre-check
      .mockResolvedValueOnce({ consentRevokedAt: new Date("2026-05-10") }); // post-read
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = buildPrisma({ findUnique, updateMany });
    const store = createPrismaConsentStore({ prisma });

    const result = await store.setRevocationIfNotRevoked({
      contactId: "c1",
      revokedAt: new Date("2026-05-10"),
      source: "inbound_keyword_revocation",
      actor: "system:inbound_keyword_revocation",
    });
    expect(result.wasNewlyRevoked).toBe(true);
  });

  it("setRevocationIfNotRevoked reports wasNewlyRevoked=false when row already revoked", async () => {
    const existing = new Date("2026-05-09");
    const findUnique = vi.fn().mockResolvedValue({ consentRevokedAt: existing });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = buildPrisma({ findUnique, updateMany });
    const store = createPrismaConsentStore({ prisma });

    const result = await store.setRevocationIfNotRevoked({
      contactId: "c1",
      revokedAt: new Date("2026-05-10"),
      source: "inbound_keyword_revocation",
      actor: "system:inbound_keyword_revocation",
    });
    expect(result.wasNewlyRevoked).toBe(false);
    expect(result.existingRevokedAt).toEqual(existing);
  });
});
```

- [ ] **Step 3: Verify failure**

```bash
pnpm --filter @switchboard/db test -- prisma-consent-store
```

Expected: module-not-found.

- [ ] **Step 4: Create `packages/db/src/prisma-consent-store.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import type { ConsentStateStore } from "@switchboard/core";
import type { ContactConsentState, ConsentSource, PdpaJurisdiction } from "@switchboard/schemas";

interface Deps {
  prisma: PrismaClient;
}

export function createPrismaConsentStore(deps: Deps): ConsentStateStore {
  const { prisma } = deps;
  return {
    async readOrNull(contactId): Promise<ContactConsentState | null> {
      const row = await prisma.contact.findUnique({
        where: { id: contactId },
        select: {
          pdpaJurisdiction: true,
          consentGrantedAt: true,
          consentRevokedAt: true,
          consentSource: true,
          aiDisclosureVersionShown: true,
          aiDisclosureShownAt: true,
          consentUpdatedBy: true,
          consentNotes: true,
        },
      });
      if (!row) return null;
      return {
        pdpaJurisdiction: row.pdpaJurisdiction as PdpaJurisdiction | null,
        consentGrantedAt: row.consentGrantedAt ? row.consentGrantedAt.toISOString() : null,
        consentRevokedAt: row.consentRevokedAt ? row.consentRevokedAt.toISOString() : null,
        consentSource: row.consentSource as ConsentSource | null,
        aiDisclosureVersionShown: row.aiDisclosureVersionShown,
        aiDisclosureShownAt: row.aiDisclosureShownAt ? row.aiDisclosureShownAt.toISOString() : null,
        consentUpdatedBy: row.consentUpdatedBy,
        consentNotes: row.consentNotes,
      };
    },

    async setJurisdictionIfNull(contactId, jurisdiction) {
      await prisma.contact.updateMany({
        where: { id: contactId, pdpaJurisdiction: null },
        data: { pdpaJurisdiction: jurisdiction },
      });
    },

    async setDisclosure({ contactId, version, shownAt, actor }) {
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          aiDisclosureVersionShown: version,
          aiDisclosureShownAt: shownAt,
          consentUpdatedBy: actor,
        },
      });
    },

    async setGrant({ contactId, grantedAt, source, actor, notes }) {
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          consentGrantedAt: grantedAt,
          consentSource: source,
          consentUpdatedBy: actor,
          consentNotes: notes ?? null,
        },
      });
    },

    async setRevocationIfNotRevoked({ contactId, revokedAt, source, actor, notes }) {
      const result = await prisma.contact.updateMany({
        where: { id: contactId, consentRevokedAt: null },
        data: {
          consentRevokedAt: revokedAt,
          consentSource: source,
          consentUpdatedBy: actor,
          consentNotes: notes ?? null,
        },
      });
      if (result.count === 1) {
        return { wasNewlyRevoked: true, existingRevokedAt: null };
      }
      // Row exists but was already revoked — fetch existing timestamp.
      const existing = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { consentRevokedAt: true },
      });
      return {
        wasNewlyRevoked: false,
        existingRevokedAt: existing?.consentRevokedAt ?? null,
      };
    },

    async clearConsentTimestamps({ contactId, actor, notes }) {
      const previous = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { consentGrantedAt: true, consentRevokedAt: true },
      });
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          consentGrantedAt: null,
          consentRevokedAt: null,
          consentSource: null,
          consentUpdatedBy: actor,
          consentNotes: notes,
        },
      });
      return {
        previousGrantedAt: previous?.consentGrantedAt ?? null,
        previousRevokedAt: previous?.consentRevokedAt ?? null,
      };
    },
  };
}
```

- [ ] **Step 5: Verify pass**

```bash
pnpm --filter @switchboard/db test -- prisma-consent-store
pnpm --filter @switchboard/db build
```

Expected: PASS + clean build.

### 9.3 `ConsentService` factory

- [ ] **Step 6: Write failing service test**

`packages/core/src/consent/__tests__/consent-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createConsentService,
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  type ConsentStateStore,
  type ConsentService,
} from "../index.js";
import type { GovernanceVerdictStore } from "../../governance/governance-verdict-store/types.js";
import type { HandoffStore } from "../../handoff/types.js";
import type { ConversationStatusSetter } from "../../skill-runtime/hooks/deterministic-safety-gate.js";

const buildStore = (initial: any = null): ConsentStateStore => {
  let state = initial;
  return {
    readOrNull: vi.fn().mockImplementation(async () => state),
    setJurisdictionIfNull: vi.fn().mockImplementation(async (_id, j) => {
      if (state?.pdpaJurisdiction == null) state = { ...(state ?? {}), pdpaJurisdiction: j };
    }),
    setDisclosure: vi.fn().mockImplementation(async ({ version, shownAt, actor }) => {
      state = {
        ...(state ?? {}),
        aiDisclosureVersionShown: version,
        aiDisclosureShownAt: shownAt.toISOString(),
        consentUpdatedBy: actor,
      };
    }),
    setGrant: vi.fn().mockImplementation(async ({ grantedAt, source, actor }) => {
      state = {
        ...(state ?? {}),
        consentGrantedAt: grantedAt.toISOString(),
        consentSource: source,
        consentUpdatedBy: actor,
      };
    }),
    setRevocationIfNotRevoked: vi
      .fn()
      .mockImplementation(async ({ revokedAt, source, actor, notes }) => {
        if (state?.consentRevokedAt) {
          return { wasNewlyRevoked: false, existingRevokedAt: new Date(state.consentRevokedAt) };
        }
        state = {
          ...(state ?? {}),
          consentRevokedAt: revokedAt.toISOString(),
          consentSource: source,
          consentUpdatedBy: actor,
          consentNotes: notes ?? null,
        };
        return { wasNewlyRevoked: true, existingRevokedAt: null };
      }),
    clearConsentTimestamps: vi.fn().mockImplementation(async ({ actor, notes }) => {
      const previousGrantedAt = state?.consentGrantedAt ? new Date(state.consentGrantedAt) : null;
      const previousRevokedAt = state?.consentRevokedAt ? new Date(state.consentRevokedAt) : null;
      state = {
        ...(state ?? {}),
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        consentUpdatedBy: actor,
        consentNotes: notes,
      };
      return { previousGrantedAt, previousRevokedAt };
    }),
  };
};

const buildVerdictStore = (): GovernanceVerdictStore =>
  ({
    save: vi.fn().mockResolvedValue({} as never),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const buildHandoffStore = (): HandoffStore =>
  ({
    save: vi.fn().mockResolvedValue(undefined),
    annotate: vi.fn().mockResolvedValue(undefined),
    findOpenBySession: vi.fn().mockResolvedValue(null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const buildConvStore = (): ConversationStatusSetter => ({
  setConversationStatus: vi.fn().mockResolvedValue(undefined),
});

const ctx = (overrides: Partial<{ store: ConsentStateStore }> = {}) => {
  const store = overrides.store ?? buildStore();
  const verdictStore = buildVerdictStore();
  const handoffStore = buildHandoffStore();
  const conversationStore = buildConvStore();
  const clock = () => new Date("2026-05-11T10:00:00Z");

  const service = createConsentService({
    store,
    verdictStore,
    handoffStore,
    conversationStore,
    clock,
    deploymentId: "d1",
    orgId: "org1",
    clinicType: "medical",
  });
  return { service, store, verdictStore, handoffStore, conversationStore };
};

describe("ConsentService.attachToGovernedInteraction", () => {
  it("stamps jurisdiction when currently null", async () => {
    const { service, store } = ctx();
    await service.attachToGovernedInteraction("c1", "SG");
    expect(store.setJurisdictionIfNull).toHaveBeenCalledWith("c1", "SG");
  });

  it("throws ConsentJurisdictionMismatch when a different jurisdiction is stamped", async () => {
    const { service } = ctx({ store: buildStore({ pdpaJurisdiction: "SG" }) });
    await expect(service.attachToGovernedInteraction("c1", "MY")).rejects.toBeInstanceOf(
      ConsentJurisdictionMismatch,
    );
  });

  it("no-op when same jurisdiction is already stamped", async () => {
    const store = buildStore({ pdpaJurisdiction: "MY" });
    const { service, verdictStore } = ctx({ store });
    await service.attachToGovernedInteraction("c1", "MY");
    // No verdict on no-op stamps.
    expect((verdictStore.save as any).mock.calls.length).toBe(0);
  });
});

describe("ConsentService.recordDisclosureShown", () => {
  it("stamps version + shownAt; does NOT touch consent timestamps", async () => {
    const { service, store } = ctx();
    await service.recordDisclosureShown({
      contactId: "c1",
      jurisdiction: "SG",
      version: "sg-disclosure@1.0.0",
      shownAt: new Date("2026-05-11T09:59:00Z"),
      actor: "system:skill_runtime",
    });
    expect(store.setDisclosure).toHaveBeenCalled();
    expect(store.setGrant).not.toHaveBeenCalled();
    expect(store.setRevocationIfNotRevoked).not.toHaveBeenCalled();
  });

  it("idempotent on same version (no setDisclosure call)", async () => {
    const { service, store } = ctx({
      store: buildStore({
        pdpaJurisdiction: "SG",
        aiDisclosureVersionShown: "sg-disclosure@1.0.0",
      }),
    });
    await service.recordDisclosureShown({
      contactId: "c1",
      jurisdiction: "SG",
      version: "sg-disclosure@1.0.0",
      shownAt: new Date(),
      actor: "system:skill_runtime",
    });
    expect(store.setDisclosure).not.toHaveBeenCalled();
  });

  it("writes a `disclosure_version_bumped` verdict on version change", async () => {
    const { service, store, verdictStore } = ctx({
      store: buildStore({
        pdpaJurisdiction: "SG",
        aiDisclosureVersionShown: "sg-disclosure@0.9.0",
      }),
    });
    await service.recordDisclosureShown({
      contactId: "c1",
      jurisdiction: "SG",
      version: "sg-disclosure@1.0.0",
      shownAt: new Date(),
      actor: "system:skill_runtime",
    });
    expect(store.setDisclosure).toHaveBeenCalled();
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.reasonCode).toBe("allowed");
    expect(saved.details.event).toBe("disclosure_version_bumped");
    expect(saved.details.previousVersion).toBe("sg-disclosure@0.9.0");
    expect(saved.details.newVersion).toBe("sg-disclosure@1.0.0");
  });
});

describe("ConsentService.recordGrant", () => {
  it("stamps grantedAt and emits consent_granted verdict", async () => {
    const { service, store, verdictStore } = ctx();
    await service.recordGrant({
      contactId: "c1",
      jurisdiction: "MY",
      source: "whatsapp_quick_reply",
      grantedAt: new Date("2026-05-11T10:00:00Z"),
      actor: "system:skill_runtime",
    });
    expect(store.setGrant).toHaveBeenCalled();
    expect((verdictStore.save as any).mock.calls[0][0].reasonCode).toBe("allowed");
    expect((verdictStore.save as any).mock.calls[0][0].details.event).toBe("consent_granted");
  });

  it("throws ConsentRevokedCannotRegrant when revokedAt is set", async () => {
    const { service } = ctx({
      store: buildStore({
        pdpaJurisdiction: "MY",
        consentRevokedAt: new Date("2026-05-10").toISOString(),
      }),
    });
    await expect(
      service.recordGrant({
        contactId: "c1",
        jurisdiction: "MY",
        source: "operator_recorded",
        grantedAt: new Date(),
        actor: "user_42",
      }),
    ).rejects.toBeInstanceOf(ConsentRevokedCannotRegrant);
  });
});

describe("ConsentService.recordRevocation", () => {
  it("is idempotent — second call is a no-op with no verdict", async () => {
    const store = buildStore();
    const { service, verdictStore } = ctx({ store });
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date("2026-05-11"),
      actor: "system:inbound_keyword_revocation",
    });
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date("2026-05-12"),
      actor: "system:inbound_keyword_revocation",
    });
    expect((verdictStore.save as any).mock.calls.length).toBe(1);
  });

  it("flips conversation status when openConversationSessionId is provided", async () => {
    const { service, conversationStore } = ctx();
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date(),
      actor: "system:inbound_keyword_revocation",
      openConversationSessionId: "sess1",
    });
    expect(conversationStore.setConversationStatus).toHaveBeenCalledWith(
      "sess1",
      "human_override",
      expect.anything(),
    );
  });
});

describe("ConsentService.clearConsent", () => {
  it("rejects empty notes", async () => {
    const { service } = ctx();
    await expect(
      service.clearConsent({ contactId: "c1", actor: "user_42", notes: "" }),
    ).rejects.toThrow();
  });

  it("rejects system: actors", async () => {
    const { service } = ctx();
    await expect(
      service.clearConsent({
        contactId: "c1",
        actor: "system:something",
        notes: "operator reset",
      }),
    ).rejects.toThrow();
  });

  it("emits consent_cycle_reset warning verdict on success", async () => {
    const { service, verdictStore } = ctx();
    await service.clearConsent({
      contactId: "c1",
      actor: "user_42",
      notes: "operator-recorded reset after consent cycle complete",
    });
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.reasonCode).toBe("consent_cycle_reset");
    expect(saved.auditLevel).toBe("warning");
  });
});

describe("ConsentService — disclosure ↔ consent orthogonality", () => {
  it("recordDisclosureShown leaves consent timestamps unchanged", async () => {
    const store = buildStore({
      pdpaJurisdiction: "SG",
      consentGrantedAt: new Date("2026-05-01").toISOString(),
      consentRevokedAt: null,
    });
    const { service } = ctx({ store });
    await service.recordDisclosureShown({
      contactId: "c1",
      jurisdiction: "SG",
      version: "sg-disclosure@1.0.0",
      shownAt: new Date(),
      actor: "system:skill_runtime",
    });
    expect(store.setGrant).not.toHaveBeenCalled();
    expect(store.setRevocationIfNotRevoked).not.toHaveBeenCalled();
  });

  it("recordGrant leaves disclosure timestamps unchanged", async () => {
    const store = buildStore();
    const { service } = ctx({ store });
    await service.recordGrant({
      contactId: "c1",
      jurisdiction: "MY",
      source: "web_form",
      grantedAt: new Date(),
      actor: "user_42",
    });
    expect(store.setDisclosure).not.toHaveBeenCalled();
  });

  it("recordRevocation leaves disclosure timestamps unchanged", async () => {
    const store = buildStore();
    const { service } = ctx({ store });
    await service.recordRevocation({
      contactId: "c1",
      source: "inbound_keyword_revocation",
      revokedAt: new Date(),
      actor: "system:inbound_keyword_revocation",
    });
    expect(store.setDisclosure).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Verify failure**

```bash
pnpm --filter @switchboard/core test -- consent-service
```

Expected: module-not-found / not-yet-exported.

- [ ] **Step 8: Create `packages/core/src/consent/consent-service.ts`**

```ts
import type { ConsentSource, PdpaJurisdiction, ContactConsentState } from "@switchboard/schemas";
import type { GovernanceVerdictStore } from "../governance/governance-verdict-store/types.js";
import type { HandoffStore } from "../handoff/types.js";
import type { ConversationStatusSetter } from "../skill-runtime/hooks/deterministic-safety-gate.js";
import { buildHandoffPackage } from "../handoff/build-handoff-package.js";
import type { ConsentStateStore } from "./consent-store.js";
import {
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  ContactNotFound,
} from "./errors.js";

export interface ConsentService {
  attachToGovernedInteraction(contactId: string, jurisdiction: PdpaJurisdiction): Promise<void>;

  recordDisclosureShown(input: {
    contactId: string;
    jurisdiction: PdpaJurisdiction;
    version: string;
    shownAt: Date;
    actor: string;
  }): Promise<void>;

  recordGrant(input: {
    contactId: string;
    jurisdiction: PdpaJurisdiction;
    source: Extract<
      ConsentSource,
      "whatsapp_quick_reply" | "ig_dm_reply" | "web_form" | "operator_recorded"
    >;
    grantedAt: Date;
    actor: string;
    notes?: string;
  }): Promise<void>;

  recordRevocation(input: {
    contactId: string;
    source: Extract<ConsentSource, "inbound_keyword_revocation" | "operator_recorded_revocation">;
    revokedAt: Date;
    actor: string;
    notes?: string;
    openConversationSessionId?: string;
  }): Promise<void>;

  clearConsent(input: { contactId: string; actor: string; notes: string }): Promise<void>;
}

export interface ConsentServiceDeps {
  store: ConsentStateStore;
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStatusSetter;
  clock: () => Date;
  deploymentId: string;
  orgId: string;
  clinicType: "medical" | "nonMedical";
}

export function createConsentService(deps: ConsentServiceDeps): ConsentService {
  const {
    store,
    verdictStore,
    handoffStore,
    conversationStore,
    clock,
    deploymentId,
    orgId,
    clinicType,
  } = deps;

  // Internal helper. Stamps jurisdiction or throws ConsentJurisdictionMismatch.
  async function ensureJurisdictionStamped(
    contactId: string,
    jurisdiction: PdpaJurisdiction,
  ): Promise<{ wasNewlyStamped: boolean }> {
    const current = await store.readOrNull(contactId);
    if (!current) throw new ContactNotFound({ contactId });
    if (current.pdpaJurisdiction === jurisdiction) return { wasNewlyStamped: false };
    if (current.pdpaJurisdiction != null) {
      throw new ConsentJurisdictionMismatch({
        contactId,
        stamped: current.pdpaJurisdiction,
        provided: jurisdiction,
      });
    }
    await store.setJurisdictionIfNull(contactId, jurisdiction);
    return { wasNewlyStamped: true };
  }

  async function persistVerdict(input: {
    reasonCode: string;
    auditLevel: "info" | "warning" | "critical";
    action: "allow" | "block" | "escalate";
    jurisdiction: PdpaJurisdiction;
    conversationId: string;
    details: Record<string, unknown>;
  }) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (verdictStore.save as any)({
        deploymentId,
        sourceGuard: "consent_gate",
        action: input.action,
        reasonCode: input.reasonCode,
        auditLevel: input.auditLevel,
        jurisdiction: input.jurisdiction,
        clinicType,
        conversationId: input.conversationId,
        decidedAt: clock().toISOString(),
        details: input.details,
      });
    } catch (err) {
      // Emission integrity > persistence completeness — mirror 1b-1/1b-2.
      console.error("[consent-service] verdict persistence failure", err);
    }
  }

  return {
    async attachToGovernedInteraction(contactId, jurisdiction) {
      const result = await ensureJurisdictionStamped(contactId, jurisdiction);
      if (result.wasNewlyStamped) {
        await persistVerdict({
          reasonCode: "allowed",
          auditLevel: "info",
          action: "allow",
          jurisdiction,
          conversationId: contactId, // contact-scoped event; no session here
          details: { event: "jurisdiction_stamped", jurisdiction },
        });
      }
    },

    async recordDisclosureShown({ contactId, jurisdiction, version, shownAt, actor }) {
      const current = await store.readOrNull(contactId);
      if (!current) throw new ContactNotFound({ contactId });
      if (current.pdpaJurisdiction && current.pdpaJurisdiction !== jurisdiction) {
        throw new ConsentJurisdictionMismatch({
          contactId,
          stamped: current.pdpaJurisdiction,
          provided: jurisdiction,
        });
      }
      // Idempotent same-version no-op.
      if (current.aiDisclosureVersionShown === version) return;

      const previousVersion = current.aiDisclosureVersionShown;
      await store.setDisclosure({ contactId, version, shownAt, actor });

      await persistVerdict({
        reasonCode: "allowed",
        auditLevel: "info",
        action: "allow",
        jurisdiction,
        conversationId: contactId,
        details: previousVersion
          ? { event: "disclosure_version_bumped", previousVersion, newVersion: version }
          : { event: "disclosure_shown", version, jurisdiction },
      });
    },

    async recordGrant({ contactId, jurisdiction, source, grantedAt, actor, notes }) {
      const current = await store.readOrNull(contactId);
      if (!current) throw new ContactNotFound({ contactId });
      if (current.consentRevokedAt) {
        throw new ConsentRevokedCannotRegrant({
          contactId,
          revokedAt: new Date(current.consentRevokedAt),
        });
      }
      await ensureJurisdictionStamped(contactId, jurisdiction);
      await store.setGrant({ contactId, grantedAt, source, actor, notes });
      await persistVerdict({
        reasonCode: "allowed",
        auditLevel: "info",
        action: "allow",
        jurisdiction,
        conversationId: contactId,
        details: { event: "consent_granted", source, jurisdiction },
      });
    },

    async recordRevocation({
      contactId,
      source,
      revokedAt,
      actor,
      notes,
      openConversationSessionId,
    }) {
      const current = await store.readOrNull(contactId);
      if (!current) throw new ContactNotFound({ contactId });

      // Infer jurisdiction: prefer stamped; fall back to (rare) caller-provided
      // by treating null as the orchestrator's responsibility upstream.
      // For 1c, gateway + admin always pass through a path that has stamped
      // jurisdiction (gateway via attachToGovernedInteraction in the hook;
      // admin via explicit grant first). If still null, default to "SG" only
      // for verdict shape (never surfaces to Contact).
      const jurisdiction = (current.pdpaJurisdiction ?? "SG") as PdpaJurisdiction;

      const { wasNewlyRevoked } = await store.setRevocationIfNotRevoked({
        contactId,
        revokedAt,
        source,
        actor,
        notes,
      });

      if (!wasNewlyRevoked) return; // idempotent

      let handoffAnnotated = false;
      if (openConversationSessionId) {
        try {
          await conversationStore.setConversationStatus(
            openConversationSessionId,
            "human_override",
          );
          const open = await handoffStore.findOpenBySession?.(openConversationSessionId);
          if (open && handoffStore.annotate) {
            await handoffStore.annotate(open.id, {
              consentRevokedDuringHandoff: true,
              revokedAt: revokedAt.toISOString(),
            });
            handoffAnnotated = true;
          } else {
            await handoffStore.save(
              buildHandoffPackage(openConversationSessionId, orgId, 0, clock),
            );
          }
        } catch (err) {
          console.error("[consent-service] handoff annotation / status flip failure", err);
        }
      }

      await persistVerdict({
        reasonCode: "consent_revoked",
        auditLevel: "critical",
        action: "block",
        jurisdiction,
        conversationId: openConversationSessionId ?? contactId,
        details: {
          event: "consent_revoked",
          source,
          sessionId: openConversationSessionId ?? null,
          handoffAnnotated,
        },
      });
    },

    async clearConsent({ contactId, actor, notes }) {
      if (!notes || notes.trim().length === 0) {
        throw new Error("clearConsent requires non-empty notes (audit trail)");
      }
      if (actor.startsWith("system:")) {
        throw new Error("clearConsent rejects system: actors; require a real userId");
      }
      const current = await store.readOrNull(contactId);
      if (!current) throw new ContactNotFound({ contactId });

      const { previousGrantedAt, previousRevokedAt } = await store.clearConsentTimestamps({
        contactId,
        actor,
        notes,
      });

      const jurisdiction = (current.pdpaJurisdiction ?? "SG") as PdpaJurisdiction;
      await persistVerdict({
        reasonCode: "consent_cycle_reset",
        auditLevel: "warning",
        action: "allow",
        jurisdiction,
        conversationId: contactId,
        details: {
          event: "consent_cleared",
          previousGrantedAt: previousGrantedAt ? previousGrantedAt.toISOString() : null,
          previousRevokedAt: previousRevokedAt ? previousRevokedAt.toISOString() : null,
          actor,
          notes,
        },
      });
    },
  };
}
```

Notes:

- The `HandoffStore` interface may not currently have `findOpenBySession` or `annotate` methods — verify against `packages/core/src/handoff/types.ts`. If missing, two paths: (a) add them as optional methods (preferred, additive) and provide Prisma impls in this task, or (b) drop the annotation behavior to a follow-up and only flip status + save a new handoff in 1c. **Picking (a) is on-spec; if it bloats this task, split annotation into Task 9.5.**
- `verdictStore.save` signature in 1b-1's `GovernanceVerdictStore` requires the full `GovernanceVerdict` shape. The `as any` cast bridges the v1 `details` JSON field which is part of `SaveGovernanceVerdictInput` (1b-1 Section 6). Confirm the exact field name (`details` vs nested in `payload`) by reading `packages/core/src/governance/governance-verdict-store/types.ts` and adjust.

- [ ] **Step 9: Add barrel export at `packages/core/src/consent/index.ts`**

```ts
export * from "./errors.js";
export * from "./consent-store.js";
export * from "./consent-service.js";
export * from "./contact-consent-reader.js";
export * from "./disclosure-copy.js";
export * from "./revocation-ack.js";
export * from "./revocation-keywords/index.js";
export * from "./scanner/revocation-keyword-scanner.js";
```

Also re-export from `packages/core/src/index.ts`:

```ts
export * from "./consent/index.js";
```

- [ ] **Step 10: Verify tests pass**

```bash
pnpm --filter @switchboard/core test -- consent-service
pnpm --filter @switchboard/core build
pnpm --filter @switchboard/db build
```

Expected: PASS + clean builds.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/consent/consent-store.ts packages/core/src/consent/consent-service.ts packages/core/src/consent/index.ts packages/core/src/index.ts packages/db/src/prisma-consent-store.ts packages/db/src/__tests__/prisma-consent-store.test.ts packages/core/src/consent/__tests__/consent-service.test.ts
git commit -m "feat(core,db): add consent service with invariants and verdict emission"
```

---

## Task 10: `PdpaConsentGateHook` (skill-runtime hook)

**Files:**

- Create: `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`
- Test: `packages/core/src/skill-runtime/hooks/__tests__/pdpa-consent-gate.test.ts`

- [ ] **Step 1: Write failing hook test**

`packages/core/src/skill-runtime/hooks/__tests__/pdpa-consent-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PdpaConsentGateHook } from "../pdpa-consent-gate.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import type { GovernanceVerdictStore } from "../../governance/governance-verdict-store/types.js";
import type { HandoffStore } from "../../handoff/types.js";
import type { ConsentService } from "../../consent/consent-service.js";
import type { ContactConsentReader } from "../../consent/contact-consent-reader.js";
import type { ConversationStatusSetter } from "../deterministic-safety-gate.js";
import type { ContactConsentState } from "@switchboard/schemas";

const SG_CFG = {
  jurisdiction: "SG" as const,
  clinicType: "medical" as const,
  consentState: { mode: "enforce" as const },
};
const MY_CFG = {
  jurisdiction: "MY" as const,
  clinicType: "nonMedical" as const,
  consentState: { mode: "enforce" as const },
};

const buildDeps = (
  overrides: Partial<{
    resolution: Awaited<ReturnType<GovernanceConfigResolver>>;
    consent: ContactConsentState;
    contactId: string | null;
  }> = {},
) => {
  const resolution = overrides.resolution ?? ({ status: "resolved", config: SG_CFG } as const);
  const consent: ContactConsentState = overrides.consent ?? {
    pdpaJurisdiction: "SG",
    consentGrantedAt: null,
    consentRevokedAt: null,
    consentSource: null,
    aiDisclosureVersionShown: null,
    aiDisclosureShownAt: null,
    consentUpdatedBy: null,
    consentNotes: null,
  };

  const governanceConfigResolver: GovernanceConfigResolver = vi.fn().mockResolvedValue(resolution);
  const postureCache = new InMemoryGovernancePostureCache();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const verdictStore: GovernanceVerdictStore = { save: vi.fn().mockResolvedValue({}) } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handoffStore: HandoffStore = {
    save: vi.fn().mockResolvedValue(undefined),
    annotate: vi.fn().mockResolvedValue(undefined),
    findOpenBySession: vi.fn().mockResolvedValue(null),
  } as any;
  const conversationStore: ConversationStatusSetter = {
    setConversationStatus: vi.fn().mockResolvedValue(undefined),
  };
  const consentService: ConsentService = {
    attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
    recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
    recordGrant: vi.fn().mockResolvedValue(undefined),
    recordRevocation: vi.fn().mockResolvedValue(undefined),
    clearConsent: vi.fn().mockResolvedValue(undefined),
  };
  const contactConsentReader: ContactConsentReader = {
    read: vi.fn().mockResolvedValue(consent),
  };
  const sessionContactResolver = vi
    .fn()
    .mockResolvedValue(overrides.contactId === undefined ? "c1" : overrides.contactId);

  return {
    deps: {
      governanceConfigResolver,
      postureCache,
      consentService,
      contactConsentReader,
      sessionContactResolver,
      verdictStore,
      handoffStore,
      conversationStore,
      clock: () => new Date("2026-05-11T10:00:00Z"),
    },
    verdictStore,
    consentService,
    handoffStore,
    conversationStore,
  };
};

const ctx = {
  deploymentId: "d1",
  orgId: "org1",
  skillSlug: "alex",
  skillVersion: "1.0.0",
  sessionId: "sess1",
  trustLevel: "observe" as const,
  trustScore: 0.5,
};

const SG_DISCLOSURE_TEXT =
  "Hi, I'm Alex — the clinic's AI assistant. I can help with bookings and general questions, and a clinic team member will step in for anything medical.";

describe("PdpaConsentGateHook", () => {
  it("passes through when resolution.status === missing", async () => {
    const { deps, verdictStore, consentService } = buildDeps({
      resolution: { status: "missing" },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "anything", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("anything");
    expect(consentService.attachToGovernedInteraction).not.toHaveBeenCalled();
    expect((verdictStore.save as any).mock.calls.length).toBe(0);
  });

  it("passes through when consentState.mode === off", async () => {
    const { deps } = buildDeps({
      resolution: {
        status: "resolved",
        config: { ...SG_CFG, consentState: { mode: "off" } },
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "x", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("x");
  });

  it("passes through when sessionContactResolver returns null", async () => {
    const { deps, consentService } = buildDeps({ contactId: null });
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "x", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(consentService.attachToGovernedInteraction).not.toHaveBeenCalled();
  });

  it("stamps jurisdiction via attachToGovernedInteraction", async () => {
    const { deps, consentService } = buildDeps();
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "x", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(consentService.attachToGovernedInteraction).toHaveBeenCalledWith("c1", "SG");
  });

  it("emits jurisdiction_mismatch critical verdict but does NOT block", async () => {
    const { deps, verdictStore } = buildDeps();
    (deps.consentService.attachToGovernedInteraction as any).mockRejectedValueOnce(
      Object.assign(new Error("mismatch"), {
        name: "ConsentJurisdictionMismatch",
        contactId: "c1",
        stamped: "MY",
        provided: "SG",
      }),
    );
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "untouched", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("untouched");
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.reasonCode).toBe("jurisdiction_mismatch");
    expect(saved.auditLevel).toBe("critical");
    expect(saved.action).toBe("allow");
  });

  it("on revoked status — defense-in-depth block (replaces response with handoff, flips status)", async () => {
    const { deps, conversationStore, handoffStore, verdictStore } = buildDeps({
      consent: {
        pdpaJurisdiction: "SG",
        consentGrantedAt: null,
        consentRevokedAt: "2026-05-10T00:00:00.000Z",
        consentSource: "inbound_keyword_revocation",
        aiDisclosureVersionShown: null,
        aiDisclosureShownAt: null,
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = {
      response: "would have replied",
      toolCalls: [],
      tokenUsage: {},
      trace: [],
    } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).not.toBe("would have replied");
    expect(conversationStore.setConversationStatus).toHaveBeenCalledWith(
      "sess1",
      "human_override",
      expect.anything(),
    );
    expect(handoffStore.save).toHaveBeenCalled();
    const saved = (verdictStore.save as any).mock.calls.find(
      (c: any[]) => c[0].reasonCode === "consent_revoked",
    );
    expect(saved).toBeDefined();
    expect(saved![0].action).toBe("block");
    expect(saved![0].auditLevel).toBe("critical");
    expect(saved![0].details.event).toBe("defense_in_depth_revoked_race");
  });

  it("disclosure shown for the first time → recordDisclosureShown called", async () => {
    const { deps, consentService } = buildDeps();
    const hook = new PdpaConsentGateHook(deps);
    const result = {
      response: SG_DISCLOSURE_TEXT + " Happy to help — what brings you in?",
      toolCalls: [],
      tokenUsage: {},
      trace: [],
    } as any;
    await hook.afterSkill(ctx, result);
    expect(consentService.recordDisclosureShown).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c1",
        jurisdiction: "SG",
        version: "sg-disclosure@1.0.0",
        actor: "system:skill_runtime",
      }),
    );
  });

  it("disclosure expected but missing in enforce → observe-level warning verdict, NO block", async () => {
    const { deps, verdictStore } = buildDeps();
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "hi there!", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("hi there!"); // unchanged — disclosure never blocks
    const saved = (verdictStore.save as any).mock.calls.find(
      (c: any[]) => c[0].reasonCode === "disclosure_not_shown",
    );
    expect(saved).toBeDefined();
    expect(saved![0].auditLevel).toBe("warning");
    expect(saved![0].action).toBe("allow");
  });

  it("disclosure already shown at current version → no recordDisclosureShown, no warning", async () => {
    const { deps, consentService, verdictStore } = buildDeps({
      consent: {
        pdpaJurisdiction: "SG",
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        aiDisclosureVersionShown: "sg-disclosure@1.0.0",
        aiDisclosureShownAt: "2026-05-10T00:00:00.000Z",
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "follow-up reply", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(consentService.recordDisclosureShown).not.toHaveBeenCalled();
    const warnings = (verdictStore.save as any).mock.calls.filter(
      (c: any[]) => c[0].reasonCode === "disclosure_not_shown",
    );
    expect(warnings.length).toBe(0);
  });

  it("disclosure stale (version outdated) and not present → disclosure_version_outdated warning", async () => {
    const { deps, verdictStore } = buildDeps({
      consent: {
        pdpaJurisdiction: "SG",
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        aiDisclosureVersionShown: "sg-disclosure@0.9.0",
        aiDisclosureShownAt: "2026-04-01T00:00:00.000Z",
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "hi again!", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    const saved = (verdictStore.save as any).mock.calls.find(
      (c: any[]) => c[0].reasonCode === "disclosure_version_outdated",
    );
    expect(saved).toBeDefined();
    expect(saved![0].auditLevel).toBe("warning");
  });

  it("resolver-error + cold cache → fail open (no verdict)", async () => {
    const { deps, verdictStore } = buildDeps({
      resolution: { status: "error", error: new Error("db down") },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "anything", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("anything");
    expect((verdictStore.save as any).mock.calls.length).toBe(0);
  });

  it("resolver-error + cached enforce posture → governance_unavailable critical verdict (no block in 1c)", async () => {
    const { deps, verdictStore } = buildDeps({
      resolution: { status: "error", error: new Error("db down") },
    });
    // Warm the cache as if a prior turn resolved enforce on SG/medical.
    deps.postureCache.remember("d1", {
      mode: "enforce",
      jurisdiction: "SG",
      clinicType: "medical",
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = { response: "anything", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    // No block in 1c (operational only blocks on revoked, which we don't know on resolver error).
    expect(result.response).toBe("anything");
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.reasonCode).toBe("governance_unavailable");
    expect(saved.auditLevel).toBe("critical");
    expect(saved.jurisdiction).toBe("SG");
    expect(saved.clinicType).toBe("medical");
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @switchboard/core test -- pdpa-consent-gate
```

Expected: module-not-found.

- [ ] **Step 3: Create `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`**

```ts
import {
  AI_DISCLOSURE_VERSIONS,
  evaluateConsentGate,
  resolveConsentStateConfig,
  type PdpaJurisdiction,
} from "@switchboard/schemas";
import type { SkillHook, SkillHookContext, SkillExecutionResult } from "../types.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import type { GovernancePostureCache } from "../../governance/posture-cache.js";
import type { GovernanceVerdictStore } from "../../governance/governance-verdict-store/types.js";
import type { HandoffStore } from "../../handoff/types.js";
import { buildHandoffPackage } from "../../handoff/build-handoff-package.js";
import { renderHandoffTemplate } from "../../governance/handoff-template.js";
import type { ConsentService } from "../../consent/consent-service.js";
import type { ContactConsentReader } from "../../consent/contact-consent-reader.js";
import { ConsentJurisdictionMismatch } from "../../consent/errors.js";
import { DISCLOSURE_COPY } from "../../consent/disclosure-copy.js";
import type { ConversationStatusSetter } from "./deterministic-safety-gate.js";

export interface PdpaConsentGateHookDeps {
  governanceConfigResolver: GovernanceConfigResolver;
  postureCache: GovernancePostureCache;
  consentService: ConsentService;
  contactConsentReader: ContactConsentReader;
  sessionContactResolver: (sessionId: string) => Promise<string | null>;
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  conversationStore: ConversationStatusSetter;
  clock: () => Date;
}

export class PdpaConsentGateHook implements SkillHook {
  readonly name = "pdpa-consent-gate";

  constructor(private readonly deps: PdpaConsentGateHookDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const {
      governanceConfigResolver,
      postureCache,
      consentService,
      contactConsentReader,
      sessionContactResolver,
      verdictStore,
      handoffStore,
      conversationStore,
      clock,
    } = this.deps;

    // 1. Resolve governance config.
    const resolution = await governanceConfigResolver(ctx.deploymentId);
    if (resolution.status === "missing") return;

    if (resolution.status === "error") {
      // Mirror 1b-1 fail-open/fail-closed semantics, scoped to consent-gate posture.
      const cached = postureCache.lastKnown(ctx.deploymentId);
      if (cached?.mode === "enforce") {
        // 1c special-case: do NOT block result.response. Operational only blocks
        // on revoked, which we cannot determine here. Emit critical verdict and
        // proceed.
        await this.saveVerdict({
          reasonCode: "governance_unavailable",
          action: "allow",
          auditLevel: "critical",
          jurisdiction: cached.jurisdiction,
          clinicType: cached.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: { event: "resolver_error_fail_open_in_consent_gate" },
          deploymentId: ctx.deploymentId,
        });
      } else {
        console.error("[pdpa-consent-gate] resolver error; fail-open (no cached enforce posture)");
      }
      return;
    }

    const config = resolution.config;
    const consentConfig = resolveConsentStateConfig(config);
    if (consentConfig.mode === "off") return;

    postureCache.remember(ctx.deploymentId, {
      mode: consentConfig.mode,
      jurisdiction: config.jurisdiction,
      clinicType: config.clinicType,
    });

    // 2. Resolve contact (null = pre-contact transient).
    const contactId = await sessionContactResolver(ctx.sessionId);
    if (!contactId) return;

    // 3. Stamp jurisdiction intentionally (NOT via disclosure path).
    try {
      await consentService.attachToGovernedInteraction(
        contactId,
        config.jurisdiction as PdpaJurisdiction,
      );
    } catch (err) {
      if (
        err instanceof ConsentJurisdictionMismatch ||
        (err as Error).name === "ConsentJurisdictionMismatch"
      ) {
        console.error("[pdpa-consent-gate] jurisdiction mismatch", err);
        await this.saveVerdict({
          reasonCode: "jurisdiction_mismatch",
          action: "allow",
          auditLevel: "critical",
          jurisdiction: config.jurisdiction,
          clinicType: config.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: {
            event: "jurisdiction_mismatch",
            stamped: (err as ConsentJurisdictionMismatch).stamped,
            provided: (err as ConsentJurisdictionMismatch).provided,
            contactId,
          },
          deploymentId: ctx.deploymentId,
        });
        return;
      }
      throw err;
    }

    // 4. Read consent state.
    const consent = await contactConsentReader.read(contactId);

    // 5. Evaluate gate (operational class always in 1c).
    const decision = evaluateConsentGate({
      contact: {
        pdpaJurisdiction: consent.pdpaJurisdiction,
        consentGrantedAt: consent.consentGrantedAt,
        consentRevokedAt: consent.consentRevokedAt,
      },
      messageClass: "operational",
    });

    if (decision.action === "block") {
      // Defense-in-depth: revoked-race block.
      const originalText = result.response;
      result.response = renderHandoffTemplate({
        jurisdiction: config.jurisdiction as "SG" | "MY",
        reasonCode: "consent_revoked",
      });
      await this.saveVerdict({
        reasonCode: "consent_revoked",
        action: "block",
        auditLevel: "critical",
        jurisdiction: config.jurisdiction,
        clinicType: config.clinicType,
        conversationId: ctx.sessionId,
        originalText,
        emittedText: result.response,
        details: { event: "defense_in_depth_revoked_race" },
        deploymentId: ctx.deploymentId,
      });
      try {
        await conversationStore.setConversationStatus(ctx.sessionId, "human_override");
        await handoffStore.save(buildHandoffPackage(ctx.sessionId, ctx.orgId, 0, clock));
      } catch (e) {
        console.error("[pdpa-consent-gate] block-side persistence failure", e);
      }
      return;
    }

    // 6. Allow path — disclosure detection. Never blocks.
    const expected = DISCLOSURE_COPY[config.jurisdiction as PdpaJurisdiction];
    // v1 deterministic heuristic, not compliance-proof validation.
    const includesDisclosure = result.response.includes(expected.text);

    if (consent.aiDisclosureShownAt === null) {
      if (includesDisclosure) {
        await consentService.recordDisclosureShown({
          contactId,
          jurisdiction: config.jurisdiction as PdpaJurisdiction,
          version: expected.version,
          shownAt: clock(),
          actor: "system:skill_runtime",
        });
      } else if (consentConfig.mode === "enforce") {
        await this.saveVerdict({
          reasonCode: "disclosure_not_shown",
          action: "allow",
          auditLevel: "warning",
          jurisdiction: config.jurisdiction,
          clinicType: config.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: { expectedVersion: expected.version, sentinelDetected: false },
          deploymentId: ctx.deploymentId,
        });
      }
    } else if (consent.aiDisclosureVersionShown !== expected.version) {
      if (includesDisclosure) {
        await consentService.recordDisclosureShown({
          contactId,
          jurisdiction: config.jurisdiction as PdpaJurisdiction,
          version: expected.version,
          shownAt: clock(),
          actor: "system:skill_runtime",
        });
      } else if (consentConfig.mode === "enforce") {
        await this.saveVerdict({
          reasonCode: "disclosure_version_outdated",
          action: "allow",
          auditLevel: "warning",
          jurisdiction: config.jurisdiction,
          clinicType: config.clinicType,
          conversationId: ctx.sessionId,
          originalText: result.response,
          details: {
            currentVersion: consent.aiDisclosureVersionShown,
            expectedVersion: expected.version,
            sentinelDetected: false,
          },
          deploymentId: ctx.deploymentId,
        });
      }
    }
  }

  private async saveVerdict(input: {
    reasonCode: string;
    action: "allow" | "block";
    auditLevel: "info" | "warning" | "critical";
    jurisdiction: string;
    clinicType: string;
    conversationId: string;
    originalText?: string;
    emittedText?: string;
    details: Record<string, unknown>;
    deploymentId: string;
  }) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.deps.verdictStore.save as any)({
        deploymentId: input.deploymentId,
        sourceGuard: "consent_gate",
        action: input.action,
        reasonCode: input.reasonCode,
        jurisdiction: input.jurisdiction,
        clinicType: input.clinicType,
        sourceGuard_compat: undefined, // satisfy strict shape if needed
        originalText: input.originalText,
        emittedText: input.emittedText,
        auditLevel: input.auditLevel,
        decidedAt: this.deps.clock().toISOString(),
        conversationId: input.conversationId,
        details: input.details,
      });
    } catch (err) {
      console.error("[pdpa-consent-gate] verdict persistence failure", err);
    }
  }
}
```

Notes:

- Verify the exact shape of `SaveGovernanceVerdictInput` against `packages/core/src/governance/governance-verdict-store/types.ts` (1b-1 Section 6 defined it). Remove any speculative fields like `sourceGuard_compat` after reading the real interface; align field names.
- `renderHandoffTemplate` accepts `reasonCode: GovernanceVerdictReason` (per 1b-1 Section 5). Passing `"consent_revoked"` is valid because the function returns the same per-jurisdiction string regardless of reason in 1b-1.

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @switchboard/core test -- pdpa-consent-gate
```

Expected: PASS. If `saveVerdict` shape mismatches `GovernanceVerdictStore.save`, fix to the real signature.

- [ ] **Step 5: Rebuild core**

```bash
pnpm --filter @switchboard/core build
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts packages/core/src/skill-runtime/hooks/__tests__/pdpa-consent-gate.test.ts
git commit -m "feat(core): add pdpaconsentgatehook with disclosure detection and defense-in-depth"
```

---

## Task 11: Channel-gateway revocation scanner (pre-input)

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts` (extend `ChannelGatewayConfig`)
- Modify: `packages/core/src/channel-gateway/pre-input-gate.ts` (or add a new `runConsentRevocationGate` and call it before the existing 1b-1 escalation gate)
- Modify: `packages/core/src/channel-gateway/channel-gateway.ts` (call site)
- Test: `packages/core/src/channel-gateway/__tests__/pre-input-consent-gate.test.ts`

The cleanest factoring mirrors 1b-1: extract a pure function `runConsentRevocationGate` to its own file rather than overloading the existing escalation gate.

- [ ] **Step 1: Extend `ChannelGatewayConfig`**

In `packages/core/src/channel-gateway/types.ts`, add (alongside existing 1b-1 gate config):

```ts
import type { ConsentService } from "../consent/consent-service.js";
import type { RevocationKeywordEntry } from "../consent/revocation-keywords/types.js";
import type { PdpaJurisdiction } from "@switchboard/schemas";

export interface ChannelGatewayConfig {
  // ... existing fields ...
  consentRevocationGate?: {
    governanceConfigResolver: GovernanceConfigResolver;
    consentService: ConsentService;
    postureCache: GovernancePostureCache;
    revocationKeywordLoader: (j: PdpaJurisdiction) => ReadonlyArray<RevocationKeywordEntry>;
    sessionContactResolver: (sessionId: string) => Promise<string | null>;
    verdictStore: GovernanceVerdictStore;
    clock: () => Date;
  };
}
```

Optional — bootstrap (Task 13) decides whether to wire it. When undefined, the gate is a pass-through.

- [ ] **Step 2: Write failing pre-input gate test**

`packages/core/src/channel-gateway/__tests__/pre-input-consent-gate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runConsentRevocationGate } from "../consent-revocation-gate.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";
import { loadRevocationKeywords } from "../../consent/revocation-keywords/loader.js";

const SG_ENFORCE = {
  status: "resolved" as const,
  config: {
    jurisdiction: "SG" as const,
    clinicType: "medical" as const,
    consentState: { mode: "enforce" as const },
  },
};

const buildDeps = (resolution = SG_ENFORCE) => {
  const governanceConfigResolver = vi.fn().mockResolvedValue(resolution);
  const consentService = {
    attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
    recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
    recordGrant: vi.fn().mockResolvedValue(undefined),
    recordRevocation: vi.fn().mockResolvedValue(undefined),
    clearConsent: vi.fn().mockResolvedValue(undefined),
  };
  const verdictStore = { save: vi.fn().mockResolvedValue({}) };
  const postureCache = new InMemoryGovernancePostureCache();
  const sessionContactResolver = vi.fn().mockResolvedValue("c1");
  const replySink = { send: vi.fn().mockResolvedValue(undefined) };
  return {
    cfg: {
      governanceConfigResolver,
      consentService,
      postureCache,
      revocationKeywordLoader: loadRevocationKeywords,
      sessionContactResolver,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      verdictStore: verdictStore as any,
      clock: () => new Date("2026-05-11T10:00:00Z"),
    },
    replySink,
    consentService,
    verdictStore,
  };
};

describe("runConsentRevocationGate", () => {
  it("returns 'proceed' when no keyword match", async () => {
    const { cfg, replySink } = buildDeps();
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "Hi looking to book a facial next Tue",
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("proceed");
  });

  it("returns 'revoked' on STOP match in enforce mode", async () => {
    const { cfg, replySink, consentService } = buildDeps();
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "STOP messaging me",
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("revoked");
    expect(consentService.recordRevocation).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c1",
        source: "inbound_keyword_revocation",
        openConversationSessionId: "sess1",
      }),
    );
    expect(replySink.send).toHaveBeenCalled();
  });

  it("observe mode — emits warning verdict but does NOT mutate state or send ack", async () => {
    const obs = {
      status: "resolved" as const,
      config: {
        jurisdiction: "MY" as const,
        clinicType: "nonMedical" as const,
        consentState: { mode: "observe" as const },
      },
    };
    const { cfg, replySink, consentService, verdictStore } = buildDeps(obs);
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "berhenti hantar pesanan",
      sessionId: "sess2",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("proceed");
    expect(consentService.recordRevocation).not.toHaveBeenCalled();
    expect(replySink.send).not.toHaveBeenCalled();
    expect((verdictStore.save as any).mock.calls[0][0].auditLevel).toBe("warning");
  });

  it("mode=off — pure pass-through", async () => {
    const off = {
      status: "resolved" as const,
      config: {
        jurisdiction: "SG" as const,
        clinicType: "medical" as const,
        consentState: { mode: "off" as const },
      },
    };
    const { cfg, replySink, consentService, verdictStore } = buildDeps(off);
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "STOP",
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("proceed");
    expect(consentService.recordRevocation).not.toHaveBeenCalled();
    expect((verdictStore.save as any).mock.calls.length).toBe(0);
  });

  it("pre-contact (sessionContactResolver returns null) → proceed", async () => {
    const { cfg, replySink, consentService } = buildDeps();
    (cfg.sessionContactResolver as any).mockResolvedValue(null);
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "STOP",
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("proceed");
    expect(consentService.recordRevocation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Verify failure**

```bash
pnpm --filter @switchboard/core test -- pre-input-consent-gate
```

Expected: module-not-found.

- [ ] **Step 4: Create `packages/core/src/channel-gateway/consent-revocation-gate.ts`**

```ts
import { resolveConsentStateConfig, type PdpaJurisdiction } from "@switchboard/schemas";
import type { ChannelGatewayConfig, ReplySink } from "./types.js";
import { scanForRevocationKeywords } from "../consent/scanner/revocation-keyword-scanner.js";
import { REVOCATION_ACK } from "../consent/revocation-ack.js";

export interface RunConsentRevocationGateInput {
  cfg: NonNullable<ChannelGatewayConfig["consentRevocationGate"]>;
  inboundText: string;
  sessionId: string;
  deploymentId: string;
  organizationId: string;
  replySink: ReplySink;
}

/**
 * Pre-input consent revocation gate. Runs BEFORE the 1b-1 escalation gate.
 *
 * Returns:
 *  - "revoked" → revocation captured + ack sent; caller MUST skip submit
 *    and the 1b-1 escalation gate.
 *  - "proceed" → continue to the next gate.
 */
export async function runConsentRevocationGate(
  input: RunConsentRevocationGateInput,
): Promise<"revoked" | "proceed"> {
  const { cfg, inboundText, sessionId, deploymentId, replySink } = input;

  const resolution = await cfg.governanceConfigResolver(deploymentId);
  if (resolution.status === "missing") return "proceed";

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
          originalText: inboundText,
          details: { event: "gateway_resolver_error_fail_open" },
          auditLevel: "critical",
        });
      } catch (err) {
        console.error("[consent-revocation-gate] verdict persist failure", err);
      }
    } else {
      console.error("[consent-revocation-gate] resolver error; no cached enforce posture");
    }
    return "proceed";
  }

  const consentConfig = resolveConsentStateConfig(resolution.config);
  if (consentConfig.mode === "off") return "proceed";

  cfg.postureCache.remember(deploymentId, {
    mode: consentConfig.mode,
    jurisdiction: resolution.config.jurisdiction,
    clinicType: resolution.config.clinicType,
  });

  const entries = cfg.revocationKeywordLoader(resolution.config.jurisdiction as PdpaJurisdiction);
  const matches = scanForRevocationKeywords(inboundText, entries);
  if (matches.length === 0) return "proceed";

  const contactId = await cfg.sessionContactResolver(sessionId);
  if (!contactId) return "proceed"; // pre-contact inbound

  if (consentConfig.mode === "observe") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (cfg.verdictStore.save as any)({
        deploymentId,
        sourceGuard: "consent_gate",
        action: "allow",
        reasonCode: "consent_revoked",
        jurisdiction: resolution.config.jurisdiction,
        clinicType: resolution.config.clinicType,
        conversationId: sessionId,
        decidedAt: cfg.clock().toISOString(),
        originalText: inboundText,
        auditLevel: "warning",
        details: {
          observe: true,
          matchId: matches[0].entry.id,
          matchedText: matches[0].matched,
        },
      });
    } catch (err) {
      console.error("[consent-revocation-gate] observe-verdict persist failure", err);
    }
    return "proceed";
  }

  // enforce mode
  await cfg.consentService.recordRevocation({
    contactId,
    source: "inbound_keyword_revocation",
    revokedAt: cfg.clock(),
    actor: "system:inbound_keyword_revocation",
    notes: `keyword=${matches[0].entry.id}, matched="${matches[0].matched}"`,
    openConversationSessionId: sessionId,
  });

  await replySink.send(REVOCATION_ACK[resolution.config.jurisdiction as PdpaJurisdiction]);
  return "revoked";
}
```

- [ ] **Step 5: Verify pass**

```bash
pnpm --filter @switchboard/core test -- pre-input-consent-gate
```

Expected: PASS.

- [ ] **Step 6: Wire into `channel-gateway.ts`**

In `packages/core/src/channel-gateway/channel-gateway.ts`, just **before** the existing `runPreInputGate(...)` call (~line 186), insert:

```ts
// 4e-pre. Pre-input consent revocation gate (Phase 1c). Runs BEFORE the
// 1b-1 escalation gate so user revocation takes precedence over medical-
// safety/compliance triggers.
if (this.config.consentRevocationGate) {
  const consentOutcome = await runConsentRevocationGate({
    cfg: this.config.consentRevocationGate,
    inboundText: message.text,
    sessionId: message.sessionId,
    deploymentId: resolved.deploymentId,
    organizationId: resolved.organizationId,
    replySink,
  });
  if (consentOutcome === "revoked") return;
}
```

And add at the top: `import { runConsentRevocationGate } from "./consent-revocation-gate.js";`

- [ ] **Step 7: Add a focused integration test**

`packages/core/src/channel-gateway/__tests__/channel-gateway-consent-ordering.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
// Build a minimal ChannelGateway instance with both consent + escalation gates
// wired, send an inbound containing BOTH "STOP" and a pregnancy keyword, and
// assert: revocation fires (recordRevocation called), escalation gate is NOT
// called (escalationTriggerLoader not invoked).

// Implementation: depend on harnesses in `packages/core/src/channel-gateway/__tests__/`
// to scaffold a gateway with both gate configs. The point is the precedence
// invariant: a single test that fails if a future refactor reorders the gates.
```

Flesh out per the patterns in existing `channel-gateway/__tests__/*` files (re-use the existing test scaffolding).

- [ ] **Step 8: Verify build + tests pass**

```bash
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/core build
```

Expected: PASS + clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/channel-gateway/
git commit -m "feat(core): add pre-input consent revocation gate before 1b-1 escalation"
```

---

## Task 12: Admin endpoint — `/api/admin/consent/*`

**Files:**

- Create: `apps/api/src/routes/admin-consent.ts`
- Modify: `apps/api/src/server.ts` (register the route)
- Test: `apps/api/src/__tests__/admin-consent.test.ts`

- [ ] **Step 1: Write failing test using `buildTestServer`**

`apps/api/src/__tests__/admin-consent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTestServer } from "./helpers/build-test-server.js";

const grantBody = {
  contactId: "c1",
  jurisdiction: "MY",
  source: "operator_recorded",
  grantedAt: "2026-05-11T10:00:00.000Z",
  notes: "Captured offline at intake",
};

const revokeBody = {
  contactId: "c1",
  source: "operator_recorded_revocation",
  revokedAt: "2026-05-11T11:00:00.000Z",
  notes: "Customer requested by phone",
};

const clearBody = {
  contactId: "c1",
  notes: "Operator reset after revocation cycle complete",
};

describe("POST /api/admin/consent/grant", () => {
  it("returns 200 + post-mutation state", async () => {
    const server = await buildTestServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      payload: grantBody,
      headers: { authorization: "Bearer admin-test-token" },
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.status).toBe("granted");
    expect(json.consentGrantedAt).toBeTruthy();
  });

  it("returns 409 with hint when contact is already revoked", async () => {
    const server = await buildTestServer({
      preSeed: async (deps) => {
        // Seed the contact with revokedAt set.
        await deps.consentService.recordRevocation({
          contactId: "c1",
          source: "inbound_keyword_revocation",
          revokedAt: new Date("2026-05-10T00:00:00Z"),
          actor: "system:inbound_keyword_revocation",
        });
      },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      payload: grantBody,
      headers: { authorization: "Bearer admin-test-token" },
    });
    expect(res.statusCode).toBe(409);
    const json = JSON.parse(res.payload);
    expect(json.error).toBe("consent_revoked_cannot_regrant");
    expect(json.hint).toMatch(/clear/);
  });

  it("returns 400 with stamped+provided when jurisdiction mismatches", async () => {
    const server = await buildTestServer({
      preSeed: async (deps) => {
        await deps.consentService.attachToGovernedInteraction("c1", "SG");
      },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/consent/grant",
      payload: { ...grantBody, jurisdiction: "MY" },
      headers: { authorization: "Bearer admin-test-token" },
    });
    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.payload);
    expect(json.error).toBe("jurisdiction_mismatch");
    expect(json.stamped).toBe("SG");
    expect(json.provided).toBe("MY");
  });
});

describe("POST /api/admin/consent/revoke", () => {
  it("returns 200 with revoked status", async () => {
    const server = await buildTestServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/consent/revoke",
      payload: revokeBody,
      headers: { authorization: "Bearer admin-test-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).status).toBe("revoked");
  });
});

describe("POST /api/admin/consent/clear", () => {
  it("returns 400 when notes are empty", async () => {
    const server = await buildTestServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      payload: { ...clearBody, notes: "" },
      headers: { authorization: "Bearer admin-test-token" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 + pending status after successful clear", async () => {
    const server = await buildTestServer({
      preSeed: async (deps) => {
        await deps.consentService.recordRevocation({
          contactId: "c1",
          source: "inbound_keyword_revocation",
          revokedAt: new Date("2026-05-10"),
          actor: "system:inbound_keyword_revocation",
        });
      },
    });
    const res = await server.inject({
      method: "POST",
      url: "/api/admin/consent/clear",
      payload: clearBody,
      headers: { authorization: "Bearer admin-test-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).status).toBe("pending");
  });
});

describe("GET /api/admin/consent/:contactId", () => {
  it("returns 404 when contact missing", async () => {
    const server = await buildTestServer();
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/consent/does-not-exist",
      headers: { authorization: "Bearer admin-test-token" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns state + derived status", async () => {
    const server = await buildTestServer();
    const res = await server.inject({
      method: "GET",
      url: "/api/admin/consent/c1",
      headers: { authorization: "Bearer admin-test-token" },
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("pdpaJurisdiction");
  });
});
```

The `buildTestServer` harness lives at `apps/api/src/__tests__/helpers/build-test-server.ts` and is the established convention per `feedback_api_test_mocked_prisma.md`. Extend it to accept the optional `preSeed` callback that runs against the assembled deps before each test. If the helper does not currently expose `consentService`, this task wires it via the `preSeed` deps object.

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @switchboard/api test -- admin-consent
```

Expected: route-not-found / module-not-found.

- [ ] **Step 3: Create `apps/api/src/routes/admin-consent.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  PdpaJurisdictionSchema,
  ConsentSourceSchema,
  deriveConsentStatus,
} from "@switchboard/schemas";
import {
  type ConsentService,
  type ContactConsentReader,
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  ContactNotFound,
} from "@switchboard/core";

const GrantBody = z.object({
  contactId: z.string().min(1),
  jurisdiction: PdpaJurisdictionSchema,
  source: z.enum(["whatsapp_quick_reply", "ig_dm_reply", "web_form", "operator_recorded"]),
  grantedAt: z.string().datetime(),
  notes: z.string().optional(),
});

const RevokeBody = z.object({
  contactId: z.string().min(1),
  source: z.literal("operator_recorded_revocation"),
  revokedAt: z.string().datetime(),
  notes: z.string().optional(),
});

const ClearBody = z.object({
  contactId: z.string().min(1),
  notes: z.string().min(1, "notes are required for audit trail"),
});

export interface AdminConsentRouteDeps {
  consentService: ConsentService;
  consentReader: ContactConsentReader;
  /** Resolves the actor (operator userId) from the request. */
  resolveActor: (req: import("fastify").FastifyRequest) => Promise<string>;
}

export function registerAdminConsentRoutes(
  app: FastifyInstance,
  deps: AdminConsentRouteDeps,
): void {
  const respondWithState = async (contactId: string) => {
    const state = await deps.consentReader.read(contactId);
    return {
      ...state,
      status: deriveConsentStatus({
        pdpaJurisdiction: state.pdpaJurisdiction,
        consentGrantedAt: state.consentGrantedAt,
        consentRevokedAt: state.consentRevokedAt,
      }),
    };
  };

  app.post("/api/admin/consent/grant", async (req, reply) => {
    const parsed = GrantBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });

    try {
      const actor = await deps.resolveActor(req);
      await deps.consentService.recordGrant({
        contactId: parsed.data.contactId,
        jurisdiction: parsed.data.jurisdiction,
        source: parsed.data.source,
        grantedAt: new Date(parsed.data.grantedAt),
        actor,
        notes: parsed.data.notes,
      });
      return reply.send(await respondWithState(parsed.data.contactId));
    } catch (err) {
      return mapError(reply, err);
    }
  });

  app.post("/api/admin/consent/revoke", async (req, reply) => {
    const parsed = RevokeBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });

    try {
      const actor = await deps.resolveActor(req);
      await deps.consentService.recordRevocation({
        contactId: parsed.data.contactId,
        source: "operator_recorded_revocation",
        revokedAt: new Date(parsed.data.revokedAt),
        actor,
        notes: parsed.data.notes,
      });
      return reply.send(await respondWithState(parsed.data.contactId));
    } catch (err) {
      return mapError(reply, err);
    }
  });

  app.post("/api/admin/consent/clear", async (req, reply) => {
    const parsed = ClearBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(400).send({ error: "invalid_body", issues: parsed.error.issues });

    try {
      const actor = await deps.resolveActor(req);
      await deps.consentService.clearConsent({
        contactId: parsed.data.contactId,
        actor,
        notes: parsed.data.notes,
      });
      return reply.send(await respondWithState(parsed.data.contactId));
    } catch (err) {
      return mapError(reply, err);
    }
  });

  app.get<{ Params: { contactId: string } }>(
    "/api/admin/consent/:contactId",
    async (req, reply) => {
      try {
        return reply.send(await respondWithState(req.params.contactId));
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );
}

function mapError(reply: import("fastify").FastifyReply, err: unknown) {
  if (err instanceof ContactNotFound) {
    return reply.status(404).send({ error: "contact_not_found", contactId: err.contactId });
  }
  if (err instanceof ConsentJurisdictionMismatch) {
    return reply.status(400).send({
      error: "jurisdiction_mismatch",
      stamped: err.stamped,
      provided: err.provided,
    });
  }
  if (err instanceof ConsentRevokedCannotRegrant) {
    return reply.status(409).send({
      error: "consent_revoked_cannot_regrant",
      hint: "POST /api/admin/consent/clear first to start a fresh cycle",
      revokedAt: err.revokedAt.toISOString(),
    });
  }
  if (err instanceof Error && (err.message.includes("notes") || err.message.includes("system:"))) {
    return reply.status(400).send({ error: "invalid_actor_or_notes", message: err.message });
  }
  reply.log.error({ err }, "admin-consent unexpected error");
  return reply.status(500).send({ error: "internal_error" });
}
```

- [ ] **Step 4: Register the routes in `apps/api/src/server.ts`**

Inside the existing route-registration block:

```ts
import { registerAdminConsentRoutes } from "./routes/admin-consent.js";
// ...
registerAdminConsentRoutes(app, {
  consentService: bootstrap.consentService,
  consentReader: bootstrap.contactConsentReader,
  resolveActor: async (req) => req.user?.id ?? "system:unknown_admin",
});
```

The exact `bootstrap` identifier mirrors the existing pattern in `server.ts` (probably reads from `apps/api/src/bootstrap/...`). Task 13 wires `consentService` + `contactConsentReader` into the bootstrap.

- [ ] **Step 5: Verify tests pass**

```bash
pnpm --filter @switchboard/api test -- admin-consent
```

Expected: PASS (after `buildTestServer` is extended with the consent-service preSeed seam).

- [ ] **Step 6: Build api package**

```bash
pnpm --filter @switchboard/api build
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin-consent.ts apps/api/src/server.ts apps/api/src/__tests__/admin-consent.test.ts apps/api/src/__tests__/helpers/build-test-server.ts
git commit -m "feat(api): add admin consent grant/revoke/clear endpoints"
```

---

## Task 13: Bootstrap wiring — `PdpaConsentGateHook` + third posture cache + gateway revocation gate

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts` (and any sibling `bootstrap` files that construct `ChannelGateway`)
- Test: `apps/api/src/__tests__/skill-mode-hook-ordering.test.ts` (extend or create)

- [ ] **Step 1: Write failing hook-ordering test**

Append to (or create) `apps/api/src/__tests__/skill-mode-hook-ordering.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assembleSkillModeBootstrap } from "../bootstrap/skill-mode.js";

describe("skill-mode hook chain ordering", () => {
  it("registers hooks in the order: deterministic-safety-gate, claim-classifier, pdpa-consent-gate, trace-persistence", async () => {
    const bootstrap = await assembleSkillModeBootstrap({
      // pass test-mode flag or minimal config used elsewhere
      mode: "test",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const names = bootstrap.skillRuntimeHooks.map((h: { name: string }) => h.name);
    expect(names).toEqual([
      "deterministic-safety-gate",
      "claim-classifier",
      "pdpa-consent-gate",
      "trace-persistence",
    ]);
  });

  it("pdpa-consent-gate is the LAST hook before trace-persistence (hook-ordering invariant)", async () => {
    const bootstrap = await assembleSkillModeBootstrap({ mode: "test" } as any);
    const names = bootstrap.skillRuntimeHooks.map((h: { name: string }) => h.name);
    const pdpaIdx = names.indexOf("pdpa-consent-gate");
    const traceIdx = names.indexOf("trace-persistence");
    expect(traceIdx).toBe(pdpaIdx + 1);
  });
});
```

Adapt to whatever shape `bootstrap/skill-mode.ts` exposes — the existing 1b-2 plan has a similar test pattern (Task 16). Reuse its harness.

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @switchboard/api test -- skill-mode-hook-ordering
```

Expected: fails because `pdpa-consent-gate` is not yet registered between `claim-classifier` and `trace-persistence`.

- [ ] **Step 3: Wire the consent stack into `bootstrap/skill-mode.ts`**

Add (near the 1b-1 / 1b-2 posture-cache and hook constructions):

```ts
import { PdpaConsentGateHook } from "@switchboard/core/skill-runtime/hooks/pdpa-consent-gate.js";
import { createConsentService, loadRevocationKeywords } from "@switchboard/core";
import { createPrismaConsentStore } from "@switchboard/db/prisma-consent-store.js";
import { createPrismaContactConsentReader } from "@switchboard/db/prisma-contact-consent-reader.js";
import { InMemoryGovernancePostureCache } from "@switchboard/core/governance/posture-cache.js";

// ... inside the assemble function, near the other gates ...

const consentStore = createPrismaConsentStore({ prisma });
const contactConsentReader = createPrismaContactConsentReader({ prisma });
const consentPostureCache = new InMemoryGovernancePostureCache();

// sessionContactResolver: maps sessionId → contactId via ConversationThread.
const sessionContactResolver = async (sessionId: string): Promise<string | null> => {
  // Note: ConversationThread is keyed by (contactId, organizationId) — there
  // is no direct sessionId field. Use the same lookup the 1b-1 deterministic
  // gate uses (see DeterministicSafetyGateHook wiring) to derive contactId
  // from the session's conversation. If that lookup is not yet centralized,
  // extract a `sessionConversationResolver` shared across hooks now.
  const thread = await prisma.conversationThread.findFirst({
    where: { id: sessionId },
    select: { contactId: true },
  });
  return thread?.contactId ?? null;
};

// Construct ConsentService once; reused by hook + revocation gate + admin routes.
const consentService = createConsentService({
  store: consentStore,
  verdictStore,
  handoffStore,
  conversationStore: conversationStatusSetter, // same instance the 1b-1 gate uses
  clock,
  deploymentId: defaultDeploymentId, // or per-org as in existing bootstrap shape
  orgId: defaultOrgId,
  clinicType: "medical", // overridden per-deployment via governanceConfig at runtime
});

const pdpaConsentGateHook = new PdpaConsentGateHook({
  governanceConfigResolver,
  postureCache: consentPostureCache,
  consentService,
  contactConsentReader,
  sessionContactResolver,
  verdictStore,
  handoffStore,
  conversationStore: conversationStatusSetter,
  clock,
});

const skillRuntimeHooks = [
  deterministicSafetyGateHook, // 1b-1
  claimClassifierHook, // 1b-2
  pdpaConsentGateHook, // 1c — NEW
  tracePersistenceHook,
];
```

And wire the consent revocation gate into the `ChannelGateway` config:

```ts
const channelGatewayConfig: ChannelGatewayConfig = {
  // ... existing 1b-1 escalation gate config + identity / lifecycle config ...
  consentRevocationGate: {
    governanceConfigResolver,
    consentService,
    postureCache: consentPostureCache, // SHARED with the runtime hook
    revocationKeywordLoader: loadRevocationKeywords,
    sessionContactResolver,
    verdictStore,
    clock,
  },
};
```

Note: depending on the existing bootstrap topology, `defaultDeploymentId` and `defaultOrgId` may not be statically known — `ConsentService` per-deployment instances would be assembled by a factory. If so, mirror the same per-deployment construction pattern used by 1b-1/1b-2 hooks.

Also expose `consentService` + `contactConsentReader` on the bootstrap return so `apps/api/src/server.ts` (Task 12) can wire them into the admin route registration.

- [ ] **Step 4: Verify ordering test passes**

```bash
pnpm --filter @switchboard/api test -- skill-mode-hook-ordering
```

Expected: PASS.

- [ ] **Step 5: Verify full api test suite passes**

```bash
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/api build
```

Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts apps/api/src/__tests__/skill-mode-hook-ordering.test.ts
git commit -m "feat(api): wire pdpaconsentgatehook revocation gate and admin endpoint"
```

---

## Task 14: Reference markdown sync + 1c follow-up doc

**Files:**

- Modify: `skills/alex/references/regulatory/sg-rules.md`
- Modify: `skills/alex/references/regulatory/my-rules.md`
- Create: `docs/superpowers/plans/2026-05-11-alex-medspa-1c-followups.md`

- [ ] **Step 1: Append "Runtime PDPA consent gate (1c)" section to SG and MY rules**

To each of `skills/alex/references/regulatory/sg-rules.md` and `my-rules.md`, append:

```markdown
## Runtime PDPA consent gate (Phase 1c)

Runtime enforcement layered atop the prompt-level rules above. **Sources of truth (TS, not markdown):**

- AI disclosure copy: `packages/core/src/consent/disclosure-copy.ts` (versioned `AI_DISCLOSURE_VERSIONS` in `packages/schemas/src/pdpa-consent.ts`).
- Revocation keyword tables: `packages/core/src/consent/revocation-keywords/{common,sg,my}.ts`.
- Revocation acknowledgment copy: `packages/core/src/consent/revocation-ack.ts`.
- Consent state mutation surface: `packages/core/src/consent/consent-service.ts`.
- Outbound consent gate: `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`.
- Pre-input revocation gate: `packages/core/src/channel-gateway/consent-revocation-gate.ts`.

The runtime hook detects whether your first outbound includes the disclosure copy verbatim (substring match). If it does not in enforce mode, a `disclosure_not_shown` warning verdict is emitted. The hook NEVER blocks on disclosure validation — this is a tuning signal, not a content gate.

Revocation keywords are intentionally narrow. False-positive revoke is worse than missed revoke (1b-1 escalation triggers catch nuanced complaints). Tighten patterns before broadening.
```

- [ ] **Step 2: Create `docs/superpowers/plans/2026-05-11-alex-medspa-1c-followups.md`**

```markdown
# Phase 1c follow-ups

## Regulatory-review handoff

- **Owner:** TBD before pilot launch.
- **Scope:** Review SG/MY disclosure copy in `packages/core/src/consent/disclosure-copy.ts`; review SG/MY revocation keyword seeds in `packages/core/src/consent/revocation-keywords/`. Conservative seeds shipped in 1c; expansion belongs to a Phase 1c.5 (or rolled into 1b-1.5).
- **Target:** 2 weeks after 1c merge.

## Pilot-tenant consent state authoring

- Authoring grants/revocations via `POST /api/admin/consent/*`. No dashboard UI in 1c.
- First 5–10 grants seeded manually for the pilot tenant before enforce-mode promotion.

## Phase 1d `messageClass: "proactive"` call site

- 1d proactive sender calls `evaluateConsentGate({ messageClass: "proactive" })` directly. No further bootstrap change required from 1c.

## Disclosure-detection hardening

- v1 substring match is fragile against punctuation/whitespace/markdown drift.
- If pilot data shows missed disclosure stamps despite skill instruction, harden detection (regex with whitespace tolerance, or sentinel marker injected by skill output) in Phase 2/3.

## Multi-match revocation analytics

- v1 captures `matches[0]` only. Phase 3 analytics may want full multi-match context.

## Cross-deployment Contact governance

- v1 stamp is immutable. If a future product surface lets a Contact interact with deployments at different jurisdictions, reconcile then.

## Re-grant ergonomics

- v1 requires admin `clearConsent` to start a fresh cycle. If pilot shows frequent operator friction, add a `recordRegrant` method that explicitly clears revocation in one call.
```

- [ ] **Step 3: Commit**

```bash
git add skills/alex/references/regulatory/sg-rules.md skills/alex/references/regulatory/my-rules.md docs/superpowers/plans/2026-05-11-alex-medspa-1c-followups.md
git commit -m "docs(alex): add 1c references and follow-ups"
```

---

## Task 15: Full-stack verification + dashboard build

**Files:** none — verification step only.

- [ ] **Step 1: Run the full check suite**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all green.

- [ ] **Step 2: Run the dashboard build (CI does not run `next build`)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: clean. If anything red, fix before opening the PR — `feedback_dashboard_build_not_in_ci.md` calls this out specifically.

- [ ] **Step 3: Sanity-check Prisma artifacts**

```bash
pnpm db:generate
ls packages/db/prisma/migrations | tail -3
```

Expected: the 1c migration is the most recent; client generates clean.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin docs/alex-medspa-1c-consent-spec
gh pr create --title "feat(alex): sg/my medspa phase 1c — pdpa consent state + outbound gate" --body "$(cat <<'EOF'
## Summary

- Implements Phase 1c per `docs/superpowers/specs/2026-05-11-alex-medspa-1c-consent-state-design.md` and the spec PR #432.
- PDPA consent state as first-class data on `Contact` (jurisdiction-tagged), versioned AI disclosure tracker, `PdpaConsentGateHook` in the skill-runtime chain after the 1b-2 classifier, inbound revocation keyword scanner in the channel-gateway (runs before the 1b-1 escalation gate), `ConsentService` as the sole mutation seat, and `/api/admin/consent/*` admin endpoint contract.
- Behind `governanceConfig.consentState.mode` (off/observe/enforce), default off.
- Hook chain after 1c: `DeterministicSafetyGate` → `ClaimClassifier` → **`PdpaConsentGate`** → `TracePersistence`. Hook-ordering invariant codified by test.

## Out of scope

Phase 1d (WhatsApp window + templates + proactive sender), Phase 2 (dashboard UI for consent), Phase 3 (outcome tagging on consent-revoked conversations).

## Test plan

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all green
- [ ] `pnpm --filter @switchboard/dashboard build` clean
- [ ] Schema migration applied; `pnpm db:check-drift` clean (if Postgres available)
- [ ] Manual: POST /api/admin/consent/grant then GET → returns granted status
- [ ] Manual: POST /api/admin/consent/revoke then attempt grant → 409 with hint
- [ ] Manual: send WhatsApp inbound "STOP" with `consentState.mode = "enforce"` → revocation ack sent, Contact state mutated, governance verdict persisted

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- All six new `GovernanceVerdictReason` entries in Task 1 (`consent_pending`, `consent_revoked`, `disclosure_not_shown`, `disclosure_version_outdated`, `consent_cycle_reset`, `jurisdiction_mismatch`) are consumed: `consent_revoked` by `ConsentService.recordRevocation` + hook defense-in-depth + gateway observe-mode; `consent_pending` reserved for Phase 1d proactive sender (no 1c emitter); `disclosure_not_shown` + `disclosure_version_outdated` by hook disclosure-detection; `consent_cycle_reset` by `clearConsent`; `jurisdiction_mismatch` by hook mismatch path + admin endpoint mapping. `consent_pending` having no 1c emitter is intentional — added in Task 1 so 1d can use it without a schema migration.
- `evaluateConsentGate`'s `messageClass: "proactive"` branch is exercised by unit tests in Task 2 but has no production caller in 1c. Phase 1d wires the proactive call site.
- `ConsentService.recordRevocation`'s `openConversationSessionId` parameter is optional — admin endpoint omits it (revocation may be recorded between sessions), gateway provides it.
- `HandoffStore.findOpenBySession` and `HandoffStore.annotate` are referenced in Task 9. If the existing `HandoffStore` interface in `packages/core/src/handoff/types.ts` lacks these, add them as optional methods plus Prisma impls in Task 9, or split into Task 9.5 — the spec calls for handoff annotation but the structural pattern of additive method extension on existing interfaces is on-spec.
- Task 11's `runConsentRevocationGate` and Task 10's `PdpaConsentGateHook` share `consentPostureCache` (one instance) — same pattern as 1b-1 (gateway + output hook share its cache). Task 13 constructs the single shared instance.
- The 1b-1 fail-closed convention (block on enforce + cached enforce) is intentionally relaxed in 1c on operational-class outbound: the hook emits a `governance_unavailable` critical verdict but does NOT replace `result.response` because operational only blocks on `revoked`, which can't be determined when the resolver fails. Documented in spec Section 5.5 and re-asserted by Task 10's resolver-error test.
- No new CI gate added in 1c. The disclosure-drift regression test (in Task 6's snapshot suite) is the soft guardrail.
