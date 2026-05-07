---
name: WhatsApp Completeness Project
description: Making WhatsApp a complete revenue-critical service — Tech Provider onboarding + messaging richness, two parallel tracks
type: project
originSessionId: 77d31b66-51bf-48a9-aa58-5f2980e1cf13
---

## Status

Design phase — brainstorming Approach C (parallel tracks) approved 2026-04-25.

## Key Decisions

- **Tech Provider path** (not BSP) — self-service, no Meta contract, clients pay Meta directly
- **Approach C** — two independent parallel tracks (onboarding + messaging)
- **Revenue-critical scope only** — no commerce, reactions, stickers, broadcasts
- **BYO AI confirmed** — 3P bot (`automated_type=3p_full`) is fully supported, no requirement to use Meta AI
- **Embedded Signup v4** (Unified Onboarding, GA Oct 2025) — single-screen asset selector
- **Single SUAT model** — ES returns short-lived user token, used once for debug_token then discarded. Switchboard's own permanent SUAT manages all client WABAs via assigned_users. No per-client tokens.
- **Phase 0 (Meta App Review) started but not complete** — business verification done, app review videos still needed (app icon, privacy policy, 2 videos: send message + create template). User will come back to this.
- **TP Config** should request Cloud API only — minimize asset pickers for better conversion (baseline ~29% conversion rate)

## Track 1: Onboarding (blocked on Phase 0 approval for go-live, code can be built)

- Embedded Signup in dashboard (Meta JS SDK, FB.login)
- BISU token → DeploymentConnection (encrypted)
- Programmatic webhook registration via Graph API
- Bot profile setup (automated_type=3p_full)
- Manual credential path stays as fallback

## Track 2: Messaging (no blockers)

- Delivery status webhooks (statuses[] parsing)
- Read receipts (mark as read API)
- Media sending (images, documents)
- Media receiving (parse + download via Media API)
- WhatsApp Flows (structured booking form)
- Message deduplication (Redis)

**Why:** WhatsApp is the primary channel for Alex's lead-to-booking wedge. Completeness directly impacts conversion rate and client self-serve onboarding.

**How to apply:** Track 2 can start immediately. Track 1 code can be built but can't go live until Phase 0 (Meta App Review) completes.
