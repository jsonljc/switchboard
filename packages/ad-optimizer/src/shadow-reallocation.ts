/**
 * Shadow-mode harness for Riley's flag-dark campaign-budget reallocation
 * (Spec-1B `adoptimizer.campaign.reallocate`). It runs Riley's PREDICT path on a
 * batch of inputs and reports, per campaign, the reallocation it WOULD propose,
 * whether the executor's blast-radius cap would accept it, and an optional
 * LLM-judge soundness verdict — all WITHOUT moving any money. It is the
 * "shadow-test before the real-money flip" tool (research f8): an operator can
 * see what Riley would do before flipping `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED`.
 *
 * By construction this CANNOT mutate spend: it imports only the pure planner
 * (`buildRileyBudgetCandidate`), the pure blast-radius predicate
 * (`assertWithinBlastRadius`), and the budget-delta helper. It does NOT import the
 * submit sink (`dispatchRileyBudgetReallocation`), the execution workflow, or
 * `MetaAdsClient`, so there is no path from this module to a Meta budget write.
 *
 * Layer 2 (ad-optimizer): the LLM judge is INJECTED as a callback (this package
 * never imports an Anthropic client), mirroring how the real submit sink is an
 * apps/api-injected callback. The deterministic legs (predict + blast-radius) run
 * with no judge and no API key; the judge only adds a qualitative layer.
 *
 * Scope of the prediction: the report models the executor's blast-radius cap
 * ONLY. It does NOT model the executor's live Meta re-read or its drift check
 * (`assessBudgetDrift`), which run against fresh state at execution time. So a
 * `blastRadius.ok` verdict means "the blast-radius cap would accept this move
 * given the supplied inputs" — a narrower claim than "the executor would accept
 * it." This is a predict-time approximation for pre-flip review, not a full dry-run.
 */
import { buildRileyBudgetCandidate, type RileyBudgetCandidate } from "./riley-budget-dispatch.js";
import { computeBudgetDelta } from "./budget-reallocation-plan.js";
import {
  assertWithinBlastRadius,
  DEFAULT_BLAST_RADIUS_CONTRACT,
  type BlastRadiusContract,
  type BlastRadiusVerdict,
} from "./blast-radius-contract.js";

/** The exact args Riley's planner receives, plus the account spend the blast-radius
 *  share leg needs (the live executor re-reads this; the shadow harness is given it). */
export interface ShadowReallocationInput {
  planner: Parameters<typeof buildRileyBudgetCandidate>[0];
  /** Account daily spend (cents) for the blast-radius share-cap leg. */
  accountDailySpendCents: number;
}

/** Verdict an injected LLM judge returns for a single predicted reallocation. */
export interface ShadowJudgeVerdict {
  /** Whether the judge considers the proposed move sound given the evidence. */
  sound: boolean;
  rationale: string;
}

/**
 * Injected judge callback. Called ONCE per predicted candidate (never for an
 * abstained input). Implementations own their own model client (apps/api / eval),
 * so this package stays Anthropic-free and the harness stays deterministic when no
 * judge is supplied.
 */
export type ShadowJudge = (args: {
  candidate: RileyBudgetCandidate;
  input: ShadowReallocationInput;
}) => Promise<ShadowJudgeVerdict>;

export interface ShadowReallocationEntry {
  campaignId: string;
  recommendationId: string;
  /** The reallocation Riley would propose, or null when the planner abstains. */
  predicted: RileyBudgetCandidate | null;
  abstained: boolean;
  /** Signed cents delta (proposed - current) for a predicted move; null when abstained. */
  deltaCentsSigned: number | null;
  /** Whether the executor's blast-radius cap would accept the move; null when abstained. */
  blastRadius: BlastRadiusVerdict | null;
  /** The injected judge's verdict, or null when no judge was supplied / abstained. */
  judge: ShadowJudgeVerdict | null;
}

export interface ShadowReallocationReport {
  entries: ShadowReallocationEntry[];
  summary: {
    total: number;
    predicted: number;
    abstained: number;
    /** Count of predicted moves the blast-radius cap would REFUSE (executor would fail-closed). */
    blastRadiusRejected: number;
  };
}

/**
 * Run the shadow harness over a batch of inputs. Pure except for the optional
 * injected judge; never executes a money move.
 */
export async function buildShadowReallocationReport(
  inputs: ShadowReallocationInput[],
  deps?: { judge?: ShadowJudge; blastRadiusContract?: BlastRadiusContract },
): Promise<ShadowReallocationReport> {
  const contract = deps?.blastRadiusContract ?? DEFAULT_BLAST_RADIUS_CONTRACT;
  const entries: ShadowReallocationEntry[] = [];

  for (const input of inputs) {
    const candidate = buildRileyBudgetCandidate(input.planner);
    if (!candidate) {
      entries.push({
        campaignId: input.planner.emitted.campaignId,
        recommendationId: input.planner.emitted.recommendationId,
        predicted: null,
        abstained: true,
        deltaCentsSigned: null,
        blastRadius: null,
        judge: null,
      });
      continue;
    }

    const delta = computeBudgetDelta(
      candidate.currentDailyBudgetCents,
      candidate.proposedDailyBudgetCents,
    );
    // delta is null only on a non-finite budget; the planner already rejects those,
    // so treat a null here as a fail-closed delta-cap breach rather than skipping the cap.
    const deltaCentsSigned = delta ? delta.deltaCentsSigned : null;
    const blastRadius: BlastRadiusVerdict =
      deltaCentsSigned === null
        ? { ok: false, reason: "DELTA_CAP" }
        : assertWithinBlastRadius(contract, deltaCentsSigned, input.accountDailySpendCents);

    const judge = deps?.judge ? await deps.judge({ candidate, input }) : null;

    entries.push({
      campaignId: candidate.campaignId,
      recommendationId: candidate.recommendationId,
      predicted: candidate,
      abstained: false,
      deltaCentsSigned,
      blastRadius,
      judge,
    });
  }

  return {
    entries,
    summary: {
      total: entries.length,
      predicted: entries.filter((e) => e.predicted !== null).length,
      abstained: entries.filter((e) => e.abstained).length,
      blastRadiusRejected: entries.filter((e) => e.blastRadius !== null && !e.blastRadius.ok)
        .length,
    },
  };
}
