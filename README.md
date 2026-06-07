# Switchboard

> Runs the booking and ad work for WhatsApp-first clinics, keeps an honest per-dollar ledger of what that work earned, and shifts budget toward what pays off.

Switchboard is built for aesthetic clinics in Singapore and Malaysia that book on WhatsApp and run without a practice-management system. It does the revenue work itself: an agent answers the lead and books the visit, every booking and payment mints a receipt, and the spend that produced each paid visit is tied back to its campaign so budget can move toward what works.

Under the hood it is a governed operating system for revenue actions: every mutating action enters one ingress, passes one governance gate, and lands in one tamper-evident record. The loop is the product. The governance is what makes the loop trustworthy.

## The revenue loop

```
  ad spend (Meta, click-to-WhatsApp)
        |
        v
  WhatsApp conversation ............ Alex qualifies the lead, captures consent
        |
        v
  governed booking ................. one ingress, policy check, human approval when required
        |                            calendar receipt minted in the same database transaction
        v
  paid visit ....................... deposit link, payment receipt
        |
        v
  per-dollar ledger ................ which spend produced which paid visit
        |
        v
  reallocation ..................... Riley recommends moving budget; a human approves
        |
        '--> back to ad spend
```

The weekly metric is paid visits attributed to their cause, reported honestly as a funnel: booked and externally verified, then held, then paid.

## Three operators, one loop

- **Alex** runs the conversation: qualifies the inbound WhatsApp lead, captures consent, and books into the clinic's real calendar through a governed mutation.
- **Riley** keeps the economic truth: ingests ad performance, ties paid visits back to the spend that produced them, and surfaces budget recommendations for human approval.
- **Mira** produces the creative: UGC-style ad content through an async pipeline, with mandatory approval before anything is published.

They are operators of one loop, not three products. None of them can act outside the governance gate.

## What is real today, what is gated off, what is next

Status describes code on `main`, not deployment. We do not claim a capability is live unless it is.

**Real today** (each ties to a component in the codebase):

- A single mutating chokepoint: `PlatformIngress.submit()` enforces idempotency, entitlement, and governance in one place (`packages/core/src/platform/platform-ingress.ts`).
- A hash-chained canonical record: every action becomes a `WorkTrace`, content-hashed and anchored to the audit ledger (`packages/core/src/platform/work-trace-integrity.ts`).
- Receipts as first-class rows: bookings mint a calendar receipt inside the same database transaction as the booking write (`packages/core/src/skill-runtime/tools/calendar-book.ts`), with a tiered evidence model (`packages/core/src/receipts/`).
- Approval binding: what executes is byte-equivalent to what was approved (`packages/core/src/approval/`).
- Meta click-to-WhatsApp first-touch capture from signed webhooks, persisted at lead intake.
- Alex's WhatsApp-to-booking path wired end to end, in alpha. Launch blockers are tracked in `docs/audits/`.
- Riley's funnel and saturation analysis with daily and weekly audit jobs, producing recommendations for human review.

**Gated off by design** (built, dark until flipped):

- Deposit links: the Stripe Connect checkout adapter and payment-status retrieval are wired and tested; issuance through the skill runtime is not yet registered.
- Riley's pause execution on Meta is capability-gated per organization; no production org is enabled.
- Every ad object Mira creates is `PAUSED` by construction; the Meta client refuses to set `ACTIVE`.
- Compliance gates (consent, claim scanning, messaging windows) run in observe mode during the enforcement bake.
- Meta Conversions API echo ships only when the pixel id and access token are configured.

**Next:** close the act-on-proof leg. Held and paid receipt coverage for the full funnel, then Riley's reallocation executing through the same governed ingress as everything else.

## What the governance buys the owner

These are properties of the architecture, not marketing. Each ties to a real component.

- **Nothing slips.** Every action is persisted in `WorkTrace`. No forgotten follow-ups.
- **Consistent judgment.** `GovernanceGate.evaluate()` applies the same identity, policy, and risk evaluation to action #1 and action #10,000.
- **You stay in control.** Approval is lifecycle state, not a side effect. Human escalation is first-class architecture, and the riskiest legs ship dark until you flip them.
- **Books you can trust.** Receipts are minted in the same transaction as the work they evidence, and the ledger is hash-chained. The system that does the work keeps the books.
- **Learning that compounds.** Decisions are outcome-linked, so policy changes are evaluated against history instead of tribal memory.
- **Always on.** Inbound leads get answered in seconds, around the clock, inside the same governed path.

## Under the hood

![Switchboard control plane](docs/assets/architecture.svg)

```
Channel (WhatsApp / Telegram / Slack / API)
    |
    v
DeploymentResolver        resolve org + skill + trust context
    |
    v
PlatformIngress.submit()  normalize WorkUnit, enforce idempotency
    |
    v
GovernanceGate.evaluate() identity, policy, risk, approval routing
    |
    +--> EXECUTE ------------------+--> REQUIRE APPROVAL
    |                              |       human reviews, then dispatch
    v                              v
ExecutionMode dispatches work (skill tool-calling, async pipelines)
    |
    v
WorkTrace persisted       canonical lifecycle record
```

For the architectural rules and invariants: [docs/DOCTRINE.md](docs/DOCTRINE.md). For the deep reference: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repo layout

```
packages/
├── schemas/            Zod schemas & shared types (no internal deps)
├── sdk/                Agent manifest, handler interface, test harness
├── cartridge-sdk/      Legacy bridge, pending removal
├── creative-pipeline/  Creative content pipeline (async jobs via Inngest)
├── ad-optimizer/       Ad platform integration + optimization
├── core/               Platform ingress, governance, skill runtime
└── db/                 Prisma ORM, stores, credential encryption

apps/
├── api/          Fastify REST API (port 3000)
├── chat/         Multi-channel chat ingress (port 3001)
└── dashboard/    Next.js operator console (port 3002)
```

Organized by dependency layer; circular dependencies are forbidden. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## Getting started

```bash
git clone https://github.com/jsonljc/switchboard.git
cd switchboard
pnpm local:setup
```

Requires Node 20+, pnpm 9, and PostgreSQL 17/18 with pgvector. Full setup, development, database, and testing docs: [CONTRIBUTING.md](CONTRIBUTING.md).

## Further reading

- [docs/DOCTRINE.md](docs/DOCTRINE.md) architectural rules and invariants
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) deep architectural reference
- [docs/OPERATIONS.md](docs/OPERATIONS.md) operator runbook
- [docs/DEPLOYMENT-CHECKLIST.md](docs/DEPLOYMENT-CHECKLIST.md) production deploy checklist
- [SECURITY.md](SECURITY.md) vulnerability disclosure
- [CONTRIBUTING.md](CONTRIBUTING.md) setup and contribution guide

## License

Copyright (c) 2026. All rights reserved.

The source is visible for evaluation and security review. No license is granted to use, copy, modify, or distribute this software, in whole or in part, without prior written permission. Contributions are welcome through the process in [CONTRIBUTING.md](CONTRIBUTING.md); by submitting one you agree it may be incorporated into the project under these terms.
