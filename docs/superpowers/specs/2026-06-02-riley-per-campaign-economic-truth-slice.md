# Riley per-campaign economic truth — PR1 substrate (slice design)

- **Date:** 2026-06-02
- **Status:** Approved (brainstorming). Implementation plan via writing-plans next.
- **Author:** Jason + Claude
- **Umbrella spec:** [`2026-06-02-riley-autonomous-ad-operator-design.md`](./2026-06-02-riley-autonomous-ad-operator-design.md) — §3 Gate 4 ("the keystone projection"), §9 Phase B, §12 seam table. This slice implements the §12 **"Per-campaign booked-CAC"** + **"byCampaign projection"** seam (FINDINGS 2.1/2.2, D3 R1/R2) as the **first, uncontested half**.
- **Builds on:** #819 (`9fb9ec4b`) — booked events now stamp `sourceCampaignId` + `value` (cents) onto `ConversionRecord`; `calendar-book.ts` writes `value: estimatedValue ?? 0`.

---

## §1 — Problem

Gate 4 judges **every** campaign against **one account-level target** (`audit-runner.ts:366` resolves `resolveEconomicTarget` once, feeds the same `effectiveTarget`/`economicTier` to every `decideForCampaign` call). The per-campaign signal already exists — `crm-funnel-store.ts:42` keys rows `sourceType::sourceCampaignId::stage`; `PrismaConversionRecordStore.funnelByCampaign:87` groups `ConversionRecord` by `(sourceCampaignId, type)` with `_sum:{value}` — but `real-provider.ts:121-133` collapses the funnel to one aggregate and the booked value is never read per campaign.

This slice produces the **per-campaign economic-truth layer** — per-campaign **booked-CAC**, **trueROAS**, and the **Hybrid target resolver** (campaign-level Tier-1 → account-level Tier-2 fallback) — as **pure, fully-tested substrate**, advisory-only, **without consuming it in the decision loop yet**.

## §2 — Why split (sequencing vs #815)

PR **#815** (`feat/riley-phase-a-hardening`, **OPEN**, predates #819) actively edits the Gate-4 consumption path: the `audit-runner.ts` per-campaign loop (adds `learningPhaseActive` to the `decideForCampaign` call), `campaign-decision.ts` (+50), `recommendation-engine.ts`, and `evals/riley-recommendation/*`. The Gate-4 **wiring** collides with all of these; the **data + pure logic** collide with none.

| Half                        | Files                                                                                                                           | #815 overlap        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **PR1 — this slice**        | `prisma-conversion-record-store.ts`, `real-provider.ts`, `source-comparator.ts`, `economic-target.ts` (append-only) + new tests | **none**            |
| **PR2 — after #815 merges** | split `audit-runner.ts` (597/600 lines), wire per-campaign Hybrid into the loop + `decideForCampaign`, extend eval fixtures     | all of #815's files |

PR1 is **purely additive**: no runtime construction/wiring changes (the conversion store gains a method; its core `ConversionRecordStore` port is extended only in PR2), no live query wired, nothing on the decision path. PR2 flips it on once #815 has landed and the file is safe to split.

## §3 — PR1 scope + seams

1. **db — `PrismaConversionRecordStore.queryBookedValueCentsByCampaign`** (new, additive class method — the concrete class gains it; the core `ConversionRecordStore` port is extended only in PR2 when the audit-runner consumes it). Groups booked `ConversionRecord.value` by `sourceCampaignId` for records in the window where `value > 0` and `sourceCampaignId` is present; `_sum:{value}` (+ optional `campaignIds` filter). Returns `Map<campaignId, bookedValueCents>`. **A campaign is absent when it has no known attributed booked value; absence drives `trueRoas: null`.** Mirrors `funnelByCampaign:87`; backed by the `(organizationId, sourceCampaignId)` + `(organizationId, type, occurredAt)` indexes. Tests extend `src/stores/__tests__/prisma-conversion-record-store.test.ts` (mocked Prisma).
2. **ad-optimizer — `byCampaign` projection** (`real-provider.ts:121-133`). Add `byCampaign: Record<campaignId, CampaignFunnel>` to `CrmFunnelDataWithSources` — a **second group-by over the same `rows`** (zero new queries). Provider populates the **funnel projection** (`received/qualified/booked/showed/paid` counts + the existing closed/paid `revenue` field, mirroring `SourceFunnel`) — **not** booked value or spend-derived economics, which the pure comparison joins later.
3. **ad-optimizer — per-campaign comparison** (`source-comparator.ts`, alongside `compareSources:38`). `compareCampaigns({ byCampaign, spendByCampaign, bookedValueCentsByCampaign })` → per-campaign `{ campaignId, costPerBooked, trueRoas, bookedValueCents, cpl, ... }`, **units-correct**. Fix the latent per-source cents bug in `compareSources:48` in the same pass (extract a shared, correctly-normalized metric helper).
4. **ad-optimizer — `resolveEconomicTargetForCampaign`** (append after `economic-target.ts:183`, no edits to #798's functions). Tier-1 calibrates off the **campaign's** bookings-per-conversion via the existing `calibrateTargetFromBooking:80` when the campaign clears the booking floor; otherwise delegates to the passed account-level `ResolvedEconomicTarget` (Tier-2). Returns `{ ...ResolvedEconomicTarget, targetSource: "campaign" | "account" }`.

## §4 — Contracts (locked)

1. **Dual-source, deliberate.** Campaign **booked-CAC denominator = CRM `Booking` count** (`byCampaign.booked`, the canonical _dense_ booking signal). Campaign **trueROAS numerator = booked `ConversionRecord.value`** (the canonical _attributed value_ signal). Missing booked value → `null`, never `0`. They come from different tables on purpose; both key on `sourceCampaignId`.
2. **Zero vs null.** `costPerBooked = bookedCount > 0 ? spend / bookedCount : null`. `trueRoas = bookedValueCents != null && spend > 0 ? normalizeConversionValue(bookedValueCents) / spend : null`. Never emit `0` for "we have no attributed value" — `0` means "revenue was truly zero."
3. **Booked-value honest-null at the map level.** `queryBookedValueCentsByCampaign` includes a campaign **iff** it has ≥1 booked record with `value > 0`. `ConversionRecord.value` is non-nullable `Float @default(0)`; `calendar-book` writes `value: estimatedValue ?? 0`, so **`value === 0` ≡ unvalued/unknown**, treated as "no attributed value," not "a free booking." Map-key **present** ⇒ a valued sum; map-key **absent** ⇒ `bookedValueCents = null` ⇒ `trueRoas = null`. **Assumption (product semantic, not financial truth):** this relies on the current booked-event writer using `0` as the fallback for unknown `estimatedValue`. If zero-value bookings (comped/free services) ever become meaningful, this method must switch from `value > 0` to an explicit value-known flag, or those campaigns will be silently dropped.
4. **Units (the #819 trap).** Monetary values stay **cents** in storage/transport — the projection/lookup field is named **`bookedValueCents`**. Normalize to dollars **only inside** the trueROAS computation, reusing `normalizeConversionValue` (`conversion-value.ts:9`). Ad spend stays dollars (`insight.spend`, `parseFloat`). Booked-CAC needs no revenue and no normalization.
5. **Preserve sparse campaign rows.** `compareCampaigns` iterates the **`byCampaign` (counts)** keys; a campaign with funnel rows but no booked value yields `bookedValueCents: null, trueRoas: null` (costPerBooked still present if `booked > 0`). **Value-only orphans** (a campaign in the booked-value map but absent from `byCampaign`) are **dropped** this slice — no spend/funnel context to judge them.
6. **Tier-1 floor on CRM bookings.** The campaign-level gate is `campaignBookings >= MIN_BOOKED_FOR_TIER1` (=10, `economic-target.ts:11`), measured on the **CRM `Booking` count** — _not_ conversion records, valued records, purchases, or leads. trueROAS may be `null` while booked-CAC still qualifies for Tier-1 (the resolver does **not** consume booked value).
7. **Fallback provenance, delegated.** `resolveEconomicTargetForCampaign` returns `{ ...ResolvedEconomicTarget, targetSource }`. `targetSource:"account"` returns the **passed-in** account `ResolvedEconomicTarget` verbatim (delegation, not re-implemented logic). `ResolvedEconomicTarget` itself is unchanged (no churn to #798).
8. **Eval deferred to PR2.** PR1 changes **no live target**, so the eval stays green untouched. Per umbrella §11, eval-green gates _changing_ the target/confidence math — that happens in PR2's wiring, where the per-campaign Hybrid fixtures (per-campaign breach; thin-campaign → account fallback) land.

## §5 — Data model

```ts
// real-provider.ts — counts only (no spend, no booked value)
interface CampaignFunnel {
  received: number;
  qualified: number;
  booked: number;
  showed: number;
  paid: number;
  revenue: number; // legacy closed/paid cents (mirrors SourceFunnel); NOT the trueROAS source — see §4.1
}
type CrmFunnelDataWithSources = CrmFunnelData & {
  bySource: Record<string, SourceFunnel>;
  byCampaign: Record<string /*campaignId*/, CampaignFunnel>;
};

// source-comparator.ts — joins counts + spend($) + bookedValue(cents)
interface CampaignEconomicsRow {
  campaignId: string;
  cpl: number | null;
  costPerBooked: number | null; // spend / CRM booked count
  bookedValueCents: number | null; // booked ConversionRecord value (null = unvalued)
  trueRoas: number | null; // normalizeConversionValue(bookedValueCents) / spend
}

// economic-target.ts — Hybrid resolver
interface PerCampaignEconomicTarget extends ResolvedEconomicTarget {
  targetSource: "campaign" | "account";
}
```

## §6 — Tests (required)

**`queryBookedValueCentsByCampaign`** (mocked Prisma): sums booked `value` by `sourceCampaignId`; filters to the window; excludes non-`booked` types; excludes null/empty `sourceCampaignId`; **preserves cents** (no dollar conversion in the store); excludes unvalued (`value` 0) records so a campaign with only unvalued bookings is **absent**, not a fabricated `0`.

**`real-provider` `byCampaign`** (counts only): asserts the per-campaign grouping by campaign id, stage counts mirroring the source funnel, **sparse campaign rows preserved**, and the legacy `revenue` (closed cents) carried — **no spend/value economics computed** (those belong to `compareCampaigns`).

**`compareCampaigns`** (spend + booked-value joins): keyed by campaign id; `costPerBooked` uses the CRM booked count; `trueRoas` uses booked value cents normalized to dollars; **`bookedValueCents` 12345 + spend 100 → `trueRoas` 1.2345, not 123.45** (the cents-bug catcher); no booked value → `trueRoas: null` (honest); spend but zero bookings → `costPerBooked: null`; value-only orphan dropped.

**`resolveEconomicTargetForCampaign`**: `booked >= 10` uses campaign-specific economics (`targetSource:"campaign"`); `booked < 10` returns the account target verbatim (`targetSource:"account"`); `booked >= 10` but no booked value **still** resolves a CAC target (resolver ignores trueROAS); the account-fallback delegates to the passed `ResolvedEconomicTarget`, not copied logic.

## §7 — Non-goals (this slice)

- No `audit-runner`/engine wiring, no `decideForCampaign` changes, no eval-fixture changes (all PR2).
- No margin/AOV plumbing / economics-derived target — `marginBasis` stays `"unavailable"` (deferred follow-up).
- No realized/closed-revenue trueROAS basis (rejected in favor of #819 booked value).
- No mutating path, no Meta writes — advisory-only.
- No `MetaAdsClient`, no config schema changes (`targetCostPerBooked` already reaches the runner via `inngest-functions.ts:137-148`).
- No port/interface or construction-site changes — the `queryBookedValueCentsByCampaign` consumer (the audit-runner, via an injected port) is PR2. PR1's pure `compareCampaigns` takes a plain `Map`, so no unused abstraction ships.

## §8 — PR2 preview (documented so the substrate can't rot)

Once #815 merges: split `audit-runner.ts` below the 600-line ceiling; in the per-campaign loop, build `spendByCampaign` (from `insight.spend`) and `bookedValueCentsByCampaign` (from `queryBookedValueCentsByCampaign`, reaching the L2 audit-runner through an **injected port** whose db impl is wired at the `inngest-functions.ts` construction site — preserving the rule that ad-optimizer never imports db). Call `compareCampaigns` + `resolveEconomicTargetForCampaign` (account result from the existing `resolveEconomicTarget:366` as Tier-2), and pass the per-campaign `{economicTier, effectiveTarget}` into `getTargetBreachStatus` + `decideForCampaign` (replacing the account-level values at `:412,429-430`). Add eval fixtures: per-campaign breach (Tier-1) and thin-campaign → account fallback (Tier-2). Surface `targetSource` so the operator sees campaign vs account provenance.

## §9 — Process

Fresh worktree off `origin/main` (done — includes #819). TDD per component; `pnpm test` + `pnpm typecheck` + `pnpm arch:check` before each commit. Focused PR1 to `main`; auto-merge once required checks pass (the known-red "Eval — Claim Classifier" baking check is ignored). The slice-design doc + plan ride with PR1 (branch slug matches the work; pre-commit relevance hook stays quiet).
