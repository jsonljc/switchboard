# Finance Agent Family — Design Spec (WIP)

> Status: **In Progress** — architecture approved, detailed design pending
> Date: 2026-04-06

---

## Problem Statement

Build a family of AI finance agents for the Switchboard marketplace with the goal of **minimal financial leakage**. Financial leakage — duplicate payments, miscategorized expenses, unreconciled items, budget drift — is primarily an attention failure. AI doesn't have attention failures.

---

## Key Decisions

### Domain & Priority

- **Domain:** Finance (chosen over legal, HR, sales ops, procurement)
- **Why finance:** High AI advantage over humans, clear ROI, governance is the competitive moat — sensitivity is a feature, not a bug
- **Build order:** Bookkeeper + FP&A first (Tier 1: AI massively outperforms humans), then AP/AR + Treasury (Tier 2: AI assists but humans needed for authorization)

### Marketplace Model

- **Independently purchasable agents** that compose when co-deployed by the same org
- Not a monolithic bundle — each agent earns its own trust score and pricing tier
- When 2+ finance agents are deployed, the Financial Controller activates to coordinate

### Leakage Prevention: Dual Layer

1. **Financial Controller agent (smart layer)** — cross-domain checks, proactive sweeps, advisory reports
2. **Switchboard governance (hard layer)** — spend caps, rate limits, risk scoring, audit trails — agents cannot bypass this

### Agent Internal Structure: Read vs. Write Split

- **Bookkeeper & FP&A:** Single agent each (mostly analytical, low write risk)
- **AP/AR & Treasury:** Read agent + Write agent each (money-moving actions get separate governance)
- Rationale: The read agent runs at high autonomy; the write agent goes through full governance pipeline

### Financial Controller Role

- **Reactive:** Gatekeeper — blocks actions until preconditions verified (e.g., AP/AR can't pay invoice until Bookkeeper reconciled it)
- **Proactive:** Scheduled sweeps — daily cross-domain consistency checks, finds leakage humans missed
- **Advisory:** Financial health reports, benchmarking, recommendations
- **Pricing:** FREE — drives adoption, makes governance the marketplace differentiator

### Data Sources (Adoption-First)

- **Phase 1:** Invoicing platforms (Xero, QuickBooks, FreshBooks) + receipt/expense tools (Dext, Expensify)
- **Phase 2:** Bank feeds (Plaid, Teller) — unlocked at higher trust tiers
- Rationale: Bank-level access at trust score 0 is a hard sell. Prove value on less sensitive data first.

---

## Architecture: Approach C — Domain Cartridges + Shared Finance SDK

### Package Structure

```
packages/finance-sdk/            — Shared types, currency math, reconciliation
                                   interfaces, leakage detection patterns
                                   (Layer 2, alongside cartridge-sdk)

cartridges/finance-bookkeeper/   — Transaction categorization, reconciliation,
                                   duplicate detection, anomaly flagging
cartridges/finance-fpa/          — Budgeting, variance analysis, forecasting,
                                   scenario modeling
cartridges/finance-ap-ar/        — Invoice management, payment processing,
                                   aging analysis, PO matching
                                   (internal read/write agent split)
cartridges/finance-treasury/     — Cash flow forecasting, fund transfers,
                                   liquidity optimization
                                   (internal read/write agent split)
cartridges/finance-controller/   — Cross-domain gating, proactive sweeps,
                                   advisory reports
```

### Dependency Rules

- `finance-sdk` imports from `schemas` only (Layer 2)
- All finance cartridges import from `schemas` + `cartridge-sdk` + `finance-sdk` + `core`
- Finance cartridges NEVER import from each other
- Controller uses cross-cartridge enrichment (existing core system) to query domain agent state
- New core capability needed: "precondition checks" in enrichment system (block-until-verified pattern)

### Agent Count Summary

| Marketplace Listing  | Internal Agents  | Trust Scored | Priced              |
| -------------------- | ---------------- | ------------ | ------------------- |
| Bookkeeper           | 1 (single)       | Yes          | Yes                 |
| FP&A                 | 1 (single)       | Yes          | Yes                 |
| AP/AR                | 2 (read + write) | Yes          | Yes                 |
| Treasury             | 2 (read + write) | Yes          | Yes                 |
| Financial Controller | 1 (orchestrator) | Yes          | Free                |
| **Total**            | **7 agents**     |              | **4 paid + 1 free** |

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   MARKETPLACE LISTINGS                    │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │Bookkeeper│ │  FP&A    │ │  AP/AR   │ │ Treasury │   │
│  │ (single) │ │ (single) │ │(read+    │ │(read+    │   │
│  │          │ │          │ │ write)   │ │ write)   │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│       │             │            │             │         │
│       └──────┬──────┴─────┬──────┘             │         │
│              │            │                    │         │
│  ┌───────────▼────────────▼────────────────────▼───┐    │
│  │     Financial Controller (FREE)                  │    │
│  │     Reactive gating + Proactive sweeps +         │    │
│  │     Advisory reports                             │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   SWITCHBOARD PLATFORM                    │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Governance   │  │ Trust Score  │  │ Audit Ledger  │  │
│  │ (spend caps, │  │ (per-agent,  │  │ (hash-chain,  │  │
│  │  rate limits,│  │  per-domain) │  │  tamper-proof) │  │
│  │  risk score) │  │              │  │               │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Leakage Prevention Mechanisms

### Platform Layer (Switchboard Governance — always active)

- Spend caps (per-action, daily, weekly, monthly)
- Rate limits (action frequency)
- Risk scoring (0-100, composite adjustments)
- Approval workflows (based on trust tier + risk level)
- Hash-chained audit ledger (tamper-evident)
- Fail-closed enrichment (if external API unreachable, assume worst case)

### Agent Layer (Financial Controller — when deployed)

- **Precondition gating:** AP/AR write actions blocked until Bookkeeper has reconciled the corresponding invoice
- **Duplicate detection sweeps:** Cross-reference payments, invoices, and ledger entries
- **Variance monitoring:** Continuous actuals-vs-budget checks, flag drifts before they compound
- **Anomaly detection:** Unusual patterns across domains (e.g., invoice from new vendor + large amount + no PO)
- **Advisory reports:** Weekly financial health summary, leakage risk assessment, benchmark comparison

### Trust-Gated Data Access

- Trust 0-29: Invoicing + receipt tools only
- Trust 30-54: + read-only bank feed access
- Trust 55+: + full bank feed read/write
- Rationale: Sensitive data access is earned, not default

---

## Open Design Questions (to resolve in next session)

1. **Finance SDK scope:** What exactly goes in the shared SDK vs. stays in individual cartridges?
2. **Controller precondition protocol:** How does the "block until verified" pattern work technically? Extension to cross-cartridge enrichment, or new interceptor type?
3. **Bookkeeper actions:** Full action manifest — what are the specific actions, risk levels, and parameters?
4. **Multi-currency:** Support from day one or defer?
5. **Reconciliation data model:** What does a reconciliation record look like in the DB?
6. **Controller scheduling:** How do proactive sweeps integrate with the existing agent runtime scheduler?
7. **Error handling philosophy:** When the Controller finds a discrepancy, what happens? Flag? Block? Auto-correct?
