---
name: Pre-Launch Hardening C Program
description: Staged hardening program (3 tracks) executed 2026-04-22. Full audit → fix broken flows, nav, persistence, error contracts, api-client split.
type: project
originSessionId: 46d935c6-972e-4b53-9386-2257b7b4fd15
---

Pre-launch hardening completed 2026-04-22 via PR #239 (auto-merge enabled, pending CI).

**Why:** Full-stack audit before public launch. Every user-visible broken flow, navigation gap, fake persistence, and misleading UI surface needed fixing.

**How to apply:** Guard these invariants — don't reintroduce the patterns that were fixed.

## 5 Locked Decisions

1. `/agents` = canonical public catalog (SSR/SEO). Public `/marketplace` redirects to `/agents`. Auth `/marketplace` = operational Hire tab.
2. Error contract: every non-2xx response returns `{ error: string; statusCode: number }`. No plain text, no `{ message }`, no empty body.
3. Identity persistence = API-backed (agent roster `config` field). No localStorage.
4. Channel status = binary (connected / not connected). Health test = transient feedback only.
5. Creative pipeline UI gated behind `listing.metadata.family === "creative"` (structural: no render, no fetch).

## Track 1 — Launch-Critical Repair (16 commits)

- Fixed `updateTask` path (was 404ing) and `getBusinessFacts`/`upsertBusinessFacts` (non-existent endpoint)
- Added `PrismaDeploymentStore.update()` with inputConfig merge semantics
- Added GET + PATCH `/api/marketplace/deployments/:id`
- Auth marketplace page for Hire tab, public /marketplace → /agents redirect
- /tasks folded into Decide as third tab (old route redirects)
- Nav links: /my-agent and /dashboard/roi from Today, Playbook on Me page
- Removed Connections tab from Account (Channels is canonical)
- Fixed #test-lead dead anchor → /my-agent
- Identity settings rewired from localStorage to roster API
- Removed hardcoded agentId="creative" from knowledge page
- Widget token shows "no widget connected" instead of using deploymentId
- Creative pipeline structurally gated
- Deleted 13 dead code files (old onboarding wizard + mission-control), 1,088 lines removed

## Track 2 — Consistency Hardening (7 commits)

- Created `proxyError()` helper for normalized proxy error responses
- Rewired ROI and operator-chat proxies from raw fetch to getApiClient()
- Added statusCode to all backend error responses (~29 route files)
- Migrated all 56 proxy routes to proxyError() helper
- Added proxyError tests

## Track 3 — Structural Cleanup (3 commits)

- Split 730-line api-client.ts into 7 domain modules (core, governance, settings, marketplace, agents, dashboard, knowledge) via class inheritance chain
- Fixed widget embed script URL (was pointing to dashboard, now points to chat server)
- Channel flow audit: Widget partially works, Telegram works, WhatsApp not implemented as self-service

## Key File Paths

- Spec: `docs/superpowers/specs/2026-04-22-pre-launch-hardening-design.md`
- Plans: `docs/superpowers/plans/2026-04-22-pre-launch-hardening-track1-phase{A,B}.md`
- proxyError helper: `apps/dashboard/src/lib/proxy-error.ts`
- api-client modules: `apps/dashboard/src/lib/api-client/` (core, governance, settings, marketplace, agents, dashboard, knowledge, index)
