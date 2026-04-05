# Marketplace Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the marketing landing page with a live marketplace browse experience where visitors see AI agents with real trust scores, task completion data, and can deploy them.

**Architecture:** Public pages (`/`, `/agents/[slug]`) are Next.js Server Components that fetch demo data directly from Prisma via `getDb()`. The deploy flow (`/deploy/[slug]`) is an auth-gated client component using existing persona/deploy APIs. All marketplace content comes from a demo organization seeded with pre-generated conversation fixtures.

**Tech Stack:** Next.js 15 Server Components, Prisma (direct via `@switchboard/db`), Recharts, TailwindCSS, shadcn/ui (Radix primitives), `@anthropic-ai/sdk`

**Spec:** `docs/superpowers/specs/2026-04-05-marketplace-landing-design.md`

**Conventions:**

- Next.js dashboard uses **extensionless imports** (`.js` breaks webpack)
- All other packages use `.js` extensions per ESM
- Tests use vitest + `@testing-library/react` with `@testing-library/jest-dom/vitest` matchers
- Stub `IntersectionObserver` in tests if component uses scroll-triggered animations
- Use `pnpm` commands (on this machine: `npx pnpm@9.15.4`)
- No `console.log` — use `console.warn` or `console.error`
- No `any` — use proper types or `unknown`

---

## File Structure

### New Files

```
packages/db/prisma/fixtures/demo-conversations.ts     — pre-generated conversation transcripts
apps/dashboard/src/lib/demo-data.ts                    — server-side data fetching for public pages
apps/dashboard/src/app/(public)/loading.tsx             — skeleton for marketplace landing
apps/dashboard/src/app/(public)/agents/[slug]/page.tsx  — agent profile page
apps/dashboard/src/app/(public)/agents/[slug]/loading.tsx — skeleton for agent profile
apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx    — deploy flow page
apps/dashboard/src/app/(auth)/deploy/[slug]/actions.ts  — server actions (website scan)
apps/dashboard/src/app/api/dashboard/marketplace/persona/deploy/route.ts — proxy route
apps/dashboard/src/components/marketplace/trust-bar.tsx
apps/dashboard/src/components/marketplace/__tests__/trust-bar.test.tsx
apps/dashboard/src/components/landing/category-tabs.tsx
apps/dashboard/src/components/landing/__tests__/category-tabs.test.tsx
apps/dashboard/src/components/landing/coming-soon-family.tsx
apps/dashboard/src/components/landing/team-bundle-card.tsx
apps/dashboard/src/components/landing/__tests__/team-bundle-card.test.tsx
apps/dashboard/src/components/landing/agent-marketplace-card.tsx
apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx
apps/dashboard/src/components/marketplace/agent-profile-header.tsx
apps/dashboard/src/components/marketplace/work-log-list.tsx
apps/dashboard/src/components/marketplace/__tests__/work-log-list.test.tsx
apps/dashboard/src/components/marketplace/conversation-transcript.tsx
apps/dashboard/src/components/marketplace/trust-history-chart.tsx
apps/dashboard/src/components/marketplace/deploy-wizard.tsx
apps/dashboard/src/app/(public)/agents/[slug]/profile-tabs.tsx — client-side profile tab switcher
```

### Modified Files

```
packages/db/prisma/seed-marketplace.ts        — add metadata fields + demo data seeding
apps/dashboard/src/app/(public)/page.tsx      — replace with marketplace browse
apps/dashboard/src/app/(public)/layout.tsx    — update OpenGraph metadata
```

### Removed Files (Task 12)

```
# Old landing page components
apps/dashboard/src/components/landing/hero-section.tsx
apps/dashboard/src/components/landing/timeline-section.tsx
apps/dashboard/src/components/landing/stats-section.tsx
apps/dashboard/src/components/landing/stat-card.tsx
apps/dashboard/src/components/landing/trust-section.tsx
apps/dashboard/src/components/landing/trust-card.tsx
apps/dashboard/src/components/landing/__tests__/hero-section.test.tsx
apps/dashboard/src/components/landing/__tests__/timeline-section.test.tsx
apps/dashboard/src/components/landing/__tests__/stats-section.test.tsx
apps/dashboard/src/components/landing/__tests__/trust-section.test.tsx

# Old deploy wizard (replaced by /deploy/[slug])
apps/dashboard/src/app/(auth)/marketplace/[id]/deploy/page.tsx
apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx
apps/dashboard/src/components/marketplace/deploy-step-config.tsx
apps/dashboard/src/components/marketplace/deploy-step-connect.tsx
apps/dashboard/src/components/marketplace/deploy-step-governance.tsx
```

---

### Task 1: Update Seed Metadata

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts`

Add `metadata.isBundle`, `metadata.family` to bundle/family listings and `metadata.bundleSlug` to individual Sales agents, per spec requirements.

- [ ] **Step 1: Add metadata to SALES_PIPELINE_AGENTS**

In `packages/db/prisma/seed-marketplace.ts`, add a `metadata` field to each agent in the `SALES_PIPELINE_AGENTS` array:

```ts
const SALES_PIPELINE_AGENTS = [
  {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    description:
      "Responds to inbound leads within 60 seconds. Qualifies through natural conversation.",
    taskCategories: ["lead-qualification"],
    metadata: { bundleSlug: "sales-pipeline-bundle", roleFocus: "leads" },
  },
  {
    name: "Sales Closer",
    slug: "sales-closer",
    description:
      "Takes qualified leads and closes them. Handles objections, builds urgency, confirms decisions.",
    taskCategories: ["sales-closing"],
    metadata: { bundleSlug: "sales-pipeline-bundle", roleFocus: "growth" },
  },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    description:
      "Re-engages cold leads through scheduled follow-ups. Varies approach across cadence.",
    taskCategories: ["lead-nurturing"],
    metadata: { bundleSlug: "sales-pipeline-bundle", roleFocus: "care" },
  },
];
```

- [ ] **Step 2: Add metadata to SALES_PIPELINE_BUNDLE**

```ts
const SALES_PIPELINE_BUNDLE = {
  name: "Sales Pipeline Bundle",
  slug: "sales-pipeline-bundle",
  description:
    "All three sales agents working as one team. Automatic handoffs, shared conversation context.",
  taskCategories: ["lead-qualification", "sales-closing", "lead-nurturing"],
  metadata: { isBundle: true, family: "sales" },
};
```

Remove the inline `metadata: { bundleListingIds: agentIds }` from the `create` block (line 95) since `bundleListingIds` will be set in the update block instead. Update the bundle upsert:

```ts
const bundle = await prisma.agentListing.upsert({
  where: { slug: SALES_PIPELINE_BUNDLE.slug },
  update: {
    name: SALES_PIPELINE_BUNDLE.name,
    description: SALES_PIPELINE_BUNDLE.description,
    metadata: { ...SALES_PIPELINE_BUNDLE.metadata, bundleListingIds: agentIds },
  },
  create: {
    ...SALES_PIPELINE_BUNDLE,
    type: "switchboard_native",
    status: "listed",
    trustScore: 0,
    autonomyLevel: "supervised",
    priceTier: "free",
    priceMonthly: 0,
    metadata: { ...SALES_PIPELINE_BUNDLE.metadata, bundleListingIds: agentIds },
  },
});
```

- [ ] **Step 3: Add metadata to FUTURE_FAMILIES**

```ts
const FUTURE_FAMILIES = [
  {
    name: "Creative",
    slug: "creative-family",
    description: "Content, social media, ad copy. Coming soon.",
    metadata: { isBundle: true, family: "creative" },
  },
  {
    name: "Trading",
    slug: "trading-family",
    description: "Market analysis, alerts, execution. Coming soon.",
    metadata: { isBundle: true, family: "trading" },
  },
  {
    name: "Finance",
    slug: "finance-family",
    description: "Bookkeeping, invoicing, expenses. Coming soon.",
    metadata: { isBundle: true, family: "finance" },
  },
];
```

Remove the "Legal" entry entirely. Update the family upsert to include metadata:

```ts
create: {
  name: family.name,
  slug: family.slug,
  description: family.description,
  type: "switchboard_native",
  status: "pending_review",
  taskCategories: [],
  trustScore: 0,
  autonomyLevel: "supervised",
  priceTier: "free",
  priceMonthly: 0,
  metadata: family.metadata,
},
```

Also pass `metadata` in the `update` block so re-running seed applies it to existing rows.

- [ ] **Step 4: Update individual agent upsert to include metadata**

In the agent loop, pass `metadata` in both `update` and `create`:

```ts
const listing = await prisma.agentListing.upsert({
  where: { slug: agent.slug },
  update: {
    name: agent.name,
    description: agent.description,
    taskCategories: agent.taskCategories,
    metadata: agent.metadata,
  },
  create: {
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    taskCategories: agent.taskCategories,
    metadata: agent.metadata,
    type: "switchboard_native",
    status: "listed",
    trustScore: 0,
    autonomyLevel: "supervised",
    priceTier: "free",
    priceMonthly: 0,
  },
});
```

- [ ] **Step 5: Run seed and verify**

Run: `pnpm db:seed`

Verify the metadata is set correctly:

```bash
pnpm db:seed 2>&1 | grep -i "seeded"
```

Expected: Listings seeded with metadata containing `family`, `isBundle`, `bundleSlug`, `roleFocus` as appropriate. No "Legal" entry.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(db): add marketplace metadata to seed listings

Add isBundle/family to bundle and family listings, bundleSlug/roleFocus
to individual agents. Remove Legal family placeholder."
```

---

### Task 2: Demo Data Fixtures

**Files:**

- Create: `packages/db/prisma/fixtures/demo-conversations.ts`

Pre-generated conversation transcripts for 3 agents across varied scenarios. Each follows the `TaskOutput` shape from the spec.

- [ ] **Step 1: Create the fixtures file**

Create `packages/db/prisma/fixtures/demo-conversations.ts`:

```ts
/**
 * Pre-generated demo conversations for the marketplace landing page.
 * Each conversation follows the TaskOutput shape stored in AgentTask.output.
 */

export interface DemoMessage {
  role: "lead" | "agent";
  text: string;
  /** Minutes offset from task start (used to generate timestamps at seed time) */
  minutesOffset: number;
}

export interface DemoConversation {
  agentSlug: string;
  category: string;
  summary: string;
  outcome: "qualified" | "disqualified" | "booked" | "escalated";
  handoffTo?: string;
  /** "approved" or "rejected" — governs trust score impact */
  reviewStatus: "approved" | "rejected";
  messages: DemoMessage[];
  /** Minutes before "now" when this task was created (for relative timestamps) */
  minutesAgo: number;
}

export const DEMO_CONVERSATIONS: DemoConversation[] = [
  // ─── Speed-to-Lead (lead-qualification) ───────────────────
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Qualified lead — wedding cakes, $800 budget",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 3,
    messages: [
      {
        role: "lead",
        text: "Hi, I'm looking for a custom wedding cake for about 120 guests. Our wedding is in September.",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "Congratulations on your upcoming wedding! I'd love to help. Could you tell me a bit about what you're envisioning — any flavors or styles you're drawn to?",
        minutesOffset: 0.5,
      },
      {
        role: "lead",
        text: "We're thinking three tiers, vanilla and chocolate layers, with fresh flowers. Budget is around $800.",
        minutesOffset: 2,
      },
      {
        role: "agent",
        text: "That sounds beautiful — three tiers with fresh flowers is one of our most popular styles. $800 is well within range for that size. Let me connect you with our closer who can walk through flavor options and get your date locked in.",
        minutesOffset: 3,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Qualified lead — corporate catering, 50 people",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 47,
    messages: [
      {
        role: "lead",
        text: "We need catering for a corporate retreat next month. About 50 people, mix of dietary needs.",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "Happy to help! What kind of event is it — full-day meals, or more of a lunch/snack setup? And do you have a date in mind?",
        minutesOffset: 0.3,
      },
      {
        role: "lead",
        text: "Full day, March 15th. We need breakfast pastries, lunch, and afternoon snacks. Some vegan and gluten-free options.",
        minutesOffset: 1,
      },
      {
        role: "agent",
        text: "Perfect. We do a lot of corporate catering with mixed dietary accommodations. March 15th is open. I'll hand you off to someone who can put together a custom menu and quote. Just a moment.",
        minutesOffset: 2,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Disqualified — student asking about internships",
    outcome: "disqualified",
    reviewStatus: "approved",
    minutesAgo: 120,
    messages: [
      {
        role: "lead",
        text: "Hi! I'm a culinary student and I was wondering if you offer any internship or apprenticeship programs?",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "Thanks for reaching out! That's a great question. Unfortunately, I handle sales inquiries — but I'd recommend emailing info@austinbakeryco.com directly. The team there can point you to any apprenticeship opportunities.",
        minutesOffset: 0.5,
      },
      { role: "lead", text: "Got it, thanks!", minutesOffset: 1 },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Qualified lead — birthday cake, custom design",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 200,
    messages: [
      {
        role: "lead",
        text: "I need a custom birthday cake for my daughter's 5th birthday. She loves unicorns.",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "How fun! We love doing themed cakes. How many guests are you expecting, and when's the big day?",
        minutesOffset: 0.3,
      },
      {
        role: "lead",
        text: "About 20 kids and parents, party is April 12th. Can you do a unicorn with rainbow layers?",
        minutesOffset: 1,
      },
      {
        role: "agent",
        text: "Absolutely — rainbow layers are a hit. For 20 people a two-tier would be perfect. Let me connect you with someone who can show you our portfolio and lock in your date.",
        minutesOffset: 1.5,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Disqualified — outside service area",
    outcome: "disqualified",
    reviewStatus: "approved",
    minutesAgo: 310,
    messages: [
      { role: "lead", text: "Do you deliver to San Antonio?", minutesOffset: 0 },
      {
        role: "agent",
        text: "Thanks for your interest! Currently we deliver within the Austin metro area. San Antonio is a bit outside our range. If you ever need something for an Austin event, we'd love to help!",
        minutesOffset: 0.5,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Qualified lead — restaurant wholesale inquiry",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 480,
    messages: [
      {
        role: "lead",
        text: "I run a restaurant downtown and I'm looking for a wholesale pastry supplier. Do you do B2B?",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "We do! We supply several restaurants in the Austin area with fresh pastries. What kind of volume and variety are you thinking?",
        minutesOffset: 0.3,
      },
      {
        role: "lead",
        text: "Probably 50-80 pastries per week, rotating selection. Croissants, danishes, muffins mainly.",
        minutesOffset: 1,
      },
      {
        role: "agent",
        text: "That's right in our sweet spot. Let me connect you with someone who can work out pricing tiers and a delivery schedule.",
        minutesOffset: 1.5,
      },
    ],
  },
  {
    agentSlug: "speed-to-lead",
    category: "lead-qualification",
    summary: "Qualified lead — anniversary party",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 600,
    messages: [
      {
        role: "lead",
        text: "Planning a 25th anniversary party for my parents. Need cake and dessert table for 75 people.",
        minutesOffset: 0,
      },
      {
        role: "agent",
        text: "What a milestone! Would you like a traditional tiered cake, or more of a dessert spread? We can do both.",
        minutesOffset: 0.5,
      },
      {
        role: "lead",
        text: "Both! A smaller elegant cake for cutting, plus a dessert table with variety. Budget around $1,200.",
        minutesOffset: 1.5,
      },
      {
        role: "agent",
        text: "That's a lovely setup and $1,200 gives us plenty to work with. Let me hand you to our closer to finalize details.",
        minutesOffset: 2,
      },
    ],
  },

  // ─── Sales Closer (sales-closing) ─────────────────────────
  {
    agentSlug: "sales-closer",
    category: "sales-closing",
    summary: "Booked — wedding cake consultation, $800",
    outcome: "booked",
    reviewStatus: "approved",
    minutesAgo: 15,
    messages: [
      {
        role: "agent",
        text: "Hi! I just got the details from our qualification team. Wedding cake for 120, three tiers, vanilla/chocolate with fresh flowers, ~$800 budget. That all sound right?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "Yes exactly! Can we do a tasting before committing?",
        minutesOffset: 1,
      },
      {
        role: "agent",
        text: "Absolutely — we do complimentary tastings for wedding orders. I have availability this Thursday at 2 PM or Saturday at 10 AM. Which works better?",
        minutesOffset: 1.5,
      },
      { role: "lead", text: "Saturday at 10 works perfectly.", minutesOffset: 2 },
      {
        role: "agent",
        text: "You're booked for Saturday at 10 AM. You'll taste our vanilla bean and Belgian chocolate options, and our decorator will sketch some ideas with fresh flowers. See you then!",
        minutesOffset: 2.5,
      },
    ],
  },
  {
    agentSlug: "sales-closer",
    category: "sales-closing",
    summary: "Booked — corporate catering, March 15",
    outcome: "booked",
    reviewStatus: "approved",
    minutesAgo: 90,
    messages: [
      {
        role: "agent",
        text: "Welcome! I see you need full-day catering for 50 on March 15th — breakfast, lunch, and afternoon snacks with vegan and GF options. Let me walk you through our packages.",
        minutesOffset: 0,
      },
      { role: "lead", text: "Sounds great. What's the price range?", minutesOffset: 0.5 },
      {
        role: "agent",
        text: "For 50 people, full-day catering runs $35-45 per person depending on menu complexity. With the dietary accommodations, I'd estimate around $2,000 total. That includes setup and cleanup.",
        minutesOffset: 1,
      },
      { role: "lead", text: "That works with our budget. Let's go with it.", minutesOffset: 2 },
      {
        role: "agent",
        text: "Excellent! I'll send you a menu selection form and a booking confirmation. You're locked in for March 15th.",
        minutesOffset: 2.5,
      },
    ],
  },
  {
    agentSlug: "sales-closer",
    category: "sales-closing",
    summary: "Escalated — lead wants to negotiate custom pricing",
    outcome: "escalated",
    reviewStatus: "approved",
    minutesAgo: 280,
    messages: [
      {
        role: "agent",
        text: "Hi there! I understand you're looking at a wholesale pastry arrangement — 50-80 per week. Our standard wholesale rate starts at $3.50 per piece.",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "That's a bit high for us. We were paying $2.75 with our previous supplier. Can you match that?",
        minutesOffset: 1,
      },
      {
        role: "agent",
        text: "I appreciate you sharing that. Custom pricing for ongoing wholesale partnerships is something our team handles directly. Let me connect you with someone who has more flexibility there.",
        minutesOffset: 2,
      },
    ],
  },
  {
    agentSlug: "sales-closer",
    category: "sales-closing",
    summary: "Booked — birthday cake, unicorn theme",
    outcome: "booked",
    reviewStatus: "approved",
    minutesAgo: 360,
    messages: [
      {
        role: "agent",
        text: "Hey! I hear we're making a unicorn cake for a 5th birthday — rainbow layers, April 12th, ~20 people. This is going to be adorable.",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "Yes! She's going to love it. How much would this be?",
        minutesOffset: 0.5,
      },
      {
        role: "agent",
        text: "For a two-tier unicorn cake with rainbow layers serving 20, you're looking at $350. That includes a custom fondant unicorn topper.",
        minutesOffset: 1,
      },
      { role: "lead", text: "Perfect, let's do it!", minutesOffset: 1.5 },
      {
        role: "agent",
        text: "Booked! I'll send you a design preview next week. The birthday girl is going to have a magical day.",
        minutesOffset: 2,
      },
    ],
  },

  // ─── Nurture Specialist (lead-nurturing) ──────────────────
  {
    agentSlug: "nurture-specialist",
    category: "lead-nurturing",
    summary: "Re-engaged — holiday season follow-up, converted",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 150,
    messages: [
      {
        role: "agent",
        text: "Hi! You reached out a few weeks ago about catering. With the holiday season coming up, I wanted to check — any events on the horizon we could help with?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "Actually yes — our company holiday party. About 40 people. Totally forgot to book something.",
        minutesOffset: 5,
      },
      {
        role: "agent",
        text: "Great timing then! When's the party? We still have some December dates open.",
        minutesOffset: 6,
      },
      { role: "lead", text: "December 20th, evening event.", minutesOffset: 8 },
      {
        role: "agent",
        text: "Perfect — December 20th is still available. Let me connect you with our closer to get the menu sorted.",
        minutesOffset: 9,
      },
    ],
  },
  {
    agentSlug: "nurture-specialist",
    category: "lead-nurturing",
    summary: "Follow-up — not ready yet, staying warm",
    outcome: "disqualified",
    reviewStatus: "approved",
    minutesAgo: 500,
    messages: [
      {
        role: "agent",
        text: "Hey! Just checking in — you mentioned you were thinking about a dessert table for your sister's bridal shower. Any updates on the planning?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "Not yet, still figuring out the venue. Probably won't need anything for another couple months.",
        minutesOffset: 10,
      },
      {
        role: "agent",
        text: "No rush at all! I'll check back in a few weeks. When you're ready, we'll make it amazing.",
        minutesOffset: 11,
      },
    ],
  },
  {
    agentSlug: "nurture-specialist",
    category: "lead-nurturing",
    summary: "Re-engaged — corporate client returning for Q2 event",
    outcome: "qualified",
    handoffTo: "sales-closer",
    reviewStatus: "approved",
    minutesAgo: 720,
    messages: [
      {
        role: "agent",
        text: "Hi! You used us for your team retreat last quarter and mentioned you'd have a Q2 event too. Starting to plan?",
        minutesOffset: 0,
      },
      {
        role: "lead",
        text: "Yes! April kickoff meeting, same format. Can we do the same menu with a few swaps?",
        minutesOffset: 3,
      },
      {
        role: "agent",
        text: "Absolutely — same great setup with tweaks. Let me connect you with our closer who has your previous order on file.",
        minutesOffset: 4,
      },
    ],
  },
  {
    agentSlug: "nurture-specialist",
    category: "lead-nurturing",
    summary: "Follow-up — lost lead, unresponsive",
    outcome: "disqualified",
    reviewStatus: "rejected",
    minutesAgo: 900,
    messages: [
      {
        role: "agent",
        text: "Hi! Wanted to follow up on the anniversary cake we discussed. Have you had a chance to decide on a date?",
        minutesOffset: 0,
      },
    ],
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm --filter @switchboard/db exec tsc --noEmit`

Expected: No type errors (this file only exports data, no imports from project code).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(db): add pre-generated demo conversation fixtures

15 conversations across 3 agents with varied scenarios (qualified,
disqualified, booked, escalated) for the marketplace landing page."
```

---

### Task 3: Seed Demo Data

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts`

Add `seedDemoData()` function that creates a demo org, deployments, tasks with conversation transcripts, and trust score records.

- [ ] **Step 1: Import fixtures and add seedDemoData function**

At the top of `seed-marketplace.ts`, add:

```ts
import { DEMO_CONVERSATIONS } from "./fixtures/demo-conversations.js";
```

Add after the existing `seedMarketplace` function:

```ts
const DEMO_ORG_ID = "org_demo";

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  // 1. Create demo organization
  const org = await prisma.organizationConfig.upsert({
    where: { id: DEMO_ORG_ID },
    update: {},
    create: {
      id: DEMO_ORG_ID,
      name: "Austin Bakery Co",
      runtimeType: "http",
      governanceProfile: "guarded",
      onboardingComplete: true,
      provisioningStatus: "active",
    },
  });
  console.warn(`  Seeded demo org: ${org.name} (${org.id})`);

  // 2. Create deployments for all 3 Sales Pipeline agents
  const agentSlugs = ["speed-to-lead", "sales-closer", "nurture-specialist"];
  const deploymentMap = new Map<string, string>();

  for (const slug of agentSlugs) {
    const listing = await prisma.agentListing.findUnique({ where: { slug } });
    if (!listing) {
      console.warn(`  Skipping deployment for ${slug} — listing not found`);
      continue;
    }

    const deployment = await prisma.agentDeployment.upsert({
      where: { organizationId_listingId: { organizationId: DEMO_ORG_ID, listingId: listing.id } },
      update: { status: "active" },
      create: {
        organizationId: DEMO_ORG_ID,
        listingId: listing.id,
        status: "active",
        inputConfig: {},
        governanceSettings: { requireApproval: true },
      },
    });
    deploymentMap.set(slug, deployment.id);
    console.warn(`  Seeded deployment: ${slug} (${deployment.id})`);
  }

  // 3. Delete existing demo tasks (clean re-seed)
  await prisma.agentTask.deleteMany({ where: { organizationId: DEMO_ORG_ID } });

  // 4. Create tasks from fixture conversations
  const now = new Date();
  let trustScores: Record<
    string,
    { score: number; approvals: number; rejections: number; streak: number }
  > = {};

  for (const conv of DEMO_CONVERSATIONS) {
    const listing = await prisma.agentListing.findUnique({ where: { slug: conv.agentSlug } });
    const deploymentId = deploymentMap.get(conv.agentSlug);
    if (!listing || !deploymentId) continue;

    const taskCreatedAt = new Date(now.getTime() - conv.minutesAgo * 60_000);
    const lastMessageOffset = Math.max(...conv.messages.map((m) => m.minutesOffset));
    const taskCompletedAt = new Date(taskCreatedAt.getTime() + lastMessageOffset * 60_000);

    // Build output with absolute timestamps
    const output = {
      summary: conv.summary,
      outcome: conv.outcome,
      handoffTo: conv.handoffTo ?? null,
      messages: conv.messages.map((m) => ({
        role: m.role,
        text: m.text,
        timestamp: new Date(taskCreatedAt.getTime() + m.minutesOffset * 60_000).toISOString(),
      })),
    };

    const status = conv.reviewStatus === "approved" ? "approved" : "rejected";

    await prisma.agentTask.create({
      data: {
        deploymentId,
        organizationId: DEMO_ORG_ID,
        listingId: listing.id,
        category: conv.category,
        status,
        input: { source: "demo", scenario: conv.summary },
        output: output as object,
        completedAt: taskCompletedAt,
        reviewedBy: "system",
        reviewedAt: taskCompletedAt,
        createdAt: taskCreatedAt,
        updatedAt: taskCompletedAt,
      },
    });

    // Track trust score progression
    const key = `${listing.id}:${conv.category}`;
    if (!trustScores[key]) {
      trustScores[key] = { score: 0, approvals: 0, rejections: 0, streak: 0 };
    }
    const ts = trustScores[key];
    if (conv.reviewStatus === "approved") {
      ts.approvals++;
      ts.streak++;
      const bonus = Math.min(ts.streak * 0.5, 2);
      ts.score = Math.min(100, Math.max(0, ts.score + 3 + bonus));
    } else {
      ts.rejections++;
      ts.streak = 0;
      ts.score = Math.max(0, ts.score - 10);
    }
  }

  // 5. Create/update trust score records
  for (const [key, ts] of Object.entries(trustScores)) {
    const [listingId, taskCategory] = key.split(":");
    await prisma.trustScoreRecord.upsert({
      where: { listingId_taskCategory: { listingId, taskCategory } },
      update: {
        score: Math.round(ts.score),
        totalApprovals: ts.approvals,
        totalRejections: ts.rejections,
        consecutiveApprovals: ts.streak,
        lastActivityAt: now,
      },
      create: {
        listingId,
        taskCategory,
        score: Math.round(ts.score),
        totalApprovals: ts.approvals,
        totalRejections: ts.rejections,
        consecutiveApprovals: ts.streak,
        lastActivityAt: now,
      },
    });
  }

  // 6. Update listing trust scores (aggregate)
  for (const slug of agentSlugs) {
    const listing = await prisma.agentListing.findUnique({ where: { slug } });
    if (!listing) continue;

    const avgResult = await prisma.trustScoreRecord.aggregate({
      where: { listingId: listing.id },
      _avg: { score: true },
    });
    const avgScore = Math.round(avgResult._avg.score ?? 0);
    const autonomyLevel = avgScore >= 55 ? "autonomous" : avgScore >= 30 ? "guided" : "supervised";

    await prisma.agentListing.update({
      where: { id: listing.id },
      data: { trustScore: avgScore, autonomyLevel },
    });
  }

  console.warn(`  Seeded ${DEMO_CONVERSATIONS.length} demo tasks with trust scores`);
}
```

- [ ] **Step 2: Call seedDemoData from main seed**

Find the main seed entry point (likely `packages/db/prisma/seed.ts` or the script that calls `seedMarketplace`). Add a call to `seedDemoData(prisma)` after `seedMarketplace(prisma)`.

- [ ] **Step 3: Run seed and verify**

Run: `pnpm db:seed`

Verify demo data:

```bash
pnpm db:seed 2>&1 | grep -i "demo"
```

Expected: `Seeded demo org: Austin Bakery Co`, deployment messages, and `Seeded 15 demo tasks with trust scores`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(db): add demo data seeding for marketplace landing

Creates demo org, deployments, 15 tasks with conversation transcripts,
and computed trust scores for public marketplace display."
```

---

### Task 4: Server-Side Data Fetching Module

**Files:**

- Create: `apps/dashboard/src/lib/demo-data.ts`

Server-side functions for fetching marketplace data in public Server Components.

- [ ] **Step 1: Create demo-data.ts**

```ts
import { getDb, PrismaListingStore } from "@switchboard/db";

const DEMO_ORG_ID = "org_demo";

export interface MarketplaceListing {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: string;
  status: string;
  taskCategories: string[];
  trustScore: number;
  autonomyLevel: string;
  priceTier: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DemoTask {
  id: string;
  listingId: string;
  category: string;
  status: string;
  output: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface TrustRecord {
  id: string;
  listingId: string;
  taskCategory: string;
  score: number;
  totalApprovals: number;
  totalRejections: number;
  consecutiveApprovals: number;
  lastActivityAt: Date | null;
}

/** Get all listed agent listings (not bundles) */
export async function getListedAgents(): Promise<MarketplaceListing[]> {
  const db = getDb();
  const listings = await db.agentListing.findMany({
    where: { status: "listed" },
    orderBy: { createdAt: "asc" },
  });
  // Filter out bundles — return only individual agents
  return listings.filter(
    (l) => !(l.metadata as Record<string, unknown> | null)?.isBundle,
  ) as unknown as MarketplaceListing[];
}

/** Get all bundle/family listings for category tabs */
export async function getBundleListings(): Promise<MarketplaceListing[]> {
  const db = getDb();
  const listings = await db.agentListing.findMany({
    where: {
      OR: [{ status: "listed" }, { status: "pending_review" }],
    },
    orderBy: { createdAt: "asc" },
  });
  return listings.filter(
    (l) => (l.metadata as Record<string, unknown> | null)?.isBundle === true,
  ) as unknown as MarketplaceListing[];
}

/** Get a single listing by slug (uses PrismaListingStore.findBySlug per spec) */
export async function getListingBySlug(slug: string): Promise<MarketplaceListing | null> {
  const db = getDb();
  const store = new PrismaListingStore(db);
  return store.findBySlug(slug) as unknown as MarketplaceListing | null;
}

/** Get demo tasks for a specific listing */
export async function getDemoTasks(listingId: string, limit = 20): Promise<DemoTask[]> {
  const db = getDb();
  return db.agentTask.findMany({
    where: { listingId, organizationId: DEMO_ORG_ID },
    orderBy: { createdAt: "desc" },
    take: limit,
  }) as unknown as DemoTask[];
}

/** Get demo task aggregates (today-ish stats) for a listing */
export async function getDemoTaskStats(listingId: string) {
  const db = getDb();
  const tasks = await db.agentTask.findMany({
    where: { listingId, organizationId: DEMO_ORG_ID },
    orderBy: { createdAt: "desc" },
  });

  const total = tasks.length;
  const approved = tasks.filter((t) => t.status === "approved").length;
  const lastTask = tasks[0];

  return {
    totalTasks: total,
    approvedCount: approved,
    approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
    lastActiveAt: lastTask?.updatedAt ?? null,
  };
}

/** Get trust score records for a listing */
export async function getTrustRecords(listingId: string): Promise<TrustRecord[]> {
  const db = getDb();
  return db.trustScoreRecord.findMany({
    where: { listingId },
    orderBy: { score: "desc" },
  }) as unknown as TrustRecord[];
}

/**
 * Compute trust score progression from task history.
 * Returns an array of { timestamp, score } points for the sparkline chart.
 */
export async function getTrustProgression(
  listingId: string,
): Promise<Array<{ timestamp: string; score: number }>> {
  const db = getDb();
  const tasks = await db.agentTask.findMany({
    where: {
      listingId,
      organizationId: DEMO_ORG_ID,
      status: { in: ["approved", "rejected"] },
    },
    orderBy: { completedAt: "asc" },
  });

  const points: Array<{ timestamp: string; score: number }> = [
    { timestamp: tasks[0]?.createdAt?.toISOString() ?? new Date().toISOString(), score: 0 },
  ];

  let score = 0;
  let streak = 0;

  for (const task of tasks) {
    if (task.status === "approved") {
      streak++;
      const bonus = Math.min(streak * 0.5, 2);
      score = Math.min(100, Math.max(0, score + 3 + bonus));
    } else {
      streak = 0;
      score = Math.max(0, score - 10);
    }
    points.push({
      timestamp: (task.completedAt ?? task.updatedAt).toISOString(),
      score: Math.round(score),
    });
  }

  return points;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @switchboard/dashboard exec tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add server-side demo data fetching module

Provides getListedAgents, getBundleListings, getDemoTasks, getDemoTaskStats,
getTrustRecords, and getTrustProgression for public marketplace pages."
```

---

### Task 5: TrustBar Component

**Files:**

- Create: `apps/dashboard/src/components/marketplace/trust-bar.tsx`
- Create: `apps/dashboard/src/components/marketplace/__tests__/trust-bar.test.tsx`

Pixel-segmented trust score bar (8-bit style, 10 segments).

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustBar } from "../trust-bar";

describe("TrustBar", () => {
  it("renders 10 segments with correct fill count", () => {
    const { container } = render(<TrustBar score={47} />);
    const segments = container.querySelectorAll("[data-segment]");
    expect(segments).toHaveLength(10);

    const filled = container.querySelectorAll("[data-filled='true']");
    expect(filled).toHaveLength(5); // 47/100 rounds to 5 of 10
  });

  it("renders score number", () => {
    render(<TrustBar score={47} />);
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("renders delta when provided", () => {
    render(<TrustBar score={47} delta={3} />);
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("renders 0 filled segments for score 0", () => {
    const { container } = render(<TrustBar score={0} />);
    const filled = container.querySelectorAll("[data-filled='true']");
    expect(filled).toHaveLength(0);
  });

  it("renders all segments filled for score 100", () => {
    const { container } = render(<TrustBar score={100} />);
    const filled = container.querySelectorAll("[data-filled='true']");
    expect(filled).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- trust-bar`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement TrustBar**

```tsx
import { cn } from "@/lib/utils";

interface TrustBarProps {
  score: number;
  delta?: number;
  className?: string;
}

export function TrustBar({ score, delta, className }: TrustBarProps) {
  const filledCount = Math.round((score / 100) * 10);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="flex gap-0.5"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Trust score: ${score}`}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            data-segment
            data-filled={i < filledCount}
            className={cn(
              "w-2.5 h-4 border border-border",
              i < filledCount ? "bg-foreground" : "bg-transparent",
            )}
          />
        ))}
      </div>
      <span className="font-mono text-sm font-medium tabular-nums">{score}</span>
      {delta != null && delta !== 0 && (
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            delta > 0 ? "text-positive" : "text-negative",
          )}
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- trust-bar`

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): add TrustBar pixel-segmented component

8-bit style trust score bar with 10 segments, numeric score, and
optional delta indicator."
```

---

### Task 6: CategoryTabs + ComingSoonFamily

**Files:**

- Create: `apps/dashboard/src/components/landing/category-tabs.tsx`
- Create: `apps/dashboard/src/components/landing/coming-soon-family.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/category-tabs.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoryTabs } from "../category-tabs";

// Mock Next.js components
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

const mockFamilies = [
  {
    slug: "sales-pipeline-bundle",
    name: "Sales Pipeline Bundle",
    status: "listed",
    description: "Sales team",
    metadata: { family: "sales", isBundle: true },
  },
  {
    slug: "creative-family",
    name: "Creative",
    status: "pending_review",
    description: "Creative agents",
    metadata: { family: "creative", isBundle: true },
  },
  {
    slug: "trading-family",
    name: "Trading",
    status: "pending_review",
    description: "Trading agents",
    metadata: { family: "trading", isBundle: true },
  },
];

describe("CategoryTabs", () => {
  it("renders all family tabs", () => {
    render(
      <CategoryTabs families={mockFamilies as never} activeFamily="sales">
        <div>Sales content</div>
      </CategoryTabs>,
    );
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Creative")).toBeInTheDocument();
    expect(screen.getByText("Trading")).toBeInTheDocument();
  });

  it("shows live indicator on active tab", () => {
    const { container } = render(
      <CategoryTabs families={mockFamilies as never} activeFamily="sales">
        <div>Sales content</div>
      </CategoryTabs>,
    );
    const liveIndicator = container.querySelector("[data-live-indicator]");
    expect(liveIndicator).toBeInTheDocument();
  });

  it("shows children for active tab", () => {
    render(
      <CategoryTabs families={mockFamilies as never} activeFamily="sales">
        <div>Sales content</div>
      </CategoryTabs>,
    );
    expect(screen.getByText("Sales content")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- category-tabs`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement ComingSoonFamily**

```tsx
"use client";

import { AgentFamilyCharacter } from "./agent-family-character";
import type { RoleFocus } from "@/components/character/operator-character";

const FAMILY_ROLE_MAP: Record<string, RoleFocus> = {
  creative: "default",
  trading: "default",
  finance: "default",
};

interface ComingSoonFamilyProps {
  name: string;
  family: string;
  description: string;
}

export function ComingSoonFamily({ name, family, description }: ComingSoonFamilyProps) {
  const roleFocus = FAMILY_ROLE_MAP[family] ?? "default";

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6">
      <AgentFamilyCharacter name={name} roleFocus={roleFocus} status="coming" />
      <p className="text-muted-foreground text-center max-w-md">{description}</p>
      <span className="text-sm text-muted-foreground font-mono">Coming soon</span>
    </div>
  );
}
```

- [ ] **Step 4: Implement CategoryTabs**

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ComingSoonFamily } from "./coming-soon-family";
import type { MarketplaceListing } from "@/lib/demo-data";

const FAMILY_DISPLAY: Record<string, string> = {
  sales: "Sales",
  creative: "Creative",
  trading: "Trading",
  finance: "Finance",
};

interface CategoryTabsProps {
  families: MarketplaceListing[];
  activeFamily: string;
  children: React.ReactNode;
}

export function CategoryTabs({ families, activeFamily, children }: CategoryTabsProps) {
  const [selected, setSelected] = useState(activeFamily);
  const orderedFamilies = ["sales", "creative", "trading", "finance"];

  const familyMap = new Map(
    families.map((f) => [(f.metadata as Record<string, unknown>)?.family as string, f]),
  );

  return (
    <div>
      <div
        className="flex gap-1 sm:gap-2 border-b border-border overflow-x-auto"
        role="tablist"
        aria-label="Agent categories"
      >
        {orderedFamilies.map((family) => {
          const listing = familyMap.get(family);
          if (!listing) return null;
          const isLive = listing.status === "listed";
          const isActive = selected === family;

          return (
            <button
              key={family}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${family}`}
              onClick={() => setSelected(family)}
              className={cn(
                "relative px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md",
                isActive
                  ? "text-foreground border-b-2 border-foreground -mb-px"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-2">
                {FAMILY_DISPLAY[family] ?? family}
                {isLive && (
                  <span
                    data-live-indicator
                    className="w-2 h-2 rounded-full bg-positive animate-pulse"
                    aria-label="Live"
                  />
                )}
              </span>
              {!isLive && (
                <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                  coming soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      {orderedFamilies.map((family) => {
        const listing = familyMap.get(family);
        if (!listing) return null;
        const isActive = selected === family;
        const isLive = listing.status === "listed";

        return (
          <div
            key={family}
            id={`tabpanel-${family}`}
            role="tabpanel"
            aria-labelledby={family}
            hidden={!isActive}
          >
            {isActive &&
              (isLive ? (
                children
              ) : (
                <ComingSoonFamily
                  name={listing.name}
                  family={family}
                  description={listing.description}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- category-tabs`

Expected: 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(dashboard): add CategoryTabs and ComingSoonFamily components

Horizontal tab bar with live indicator dot, coming-soon tab states with
muted agent character and description."
```

---

### Task 7: TeamBundleCard

**Files:**

- Create: `apps/dashboard/src/components/landing/team-bundle-card.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/team-bundle-card.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamBundleCard } from "../team-bundle-card";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
});

const mockAgents = [
  {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    roleFocus: "leads" as const,
    roleLabel: "qualifies",
  },
  { name: "Sales Closer", slug: "sales-closer", roleFocus: "growth" as const, roleLabel: "closes" },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    roleFocus: "care" as const,
    roleLabel: "re-engages",
  },
];

describe("TeamBundleCard", () => {
  it("renders bundle title", () => {
    render(<TeamBundleCard agents={mockAgents} stats={{ leads: 12, callsBooked: 3, errors: 0 }} />);
    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
  });

  it("renders all agent names", () => {
    render(<TeamBundleCard agents={mockAgents} stats={{ leads: 12, callsBooked: 3, errors: 0 }} />);
    expect(screen.getByText("Speed-to-Lead Rep")).toBeInTheDocument();
    expect(screen.getByText("Sales Closer")).toBeInTheDocument();
    expect(screen.getByText("Nurture Specialist")).toBeInTheDocument();
  });

  it("renders deploy CTA", () => {
    render(<TeamBundleCard agents={mockAgents} stats={{ leads: 12, callsBooked: 3, errors: 0 }} />);
    expect(screen.getByText("Deploy this team")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- team-bundle-card`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement TeamBundleCard**

```tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { cn } from "@/lib/utils";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface BundleAgent {
  name: string;
  slug: string;
  roleFocus: RoleFocus;
  roleLabel: string;
}

interface TeamBundleCardProps {
  agents: BundleAgent[];
  stats: { leads: number; callsBooked: number; errors: number };
  className?: string;
}

export function TeamBundleCard({ agents, stats, className }: TeamBundleCardProps) {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.15 });

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-surface p-6 sm:p-8 lg:p-10",
        isVisible && "animate-fade-in-up",
        className,
      )}
      style={isVisible ? { animationFillMode: "both" } : { opacity: 0 }}
    >
      <div className="text-center mb-8">
        <h3 className="font-display text-2xl lg:text-3xl font-light text-foreground">
          Sales Pipeline
        </h3>
        <p className="mt-2 text-muted-foreground">
          3 agents, one pipeline. Leads come in, calls get booked.
        </p>
      </div>

      {/* Agent flow */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 lg:gap-8 flex-wrap">
        {agents.map((agent, i) => (
          <div key={agent.slug} className="flex items-center gap-2 sm:gap-4">
            <Link href={`/agents/${agent.slug}`} className="flex flex-col items-center gap-2 group">
              <div className="w-20 h-20">
                <OperatorCharacter roleFocus={agent.roleFocus} className="w-full h-full" />
              </div>
              <span className="text-sm font-medium text-foreground group-hover:underline">
                {agent.name}
              </span>
              <span className="text-xs text-muted-foreground">{agent.roleLabel}</span>
            </Link>
            {i < agents.length - 1 && (
              <span className="text-muted-foreground text-lg shrink-0" aria-hidden="true">
                &rarr;
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Demo label + stats */}
      <div className="mt-8 text-center space-y-2">
        <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Demo: Austin Bakery Co
        </p>
        <p className="font-mono text-sm text-muted-foreground tabular-nums">
          last 24h &middot; {stats.leads} leads &middot; {stats.callsBooked} calls booked &middot;{" "}
          {stats.errors} errors
        </p>
      </div>

      {/* CTA */}
      <div className="mt-8 text-center">
        <Button asChild size="lg">
          <Link href="/deploy/sales-pipeline-bundle">Deploy this team</Link>
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- team-bundle-card`

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): add TeamBundleCard component

Featured Sales Pipeline team card with agent characters, handoff arrows,
demo stats, and deploy CTA."
```

---

### Task 8: AgentMarketplaceCard

**Files:**

- Create: `apps/dashboard/src/components/landing/agent-marketplace-card.tsx`
- Create: `apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentMarketplaceCard } from "../agent-marketplace-card";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
});

const mockAgent = {
  name: "Speed-to-Lead Rep",
  slug: "speed-to-lead",
  description: "Responds to inbound leads within 60 seconds.",
  trustScore: 47,
  autonomyLevel: "supervised",
  roleFocus: "leads" as const,
  bundleSlug: "sales-pipeline-bundle",
  stats: { totalTasks: 12, approvalRate: 98, lastActiveAt: new Date().toISOString() },
};

describe("AgentMarketplaceCard", () => {
  it("renders agent name", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    expect(screen.getByText("Speed-to-Lead Rep")).toBeInTheDocument();
  });

  it("renders trust score", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("renders autonomy badge", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    expect(screen.getByText(/supervised/i)).toBeInTheDocument();
  });

  it("renders Hire link to bundle", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    const hireLink = screen.getByText("Hire");
    expect(hireLink.closest("a")).toHaveAttribute("href", "/deploy/sales-pipeline-bundle");
  });

  it("renders See work link to profile", () => {
    render(<AgentMarketplaceCard {...mockAgent} />);
    const workLink = screen.getByText(/see work/i);
    expect(workLink.closest("a")).toHaveAttribute("href", "/agents/speed-to-lead");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- agent-marketplace-card`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement AgentMarketplaceCard**

```tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { TrustBar } from "@/components/marketplace/trust-bar";
import { cn } from "@/lib/utils";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface AgentMarketplaceCardProps {
  name: string;
  slug: string;
  description: string;
  trustScore: number;
  autonomyLevel: string;
  roleFocus: RoleFocus;
  bundleSlug: string;
  stats: {
    totalTasks: number;
    approvalRate: number;
    lastActiveAt: string | null;
  };
  className?: string;
  animationDelay?: number;
}

export function AgentMarketplaceCard({
  name,
  slug,
  description,
  trustScore,
  autonomyLevel,
  roleFocus,
  bundleSlug,
  stats,
  className,
  animationDelay = 0,
}: AgentMarketplaceCardProps) {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.1 });

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border bg-surface p-6 flex flex-col",
        "transition-shadow hover:shadow-md",
        isVisible && "animate-fade-in-up",
        className,
      )}
      style={
        isVisible
          ? { animationDelay: `${animationDelay}ms`, animationFillMode: "both" }
          : { opacity: 0 }
      }
    >
      {/* Character */}
      <div className="flex justify-center mb-4">
        <div className="w-28 h-28">
          <OperatorCharacter roleFocus={roleFocus} className="w-full h-full" />
        </div>
      </div>

      {/* Name */}
      <h3 className="font-display text-xl font-medium text-foreground text-center">{name}</h3>

      {/* Trust score */}
      <div className="flex justify-center mt-3">
        <TrustBar score={trustScore} />
      </div>

      {/* Autonomy badge */}
      <div className="flex justify-center mt-2">
        <span className="text-xs font-mono text-muted-foreground border border-border px-2 py-0.5 rounded">
          {autonomyLevel}
        </span>
      </div>

      {/* Description */}
      <p className="mt-4 text-sm text-muted-foreground text-center line-clamp-2">{description}</p>

      {/* Divider */}
      <div className="border-t border-border-subtle my-4" />

      {/* Today stats */}
      <div className="space-y-1.5">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          today
        </span>
        <div className="space-y-1 text-sm">
          <p>
            <span className="font-mono tabular-nums">{stats.totalTasks}</span>
            <span className="text-muted-foreground"> tasks</span>
          </p>
          <p>
            <span className="font-mono tabular-nums">{stats.approvalRate}%</span>
            <span className="text-muted-foreground"> approved</span>
          </p>
          <p className="text-muted-foreground">
            last active{" "}
            <span className="font-mono tabular-nums">{formatTimeAgo(stats.lastActiveAt)}</span>
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border-subtle my-4" />

      {/* Actions */}
      <div className="flex items-center justify-between mt-auto">
        <Button asChild size="sm">
          <Link href={`/deploy/${bundleSlug}`}>Hire</Link>
        </Button>
        <Link
          href={`/agents/${slug}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          See work &rarr;
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- agent-marketplace-card`

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): add AgentMarketplaceCard component

Individual agent card with character, trust bar, autonomy badge,
daily stats, and Hire/See work actions."
```

---

### Task 9: Marketplace Landing Page

**Files:**

- Modify: `apps/dashboard/src/app/(public)/page.tsx`
- Modify: `apps/dashboard/src/app/(public)/layout.tsx`
- Create: `apps/dashboard/src/app/(public)/loading.tsx`

Replace the marketing landing page with the marketplace browse experience.

- [ ] **Step 1: Create loading skeleton**

Create `apps/dashboard/src/app/(public)/loading.tsx`:

```tsx
export default function MarketplaceLoading() {
  return (
    <div className="pt-28 pb-20">
      <div className="page-width">
        {/* Hero skeleton */}
        <div className="text-center space-y-4 mb-12">
          <div className="h-10 w-64 bg-border/30 rounded mx-auto animate-pulse" />
          <div className="h-5 w-96 bg-border/30 rounded mx-auto animate-pulse" />
        </div>
        {/* Tab bar skeleton */}
        <div className="flex gap-4 border-b border-border mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 w-24 bg-border/30 rounded animate-pulse" />
          ))}
        </div>
        {/* Bundle card skeleton */}
        <div className="h-64 bg-border/20 rounded-xl animate-pulse mb-8" />
        {/* Agent cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-96 bg-border/20 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace (public)/page.tsx**

Replace the entire contents of `apps/dashboard/src/app/(public)/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getListedAgents, getBundleListings, getDemoTaskStats } from "@/lib/demo-data";
import { CategoryTabs } from "@/components/landing/category-tabs";
import { TeamBundleCard } from "@/components/landing/team-bundle-card";
import { AgentMarketplaceCard } from "@/components/landing/agent-marketplace-card";
import type { RoleFocus } from "@/components/character/operator-character";

export const metadata: Metadata = {
  title: "Switchboard — Meet your team",
  description:
    "Browse AI agents for your business. Deploy them in minutes. They earn your trust over time.",
};

const AGENT_BUNDLE_ORDER = [
  { slug: "speed-to-lead", roleFocus: "leads" as RoleFocus, roleLabel: "qualifies" },
  { slug: "sales-closer", roleFocus: "growth" as RoleFocus, roleLabel: "closes" },
  { slug: "nurture-specialist", roleFocus: "care" as RoleFocus, roleLabel: "re-engages" },
];

export default async function MarketplacePage() {
  const [agents, families] = await Promise.all([getListedAgents(), getBundleListings()]);

  // Get stats for each agent
  const agentStats = await Promise.all(
    agents.map(async (agent) => ({
      agent,
      stats: await getDemoTaskStats(agent.id),
    })),
  );

  // Compute bundle stats from individual agent stats
  const totalLeads = agentStats
    .filter((a) => a.agent.slug === "speed-to-lead")
    .reduce((sum, a) => sum + a.stats.totalTasks, 0);
  const totalBooked = agentStats
    .filter((a) => a.agent.slug === "sales-closer")
    .reduce((sum, a) => sum + a.stats.approvedCount, 0);

  // Build bundle agents array
  const bundleAgents = AGENT_BUNDLE_ORDER.map((order) => {
    const agent = agents.find((a) => a.slug === order.slug);
    return {
      name: agent?.name ?? order.slug,
      slug: order.slug,
      roleFocus: order.roleFocus,
      roleLabel: order.roleLabel,
    };
  });

  return (
    <section className="pt-28 pb-20 lg:pt-36 lg:pb-28" aria-label="Marketplace">
      <div className="page-width">
        {/* Hero */}
        <div className="text-center mb-12 lg:mb-16">
          <h1
            className="font-display font-light tracking-tight text-foreground"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}
          >
            Meet your team.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Browse AI agents. Deploy them to your business. They earn your trust over time.
          </p>
        </div>

        {/* Category tabs + content */}
        <CategoryTabs families={families} activeFamily="sales">
          {/* Sales tab content */}
          <div className="mt-8 space-y-8">
            {/* Featured bundle */}
            <TeamBundleCard
              agents={bundleAgents}
              stats={{ leads: totalLeads, callsBooked: totalBooked, errors: 0 }}
            />

            {/* Individual agent cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {agentStats.map(({ agent, stats }, i) => {
                const order = AGENT_BUNDLE_ORDER.find((o) => o.slug === agent.slug);
                const metadata = agent.metadata as Record<string, unknown> | null;
                return (
                  <AgentMarketplaceCard
                    key={agent.id}
                    name={agent.name}
                    slug={agent.slug}
                    description={agent.description}
                    trustScore={agent.trustScore}
                    autonomyLevel={agent.autonomyLevel}
                    roleFocus={order?.roleFocus ?? "default"}
                    bundleSlug={(metadata?.bundleSlug as string) ?? "sales-pipeline-bundle"}
                    stats={{
                      totalTasks: stats.totalTasks,
                      approvalRate: stats.approvalRate,
                      lastActiveAt: stats.lastActiveAt?.toISOString() ?? null,
                    }}
                    animationDelay={i * 150}
                  />
                );
              })}
            </div>
          </div>
        </CategoryTabs>

        {/* Empty state fallback */}
        {agents.length === 0 && (
          <p className="text-center text-muted-foreground mt-12">
            No agents available yet. Run <code className="font-mono">pnpm db:seed</code> to populate
            the marketplace.
          </p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Update layout metadata**

In `apps/dashboard/src/app/(public)/layout.tsx`, update the metadata to match the marketplace framing:

```ts
export const metadata: Metadata = {
  title: "Switchboard — Meet your team",
  description:
    "Browse AI agents for your business. Deploy them in minutes. They earn your trust over time.",
  openGraph: {
    title: "Switchboard — Meet your team",
    description:
      "Browse AI agents for your business. Deploy them in minutes. They earn your trust over time.",
    type: "website",
  },
};
```

- [ ] **Step 4: Verify the page renders**

Run: `pnpm --filter @switchboard/dashboard dev`

Navigate to `http://localhost:3002`. Verify:

- Hero text "Meet your team." renders
- Category tabs show (Sales with live dot, Creative/Trading/Finance as coming soon)
- Sales Pipeline bundle card shows with 3 agent characters and arrows
- 3 individual agent cards show with trust scores and stats
- Clicking a coming-soon tab shows the ComingSoonFamily content

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(dashboard): replace landing page with marketplace browse

Server Component marketplace page with hero, category tabs, featured
Sales Pipeline bundle card, and individual agent cards with live data."
```

---

### Task 10: Agent Profile Page

**Files:**

- Create: `apps/dashboard/src/components/marketplace/agent-profile-header.tsx`
- Create: `apps/dashboard/src/components/marketplace/work-log-list.tsx`
- Create: `apps/dashboard/src/components/marketplace/conversation-transcript.tsx`
- Create: `apps/dashboard/src/components/marketplace/trust-history-chart.tsx`
- Create: `apps/dashboard/src/components/marketplace/__tests__/work-log-list.test.tsx`
- Create: `apps/dashboard/src/app/(public)/agents/[slug]/page.tsx`
- Create: `apps/dashboard/src/app/(public)/agents/[slug]/loading.tsx`

Full agent profile page with Overview, Work Log, and Trust History tabs.

- [ ] **Step 1: Write the WorkLogList test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkLogList } from "../work-log-list";

const mockTasks = [
  {
    id: "task-1",
    status: "approved",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    output: {
      summary: "Qualified lead — wedding cakes, $800 budget",
      outcome: "qualified",
      messages: [
        { role: "lead", text: "I need a cake", timestamp: new Date().toISOString() },
        { role: "agent", text: "I can help!", timestamp: new Date().toISOString() },
      ],
    },
  },
  {
    id: "task-2",
    status: "rejected",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    output: {
      summary: "Follow-up — lost lead",
      outcome: "disqualified",
      messages: [{ role: "agent", text: "Following up...", timestamp: new Date().toISOString() }],
    },
  },
];

describe("WorkLogList", () => {
  it("renders task summaries", () => {
    render(<WorkLogList tasks={mockTasks} />);
    expect(screen.getByText(/wedding cakes/i)).toBeInTheDocument();
    expect(screen.getByText(/lost lead/i)).toBeInTheDocument();
  });

  it("expands transcript on click", async () => {
    const user = userEvent.setup();
    render(<WorkLogList tasks={mockTasks} />);

    const expandButtons = screen.getAllByRole("button", { name: /expand/i });
    await user.click(expandButtons[0]);

    expect(screen.getByText("I need a cake")).toBeInTheDocument();
    expect(screen.getByText("I can help!")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- work-log-list`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement ConversationTranscript**

```tsx
import { cn } from "@/lib/utils";

interface Message {
  role: "lead" | "agent";
  text: string;
  timestamp: string;
}

interface ConversationTranscriptProps {
  messages: Message[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ConversationTranscript({ messages }: ConversationTranscriptProps) {
  return (
    <div className="space-y-3 py-4">
      {messages.map((msg, i) => (
        <div key={i} className={cn("flex", msg.role === "agent" ? "justify-end" : "justify-start")}>
          <div
            className={cn(
              "max-w-[80%] rounded-lg px-3 py-2",
              msg.role === "agent" ? "bg-surface-raised" : "bg-border/20",
            )}
          >
            <p className="text-sm">{msg.text}</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {formatTime(msg.timestamp)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement WorkLogList**

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ConversationTranscript } from "./conversation-transcript";

interface TaskOutput {
  summary: string;
  outcome: string;
  messages: Array<{ role: "lead" | "agent"; text: string; timestamp: string }>;
  handoffTo?: string | null;
}

interface TaskEntry {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  output: TaskOutput | null;
}

interface WorkLogListProps {
  tasks: TaskEntry[];
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_ICONS: Record<string, string> = {
  approved: "\u2713",
  completed: "\u2713",
  rejected: "\u2717",
  pending: "\u23F3",
  awaiting_review: "\u23F3",
  running: "\u23F3",
};

export function WorkLogList({ tasks }: WorkLogListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="divide-y divide-border">
      {tasks.map((task) => {
        const output = task.output;
        const isExpanded = expandedId === task.id;
        const messageCount = output?.messages?.length ?? 0;

        return (
          <div key={task.id} className="py-4">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "text-lg shrink-0 w-6 text-center",
                  task.status === "approved" || task.status === "completed"
                    ? "text-positive"
                    : task.status === "rejected"
                      ? "text-negative"
                      : "text-muted-foreground",
                )}
              >
                {STATUS_ICONS[task.status] ?? "?"}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{output?.summary ?? "Task"}</p>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {formatTimeAgo(task.createdAt)} &middot; {messageCount} message
                  {messageCount !== 1 ? "s" : ""} &middot; {task.status}
                </p>
              </div>

              {output?.messages && output.messages.length > 0 && (
                <button
                  onClick={() => setExpandedId(isExpanded ? null : task.id)}
                  aria-label={isExpanded ? "Collapse transcript" : "Expand transcript"}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {isExpanded ? "Hide" : "Show"}
                </button>
              )}
            </div>

            {isExpanded && output?.messages && (
              <div className="ml-9 mt-2 border-l-2 border-border pl-4">
                <ConversationTranscript messages={output.messages} />
              </div>
            )}
          </div>
        );
      })}

      {tasks.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">No tasks yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement TrustHistoryChart**

Uses Recharts (already installed as dependency).

```tsx
"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

interface TrustPoint {
  timestamp: string;
  score: number;
}

interface TrustHistoryChartProps {
  data: TrustPoint[];
  totalApprovals: number;
  totalRejections: number;
  currentStreak: number;
  highestScore: number;
}

export function TrustHistoryChart({
  data,
  totalApprovals,
  totalRejections,
  currentStreak,
  highestScore,
}: TrustHistoryChartProps) {
  return (
    <div className="space-y-6">
      {/* Sparkline */}
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="timestamp" hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              labelFormatter={(ts) =>
                new Date(ts as string).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              }
              formatter={(value: number) => [`${value}`, "Trust Score"]}
              contentStyle={{
                backgroundColor: "hsl(var(--surface))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                fontSize: "0.875rem",
              }}
            />
            <Line
              type="stepAfter"
              dataKey="score"
              stroke="hsl(var(--foreground))"
              strokeWidth={2}
              dot={{ r: 3, fill: "hsl(var(--foreground))" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Approvals", value: totalApprovals },
          { label: "Rejections", value: totalRejections },
          { label: "Current streak", value: currentStreak },
          { label: "Highest score", value: highestScore },
        ].map((stat) => (
          <div key={stat.label}>
            <p className="font-mono text-lg tabular-nums">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Auto-approval note */}
      <p className="text-xs text-muted-foreground border-t border-border pt-4">
        Tasks are auto-approved when trust exceeds 30.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Implement AgentProfileHeader**

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { TrustBar } from "@/components/marketplace/trust-bar";

interface AgentProfileHeaderProps {
  name: string;
  slug: string;
  description: string;
  trustScore: number;
  autonomyLevel: string;
  roleFocus: RoleFocus;
  bundleSlug: string;
}

export function AgentProfileHeader({
  name,
  description,
  trustScore,
  autonomyLevel,
  roleFocus,
  bundleSlug,
}: AgentProfileHeaderProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-48 h-48 mb-6">
        <OperatorCharacter roleFocus={roleFocus} className="w-full h-full" />
      </div>

      <h1 className="font-display text-3xl lg:text-4xl font-light text-foreground">{name}</h1>

      <div className="flex items-center gap-3 mt-4">
        <TrustBar score={trustScore} />
        <span className="text-xs font-mono text-muted-foreground border border-border px-2 py-0.5 rounded">
          {autonomyLevel}
        </span>
      </div>

      <p className="mt-4 text-muted-foreground max-w-lg">{description}</p>

      <div className="mt-6">
        <Button asChild size="lg">
          <Link href={`/deploy/${bundleSlug}`}>Hire this agent</Link>
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create the loading skeleton**

Create `apps/dashboard/src/app/(public)/agents/[slug]/loading.tsx`:

```tsx
export default function AgentProfileLoading() {
  return (
    <div className="pt-28 pb-20">
      <div className="page-width max-w-3xl mx-auto">
        <div className="flex flex-col items-center gap-4">
          <div className="w-48 h-48 bg-border/20 rounded-full animate-pulse" />
          <div className="h-8 w-48 bg-border/30 rounded animate-pulse" />
          <div className="h-5 w-64 bg-border/30 rounded animate-pulse" />
          <div className="h-10 w-32 bg-border/30 rounded animate-pulse mt-4" />
        </div>
        <div className="h-64 bg-border/20 rounded-xl animate-pulse mt-12" />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create the agent profile page**

Create `apps/dashboard/src/app/(public)/agents/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getListingBySlug,
  getDemoTasks,
  getDemoTaskStats,
  getTrustRecords,
  getTrustProgression,
} from "@/lib/demo-data";
import { AgentProfileHeader } from "@/components/marketplace/agent-profile-header";
import { AgentProfileTabs } from "./profile-tabs";
import type { RoleFocus } from "@/components/character/operator-character";

const ROLE_MAP: Record<string, RoleFocus> = {
  "speed-to-lead": "leads",
  "sales-closer": "growth",
  "nurture-specialist": "care",
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: "Agent Not Found — Switchboard" };
  return {
    title: `${listing.name} — Switchboard`,
    description: listing.description,
  };
}

export default async function AgentProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  const [tasks, stats, trustRecords, trustProgression] = await Promise.all([
    getDemoTasks(listing.id, 30),
    getDemoTaskStats(listing.id),
    getTrustRecords(listing.id),
    getTrustProgression(listing.id),
  ]);

  const metadata = listing.metadata as Record<string, unknown> | null;
  const bundleSlug = (metadata?.bundleSlug as string) ?? "sales-pipeline-bundle";
  const roleFocus = ROLE_MAP[slug] ?? ("default" as RoleFocus);

  // Trust breakdown for chart
  const totalApprovals = trustRecords.reduce((sum, r) => sum + r.totalApprovals, 0);
  const totalRejections = trustRecords.reduce((sum, r) => sum + r.totalRejections, 0);
  const currentStreak = trustRecords.reduce((sum, r) => sum + r.consecutiveApprovals, 0);
  const highestScore = Math.max(...trustProgression.map((p) => p.score), 0);

  // Serialize tasks for client component
  const serializedTasks = tasks.map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
    output: t.output as Record<string, unknown> | null,
  }));

  return (
    <div className="pt-28 pb-20">
      <div className="page-width max-w-3xl mx-auto">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 inline-block"
        >
          &larr; Back to marketplace
        </Link>

        <AgentProfileHeader
          name={listing.name}
          slug={listing.slug}
          description={listing.description}
          trustScore={listing.trustScore}
          autonomyLevel={listing.autonomyLevel}
          roleFocus={roleFocus}
          bundleSlug={bundleSlug}
        />

        <div className="border-t border-border mt-10 pt-8">
          <AgentProfileTabs
            tasks={serializedTasks}
            stats={stats}
            trustProgression={trustProgression}
            trustBreakdown={{
              totalApprovals,
              totalRejections,
              currentStreak,
              highestScore,
            }}
            agentSlug={slug}
            bundleSlug={bundleSlug}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Create profile-tabs client component**

Create `apps/dashboard/src/app/(public)/agents/[slug]/profile-tabs.tsx`:

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { WorkLogList } from "@/components/marketplace/work-log-list";
import { TrustHistoryChart } from "@/components/marketplace/trust-history-chart";

interface ProfileTabsProps {
  tasks: Array<{
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    output: Record<string, unknown> | null;
  }>;
  stats: {
    totalTasks: number;
    approvedCount: number;
    approvalRate: number;
    lastActiveAt: string | null;
  };
  trustProgression: Array<{ timestamp: string; score: number }>;
  trustBreakdown: {
    totalApprovals: number;
    totalRejections: number;
    currentStreak: number;
    highestScore: number;
  };
  agentSlug: string;
  bundleSlug: string;
}

const TABS = ["Overview", "Work log", "Trust history"] as const;
type Tab = (typeof TABS)[number];

const AGENT_WORKFLOWS: Record<string, string[]> = {
  "speed-to-lead": [
    "Lead fills out a form or sends a message",
    "Agent qualifies through natural conversation",
    "Qualified \u2192 hands to Sales Closer",
    "Not ready \u2192 hands to Nurture Specialist",
  ],
  "sales-closer": [
    "Receives qualified lead with full context",
    "Handles objections and builds urgency",
    "Books a call or consultation",
    "Complex negotiation \u2192 escalates to human",
  ],
  "nurture-specialist": [
    "Receives leads that aren't ready to buy",
    "Schedules follow-ups across a cadence",
    "Varies approach based on previous interactions",
    "Lead re-engages \u2192 hands to Sales Closer",
  ],
};

export function AgentProfileTabs({
  tasks,
  stats,
  trustProgression,
  trustBreakdown,
  agentSlug,
  bundleSlug,
}: ProfileTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  return (
    <div>
      <div className="flex gap-1 border-b border-border" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md",
              activeTab === tab
                ? "text-foreground border-b-2 border-foreground -mb-px"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="py-6" role="tabpanel">
        {activeTab === "Overview" && (
          <div className="space-y-8">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Tasks completed", value: stats.totalTasks },
                { label: "Approval rate", value: `${stats.approvalRate}%` },
                { label: "Response time", value: "< 60s" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <p className="font-mono text-2xl tabular-nums">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Team context */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Part of:{" "}
                <a href="/" className="text-foreground hover:underline">
                  Sales Pipeline team
                </a>
              </p>
              <p className="text-sm text-muted-foreground">
                Works with:{" "}
                {["speed-to-lead", "sales-closer", "nurture-specialist"]
                  .filter((s) => s !== agentSlug)
                  .map((s, i, arr) => (
                    <span key={s}>
                      <a href={`/agents/${s}`} className="text-foreground hover:underline">
                        {s
                          .split("-")
                          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                          .join(" ")}
                      </a>
                      {i < arr.length - 1 ? ", " : ""}
                    </span>
                  ))}
              </p>
            </div>

            {/* How it works */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">How it works</h3>
              <ol className="space-y-2">
                {(AGENT_WORKFLOWS[agentSlug] ?? []).map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="font-mono text-muted-foreground shrink-0">{i + 1}.</span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {activeTab === "Work log" && <WorkLogList tasks={tasks} />}

        {activeTab === "Trust history" && (
          <TrustHistoryChart
            data={trustProgression}
            totalApprovals={trustBreakdown.totalApprovals}
            totalRejections={trustBreakdown.totalRejections}
            currentStreak={trustBreakdown.currentStreak}
            highestScore={trustBreakdown.highestScore}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Run tests**

Run: `pnpm --filter @switchboard/dashboard test -- work-log-list`

Expected: 2 tests passing.

- [ ] **Step 11: Verify profile page renders**

Run dev server and navigate to `http://localhost:3002/agents/speed-to-lead`. Verify:

- Back link, character, name, trust bar, autonomy badge render
- Overview tab shows stats, team context, workflow steps
- Work log tab shows expandable task entries with transcripts
- Trust history tab shows sparkline chart and breakdown

- [ ] **Step 12: Commit**

```bash
git commit -m "feat(dashboard): add agent profile page at /agents/[slug]

Full agent portfolio page with overview stats, expandable work log
with conversation transcripts, and trust history sparkline chart."
```

---

### Task 11: Deploy Flow

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/marketplace/persona/deploy/route.ts`
- Create: `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/deploy/[slug]/actions.ts`
- Create: `apps/dashboard/src/components/marketplace/deploy-wizard.tsx`

Website scan + review/brief deploy flow.

- [ ] **Step 1: Create the persona deploy proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/persona/deploy/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: Request) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const result = await client.deploySalesPipeline(body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Deploy persona error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create server action for website scanning**

Create `apps/dashboard/src/app/(auth)/deploy/[slug]/actions.ts`:

```ts
"use server";

import Anthropic from "@anthropic-ai/sdk";

interface BusinessProfile {
  businessName: string;
  whatTheySell: string;
  valueProposition: string;
  tone: string;
  pricingRange: string;
}

export async function scanWebsite(url: string): Promise<BusinessProfile> {
  // Fetch the website
  const response = await fetch(url, {
    headers: { "User-Agent": "Switchboard/1.0 (business scanner)" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch website: ${response.status}`);
  }

  const html = await response.text();

  // Extract text content (simple approach — strip HTML tags)
  const textContent = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000); // Limit to ~5k chars

  // Extract from Claude
  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Analyze this business website content and extract:
1. Business name
2. What they sell (products/services)
3. Value proposition (what makes them special)
4. Tone of their brand (e.g., warm, professional, playful)
5. Pricing range (if visible)

Website content:
${textContent}

Respond in JSON format only:
{"businessName": "", "whatTheySell": "", "valueProposition": "", "tone": "", "pricingRange": ""}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse business profile from AI response");
  }

  return JSON.parse(jsonMatch[0]) as BusinessProfile;
}
```

- [ ] **Step 3: Install @anthropic-ai/sdk in dashboard**

Run: `pnpm --filter @switchboard/dashboard add @anthropic-ai/sdk`

- [ ] **Step 4: Create DeployWizard component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { scanWebsite } from "@/app/(auth)/deploy/[slug]/actions";

interface BusinessProfile {
  businessName: string;
  whatTheySell: string;
  valueProposition: string;
  tone: string;
  pricingRange: string;
}

interface DeployWizardProps {
  agentName: string;
  bundleSlug: string;
  roleFocus: RoleFocus;
}

export function DeployWizard({ agentName, bundleSlug, roleFocus }: DeployWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<"scan" | "review">("scan");
  const [url, setUrl] = useState("");
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [isScanning, startScan] = useTransition();
  const [isDeploying, startDeploy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Brief fields
  const [qualificationCriteria, setQualificationCriteria] = useState("");
  const [neverSay, setNeverSay] = useState("");
  const [bookingLink, setBookingLink] = useState("");
  const [escalationRules, setEscalationRules] = useState({
    frustrated: true,
    askForPerson: true,
    mentionCompetitor: false,
    outsideKnowledge: false,
  });

  function handleScan() {
    setError(null);
    startScan(async () => {
      try {
        const result = await scanWebsite(url);
        setProfile(result);
        setStep("review");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to scan website");
      }
    });
  }

  function handleDeploy() {
    if (!profile) return;
    startDeploy(async () => {
      try {
        const persona = {
          businessName: profile.businessName,
          businessType: "small_business",
          productService: profile.whatTheySell,
          valueProposition: profile.valueProposition,
          tone: profile.tone === "warm" ? "casual" : "professional",
          qualificationCriteria: { description: qualificationCriteria },
          disqualificationCriteria: {},
          escalationRules,
          bookingLink: bookingLink || null,
          customInstructions: neverSay ? `Never say: ${neverSay}` : null,
        };

        const res = await fetch("/api/dashboard/marketplace/persona/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(persona),
        });

        if (!res.ok) throw new Error("Deploy failed");
        router.push("/dashboard");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deploy failed");
      }
    });
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 shrink-0">
          <OperatorCharacter roleFocus={roleFocus} className="w-full h-full" />
        </div>
        <div>
          <h2 className="font-display text-xl text-foreground">
            {step === "scan" ? `Let's get ${agentName} up to speed.` : "Here's what I learned:"}
          </h2>
        </div>
      </div>

      {step === "scan" && (
        <div className="space-y-4">
          <p className="text-muted-foreground">First, your website — I'll study up.</p>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://yourbusiness.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isScanning}
            />
            <Button onClick={handleScan} disabled={!url || isScanning}>
              {isScanning ? "Learning..." : "Learn my business"}
            </Button>
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
        </div>
      )}

      {step === "review" && profile && (
        <div className="space-y-6">
          {/* AI summary */}
          <div className="bg-surface-raised rounded-lg p-4">
            <p className="text-sm text-foreground">
              You're <strong>{profile.businessName}</strong>. You sell{" "}
              {profile.whatTheySell.toLowerCase()}. Your vibe is {profile.tone.toLowerCase()}.{" "}
              {profile.pricingRange && `Orders range ${profile.pricingRange}.`}
            </p>
          </div>

          <div className="border-t border-border pt-6 space-y-5">
            <p className="text-sm font-medium text-foreground">
              A few things that'll help me do great work:
            </p>

            <div>
              <label className="text-sm text-muted-foreground block mb-1">
                What makes someone a good lead for you?
              </label>
              <Input
                value={qualificationCriteria}
                onChange={(e) => setQualificationCriteria(e.target.value)}
                placeholder="Planning a wedding or event, budget over $300..."
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground block mb-2">
                When should I hand off to you?
              </label>
              <div className="space-y-2">
                {Object.entries({
                  frustrated: "They're frustrated or upset",
                  askForPerson: "They ask to speak to a person",
                  mentionCompetitor: "They mention a competitor",
                  outsideKnowledge: "Question outside my knowledge",
                }).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={escalationRules[key as keyof typeof escalationRules]}
                      onChange={(e) =>
                        setEscalationRules((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="rounded border-border"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground block mb-1">
                Anything I should never say?
              </label>
              <Input
                value={neverSay}
                onChange={(e) => setNeverSay(e.target.value)}
                placeholder="Never promise same-week delivery..."
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground block mb-1">
                Got a booking link?
              </label>
              <Input
                type="url"
                value={bookingLink}
                onChange={(e) => setBookingLink(e.target.value)}
                placeholder="https://cal.com/yourbusiness"
              />
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <Button onClick={handleDeploy} disabled={isDeploying} size="lg" className="w-full">
              {isDeploying ? "Deploying..." : "Deploy — I'm ready to start"}
            </Button>
            {error && <p className="text-sm text-negative mt-2">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create the deploy page**

Create `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getListingBySlug } from "@/lib/demo-data";
import { DeployWizard } from "@/components/marketplace/deploy-wizard";
import type { RoleFocus } from "@/components/character/operator-character";

const ROLE_MAP: Record<string, RoleFocus> = {
  "sales-pipeline-bundle": "leads",
  "speed-to-lead": "leads",
  "sales-closer": "growth",
  "nurture-specialist": "care",
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function DeployPage({ params }: PageProps) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  const displayName = listing.name.replace(" Bundle", "");

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <DeployWizard
        agentName={displayName}
        bundleSlug={slug}
        roleFocus={ROLE_MAP[slug] ?? "default"}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify deploy flow**

Run dev server. Sign in, then navigate to `http://localhost:3002/deploy/sales-pipeline-bundle`. Verify:

- Website scan input renders with agent character
- Entering a URL and clicking "Learn my business" triggers the scan
- Review step shows AI-extracted business profile
- Brief fields (qualification, escalation, never-say, booking link) render
- Deploy button calls the persona deploy API

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(dashboard): add deploy flow at /deploy/[slug]

Conversational deploy wizard with website scanning via Claude API,
AI-extracted business profile review, qualification/escalation brief,
and persona deploy proxy route."
```

---

### Task 12: Cleanup Old Components

**Files:**

- Remove: `apps/dashboard/src/components/landing/hero-section.tsx`
- Remove: `apps/dashboard/src/components/landing/timeline-section.tsx`
- Remove: `apps/dashboard/src/components/landing/stats-section.tsx`
- Remove: `apps/dashboard/src/components/landing/stat-card.tsx`
- Remove: `apps/dashboard/src/components/landing/trust-section.tsx`
- Remove: `apps/dashboard/src/components/landing/trust-card.tsx`
- Remove: `apps/dashboard/src/components/landing/__tests__/hero-section.test.tsx`
- Remove: `apps/dashboard/src/components/landing/__tests__/timeline-section.test.tsx`
- Remove: `apps/dashboard/src/components/landing/__tests__/stats-section.test.tsx`
- Remove: `apps/dashboard/src/components/landing/__tests__/trust-section.test.tsx`
- Remove: `apps/dashboard/src/app/(auth)/marketplace/[id]/deploy/page.tsx`
- Remove: `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`
- Remove: `apps/dashboard/src/components/marketplace/deploy-step-config.tsx`
- Remove: `apps/dashboard/src/components/marketplace/deploy-step-connect.tsx`
- Remove: `apps/dashboard/src/components/marketplace/deploy-step-governance.tsx`

- [ ] **Step 1: Verify no other files import the removed components**

Search for imports of the components being removed:

```bash
grep -r "hero-section\|timeline-section\|stats-section\|stat-card\|trust-section\|trust-card\|deploy-wizard-shell\|deploy-step-config\|deploy-step-connect\|deploy-step-governance" apps/dashboard/src/ --include="*.tsx" --include="*.ts" -l
```

Expected: Only the files being removed (and possibly the old `(public)/page.tsx` which was already replaced in Task 9). If any other file imports them, update it first.

- [ ] **Step 2: Delete the files**

```bash
rm apps/dashboard/src/components/landing/hero-section.tsx
rm apps/dashboard/src/components/landing/timeline-section.tsx
rm apps/dashboard/src/components/landing/stats-section.tsx
rm apps/dashboard/src/components/landing/stat-card.tsx
rm apps/dashboard/src/components/landing/trust-section.tsx
rm apps/dashboard/src/components/landing/trust-card.tsx
rm apps/dashboard/src/components/landing/__tests__/hero-section.test.tsx
rm apps/dashboard/src/components/landing/__tests__/timeline-section.test.tsx
rm apps/dashboard/src/components/landing/__tests__/stats-section.test.tsx
rm apps/dashboard/src/components/landing/__tests__/trust-section.test.tsx
rm apps/dashboard/src/app/\(auth\)/marketplace/\[id\]/deploy/page.tsx
rm apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx
rm apps/dashboard/src/components/marketplace/deploy-step-config.tsx
rm apps/dashboard/src/components/marketplace/deploy-step-connect.tsx
rm apps/dashboard/src/components/marketplace/deploy-step-governance.tsx
```

- [ ] **Step 3: Run typecheck to verify no broken imports**

Run: `pnpm --filter @switchboard/dashboard exec tsc --noEmit`

Expected: No type errors related to removed components.

- [ ] **Step 4: Run all dashboard tests**

Run: `pnpm --filter @switchboard/dashboard test`

Expected: All tests pass (removed test files no longer run, remaining tests unaffected).

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(dashboard): remove old landing page components

Remove HeroSection, TimelineSection, StatsSection, StatCard,
TrustSection, TrustCard, old deploy wizard components and all
their tests — replaced by marketplace browse experience."
```

---

## Post-Implementation Verification

After all tasks are complete, verify the full flow:

1. `pnpm db:seed` — seeds marketplace listings with metadata + demo data
2. `pnpm --filter @switchboard/dashboard dev` — starts the dashboard
3. Navigate to `/` — marketplace landing with hero, tabs, bundle card, agent cards
4. Click "Creative" tab — shows coming-soon family content
5. Click "See work" on an agent card — navigates to `/agents/speed-to-lead`
6. Agent profile shows overview, work log (expandable transcripts), trust history chart
7. Click "Hire" — redirects to `/deploy/sales-pipeline-bundle` (requires auth)
8. Deploy flow: enter URL → AI scans → review profile → fill brief → deploy → redirect to dashboard
9. `pnpm --filter @switchboard/dashboard test` — all tests pass
10. `pnpm --filter @switchboard/dashboard exec tsc --noEmit` — no type errors
