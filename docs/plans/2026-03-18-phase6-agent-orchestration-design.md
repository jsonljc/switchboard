# Phase 6: Agent Orchestration Layer — Design Doc

## Problem

The agent layer (`packages/agents`) and cartridge layer have overlapping logic, creating double execution. The Lead Responder calls `deps.scoreLead()` to decide qualification, then emits an action request `customer-engagement.lead.qualify` which re-scores the lead through the cartridge. The lead is scored twice for the same event.

Additionally, the current system is event-reactive but has no orchestration. Only 2 of 5 agents exist (Lead Responder, Sales Closer partial). Events flow into the system but dead-end because no downstream agents listen. The UI presents a full "AI team" that the backend doesn't yet support.

## Solution: Read/Write Split (Approach A)

**Core principle:** Reads don't need governance, only writes do.

- Agent handlers call **read functions** directly via dependency injection — scoring, matching, analysis, availability checks. No policy check, no double execution.
- Agent handlers emit **action requests** only for **write operations** — booking appointments, sending messages, adjusting budgets. These go through the orchestrator → policy engine → cartridge execution.
- The existing event bus (router → dispatcher) chains agents together. When Lead Responder emits `lead.qualified`, the router resolves it to Sales Closer + connectors.

**What changes:**

1. Remove `customer-engagement.lead.qualify` action request from Lead Responder (scoring is a read)
2. Reclassify all cartridge operations as READ or WRITE
3. Agent handlers get injected deps for reads, emit action requests for writes
4. Build remaining agents (Nurture, Ad Optimizer, Revenue Tracker)
5. Add agent state tracking to power the dashboard UI

**What stays the same:**

- Event envelope format, router, dispatcher, delivery store, policy bridge
- Cartridge manifests, governance, layer enforcement
- AgentPort, AgentHandler, AgentResponse interfaces
- Connector framework (HubSpot adapter)

## Agent-Cartridge Map

See `docs/plans/agent-cartridge-map.md` for the full infrastructure map with implementation status per operation.

## Event Chain

```
lead.received
    → Lead Responder (score, qualify)
        → lead.qualified
            → Sales Closer (book/quote/checkout)
            → Connectors (HubSpot, etc.)
                → stage.advanced
                    → Nurture Agent (reminders, follow-ups)
                    → revenue.recorded
                        → Revenue Tracker (attribute, send to ad platforms)
                            → revenue.attributed
                                → Ad Optimizer (adjust budgets based on ROAS)
                                    → ad.optimized
        → lead.disqualified
            → Nurture Agent (cold nurture cadence)
            → Connectors (update contact)
```

## Implementation Phases

- **Phase 6A:** Architecture fixes — read/write split, agent state tracking
- **Phase 6B:** Complete existing agents — Lead Responder FAQ, Sales Closer deps
- **Phase 6C:** New agents — Nurture, Ad Optimizer, Revenue Tracker
