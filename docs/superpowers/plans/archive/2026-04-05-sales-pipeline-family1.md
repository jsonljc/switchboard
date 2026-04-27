# Sales Pipeline Family 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three native Sales Pipeline agents (Speed-to-Lead, Sales Closer, Nurture Specialist) that auto-hand-off leads through a shared conversation state, using existing data models and infrastructure.

**Architecture:** Reuse existing Contact, Opportunity, ConversationThread models. Add one new AgentPersona model for business context. Build a pipeline orchestrator in `packages/core` that manages agent handoffs. System prompt assembler combines persona + role + context + governance constraints. Deploy wizard in dashboard extends existing onboarding flow.

**Tech Stack:** TypeScript, Prisma, Zod, Vitest, Next.js 14, TanStack React Query, Tailwind/shadcn, Claude API via existing LLMAdapter.

**Spec:** `docs/superpowers/specs/2026-04-05-sales-pipeline-family1-design.md`

---

## File Structure

### New Files

```
packages/schemas/src/agent-persona.ts                          — Zod schema + PersonaTone enum
packages/schemas/src/__tests__/agent-persona.test.ts            — Schema validation tests

packages/db/src/stores/prisma-agent-persona-store.ts            — CRUD store for AgentPersona
packages/db/src/stores/__tests__/prisma-agent-persona-store.test.ts

packages/core/src/sales-pipeline/prompt-assembler.ts            — Builds system prompt from 4 components
packages/core/src/sales-pipeline/prompt-assembler.test.ts
packages/core/src/sales-pipeline/role-prompts.ts                — Role prompt templates per agent type
packages/core/src/sales-pipeline/governance-constraints.ts      — Hardcoded non-overridable rules
packages/core/src/sales-pipeline/pipeline-orchestrator.ts       — Handoff logic, dormancy, re-engagement
packages/core/src/sales-pipeline/pipeline-orchestrator.test.ts
packages/core/src/sales-pipeline/index.ts                       — Barrel exports

packages/db/prisma/migrations/YYYYMMDD_add_agent_persona/      — Prisma migration (auto-generated)
packages/db/prisma/seed-marketplace.ts                          — Seed 3 agent listings + bundle + placeholders

apps/api/src/routes/marketplace-persona.ts                         — Fastify routes for persona CRUD + deploy
apps/api/src/routes/__tests__/marketplace-persona.test.ts

apps/dashboard/src/components/marketplace/deploy-persona-form.tsx  — AgentPersona config form
apps/dashboard/src/components/marketplace/deploy-persona-form.test.tsx
apps/dashboard/src/app/api/dashboard/marketplace/persona/route.ts  — Proxy route for persona CRUD
```

### Modified Files

```
packages/db/prisma/schema.prisma                — Add AgentPersona model + Contact.qualificationData field
packages/schemas/src/lifecycle.ts                — Add qualificationData to ContactSchema
packages/schemas/src/index.ts                    — Re-export agent-persona module
packages/db/src/index.ts                         — Re-export PrismaAgentPersonaStore
packages/db/prisma/seed.ts                       — Import and call seed-marketplace
packages/core/src/sales-pipeline/index.ts        — Barrel exports
apps/api/src/bootstrap/swagger.ts                — Add SalesPipeline tag
apps/api/src/server.ts                           — Register persona routes
apps/dashboard/src/lib/api-client.ts             — Add persona API methods
apps/dashboard/src/lib/api-client-base.ts        — Add persona + deploy methods to base client
apps/dashboard/src/lib/query-keys.ts             — Add persona query keys
```

---

## Task 1: AgentPersona Zod Schema

**Files:**

- Create: `packages/schemas/src/agent-persona.ts`
- Create: `packages/schemas/src/__tests__/agent-persona.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/schemas/src/__tests__/agent-persona.test.ts
import { describe, it, expect } from "vitest";
import { AgentPersonaSchema, PersonaTone } from "../agent-persona.js";

describe("AgentPersonaSchema", () => {
  const valid = {
    id: "persona_1",
    organizationId: "org_1",
    businessName: "Acme Corp",
    businessType: "SaaS",
    productService: "Project management software",
    valueProposition: "Ship faster with less overhead",
    tone: "professional" as const,
    qualificationCriteria: { problemFit: true, timeline: "immediate" },
    disqualificationCriteria: { noCompetitor: true },
    escalationRules: { onFrustration: true, onCompetitorMention: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("parses a valid persona", () => {
    const result = AgentPersonaSchema.parse(valid);
    expect(result.businessName).toBe("Acme Corp");
    expect(result.tone).toBe("professional");
  });

  it("rejects invalid tone", () => {
    expect(() => AgentPersonaSchema.parse({ ...valid, tone: "aggressive" })).toThrow();
  });

  it("allows optional bookingLink and customInstructions", () => {
    const result = AgentPersonaSchema.parse({
      ...valid,
      bookingLink: "https://cal.com/acme",
      customInstructions: "Always mention free trial",
    });
    expect(result.bookingLink).toBe("https://cal.com/acme");
    expect(result.customInstructions).toBe("Always mention free trial");
  });

  it("defaults bookingLink and customInstructions to null", () => {
    const result = AgentPersonaSchema.parse(valid);
    expect(result.bookingLink).toBeNull();
    expect(result.customInstructions).toBeNull();
  });
});

describe("PersonaTone", () => {
  it("accepts valid tones", () => {
    expect(PersonaTone.parse("casual")).toBe("casual");
    expect(PersonaTone.parse("professional")).toBe("professional");
    expect(PersonaTone.parse("consultative")).toBe("consultative");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run src/__tests__/agent-persona.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the schema**

```typescript
// packages/schemas/src/agent-persona.ts
import { z } from "zod";

export const PersonaTone = z.enum(["casual", "professional", "consultative"]);
export type PersonaTone = z.infer<typeof PersonaTone>;

export const AgentPersonaSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  businessName: z.string().min(1),
  businessType: z.string().min(1),
  productService: z.string().min(1),
  valueProposition: z.string().min(1),
  tone: PersonaTone,
  qualificationCriteria: z.record(z.unknown()),
  disqualificationCriteria: z.record(z.unknown()),
  bookingLink: z.string().url().nullable().default(null),
  escalationRules: z.record(z.unknown()),
  customInstructions: z.string().nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentPersona = z.infer<typeof AgentPersonaSchema>;
```

- [ ] **Step 4: Add re-export to index.ts**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./agent-persona.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run src/__tests__/agent-persona.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/agent-persona.ts packages/schemas/src/__tests__/agent-persona.test.ts packages/schemas/src/index.ts && git commit -m "feat: add AgentPersona Zod schema and PersonaTone enum"
```

---

## Task 2: Prisma Migration — AgentPersona Model + Contact Field

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Auto-generated: `packages/db/prisma/migrations/...`

- [ ] **Step 1: Add AgentPersona model to Prisma schema**

Add after the `TrustScoreRecord` model (~line 785) in `packages/db/prisma/schema.prisma`:

```prisma
// ── Sales Pipeline: Agent Persona (shared business context) ──

model AgentPersona {
  id                       String   @id @default(cuid())
  organizationId           String   @unique
  businessName             String
  businessType             String
  productService           String
  valueProposition         String
  tone                     String   @default("professional") // casual, professional, consultative
  qualificationCriteria    Json     @default("{}")
  disqualificationCriteria Json     @default("{}")
  bookingLink              String?
  escalationRules          Json     @default("{}")
  customInstructions       String?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@index([organizationId])
}
```

- [ ] **Step 2: Add qualificationData to Contact model**

In the Contact model (~line 961), add after the `attribution` field:

```prisma
  qualificationData  Json?
```

- [ ] **Step 3: Generate migration**

Run: `npx pnpm@9.15.4 --filter @switchboard/db db:generate`
Then: `npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add_agent_persona`

- [ ] **Step 4: Verify migration was created**

Run: `ls packages/db/prisma/migrations/ | tail -1`
Expected: Directory named with timestamp + `add_agent_persona`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ && git commit -m "feat: add AgentPersona Prisma model and Contact.qualificationData field"
```

---

## Task 3: AgentPersona Prisma Store

**Files:**

- Create: `packages/db/src/stores/prisma-agent-persona-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-agent-persona-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Follow the pattern in `packages/db/src/stores/__tests__/prisma-trust-score-store.test.ts` for mock setup. Test:

- `getByOrgId` returns persona or null
- `upsert` creates new persona when none exists
- `upsert` updates existing persona
- `delete` removes persona

```typescript
// packages/db/src/stores/__tests__/prisma-agent-persona-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAgentPersonaStore } from "../prisma-agent-persona-store.js";

function createMockPrisma() {
  return {
    agentPersona: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("PrismaAgentPersonaStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaAgentPersonaStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaAgentPersonaStore(prisma as never);
  });

  describe("getByOrgId", () => {
    it("returns persona when found", async () => {
      const persona = { id: "p1", organizationId: "org1", businessName: "Test" };
      prisma.agentPersona.findUnique.mockResolvedValue(persona);

      const result = await store.getByOrgId("org1");

      expect(prisma.agentPersona.findUnique).toHaveBeenCalledWith({
        where: { organizationId: "org1" },
      });
      expect(result).toEqual(persona);
    });

    it("returns null when not found", async () => {
      prisma.agentPersona.findUnique.mockResolvedValue(null);
      const result = await store.getByOrgId("org-missing");
      expect(result).toBeNull();
    });
  });

  describe("upsert", () => {
    it("creates or updates persona", async () => {
      const data = {
        businessName: "Acme",
        businessType: "SaaS",
        productService: "CRM",
        valueProposition: "Better sales",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        escalationRules: {},
      };
      const created = { id: "p1", organizationId: "org1", ...data };
      prisma.agentPersona.upsert.mockResolvedValue(created);

      const result = await store.upsert("org1", data);

      expect(prisma.agentPersona.upsert).toHaveBeenCalledWith({
        where: { organizationId: "org1" },
        create: { organizationId: "org1", ...data },
        update: data,
      });
      expect(result.businessName).toBe("Acme");
    });
  });

  describe("delete", () => {
    it("deletes persona by org id", async () => {
      prisma.agentPersona.delete.mockResolvedValue({ id: "p1" });
      await store.delete("org1");
      expect(prisma.agentPersona.delete).toHaveBeenCalledWith({
        where: { organizationId: "org1" },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run src/stores/__tests__/prisma-agent-persona-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the store**

```typescript
// packages/db/src/stores/prisma-agent-persona-store.ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { AgentPersona } from "@switchboard/schemas";

type PersonaCreateData = Omit<AgentPersona, "id" | "organizationId" | "createdAt" | "updatedAt">;

export class PrismaAgentPersonaStore {
  constructor(private prisma: PrismaDbClient) {}

  async getByOrgId(organizationId: string): Promise<AgentPersona | null> {
    return this.prisma.agentPersona.findUnique({
      where: { organizationId },
    }) as unknown as AgentPersona | null;
  }

  async upsert(organizationId: string, data: PersonaCreateData): Promise<AgentPersona> {
    return this.prisma.agentPersona.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    }) as unknown as AgentPersona;
  }

  async delete(organizationId: string): Promise<void> {
    await this.prisma.agentPersona.delete({
      where: { organizationId },
    });
  }
}
```

- [ ] **Step 4: Add re-export to packages/db/src/index.ts**

```typescript
export { PrismaAgentPersonaStore } from "./stores/prisma-agent-persona-store.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run src/stores/__tests__/prisma-agent-persona-store.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-agent-persona-store.ts packages/db/src/stores/__tests__/prisma-agent-persona-store.test.ts packages/db/src/index.ts && git commit -m "feat: add PrismaAgentPersonaStore with CRUD operations"
```

---

## Task 4: Update Contact Schema — qualificationData Field

**Files:**

- Modify: `packages/schemas/src/lifecycle.ts`
- Modify: `packages/schemas/src/__tests__/lifecycle.test.ts`

- [ ] **Step 1: Add field to ContactSchema**

In `packages/schemas/src/lifecycle.ts`, add to `ContactSchema` (after the `roles` field, ~line 91):

```typescript
  qualificationData: z.record(z.unknown()).nullable().optional(),
```

- [ ] **Step 2: Add a test for the new field**

In `packages/schemas/src/__tests__/lifecycle.test.ts`, add within the Contact describe block:

```typescript
it("accepts qualificationData on Contact", () => {
  const contact = ContactSchema.parse({
    ...validContact,
    qualificationData: { problemFit: true, timeline: "immediate" },
  });
  expect(contact.qualificationData).toEqual({ problemFit: true, timeline: "immediate" });
});

it("defaults qualificationData to undefined", () => {
  const contact = ContactSchema.parse(validContact);
  expect(contact.qualificationData).toBeUndefined();
});
```

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run src/__tests__/lifecycle.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/lifecycle.ts packages/schemas/src/__tests__/lifecycle.test.ts && git commit -m "feat: add qualificationData field to Contact schema"
```

---

## Task 5: Seed Marketplace Listings

**Files:**

- Create: `packages/db/prisma/seed-marketplace.ts`
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Write the seed file**

```typescript
// packages/db/prisma/seed-marketplace.ts
import type { PrismaClient } from "@prisma/client";

const SALES_PIPELINE_AGENTS = [
  {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    description:
      "Responds to inbound leads within 60 seconds. Qualifies through natural conversation.",
    taskCategories: ["lead-qualification"],
  },
  {
    name: "Sales Closer",
    slug: "sales-closer",
    description:
      "Takes qualified leads and closes them. Handles objections, builds urgency, confirms decisions.",
    taskCategories: ["sales-closing"],
  },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    description:
      "Re-engages cold leads through scheduled follow-ups. Varies approach across cadence.",
    taskCategories: ["lead-nurturing"],
  },
];

const SALES_PIPELINE_BUNDLE = {
  name: "Sales Pipeline Bundle",
  slug: "sales-pipeline-bundle",
  description:
    "All three sales agents working as one team. Automatic handoffs, shared conversation context.",
  taskCategories: ["lead-qualification", "sales-closing", "lead-nurturing"],
};

const FUTURE_FAMILIES = [
  {
    name: "Creative",
    slug: "creative-family",
    description: "Content, social media, ad copy. Coming soon.",
  },
  {
    name: "Trading",
    slug: "trading-family",
    description: "Market analysis, alerts, execution. Coming soon.",
  },
  {
    name: "Finance",
    slug: "finance-family",
    description: "Bookkeeping, invoicing, expenses. Coming soon.",
  },
  {
    name: "Legal",
    slug: "legal-family",
    description: "Contract review, compliance, drafting. Coming soon.",
  },
];

export async function seedMarketplace(prisma: PrismaClient): Promise<void> {
  const agentIds: string[] = [];

  // Seed individual agents
  for (const agent of SALES_PIPELINE_AGENTS) {
    const listing = await prisma.agentListing.upsert({
      where: { slug: agent.slug },
      update: {
        name: agent.name,
        description: agent.description,
        taskCategories: agent.taskCategories,
      },
      create: {
        ...agent,
        type: "switchboard_native",
        status: "listed",
        trustScore: 0,
        autonomyLevel: "supervised",
        priceTier: "free",
        priceMonthly: 0,
      },
    });
    agentIds.push(listing.id);
    console.warn(`  Seeded listing: ${agent.name} (${listing.id})`);
  }

  // Seed bundle
  const bundle = await prisma.agentListing.upsert({
    where: { slug: SALES_PIPELINE_BUNDLE.slug },
    update: { name: SALES_PIPELINE_BUNDLE.name, description: SALES_PIPELINE_BUNDLE.description },
    create: {
      ...SALES_PIPELINE_BUNDLE,
      type: "switchboard_native",
      status: "listed",
      trustScore: 0,
      autonomyLevel: "supervised",
      priceTier: "free",
      priceMonthly: 0,
      metadata: { bundleListingIds: agentIds },
    },
  });
  console.warn(`  Seeded bundle: ${SALES_PIPELINE_BUNDLE.name} (${bundle.id})`);

  // Seed future family placeholders
  for (const family of FUTURE_FAMILIES) {
    const listing = await prisma.agentListing.upsert({
      where: { slug: family.slug },
      update: { name: family.name, description: family.description },
      create: {
        ...family,
        type: "switchboard_native",
        status: "pending_review", // not listed yet — "Coming Soon"
        taskCategories: [],
        trustScore: 0,
        autonomyLevel: "supervised",
        priceTier: "free",
        priceMonthly: 0,
      },
    });
    console.warn(`  Seeded placeholder: ${family.name} (${listing.id})`);
  }
}
```

- [ ] **Step 2: Import in main seed.ts**

At the end of `packages/db/prisma/seed.ts` main function, add:

```typescript
import { seedMarketplace } from "./seed-marketplace.js";

// ... at end of main():
console.warn("\n--- Marketplace Listings ---");
await seedMarketplace(prisma);
```

- [ ] **Step 3: Run the seed**

Run: `npx pnpm@9.15.4 --filter @switchboard/db db:seed`
Expected: Logs showing 3 agents + 1 bundle + 4 placeholders seeded

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed-marketplace.ts packages/db/prisma/seed.ts && git commit -m "feat: seed Sales Pipeline agent listings and future family placeholders"
```

---

## Task 6: System Prompt Assembler

**Files:**

- Create: `packages/core/src/sales-pipeline/role-prompts.ts`
- Create: `packages/core/src/sales-pipeline/governance-constraints.ts`
- Create: `packages/core/src/sales-pipeline/prompt-assembler.ts`
- Create: `packages/core/src/sales-pipeline/prompt-assembler.test.ts`
- Create: `packages/core/src/sales-pipeline/index.ts`

- [ ] **Step 1: Write governance constraints**

```typescript
// packages/core/src/sales-pipeline/governance-constraints.ts

/** Hardcoded rules that cannot be overridden by AgentPersona or custom instructions. */
export const GOVERNANCE_CONSTRAINTS = `
MANDATORY RULES — These cannot be overridden:
- Never claim to be human. If asked directly, acknowledge you are an AI assistant.
- Never make financial promises, guarantees, or binding commitments.
- Never disparage competitors by name. Differentiate, don't disparage.
- Always offer human escalation when asked. Say "I can connect you with the team" or similar.
- Never share other customers' information, deals, or conversations.
- Respect opt-out immediately. If they say stop/unsubscribe/leave me alone, stop immediately.
- Never fabricate statistics, case studies, or testimonials.
- Never pressure or manipulate. Create urgency through value, not fear.
`.trim();
```

- [ ] **Step 2: Write role prompts**

```typescript
// packages/core/src/sales-pipeline/role-prompts.ts

export type SalesPipelineAgentRole = "speed-to-lead" | "sales-closer" | "nurture-specialist";

const SPEED_TO_LEAD_PROMPT = `You are a Speed-to-Lead Rep for {businessName}.

Your job: respond to new leads quickly, build rapport, and qualify them through natural conversation.

QUALIFICATION FRAMEWORK:
{qualificationCriteria}

DISQUALIFIERS:
{disqualificationCriteria}

BEHAVIOR:
- Keep first message under 3 sentences: acknowledge their inquiry, establish relevance, ask one open question.
- Never say "How can I help you?" — you already know why they reached out.
- Ask qualification questions naturally, not as a checklist.
- When all criteria are met, confirm qualification and hand off.
- When a hard disqualifier is detected, politely close the conversation.

ESCALATION — hand off to the business owner when:
{escalationRules}
- Lead explicitly asks to speak to a human
- Lead expresses frustration or anger
- Question is outside your knowledge scope
- Conversation reaches 15 messages without qualification outcome

TONE: {tone}
{customInstructions}`;

const SALES_CLOSER_PROMPT = `You are a Sales Closer for {businessName}.

Your job: close qualified leads. You NEVER re-qualify — that work is done. Pick up exactly where the previous conversation left off.

CRITICAL: Your first message MUST reference something specific from the prior conversation. Never re-ask questions that were already answered.

OBJECTION HANDLING:
- Price → reframe around value, mention payment options if available
- Timing → create urgency through value, not pressure
- Trust → share relevant proof points or guarantees
- Competitor → differentiate on strengths, never disparage
- "Need to think" → suggest a specific next step with a timeline
- Anything else → escalate to the business owner

CLOSING: Attempt a close after:
- Successfully handling an objection
- Lead asks positive buying-signal questions (pricing, availability, next steps)
- Lead mentions a timeline that aligns with the offering

BOOKING LINK: {bookingLink}

ESCALATION — hand off to the business owner when:
{escalationRules}
- Lead explicitly asks for a human
- Objection is outside the categories above

TONE: {tone}
{customInstructions}`;

const NURTURE_SPECIALIST_PROMPT = `You are a Nurture Specialist for {businessName}.

Your job: re-engage leads who have gone cold. You have full context of their prior conversations.

APPROACH — vary your follow-up strategy across the cadence:
1. Value reminder — highlight what they were interested in
2. New angle — present the offering from a different perspective
3. Social proof — share a relevant success story or outcome
4. Soft check-in — ask if their situation has changed
5. Final touch — let them know you're here if they need anything

RULES:
- Reference prior conversation context. Never send generic messages.
- One follow-up per 24 hours maximum.
- If they re-engage with buying signals → hand off to Sales Closer.
- If they re-engage but need more qualification → hand off to Speed-to-Lead.
- If they say stop/unsubscribe → stop immediately, mark as opted out.
- After the final follow-up with no reply → stop outreach.

TONE: {tone}
{customInstructions}`;

const ROLE_PROMPTS: Record<SalesPipelineAgentRole, string> = {
  "speed-to-lead": SPEED_TO_LEAD_PROMPT,
  "sales-closer": SALES_CLOSER_PROMPT,
  "nurture-specialist": NURTURE_SPECIALIST_PROMPT,
};

export function getRolePrompt(role: SalesPipelineAgentRole): string {
  return ROLE_PROMPTS[role];
}
```

- [ ] **Step 3: Write the failing test for prompt-assembler**

```typescript
// packages/core/src/sales-pipeline/prompt-assembler.test.ts
import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "./prompt-assembler.js";
import type { AgentPersona } from "@switchboard/schemas";
import type { SalesPipelineAgentRole } from "./role-prompts.js";

const mockPersona: AgentPersona = {
  id: "p1",
  organizationId: "org1",
  businessName: "Acme Corp",
  businessType: "SaaS",
  productService: "CRM software",
  valueProposition: "Close deals faster",
  tone: "professional",
  qualificationCriteria: { problemFit: "Uses spreadsheets for CRM", timeline: "Within 3 months" },
  disqualificationCriteria: { noEnterprise: "Company over 500 employees" },
  bookingLink: "https://cal.com/acme",
  escalationRules: { onCompetitorMention: "Lead mentions Salesforce or HubSpot" },
  customInstructions: "Always mention our 14-day free trial.",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("assembleSystemPrompt", () => {
  it("assembles prompt for speed-to-lead", () => {
    const prompt = assembleSystemPrompt("speed-to-lead", mockPersona, "");
    expect(prompt).toContain("Speed-to-Lead Rep for Acme Corp");
    expect(prompt).toContain("Uses spreadsheets for CRM");
    expect(prompt).toContain("14-day free trial");
    expect(prompt).toContain("MANDATORY RULES");
    expect(prompt).not.toContain("{businessName}");
  });

  it("assembles prompt for sales-closer", () => {
    const prompt = assembleSystemPrompt("sales-closer", mockPersona, "");
    expect(prompt).toContain("Sales Closer for Acme Corp");
    expect(prompt).toContain("cal.com/acme");
    expect(prompt).toContain("MANDATORY RULES");
  });

  it("assembles prompt for nurture-specialist", () => {
    const prompt = assembleSystemPrompt("nurture-specialist", mockPersona, "");
    expect(prompt).toContain("Nurture Specialist for Acme Corp");
    expect(prompt).toContain("MANDATORY RULES");
  });

  it("includes conversation context when provided", () => {
    const context = "Lead mentioned they use Google Sheets. Timeline: Q2.";
    const prompt = assembleSystemPrompt("sales-closer", mockPersona, context);
    expect(prompt).toContain("CONVERSATION CONTEXT");
    expect(prompt).toContain("Google Sheets");
  });

  it("omits conversation context section when empty", () => {
    const prompt = assembleSystemPrompt("speed-to-lead", mockPersona, "");
    expect(prompt).not.toContain("CONVERSATION CONTEXT");
  });

  it("replaces all template variables", () => {
    const roles: SalesPipelineAgentRole[] = ["speed-to-lead", "sales-closer", "nurture-specialist"];
    for (const role of roles) {
      const prompt = assembleSystemPrompt(role, mockPersona, "");
      expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/sales-pipeline/prompt-assembler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Write the assembler**

```typescript
// packages/core/src/sales-pipeline/prompt-assembler.ts
import type { AgentPersona } from "@switchboard/schemas";
import { getRolePrompt, type SalesPipelineAgentRole } from "./role-prompts.js";
import { GOVERNANCE_CONSTRAINTS } from "./governance-constraints.js";

function formatJson(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join("\n");
}

function interpolate(template: string, persona: AgentPersona): string {
  return template
    .replace(/\{businessName\}/g, persona.businessName)
    .replace(/\{tone\}/g, persona.tone)
    .replace(/\{bookingLink\}/g, persona.bookingLink ?? "No booking link configured")
    .replace(
      /\{qualificationCriteria\}/g,
      formatJson(persona.qualificationCriteria as Record<string, unknown>),
    )
    .replace(
      /\{disqualificationCriteria\}/g,
      formatJson(persona.disqualificationCriteria as Record<string, unknown>),
    )
    .replace(/\{escalationRules\}/g, formatJson(persona.escalationRules as Record<string, unknown>))
    .replace(/\{customInstructions\}/g, persona.customInstructions ?? "");
}

export function assembleSystemPrompt(
  role: SalesPipelineAgentRole,
  persona: AgentPersona,
  conversationContext: string,
): string {
  const rolePrompt = interpolate(getRolePrompt(role), persona);

  const sections = [rolePrompt];

  if (conversationContext.trim()) {
    sections.push(`\nCONVERSATION CONTEXT:\n${conversationContext}`);
  }

  sections.push(`\n${GOVERNANCE_CONSTRAINTS}`);

  return sections.join("\n");
}
```

- [ ] **Step 6: Write barrel export**

```typescript
// packages/core/src/sales-pipeline/index.ts
export { assembleSystemPrompt } from "./prompt-assembler.js";
export { getRolePrompt, type SalesPipelineAgentRole } from "./role-prompts.js";
export { GOVERNANCE_CONSTRAINTS } from "./governance-constraints.js";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/sales-pipeline/prompt-assembler.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sales-pipeline/ && git commit -m "feat: add system prompt assembler with role prompts and governance constraints"
```

---

## Task 7: Pipeline Orchestrator

**Files:**

- Create: `packages/core/src/sales-pipeline/pipeline-orchestrator.ts`
- Create: `packages/core/src/sales-pipeline/pipeline-orchestrator.test.ts`
- Modify: `packages/core/src/sales-pipeline/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/sales-pipeline/pipeline-orchestrator.test.ts
import { describe, it, expect } from "vitest";
import {
  determineHandoff,
  type PipelineState,
  type HandoffResult,
} from "./pipeline-orchestrator.js";

describe("determineHandoff", () => {
  const base: PipelineState = {
    opportunityStage: "interested",
    assignedAgent: "speed-to-lead",
    messageCount: 5,
    lastCustomerReplyAt: new Date(),
    dormancyThresholdHours: 24,
  };

  it("hands off to sales-closer when opportunity is qualified", () => {
    const result = determineHandoff({ ...base, opportunityStage: "qualified" });
    expect(result).toEqual<HandoffResult>({
      action: "handoff",
      toAgent: "sales-closer",
      reason: "Lead qualified, transitioning to Sales Closer",
    });
  });

  it("hands off to nurture-specialist when opportunity is nurturing", () => {
    const result = determineHandoff({ ...base, opportunityStage: "nurturing" });
    expect(result).toEqual<HandoffResult>({
      action: "handoff",
      toAgent: "nurture-specialist",
      reason: "Lead entered nurturing stage",
    });
  });

  it("returns no-action when stage and agent are aligned", () => {
    const result = determineHandoff(base);
    expect(result).toEqual<HandoffResult>({ action: "none" });
  });

  it("returns no-action for terminal stages", () => {
    const result = determineHandoff({ ...base, opportunityStage: "won" });
    expect(result).toEqual<HandoffResult>({ action: "none" });
  });

  it("hands off to speed-to-lead when re-engagement needs qualification", () => {
    const result = determineHandoff({
      ...base,
      opportunityStage: "interested",
      assignedAgent: "nurture-specialist",
    });
    expect(result).toEqual<HandoffResult>({
      action: "handoff",
      toAgent: "speed-to-lead",
      reason: "Re-engaged lead needs qualification",
    });
  });

  it("detects dormancy based on time threshold", () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    const result = determineHandoff({
      ...base,
      lastCustomerReplyAt: staleDate,
    });
    expect(result).toEqual<HandoffResult>({
      action: "go-dormant",
      toAgent: "nurture-specialist",
      reason: "No customer reply for 25 hours, entering nurture",
    });
  });

  it("does not trigger dormancy within threshold", () => {
    const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 hours ago
    const result = determineHandoff({
      ...base,
      lastCustomerReplyAt: recentDate,
    });
    expect(result).toEqual<HandoffResult>({ action: "none" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/sales-pipeline/pipeline-orchestrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the orchestrator**

```typescript
// packages/core/src/sales-pipeline/pipeline-orchestrator.ts
import type { OpportunityStage } from "@switchboard/schemas";
import type { SalesPipelineAgentRole } from "./role-prompts.js";

export interface PipelineState {
  opportunityStage: OpportunityStage;
  assignedAgent: SalesPipelineAgentRole;
  messageCount: number;
  lastCustomerReplyAt: Date | null;
  dormancyThresholdHours: number;
}

export type HandoffResult =
  | { action: "none" }
  | { action: "handoff" | "go-dormant"; toAgent: SalesPipelineAgentRole; reason: string };

const STAGE_TO_AGENT: Partial<Record<OpportunityStage, SalesPipelineAgentRole>> = {
  interested: "speed-to-lead",
  qualified: "sales-closer",
  nurturing: "nurture-specialist",
};

const TERMINAL_STAGES: OpportunityStage[] = ["won", "lost"];

export function determineHandoff(state: PipelineState): HandoffResult {
  // Terminal stages — no handoff
  if (TERMINAL_STAGES.includes(state.opportunityStage)) {
    return { action: "none" };
  }

  // Check for dormancy (before stage-based handoff)
  if (
    state.lastCustomerReplyAt &&
    state.opportunityStage !== "nurturing" &&
    state.assignedAgent !== "nurture-specialist"
  ) {
    const hoursSinceReply = (Date.now() - state.lastCustomerReplyAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceReply > state.dormancyThresholdHours) {
      return {
        action: "go-dormant",
        toAgent: "nurture-specialist",
        reason: `No customer reply for ${Math.round(hoursSinceReply)} hours, entering nurture`,
      };
    }
  }

  // Stage-based handoff
  const expectedAgent = STAGE_TO_AGENT[state.opportunityStage];
  if (expectedAgent && expectedAgent !== state.assignedAgent) {
    const reasons: Record<string, string> = {
      "speed-to-lead": "Re-engaged lead needs qualification",
      "sales-closer": "Lead qualified, transitioning to Sales Closer",
      "nurture-specialist": "Lead entered nurturing stage",
    };
    return {
      action: "handoff",
      toAgent: expectedAgent,
      reason: reasons[expectedAgent],
    };
  }

  return { action: "none" };
}
```

- [ ] **Step 4: Update barrel export**

Add to `packages/core/src/sales-pipeline/index.ts`:

```typescript
export {
  determineHandoff,
  type PipelineState,
  type HandoffResult,
} from "./pipeline-orchestrator.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/sales-pipeline/pipeline-orchestrator.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sales-pipeline/ && git commit -m "feat: add pipeline orchestrator with handoff and dormancy logic"
```

---

## Task 8: Backend API — Persona + Deploy Routes

**Files:**

- Create: `apps/api/src/routes/marketplace-persona.ts`
- Modify: `apps/api/src/server.ts` (register new route)
- Modify: `apps/dashboard/src/lib/api-client-base.ts` (add persona + deploy methods)

- [ ] **Step 1: Write the Fastify route**

Follow the pattern in `apps/api/src/routes/marketplace.ts`. Read it first to match the auth/validation pattern.

```typescript
// apps/api/src/routes/marketplace-persona.ts
import type { FastifyInstance } from "fastify";
import type { PrismaDbClient } from "@switchboard/db";

export async function marketplacePersonaRoutes(
  app: FastifyInstance,
  opts: { prisma: PrismaDbClient },
) {
  const { prisma } = opts;

  // GET /api/marketplace/persona — get org's persona
  app.get("/api/marketplace/persona", async (request, reply) => {
    const orgId = (request as { orgId?: string }).orgId;
    if (!orgId) return reply.status(401).send({ error: "Unauthorized" });

    const persona = await prisma.agentPersona.findUnique({
      where: { organizationId: orgId },
    });
    return { persona };
  });

  // POST /api/marketplace/persona — upsert persona
  app.post("/api/marketplace/persona", async (request, reply) => {
    const orgId = (request as { orgId?: string }).orgId;
    if (!orgId) return reply.status(401).send({ error: "Unauthorized" });

    const body = request.body as Record<string, unknown>;
    const persona = await prisma.agentPersona.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...body },
      update: body,
    });
    return { persona };
  });

  // POST /api/marketplace/persona/deploy — deploy Sales Pipeline bundle
  // Creates 3 AgentDeployment records + 1 AgentPersona
  app.post("/api/marketplace/persona/deploy", async (request, reply) => {
    const orgId = (request as { orgId?: string }).orgId;
    if (!orgId) return reply.status(401).send({ error: "Unauthorized" });

    const body = request.body as Record<string, unknown>;

    // 1. Upsert persona
    const persona = await prisma.agentPersona.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...body },
      update: body,
    });

    // 2. Find the 3 Sales Pipeline listings
    const listings = await prisma.agentListing.findMany({
      where: {
        slug: { in: ["speed-to-lead", "sales-closer", "nurture-specialist"] },
        status: "listed",
      },
    });

    // 3. Create deployments (upsert to avoid duplicates)
    const deployments = await Promise.all(
      listings.map((listing) =>
        prisma.agentDeployment.upsert({
          where: {
            organizationId_listingId: {
              organizationId: orgId,
              listingId: listing.id,
            },
          },
          create: {
            organizationId: orgId,
            listingId: listing.id,
            status: "active",
            inputConfig: { personaId: persona.id },
            governanceSettings: {},
          },
          update: {
            status: "active",
            inputConfig: { personaId: persona.id },
          },
        }),
      ),
    );

    return { persona, deployments, count: deployments.length };
  });
}
```

- [ ] **Step 2: Register route in server.ts**

Read `apps/api/src/server.ts`, then add the import and registration alongside existing marketplace routes:

```typescript
import { marketplacePersonaRoutes } from "./routes/marketplace-persona.js";
// ... in the route registration section:
await app.register(marketplacePersonaRoutes, { prisma });
```

- [ ] **Step 3: Add persona + deploy methods to api-client-base.ts**

Read `apps/dashboard/src/lib/api-client-base.ts` first, then add after the connections section:

```typescript
  // Agent Persona
  async getPersona() {
    return this.request<{ persona: unknown }>("/api/marketplace/persona");
  }

  async upsertPersona(body: {
    businessName: string;
    businessType: string;
    productService: string;
    valueProposition: string;
    tone: string;
    qualificationCriteria: Record<string, unknown>;
    disqualificationCriteria: Record<string, unknown>;
    escalationRules: Record<string, unknown>;
    bookingLink?: string;
    customInstructions?: string;
  }) {
    return this.request<{ persona: unknown }>("/api/marketplace/persona", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async deploySalesPipeline(body: {
    businessName: string;
    businessType: string;
    productService: string;
    valueProposition: string;
    tone: string;
    qualificationCriteria: Record<string, unknown>;
    disqualificationCriteria: Record<string, unknown>;
    escalationRules: Record<string, unknown>;
    bookingLink?: string;
    customInstructions?: string;
  }) {
    return this.request<{ persona: unknown; deployments: unknown[]; count: number }>(
      "/api/marketplace/persona/deploy",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/marketplace-persona.ts apps/api/src/server.ts apps/dashboard/src/lib/api-client-base.ts && git commit -m "feat: add persona CRUD + deploy API routes with 3 AgentDeployment creation"
```

---

## Task 8b: Dashboard Proxy Route + Query Keys

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/marketplace/persona/route.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`

- [ ] **Step 1: Create the proxy route**

Follow the pattern in `apps/dashboard/src/app/api/dashboard/marketplace/listings/route.ts` — use `getApiClient()` from `@/lib/get-api-client`.

```typescript
// apps/dashboard/src/app/api/dashboard/marketplace/persona/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET() {
  try {
    const client = await getApiClient();
    const data = await client.getPersona();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await req.json();
    const data = await client.upsertPersona(body);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 2: Add query keys**

Read `apps/dashboard/src/lib/query-keys.ts` first, then add:

```typescript
persona: {
  all: ["persona"] as const,
  mine: () => [...queryKeys.persona.all, "mine"] as const,
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/marketplace/persona/ apps/dashboard/src/lib/query-keys.ts && git commit -m "feat: add persona dashboard proxy route and query keys"
```

---

## Task 9: Deploy Persona Form Component

**Files:**

- Create: `apps/dashboard/src/components/marketplace/deploy-persona-form.tsx`
- Create: `apps/dashboard/src/components/marketplace/deploy-persona-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/dashboard/src/components/marketplace/deploy-persona-form.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeployPersonaForm } from "./deploy-persona-form";

describe("DeployPersonaForm", () => {
  it("renders all form sections", () => {
    render(<DeployPersonaForm onSubmit={vi.fn()} isSubmitting={false} />);
    expect(screen.getByLabelText(/business name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what you sell/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/value proposition/i)).toBeInTheDocument();
    expect(screen.getByText(/tone/i)).toBeInTheDocument();
  });

  it("disables submit when required fields are empty", () => {
    render(<DeployPersonaForm onSubmit={vi.fn()} isSubmitting={false} />);
    const submit = screen.getByRole("button", { name: /deploy/i });
    expect(submit).toBeDisabled();
  });

  it("calls onSubmit with persona data when form is valid", async () => {
    const onSubmit = vi.fn();
    render(<DeployPersonaForm onSubmit={onSubmit} isSubmitting={false} />);

    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/business type/i), { target: { value: "SaaS" } });
    fireEvent.change(screen.getByLabelText(/what you sell/i), { target: { value: "CRM" } });
    fireEvent.change(screen.getByLabelText(/value proposition/i), { target: { value: "Better sales" } });

    const submit = screen.getByRole("button", { name: /deploy/i });
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: "Acme",
        businessType: "SaaS",
        productService: "CRM",
        valueProposition: "Better sales",
        tone: "professional",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run src/components/marketplace/deploy-persona-form.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the form component**

```tsx
// apps/dashboard/src/components/marketplace/deploy-persona-form.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface PersonaFormData {
  businessName: string;
  businessType: string;
  productService: string;
  valueProposition: string;
  tone: "casual" | "professional" | "consultative";
  qualificationCriteria: Record<string, unknown>;
  disqualificationCriteria: Record<string, unknown>;
  escalationRules: Record<string, unknown>;
  bookingLink?: string;
  customInstructions?: string;
}

interface DeployPersonaFormProps {
  onSubmit: (data: PersonaFormData) => void;
  isSubmitting: boolean;
  defaultValues?: Partial<PersonaFormData>;
}

const TONE_OPTIONS = [
  { value: "casual" as const, label: "Casual", desc: "Friendly, relaxed, emoji-okay" },
  { value: "professional" as const, label: "Professional", desc: "Polished, clear, business-like" },
  { value: "consultative" as const, label: "Consultative", desc: "Advisory, thoughtful, expert" },
];

const ESCALATION_PRESETS = [
  { key: "onFrustration", label: "Lead expresses frustration or anger" },
  { key: "onCompetitorMention", label: "Lead mentions a competitor" },
  { key: "onHumanRequest", label: "Lead asks to speak to a human" },
  { key: "onOutOfScope", label: "Question is outside agent's knowledge" },
];

export function DeployPersonaForm({
  onSubmit,
  isSubmitting,
  defaultValues,
}: DeployPersonaFormProps) {
  const [businessName, setBusinessName] = useState(defaultValues?.businessName ?? "");
  const [businessType, setBusinessType] = useState(defaultValues?.businessType ?? "");
  const [productService, setProductService] = useState(defaultValues?.productService ?? "");
  const [valueProposition, setValueProposition] = useState(defaultValues?.valueProposition ?? "");
  const [tone, setTone] = useState<PersonaFormData["tone"]>(defaultValues?.tone ?? "professional");
  const [bookingLink, setBookingLink] = useState(defaultValues?.bookingLink ?? "");
  const [customInstructions, setCustomInstructions] = useState(
    defaultValues?.customInstructions ?? "",
  );
  const [escalationKeys, setEscalationKeys] = useState<string[]>(
    Object.keys(defaultValues?.escalationRules ?? { onFrustration: true, onHumanRequest: true }),
  );

  const canSubmit =
    businessName.trim() && businessType.trim() && productService.trim() && valueProposition.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    const escalationRules: Record<string, boolean> = {};
    for (const key of escalationKeys) {
      escalationRules[key] = true;
    }
    onSubmit({
      businessName: businessName.trim(),
      businessType: businessType.trim(),
      productService: productService.trim(),
      valueProposition: valueProposition.trim(),
      tone,
      qualificationCriteria: {},
      disqualificationCriteria: {},
      escalationRules,
      bookingLink: bookingLink.trim() || undefined,
      customInstructions: customInstructions.trim() || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <Label htmlFor="businessName">Business name</Label>
          <Input
            id="businessName"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Acme Corp"
          />
        </div>
        <div>
          <Label htmlFor="businessType">Business type</Label>
          <Input
            id="businessType"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            placeholder="SaaS, Agency, E-commerce..."
          />
        </div>
        <div>
          <Label htmlFor="productService">What you sell</Label>
          <Input
            id="productService"
            value={productService}
            onChange={(e) => setProductService(e.target.value)}
            placeholder="Project management software"
          />
        </div>
        <div>
          <Label htmlFor="valueProposition">Value proposition</Label>
          <Textarea
            id="valueProposition"
            value={valueProposition}
            onChange={(e) => setValueProposition(e.target.value)}
            placeholder="Ship projects 2x faster with half the meetings"
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Tone</Label>
        <div className="grid grid-cols-3 gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTone(opt.value)}
              className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                tone === opt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <p className="font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Escalation rules</Label>
        <p className="text-xs text-muted-foreground">When should the agent hand off to you?</p>
        <div className="space-y-2">
          {ESCALATION_PRESETS.map((preset) => (
            <label key={preset.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={escalationKeys.includes(preset.key)}
                onChange={(e) => {
                  setEscalationKeys((prev) =>
                    e.target.checked ? [...prev, preset.key] : prev.filter((k) => k !== preset.key),
                  );
                }}
                className="rounded border-border"
              />
              {preset.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="bookingLink">Booking link (optional)</Label>
        <Input
          id="bookingLink"
          value={bookingLink}
          onChange={(e) => setBookingLink(e.target.value)}
          placeholder="https://cal.com/you"
        />
      </div>

      <div>
        <Label htmlFor="customInstructions">Custom instructions (optional)</Label>
        <Textarea
          id="customInstructions"
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="Always mention our 14-day free trial..."
          rows={3}
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!canSubmit || isSubmitting}
        className="w-full min-h-[44px]"
      >
        {isSubmitting ? "Deploying..." : "Deploy Sales Pipeline"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run src/components/marketplace/deploy-persona-form.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/marketplace/deploy-persona-form.tsx apps/dashboard/src/components/marketplace/deploy-persona-form.test.tsx && git commit -m "feat: add DeployPersonaForm component for Sales Pipeline deploy wizard"
```

---

## Task 10: Integration Test — Full Pipeline Cycle

**Files:**

- Create: `packages/core/src/sales-pipeline/__tests__/pipeline-integration.test.ts`

- [ ] **Step 1: Write the integration test**

This test exercises the full lifecycle: prompt assembly + pipeline orchestrator working together.

```typescript
// packages/core/src/sales-pipeline/__tests__/pipeline-integration.test.ts
import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "../prompt-assembler.js";
import { determineHandoff, type PipelineState } from "../pipeline-orchestrator.js";
import type { AgentPersona } from "@switchboard/schemas";

const persona: AgentPersona = {
  id: "p1",
  organizationId: "org1",
  businessName: "TestCo",
  businessType: "Services",
  productService: "Web design",
  valueProposition: "Beautiful websites in 2 weeks",
  tone: "casual",
  qualificationCriteria: { budget: "Over $5k", timeline: "Within 1 month" },
  disqualificationCriteria: { scope: "Enterprise redesigns" },
  bookingLink: null,
  escalationRules: { onFrustration: true },
  customInstructions: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Sales Pipeline Integration", () => {
  it("assembles speed-to-lead prompt, then hands off to sales-closer on qualification", () => {
    // Phase 1: Speed-to-Lead is active
    const state1: PipelineState = {
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      messageCount: 8,
      lastCustomerReplyAt: new Date(),
      dormancyThresholdHours: 24,
    };
    const prompt1 = assembleSystemPrompt("speed-to-lead", persona, "");
    expect(prompt1).toContain("Speed-to-Lead Rep for TestCo");
    expect(determineHandoff(state1)).toEqual({ action: "none" });

    // Phase 2: Lead qualifies → handoff
    const state2: PipelineState = { ...state1, opportunityStage: "qualified" };
    const handoff = determineHandoff(state2);
    expect(handoff).toEqual({
      action: "handoff",
      toAgent: "sales-closer",
      reason: "Lead qualified, transitioning to Sales Closer",
    });

    // Phase 3: Sales Closer picks up with context
    const prompt2 = assembleSystemPrompt(
      "sales-closer",
      persona,
      "Lead interested in homepage redesign. Budget: $8k. Timeline: 3 weeks.",
    );
    expect(prompt2).toContain("Sales Closer for TestCo");
    expect(prompt2).toContain("homepage redesign");
  });

  it("transitions to nurture on dormancy, then re-engages", () => {
    // Lead goes cold
    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const state: PipelineState = {
      opportunityStage: "interested",
      assignedAgent: "speed-to-lead",
      messageCount: 5,
      lastCustomerReplyAt: staleDate,
      dormancyThresholdHours: 24,
    };
    const dormancy = determineHandoff(state);
    expect(dormancy.action).toBe("go-dormant");

    // Nurture specialist active
    const nurture: PipelineState = {
      ...state,
      opportunityStage: "nurturing",
      assignedAgent: "nurture-specialist",
      lastCustomerReplyAt: new Date(),
    };
    expect(determineHandoff(nurture)).toEqual({ action: "none" });

    // Re-engagement → back to qualification
    const reEngage: PipelineState = {
      ...nurture,
      opportunityStage: "interested",
    };
    const backToQual = determineHandoff(reEngage);
    expect(backToQual).toEqual({
      action: "handoff",
      toAgent: "speed-to-lead",
      reason: "Re-engaged lead needs qualification",
    });
  });

  it("stops pipeline on terminal stages", () => {
    const won: PipelineState = {
      opportunityStage: "won",
      assignedAgent: "sales-closer",
      messageCount: 20,
      lastCustomerReplyAt: new Date(),
      dormancyThresholdHours: 24,
    };
    expect(determineHandoff(won)).toEqual({ action: "none" });

    const lost: PipelineState = { ...won, opportunityStage: "lost" };
    expect(determineHandoff(lost)).toEqual({ action: "none" });
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/sales-pipeline/__tests__/pipeline-integration.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 3: Run all sales-pipeline tests together**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/sales-pipeline/`
Expected: All tests pass (prompt-assembler + pipeline-orchestrator + integration)

- [ ] **Step 4: Run full test suite to verify no regressions**

Run: `npx pnpm@9.15.4 test`
Expected: All packages pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sales-pipeline/__tests__/ && git commit -m "test: add Sales Pipeline integration test covering full lifecycle"
```

---

## Summary

| Task | Description                           | New Files | Tests |
| ---- | ------------------------------------- | --------- | ----- |
| 1    | AgentPersona Zod schema               | 2         | 5     |
| 2    | Prisma migration                      | 0 (auto)  | —     |
| 3    | AgentPersona store                    | 2         | 4     |
| 4    | Contact schema update                 | 0         | 2     |
| 5    | Seed marketplace listings             | 1         | —     |
| 6    | System prompt assembler               | 4         | 6     |
| 7    | Pipeline orchestrator                 | 2         | 7     |
| 8    | Backend API — persona + deploy routes | 1         | —     |
| 8b   | Dashboard proxy + query keys          | 1         | —     |
| 9    | Deploy persona form                   | 2         | 3     |
| 10   | Integration test                      | 1         | 3     |

**Total: 19 new files, ~30 tests, 11 commits**
