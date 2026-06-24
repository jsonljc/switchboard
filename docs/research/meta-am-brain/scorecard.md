# Scorecard: 2026-06

<!-- GENERATED format (Phase 2 automates). In Phase 0 you update the counts each morning: ~2 minutes. -->
<!-- EXAMPLE DATA, consistent with book-plan.md placeholders. -->

```yaml
month: 2026-06
as_of: 2026-06-08 (morning)
working_day: 6 of 22 # days 1-5 completed

ci:
  target: 120
  completed: 21
  required_run_rate: 5.45/day # target / working days
  actual_run_rate: 4.2/day # completed / days elapsed
  required_from_today: 5.8/day # (target - completed) / days remaining (17)
  pacing_status: behind # ahead | on_pace | behind | critical

rs:
  close_target: 40
  closed: 6
  pitched_this_month: 16
  required_close_rate_from_today: 2.0/day

coverage:
  clients_untouched_this_month: [echo-dental, foxtrot-cafe]
  clients_below_required_touches: [bravo-retail] # 1 of 3
  rs_categories_undercovered: [creative_diversification, messaging]

commitments_overdue: 1 # see today.md section 5

top_recovery_actions:
  - client: echo-dental
    recommended_solution: none # coverage touch: May performance recap
    evidence: "untouched 27d; stable spend; recap is a legitimate CI"
    draft_ready: true
  - client: foxtrot-cafe
    recommended_solution: none # coverage touch: quick-win flag
    evidence: "untouched 22d; 2 ads in learning-limited >14d (quick fix)"
    draft_ready: true
  - client: delta-beauty
    recommended_solution: creative_diversification
    evidence: "3 of 4 active ads >45d old; frequency 6.2; meeting today 14:00"
    draft_ready: true
```

**Verdict line:** behind but recoverable: one strong coverage week (6+ CIs/day through Friday) restores pace. Recovery actions outrank opportunistic pitches until `pacing_status: on_pace`.
