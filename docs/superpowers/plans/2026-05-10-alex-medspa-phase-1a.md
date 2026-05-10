# Alex SG/MY Medspa — Phase 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the fat-skill directory layout for Alex, the structured `GovernanceVerdict` audit type, the `ReferenceMetadataSchema` governance contract, and the extended `ServiceSchema` for medspa-relevant operator-confirmed business facts. This phase ships the foundation that subsequent phases (1b-1, 1b-2, 1c, 1d, 3) build on.

**Architecture:** Refactor Alex from `skills/alex.md` (single file) to `skills/alex/SKILL.md` + `skills/alex/references/` (directory with metadata-tagged reference files loaded on demand by the skill loader). Add `GovernanceVerdict` as the unified output-governance audit event shape (distinct from the existing `GovernanceDecision` action-approval type, which stays unchanged). Extend `ServiceSchema` with operator-authored optional fields (booking behavior, prep/aftercare, suitability) without introducing structured clinical data. Introduce `ReferenceMetadataSchema` so every reference file declares jurisdiction, vertical, clinic type, risk level, owner, and review date.

**Tech Stack:** TypeScript ESM, Zod, Vitest, pnpm workspaces, Turbo. Skill loader at `packages/core/src/skill-runtime/skill-loader.ts`. Schemas at `packages/schemas/`. No Prisma migration required; `ServiceSchema` extension is an additive Zod contract change and remains backward-compatible with existing `BusinessFacts` payloads (every new field is optional).

**Spec:** `docs/superpowers/specs/2026-05-10-alex-medspa-sg-my-design.md`

**Out of scope for Phase 1a (deferred to later phases):**
- Runtime claim scanner / banned-phrase enforcement (Phase 1b-1)
- Claim classifier and substantiation (Phase 1b-2)
- PDPA consent state machine (Phase 1c)
- WhatsApp window detection and templates (Phase 1d)
- Knowledge onboarding UI (Phase 2)
- Outcome tagging and pattern detection (Phase 3)
- Authoring complete content for each reference file — Phase 1a ships placeholders with valid frontmatter and a clear authoring note

**Naming reconciliation:** The spec uses `GovernanceDecision` for the new structured audit event. That name already exists at `packages/core/src/skill-runtime/governance.ts:16` as a 3-tier union (`"auto-approve" | "require-approval" | "deny"`) used for action approval. To avoid a rippling rename, the new structured type is named **`GovernanceVerdict`** in this plan. Semantics match the spec — only the identifier differs.

## Plan hardening notes

These rules apply across all tasks. They were lifted from review feedback and are load-bearing for clean execution:

- **Deterministic reference discovery.** Sort `readdirSync` output and the final returned references array by relative path. Without this, snapshot tests are flaky and diffs are noisy.
- **POSIX-style relative paths.** Reference paths returned from the loader and emitted in tests must use forward slashes regardless of host OS. Use `relative(skillDir, full).split(path.sep).join("/")`.
- **Audit script reuses `ReferenceMetadataSchema`.** `pnpm reference-audit` validates every reference file against the same Zod schema the loader uses, then applies policy checks on top (staleness, critical-source presence). Two contracts diverging would defeat the purpose.
- **`riskLevel: critical` requires sources.** Audit-script policy: any reference with `riskLevel: critical` must declare at least one entry in `sources`. The schema makes `sources` optional; the policy check elevates it for critical files.
- **Phase 1a does not yet thin SKILL.md.** The fat-skill *directory* lands in 1a; reducing `SKILL.md` to ≤500 lines as the spec describes is a separate authoring pass that lands alongside reference content (1b-1 / 1b-2 timing). Coverage table reflects this.

---

## Pre-flight

- [ ] **Step P1: Confirm worktree and branch**

```bash
cd /Users/jasonli/switchboard-alex-medspa-spec
git branch --show-current
```

Expected: `docs/alex-medspa-sg-my-spec`

- [ ] **Step P2: Initialize worktree**

```bash
pnpm worktree:init
```

Expected: copies `.env` from the primary worktree, kills stale dev-port listeners, runs `pnpm db:migrate` if Postgres is reachable. If Postgres is not reachable, that's fine — Phase 1a does not require migrations.

- [ ] **Step P3: Verify baseline build**

```bash
pnpm build && pnpm typecheck && pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/core test
```

Expected: all green. If anything fails on baseline, investigate before proceeding — the rest of the plan assumes a clean starting state.

---

## Task 1: Extract `ServiceSchema` and add medspa service fields

**Files:**
- Modify: `packages/schemas/src/marketplace.ts:250-306`
- Modify: `packages/schemas/src/__tests__/marketplace.test.ts`
- Modify: `packages/schemas/src/index.ts` (export)

**Why:** `BusinessFactsSchema` currently inlines the per-service shape inside `services: z.array(z.object({...}))`. To extend it with medspa-specific operator-authored fields, we extract the inline object as a named `ServiceSchema` and add the new optional fields. All new fields are optional and operator-authored free-text or enum — no structured clinical data.

- [ ] **Step 1.1: Write failing test for extracted `ServiceSchema`**

Open `packages/schemas/src/__tests__/marketplace.test.ts` and add this test inside `describe("Marketplace schemas", () => { ... })`:

```typescript
describe("ServiceSchema", () => {
  it("validates a minimal service", () => {
    const minimal = {
      name: "Pico Laser",
      description: "Pigmentation treatment",
    };
    const result = ServiceSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("accepts new medspa fields when provided", () => {
    const enriched = {
      name: "Botox",
      description: "Wrinkle reduction",
      durationMinutes: 30,
      price: "from SGD 380",
      currency: "SGD",
      bookingBehavior: "consultation_only" as const,
      prepInstructions: "Avoid alcohol 24h before.",
      aftercareNotes: "No exercise for 24h. Avoid lying flat for 4h.",
      idealFor: "Forehead lines, crow's feet.",
      notSuitableFor: "Pregnancy, breastfeeding, neuromuscular disorders.",
      popularCombinations: ["Skinbooster", "Profhilo"],
      consultationRequired: true,
    };
    const result = ServiceSchema.safeParse(enriched);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bookingBehavior).toBe("consultation_only");
      expect(result.data.consultationRequired).toBe(true);
      expect(result.data.popularCombinations).toEqual(["Skinbooster", "Profhilo"]);
    }
  });

  it("rejects invalid bookingBehavior", () => {
    const invalid = {
      name: "Filler",
      description: "Volume restoration",
      bookingBehavior: "auto_book",
    };
    const result = ServiceSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
```

Add the import at the top of the file:

```typescript
import { BusinessFactsSchema, ServiceSchema } from "../marketplace.js";
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test marketplace
```

Expected: 3 new tests fail with "ServiceSchema is not exported from ../marketplace.js" or similar TypeScript / runtime error.

- [ ] **Step 1.3: Extract and extend `ServiceSchema` in `marketplace.ts`**

In `packages/schemas/src/marketplace.ts`, replace the inline service object inside `BusinessFactsSchema` with a named `ServiceSchema`. The relevant section currently looks like:

```typescript
services: z
  .array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      durationMinutes: z.number().int().positive().optional(),
      price: z.string().optional(),
      currency: z.string().default("SGD"),
    }),
  )
  .min(1),
```

Replace with the extracted schema declared just above `BusinessFactsSchema` and referenced inside it:

```typescript
export const ServiceSchema = z.object({
  // existing fields
  name: z.string().min(1),
  description: z.string().min(1),
  durationMinutes: z.number().int().positive().optional(),
  price: z.string().optional(),
  currency: z.string().default("SGD"),

  // medspa-relevant operator-authored optional fields
  bookingBehavior: z.enum(["book_directly", "consultation_only", "ask_first"]).optional(),
  prepInstructions: z.string().optional(),
  aftercareNotes: z.string().optional(),
  idealFor: z.string().optional(),
  notSuitableFor: z.string().optional(),
  popularCombinations: z.array(z.string()).optional(),
  consultationRequired: z.boolean().optional(),
});

export type Service = z.infer<typeof ServiceSchema>;
```

Then update `BusinessFactsSchema` to reference the extracted schema:

```typescript
services: z.array(ServiceSchema).min(1),
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/schemas test marketplace
```

Expected: all marketplace tests pass, including the 3 new `ServiceSchema` tests and the pre-existing `BusinessFactsSchema` tests (which must continue passing — round-trip with the inline service shape must still validate, since `ServiceSchema` is structurally compatible).

- [ ] **Step 1.5: Update package exports**

Open `packages/schemas/src/index.ts` and ensure `ServiceSchema` and `Service` are re-exported. If the file uses `export * from "./marketplace.js"`, this is automatic and you can skip. If it uses named re-exports, add:

```typescript
export { ServiceSchema, type Service } from "./marketplace.js";
```

- [ ] **Step 1.6: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean. No errors. If `BusinessFacts` consumers downstream (e.g., `packages/core`) reference the inline service shape via type inference, the change is structurally compatible and TypeScript should not complain.

- [ ] **Step 1.7: Commit**

```bash
git add packages/schemas/src/marketplace.ts \
        packages/schemas/src/__tests__/marketplace.test.ts \
        packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat(schemas): extract ServiceSchema with medspa fields

Extracts ServiceSchema from inline BusinessFactsSchema and extends with
operator-authored optional fields for medspa verticals: bookingBehavior,
prepInstructions, aftercareNotes, idealFor, notSuitableFor,
popularCombinations, consultationRequired. All new fields are optional;
no structured clinical data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `ReferenceMetadataSchema`

**Files:**
- Create: `packages/schemas/src/reference-metadata.ts`
- Create: `packages/schemas/src/__tests__/reference-metadata.test.ts`
- Modify: `packages/schemas/src/index.ts`

**Why:** Every file under `skills/<agent>/references/` will carry YAML frontmatter declaring its jurisdiction, vertical, clinic type, risk level, owner, and review date. The schema is the contract that enables CI checks for staleness and risk-level review gating.

- [ ] **Step 2.1: Write the failing test**

Create `packages/schemas/src/__tests__/reference-metadata.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ReferenceMetadataSchema } from "../reference-metadata.js";

describe("ReferenceMetadataSchema", () => {
  it("validates a minimal regulatory reference", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "critical",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(true);
  });

  it("validates a voice reference with both jurisdictions", () => {
    const meta = {
      jurisdiction: "both",
      vertical: "medspa",
      clinicType: "both",
      appliesTo: "voice",
      riskLevel: "low",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
      sources: ["https://example.com/guide"],
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(true);
  });

  it("rejects unknown jurisdiction", () => {
    const meta = {
      jurisdiction: "US",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "high",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("rejects invalid riskLevel", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
      clinicType: "medical",
      appliesTo: "regulatory",
      riskLevel: "extreme",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const meta = {
      jurisdiction: "SG",
      vertical: "medspa",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(false);
  });

  it("accepts vertical=none and clinicType=none for cross-cutting references", () => {
    // Channel/platform references that don't meaningfully map to a clinic
    // type or vertical (e.g., a generic platform-policy doc) need this
    // escape hatch.
    const meta = {
      jurisdiction: "both",
      vertical: "none",
      clinicType: "none",
      appliesTo: "channel",
      riskLevel: "low",
      lastReviewedAt: "2026-05-10",
      owner: "jasonli",
    };
    const result = ReferenceMetadataSchema.safeParse(meta);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test reference-metadata
```

Expected: tests fail with "Cannot find module '../reference-metadata.js'".

- [ ] **Step 2.3: Implement `ReferenceMetadataSchema`**

Create `packages/schemas/src/reference-metadata.ts`:

```typescript
import { z } from "zod";

export const ReferenceMetadataSchema = z.object({
  jurisdiction: z.enum(["SG", "MY", "both", "none"]),
  vertical: z.enum(["medspa", "dental", "fitness", "generic", "none"]),
  clinicType: z.enum(["medical", "nonMedical", "both", "none"]),
  appliesTo: z.enum(["voice", "regulatory", "pattern", "channel"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  lastReviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "lastReviewedAt must be ISO date (YYYY-MM-DD)",
  }),
  owner: z.string().min(1),
  sources: z.array(z.string()).optional(),
});

export type ReferenceMetadata = z.infer<typeof ReferenceMetadataSchema>;
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/schemas test reference-metadata
```

Expected: all 5 tests pass.

- [ ] **Step 2.5: Add to package exports**

Open `packages/schemas/src/index.ts`. If the file uses `export * from`, add:

```typescript
export * from "./reference-metadata.js";
```

If named exports only, add:

```typescript
export { ReferenceMetadataSchema, type ReferenceMetadata } from "./reference-metadata.js";
```

- [ ] **Step 2.6: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 2.7: Commit**

```bash
git add packages/schemas/src/reference-metadata.ts \
        packages/schemas/src/__tests__/reference-metadata.test.ts \
        packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat(schemas): add ReferenceMetadataSchema

Schema for YAML frontmatter on skill reference files. Required fields:
jurisdiction, vertical, clinicType, appliesTo, riskLevel, lastReviewedAt,
owner. Optional sources array. Enables governance contract enforcement
on reference content.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `GovernanceVerdict` schema and type

**Files:**
- Create: `packages/schemas/src/governance-verdict.ts`
- Create: `packages/schemas/src/__tests__/governance-verdict.test.ts`
- Modify: `packages/schemas/src/index.ts`

**Why:** Phase 1b-1 and later guards emit a `GovernanceVerdict` per output for audit, observability, and test fixtures. Phase 1a defines the type only — no guards consume it yet. Naming: `GovernanceVerdict` is intentionally distinct from the pre-existing `GovernanceDecision` (`"auto-approve" | "require-approval" | "deny"`) at `packages/core/src/skill-runtime/governance.ts:16`. Both layers of governance coexist; do not rename the existing type.

- [ ] **Step 3.1: Write the failing test**

Create `packages/schemas/src/__tests__/governance-verdict.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GovernanceVerdictSchema } from "../governance-verdict.js";

describe("GovernanceVerdictSchema", () => {
  it("validates an allow verdict", () => {
    const verdict = {
      action: "allow",
      reasonCode: "allowed",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "claim_scanner",
      auditLevel: "info",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("validates a rewrite verdict with original and emitted text", () => {
    const verdict = {
      action: "rewrite",
      reasonCode: "unsupported_claim",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "claim_scanner",
      originalText: "Most clients see visible slimming after one session.",
      emittedText: "Individual results vary; the doctor will advise during consultation.",
      auditLevel: "warning",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_abc123",
      modelLatencyMs: 412,
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("validates a block verdict outside whatsapp window", () => {
    const verdict = {
      action: "block",
      reasonCode: "outside_whatsapp_window",
      jurisdiction: "MY",
      clinicType: "nonMedical",
      sourceGuard: "whatsapp_window",
      auditLevel: "critical",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_xyz789",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("rejects unknown action", () => {
    const verdict = {
      action: "ignore",
      reasonCode: "allowed",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "claim_scanner",
      auditLevel: "info",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(false);
  });

  it("rejects unknown reasonCode", () => {
    const verdict = {
      action: "block",
      reasonCode: "looks_weird",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "claim_scanner",
      auditLevel: "warning",
      decidedAt: "2026-05-10T08:30:00.000Z",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(false);
  });

  it("rejects malformed decidedAt", () => {
    const verdict = {
      action: "allow",
      reasonCode: "allowed",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "claim_scanner",
      auditLevel: "info",
      decidedAt: "yesterday",
      conversationId: "conv_abc123",
    };
    const result = GovernanceVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test governance-verdict
```

Expected: tests fail with "Cannot find module '../governance-verdict.js'".

- [ ] **Step 3.3: Implement `GovernanceVerdictSchema`**

Create `packages/schemas/src/governance-verdict.ts`:

```typescript
import { z } from "zod";

export const GovernanceVerdictActionSchema = z.enum([
  "allow",
  "rewrite",
  "block",
  "escalate",
  "template_required",
]);

export const GovernanceVerdictReasonSchema = z.enum([
  "allowed",
  "banned_phrase",
  "unsupported_claim",
  "medical_safety_trigger",
  "outside_whatsapp_window",
  "consent_missing",
  "classifier_timeout",
]);

export const GovernanceVerdictSourceSchema = z.enum([
  "claim_scanner",
  "consent_gate",
  "whatsapp_window",
  "escalation_trigger",
]);

export const GovernanceVerdictSchema = z.object({
  action: GovernanceVerdictActionSchema,
  reasonCode: GovernanceVerdictReasonSchema,
  jurisdiction: z.enum(["SG", "MY"]),
  clinicType: z.enum(["medical", "nonMedical"]),
  sourceGuard: GovernanceVerdictSourceSchema,
  originalText: z.string().optional(),
  emittedText: z.string().optional(),
  auditLevel: z.enum(["info", "warning", "critical"]),
  decidedAt: z.string().datetime({
    message: "decidedAt must be ISO 8601 datetime string",
  }),
  conversationId: z.string().min(1),
  modelLatencyMs: z.number().int().nonnegative().optional(),
});

export type GovernanceVerdict = z.infer<typeof GovernanceVerdictSchema>;
export type GovernanceVerdictAction = z.infer<typeof GovernanceVerdictActionSchema>;
export type GovernanceVerdictReason = z.infer<typeof GovernanceVerdictReasonSchema>;
export type GovernanceVerdictSource = z.infer<typeof GovernanceVerdictSourceSchema>;
```

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/schemas test governance-verdict
```

Expected: all 6 tests pass.

- [ ] **Step 3.5: Add to package exports**

Open `packages/schemas/src/index.ts`. Add:

```typescript
export * from "./governance-verdict.js";
```

(Or named-export equivalent if the index uses named re-exports.)

- [ ] **Step 3.6: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean. No collision with `GovernanceDecision` in `packages/core/src/skill-runtime/governance.ts` — they are different identifiers in different packages.

- [ ] **Step 3.7: Commit**

```bash
git add packages/schemas/src/governance-verdict.ts \
        packages/schemas/src/__tests__/governance-verdict.test.ts \
        packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat(schemas): add GovernanceVerdict structured audit type

GovernanceVerdict is the unified output-governance audit event shape that
Phase 1b-1+ guards (claim scanner, consent gate, whatsapp window,
escalation trigger) emit per output. Distinct from the existing
GovernanceDecision action-approval union — both layers coexist.

Includes action (allow/rewrite/block/escalate/template_required), reason
code, jurisdiction, clinic type, source guard, optional original/emitted
text, audit level, decidedAt timestamp, conversationId, optional
modelLatencyMs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add directory-mode loading to `skill-loader.ts`

**Files:**
- Modify: `packages/core/src/skill-runtime/skill-loader.ts`
- Modify: `packages/core/src/skill-runtime/skill-loader.test.ts`

**Why:** The loader currently reads `<skillsDir>/<slug>.md`. To support fat-skill directory layouts, it must first check for `<skillsDir>/<slug>/SKILL.md` and fall back to the file form. References are loaded in Task 5; this task only adds directory detection so subsequent tasks can build on it.

- [ ] **Step 4.1: Read the current loader to understand the structure**

```bash
sed -n '125,200p' packages/core/src/skill-runtime/skill-loader.ts
```

Read the implementation around the `loadSkill` function so the changes below match the surrounding code style.

- [ ] **Step 4.2: Write a failing test for directory-mode loading**

Open `packages/core/src/skill-runtime/skill-loader.test.ts` and add a new `describe` block at the bottom:

```typescript
describe("loadSkill directory mode", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "skill-loader-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads a skill from <slug>/SKILL.md when both <slug>.md and <slug>/SKILL.md exist", () => {
    const dirSkillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: Directory-mode test
author: switchboard
parameters: []
tools: []
context: []
---
# Alex (directory mode)
`;
    const fileSkillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: File-mode test
author: switchboard
parameters: []
tools: []
context: []
---
# Alex (file mode)
`;
    mkdirSync(join(testDir, "alex"), { recursive: true });
    writeFileSync(join(testDir, "alex", "SKILL.md"), dirSkillContent);
    writeFileSync(join(testDir, "alex.md"), fileSkillContent);

    const skill = loadSkill("alex", testDir);
    expect(skill.frontmatter.description).toBe("Directory-mode test");
  });

  it("falls back to <slug>.md when no directory exists", () => {
    const fileSkillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: File-mode only
author: switchboard
parameters: []
tools: []
context: []
---
# Alex
`;
    writeFileSync(join(testDir, "alex.md"), fileSkillContent);

    const skill = loadSkill("alex", testDir);
    expect(skill.frontmatter.description).toBe("File-mode only");
  });

  it("throws SkillParseError when neither file nor directory exists", () => {
    expect(() => loadSkill("missing", testDir)).toThrow();
  });
});
```

Add the imports at the top of the test file if not already present:

```typescript
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSkill } from "./skill-loader.js";
```

- [ ] **Step 4.3: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test skill-loader
```

Expected: the directory-mode test fails (loader doesn't check for directory yet); fallback test may pass; missing test passes.

- [ ] **Step 4.4: Implement directory-mode resolution**

Open `packages/core/src/skill-runtime/skill-loader.ts`. Find the `loadSkill` function (around line 134). It currently constructs the path as `join(skillsDir, ${slug}.md)`. Modify it to check for the directory form first.

At the top of the file, ensure `existsSync` is imported from `node:fs`:

```typescript
import { existsSync, readFileSync } from "node:fs";
```

Replace the path resolution inside `loadSkill` with:

```typescript
export function loadSkill(slug: string, skillsDir: string): SkillDefinition {
  const dirSkillPath = join(skillsDir, slug, "SKILL.md");
  const fileSkillPath = join(skillsDir, `${slug}.md`);

  let skillPath: string;
  if (existsSync(dirSkillPath)) {
    skillPath = dirSkillPath;
  } else if (existsSync(fileSkillPath)) {
    skillPath = fileSkillPath;
  } else {
    throw new SkillParseError(
      `Skill "${slug}" not found at ${dirSkillPath} or ${fileSkillPath}`,
    );
  }

  const raw = readFileSync(skillPath, "utf-8");
  // ... rest of existing parse + validate logic unchanged
}
```

Keep the rest of `loadSkill` (frontmatter split, YAML parse, Zod validate) unchanged.

- [ ] **Step 4.5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test skill-loader
```

Expected: all skill-loader tests pass — both pre-existing and new.

- [ ] **Step 4.6: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4.7: Commit**

```bash
git add packages/core/src/skill-runtime/skill-loader.ts \
        packages/core/src/skill-runtime/skill-loader.test.ts
git commit -m "$(cat <<'EOF'
feat(core): skill-loader supports directory layout

loadSkill now checks for <skillsDir>/<slug>/SKILL.md before falling back
to <skillsDir>/<slug>.md. Throws SkillParseError if neither exists. No
behavior change for existing file-mode skills.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add reference loading to skill loader

**Files:**
- Modify: `packages/core/src/skill-runtime/types.ts`
- Modify: `packages/core/src/skill-runtime/skill-loader.ts`
- Modify: `packages/core/src/skill-runtime/skill-loader.test.ts`

**Why:** When a skill is loaded from a directory, references under `<slug>/references/**.md` should be discovered, their YAML frontmatter parsed and validated against `ReferenceMetadataSchema`, and made available on the returned `SkillDefinition`. Phase 1a only loads metadata; downstream phases use it for jurisdiction-scoped retrieval.

- [ ] **Step 5.1: Extend `SkillDefinition` type**

Open `packages/core/src/skill-runtime/types.ts`. Find the `SkillDefinition` interface (or type). Add a new optional field:

```typescript
export interface SkillReferenceFile {
  path: string;            // relative path within skill directory, e.g. "references/markets/sg-medspa.md"
  metadata: ReferenceMetadata;
  body: string;            // markdown body after frontmatter
}

export interface SkillDefinition {
  // ... existing fields
  references?: SkillReferenceFile[];
}
```

Add the import at the top of `types.ts`:

```typescript
import type { ReferenceMetadata } from "@switchboard/schemas";
```

- [ ] **Step 5.2: Write failing test for reference loading**

Add to `packages/core/src/skill-runtime/skill-loader.test.ts` inside the directory-mode `describe`:

```typescript
it("loads and validates references when present", () => {
  const skillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: With references
author: switchboard
parameters: []
tools: []
context: []
---
# Alex
`;
  const refContent = `---
jurisdiction: SG
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
---
# SG rules
Banned phrases follow.
`;
  mkdirSync(join(testDir, "alex", "references", "regulatory"), { recursive: true });
  writeFileSync(join(testDir, "alex", "SKILL.md"), skillContent);
  writeFileSync(
    join(testDir, "alex", "references", "regulatory", "sg-rules.md"),
    refContent,
  );

  const skill = loadSkill("alex", testDir);
  expect(skill.references).toBeDefined();
  expect(skill.references).toHaveLength(1);
  expect(skill.references![0].metadata.jurisdiction).toBe("SG");
  expect(skill.references![0].metadata.riskLevel).toBe("critical");
  expect(skill.references![0].path).toBe("references/regulatory/sg-rules.md");
});

it("throws when a reference frontmatter is invalid", () => {
  const skillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: With bad reference
author: switchboard
parameters: []
tools: []
context: []
---
# Alex
`;
  const badRefContent = `---
jurisdiction: US
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
---
`;
  mkdirSync(join(testDir, "alex", "references", "regulatory"), { recursive: true });
  writeFileSync(join(testDir, "alex", "SKILL.md"), skillContent);
  writeFileSync(
    join(testDir, "alex", "references", "regulatory", "us-rules.md"),
    badRefContent,
  );

  expect(() => loadSkill("alex", testDir)).toThrow();
});

it("returns references undefined when no references directory exists", () => {
  const skillContent = `---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: No references
author: switchboard
parameters: []
tools: []
context: []
---
# Alex
`;
  mkdirSync(join(testDir, "alex"), { recursive: true });
  writeFileSync(join(testDir, "alex", "SKILL.md"), skillContent);

  const skill = loadSkill("alex", testDir);
  expect(skill.references).toBeUndefined();
});
```

- [ ] **Step 5.3: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test skill-loader
```

Expected: the three new reference tests fail because reference loading isn't wired up.

- [ ] **Step 5.4: Implement reference discovery and loading**

In `packages/core/src/skill-runtime/skill-loader.ts`, add a helper function above `loadSkill`:

```typescript
import { readdirSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import { ReferenceMetadataSchema } from "@switchboard/schemas";
import type { SkillReferenceFile } from "./types.js";

function loadReferences(skillDir: string): SkillReferenceFile[] | undefined {
  const referencesRoot = join(skillDir, "references");
  if (!existsSync(referencesRoot)) {
    return undefined;
  }

  const files: SkillReferenceFile[] = [];

  function walk(dir: string): void {
    // Deterministic ordering — readdirSync order is platform/inode-dependent
    // and produces flaky tests / noisy diffs without explicit sort.
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".md")) {
        const raw = readFileSync(full, "utf-8");
        const split = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!split) {
          throw new SkillParseError(
            `Reference file ${full} missing YAML frontmatter`,
          );
        }
        const [, fm, body] = split;
        const parsed = parseYaml(fm);
        const result = ReferenceMetadataSchema.safeParse(parsed);
        if (!result.success) {
          throw new SkillValidationError(
            `Reference ${full} failed validation: ${JSON.stringify(result.error.issues)}`,
          );
        }
        // Normalize to POSIX-style forward slashes so paths are stable
        // across host OS (matters if CI ever runs on Windows).
        const posixPath = relative(skillDir, full).split(sep).join("/");
        files.push({
          path: posixPath,
          metadata: result.data,
          body,
        });
      }
    }
  }

  walk(referencesRoot);
  // Final sort by path so the returned array is fully deterministic
  // regardless of recursion order.
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
```

Then modify `loadSkill` to call `loadReferences` when in directory mode and attach the result:

```typescript
export function loadSkill(slug: string, skillsDir: string): SkillDefinition {
  const dirSkillPath = join(skillsDir, slug, "SKILL.md");
  const fileSkillPath = join(skillsDir, `${slug}.md`);

  let skillPath: string;
  let references: SkillReferenceFile[] | undefined;

  if (existsSync(dirSkillPath)) {
    skillPath = dirSkillPath;
    references = loadReferences(join(skillsDir, slug));
  } else if (existsSync(fileSkillPath)) {
    skillPath = fileSkillPath;
  } else {
    throw new SkillParseError(
      `Skill "${slug}" not found at ${dirSkillPath} or ${fileSkillPath}`,
    );
  }

  const raw = readFileSync(skillPath, "utf-8");
  // ... existing parse + validate logic ...
  // before return, attach references:
  return {
    ...definition,
    references,
  };
}
```

(Adapt the final return to match the existing code shape; the key change is including `references` on the returned `SkillDefinition`.)

- [ ] **Step 5.5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test skill-loader
```

Expected: all skill-loader tests pass — pre-existing, directory-mode, and reference-loading.

- [ ] **Step 5.6: Run typecheck**

```bash
pnpm typecheck
```

Expected: clean. The cross-package import from `@switchboard/schemas` works because schemas is a Layer 1 dependency.

- [ ] **Step 5.7: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts \
        packages/core/src/skill-runtime/skill-loader.ts \
        packages/core/src/skill-runtime/skill-loader.test.ts
git commit -m "$(cat <<'EOF'
feat(core): skill-loader loads validated references

Directory-mode skills now load all references/**.md files. Each file's
YAML frontmatter is validated against ReferenceMetadataSchema; invalid
frontmatter throws SkillValidationError. References attached to
SkillDefinition.references with relative path, metadata, and body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Refactor Alex from file to directory layout

**Files:**
- Move: `skills/alex.md` → `skills/alex/SKILL.md`
- Create: `skills/alex/references/markets/sg-medspa.md`
- Create: `skills/alex/references/markets/my-medspa.md`
- Create: `skills/alex/references/regulatory/sg-rules.md`
- Create: `skills/alex/references/regulatory/my-rules.md`
- Create: `skills/alex/references/regulatory/medical-vs-non-medical.md`
- Create: `skills/alex/references/conversation-patterns/price-shop.md`
- Create: `skills/alex/references/conversation-patterns/problem-led.md`
- Create: `skills/alex/references/conversation-patterns/branded-request.md`
- Create: `skills/alex/references/conversation-patterns/aftercare.md`
- Create: `skills/alex/references/whatsapp-window.md`

**Why:** Phase 1a establishes the directory layout and authors placeholder reference content with valid governance metadata. Substantive content comes in dedicated authoring PRs (or in 1b/1d when the runtime guards consume the references). Each file is small, valid against `ReferenceMetadataSchema`, and labeled with a clear `## TODO — author content` section so future PRs flesh it out.

The Singapore English voice section currently in `skills/alex.md` is preserved verbatim in the new `skills/alex/SKILL.md` for Phase 1a; the rewrite to template-driven voice happens in a later phase.

- [ ] **Step 6.1: Move `alex.md` to directory layout**

```bash
cd /Users/jasonli/switchboard-alex-medspa-spec
git mv skills/alex.md skills/alex/SKILL.md
```

Verify with:

```bash
ls skills/alex/
```

Expected: `SKILL.md`.

- [ ] **Step 6.2: Author placeholder reference files**

Create `skills/alex/references/markets/sg-medspa.md`:

```markdown
---
jurisdiction: SG
vertical: medspa
clinicType: both
appliesTo: voice
riskLevel: medium
lastReviewedAt: "2026-05-10"
owner: jasonli
---

# SG medspa voice & conversation pacing

> **TODO — Phase 1a placeholder.** Authoring of substantive content (Singlish particles, code-switching norms, pacing, objection style) happens before 1b-2 ships. The frontmatter is the authoritative governance contract; this body is intentionally minimal.

## Tone & register
Professional-casual. Light Singlish particles where the lead opens with them.

## Pacing
Single warmup turn, then qualify.
```

Create `skills/alex/references/markets/my-medspa.md`:

```markdown
---
jurisdiction: MY
vertical: medspa
clinicType: both
appliesTo: voice
riskLevel: medium
lastReviewedAt: "2026-05-10"
owner: jasonli
---

# MY medspa voice & conversation pacing

> **TODO — Phase 1a placeholder.** Substantive content (Manglish, Bahasa Rojak, pacing, objection style, halal/female-practitioner sensitivity) authored before 1b-2 ships.

## Tone & register
Professional-casual. Manglish/code-switching is normal in MY DMs; default to clean light English with selective particle use, not heavy Manglish.

## Pacing
Two warmup turns; rapport before qualifying.
```

Create `skills/alex/references/regulatory/sg-rules.md`:

```markdown
---
jurisdiction: SG
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
sources:
  - "https://www.moh.gov.sg/licensing-and-regulation/regulations-guidelines-and-circulars/details/guidelines-on-aesthetic-practices-for-doctors"
  - "https://www.smc.gov.sg/for-professionals/regulations-guidelines-circulars/ethical-code-and-ethical-guidelines-and-handbook-on-medical-ethics/"
  - "https://www.hsa.gov.sg/therapeutic-products/advertisements"
---

# SG aesthetic clinic — must-not-say & must-substantiate

> **TODO — Phase 1a placeholder for governance contract.** Phase 1b-1 populates the deterministic banned-phrase list; Phase 1b-2 populates the claim-classification rules.

## Sources
HCSA Advertisement Regulations 2021 (MOH); SMC ECEG 2016; HSA therapeutic products advertising rules; SMC Guidelines on Aesthetic Practices for Doctors (2008/2016).

## Must not say (high-level)
- Patient testimonials or endorsements
- Before/after images
- Superlatives ("best", "leading", "most effective")
- Comparative claims against other clinics
- Unsubstantiated efficacy claims or guarantees
- Urgency tactics ("only N slots today!")
- Public advertising of List B procedures

## Must substantiate
- Efficacy claims: require approved compliance claim
- Safety claims: require approved compliance claim
- Doctor credentials / device approvals: require regulatory_public_source
```

Create `skills/alex/references/regulatory/my-rules.md`:

```markdown
---
jurisdiction: MY
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
sources:
  - "https://mmc.gov.my/wp-content/uploads/2019/11/MMC-Aesthetic-Guidelines-2015.pdf"
  - "https://pharmacy.moh.gov.my/sites/default/files/document-upload/advertising-guidelines-healthcare-facilities-and-services-mab-3.2023.pdf"
---

# MY aesthetic clinic — must-not-say & must-substantiate

> **TODO — Phase 1a placeholder for governance contract.** Phase 1b-1/1b-2 populate enforcement detail.

## Sources
Medicine (Advertisement and Sale) Act 1956; MAB approval regime; PHFSA 1998 (KKM); MMC Guidelines on the Ethical Aspects of Aesthetic Medical Practice (2015); KKM Advertising Guidelines for Healthcare Facilities and Services (2023).

## Must not say (high-level)
- Aesthetic service ads without MAB approval
- Superlatives or absolutes ("best", "guaranteed", "100%", "permanent")
- Comparative claims (direct or implied)
- Misleading testimonials or before/after content without compliance review
- Operating aesthetic medical procedures outside a PHFSA-registered facility

## Must substantiate
- Efficacy / safety / superiority: require approved compliance claim
- Doctor APC / LCP for aesthetic medicine: require regulatory_public_source
```

Create `skills/alex/references/regulatory/medical-vs-non-medical.md`:

```markdown
---
jurisdiction: both
vertical: medspa
clinicType: both
appliesTo: regulatory
riskLevel: high
lastReviewedAt: "2026-05-10"
owner: jasonli
---

# Medical aesthetic vs non-medical beauty spa — posture toggle

> **TODO — Phase 1a placeholder.** Phase 1b-1 wires the deployment-level `clinicType` flag to enforcement.

## SG
MOH-regulated medical aesthetic clinics (doctor-led, HSA-device-approved, SMC List A/B framework) vs unregulated beauty salons. Beauty salons cannot use "treat", "diagnose", or perform doctor-only procedures (Botox, filler, RF, fractional laser).

## MY
PHFSA-regulated medical clinics vs unregulated beauty salons. Same line; KKM regulates the medical side only. Grey zone is larger; agent must default to non-medical posture if `clinicType: nonMedical`.

## Posture rules
- `clinicType: medical` — full medical-aesthetic vocabulary allowed within `sg-rules.md` / `my-rules.md` constraints
- `clinicType: nonMedical` — additionally avoid "treat", "cure", "diagnose", "fix"; never reference doctor-only procedures even by name
```

Create `skills/alex/references/conversation-patterns/price-shop.md`:

```markdown
---
jurisdiction: both
vertical: medspa
clinicType: both
appliesTo: pattern
riskLevel: low
lastReviewedAt: "2026-05-10"
owner: jasonli
---

# Conversation pattern — price-shop

> **TODO — Phase 1a placeholder.** Substantive playbook authored before pattern-detection (Phase 3) goes live.

Lead opens with "How much for [treatment]?" Price-led inquiry, often with competitor anchor.

## Sequence
1. Acknowledge the treatment by name
2. Quote a range tied to consultation
3. Ask one qualifying question (concern, frequency, timing)
4. Soft-anchor toward consultation booking, not single-treatment booking
```

Create `skills/alex/references/conversation-patterns/problem-led.md`:

```markdown
---
jurisdiction: both
vertical: medspa
clinicType: both
appliesTo: pattern
riskLevel: low
lastReviewedAt: "2026-05-10"
owner: jasonli
---

# Conversation pattern — problem-led

> **TODO — Phase 1a placeholder.**

Lead describes a concern (acne scars, melasma, double chin) and asks for a recommendation.

## Sequence
1. Acknowledge the concern empathetically
2. Ask one clarifying question (duration, severity, prior treatments tried) — never diagnose
3. Surface 1–2 services that match by `idealFor`
4. Anchor toward consultation; never recommend a specific treatment as "right for you"
```

Create `skills/alex/references/conversation-patterns/branded-request.md`:

```markdown
---
jurisdiction: both
vertical: medspa
clinicType: both
appliesTo: pattern
riskLevel: low
lastReviewedAt: "2026-05-10"
owner: jasonli
---

# Conversation pattern — branded request

> **TODO — Phase 1a placeholder.**

Lead asks for a specific brand-name treatment (Rejuran, Pico, Profhilo, Ultherapy). Often after Lemon8/RedNote research.

## Sequence
1. Confirm the clinic offers the named treatment (or surface the closest equivalent if not)
2. Quote a range tied to consultation
3. Ask one qualifying question
4. Anchor toward consultation
```

Create `skills/alex/references/conversation-patterns/aftercare.md`:

```markdown
---
jurisdiction: both
vertical: medspa
clinicType: both
appliesTo: pattern
riskLevel: medium
lastReviewedAt: "2026-05-10"
owner: jasonli
---

# Conversation pattern — aftercare

> **TODO — Phase 1a placeholder.**

Post-treatment T+24h check-in pattern. Highest-leverage retention touchpoint per ProspyrMed/Pabau.

## Sequence
1. Reach out at T+24h with treatment-specific aftercare confirmation
2. Surface what's normal vs not (from `aftercareNotes`)
3. Provide a clear escalation channel for adverse signs
4. Soft re-book prompt only if lead opens it
```

Create `skills/alex/references/whatsapp-window.md`:

```markdown
---
jurisdiction: both
vertical: medspa
clinicType: both
appliesTo: channel
riskLevel: high
lastReviewedAt: "2026-05-10"
owner: jasonli
sources:
  - "https://business.whatsapp.com/policy"
  - "https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/template-messages/"
---

# WhatsApp 24-hour window & template rules

> **TODO — Phase 1a placeholder.** Phase 1d wires window detection and template selection in the harness.

## 24-hour customer-service window
Free-form replies allowed only within 24h of the user's last inbound message. Each inbound resets the timer.

## Outside the window
Only Meta-pre-approved templates: Utility (appt confirm/reminder/reschedule, receipt), Marketing (promos, re-engagement, package launches), Authentication (OTP).

## Templates support
- Variables (`{{1}}`)
- Buttons: Quick Reply, Call, URL

## Tier
New WABA numbers: 250 business-initiated conversations / 24h. Scales with quality rating.
```

- [ ] **Step 6.3: Add smoke test that loads the real Alex skill**

Create `packages/core/src/skill-runtime/__tests__/alex-skill.smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSkill } from "../skill-loader.js";

const SKILLS_DIR = resolve(__dirname, "../../../../../skills");

describe("Alex skill (real, not fixture)", () => {
  it("loads from directory layout", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    expect(skill.frontmatter.slug).toBe("alex");
  });

  it("discovers all reference files with valid metadata", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    expect(skill.references).toBeDefined();
    expect(skill.references!.length).toBeGreaterThanOrEqual(10);

    // Every reference must have populated metadata
    for (const ref of skill.references!) {
      expect(ref.metadata.owner.length).toBeGreaterThan(0);
      expect(ref.metadata.lastReviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("returns reference paths in deterministic POSIX-style order", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    const paths = skill.references!.map((r) => r.path);
    // POSIX-style: no backslashes regardless of host OS
    for (const p of paths) {
      expect(p).not.toContain("\\");
    }
    // Deterministic: sorted
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it("includes critical regulatory references with sources", () => {
    const skill = loadSkill("alex", SKILLS_DIR);
    const critical = skill.references!.filter(
      (r) => r.metadata.riskLevel === "critical",
    );
    expect(critical.length).toBeGreaterThan(0);
    for (const ref of critical) {
      expect(ref.metadata.sources).toBeDefined();
      expect(ref.metadata.sources!.length).toBeGreaterThan(0);
    }
  });
});
```

Run:

```bash
pnpm --filter @switchboard/core test alex-skill.smoke
```

Expected: all 4 smoke tests pass, confirming Phase 1a delivers a real working directory-mode skill load with no runtime behavior change to the existing skill body.

- [ ] **Step 6.4: Run typecheck and full tests**

```bash
pnpm typecheck
pnpm test
```

Expected: clean. If any pre-existing tests touched `skills/alex.md` directly by path string, they will fail and need updating. Check `git grep "skills/alex.md"` — if it returns matches, update those references to either `skills/alex/SKILL.md` or to use `loadSkill` indirection.

- [ ] **Step 6.5: Commit**

```bash
git add skills/alex/ \
        $(git grep -l "skills/alex.md" | tr '\n' ' ' 2>/dev/null || true)
git commit -m "$(cat <<'EOF'
refactor(skills): convert alex to directory layout with references

skills/alex.md → skills/alex/SKILL.md. Adds skills/alex/references/ with
placeholder content + valid ReferenceMetadataSchema frontmatter for SG
markets, MY markets, SG/MY regulatory rules, medical-vs-non-medical
posture toggle, conversation patterns (price-shop, problem-led,
branded-request, aftercare), and WhatsApp window.

Reference bodies are intentionally minimal — Phase 1a establishes the
directory + governance contract; substantive authoring lands in 1b-1
(deterministic gate) and 1b-2 (claim classifier).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Verify Alex builder still functions; update path references

**Files:**
- Read: `packages/core/src/skill-runtime/builders/alex.ts`
- Possibly modify: any file that hardcodes the path `skills/alex.md`

**Why:** The Alex builder constructs runtime parameters; it does not read the skill file directly. But other call sites might reference the file path. Phase 1a verifies no breakage.

- [ ] **Step 7.1: Search for hardcoded `alex.md` references**

```bash
git grep -n "alex.md" -- ':(exclude)docs' ':(exclude)skills'
```

Expected: zero matches outside docs/skills. If any code references the path string, the loader's directory-fallback logic will already resolve it correctly (since `<slug>/SKILL.md` is preferred), but a stale string literal is still a bug. Update each match to remove the trailing `.md` (since the loader now takes a slug, not a path).

- [ ] **Step 7.2: Read the alex builder to understand its responsibilities**

```bash
sed -n '1,100p' packages/core/src/skill-runtime/builders/alex.ts
```

The builder constructs `PERSONA_CONFIG` and other parameters. It does not read the skill file. No changes expected in Phase 1a.

- [ ] **Step 7.3: Run the full alex builder test if one exists**

```bash
pnpm --filter @switchboard/core test alex
```

Expected: all green.

- [ ] **Step 7.4: Run full workspace test + typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: clean across all packages.

- [ ] **Step 7.5: Commit if any path fixes were made**

```bash
git status --short
```

If there are uncommitted changes from Step 7.1 fixes, commit them. Otherwise skip:

```bash
git commit -m "$(cat <<'EOF'
chore(core): update stale alex.md path references after directory move

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add reference-audit CI check

**Files:**
- Create: `scripts/reference-audit.mjs`
- Modify: `package.json` (add `reference-audit` script)
- Optional: `.github/workflows/ci.yml` — add a step that runs `pnpm reference-audit`

**Why:** The `ReferenceMetadataSchema` enforces shape, but staleness (`lastReviewedAt` older than 180 days) and `riskLevel: critical` review-gate flags are project-policy concerns surfaced via a script. Phase 1a ships the script as a non-blocking warning surface; Phase 3 turns the script's findings into operator recommendations.

- [ ] **Step 8.1: Create the audit script**

The script imports `ReferenceMetadataSchema` from `@switchboard/schemas` and uses it as the validation contract — ad-hoc field-level checks would diverge from the loader over time. Policy checks (staleness, critical-source presence) live on top of the schema.

Create `scripts/reference-audit.mjs`:

```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { ReferenceMetadataSchema } from "@switchboard/schemas";

const SKILLS_DIR = join(process.cwd(), "skills");
const STALE_DAYS = 180;
const today = new Date();

let warnings = 0;
let errors = 0;

function walk(dir) {
  // Deterministic order: matches loader's reference discovery.
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (
      entry.endsWith(".md") &&
      full.includes(`${sep}references${sep}`)
    ) {
      auditOne(full);
    }
  }
}

function auditOne(path) {
  const display = relative(process.cwd(), path).split(sep).join("/");
  const raw = readFileSync(path, "utf-8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) {
    console.error(`ERROR: ${display} missing YAML frontmatter`);
    errors++;
    return;
  }

  let parsed;
  try {
    parsed = parseYaml(m[1]);
  } catch (e) {
    console.error(`ERROR: ${display} frontmatter not valid YAML: ${e.message}`);
    errors++;
    return;
  }

  // Reuse the same Zod schema the loader uses. One contract, not two.
  const result = ReferenceMetadataSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `ERROR: ${display} fails ReferenceMetadataSchema: ` +
        JSON.stringify(result.error.issues),
    );
    errors++;
    return;
  }
  const fm = result.data;

  // Policy: staleness
  const reviewed = new Date(fm.lastReviewedAt);
  const ageDays = (today - reviewed) / (1000 * 60 * 60 * 24);
  if (ageDays > STALE_DAYS) {
    console.warn(
      `WARN: ${display} lastReviewedAt ${fm.lastReviewedAt} is ` +
        `${Math.round(ageDays)} days old (>${STALE_DAYS})`,
    );
    warnings++;
  }

  // Policy: critical riskLevel requires at least one source
  if (fm.riskLevel === "critical" && (!fm.sources || fm.sources.length === 0)) {
    console.error(
      `ERROR: ${display} riskLevel=critical requires at least one entry in sources`,
    );
    errors++;
  }
}

if (!existsSync(SKILLS_DIR)) {
  console.log("No skills/ directory; skipping reference audit");
  process.exit(0);
}

walk(SKILLS_DIR);

console.log(`Reference audit: ${warnings} warnings, ${errors} errors`);
process.exit(errors > 0 ? 1 : 0);
```

**Note on dependency.** The script imports from `@switchboard/schemas`, so it requires the schemas package to be built. Add a guard or document that `pnpm build` (or at least `pnpm --filter @switchboard/schemas build`) must run before the audit. The pre-flight Step P3 already covers this.

- [ ] **Step 8.2: Add npm script**

Open root `package.json`. In the `"scripts"` block, add:

```json
"reference-audit": "node scripts/reference-audit.mjs"
```

- [ ] **Step 8.3: Run the script to verify it passes against the new references**

```bash
pnpm reference-audit
```

Expected:

```
Reference audit: 0 warnings, 0 errors
```

(Or zero warnings since all references have `lastReviewedAt: "2026-05-10"` which is fresh.)

- [ ] **Step 8.4: Verify the script catches stale, invalid-schema, and missing-source cases**

Temporarily add three problem references (do not commit them) and confirm the script catches each:

```bash
mkdir -p skills/alex/references/_test

# Case 1: stale (warning only, exit 0)
cat > skills/alex/references/_test/stale.md <<'EOF'
---
jurisdiction: SG
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: high
lastReviewedAt: "2024-01-01"
owner: jasonli
sources:
  - "https://example.com"
---
# Stale test
EOF

# Case 2: critical without sources (error, exit 1)
cat > skills/alex/references/_test/no-sources.md <<'EOF'
---
jurisdiction: SG
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
---
# Critical without sources
EOF

# Case 3: schema-invalid (error, exit 1)
cat > skills/alex/references/_test/bad-schema.md <<'EOF'
---
jurisdiction: US
vertical: medspa
clinicType: medical
appliesTo: regulatory
riskLevel: critical
lastReviewedAt: "2026-05-10"
owner: jasonli
sources:
  - "https://example.com"
---
# US is not a valid jurisdiction
EOF

pnpm reference-audit
echo "exit=$?"
```

Expected output (order may vary by sort):

```
WARN: skills/alex/references/_test/stale.md lastReviewedAt 2024-01-01 is ... days old (>180)
ERROR: skills/alex/references/_test/no-sources.md riskLevel=critical requires at least one entry in sources
ERROR: skills/alex/references/_test/bad-schema.md fails ReferenceMetadataSchema: [...]
Reference audit: 1 warnings, 2 errors
exit=1
```

Then clean up and verify the script returns clean:

```bash
rm -rf skills/alex/references/_test
pnpm reference-audit
echo "exit=$?"
```

Expected:

```
Reference audit: 0 warnings, 0 errors
exit=0
```

- [ ] **Step 8.5: Commit**

```bash
git add scripts/reference-audit.mjs package.json
git commit -m "$(cat <<'EOF'
chore: add reference-audit script for skill reference governance

scripts/reference-audit.mjs walks skills/**/references/ and checks each
markdown file for valid YAML frontmatter, presence of lastReviewedAt,
staleness (>180 days = warning), and riskLevel=critical files have an
owner. Exit code 0 on warnings only, non-zero on errors. Wired up as
pnpm reference-audit; CI integration deferred.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step F1: Run the full check pipeline**

```bash
pnpm reset
pnpm typecheck
pnpm test
pnpm reference-audit
```

Expected: all clean.

- [ ] **Step F2: Verify directory layout**

```bash
tree skills/alex/ -L 3 2>/dev/null || find skills/alex -type f
```

Expected output:

```
skills/alex/
├── SKILL.md
└── references
    ├── conversation-patterns
    │   ├── aftercare.md
    │   ├── branded-request.md
    │   ├── price-shop.md
    │   └── problem-led.md
    ├── markets
    │   ├── my-medspa.md
    │   └── sg-medspa.md
    ├── regulatory
    │   ├── medical-vs-non-medical.md
    │   ├── my-rules.md
    │   └── sg-rules.md
    └── whatsapp-window.md
```

- [ ] **Step F3: Verify commit history is clean**

```bash
git log --oneline main..HEAD
```

Expected: 7–8 focused commits, conventional-commits format, each scoped to one task. No squash needed.

- [ ] **Step F4: Open PR (when ready)**

```bash
gh pr create --base main --head docs/alex-medspa-sg-my-spec --title "feat(alex): SG/MY medspa Phase 1a — fat-skill directory + governance types" --body "$(cat <<'EOF'
## Summary
- Establishes fat-skill directory layout for Alex (`skills/alex/SKILL.md` + `references/`)
- Adds `ReferenceMetadataSchema` governance contract for reference files
- Adds structured `GovernanceVerdict` audit type (distinct from existing `GovernanceDecision`)
- Extends `ServiceSchema` with operator-authored medspa fields (no clinical structure)
- Adds `pnpm reference-audit` for staleness + critical-file ownership checks

## Spec
docs/superpowers/specs/2026-05-10-alex-medspa-sg-my-design.md (Phase 1a)

## Out of scope
- Runtime claim scanner (Phase 1b-1)
- Claim classifier + substantiation (Phase 1b-2)
- PDPA consent state (Phase 1c)
- WhatsApp window/templates (Phase 1d)
- Reference content authoring beyond placeholders

## Test plan
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green across all packages
- [ ] `pnpm reference-audit` exits 0
- [ ] Skill loader directory-mode test covers SKILL.md, references discovery, frontmatter validation
- [ ] BusinessFacts pre-existing tests pass with extracted ServiceSchema

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Do not run this command unless and until the user explicitly approves opening the PR.)

---

## Spec coverage check

| Spec section | Plan task |
|---|---|
| Section 1 — SKILL.md (thin orchestrator) | **Partial.** Directory layout covered (Task 6); SKILL.md thinning to ≤500 lines is deferred — content preservation only in Phase 1a |
| Section 2 — Reference file governance contract | Task 2 (`ReferenceMetadataSchema`), Task 5 (loader validation), Task 8 (audit script) |
| Section 3.1 — Claim scanner | Out of scope (Phase 1b-1 / 1b-2) |
| Section 3.2 — Mandatory escalation triggers | Out of scope (Phase 1b-1) |
| Section 3.3 — WhatsApp window check | Out of scope (Phase 1d) — placeholder reference only (Task 6) |
| Section 3.4 — `GovernanceVerdict` (renamed from `GovernanceDecision`) | Task 3 |
| Section 4 — `BusinessFacts` service-field extension | Task 1 |
| Section 5 — PDPA consent state | Out of scope (Phase 1c) |
| Section 6 — Knowledge onboarding | Out of scope (Phase 2) |
| Section 7 — Pattern detection on Recs v1 | Out of scope (Phase 3) |
| Operability — feature flag | Out of scope for 1a (no runtime behavior to flag); flag added in 1b-1 |
| Operability — test fixtures per phase | Tests in Tasks 1–5 cover Phase 1a fixture coverage |

All Phase 1a spec content is covered, **except SKILL.md thinning to ≤500 lines** which is explicitly deferred (see Section 1 row above and the Plan hardening notes near the top). All other deferred sections are explicitly marked out-of-scope with their target phase.
