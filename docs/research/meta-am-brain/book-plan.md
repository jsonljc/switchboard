# Book Plan: 2026-06

<!-- EXAMPLE with placeholder targets. HUMAN-OWNED: the agent may draft next month's plan, you set the numbers. -->
<!-- CALIBRATE: ci_target, rs_close_target, and solution mix must come from the real scorecard, not this file. -->

```yaml
month: 2026-06
working_days: 22

targets:
  ci_target: 120 # PLACEHOLDER: replace with real quota + counting rule
  rs_close_target: 40 # PLACEHOLDER
  revenue_growth_target: "+8% book spend MoM" # PLACEHOLDER

strategic_solution_mix: # anti-over-pitching guardrail; coverage/solutions.md tracks drift
  capi: 20%
  advantage_plus: 25%
  creative_diversification: 25%
  messaging: 20%
  other: 10%

priority_clients: # by book strategy: tier = grow | defend | maintain
  - client: acme-fitness
    tier: grow
    required_touches: 4
    reason: "CAPI gap is the biggest single unlock; relationship warm after May creative audit"
  - client: bravo-retail
    tier: defend
    required_touches: 3
    reason: "spend -18% MoM; churn risk; Q2 program commitment on advantage_plus"
  - client: delta-beauty
    tier: grow
    required_touches: 3
    reason: "creative fatigue measurable; receptive buyer; monthly review cadence"
  - client: echo-dental
    tier: maintain
    required_touches: 2
    reason: "stable spend; untouched since 2026-05-12; messaging fit unexplored"
  - client: foxtrot-cafe
    tier: maintain
    required_touches: 2
    reason: "small but growing; quick wins available; low effort"
  # ... remaining 25-45 clients default to tier: maintain, required_touches: 1
```

## Month strategy notes (3 lines max)

- Recover creative_diversification and messaging coverage: both badly under plan in May.
- bravo-retail is the defend priority; lead with value delivery, not pitches, until mood recovers.
- Push CAPI closes before Q3 planning windows open.
