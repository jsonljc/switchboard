// ---------------------------------------------------------------------------
// RevenueGrowthAgent — Autonomous diagnostic cycle + outcome tracking
// ---------------------------------------------------------------------------
// Implements AdsAgent from core. The tick() runs the full cycle:
// diagnostic → persist → check outcomes → monitor → update profile → digest.
// ---------------------------------------------------------------------------

import type { AdsAgent, AgentContext, AgentTickResult } from "@switchboard/core";
import type { RevGrowthDeps } from "../data/normalizer.js";
import { checkOutcomes } from "../outcome/tracker.js";
import { generateWeeklyDigest } from "../digest/generator.js";
import { RevenueGrowthCartridge } from "../cartridge/index.js";
import { AccountProfileManager } from "../learning/account-profile.js";
import { PostChangeMonitor } from "../monitoring/post-change-monitor.js";
import type { DiagnosticRunOutput } from "@switchboard/schemas";

export class RevenueGrowthAgent implements AdsAgent {
  readonly id = "revenue-growth";
  readonly name = "Revenue Growth Agent";

  constructor(private deps: RevGrowthDeps) {}

  async tick(_ctx: AgentContext): Promise<AgentTickResult> {
    const actions: Array<{ actionType: string; outcome: string }> = [];

    // 1. Get due accounts from accountStore
    const dueAccounts = (await this.deps.accountStore?.listDue()) ?? [];

    for (const account of dueAccounts) {
      try {
        // 2. Run diagnostic cycle via cartridge
        const cartridge = new RevenueGrowthCartridge();
        cartridge.setDeps(this.deps);

        const result = await cartridge.execute(
          "revenue-growth.diagnostic.run",
          { accountId: account.accountId, organizationId: account.organizationId },
          {
            principalId: "agent:revenue-growth",
            organizationId: account.organizationId,
            connectionCredentials: {},
          },
        );

        actions.push({
          actionType: "revenue-growth.diagnostic.run",
          outcome: result.summary,
        });

        // 3. Check outcomes on past interventions
        const outcomeResults = await checkOutcomes(
          this.deps,
          account.accountId,
          account.organizationId,
        );

        if (outcomeResults.length > 0) {
          actions.push({
            actionType: "revenue-growth.outcome.check",
            outcome: `${outcomeResults.length} outcome(s) evaluated: ${outcomeResults.map((r) => `${r.constraintType}=${r.outcome}`).join(", ")}`,
          });
        }

        // 4. Run post-change monitoring
        if (this.deps.monitorCheckpointStore) {
          const monitor = new PostChangeMonitor();
          const checkpoints = await monitor.checkDueInterventions(
            this.deps,
            account.accountId,
            account.organizationId,
          );

          if (checkpoints.length > 0) {
            const anomalies = checkpoints.filter((c) => c.anomalyDetected);
            actions.push({
              actionType: "revenue-growth.monitoring.check",
              outcome: `${checkpoints.length} checkpoint(s), ${anomalies.length} anomaly(ies)`,
            });
          }
        }

        // 5. Update account learning profile
        if (this.deps.accountProfileStore) {
          const profileManager = new AccountProfileManager();
          let profile = await profileManager.getOrCreate(
            account.accountId,
            account.organizationId,
            { accountProfileStore: this.deps.accountProfileStore },
          );

          // Update constraint history from diagnostic result
          const diagOutput = result.data as DiagnosticRunOutput | undefined;
          const currentConstraint = diagOutput?.primaryConstraint?.type ?? null;

          profile = profileManager.updateConstraintHistory(
            profile,
            currentConstraint,
            // If there was a transition, the previous constraint was different
            diagOutput?.constraintTransition ? null : currentConstraint,
          );

          // Update calibration from intervention history
          if (this.deps.interventionStore) {
            const interventions = await this.deps.interventionStore.listByAccount(
              account.accountId,
              { limit: 50 },
            );
            profile = profileManager.updateCalibration(profile, interventions);
          }

          await this.deps.accountProfileStore.save(profile);
        }

        // 6. Generate weekly digest on Mondays
        const isMonday = new Date().getDay() === 1;
        if (isMonday && this.deps.cycleStore) {
          const cycles = await this.deps.cycleStore.listByAccount(account.accountId, 7);
          const interventions = this.deps.interventionStore
            ? await this.deps.interventionStore.listByAccount(account.accountId, { limit: 20 })
            : [];

          const digest = await generateWeeklyDigest(
            account.accountId,
            cycles,
            interventions,
            this.deps.llmClient,
          );

          if (this.deps.digestStore) {
            await this.deps.digestStore.save(digest);
          }

          actions.push({
            actionType: "revenue-growth.digest.generate",
            outcome: digest.headline,
          });
        }

        // 7. Update account nextCycleAt
        if (this.deps.accountStore) {
          const nextCycleAt = new Date(
            Date.now() + account.cadenceMinutes * 60 * 1000,
          ).toISOString();
          await this.deps.accountStore.upsert({
            ...account,
            nextCycleAt,
            lastCycleId: result.externalRefs["cycleId"]?.toString() ?? account.lastCycleId,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {
        actions.push({
          actionType: "revenue-growth.diagnostic.run",
          outcome: `Failed for account ${account.accountId}`,
        });
      }
    }

    return {
      agentId: this.id,
      actions,
      summary: `Processed ${dueAccounts.length} account(s)`,
    };
  }
}
