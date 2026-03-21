// ---------------------------------------------------------------------------
// Action type string literal unions for the digital-ads cartridge.
// Extracted from types.ts to keep individual files under the 600-line limit.
// ---------------------------------------------------------------------------

export type ReadActionType =
  | "digital-ads.platform.connect"
  | "digital-ads.funnel.diagnose"
  | "digital-ads.portfolio.diagnose"
  | "digital-ads.snapshot.fetch"
  | "digital-ads.structure.analyze"
  | "digital-ads.health.check"
  // Phase 1: Reporting
  | "digital-ads.report.performance"
  | "digital-ads.report.creative"
  | "digital-ads.report.audience"
  | "digital-ads.report.placement"
  | "digital-ads.report.comparison"
  | "digital-ads.auction.insights"
  // Phase 2: Signal Health
  | "digital-ads.signal.pixel.diagnose"
  | "digital-ads.signal.capi.diagnose"
  | "digital-ads.signal.emq.check"
  | "digital-ads.account.learning_phase"
  | "digital-ads.account.delivery.diagnose"
  // Phase 3: Audience (read-only)
  | "digital-ads.audience.list"
  | "digital-ads.audience.insights"
  // Phase 4: Budget (read-only)
  | "digital-ads.budget.recommend"
  // Phase 5: Creative (read-only)
  | "digital-ads.creative.list"
  | "digital-ads.creative.analyze"
  | "digital-ads.creative.generate"
  | "digital-ads.creative.score_assets"
  | "digital-ads.creative.generate_brief"
  // Phase 6: A/B Testing (read-only)
  | "digital-ads.experiment.check"
  | "digital-ads.experiment.list"
  // Phase 7: Optimization (read-only)
  | "digital-ads.optimization.review"
  | "digital-ads.rule.list"
  // Phase 8: Strategy (read-only)
  | "digital-ads.strategy.recommend"
  | "digital-ads.strategy.mediaplan"
  | "digital-ads.reach.estimate"
  // Phase 9: Compliance & Brand Safety (read-only)
  | "digital-ads.compliance.review_status"
  | "digital-ads.compliance.audit"
  // Phase 9: Measurement & Attribution (read-only)
  | "digital-ads.measurement.lift_study.check"
  | "digital-ads.measurement.attribution.compare"
  | "digital-ads.measurement.mmm_export"
  // Phase 10: Pacing
  | "digital-ads.pacing.check"
  // Phase 11: Alerting
  | "digital-ads.alert.anomaly_scan"
  | "digital-ads.alert.budget_forecast"
  | "digital-ads.alert.policy_scan"
  // Phase 12: Forecasting
  | "digital-ads.forecast.budget_scenario"
  | "digital-ads.forecast.diminishing_returns"
  // Phase 12b: Annual Planning
  | "digital-ads.plan.annual"
  | "digital-ads.plan.quarterly"
  // Phase 13: Catalog
  | "digital-ads.catalog.health"
  // Phase 14: Notifications
  | "digital-ads.alert.send_notifications"
  // Phase 15: Creative Testing Queue
  | "digital-ads.creative.test_queue"
  | "digital-ads.creative.test_evaluate"
  | "digital-ads.creative.power_calculate"
  // Phase 16: Account Memory
  | "digital-ads.memory.insights"
  | "digital-ads.memory.list"
  | "digital-ads.memory.recommend"
  | "digital-ads.memory.export"
  // Custom KPI
  | "digital-ads.kpi.list"
  | "digital-ads.kpi.compute"
  // Cross-Platform Deduplication
  | "digital-ads.deduplication.analyze"
  | "digital-ads.deduplication.estimate_overlap"
  // Geo-Holdout Experiments (read-only)
  | "digital-ads.geo_experiment.design"
  | "digital-ads.geo_experiment.analyze"
  | "digital-ads.geo_experiment.power"
  // Multi-Touch Attribution (read-only)
  | "digital-ads.attribution.multi_touch"
  | "digital-ads.attribution.compare_models"
  | "digital-ads.attribution.channel_roles"
  // LTV Optimization (read-only)
  | "digital-ads.ltv.project"
  | "digital-ads.ltv.optimize"
  | "digital-ads.ltv.allocate"
  // Seasonality (read-only)
  | "digital-ads.seasonal.calendar"
  | "digital-ads.seasonal.events";

export type WriteActionType =
  | "digital-ads.campaign.pause"
  | "digital-ads.campaign.resume"
  | "digital-ads.campaign.adjust_budget"
  | "digital-ads.campaign.create"
  | "digital-ads.campaign.update_objective"
  | "digital-ads.campaign.setup_guided"
  | "digital-ads.adset.pause"
  | "digital-ads.adset.resume"
  | "digital-ads.adset.adjust_budget"
  | "digital-ads.adset.create"
  | "digital-ads.ad.create"
  | "digital-ads.targeting.modify"
  // Phase 3: Audience (writes)
  | "digital-ads.audience.custom.create"
  | "digital-ads.audience.lookalike.create"
  | "digital-ads.audience.delete"
  // Phase 4: Bid & Budget
  | "digital-ads.bid.update_strategy"
  | "digital-ads.budget.reallocate"
  | "digital-ads.budget.increase"
  | "digital-ads.budget.decrease"
  | "digital-ads.schedule.set"
  // Phase 5: Creative (writes)
  | "digital-ads.creative.upload"
  | "digital-ads.creative.rotate"
  // Phase 6: A/B Testing (writes)
  | "digital-ads.experiment.create"
  | "digital-ads.experiment.conclude"
  // Phase 7: Optimization (writes)
  | "digital-ads.optimization.apply"
  | "digital-ads.rule.create"
  | "digital-ads.rule.delete"
  // Phase 9: Compliance & Brand Safety (writes)
  | "digital-ads.compliance.publisher_blocklist"
  | "digital-ads.compliance.content_exclusions"
  // Phase 9: Measurement & Attribution (writes)
  | "digital-ads.measurement.lift_study.create"
  // Phase 10: Pacing (writes)
  | "digital-ads.pacing.create_flight"
  | "digital-ads.pacing.auto_adjust"
  // Phase 13: Catalog (writes)
  | "digital-ads.catalog.product_sets"
  // Phase 14: Notifications (writes)
  | "digital-ads.alert.configure_notifications"
  // Phase 15: Creative Testing Queue (writes)
  | "digital-ads.creative.test_create"
  | "digital-ads.creative.test_conclude"
  // Phase 16: Account Memory (writes)
  | "digital-ads.memory.record"
  | "digital-ads.memory.record_outcome"
  | "digital-ads.memory.import"
  // Custom KPI (writes)
  | "digital-ads.kpi.register"
  | "digital-ads.kpi.remove"
  // Geo-Holdout Experiments (writes)
  | "digital-ads.geo_experiment.create"
  | "digital-ads.geo_experiment.conclude"
  // Seasonality (writes)
  | "digital-ads.seasonal.add_event";

export type ActionType = ReadActionType | WriteActionType;
