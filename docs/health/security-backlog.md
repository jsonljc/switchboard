# Security Backlog

Seeded from the comprehensive audit conducted on 2026-03-16.
Check items off as they are fixed. `/gate weekly` counts unchecked items.

---

## Critical

- [ ] C1: SSRF via webhook URL — `apps/api/src/routes/webhooks.ts:168`
      User-controlled URL fetched without SSRF protection (internal network scanning, cloud credential theft)

- [ ] C2: Missing org-scoping on business config — `apps/api/src/routes/business-config.ts:24-37`
      Any authenticated user can read/overwrite another org's business configuration

- [ ] C3: Missing org-scoping on deployment readiness — `apps/api/src/routes/deployment.ts:23-24`
      Leaks whether an org exists and its channel count

- [ ] C4: CRM getContact/updateContact/archiveContact missing org filter — `packages/db/src/storage/prisma-crm-provider.ts:39-45`
      Cross-tenant PII exposure via ID guessing

## High

- [ ] H1: PII logged in webhook handler — `apps/api/src/routes/inbound-webhooks.ts:149-156`
      Email addresses logged in plain text

- [ ] H2: Facebook webhook signature not timing-safe — `apps/api/src/routes/inbound-webhooks.ts:141`

- [ ] H3: Booking webhook signature not timing-safe — `apps/api/src/routes/inbound-webhooks.ts:229`

- [ ] H4: Facebook verify token not timing-safe — `apps/api/src/routes/inbound-webhooks.ts:304-308`

- [ ] H5: Internal API secret not timing-safe — `apps/chat/src/main.ts:247`

- [ ] H6: Connection store list() without org returns all connections — `packages/db/src/storage/prisma-connection-store.ts:91-97`

- [ ] H7: No Zod validation on org config PUT body — `apps/api/src/routes/org-config.ts:58-66`

- [ ] H8: No Zod validation on channel provisioning body — `apps/api/src/routes/org-channels.ts:32-44`

## Medium

- [ ] M1: Stripe webhook bypasses governance — `apps/api/src/routes/inbound-webhooks.ts:332`
      Direct cartridge execution skips policy evaluation and audit

- [ ] M2: Chat server has no global auth middleware — `apps/chat/src/main.ts`

- [ ] M3: Forms endpoint accepts unverified submissions — `apps/api/src/routes/inbound-webhooks.ts:83-114`

- [ ] M4: No default pagination limit on audit queries — `apps/api/src/routes/audit.ts:46`

- [ ] M5: Idempotency key has no length limit — `apps/api/src/middleware/idempotency.ts:60`

- [ ] M6: Org config PUT has no role check — `apps/api/src/routes/org-config.ts:39`

- [ ] M7: CRM archiveDeal/archiveContact missing org filter — `packages/db/src/storage/prisma-crm-provider.ts:185,215`

## Production Resilience

- [ ] P1: No execution timeout on cartridge calls — `packages/core/src/orchestrator/execution-manager.ts:136`

- [ ] P2: No unhandled rejection handler — `apps/api/src/server.ts`, `apps/chat/src/main.ts`

- [ ] P3: No optimistic concurrency on envelope updates — `packages/db/src/storage/prisma-envelope-store.ts:65`

- [ ] P4: Envelope save-then-update not atomic — `packages/core/src/orchestrator/propose-pipeline.ts:283`

- [ ] P5: InMemoryConversationStore grows without bound — `apps/chat/src/conversation/store.ts:10`

- [ ] P6: Approval notifications fire-and-forget — `packages/core/src/orchestrator/propose-pipeline.ts:849`

- [ ] P7: Enrichment failures silently degrade to medium risk — `packages/core/src/orchestrator/propose-helpers.ts:286`

- [ ] P8: ESLint doesn't block core from importing cartridges — `.eslintrc.json:141-172`
