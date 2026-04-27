# Hardening Round 2 — PR3: Ad-Optimizer Governance Convergence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ad-optimizer side effects (contact creation, WhatsApp sends, outbox writes) behind PlatformIngress with distinct trust policies per intent.

**Architecture:** The ad-optimizer route becomes a thin orchestration layer. Each side effect becomes a governed intent submitted through `PlatformIngress.submit()` with appropriate trust policy. Contact creation is low-risk (auto-approve at guided+), WhatsApp sends are medium-risk (approval required at low trust), outbox writes are low-risk (auto-approve with audit trail).

**Tech Stack:** TypeScript, Fastify, PlatformIngress, Vitest

**Spec:** `docs/superpowers/specs/2026-04-22-hardening-round2-design.md`

---

### Task 1: Define ad-optimizer intent types and trust policies

**Files:**

- Create: `apps/api/src/routes/ad-optimizer-intents.ts`

- [ ] **Step 1: Write the intent definitions**

```typescript
export const AD_OPTIMIZER_INTENTS = {
  "contacts.create": {
    riskCategory: "low" as const,
    autoApproveAbove: "guided" as const,
  },
  "whatsapp.send_template": {
    riskCategory: "medium" as const,
    autoApproveAbove: "autonomous" as const,
  },
  "outbox.write": {
    riskCategory: "low" as const,
    autoApproveAbove: "supervised" as const,
  },
} as const;
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: define ad-optimizer intent types with trust policies

Three distinct intents with appropriate risk levels:
contacts.create (low), whatsapp.send_template (medium), outbox.write (low).
EOF
)"
```

---

### Task 2: Refactor contact creation to use PlatformIngress

**Files:**

- Modify: `apps/api/src/routes/ad-optimizer.ts`

- [ ] **Step 1: Write test — contact creation goes through PlatformIngress**

In `apps/api/src/__tests__/api-ad-optimizer.test.ts` (create if doesn't exist):

```typescript
it("submits contact creation through PlatformIngress", async () => {
  const ctx = await buildTestServer();
  const app = ctx.app;

  // Mock the lead webhook payload
  const payload = {
    entry: [
      {
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: "lead_123",
              form_id: "form_456",
              field_data: [
                { name: "full_name", values: ["Jane Doe"] },
                { name: "email", values: ["jane@example.com"] },
              ],
            },
          },
        ],
      },
    ],
  };

  const res = await app.inject({
    method: "POST",
    url: "/api/ad-optimizer/leads/webhook",
    payload,
  });

  // Should succeed and go through governance
  expect(res.statusCode).toBeLessThan(500);
  await app.close();
});
```

- [ ] **Step 2: Extract direct store writes into PlatformIngress.submit() calls**

In `ad-optimizer.ts`, replace direct `PrismaContactStore.create()` calls with:

```typescript
const contactResult = await app.platformIngress.submit({
  intent: "contacts.create",
  parameters: { name, email, phone, source: "meta_leads", leadId },
  actor: { id: "system", type: "service" },
  organizationId: orgId,
  trigger: "webhook",
  surface: { surface: "api" },
  targetHint: { skillSlug: "contacts" },
});
```

- [ ] **Step 3: Replace WhatsApp template sends with governed intent**

Replace direct `sendWhatsAppTemplate()` calls with:

```typescript
const sendResult = await app.platformIngress.submit({
  intent: "whatsapp.send_template",
  parameters: { recipientPhone, templateName, templateParams, contactId },
  actor: { id: "system", type: "service" },
  organizationId: orgId,
  trigger: "webhook",
  surface: { surface: "api" },
  targetHint: { skillSlug: "whatsapp" },
});
```

- [ ] **Step 4: Replace outbox event writes with governed intent**

Replace direct `PrismaOutboxStore.write()` calls with:

```typescript
const outboxResult = await app.platformIngress.submit({
  intent: "outbox.write",
  parameters: { eventType, payload: eventPayload, contactId },
  actor: { id: "system", type: "service" },
  organizationId: orgId,
  trigger: "webhook",
  surface: { surface: "api" },
  targetHint: { skillSlug: "outbox" },
});
```

- [ ] **Step 5: Register execution modes for the new intents**

These intents need execution handlers in the ModeRegistry. Create simple skill-mode or workflow-mode handlers that perform the actual side effects (the same code that was previously inline in the route).

- [ ] **Step 6: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run`

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: route ad-optimizer side effects through PlatformIngress

Contact creation, WhatsApp sends, and outbox writes now flow through
the governance spine with audit trail and trust-level gating.
EOF
)"
```

---

### Task 3: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx pnpm@9.15.4 test`

- [ ] **Step 2: Run typecheck + lint**

Run: `npx pnpm@9.15.4 typecheck && npx pnpm@9.15.4 lint`

- [ ] **Step 3: Create PR**

```bash
git checkout -b fix/hardening-round2-pr3-ad-optimizer
git push -u origin fix/hardening-round2-pr3-ad-optimizer
```
