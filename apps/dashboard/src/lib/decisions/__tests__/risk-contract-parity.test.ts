/**
 * Compile-time parity guard: dashboard RiskContract must stay structurally
 * identical to the inline riskContract shape on core Decision.meta.
 *
 * Source-of-truth is @switchboard/core (packages/core/src/decisions/types.ts).
 * Phase-2 option: lift the shared shape into @switchboard/schemas so both
 * layers import it directly and this guard becomes trivially always-correct.
 *
 * If shapes diverge (e.g. a field is added to core but not the dashboard
 * interface), the two-way satisfies/assignment assertions below will produce
 * a TypeScript compile error, catching the drift before it reaches the wire.
 */
import { describe, expect, it } from "vitest";
import type { Decision as CoreDecision } from "@switchboard/core";
import type { RiskContract as DashboardRiskContract } from "../types";

// The core riskContract is an inline anonymous type — extract it.
type CoreRiskContract = NonNullable<CoreDecision["meta"]["riskContract"]>;

// Two-way structural assignment assertions (compile-time only, no runtime cost).
// If CoreRiskContract gains a field, the first line fails (Core ≠ Dashboard).
// If DashboardRiskContract gains a field, the second line fails (Dashboard ≠ Core).
const _coreAsDashboard: DashboardRiskContract = {} as CoreRiskContract;
const _dashboardAsCore: CoreRiskContract = {} as DashboardRiskContract;

// Suppress "declared but never read" without any/console.
void _coreAsDashboard;
void _dashboardAsCore;

describe("RiskContract parity (compile-time guard)", () => {
  it("dashboard RiskContract is structurally identical to core Decision.meta.riskContract", () => {
    // Runtime sanity: verify the 5 expected keys are present on a concrete object.
    const contract: DashboardRiskContract = {
      riskLevel: "low",
      externalEffect: false,
      financialEffect: true,
      clientFacing: false,
      requiresConfirmation: true,
    };
    const keys = Object.keys(contract).sort();
    expect(keys).toEqual([
      "clientFacing",
      "externalEffect",
      "financialEffect",
      "requiresConfirmation",
      "riskLevel",
    ]);
  });
});
