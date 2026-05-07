---
name: Revenue OS Pivot
description: Strategic pivot from agent marketplace to revenue operating system with 3 modules (Creative, Ad Optimizer, Lead-to-Booking). Marketplace substrate preserved, product surface replaced.
type: project
originSessionId: 901a2b3c-78e5-489d-bfe0-84e0c169c3bc
---

Switchboard is pivoting from "agent marketplace" to "revenue operating system for service businesses" with three modules: Convert Leads, Create Ads, Improve Spend.

**Why:** Marketplace is a packaging layer that introduces catalog/discovery/pricing complexity before proving core revenue value. The three modules form a closed-loop revenue engine (creative → ads → booking → attribution feedback). Marketplace earns the right to exist only after the wedge proves out.

**How to apply:**

- Marketplace data model (AgentDeployment, DeploymentConnection, trust scores) stays as internal control-plane substrate
- Product surface is module-based: module cards, setup wizards, module detail pages
- No new features should be designed around "marketplace" or "agent catalog" concepts
- If a feature doesn't improve one of the three loops in 90 days, it's not core
- Pass 1 spec: `docs/superpowers/specs/2026-04-23-revenue-control-center-pivot-design.md`
- Pass 1 = authenticated dashboard UX pivot only. Public site is a separate pass.
- Key invariant: canonical routes are module-based (`/modules/[module]`), deployment IDs are internal
