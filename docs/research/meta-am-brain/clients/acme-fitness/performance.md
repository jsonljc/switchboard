# Acme Fitness: Performance Snapshot

<!-- WORKED EXAMPLE: fictional numbers. GENERATED class; 7-day shelf life per claim. -->

```yaml
as_of: 2026-06-05
source: <internal dashboard link / export 2026-06-05>

snapshot:
  spend_last_30d: "$38,400"
  primary_kpi: "cost per trial signup: $52 (their target: <$45)"
  kpi_trend_mom: "+9% (worsening)"
  emq_lead: 4.2
  server_event_coverage: "0 server events / last 30d"
  ios_share_of_conversions: "71%"
  creative: { active_ads: 4, oldest_active_days: 62, frequency_7d: 3.8 }
  delivery_flags: ["1 adset learning limited (since 2026-05-26)"]

anomalies:
  - metric: "hero ad CTR"
    observation: "-22% over 3 weeks"
    window: 2026-05-15..2026-06-05
    possible_cause: "creative fatigue (hypothesis: oldest ad 62d + frequency trend supports it)"
  - metric: "cost per trial"
    observation: "week-to-week swings up to 26% without spend changes"
    window: 2026-05-01..2026-06-05
    possible_cause: "thin signal (EMQ 4.2, pixel-only) makes optimization + measurement noisy: hypothesis, supports RS-2026-04412"
```
