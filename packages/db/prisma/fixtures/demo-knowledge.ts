import type { PrismaClient } from "@prisma/client";

/**
 * Seed demo business knowledge for Glow Aesthetics (Singapore clinic)
 */
export async function seedDemoKnowledge(prisma: PrismaClient, orgId: string): Promise<void> {
  console.warn("[seed] Seeding demo business knowledge for Glow Aesthetics...");

  // Offer Catalog (kind: "knowledge", scope: "offer-catalog")
  await prisma.knowledgeEntry.upsert({
    where: {
      organizationId_kind_scope_version: {
        organizationId: orgId,
        kind: "knowledge",
        scope: "offer-catalog",
        version: 1,
      },
    },
    update: {},
    create: {
      organizationId: orgId,
      kind: "knowledge",
      scope: "offer-catalog",
      title: "Glow Aesthetics Treatment Catalog",
      content: `# Glow Aesthetics Treatment Menu

## Facial Treatments

**Hydrafacial Classic** — SGD $180
Deep cleansing, exfoliation, extraction, and hydration. Perfect for all skin types. Results visible immediately. Duration: 45 minutes.

**Hydrafacial Premium** — SGD $280
Includes lymphatic drainage, LED light therapy, and customized booster serum. Duration: 60 minutes.

**Chemical Peel (Light)** — SGD $200
Glycolic or salicylic acid peel for brightening, texture improvement, and acne control. Minimal downtime. Duration: 30 minutes.

**Microneedling with PRP** — SGD $450
Stimulates collagen production using your own platelet-rich plasma. Ideal for fine lines, scarring, and skin rejuvenation. Duration: 60 minutes.

**LED Light Therapy (Add-on)** — SGD $80 (standalone: $120)
Blue light for acne, red light for anti-aging and healing. Duration: 20 minutes.

## Injectable Treatments

**Botox (Botulinum Toxin)** — SGD $350-$600
Crow's feet, forehead lines, frown lines. Price depends on units required. Consultation required. Duration: 15-30 minutes.

**Dermal Fillers (Hyaluronic Acid)** — SGD $600-$1,200 per syringe
Cheeks, lips, nasolabial folds, chin enhancement. Price depends on filler type and area. Duration: 30-45 minutes.

## Body Treatments

**Laser Hair Removal (Small Area)** — SGD $150 per session
Upper lip, underarms, bikini line. Package of 6 recommended. Duration: 15-20 minutes.

**Laser Hair Removal (Large Area)** — SGD $400 per session
Full legs, full back, full arms. Package of 6 recommended. Duration: 45-60 minutes.

**Body Contouring (Cryolipolysis)** — SGD $500 per area
Non-invasive fat reduction. Popular areas: abdomen, love handles, thighs. Duration: 60 minutes per area.

**Cellulite Reduction Treatment** — SGD $350 per session
Radiofrequency and vacuum massage. Package of 6-8 recommended. Duration: 45 minutes.

## Special Offers

- **First-time clients**: Complimentary skin consultation (worth $100)
- **Birthday month**: 15% off any facial treatment
- **Package deals**: 10% off when purchasing 6+ sessions of laser hair removal or body contouring

## Important Notes

- All prices are in Singapore Dollars (SGD)
- Prices are estimates and may vary based on individual needs — final pricing confirmed during consultation
- We accept cash, PayNow, credit cards, and installment plans via Atome/Hoolah
- Medical-grade products and FDA-approved devices only
- All practitioners are certified and licensed`,
      version: 1,
      active: true,
      priority: 10,
    },
  });

  // Objection Handling Playbook (kind: "playbook", scope: "objection-handling")
  await prisma.knowledgeEntry.upsert({
    where: {
      organizationId_kind_scope_version: {
        organizationId: orgId,
        kind: "playbook",
        scope: "objection-handling",
        version: 1,
      },
    },
    update: {},
    create: {
      organizationId: orgId,
      kind: "playbook",
      scope: "objection-handling",
      title: "Objection Handling Playbook",
      content: `# Objection Handling Guide

## "Too expensive" / "Price is high"

**Response approach:**
- Emphasize value: medical-grade products, certified practitioners, proven results
- First-time clients get complimentary consultation (worth $100)
- Payment plans available via Atome or Hoolah (split into 3-6 interest-free installments)
- Package deals available for multiple sessions (10% off)
- Compare to competitors: our pricing is mid-range for Singapore, but quality is premium

**Example:** "I understand budget is important. We offer payment plans through Atome so you can split it into 3 installments with no interest. Plus, your first consultation is complimentary — no commitment required!"

## "I need to think about it"

**Response approach:**
- No pressure — suggest booking free consultation first
- Mention limited appointment slots (creates mild urgency without being pushy)
- Offer to send treatment information via WhatsApp/email
- Ask if there are specific concerns we can address

**Example:** "Absolutely, take your time! Would you like to book a free consultation first? No commitment required, and our doctor can assess your skin and recommend the best treatment. Slots fill up quickly, especially on weekends."

## "Is it safe?" / "Will it hurt?"

**Response approach:**
- All practitioners are board-certified and licensed
- FDA-approved products and medical-grade equipment only
- Show safety record: thousands of satisfied clients
- Offer to share before/after photos (with consent)
- Explain the procedure in simple terms
- Numbing cream available for injectable treatments

**Example:** "Great question! All our treatments use FDA-approved products, and our doctors are board-certified. For injectables, we use numbing cream so discomfort is minimal. I can also share before/after photos from actual clients if that helps!"

## "My friend had a bad experience elsewhere"

**Response approach:**
- Acknowledge their concern — it's valid
- Differentiate: our safety record, licensed practitioners, medical-grade products
- Offer free consultation so they can meet the doctor and ask questions
- Share testimonials or Google reviews
- Explain our aftercare support

**Example:** "I'm sorry to hear that. That's exactly why we only use certified practitioners and FDA-approved products. We also provide full aftercare support. Why not book a free consultation? You can meet our doctor, ask any questions, and see our clinic — zero commitment."

## "Not sure which treatment is right for me"

**Response approach:**
- This is an easy one — offer free consultation
- Doctor will assess skin type, concerns, and goals
- Personalized treatment plan recommended
- No obligation to proceed after consultation

**Example:** "That's exactly what the free consultation is for! Our doctor will assess your skin, discuss your goals, and recommend the best treatment for you. It's completely free and there's no obligation to book a treatment afterward."

## "I'm not ready to book yet" / "Just browsing"

**Response approach:**
- Keep it light and friendly
- Offer to send treatment menu and pricing via WhatsApp
- Ask if they have any questions
- Mention the free consultation option
- Don't push — stay helpful

**Example:** "No worries at all! Happy to help. I can send you our treatment menu with pricing if you'd like. And if you ever have questions, just reach out. Our free consultation is always available when you're ready!"

## "Can I get a discount?"

**Response approach:**
- First-time clients already get free consultation (worth $100)
- Package deals available (10% off for 6+ sessions)
- Birthday month special (15% off facials)
- Payment plans available (Atome/Hoolah)

**Example:** "First-time clients get a complimentary consultation worth $100! We also have package deals — 10% off when you buy 6+ sessions. And if it's your birthday month, you get 15% off any facial treatment!"

## Escalation Triggers

If the conversation involves:
- Specific medical advice (e.g., "I'm pregnant, can I get Botox?")
- Severe skin conditions or allergies
- Unreasonable expectations ("Will this make me look 20 years younger?")
- Requests for guarantees of specific results

**Response:** "That's a great question for our doctor. Let me connect you with our clinic team who can give you the most accurate medical advice. Can I have your number so they can follow up with you directly?"`,
      version: 1,
      active: true,
      priority: 20,
    },
  });

  // Messaging Policy (kind: "policy", scope: "messaging-rules")
  await prisma.knowledgeEntry.upsert({
    where: {
      organizationId_kind_scope_version: {
        organizationId: orgId,
        kind: "policy",
        scope: "messaging-rules",
        version: 1,
      },
    },
    update: {},
    create: {
      organizationId: orgId,
      kind: "policy",
      scope: "messaging-rules",
      title: "Messaging Rules and Compliance",
      content: `# Messaging Rules — AI Agent Compliance

## MUST NOT Do

1. **No medical guarantees or promises of specific results**
   - ❌ "This will make you look 10 years younger"
   - ✅ "Many clients see visible improvement in fine lines after 3-4 sessions"

2. **No medical advice beyond general information**
   - ❌ "Yes, Botox is safe for you"
   - ✅ "Our doctor can assess your suitability during the free consultation"

3. **No pressure tactics or manipulation**
   - ❌ "This offer expires in 1 hour!"
   - ✅ "Slots fill up quickly, especially on weekends"

4. **No sharing of other clients' personal information**
   - ❌ "Sarah from Orchard just booked this treatment"
   - ✅ "This is one of our most popular treatments"

5. **No diagnosing skin conditions**
   - ❌ "You have rosacea"
   - ✅ "Those symptoms could be various things — our doctor can assess during your consultation"

## MUST Do

1. **Always offer human escalation for medical questions**
   - "That's a great question for our doctor. Let me connect you with our clinic team."

2. **Use disclaimers when discussing pricing**
   - "Prices are estimates — final pricing confirmed during your consultation based on your individual needs"

3. **Clarify that results vary by individual**
   - "Results vary by individual. During your consultation, our doctor can give you realistic expectations based on your skin type."

4. **Offer the free consultation as the default next step**
   - "Would you like to book a free consultation? Our doctor can assess your skin and recommend the best treatment for you."

5. **Be transparent about payment and cancellation policies**
   - "We require 24 hours notice for cancellations. Deposits are non-refundable but can be applied to future treatments."

## Tone Guidelines

- Friendly and approachable, not overly clinical
- Empathetic to concerns (especially around safety and pain)
- Professional but warm — like talking to a knowledgeable friend
- Avoid medical jargon unless the client uses it first
- Use Singaporean context (SGD, local references like "Orchard", "PayNow")

## Escalation to Human

Escalate immediately if:
- Client mentions pregnancy, breastfeeding, or serious medical conditions
- Client has unrealistic expectations or demands guarantees
- Client is aggressive or abusive
- Client asks complex medical questions beyond general treatment info
- Client requests off-menu treatments or procedures

**Escalation message:** "Let me connect you with our clinic team who can give you the best guidance. Can I have your number so they can follow up with you directly?"`,
      version: 1,
      active: true,
      priority: 30,
    },
  });

  // Qualification Framework (kind: "playbook", scope: "qualification-framework")
  await prisma.knowledgeEntry.upsert({
    where: {
      organizationId_kind_scope_version: {
        organizationId: orgId,
        kind: "playbook",
        scope: "qualification-framework",
        version: 1,
      },
    },
    update: {},
    create: {
      organizationId: orgId,
      kind: "playbook",
      scope: "qualification-framework",
      title: "Lead Qualification Framework",
      content: `# Lead Qualification Framework

## Qualification Criteria

### 1. Age Requirement
- **Must be 21+ years old**
- If under 21, politely inform: "Our treatments require clients to be 21 and above. Feel free to reach out when you're eligible!"

### 2. Discovery Questions (ask naturally during conversation)

**Treatment Interest**
- What are you hoping to achieve? (anti-aging, acne, hair removal, body contouring, etc.)
- Which treatment(s) are you interested in?
- Have you tried any aesthetic treatments before?

**Timeline**
- Are you looking to book soon, or just exploring options?
- Is there a specific event or date you're preparing for?

**Budget Range**
- Do you have a budget range in mind?
- Are you aware of the typical pricing for this treatment?
- Would payment plans be helpful?

**Medical Screening (basic — full screening during consultation)**
- Do you have any known allergies to skincare products or medications?
- Are you currently pregnant or breastfeeding? (for certain treatments)
- Do you have any active skin infections or open wounds? (for certain treatments)

### 3. Disqualification Triggers

**Hard Disqualifiers:**
- Under 21 years old
- Active skin infection in treatment area
- Pregnancy (for Botox, fillers, certain laser treatments)
- Unrealistic expectations or demanding guaranteed results

**Soft Disqualifiers (escalate to clinic staff):**
- Severe medical conditions (autoimmune disorders, blood clotting issues)
- Currently on certain medications (e.g., Accutane for laser treatments)
- Keloid scarring history (for microneedling, laser)
- Extremely price-sensitive with no flexibility (may not be ready)

### 4. High-Intent Signals (prioritize these leads)

- Asks about specific pricing
- Asks about available appointment slots or dates
- Mentions a specific event or timeline ("My wedding is in 3 months")
- Has done prior research ("I've been reading about Hydrafacial...")
- Asks about package deals or payment plans
- Returns after initial inquiry
- Provides contact details proactively
- Asks detailed questions about procedure or recovery time

### 5. Lead Scoring (Internal)

**Hot Lead (book consultation ASAP):**
- Asks about booking/availability
- Mentions specific treatment and budget
- Expresses urgency or timeline
- Has prior aesthetic treatment experience
- Provides phone number without prompting

**Warm Lead (nurture, send info):**
- Asks general questions about treatments
- Compares multiple options
- Asks about pricing but hesitant
- Mentions "thinking about it" or "researching"
- Engaged in conversation, asks follow-up questions

**Cold Lead (low priority):**
- Very brief responses ("Ok", "Thanks")
- Only asks about price, no other engagement
- Non-responsive after initial question
- Under 21 or disqualified
- Extremely price-focused with no flexibility

## Qualification Flow Example

1. **Greeting** — "Hi! Welcome to Glow Aesthetics. What brings you here today?"
2. **Discovery** — "What are you hoping to achieve?" / "Have you tried any treatments before?"
3. **Treatment Match** — Suggest 1-2 treatments based on their goals
4. **Pricing Discussion** — Share pricing, mention free consultation
5. **Timeline Check** — "Are you looking to book soon, or just exploring?"
6. **Medical Screening (basic)** — "Any known allergies or skin conditions?"
7. **Next Step** — Offer free consultation booking if qualified and interested

## Booking Triggers

Suggest booking a consultation if:
- Lead is qualified (21+, no hard disqualifiers)
- Shows interest in specific treatment
- Asks about pricing or availability
- Has medical questions that require doctor input
- Expresses any level of intent ("I'm considering...", "I want to try...")

**Booking message:** "Would you like to book a free consultation? Our doctor can assess your skin, answer all your questions, and recommend the best treatment plan for you. No obligation to proceed afterward!"

## Escalation to Staff

Escalate to clinic staff if:
- Medical questions beyond basic screening
- Client has complex medical history
- Client negotiating heavily on price
- Client asks about custom/off-menu treatments
- Client is a high-value lead (multiple treatments, large budget)

**Escalation message:** "Let me connect you with our clinic team who can help you with this. Can I have your number so they can follow up directly?"`,
      version: 1,
      active: true,
      priority: 40,
    },
  });

  console.warn("[seed] ✅ Demo business knowledge seeded (4 entries for Glow Aesthetics)");
}
