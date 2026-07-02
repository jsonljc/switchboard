// Core types
export * from "./principals.js";
export * from "./agents.js";
export * from "./agent-types.js";
export * from "./risk.js";
export * from "./governance-profile.js";
export * from "./governance-verdict.js";
export * from "./governance-config.js";
export * from "./governance-gate-unit.js";
export * from "./set-gate-mode-in-config.js";
export * from "./set-market-in-config.js";
export * from "./identity-spec.js";
export * from "./role-overlay.js";
export * from "./policy.js";
export * from "./action.js";
export * from "./cartridge.js";
export * from "./cartridge-types.js";
export * from "./audit.js";

// Cockpit activity wire shape (ActivityKindSchema, ThreadMessageSchema, ActivityRowSchema)
export * from "./cockpit-activity.js";

// Chat types
export * from "./chat.js";

// v3 additions
export * from "./envelope.js";
export * from "./action-plan.js";
export * from "./decision-trace.js";
export * from "./resolver.js";
export * from "./undo.js";
export * from "./competence.js";

// MCP tool schemas
export * from "./mcp.js";

// Cross-cartridge integration
export * from "./data-flow.js";

// Capability descriptors (executor routing, step types)
export * from "./capability.js";

// Goal brief (structured goal decomposition)
export * from "./goal-brief.js";

export { LegacyRevenueEventSchema, LegacyRevenueEventSourceSchema } from "./revenue-event.js";
export type { LegacyRevenueEvent, LegacyRevenueEventSource } from "./revenue-event.js";

// Session runtime types
export * from "./session.js";

// Conversation thread (per-contact derived state)
export * from "./conversation-thread.js";

// Workflow execution types
export * from "./workflow.js";

// Scheduler trigger types
export * from "./scheduler.js";

// Operator command types
export * from "./operator-command.js";

// Unified lifecycle (Contact, Opportunity, Revenue, OwnerTask)
export * from "./lifecycle.js";

// Pipeline board view-model (opportunity cards + joined contact projection)
export * from "./pipeline-board.js";

// Contacts browse projection (surface-agnostic /contacts list view-model)
export * from "./contacts.js";

// Canonical E.164 phone helpers (normalizer, validator)
export * from "./phone.js";

// Event types (RoutedEventEnvelope, createEventEnvelope)
export * from "./event-types.js";

// Marketplace types (Agent Listings, Deployments, Tasks, Trust Scores)
export * from "./marketplace.js";

// Operational state (operator-confirmed business conditions; Riley v3 slice 4a)
export * from "./operational-state.js";

// Operational-state staleness policy (consumption-side; Riley v3 slice 4c)
export * from "./operational-state-policy.js";

// Reference metadata (skill reference YAML frontmatter contract)
export * from "./reference-metadata.js";

// Agent Persona (Sales Pipeline business context)
export * from "./agent-persona.js";

// Creative Pipeline (Performance Creative Director)
export * from "./creative-job.js";
// Agent-synergy handoff seams (Governed Handoff Contract Freeze)
export * from "./creative-concept-draft.js";

// UGC v2 — Creative Pipeline
export * from "./ugc-job.js";
export * from "./creator-identity.js";
export * from "./asset-record.js";
export * from "./identity-strategy.js";
export * from "./provider-capabilities.js";
export * from "./realism-score.js";
export * from "./funnel-friction.js";

// Deployment Memory (three-tier agent memory system)
export * from "./deployment-memory.js";

// Three-Channel Communication (trust levels, notification tiers, agent events, activity log)
export * from "./three-channel.js";

// Ad Optimizer (campaign insights, funnel analysis, audit reports)
export * from "./ad-optimizer.js";

// Ad Optimizer V2 (trends, budget, creative, saturation)
export * from "./ad-optimizer-v2.js";

// Lead Intake (CTWA + Instant Form attributed lead events)
export * from "./lead-intake.js";

// Async failure envelope (Inngest retry-exhaustion contract, Route Governance §13 seam)
export * from "./async-failure.js";

// Knowledge entries (curated playbooks, policies, domain guidance)
export * from "./knowledge.js";

// Temporal Fact (entity-scoped temporal fact system)
export * from "./temporal-fact.js";

export * from "./conversion.js";
export * from "./calendar.js";
export * from "./payment.js";
export * from "./receipt.js";
export * from "./receipted-booking.js";
export * from "./receipted-booking-reconcile.js";
export * from "./crm.js";

// CRM Outcome types (shared across ad-optimizer + db)
export * from "./crm-outcome.js";

// Playbook (structured onboarding playbook)
export * from "./playbook.js";

// Website scan (lightweight homepage extraction)
export * from "./website-scan.js";

// Dashboard aggregate (operator dashboard overview)
export * from "./dashboard.js";

// Home summary tile-state contract (home kpi strip)
export * from "./home-summary.js";

// Approval Lifecycle (approval lifecycle authority objects)
export * from "./approval-lifecycle.js";

// Approval state machine types (hoisted from core per RGC v1 §8.1)
export * from "./approval.js";

// Handoff canonical shape (hoisted from core per RGC v1 §8.3)
export * from "./handoff.js";

// API conversation projections (wire shapes for /api/conversations)
export * from "./conversations.js";

// PCD Identity Registry
export * from "./pcd-identity.js";

// Recommendations (surface, status, action enums + canonical input shape)
export * from "./recommendations.js";
// Riley -> agent recommendation handoff payload (Governed Handoff Contract Freeze §4.3)
export * from "./recommendation-handoff.js";
export * from "./riley-pause-execution.js";
// Spec-1B act leg: the executed-reallocation success receipt (persisted to WorkTrace.executionOutputs)
export * from "./execution-receipt.js";
// Spec-1B act leg: the frozen, human-approved reallocate parameters the executor replays
export * from "./riley-budget-execution.js";
// Spec-1B act leg: the frozen parameters the automated reset-to-prior rollback executor replays
export * from "./riley-reset-budget-execution.js";

// Reports v1 view-model (operator deep-dive surface)
export * from "./reports/v1.js";
// Weekly owner-report digest (Ledger-lite v1 delivery content model)
export * from "./reports/weekly-digest.js";

// Claim classifier (Layer 2 classifier output types — Alex medspa governance)
export * from "./claim-classifier.js";

// Substantiation (Layer 3 source types + resolution outcome — Alex medspa governance)
export * from "./substantiation.js";

// PDPA consent types (per-jurisdiction governance state + canonical gate)
export * from "./pdpa-consent.js";

// Qualification Signals (sidecar payload + persisted discriminated-union — Alex medspa Phase 3b)
export * from "./qualification-signals.js";

// Intent class + template category enums (WhatsApp template routing — Alex medspa 1d)
export * from "./intent-class.js";

// Conversation Lifecycle (state machine enums + precedence comparator — Alex medspa Phase 3a)
export * from "./conversation-lifecycle.js";

// WhatsApp send-test schemas (slice 2a — request/result/row for operator send-test flow)
export * from "./whatsapp-test-send.js";
export * from "./whatsapp-template-create.js";

// Canonical-key enum + Zod refinement (PR-3.2a — outcome-pattern bucketing)
export * from "./canonical-keys.js";

// Scheduled reminder status + dedupe key (PR-4 — appointment reminders)
export * from "./scheduled-reminder.js";

// Outcome-pattern surfacing config (PR-3.2e — per-deployment pilotMode flag)
export * from "./outcome-patterns-config.js";

// Ad-optimizer config (per-deployment targetCPA/targetROAS/monthlyBudget)
export * from "./ad-optimizer-config.js";

// Runtime-shape agent persona overlay (distinct from agent-persona.ts which
// models the full DB row — this is the inputConfig overlay used by core
// DeploymentContext)
export * from "./agent-persona-config.js";

// Deployment governance policy overrides (top-level AgentDeployment columns)
export * from "./policy-overrides-config.js";

// PR-3: Allowlisted directional copy for "observed" activity rows
export {
  ALLOWLISTED_TEMPLATES,
  TRUST_DELTA_COPY,
  renderOutcomeCopy,
  renderTrustDeltaCopy,
  type OutcomeCopyTemplate,
  type OutcomeCopyValues,
} from "./recommendation-outcome-copy.js";

// Mira Director's Desk — open-brief schema, mapping, and intent classifier (PR3)
export * from "./mira-brief.js";

// Mira slice-4 brain — compose request/output contract + parser
export * from "./mira-compose.js";

// Scheduled follow-up types
export * from "./scheduled-follow-up.js";

// Robin v1 no-show recovery campaign params (the frozen cohort the manager approves)
export * from "./robin-recovery.js";

// Robin v1 recovery-send dedup key + status (the per-recipient send log)
export * from "./robin-recovery-send.js";

// Open, fail-closed market registry (L1 S2-1): generalizes Jurisdiction beyond the
// closed SG/MY union; currencyForJurisdiction stays the legacy chokepoint, untouched.
export * from "./market-registry.js";
