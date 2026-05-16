# fixture-schema-alignment

**Charter:** Static verification of seed/fixture files against current schema + canonical agent names.

**Method:** Read-only static analysis of:

1. `packages/db/prisma/seed-marketplace.ts` (972 LOC)
2. `packages/db/prisma/seed.ts` (618 LOC)
3. `packages/db/prisma/fixtures/demo-conversations.ts` (471 LOC)
4. `packages/db/prisma/fixtures/demo-knowledge.ts` (400+ LOC)
5. Schema validation against `packages/db/prisma/schema.prisma`
6. Canonical agent name verification against memory files

**Scope exclusions applied:** None — all seed files within scope.

## Findings

### Clean Pass — No Issues Found

**(a) Schema Field Coverage**

- **AgentListing**: All referenced fields exist (name, description, slug, type, status, taskCategories, metadata, trustScore, autonomyLevel, priceTier, priceMonthly). Status values ("listed") and autonomyLevel values match schema defaults.
- **AgentDeployment**: All referenced fields exist; status value ("active") matches schema.
- **AgentTask**: All referenced fields exist.
- **TrustScoreRecord**: All referenced fields exist; foreign key to AgentListing properly established.
- **OrganizationConfig**: All referenced fields exist.
- **KnowledgeEntry**: All referenced fields exist; enum values ("knowledge", "playbook", "policy") match KnowledgeKind enum exactly.

**(b) Canonical Agent Name Alignment**

- Per memory: canonical agents are **Alex** (lead-to-speed), **Riley** (ad-optimizer), **Mira** (creative)
- `alex-conversion` listing created with skillSlug="alex" ✓
- `ad-optimizer` listing created (Riley's domain) ✓
- No "nova" or "jordan" strings found in any seed or fixture file ✓
- Demo conversations reference only canonical slugs: "speed-to-lead", "sales-closer", "nurture-specialist" ✓

**(c) Fixture Relation Resolution**

- Demo conversations reference agent slugs created as AgentListing entries before deployment attempts ✓
- Deployments look up listings by slug with proper fallback logging ✓
- Demo knowledge KnowledgeEntry uses valid enum values ✓
- Trust score records reference valid listingIds ✓

**(d) Enum and String Value Audit**
All status/type/tier values match schema:

- autonomyLevel: "supervised", "guided", "autonomous" ✓
- priceTier: "free", "basic", "pro", "elite" ✓
- status: "listed", "active" ✓
- reviewResult: "approved", "rejected" ✓
- type: "switchboard_native" ✓

## Summary

- Seed files audited: 4 primary files
- Stale field references found: **0**
- Canonical-name violations: **0**
- Enum mismatches: **0**
- Relation orphans: **0**
- **Status: PASS** — All seed/fixture data aligns with current schema and canonical naming.

## Out of scope / deferred for this lane

- Runtime execution verification (charter: static analysis only)
- Database connectivity test (Postgres unreachable per worktree-init)
- Demo conversation content review (formatting/tone)
- Performance or indexing analysis on seeded data
