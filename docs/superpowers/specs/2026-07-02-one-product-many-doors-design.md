# One Product, Many Doors: B2B2C Pivot Execution Design

- **Date:** 2026-07-02
- **Status:** Owner-approved (brainstorm session 2026-07-02); this document is the canonical execution design for the open self-serve pivot.
- **North star:** first external paying customer within 90 days (by 2026-09-30).
- **Amends:** the safe-harbor floor spec (PR #1383, proceeds as specced; open questions resolved in Section 8) and the L1 open-profile decomposition (PR #1384, rescoped in Section 8). Supersedes the "vertical packs as upgrades" framing in earlier pivot notes.

## 1. Decision summary and constraints

The product is ONE governed booking agent for appointment-taking businesses ("the Shopify of booking agents"), not a family of per-vertical agents and not a general-purpose small-business agent platform. Verticals are marketing doors and onboarding presets, not governance objects.

Constraints this design is built around (owner-confirmed 2026-07-02):

- Success = a stranger pays within ~90 days. Not usage, not signups, not platform completeness.
- No warm sales network; founder sales time is near zero. The funnel must attract, persuade, close, and onboard without a human.
- Acquisition = manual Meta/Google ads into per-vertical landing pages. Real budget, modest scale.
- ICP = businesses that book time: fitness studios, medspas, salons, real-estate agents, interior designers, insurance agents/advisors, and the long tail of appointment businesses.
- Launch markets: SG/MY-first for paid ads (channel-gap evidence, Section 7); the web-widget door tests global traffic organically.

Build admission rule: no work item enters the critical path unless it sits on the path between an ad click and a Stripe receipt.

## 2. Product definition

A governed chat agent any appointment-taking business can self-serve onto. It:

- connects on token-paste channels first (Telegram bot + embeddable web widget), WhatsApp via official BSP as a fast-follow (Section 6);
- answers customer inquiries from the tenant's own facts (BusinessFacts/KnowledgeEntry);
- drafts replies for owner approval (observe/draft mode is the boot state for every tenant);
- books appointments with receipts (receipted-booking loop, WorkTrace-audited);
- escalates regulated or sensitive topics to the human owner.

Every tenant boots into the universal safe-harbor floor: observe/draft mode + generic claim boundaries (never diagnose, never guarantee outcomes, never give financial or legal advice, always disclose AI, escalate regulated topics) + the existing consent/PDPA gate.

## 3. What replaces vertical packs

The pack concept conflated four things. They are now four separate, differently-priced mechanisms:

1. **Regulatory profiles** (curated, rare, governance-bearing). A small closed set maintained by the platform: `generic` (the safe-harbor floor, the default for every new tenant) and `medspa` (the existing vetted profile with its enforce path, unchanged). New regulated verticals run `generic` observe/draft-only until a customer's demand justifies authoring a new vetted profile. This is NOT an open pack-authoring surface.
2. **Starter templates** (ungated presets, zero governance weight). Per-vertical onboarding pre-fills: persona tone, typical services, FAQ shapes. Marketing sugar that shortens the onboarding interview. Stored as data, editable per tenant, never load-bearing for safety.
3. **Tenant facts** (where answer quality lives). BusinessFacts/KnowledgeEntry populated by an onboarding interview conducted by the agent itself. Per-tenant, not per-vertical.
4. **Doors** (pure marketing). Per-vertical landing pages feeding one signup flow.

Consequence: the platform never becomes a per-vertical content-authoring treadmill. The regulated jobs the ICP actually buys (qualify the lead, answer logistics, book the viewing/consult) are unregulated even in regulated industries; the floor's claim boundaries plus human escalation is the correct and sufficient behavior for real-estate, interior-design, and insurance-advisor tenants on the `generic` profile.

## 4. The funnel (the dollar path)

Ad → door → live demo → signup → onboarding interview → agent live → payment.

- Manual Meta/Google ads per funded door (Section 7) target the business owner.
- Each door page embeds a **live demo agent** seeded from that vertical's starter template. The visitor talks to the product before signing up; the demo is the pitch, replacing sales calls.
- Signup → the agent interviews the owner (10-15 questions) to populate tenant facts; the starter template pre-fills defaults.
- Owner pastes a Telegram bot token or embeds the web widget; the agent is live in draft mode the same session. First-wow moment is scripted: the agent immediately drafts a reply to a seeded sample inquiry using the owner's own prices and hours.
- Trial: 14 days. Payment: Stripe checkout link; a webhook flips the entitlement. No billing system at launch.
- Concierge ops (not sales): the founder watches signups and repairs broken provisioning behind the scenes.

## 5. Pricing and packaging

- Flat single-seat subscription, launch hypothesis **US$99/month** (SGD/MYR display pricing at checkout), 14-day free trial, no credit card to start the trial.
- Positioning, evidence-backed (Section 10): below the ~US$150/month real floor of SEA WhatsApp-commerce platforms (SleekFlow 3-seat minimum), roughly a third of the US incumbents' entry price (Podium US$249-399/month floor), and self-serve purchasable, which no verified incumbent offers (Mindbody and peers sales-gate their AI SKUs).
- Deferred but architecturally anticipated: per-booking usage fees and paid human-escalation packaging (Smith.ai proves escalation sells as a paid feature at ~US$3/call, not a cost center). Do not build metering at launch.

## 6. Channel strategy

- **Launch:** Telegram bot (official API, token-paste, live in minutes) + embeddable web widget. Both work in any market with zero third-party review.
- **Fast-follow:** WhatsApp via the official Business Platform, inbound-first. The core receptionist job lives inside the 24-hour customer-service window where replies are free-form and carry no per-message Meta fees. Path: start on a BSP-hosted signup (rides the BSP's approved app, sidesteps Meta App Review entirely), move to an own-app Tech Provider integration with Embedded Signup once tenant volume justifies the one-time platform gates (Business Verification + App Review; default onboarding quota 10 tenants per rolling 7 days, 200 after full verification). Unit-cost benchmark: ~US$15/month per hosted number plus Meta per-message rates for out-of-window templates. Template-gated proactive sends (show-rate nudges) come after inbound works.
- **Never:** unofficial WhatsApp automation (Baileys/whatsapp-web.js class). It violates Meta ToS, gets tenant business numbers banned, and is incoherent with a governed-platform brand. **Not now:** iMessage (no API; bridges violate Apple ToS; official Messages for Business is enterprise-gated). US texting, if ever, is official SMS via Twilio, deferred.

## 7. Doors and launch market

Research could not rank per-vertical demand from citable evidence (Section 10), so small real ad budgets are the demand research. Rules set before data, not after:

- **Funded doors (4):** fitness, medspa, salon, real estate. The first three are proven incumbent-spend categories (Mindbody/Zenoti sell AI receptionist SKUs into them); real estate is the largest chat-native audience of the remainder.
- **Unfunded doors (2):** interior design, insurance agents/advisors. Pages exist (cheap), no ad budget until first data suggests otherwise.
- **Market:** SG/MY-first for paid ads. Verified channel gap: US incumbents anchor on SMS/webchat/Facebook with no WhatsApp/Telegram, while SG/MY is WhatsApp/Telegram-native. The web-widget door collects global/US signal organically; a US ad push waits until official SMS exists.
- **Decision rules:** equal budget per funded door in round one, default US$300/door (~US$1,200 total; owner may resize before launch, the equality matters more than the amount). Kill any door with zero signups after its budget. If one door outperforms the rest by ~3x on cost-per-activation, concentrate on it (ladder posture). Weekly funnel review: spend → clicks → demo engagement → signups → activated (agent live) → paid.

## 8. Impact on the in-flight governance specs

- **Safe-harbor floor (PR #1383): proceed as specced.** Open questions resolved: Q1 yes (build floor primitives now on the current config model; L1 generalizes later), Q2 yes (express via the `generic` vertical loader seam + existing claim-boundary gates, no new primitive), Q3 yes (spec-first, implement after review). SH-1..SH-5 stay the first build slices, each harness-green and medspa byte-identical.
- **L1 open-profile refactor (PR #1384): rescoped, not dropped.** The blast-radius inventory, compat-shim pattern, chokepoint migrations (`currencyForJurisdiction` → `currencyForMarket`), and golden-harness gating all stand. Two changes: (a) the "VerticalPack registry" is renamed and rescoped to a **curated regulatory-profile registry** whose only launch entries are `generic` and `medspa`; no pack-authoring surface, no self-serve pack authoring in onboarding, ever, until demand proves otherwise; (b) the series trims to the slices the dollar path needs: open `regulatoryProfileId` with `generic` default, open `market` for currency fail-closed, medspa byte-identical throughout. Tail slices that only serve open-ended pack authoring are cut. Open questions resolved: Q1 yes (L1 after the floor), Q2 yes (registries in `packages/schemas`, promote `Vertical`), Q3 two keys/two registries, Q4 defer widening `SupportedCurrency`, Q5 yes (re-express the operator set-market intent with a back-compat window).

## 9. Build slices (strictly ordered by dollar-path necessity)

- **S1** Safe-harbor floor: SH-1..SH-5 per #1383 with Section 8 resolutions.
- **S2** Minimal L1: rescoped per Section 8, golden-harness-gated, medspa byte-identical.
- **S3** Self-serve signup + agent-led onboarding interview → tenant facts; starter templates for all six doors.
- **S4** Doors: marketing site + six vertical landing pages, each with an embedded live demo agent seeded from its starter template.
- **S5** Payment: Stripe checkout link + webhook → entitlement flip; 14-day trial logic.
- **S6** Ad kit: pixel/UTM wiring so cost-per-signup and cost-per-activation are attributable per door.

Explicitly deferred until after the first payment: WhatsApp (even BSP-hosted), full billing/Connect, T&S beyond ToS + manual signup review, any new regulatory profile, enforce-mode unlock for any new vertical, per-booking metering, paid-escalation packaging, Riley dogfooding for self-acquisition, third-party template authoring, the cut L1 tail, US SMS.

## 10. Research evidence appendix (deep-research pass, 2026-07-02)

Method: 5 search angles, 24 sources fetched, 118 claims extracted, top 25 adversarially verified (3-vote refutation), 15 confirmed / 10 refuted. All pricing as-fetched 2026-07-02; vendor pages change.

Confirmed findings the design relies on:

1. The "AI answers and books for you" SKU is an established category: Mindbody Messenger[ai] (sales-gated add-on; channels SMS/webchat/Facebook only), Zenoti AI Receptionist, Podium, Smith.ai. (high; mindbodyonline.com, zenoti.com)
2. US price umbrella: Podium entry US$249-399/month (real spend US$500-800 with add-ons); white-label reseller retail US$250-500/month. No verified self-serve purchase path at any incumbent. (medium; checkthat.ai, myaifrontdesk.com, 2-1 on resale rate)
3. Smith.ai bills per-call with live-human handoff at ~US$3/call: escalation is monetizable packaging. (high; smith.ai/pricing)
4. SEA platforms bundle AI into multi-seat subscriptions, real floor ~US$150/month (SleekFlow Pro AI, 3-seat minimum); Wati layers marked-up per-message fees; none sells a dedicated booking-receptionist SKU. (high; sleekflow.io/pricing, wati.io/pricing)
5. WhatsApp channel unit cost: ~US$15/month per hosted number (SleekFlow benchmark); Meta moved to per-message pricing 2025-07-01; customer-initiated service-window replies carry no per-message Meta fees (MY rate card). (high; sleekflow.io, forwardchat.my)
6. WhatsApp per-tenant onboarding is self-serve via Embedded Signup; the hard gate is one-time platform-level (Business Verification + App Review + Advanced Access) under the Tech Provider model, with per-tenant payment-method attach; BSP-hosted signup sidesteps App Review. (high; developers.facebook.com)
7. Channel gap: US incumbents' channel mix omits WhatsApp/Telegram (verified for Mindbody, directionally for Podium/Slang), leaving WhatsApp-native SG/MY open. (medium, 2-1)

Refuted (do not cite): every aggregate "AI receptionist costs $X-$Y" blog band (agentzap.ai, withallo.com), Smith.ai US$500/month managed-plan figure, Mindbody Starter at US$99/month, Podium AI Employee as a US$99-399 add-on, TrueLark enterprise-only pricing, Wati Astra AI credit tiers.

No surviving evidence (treat as unknown, answered by the S6 ad experiment): discovery channels for this ICP, Meta-vs-Google effectiveness, CAC and trial-to-paid benchmarks, per-vertical demand ranking, end-customer channel preference SG/MY vs US, BSP operational head-to-head.

## 11. Risks

- **Activation cliff:** observe/draft mode must feel alive in the first session (scripted first-wow, Section 4) or trial users churn before day 2.
- **Cold self-serve conversion:** may simply be too low at this budget; the decision rules (Section 7) bound the spend before that verdict is in.
- **L1 blast radius:** 98 files; mitigated by the compat shim, the golden harness, and the Section 8 trim.
- **Concierge load:** self-serve strangers break provisioning in ways reference tenants never did; watching signups is a real daily cost.
- **Price hypothesis:** US$99/month is evidence-positioned but unvalidated; the first payers, not the research, validate it.
