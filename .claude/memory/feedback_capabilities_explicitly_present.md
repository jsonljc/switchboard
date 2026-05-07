---
name: Capabilities must be explicitly present
description: System-wide design rule — capabilities must be declared present, never implicitly assumed. Applied to tools, intelligence, infra, simulation.
type: feedback
originSessionId: ce279968-e518-40a8-9dfc-7670d740c16c
---

Capabilities must be explicitly present, not implicitly assumed.

**Why:** This is what distinguishes Switchboard from demo systems and agent wrappers. Implicit assumptions (fake embeddings, placeholder IDs, stub providers that silently fail) create false confidence and require rewrites later. Explicit capability declaration earns trust early.

**How to apply:** When any capability is unavailable (embedding provider, calendar, tool identity, side effects), the system must: (1) declare the state explicitly via a capability flag or typed error, (2) never emulate with outputs that look real but aren't, (3) surface the degradation visibly in UI/audit/traces. This applies to tools, intelligence layers, infrastructure providers, and simulation boundaries.
