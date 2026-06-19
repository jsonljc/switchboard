import { Inngest } from "inngest";
import {
  makeOnFailureHandler,
  selectRecoveryCandidates,
  type AsyncFailureContext,
  type RecoveryCandidateInput,
} from "@switchboard/core";
import type { SubmitWorkResponse } from "@switchboard/core/platform";
import { resolveRecoveryConfig, type GovernanceMode } from "@switchboard/schemas";
import type { RecoveryCampaignSubmitInput } from "../workflows/robin-recovery-request.js";

const inngestClient = new Inngest({ id: "switchboard" });

// Recent no-shows worth re-engaging. The scan window is decoupled from the idempotency cadence
// (ISO-week, anchored to the run time inside buildRecoveryCampaignSubmitRequest).
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

export interface RecoveryDeploymentRow {
  organizationId: string;
  governanceConfig: unknown; // resolved via resolveRecoveryConfig (a passthrough sub-block)
}

export interface RobinRecoveryDispatchDeps {
  failure: AsyncFailureContext;
  listRecoveryDeployments: () => Promise<RecoveryDeploymentRow[]>;
  findNoShowCandidates: (orgId: string, from: Date, to: Date) => Promise<RecoveryCandidateInput[]>;
  findFutureBookingContactIds: (
    orgId: string,
    contactIds: string[],
    now: Date,
  ) => Promise<Set<string>>;
  submitRecoveryCampaign: (
    input: RecoveryCampaignSubmitInput,
  ) => Promise<SubmitWorkResponse | null>;
  now?: () => Date;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface RobinRecoveryDispatchResult {
  deploymentsScanned: number;
  orgsEnforced: number;
  orgsObserved: number;
  candidatesObserved: number;
  campaignsParked: number;
  skipped: number;
  failed: number;
}

// Reduce per-deployment modes to one per org: enforce > observe > off. Any enforce-enabled deployment
// enables the org; the org-scoped ISO-week idempotency key dedups multi-deployment orgs at submit too.
const RANK: Record<GovernanceMode, number> = { off: 0, observe: 1, enforce: 2 };

export async function executeRobinRecoveryDispatch(
  step: StepTools,
  deps: RobinRecoveryDispatchDeps,
): Promise<RobinRecoveryDispatchResult> {
  const now = (deps.now ?? (() => new Date()))();
  const deployments = await step.run("list-recovery-deployments", () =>
    deps.listRecoveryDeployments(),
  );

  const orgMode = new Map<string, GovernanceMode>();
  for (const d of deployments) {
    const mode = resolveRecoveryConfig(d.governanceConfig as never).mode;
    if (mode === "off") continue;
    const prev = orgMode.get(d.organizationId);
    if (!prev || RANK[mode] > RANK[prev]) orgMode.set(d.organizationId, mode);
  }

  const result: RobinRecoveryDispatchResult = {
    deploymentsScanned: deployments.length,
    orgsEnforced: 0,
    orgsObserved: 0,
    candidatesObserved: 0,
    campaignsParked: 0,
    skipped: 0,
    failed: 0,
  };

  const windowFrom = new Date(now.getTime() - LOOKBACK_MS);
  const windowTo = now;

  for (const [organizationId, mode] of orgMode) {
    await step.run(`recovery-${organizationId}`, async () => {
      const rows = await deps.findNoShowCandidates(organizationId, windowFrom, windowTo);
      const futureSet = rows.length
        ? await deps.findFutureBookingContactIds(
            organizationId,
            rows.map((r) => r.contactId),
            now,
          )
        : new Set<string>();
      const cohort = selectRecoveryCandidates(rows, { existingFutureBookingContactIds: futureSet });

      if (mode === "observe") {
        result.orgsObserved++;
        result.candidatesObserved += cohort.length;
        return; // telemetry only; never submit
      }

      result.orgsEnforced++;
      if (cohort.length === 0) return; // an empty campaign must never park

      const res = await deps.submitRecoveryCampaign({
        organizationId,
        windowFrom,
        windowTo,
        asOf: now,
        candidates: cohort,
      });
      if (res === null) return; // empty-cohort guard (defense in depth)
      if ("approvalRequired" in res && res.approvalRequired) {
        result.campaignsParked++; // PARKED for manager approval (the intended outcome)
        return;
      }
      if (!res.ok) {
        // A concurrent cron run already claimed this ISO-week key. Safe: not a duplicate, not a failure.
        if (res.error.type === "idempotency_in_flight") {
          result.skipped++;
          return;
        }
        result.failed++; // governance deny / upstream error: fail-safe, nothing sent
        return;
      }
      // res.ok and NOT parked: a correctly-seeded org always parks (require_approval). A non-park
      // execute is anomalous (the placeholder executor returns failed anyway). Record as failed.
      result.failed++;
    });
  }

  return result;
}

export function createRobinRecoveryDispatchCron(deps: RobinRecoveryDispatchDeps) {
  return inngestClient.createFunction(
    {
      id: "robin-recovery-dispatch",
      name: "Robin No-Show Recovery Dispatch",
      retries: 2,
      // Daily; the ISO-week idempotency key dedups to one parked campaign per org per ISO-week, so a
      // daily cadence gives weekly campaigns with per-day retry resilience (a failed day retries into
      // the same week-key without duplicating).
      triggers: [{ cron: "0 8 * * *" }],
      onFailure: makeOnFailureHandler(
        {
          functionId: "robin-recovery-dispatch",
          eventDomain: "robin-recovery",
          riskCategory: "high",
          alert: true,
        },
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ step }) => executeRobinRecoveryDispatch(step as unknown as StepTools, deps),
  );
}
