/* eslint-disable no-console */
import type { PrismaClient } from "@prisma/client";

const KNOWLEDGE_SEEDS = [
  {
    kind: "playbook" as const,
    scope: "objection-handling",
    title: "Standard objection handling patterns",
    content: `## Price Objections
- Reframe around value and ROI, not cost
- Mention payment plans or flexible options if available
- Ask what budget they had in mind — sometimes the gap is small

## Timing Objections
- Create urgency through value, not pressure
- Tie to their stated timeline or goals
- Suggest a specific next step with a deadline

## Trust Objections
- Share relevant proof points, case studies, or guarantees
- Offer a trial or low-risk entry point
- Be transparent about what you can and cannot do

## Competitor Objections
- Differentiate on strengths, never disparage
- Ask what specifically they liked about the competitor
- Focus on fit for their specific situation

## "Need to Think" Objections
- Suggest a specific next step with a timeline
- Ask what information would help them decide
- Offer to send a summary they can review`,
    priority: 0,
  },
  {
    kind: "policy" as const,
    scope: "messaging-rules",
    title: "Default messaging policy",
    content: `## Messaging Rules
- Keep first messages under 3 sentences
- Never use ALL CAPS or excessive punctuation
- Do not send more than 1 follow-up per 24 hours
- Always personalize — reference something specific to the lead
- Respect opt-out immediately and completely
- Never fabricate statistics, case studies, or testimonials
- Avoid industry jargon unless the lead uses it first
- End messages with a clear, single call to action`,
    priority: 0,
  },
  {
    kind: "knowledge" as const,
    scope: "offer-catalog",
    title: "Demo service catalog",
    content: `## Available Services

### Starter Package — $499/month
- Social media management (3 platforms)
- Monthly performance report
- Basic ad campaign management

### Growth Package — $999/month
- Everything in Starter
- SEO optimization
- Weekly performance reports
- A/B testing for ads

### Enterprise Package — Custom pricing
- Everything in Growth
- Dedicated account manager
- Custom integrations
- Priority support`,
    priority: 0,
  },
  {
    kind: "playbook" as const,
    scope: "qualification-framework",
    title: "Lead qualification playbook",
    content: `## Qualification Criteria
Qualify leads by gathering these signals through natural conversation:

1. **Need** — Do they have a problem your offering solves?
2. **Budget** — Can they afford the solution? (Don't ask directly — infer from business size, current spend)
3. **Authority** — Are they the decision maker? If not, who is?
4. **Timeline** — When do they need a solution? Urgent = higher priority
5. **Fit** — Is their business a good fit for your service?

## Scoring
- 4-5 criteria met → Qualified (move to quoted stage)
- 2-3 criteria met → Needs nurturing (stay in interested)
- 0-1 criteria met → Likely not a fit (politely close)

## Hard Disqualifiers
- Explicitly states no budget
- Business type outside service area
- Looking for something you don't offer
- Spam or bot behavior`,
    priority: 0,
  },
  {
    kind: "playbook" as const,
    scope: "nurture-cadence",
    title: "Re-engagement playbook",
    content: `## Nurture Cadence (5-touch sequence)

### Touch 1: Value Reminder (Day 1)
Highlight what they were originally interested in.
Reference their specific situation or pain point.

### Touch 2: New Angle (Day 3)
Present the offering from a different perspective.
Share a relevant insight or industry trend.

### Touch 3: Social Proof (Day 7)
Share a relevant success story or testimonial.
Keep it specific to their industry or situation.

### Touch 4: Soft Check-in (Day 14)
Ask if their situation has changed.
Offer to answer any new questions.

### Touch 5: Final Touch (Day 30)
Let them know you're here if anything changes.
No pressure — leave the door open.

## Rules
- One follow-up per 24 hours maximum
- If they re-engage with buying signals → move to qualified
- If they say stop → stop immediately, log opt-out
- After Touch 5 with no reply → stop outreach`,
    priority: 0,
  },
];

export async function seedKnowledge(prisma: PrismaClient): Promise<void> {
  for (const seed of KNOWLEDGE_SEEDS) {
    await prisma.knowledgeEntry.upsert({
      where: {
        organizationId_kind_scope_version: {
          organizationId: "org_dev",
          kind: seed.kind,
          scope: seed.scope,
          version: 1,
        },
      },
      update: {},
      create: {
        organizationId: "org_dev",
        kind: seed.kind,
        scope: seed.scope,
        title: seed.title,
        content: seed.content,
        priority: seed.priority,
        version: 1,
        active: true,
      },
    });
  }

  console.warn(`Seeded ${KNOWLEDGE_SEEDS.length} knowledge entries for org_dev`);
}
