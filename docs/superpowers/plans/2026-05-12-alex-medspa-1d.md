# Alex SG/MY Medspa Phase 1d Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the WhatsApp 24h customer-service window gate, the in-repo approval-tagged WhatsApp template registry, and the outbound substitution path behind the `alexMedspaSgMyGovernanceV1.whatsappWindow` feature flag (default off).

**Architecture:** A new `afterSkill` hook (`WhatsAppWindowGateHook`) runs in the skill-runtime hook chain after the 1c PDPA consent gate. For WhatsApp emits outside the 24h window the hook substitutes a Meta-approved template (selected from an in-repo TypeScript registry keyed by `(intentClass, jurisdiction)`) when opt-in is granted AND `template.approvalStatus === "approved"` AND (the template is non-marketing OR `config.allowMarketingTemplateSubstitution === true`); otherwise it hard-escalates via `buildHandoffPackage` (new `HandoffReason "outside_whatsapp_window"`). Five distinct block sub-causes are carried in handoff metadata: `missing_opt_in`, `missing_intent_class`, `no_template_fit`, `template_not_approved`, `marketing_substitution_blocked`. The Alex skill's system prompt is updated to instruct the LLM to emit `<intent>...</intent>` tags; `skill-executor.ts` parses and strips them robustly (0 valid → null; 1 valid → use; 2+ tags OR unknown values → strip all + null), setting `SkillExecutionResult.intentClass`. Substitute verdicts (and `marketing_substitution_blocked` block verdicts) carry the mandatory cost-awareness metadata (`templateCategory`, `recipientMarket`, `metaTemplateName`, `costRisk: "paid_template_message"`, `costEstimateStatus: "not_priced_in_1d"`) for the Phase 2 billing backfill.

**Tech Stack:** TypeScript ESM (pnpm + Turborepo monorepo), Prisma (PostgreSQL), Zod, Vitest. Feature lives in `packages/core`, `packages/schemas`, `packages/db`, `apps/api`, `apps/chat`, and `skills/alex/SKILL.md`.

**Parent spec:** [`2026-05-11-alex-medspa-1d-whatsapp-window-design.md`](../specs/2026-05-11-alex-medspa-1d-whatsapp-window-design.md). PR #436.

---

## File Structure

**Created:**

- `packages/core/src/skill-runtime/templates/whatsapp-registry.ts` — `WhatsAppTemplate` type + `WHATSAPP_TEMPLATES` const + `selectTemplate` helper.
- `packages/core/src/skill-runtime/templates/whatsapp-registry.test.ts` — registry selection + cross-phase scanner regression tests.
- `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts` — the hook implementation.
- `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.test.ts` — hook unit tests.
- `packages/db/prisma/migrations/<timestamp>_add_last_whatsapp_inbound_at/migration.sql` — Prisma migration.

**Modified:**

- `packages/schemas/src/index.ts` (or wherever the barrel lives) — re-export `IntentClassSchema`, `TemplateCategorySchema`.
- `packages/schemas/src/intent-class.ts` (new sub-file, kept small) — Zod enums.
- `packages/core/src/skill-runtime/types.ts` — extend `SkillExecutionResult` with `intentClass?`.
- `packages/core/src/skill-runtime/skill-executor.ts` — parse `<intent>` tag and set `result.intentClass`, strip from response.
- `packages/core/src/handoff/types.ts` — extend `HandoffReason` with `"outside_whatsapp_window"`.
- `packages/core/src/decisions/adapters/handoff-adapter.ts` — handle the new variant in the existing switch.
- `packages/db/prisma/schema.prisma` — add `lastWhatsAppInboundAt DateTime?` + index on `ConversationThread`.
- `apps/chat/src/gateway/gateway-conversation-store.ts` — sibling write of `lastWhatsAppInboundAt` for inbound WhatsApp messages.
- `apps/api/src/bootstrap/skill-mode.ts` — instantiate and register `WhatsAppWindowGateHook` in the hook array.
- `skills/alex/SKILL.md` — system-prompt instruction to emit `<intent>...</intent>` tag at end of WhatsApp responses.

**Key boundary decisions:**

- Template registry is a separate module (`templates/`), not co-located with the hook, because tests for the registry run independently and the registry is consumed elsewhere later (Phase 2 operator UI).
- Intent-class parsing lives in `skill-executor.ts` (one-line change) rather than a new `afterLlmCall` hook — keeps the wiring simple and matches the existing `ClaimClassifierHook` pattern of inline `result.response` manipulation.
- Hook deps include `threadStore` + `contactStore` as small reader interfaces (defined inline) so tests can mock them without pulling in Prisma.

---

## Tasks

### Task 1: Prisma schema migration — add `lastWhatsAppInboundAt` to `ConversationThread`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_last_whatsapp_inbound_at/migration.sql`

- [ ] **Step 1: Edit the Prisma schema**

Open `packages/db/prisma/schema.prisma`. Find the `model ConversationThread { ... }` block and add the new field + index. Insert the field in the existing field list (place it near `messageCount` for cohesion) and add a new `@@index` line at the bottom of the model:

```prisma
model ConversationThread {
  // … existing fields …
  messageCount        Int       @default(0)
  /// Last inbound WhatsApp message timestamp for the WhatsApp 24h customer-service window.
  /// Per Meta policy, the 24h window is per-channel. Only inbound WhatsApp messages update
  /// this column; other channels (Telegram, IG, email, web widget) MUST NOT write to it.
  lastWhatsAppInboundAt DateTime?
  // … existing fields …

  @@index([organizationId, lastWhatsAppInboundAt])
  // … existing indexes preserved …
}
```

- [ ] **Step 2: Generate the migration using diff + deploy (no TTY)**

Per `feedback_prisma_migrate_dev_tty.md`, `migrate dev` blocks on prompts in agent sessions. Use the diff workflow instead:

```bash
mkdir -p packages/db/prisma/migrations/$(date +%Y%m%d%H%M%S)_add_last_whatsapp_inbound_at
TS=$(ls packages/db/prisma/migrations/ | grep add_last_whatsapp_inbound_at | tail -1)
pnpm --filter @switchboard/db exec prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script > packages/db/prisma/migrations/${TS}/migration.sql
```

Expected: SQL file contains `ALTER TABLE "ConversationThread" ADD COLUMN "lastWhatsAppInboundAt" TIMESTAMP(3);` and a `CREATE INDEX` line. Verify with `cat`.

- [ ] **Step 3: Apply the migration**

```bash
pnpm --filter @switchboard/db exec prisma migrate deploy
```

Expected: `1 migration applied`. If Postgres is unreachable, skip this step locally and let CI handle it — note the migration file is committed regardless.

- [ ] **Step 4: Regenerate the Prisma client**

```bash
pnpm db:generate
```

Expected: `Generated Prisma Client (...)`.

- [ ] **Step 5: Verify drift**

```bash
pnpm db:check-drift
```

Expected: clean exit, no drift. If Postgres unreachable, skip — CI catches drift.

- [ ] **Step 6: Run typecheck on the db package**

```bash
pnpm --filter @switchboard/db typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add ConversationThread.lastWhatsAppInboundAt for 1d window gate"
```

---

### Task 2: `IntentClass` + `TemplateCategory` Zod schemas in `packages/schemas`

**Files:**

- Create: `packages/schemas/src/intent-class.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/intent-class.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/intent-class.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IntentClassSchema, TemplateCategorySchema } from "./intent-class.js";

describe("IntentClassSchema", () => {
  it("accepts every valid intent class", () => {
    for (const v of [
      "appointment-confirm",
      "appointment-reminder",
      "aftercare-checkin",
      "re-engagement-offer",
      "consult-followup",
    ]) {
      expect(IntentClassSchema.parse(v)).toBe(v);
    }
  });

  it("rejects unknown values", () => {
    expect(() => IntentClassSchema.parse("unknown")).toThrow();
  });
});

describe("TemplateCategorySchema", () => {
  it("accepts every valid category", () => {
    for (const v of ["utility", "marketing", "authentication"]) {
      expect(TemplateCategorySchema.parse(v)).toBe(v);
    }
  });

  it("rejects unknown values", () => {
    expect(() => TemplateCategorySchema.parse("service")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test src/intent-class.test.ts
```

Expected: FAIL with `Cannot find module './intent-class.js'`.

- [ ] **Step 3: Create the schema file**

Create `packages/schemas/src/intent-class.ts`:

```ts
import { z } from "zod";

export const IntentClassSchema = z.enum([
  "appointment-confirm",
  "appointment-reminder",
  "aftercare-checkin",
  "re-engagement-offer",
  "consult-followup",
]);
export type IntentClass = z.infer<typeof IntentClassSchema>;

export const TemplateCategorySchema = z.enum(["utility", "marketing", "authentication"]);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;
```

- [ ] **Step 4: Re-export from the barrel**

Open `packages/schemas/src/index.ts`. Add this line in alphabetical order with the other `export * from` lines:

```ts
export * from "./intent-class.js";
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/schemas test src/intent-class.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Run the schemas typecheck**

```bash
pnpm --filter @switchboard/schemas typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/intent-class.ts packages/schemas/src/intent-class.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add IntentClass and TemplateCategory zod enums for 1d"
```

---

### Task 3: Extend `SkillExecutionResult.intentClass` and `HandoffReason` in `packages/core`

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts:93-98`
- Modify: `packages/core/src/handoff/types.ts:5-13`
- Modify: `packages/core/src/decisions/adapters/handoff-adapter.ts:33` (the switch consumer)
- Test: `packages/core/src/handoff/types.test.ts` (create if absent)

- [ ] **Step 1: Extend `SkillExecutionResult`**

Open `packages/core/src/skill-runtime/types.ts`. The existing interface at lines 93-98 is:

```ts
export interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
  trace: SkillExecutionTraceData;
}
```

Add the new optional field as the last property and add the import. At the top of the file, add (or extend the existing import) from `@switchboard/schemas`:

```ts
import type { IntentClass } from "@switchboard/schemas";
```

Then replace the interface with:

```ts
export interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
  trace: SkillExecutionTraceData;
  /**
   * OPTIONAL. When set, indicates the LLM declared this outbound serves a specific
   * intent (parsed from an `<intent>...</intent>` tag in the response by skill-executor.ts).
   * Consumed by the Phase 1d WhatsAppWindowGateHook to select a substitute template
   * when the conversation is outside the WhatsApp 24h customer-service window.
   */
  intentClass?: IntentClass;
}
```

- [ ] **Step 2: Extend `HandoffReason`**

Open `packages/core/src/handoff/types.ts`. The existing enum is at lines 5-13. Replace with:

```ts
export type HandoffReason =
  | "human_requested"
  | "max_turns_exceeded"
  | "complex_objection"
  | "negative_sentiment"
  | "compliance_concern"
  | "booking_failure"
  | "escalation_timeout"
  | "missing_knowledge"
  | "outside_whatsapp_window";
```

- [ ] **Step 3: Update the one known switch consumer**

Open `packages/core/src/decisions/adapters/handoff-adapter.ts`. Around line 33 there is a `switch (row.reason)` with cases for `"human_requested"` and `"max_turns_exceeded"` and a default fallback. Add a case for the new variant. The case body should mirror the existing `compliance_concern`-style branch — route the lead to the operator queue with the verdict's original text. Concretely insert (use the surrounding context to pick the right placement):

```ts
case "outside_whatsapp_window":
  return {
    priority: "high",
    operatorMessage: "WhatsApp outbound blocked: outside 24h window with no fitting Meta-approved template.",
    originalText: row.originalText ?? null,
  };
```

Read the file before editing to confirm the exact shape of each case-arm; mirror that shape. If the switch uses an exhaustiveness check (`assertNever(row.reason)`), the new case is required for type safety.

- [ ] **Step 4: Write a type-level test**

Create or extend `packages/core/src/handoff/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { HandoffReason } from "./types.js";

describe("HandoffReason", () => {
  it("includes outside_whatsapp_window", () => {
    const r: HandoffReason = "outside_whatsapp_window";
    expect(r).toBe("outside_whatsapp_window");
  });
});
```

- [ ] **Step 5: Run typecheck across core**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS. If any other file fails because of a non-exhaustive switch, update those switches the same way (add an `outside_whatsapp_window` arm that returns a safe default). Common offenders: dashboard handoff list components, audit-log filters. Do not change behavior — just satisfy the type checker.

- [ ] **Step 6: Run tests for core**

```bash
pnpm --filter @switchboard/core test
```

Expected: PASS (or no new failures).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/handoff/types.ts packages/core/src/decisions/adapters/handoff-adapter.ts packages/core/src/handoff/types.test.ts
git commit -m "feat(core): extend SkillExecutionResult.intentClass and HandoffReason for 1d"
```

---

### Task 4: WhatsApp template registry — types + selectTemplate (no bodies yet)

**Files:**

- Create: `packages/core/src/skill-runtime/templates/whatsapp-registry.ts`
- Test: `packages/core/src/skill-runtime/templates/whatsapp-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/skill-runtime/templates/whatsapp-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WHATSAPP_TEMPLATES, selectTemplate } from "./whatsapp-registry.js";

describe("selectTemplate", () => {
  it("returns null for unknown jurisdiction", () => {
    expect(
      selectTemplate({ intentClass: "appointment-confirm", jurisdiction: "XX" as never }),
    ).toBeNull();
  });

  it("returns the matching template for each (intentClass, jurisdiction) combo", () => {
    for (const intentClass of [
      "appointment-confirm",
      "appointment-reminder",
      "aftercare-checkin",
      "re-engagement-offer",
      "consult-followup",
    ] as const) {
      for (const jurisdiction of ["SG", "MY"] as const) {
        const t = selectTemplate({ intentClass, jurisdiction });
        expect(t, `${intentClass}/${jurisdiction}`).not.toBeNull();
        expect(t?.intentClass).toBe(intentClass);
        expect(t?.jurisdiction).toBe(jurisdiction);
      }
    }
  });
});

describe("WHATSAPP_TEMPLATES", () => {
  it("has 10 entries (5 intent classes × 2 jurisdictions)", () => {
    expect(WHATSAPP_TEMPLATES).toHaveLength(10);
  });

  it("every entry has a populated templateCategory", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      expect(t.templateCategory, t.name).toMatch(/^(utility|marketing|authentication)$/);
    }
  });

  it("every entry has a populated approvalStatus", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      expect(t.approvalStatus, t.name).toMatch(/^(draft|submitted|approved)$/);
    }
  });

  it("all re-engagement-offer entries are marketing-category", () => {
    const re = WHATSAPP_TEMPLATES.filter((t) => t.intentClass === "re-engagement-offer");
    expect(re.length).toBeGreaterThan(0);
    for (const t of re) {
      expect(t.templateCategory).toBe("marketing");
    }
  });

  it("every entry has a non-empty body", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      expect(t.body.trim().length, t.name).toBeGreaterThan(0);
    }
  });

  it("every entry has a unique name", () => {
    const names = WHATSAPP_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/templates/whatsapp-registry.test.ts
```

Expected: FAIL with `Cannot find module './whatsapp-registry.js'`.

- [ ] **Step 3: Create the registry module (types + selectTemplate, body content stubbed)**

Create `packages/core/src/skill-runtime/templates/whatsapp-registry.ts`:

```ts
import type { IntentClass, TemplateCategory } from "@switchboard/schemas";

export type Jurisdiction = "SG" | "MY";

/**
 * Where each template sits in the Meta App Review lifecycle.
 *
 * - "draft"     — authored in-repo, not yet submitted to Meta. Visible to the gate but never substituted.
 * - "submitted" — submitted to Meta, awaiting review. Visible to the gate but never substituted.
 * - "approved"  — Meta approved this template under metaTemplateName. Only status that can substitute in enforce mode.
 *
 * In enforce mode, the gate substitutes only entries with `approvalStatus === "approved"`.
 * Draft / submitted entries fall through to block + handoff with sub-cause "template_not_approved".
 */
export type TemplateApprovalStatus = "draft" | "submitted" | "approved";

/**
 * A WhatsApp template entry in the in-repo registry. Used by the Phase 1d window-gate hook
 * to substitute outbound free-form responses when the conversation is outside the 24h
 * customer-service window.
 *
 * Each body must pass the 1b-1 banned-phrase scanner AND the 1b-2 claim classifier — see
 * whatsapp-registry.test.ts for the cross-phase regression test (Task 5). The `approvalStatus`
 * field determines whether the runtime may actually substitute this entry; only Meta-approved
 * entries (`approvalStatus === "approved"`) are eligible.
 */
export interface WhatsAppTemplate {
  /** Internal name; also used in audit logs and tests. */
  name: string;
  /** The template name as submitted to Meta. */
  metaTemplateName: string;
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
  /** Meta-defined category. Propagated into substitute verdicts for downstream Phase 2 pricing. */
  templateCategory: TemplateCategory;
  /** Meta approval lifecycle. Only "approved" can substitute in enforce mode. */
  approvalStatus: TemplateApprovalStatus;
  /** Rendered body used for substitution. */
  body: string;
  /** Variable placeholders, in Meta order. */
  variables: ReadonlyArray<{ name: string; description: string }>;
}

export const WHATSAPP_TEMPLATES: ReadonlyArray<WhatsAppTemplate> = [
  // 10 entries (5 intent classes × 2 jurisdictions). Body authoring + Meta submission
  // happen in Task 5. Stubs here so the structural tests pass.
  {
    name: "appointment_confirm_sg_v1",
    metaTemplateName: "alex_appointment_confirm_sg_v1",
    intentClass: "appointment-confirm",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "appointment_confirm_my_v1",
    metaTemplateName: "alex_appointment_confirm_my_v1",
    intentClass: "appointment-confirm",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "appointment_reminder_sg_v1",
    metaTemplateName: "alex_appointment_reminder_sg_v1",
    intentClass: "appointment-reminder",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "appointment_reminder_my_v1",
    metaTemplateName: "alex_appointment_reminder_my_v1",
    intentClass: "appointment-reminder",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "aftercare_checkin_sg_v1",
    metaTemplateName: "alex_aftercare_checkin_sg_v1",
    intentClass: "aftercare-checkin",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "aftercare_checkin_my_v1",
    metaTemplateName: "alex_aftercare_checkin_my_v1",
    intentClass: "aftercare-checkin",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "consult_followup_sg_v1",
    metaTemplateName: "alex_consult_followup_sg_v1",
    intentClass: "consult-followup",
    jurisdiction: "SG",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "consult_followup_my_v1",
    metaTemplateName: "alex_consult_followup_my_v1",
    intentClass: "consult-followup",
    jurisdiction: "MY",
    templateCategory: "utility",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "re_engagement_offer_sg_v1",
    metaTemplateName: "alex_re_engagement_offer_sg_v1",
    intentClass: "re-engagement-offer",
    jurisdiction: "SG",
    templateCategory: "marketing",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
  {
    name: "re_engagement_offer_my_v1",
    metaTemplateName: "alex_re_engagement_offer_my_v1",
    intentClass: "re-engagement-offer",
    jurisdiction: "MY",
    templateCategory: "marketing",
    approvalStatus: "draft",
    body: "STUB",
    variables: [],
  },
];

export function selectTemplate(args: {
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
}): WhatsAppTemplate | null {
  return (
    WHATSAPP_TEMPLATES.find(
      (t) => t.intentClass === args.intentClass && t.jurisdiction === args.jurisdiction,
    ) ?? null
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/templates/whatsapp-registry.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/templates/whatsapp-registry.ts packages/core/src/skill-runtime/templates/whatsapp-registry.test.ts
git commit -m "feat(core): scaffold WhatsApp template registry types + selectTemplate (1d)"
```

---

### Task 5: Author 10 v1 template bodies + cross-phase scanner regression tests

**Files:**

- Modify: `packages/core/src/skill-runtime/templates/whatsapp-registry.ts` (replace STUB bodies)
- Modify: `packages/core/src/skill-runtime/templates/whatsapp-registry.test.ts` (add scanner regression)

- [ ] **Step 1: Replace stub bodies with HSA/MOH/MAB-compliant copy**

Open `packages/core/src/skill-runtime/templates/whatsapp-registry.ts`. Replace each `body: "STUB"` with copy that:

- Reads as service / transactional for `utility` entries; reads as light promotional outreach for `marketing` entries.
- Uses variable placeholders matching the `variables` array — write them as `{{name}}` syntax (Meta's convention).
- Contains no banned phrases per 1b-1 (e.g. "guaranteed cure", "100% effective"). Refer to `packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts` for the banned-phrase tables; if unsure, run the scanner test in Step 4 and iterate.
- Contains no unsupported claims per 1b-2 (avoid medical efficacy claims; stick to scheduling and procedural language).

Example (SG appointment-confirm):

```ts
{
  name: "appointment_confirm_sg_v1",
  metaTemplateName: "alex_appointment_confirm_sg_v1",
  intentClass: "appointment-confirm",
  jurisdiction: "SG",
  templateCategory: "utility",
  approvalStatus: "draft", // flip to "submitted" then "approved" via PR as Meta confirms each submission
  body:
    "Hi {{lead_name}}, your appointment with {{business_name}} on {{date}} at {{time}} is confirmed. " +
    "Please reply CONFIRM to lock it in, or reply RESCHEDULE if the time no longer works for you.",
  variables: [
    { name: "lead_name", description: "The lead's first name." },
    { name: "business_name", description: "The medspa's display name." },
    { name: "date", description: "Date of appointment (e.g. 12 May 2026)." },
    { name: "time", description: "Time of appointment (e.g. 3:00 PM)." },
  ],
},
```

Author the remaining nine following the same shape. Re-engagement offers (marketing) may invite the lead back to book a consultation without promising outcomes — phrase as "we'd love to see you again" not "achieve X results". Leave every entry's `approvalStatus` at `"draft"` until the corresponding Meta App Review submission confirms otherwise — a follow-up PR flips the status field as each template gets reviewed.

- [ ] **Step 2: Add the cross-phase scanner regression test**

Open `packages/core/src/skill-runtime/templates/whatsapp-registry.test.ts`. Add this `describe` block at the end:

```ts
import { scanForBannedPhrases } from "../hooks/deterministic-safety-gate.js";
// If scanForBannedPhrases is not exported, export it explicitly from deterministic-safety-gate.ts
// in this commit (it's a pure function and safe to expose for testing).

describe("WHATSAPP_TEMPLATES — cross-phase regression", () => {
  it("every template body passes the 1b-1 banned-phrase scanner", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      const result = scanForBannedPhrases(t.body, {
        jurisdiction: t.jurisdiction,
        clinicType: "medspa",
      });
      expect(result.matches, `${t.name}: ${JSON.stringify(result.matches)}`).toEqual([]);
    }
  });

  // The 1b-2 claim classifier is async + uses an LLM, so we cannot invoke it in unit tests.
  // Instead we assert a static heuristic: no efficacy verbs in any template body. This catches
  // the most likely class of un-substantiated claim drift; the runtime claim-classifier hook
  // is the authoritative check.
  it("every template body has no efficacy verbs", () => {
    for (const t of WHATSAPP_TEMPLATES) {
      const efficacy = /\b(cure|eliminate|guarantee|100%|permanent(ly)?)\b/i;
      expect(efficacy.test(t.body), `${t.name}: efficacy verb`).toBe(false);
    }
  });
});
```

If `scanForBannedPhrases` is not currently exported from `deterministic-safety-gate.ts`, export it in this same commit. Open the file and add `export ` in front of the function declaration.

- [ ] **Step 3: Run the registry tests**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/templates/whatsapp-registry.test.ts
```

Expected: PASS (7 tests). If any body fails the banned-phrase scanner, rewrite the offending body.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/templates/whatsapp-registry.ts packages/core/src/skill-runtime/templates/whatsapp-registry.test.ts packages/core/src/skill-runtime/hooks/deterministic-safety-gate.ts
git commit -m "feat(core): author 1d v1 template bodies and add cross-phase scanner regression"
```

---

### Task 6: `WhatsAppWindowGateHook` implementation + unit tests

**Files:**

- Create: `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts`
- Test: `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.test.ts`

This task is the meat of 1d. Tests come first.

- [ ] **Step 1: Write failing tests — happy paths**

Create `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { WhatsAppWindowGateHook } from "./whatsapp-window-gate.js";
import type { SkillExecutionResult, SkillHookContext } from "../types.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-12T10:00:00Z");
const clock = () => NOW;

function makeCtx(): SkillHookContext {
  return {
    deploymentId: "dep_test",
    orgId: "org_test",
    skillSlug: "alex-sg-my",
    skillVersion: "1.0.0",
    sessionId: "thread_test",
    trustLevel: "guided",
    trustScore: 0.8,
  };
}

function makeResult(overrides: Partial<SkillExecutionResult> = {}): SkillExecutionResult {
  return {
    response: "Hi there, see you tomorrow.",
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    trace: {
      durationMs: 0,
      turnCount: 1,
      status: "success",
      responseSummary: "",
      writeCount: 0,
      governanceDecisions: [],
    },
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    verdictStore: { save: vi.fn().mockResolvedValue(undefined) },
    handoffStore: { save: vi.fn().mockResolvedValue(undefined) },
    governanceConfigResolver: {
      resolve: vi.fn().mockResolvedValue({
        whatsappWindow: {
          enabled: true,
          mode: "enforce",
          jurisdiction: "SG",
          allowMarketingTemplateSubstitution: false,
        },
      }),
    },
    postureCache: { get: vi.fn(), remember: vi.fn() },
    threadStore: {
      getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(new Date(NOW.getTime() - 60 * 60 * 1000)), // 1h ago
    },
    contactStore: {
      getMessagingOptInForThread: vi.fn().mockResolvedValue(true),
    },
    channelTypeResolver: {
      resolve: vi.fn().mockResolvedValue("whatsapp"),
    },
    clock,
    windowMs: WINDOW_MS,
    ...overrides,
  };
}

describe("WhatsAppWindowGateHook — inside window", () => {
  it("passes inside-window emit through unchanged", async () => {
    const deps = makeDeps();
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    const before = result.response;

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe(before);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceGuard: "whatsapp_window",
        action: "allow",
        reasonCode: "allowed",
      }),
    );
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/hooks/whatsapp-window-gate.test.ts
```

Expected: FAIL with `Cannot find module './whatsapp-window-gate.js'`.

- [ ] **Step 3: Write the minimal hook implementation**

Create `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts`:

```ts
import type { IntentClass } from "@switchboard/schemas";
import type { SkillExecutionResult, SkillHook, SkillHookContext } from "../types.js";
import { selectTemplate, type Jurisdiction } from "../templates/whatsapp-registry.js";
import type { HandoffReason } from "../../handoff/types.js";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WhatsAppWindowGateConfig {
  enabled: boolean;
  mode: "observe" | "enforce";
  jurisdiction: Jurisdiction;
  /**
   * If false (default in 1d), marketing-category templates are blocked + handed off
   * even when a match exists. Prevents 1d from silently becoming a paid promotional
   * sender. Phase 2 operator approval queue / budget caps are the natural enablement
   * layer for flipping this to true per deployment.
   */
  allowMarketingTemplateSubstitution: boolean;
}

export interface WhatsAppWindowGateDeps {
  verdictStore: { save: (input: unknown) => Promise<void> };
  handoffStore: { save: (input: unknown) => Promise<void> };
  governanceConfigResolver: {
    resolve: (deploymentId: string) => Promise<{
      whatsappWindow?: WhatsAppWindowGateConfig;
    }>;
  };
  postureCache: {
    get: (deploymentId: string) => WhatsAppWindowGateConfig | undefined;
    remember: (deploymentId: string, posture: WhatsAppWindowGateConfig) => void;
  };
  threadStore: { getLastWhatsAppInboundAt: (threadId: string) => Promise<Date | null> };
  contactStore: { getMessagingOptInForThread: (threadId: string) => Promise<boolean> };
  channelTypeResolver: { resolve: (sessionId: string) => Promise<string> };
  clock: () => Date;
  windowMs?: number;
}

type BlockSubCause =
  | "missing_opt_in"
  | "missing_intent_class"
  | "no_template_fit"
  | "template_not_approved"
  | "marketing_substitution_blocked";

export class WhatsAppWindowGateHook implements SkillHook {
  readonly name = "whatsapp-window-gate";

  constructor(private readonly deps: WhatsAppWindowGateDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const channel = await this.deps.channelTypeResolver.resolve(ctx.sessionId);
    if (channel !== "whatsapp") return;

    const config = await this.resolveConfig(ctx.deploymentId);
    if (!config) {
      // Fail-closed: governance is unavailable. Match 1c's precedent — block hard.
      await this.emitVerdict({
        ctx,
        action: "block",
        reasonCode: "governance_unavailable",
        details: { reason: "resolver_error" },
      });
      result.response = "";
      return;
    }
    if (!config.enabled) return;

    const lastInbound = await this.deps.threadStore.getLastWhatsAppInboundAt(ctx.sessionId);
    const now = this.deps.clock().getTime();
    const windowMs = this.deps.windowMs ?? DEFAULT_WINDOW_MS;
    const inside = lastInbound !== null && now - lastInbound.getTime() < windowMs;

    if (inside) {
      await this.emitVerdict({
        ctx,
        action: "allow",
        reasonCode: "allowed",
        details: { windowStatus: "inside", lastWhatsAppInboundAt: lastInbound?.toISOString() },
      });
      return;
    }

    const optIn = await this.deps.contactStore.getMessagingOptInForThread(ctx.sessionId);
    if (!optIn) {
      await this.handleBlock(ctx, result, config, {
        subCause: "missing_opt_in",
        intentClass: result.intentClass ?? null,
        details: {
          windowStatus: "outside",
          optInStatus: "missing_or_false",
          templateMatch: "not_attempted",
          intentClass: result.intentClass ?? null,
        },
      });
      return;
    }

    if (!result.intentClass) {
      await this.handleBlock(ctx, result, config, {
        subCause: "missing_intent_class",
        intentClass: null,
        details: {
          windowStatus: "outside",
          optInStatus: "granted",
          templateMatch: "skipped_no_intent",
          intentClass: null,
        },
      });
      return;
    }

    const template = selectTemplate({
      intentClass: result.intentClass,
      jurisdiction: config.jurisdiction,
    });
    if (!template) {
      await this.handleBlock(ctx, result, config, {
        subCause: "no_template_fit",
        intentClass: result.intentClass,
        templateMetadata: null,
        details: {
          windowStatus: "outside",
          optInStatus: "granted",
          templateMatch: "no_fit",
          intentClass: result.intentClass,
        },
      });
      return;
    }

    if (template.approvalStatus !== "approved") {
      await this.handleBlock(ctx, result, config, {
        subCause: "template_not_approved",
        intentClass: result.intentClass,
        templateMetadata: {
          templateName: template.name,
          metaTemplateName: template.metaTemplateName,
          templateCategory: template.templateCategory,
        },
        details: {
          windowStatus: "outside",
          optInStatus: "granted",
          templateMatch: "template_not_approved",
          intentClass: result.intentClass,
          templateName: template.name,
          metaTemplateName: template.metaTemplateName,
          approvalStatus: template.approvalStatus,
        },
      });
      return;
    }

    if (template.templateCategory === "marketing" && !config.allowMarketingTemplateSubstitution) {
      await this.handleBlock(ctx, result, config, {
        subCause: "marketing_substitution_blocked",
        intentClass: result.intentClass,
        templateMetadata: {
          templateName: template.name,
          metaTemplateName: template.metaTemplateName,
          templateCategory: template.templateCategory,
        },
        details: {
          windowStatus: "outside",
          optInStatus: "granted",
          templateMatch: "marketing_substitution_blocked",
          intentClass: result.intentClass,
          templateName: template.name,
          metaTemplateName: template.metaTemplateName,
          templateCategory: template.templateCategory,
          recipientMarket: config.jurisdiction,
          costRisk: "paid_template_message",
          costEstimateStatus: "not_priced_in_1d",
        },
      });
      return;
    }

    // Happy path: substitute.
    const originalText = result.response;
    if (config.mode === "enforce") {
      result.response = template.body;
    }
    await this.emitVerdict({
      ctx,
      action: "substitute",
      reasonCode: "outside_whatsapp_window",
      originalText,
      emittedText: template.body,
      details: {
        windowStatus: "outside",
        optInStatus: "granted",
        templateMatch: "matched",
        intentClass: result.intentClass,
        templateName: template.name,
        metaTemplateName: template.metaTemplateName,
        templateCategory: template.templateCategory,
        recipientMarket: config.jurisdiction,
        costRisk: "paid_template_message",
        costEstimateStatus: "not_priced_in_1d",
      },
    });
  }

  private async resolveConfig(deploymentId: string): Promise<WhatsAppWindowGateConfig | null> {
    try {
      const cfg = await this.deps.governanceConfigResolver.resolve(deploymentId);
      const posture = cfg.whatsappWindow ?? null;
      if (posture) this.deps.postureCache.remember(deploymentId, posture);
      return posture;
    } catch {
      const cached = this.deps.postureCache.get(deploymentId);
      return cached ?? null;
    }
  }

  private async handleBlock(
    ctx: SkillHookContext,
    result: SkillExecutionResult,
    config: WhatsAppWindowGateConfig,
    args: {
      subCause: BlockSubCause;
      intentClass: IntentClass | null;
      templateMetadata: {
        templateName: string;
        metaTemplateName: string;
        templateCategory: "utility" | "marketing" | "authentication";
      } | null;
      details: Record<string, unknown>;
    },
  ): Promise<void> {
    const originalText = result.response;
    if (config.mode === "enforce") {
      result.response = "";
      const handoffReason: HandoffReason = "outside_whatsapp_window";
      await this.deps.handoffStore.save({
        reason: handoffReason,
        conversationId: ctx.sessionId,
        originalText,
        metadata: {
          intentClass: args.intentClass,
          blockSubCause: args.subCause,
          jurisdiction: config.jurisdiction,
          ...(args.templateMetadata ?? {}),
        },
      });
    }
    await this.emitVerdict({
      ctx,
      action: "block",
      reasonCode: "outside_whatsapp_window",
      originalText,
      details: args.details,
    });
  }

  private async emitVerdict(args: {
    ctx: SkillHookContext;
    action: "allow" | "block" | "substitute";
    reasonCode: string;
    originalText?: string;
    emittedText?: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.deps.verdictStore.save({
      sourceGuard: "whatsapp_window",
      action: args.action,
      reasonCode: args.reasonCode,
      deploymentId: args.ctx.deploymentId,
      conversationId: args.ctx.sessionId,
      originalText: args.originalText,
      emittedText: args.emittedText,
      decidedAt: this.deps.clock().toISOString(),
      details: args.details,
    });
  }
}
```

- [ ] **Step 4: Run inside-window test to verify pass**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/hooks/whatsapp-window-gate.test.ts
```

Expected: 1 PASS.

- [ ] **Step 5: Add the full test suite (outside-window paths + edge cases)**

Append to `whatsapp-window-gate.test.ts`:

```ts
describe("WhatsAppWindowGateHook — outside window", () => {
  const farPast = new Date(NOW.getTime() - 25 * 60 * 60 * 1000); // 25h ago

  it("substitutes when opt-in granted and template matches", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).not.toBe("Hi there, see you tomorrow.");
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceGuard: "whatsapp_window",
        action: "substitute",
        reasonCode: "outside_whatsapp_window",
        details: expect.objectContaining({
          templateMatch: "matched",
          templateCategory: "utility",
          recipientMarket: "SG",
          costRisk: "paid_template_message",
          costEstimateStatus: "not_priced_in_1d",
        }),
      }),
    );
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
  });

  it("blocks + handoffs when opt-in missing", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      contactStore: { getMessagingOptInForThread: vi.fn().mockResolvedValue(false) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe("");
    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "outside_whatsapp_window",
        metadata: expect.objectContaining({ blockSubCause: "missing_opt_in" }),
      }),
    );
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        details: expect.objectContaining({
          windowStatus: "outside",
          optInStatus: "missing_or_false",
        }),
      }),
    );
  });

  it("blocks + handoffs when intentClass missing", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult(); // no intentClass

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ blockSubCause: "missing_intent_class" }),
      }),
    );
  });

  it("blocks + handoffs when no template matches the intent/jurisdiction", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      governanceConfigResolver: {
        resolve: vi.fn().mockResolvedValue({
          whatsappWindow: {
            enabled: true,
            mode: "enforce",
            jurisdiction: "XX",
            allowMarketingTemplateSubstitution: false,
          },
        }),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ blockSubCause: "no_template_fit" }),
      }),
    );
  });

  it("blocks + handoffs when the matched template is not approved", async () => {
    // Test relies on at least one v1 stub registry entry being approvalStatus="draft".
    // Author's note: the registry initially ships with all entries draft; Meta-approved
    // entries flip via PR. If by the time this test runs every entry is "approved",
    // mock selectTemplate to return a synthetic draft template instead.
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "outside_whatsapp_window",
        metadata: expect.objectContaining({
          blockSubCause: "template_not_approved",
          templateName: expect.any(String),
          metaTemplateName: expect.any(String),
        }),
      }),
    );
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        details: expect.objectContaining({
          templateMatch: "template_not_approved",
          approvalStatus: "draft",
        }),
      }),
    );
  });

  it("blocks + handoffs when matched template is marketing-category and flag is off (default)", async () => {
    // Like the above, this test relies on a re-engagement-offer entry existing AND being
    // approved (so we exercise the marketing-category check, not the approval check).
    // Either flip a re-engagement-offer entry to approvalStatus="approved" in a fixture,
    // or mock selectTemplate to return a synthetic { templateCategory: "marketing",
    // approvalStatus: "approved" } template for this test.
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      governanceConfigResolver: {
        resolve: vi.fn().mockResolvedValue({
          whatsappWindow: {
            enabled: true,
            mode: "enforce",
            jurisdiction: "SG",
            allowMarketingTemplateSubstitution: false,
          },
        }),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "re-engagement-offer" });

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "outside_whatsapp_window",
        metadata: expect.objectContaining({
          blockSubCause: "marketing_substitution_blocked",
          templateCategory: "marketing",
        }),
      }),
    );
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        details: expect.objectContaining({
          templateMatch: "marketing_substitution_blocked",
          templateCategory: "marketing",
          recipientMarket: "SG",
          costRisk: "paid_template_message",
          costEstimateStatus: "not_priced_in_1d",
        }),
      }),
    );
  });

  it("substitutes when matched marketing template AND allowMarketingTemplateSubstitution is true", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      governanceConfigResolver: {
        resolve: vi.fn().mockResolvedValue({
          whatsappWindow: {
            enabled: true,
            mode: "enforce",
            jurisdiction: "SG",
            allowMarketingTemplateSubstitution: true,
          },
        }),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "re-engagement-offer" });

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "substitute",
        details: expect.objectContaining({ templateCategory: "marketing" }),
      }),
    );
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
  });
});

describe("WhatsAppWindowGateHook — cost-annotation contract", () => {
  const farPast = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);

  it("every substitute verdict carries the five mandatory cost fields", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    const substituteCall = (deps.verdictStore.save as ReturnType<typeof vi.fn>).mock.calls.find(
      ([arg]) => (arg as { action?: string }).action === "substitute",
    );
    expect(substituteCall, "expected exactly one substitute verdict").toBeDefined();
    const verdict = (substituteCall as [{ details: Record<string, unknown> }])[0];
    expect(verdict.details).toEqual(
      expect.objectContaining({
        templateCategory: expect.any(String),
        recipientMarket: expect.any(String),
        metaTemplateName: expect.any(String),
        costRisk: "paid_template_message",
        costEstimateStatus: "not_priced_in_1d",
      }),
    );
  });
});

describe("WhatsAppWindowGateHook — mode and flag", () => {
  const farPast = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);

  it("observe mode emits verdict but does not mutate response or handoff", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      governanceConfigResolver: {
        resolve: vi.fn().mockResolvedValue({
          whatsappWindow: {
            enabled: true,
            mode: "observe",
            jurisdiction: "SG",
            allowMarketingTemplateSubstitution: false,
          },
        }),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });
    const before = result.response;

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe(before);
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "substitute" }),
    );
  });

  it("feature flag off → passthrough, no verdict", async () => {
    const deps = makeDeps({
      governanceConfigResolver: {
        resolve: vi.fn().mockResolvedValue({
          whatsappWindow: {
            enabled: false,
            mode: "enforce",
            jurisdiction: "SG",
            allowMarketingTemplateSubstitution: false,
          },
        }),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.verdictStore.save).not.toHaveBeenCalled();
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
  });

  it("non-whatsapp channel → passthrough, no verdict", async () => {
    const deps = makeDeps({
      channelTypeResolver: { resolve: vi.fn().mockResolvedValue("telegram") },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.verdictStore.save).not.toHaveBeenCalled();
  });
});

describe("WhatsAppWindowGateHook — window edge cases", () => {
  it("23:59:59 ago → inside", async () => {
    const deps = makeDeps({
      threadStore: {
        getLastWhatsAppInboundAt: vi
          .fn()
          .mockResolvedValue(new Date(NOW.getTime() - (24 * 60 * 60 * 1000 - 1000))),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow" }),
    );
  });

  it("24:00:01 ago → outside", async () => {
    const deps = makeDeps({
      threadStore: {
        getLastWhatsAppInboundAt: vi
          .fn()
          .mockResolvedValue(new Date(NOW.getTime() - (24 * 60 * 60 * 1000 + 1000))),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "substitute" }),
    );
  });

  it("lastWhatsAppInboundAt null → outside", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(null) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "substitute" }),
    );
  });
});

describe("WhatsAppWindowGateHook — fail closed", () => {
  it("blocks on resolver error with no cached posture", async () => {
    const deps = makeDeps({
      governanceConfigResolver: { resolve: vi.fn().mockRejectedValue(new Error("boom")) },
      postureCache: { get: vi.fn().mockReturnValue(undefined), remember: vi.fn() },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        reasonCode: "governance_unavailable",
      }),
    );
  });

  it("uses cached posture when resolver errors", async () => {
    const deps = makeDeps({
      governanceConfigResolver: { resolve: vi.fn().mockRejectedValue(new Error("boom")) },
      postureCache: {
        get: vi.fn().mockReturnValue({
          enabled: true,
          mode: "enforce",
          jurisdiction: "SG",
          allowMarketingTemplateSubstitution: false,
        }),
        remember: vi.fn(),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow" }),
    );
  });
});
```

- [ ] **Step 6: Run the full suite**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/hooks/whatsapp-window-gate.test.ts
```

Expected: ALL PASS. If anything fails, debug — do not weaken the assertions.

- [ ] **Step 7: Run core typecheck**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts packages/core/src/skill-runtime/hooks/whatsapp-window-gate.test.ts
git commit -m "feat(core): WhatsAppWindowGateHook with substitute/block/handoff paths (1d)"
```

---

### Task 7: Wire `WhatsAppWindowGateHook` into the skill-mode bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts:385-398` (the hooks array + executor construction)

- [ ] **Step 1: Read the existing bootstrap**

Open `apps/api/src/bootstrap/skill-mode.ts`. Around line 373 the 1c `pdpaConsentGateHook` is instantiated. Around line 385 the hooks array is constructed:

```ts
const hooks = [
  new GovernanceHook(toolsMap),
  safetyGateHook,
  claimClassifierHook,
  pdpaConsentGateHook,
];
```

- [ ] **Step 1.5: Verify where channel is persisted**

The hook's `channelTypeResolver` needs to resolve the active channel ("whatsapp", "telegram", etc.) given a sessionId (which is the `ConversationThread.id`). Before writing the resolver in Step 2, find where the channel is stored:

```bash
grep -n "channel" packages/db/prisma/schema.prisma | grep -i "thread\|message"
grep -rn "agentContext.channel\|channel:" apps/chat/src/gateway/ packages/core/src/ --include="*.ts" | head -30
```

Pick the resolver implementation based on what you find:

- **If `ConversationThread` has a `channel` column** (in schema.prisma): query that column directly.
- **If channel lives in `agentContext` JSON** (the most likely answer based on the explore report — `info.channel` flows from `getOrCreateBySession`): cast `agentContext` to read `channel`.
- **If channel is only in the in-memory `threadCache`** (no DB persistence): you must either (a) add a `channel` column to `ConversationThread` in Task 1's migration before this task can land, or (b) write the channel into `agentContext` from `getOrCreateBySession`. Pick (b) — it's less invasive and reuses the existing JSON field. Update `getOrCreateBySession` and `addMessage` to persist channel into `agentContext`.

Note your finding before writing the resolver in Step 2 — the resolver code below assumes the `agentContext.channel` path.

- [ ] **Step 2: Construct the new hook deps**

Immediately after the `pdpaConsentGateHook` construction (line ~383), add:

```ts
const whatsAppWindowPostureCache = new InMemoryGovernancePostureCache();
const whatsAppWindowGateHook = new WhatsAppWindowGateHook({
  verdictStore: prismaGovernanceVerdictStore,
  handoffStore: prismaHandoffStore,
  governanceConfigResolver: gatewayGovernanceResolver,
  postureCache: whatsAppWindowPostureCache,
  threadStore: {
    getLastWhatsAppInboundAt: async (threadId) => {
      const row = await prismaClient.conversationThread.findUnique({
        where: { id: threadId },
        select: { lastWhatsAppInboundAt: true },
      });
      return row?.lastWhatsAppInboundAt ?? null;
    },
  },
  contactStore: {
    getMessagingOptInForThread: async (threadId) => {
      const thread = await prismaClient.conversationThread.findUnique({
        where: { id: threadId },
        select: { contact: { select: { messagingOptIn: true } } },
      });
      return thread?.contact.messagingOptIn ?? false;
    },
  },
  channelTypeResolver: {
    resolve: async (sessionId) => {
      const thread = await prismaClient.conversationThread.findUnique({
        where: { id: sessionId },
        select: { agentContext: true },
      });
      // ConversationThread stores channel inside agentContext per gateway-conversation-store.
      const ctx = (thread?.agentContext ?? {}) as { channel?: string };
      return ctx.channel ?? "unknown";
    },
  },
  clock: () => new Date(),
});
```

If `prismaHandoffStore`, `prismaGovernanceVerdictStore`, `gatewayGovernanceResolver` are named differently in the surrounding code, use the existing names — read the file before editing. The InMemoryGovernancePostureCache import is already present from the 1c block.

Add the `WhatsAppWindowGateHook` import at the top of the file alongside other hook imports:

```ts
import { WhatsAppWindowGateHook } from "@switchboard/core/skill-runtime/hooks/whatsapp-window-gate.js";
```

- [ ] **Step 3: Append the hook to the hooks array**

Change:

```ts
const hooks = [
  new GovernanceHook(toolsMap),
  safetyGateHook,
  claimClassifierHook,
  pdpaConsentGateHook,
];
```

to:

```ts
const hooks = [
  new GovernanceHook(toolsMap),
  safetyGateHook,
  claimClassifierHook,
  pdpaConsentGateHook,
  whatsAppWindowGateHook,
];
```

Order matters: 1c's consent gate must run before 1d's window gate. The new hook goes after `pdpaConsentGateHook`.

- [ ] **Step 4: Repeat for the simulation executor**

Around line 495 there is a second `SkillExecutorImpl` construction for the simulation path. Add `whatsAppWindowGateHook` to its hooks array too, in the same position.

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @switchboard/api typecheck
```

Expected: PASS. If the channel-type resolver shape doesn't match how `agentContext.channel` is actually stored, adjust by inspecting `apps/chat/src/gateway/gateway-conversation-store.ts:73-86` for how `info.channel` is set.

- [ ] **Step 6: Run api tests**

```bash
pnpm --filter @switchboard/api test
```

Expected: PASS (or no new failures).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts
git commit -m "feat(api): register WhatsAppWindowGateHook in skill-mode bootstrap (1d)"
```

---

### Task 8: Set `lastWhatsAppInboundAt` on inbound WhatsApp messages

**Files:**

- Modify: `apps/chat/src/gateway/gateway-conversation-store.ts:73-86`
- Test: `apps/chat/src/gateway/gateway-conversation-store.test.ts` (extend if exists; create if not)

- [ ] **Step 1: Write the failing test**

Open `apps/chat/src/gateway/gateway-conversation-store.test.ts` (create if absent). Use the existing test patterns in the file as a template (mocked Prisma per `feedback_api_test_mocked_prisma.md`). Add:

```ts
it("updates lastWhatsAppInboundAt when an inbound WhatsApp message is added", async () => {
  // Arrange: cache an inbound thread for whatsapp channel, mock prisma
  // Act: store.addMessage(threadId, "user", "hi")
  // Assert: prisma.conversationThread.update called with lastWhatsAppInboundAt set to a Date
});

it("does NOT update lastWhatsAppInboundAt for outbound messages", async () => {
  // role === "assistant" → no lastWhatsAppInboundAt field in the update call
});

it("does NOT update lastWhatsAppInboundAt for non-whatsapp inbound", async () => {
  // info.channel === "telegram" → no lastWhatsAppInboundAt
});
```

Flesh out the test bodies using the existing test file's setup helpers. The test must verify the exact update payload passed to `prisma.conversationThread.update`.

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/chat test src/gateway/gateway-conversation-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Modify `addMessage`**

Open `apps/chat/src/gateway/gateway-conversation-store.ts`. Replace the existing `addMessage` method (lines 73-86) with:

```ts
async addMessage(conversationId: string, role: string, content: string): Promise<void> {
  const info = this.threadCache.get(conversationId);
  if (!info) {
    throw new Error(
      `Thread ${conversationId} not found in cache — call getOrCreateBySession first`,
    );
  }

  const direction = role === "user" ? "inbound" : "outbound";

  await this.prisma.conversationMessage.create({
    data: {
      contactId: info.contactId,
      orgId: info.organizationId,
      direction,
      content,
      channel: info.channel,
    },
  });

  const threadUpdate: {
    messageCount: { increment: number };
    lastWhatsAppInboundAt?: Date;
  } = { messageCount: { increment: 1 } };

  if (direction === "inbound" && info.channel === "whatsapp") {
    threadUpdate.lastWhatsAppInboundAt = new Date();
  }

  await this.prisma.conversationThread.update({
    where: { id: conversationId },
    data: threadUpdate,
  });
}
```

- [ ] **Step 4: Run to verify pass**

```bash
pnpm --filter @switchboard/chat test src/gateway/gateway-conversation-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run chat typecheck**

```bash
pnpm --filter @switchboard/chat typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/gateway/gateway-conversation-store.ts apps/chat/src/gateway/gateway-conversation-store.test.ts
git commit -m "feat(chat): persist ConversationThread.lastWhatsAppInboundAt for whatsapp inbound (1d)"
```

---

### Task 9: Emit and parse `<intent>...</intent>` tag

**Files:**

- Modify: `skills/alex/SKILL.md` (add LLM instruction)
- Modify: `packages/core/src/skill-runtime/skill-executor.ts:209-235` (parse + strip the tag)
- Test: `packages/core/src/skill-runtime/skill-executor.test.ts` (extend if exists; create if not)

- [ ] **Step 1: Write the failing parser test**

Open or create `packages/core/src/skill-runtime/skill-executor.test.ts`. Add:

```ts
import { describe, expect, it } from "vitest";
import { parseIntentTag } from "./skill-executor.js"; // export it for testing

describe("parseIntentTag", () => {
  it("0 tags → cleaned text, null intentClass", () => {
    const r = parseIntentTag("See you at 3pm.");
    expect(r.text).toBe("See you at 3pm.");
    expect(r.intentClass).toBeNull();
  });

  it("1 valid trailing tag → strip + use", () => {
    const r = parseIntentTag("See you at 3pm. <intent>appointment-confirm</intent>");
    expect(r.text).toBe("See you at 3pm.");
    expect(r.intentClass).toBe("appointment-confirm");
  });

  it("strips the tag even when surrounded by whitespace/newlines", () => {
    const r = parseIntentTag("See you.\n\n  <intent>aftercare-checkin</intent>  \n");
    expect(r.text).toBe("See you.");
    expect(r.intentClass).toBe("aftercare-checkin");
  });

  it("unknown tag value → strip tag, null intentClass", () => {
    const r = parseIntentTag("See you. <intent>fooobar</intent>");
    expect(r.text).toBe("See you.");
    expect(r.intentClass).toBeNull();
  });

  it("multiple tags (regardless of validity) → strip ALL tags, null intentClass", () => {
    const r = parseIntentTag(
      "Booked. <intent>appointment-confirm</intent> Or maybe <intent>appointment-reminder</intent>",
    );
    // Both tags removed; the model emitted ambiguous intent, so we treat it as no intent.
    expect(r.intentClass).toBeNull();
    expect(r.text).not.toMatch(/<intent>/);
    expect(r.text).not.toMatch(/<\/intent>/);
  });

  it("multiple tags with mixed validity → still null + strip all", () => {
    const r = parseIntentTag(
      "Hello. <intent>foo</intent> world <intent>appointment-confirm</intent>",
    );
    expect(r.intentClass).toBeNull();
    expect(r.text).not.toMatch(/<\/?intent>/);
  });

  it("malformed tag (unclosed) is left in place; intentClass null", () => {
    const r = parseIntentTag("See you. <intent>appointment-confirm");
    expect(r.intentClass).toBeNull();
    // No closing </intent> means the regex doesn't match; we leave the text as-is (minus trim).
    expect(r.text).toContain("<intent>");
  });

  it("single tag not at the trailing edge is still recognized as one tag", () => {
    const r = parseIntentTag("Welcome <intent>consult-followup</intent> back!");
    expect(r.intentClass).toBe("consult-followup");
    expect(r.text).not.toMatch(/<\/?intent>/);
    expect(r.text).toMatch(/Welcome/);
    expect(r.text).toMatch(/back!/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/skill-executor.test.ts -t parseIntentTag
```

Expected: FAIL with `parseIntentTag is not a function`.

- [ ] **Step 3: Add the parser to `skill-executor.ts`**

Open `packages/core/src/skill-runtime/skill-executor.ts`. Near the top, alongside any other exported helpers (after imports, before the executor class), add:

```ts
import { IntentClassSchema, type IntentClass } from "@switchboard/schemas";

// Global match — captures every <intent>...</intent> occurrence in the response.
// Whitespace around the inner value is allowed; the tag itself is closed.
const INTENT_TAG_GLOBAL_RE = /<intent>\s*([a-z-]+)\s*<\/intent>/gi;

/**
 * Parse + strip `<intent>...</intent>` tags from an LLM response.
 *
 * Rules:
 *   - 0 valid tags                  → text trimmed, intentClass = null
 *   - 1 valid trailing tag          → strip the tag, intentClass = parsed value
 *   - 1 unknown-value tag           → strip the tag, intentClass = null
 *   - 2+ tags (any validity mix)    → strip ALL tags, intentClass = null
 *   - malformed (unclosed) tag      → left in place, intentClass = null
 *                                     (treated as if no tag matched)
 *
 * Strip + null on ambiguous input prevents the LLM's hidden / internal-looking text
 * from leaking to the customer and also prevents misclassification when the model
 * accidentally emits two intents.
 */
export function parseIntentTag(text: string): { text: string; intentClass: IntentClass | null } {
  const matches = Array.from(text.matchAll(INTENT_TAG_GLOBAL_RE));
  if (matches.length === 0) {
    return { text: text.trim(), intentClass: null };
  }

  const strippedText = text.replace(INTENT_TAG_GLOBAL_RE, "").replace(/\s+/g, " ").trim();

  if (matches.length > 1) {
    return { text: strippedText, intentClass: null };
  }

  const parsed = IntentClassSchema.safeParse(matches[0][1]);
  return {
    text: strippedText,
    intentClass: parsed.success ? parsed.data : null,
  };
}
```

- [ ] **Step 4: Wire it into the result emission site (lines 209-235)**

Find the existing return block:

```ts
if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
  const responseText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    response: responseText,
    // ... existing fields
  };
}
```

Replace with:

```ts
if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
  const rawResponseText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const { text: responseText, intentClass } = parseIntentTag(rawResponseText);

  return {
    response: responseText,
    toolCalls: toolCallRecords,
    tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
    trace: {
      // ... existing trace fields unchanged, keep the existing object
    },
    ...(intentClass ? { intentClass } : {}),
  };
}
```

Preserve every existing `trace` field — do not reformat them.

- [ ] **Step 5: Run parser tests to verify pass**

```bash
pnpm --filter @switchboard/core test src/skill-runtime/skill-executor.test.ts -t parseIntentTag
```

Expected: PASS (8 tests).

- [ ] **Step 6: Update `skills/alex/SKILL.md`**

Open `skills/alex/SKILL.md`. Find a stable section in the prompt (after the "Voice" section, around lines 63-76 per the explore report) and add a new section. Place it where instruction blocks live — read the file before inserting to confirm:

```markdown
## WhatsApp Intent Tag (REQUIRED for WhatsApp channel)

When the current channel is WhatsApp, end every response with exactly one intent tag on its own line:

`<intent>VALUE</intent>`

Choose VALUE based on what the response is doing:

- `appointment-confirm` — confirming a newly booked appointment.
- `appointment-reminder` — reminding the lead about an upcoming appointment.
- `aftercare-checkin` — a service follow-up after a procedure.
- `consult-followup` — continuing a previous consultation.
- `re-engagement-offer` — promotional outreach to a stalled lead. Use sparingly.

If none of the above describes the response, omit the tag entirely. Do not invent new values.

Do not mention the tag, explain it, or include it on non-WhatsApp channels.
```

- [ ] **Step 7: Run core tests**

```bash
pnpm --filter @switchboard/core test
```

Expected: PASS.

- [ ] **Step 8: Run lint and typecheck**

```bash
pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/core lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts skills/alex/SKILL.md
git commit -m "feat(core): parse <intent> tag from LLM response into SkillExecutionResult.intentClass (1d)"
```

---

### Task 10: Full repo verification + dashboard build

**Files:** none (verification only)

- [ ] **Step 1: Run full typecheck**

```bash
pnpm typecheck
```

Expected: PASS across all packages. If `pnpm typecheck` reports missing exports from `@switchboard/schemas`, `@switchboard/db`, or `@switchboard/core`, run `pnpm reset` first (per CLAUDE.md note about stale build artifacts) and re-run typecheck.

- [ ] **Step 2: Run full lint**

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: PASS. If `prisma-work-trace-store-integrity` or related db integrity tests fail with `pg_advisory_xact_lock void` errors, they are a pre-existing flake per `feedback_db_integrity_tests_pg_advisory_lock.md` — confirm by checking the test name and ignore.

- [ ] **Step 4: Run the dashboard build**

Per `feedback_dashboard_build_not_in_ci.md`, CI does NOT run `next build` for the dashboard. Even though 1d does not touch dashboard code, regression risk is non-zero. Run it locally:

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: PASS. If it fails, the failure is likely unrelated to 1d (e.g., `.js`-extension regression in some other file) — file a separate issue.

- [ ] **Step 5: Final commit if anything changed during verification**

```bash
git status
```

If any files changed during verification (e.g., a lint auto-fix), commit them:

```bash
git add -A
git commit -m "chore(alex): verification cleanups for 1d"
```

If nothing changed, skip this step.

---

### Task 11: Open the implementation PR

**Files:** none (PR creation only)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

Branch name should follow the existing pattern from prior phases: e.g. `feat/alex-medspa-1d-whatsapp-window-gate`.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --title "feat(alex): sg/my medspa phase 1d — whatsapp window gate + template registry" --body "$(cat <<'EOF'
## Summary

Phase 1d of the Alex SG/MY medspa governance work — WhatsApp 24h customer-service window gate, in-repo Meta-approved template registry, and outbound substitution path. First hard runtime block on the outbound side.

- New `WhatsAppWindowGateHook` runs `afterSkill` after the 1c PDPA consent gate; outside-window emits are substituted with a Meta-approved template selected by `SkillExecutionResult.intentClass`, or hard-escalated via `buildHandoffPackage` (new `HandoffReason "outside_whatsapp_window"`) when opt-in is missing, intent class is missing, or no template fits.
- In-repo template registry (10 entries: 5 intent classes × 2 jurisdictions) at `packages/core/src/skill-runtime/templates/whatsapp-registry.ts`.
- Schema adds `ConversationThread.lastWhatsAppInboundAt` (WhatsApp-write-only invariant); `SkillExecutionResult` gains optional `intentClass`; `HandoffReason` gains `"outside_whatsapp_window"`.
- Alex `SKILL.md` instructs the LLM to emit `<intent>...</intent>` tags on WhatsApp; `skill-executor.ts` parses and strips them.
- Behind `alexMedspaSgMyGovernanceV1.whatsappWindow`, default off.
- Substitute verdicts carry cost-awareness metadata (`templateCategory`, `recipientMarket`, `metaTemplateName`, `costRisk: "paid_template_message"`, `costEstimateStatus: "not_priced_in_1d"`) for the Phase 2 billing backfill.

Spec: #436. Closes Phase 1.

## Test plan

- [ ] All package tests pass (`pnpm test`).
- [ ] Full typecheck passes (`pnpm typecheck`).
- [ ] Lint passes (`pnpm lint`).
- [ ] Dashboard build passes locally (`pnpm --filter @switchboard/dashboard build`) — CI does not run this.
- [ ] Manually verify the registry's 10 template bodies pass both 1b-1 and 1b-2 scanners (cross-phase regression test).
- [ ] Confirm `pnpm db:check-drift` is clean.

Prior phases: 1a #409, 1b-1 #429, 1b-2 #431, 1c #435.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

- [ ] **Step 3: Update task tracker / memory if applicable**

Add a memory entry per `~/.claude/projects/-Users-jasonli-switchboard/memory/MEMORY.md` if there are surprising findings worth preserving (e.g., the hook-wiring lives in `apps/api/src/bootstrap/skill-mode.ts`, not `apps/chat` — useful for future phases).
