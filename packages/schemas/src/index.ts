// Core types
export * from "./principals.js";
export * from "./agents.js";
export * from "./agent-types.js";
export * from "./risk.js";
export * from "./governance-profile.js";
export * from "./governance-verdict.js";
export * from "./governance-config.js";
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

// Event types (RoutedEventEnvelope, createEventEnvelope)
export * from "./event-types.js";

// Marketplace types (Agent Listings, Deployments, Tasks, Trust Scores)
export * from "./marketplace.js";

// Reference metadata (skill reference YAML frontmatter contract)
export * from "./reference-metadata.js";

// Agent Persona (Sales Pipeline business context)
export * from "./agent-persona.js";

// Creative Pipeline (Performance Creative Director)
export * from "./creative-job.js";

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

// Knowledge entries (curated playbooks, policies, domain guidance)
export * from "./knowledge.js";

// Temporal Fact (entity-scoped temporal fact system)
export * from "./temporal-fact.js";

export * from "./conversion.js";
export * from "./calendar.js";
export * from "./crm.js";

// CRM Outcome types (shared across ad-optimizer + db)
export * from "./crm-outcome.js";

// Playbook (structured onboarding playbook)
export * from "./playbook.js";

// Website scan (lightweight homepage extraction)
export * from "./website-scan.js";

// Dashboard aggregate (operator dashboard overview)
export { DashboardOverviewSchema, type DashboardOverview } from "./dashboard.js";

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

// Reports v1 view-model (operator deep-dive surface)
export * from "./reports/v1.js";

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

// Canonical-key enum + Zod refinement (PR-3.2a — outcome-pattern bucketing)
export * from "./canonical-keys.js";

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
  renderOutcomeCopy,
  type OutcomeCopyTemplate,
  type OutcomeCopyValues,
} from "./recommendation-outcome-copy.js";
