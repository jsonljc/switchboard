"use client";

import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useHalt } from "@/components/layout/halt/halt-context";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import { selectKeyResult, coreSetupIncomplete } from "./lib/key-result-state";
import { labelForHeroKind } from "./lib/agent-display";
import { formatCents } from "./lib/format";
import type {
  MissionAggregatorResponse,
  MissionSetupRow,
  MissionChannel,
} from "@/lib/cockpit/mission-types";
import styles from "./agent-panel.module.css";

export interface KeyResultProps {
  agentKey: Exclude<PanelAgentKey, "mira">;
}

/**
 * Slot ②: Key result hero — shows the cumulative "since you hired" figure
 * (window=all) with week fallback, activation when core setup is incomplete,
 * and the paused composition when halted. Read-only; mutates nothing.
 *
 * Precedence (from selectKeyResult):
 *   paused → activation → proof (lifetime then week fallback) → error
 */
export function KeyResult({ agentKey }: KeyResultProps) {
  const all = useAgentMetrics(agentKey, "all");
  const week = useAgentMetrics(agentKey, "week");
  const mission = useAgentMission(agentKey);
  const { halted } = useHalt();

  const result = selectKeyResult({
    agentKey,
    halted,
    mission: mission.data as MissionAggregatorResponse | undefined,
    all: { data: all.data, isError: all.isError },
    week: { data: week.data, isError: week.isError },
  });

  // ── Paused ────────────────────────────────────────────────────────────────
  if (result.kind === "paused") {
    const heroValue = result.hero?.value;
    const heroKind = result.hero?.kind;
    const missionData = mission.data as MissionAggregatorResponse | undefined;
    const setupIncomplete = coreSetupIncomplete(missionData, agentKey);

    return (
      <div className={styles.heroCard} data-kind="paused">
        {heroValue != null && heroKind != null ? (
          <>
            {/* Eyebrow: bind to the window that actually returned */}
            <p className={styles.heroEyebrow}>
              {result.scope === "lifetime"
                ? `since you hired ${agentDisplay[agentKey].name}`
                : result.scope === "week"
                  ? "this week"
                  : null}
            </p>
            <div className={styles.heroValueRow}>
              <span className={`${styles.heroValue} ${styles.heroMuted}`}>{heroValue}</span>
              <span className={`${styles.heroUnit} ${styles.heroMuted}`}>
                {labelForHeroKind(heroKind)}
              </span>
            </div>
          </>
        ) : null}
        <p className={styles.pausedHeroNote}>No new actions are going out while paused</p>
        {/* Small setup note below paused note — only when ALSO core-setup-incomplete */}
        {setupIncomplete && (
          <p className={styles.setupNote} data-testid="setup-note">
            Setup is incomplete — some features need attention
          </p>
        )}
      </div>
    );
  }

  // ── Activation ────────────────────────────────────────────────────────────
  if (result.kind === "activation") {
    const missionData = mission.data as MissionAggregatorResponse | undefined;
    return (
      <div
        className={`${styles.heroCard} ${styles.heroActivation}`}
        data-agent={agentKey}
        data-testid="activation-block"
      >
        <p className={styles.heroActivationLine}>
          <em>
            {agentKey === "riley"
              ? "Connect Meta Ads so Riley can start finding leads."
              : "Connect your inbox so Alex can respond to leads."}
          </em>
        </p>
        {/* Channel chips from mission data */}
        {missionData?.mission?.channels && missionData.mission.channels.length > 0 && (
          <div className={styles.heroActivationChannels}>
            {missionData.mission.channels.map((ch) => (
              <span key={ch.kind} className={styles.channelChip} data-status={ch.status}>
                {ch.label}
              </span>
            ))}
          </div>
        )}
        {/* One amber action CTA */}
        <button type="button" className={styles.heroActivationCta}>
          {agentKey === "riley" ? "Connect Meta Ads" : "Connect inbox"}
        </button>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (result.kind === "error") {
    return (
      <div className={`${styles.heroCard} ${styles.heroError}`}>
        <p className={styles.heroErrorMsg}>{"Couldn't load this week's number"}</p>
      </div>
    );
  }

  // ── Proof (lifetime or week) ───────────────────────────────────────────────
  // result.kind === "proof"
  const { hero, scope, spendCents, targets } = result;
  const isZero = hero.value === 0;
  const missionDataForProof = mission.data as MissionAggregatorResponse | undefined;

  // CPL beat for Riley when ad-leads + spend + target all present
  const cplBeat =
    agentKey === "riley" &&
    hero.kind === "ad-leads" &&
    spendCents != null &&
    hero.value > 0 &&
    targets?.targetCpbCents != null
      ? buildCplBeat(spendCents, hero.value, targets.targetCpbCents)
      : null;

  // Non-core nudge: shown when core is done (proof) but a secondary step/channel is still off
  const nudge = nonCoreNudge(missionDataForProof, agentKey);

  return (
    <div className={`${styles.heroCard}${isZero ? ` ${styles.heroZero}` : ""}`} data-kind="proof">
      {/* Eyebrow: bind strictly to the window that returned */}
      <p className={styles.heroEyebrow}>
        {scope === "lifetime" ? `since you hired ${agentDisplay[agentKey].name}` : "this week"}
      </p>
      {/* Hero number */}
      <div className={styles.heroValueRow}>
        <span className={`${styles.heroValue}${isZero ? ` ${styles.heroValueZero}` : ""}`}>
          {hero.value}
        </span>
        <span className={`${styles.heroUnit}${isZero ? ` ${styles.heroValueZero}` : ""}`}>
          {labelForHeroKind(hero.kind)}
        </span>
      </div>
      {/* CPL comparator — neutral ink only, never green/red */}
      {cplBeat && <p className={styles.heroComp}>{cplBeat}</p>}
      {/* Non-core nudge — muted inline hint; never amber, never replaces proof hero */}
      {nudge && (
        <p className={styles.nonCoreNudge} data-testid="non-core-nudge">
          {nudge}
        </p>
      )}
    </div>
  );
}

// Core channel keys per agent — if core is incomplete we are in activation, not proof.
const CORE_CHANNEL: Record<"alex" | "riley", string> = { alex: "inbox", riley: "meta" };

/**
 * Find the first non-core incomplete setup step or channel for the agent.
 * Returns a nudge string when one exists, null when everything non-core is complete.
 * Called only in the proof branch (core is already done).
 */
function nonCoreNudge(
  missionData: MissionAggregatorResponse | undefined,
  agentKey: "alex" | "riley",
): string | null {
  if (!missionData) return null;
  const displayName = missionData.displayName || agentDisplay[agentKey].name;
  const coreKey = CORE_CHANNEL[agentKey];

  // 1. Check setup rows first (non-primary, non-core, incomplete)
  const incompleteSetup = missionData.setup.find(
    (s: MissionSetupRow) => s.key !== coreKey && !s.primary && !s.done,
  );
  if (incompleteSetup) {
    return nonCoreSetupNudgeCopy(incompleteSetup.key, displayName);
  }

  // 2. Check channels — exclude the core channel key
  const incompleteChannel = missionData.mission.channels.find(
    (ch: MissionChannel) =>
      ch.kind !== coreKey && ch.kind !== `${coreKey}-ads` && ch.status === "off",
  );
  if (incompleteChannel) {
    return nonCoreChannelNudgeCopy(incompleteChannel.kind, agentKey, displayName);
  }

  return null;
}

function nonCoreSetupNudgeCopy(key: string, displayName: string): string {
  switch (key) {
    case "cal":
      return `Connect your calendar so ${displayName} can book consults.`;
    case "rules":
      return `Set your guardrails so ${displayName} knows your limits.`;
    default:
      return `Finish setup to get more from ${displayName}.`;
  }
}

function nonCoreChannelNudgeCopy(
  kind: string,
  agentKey: "alex" | "riley",
  displayName: string,
): string {
  if (agentKey === "riley" && kind === "google-ads") {
    return `Connect Google Ads to expand ${displayName}'s reach.`;
  }
  return `Finish setup to get more from ${displayName}.`;
}

/**
 * Compose the CPL comparator line for Riley's ad-leads hero.
 * Neutral words only: "over" / "under" — no green/red sentiment.
 *
 * @param spendCents  Total spend in cents
 * @param leads       Number of leads (> 0)
 * @param targetCents Target cost-per-lead in cents
 */
function buildCplBeat(spendCents: number, leads: number, targetCents: number): string {
  const cpl = spendCents / leads; // in cents
  const diff = Math.abs(cpl - targetCents); // in cents
  const direction = cpl > targetCents ? "over" : "under";

  const cplStr = formatCents(Math.round(cpl)) ?? "";
  const diffStr = formatCents(Math.round(diff)) ?? "";
  const targetStr = formatCents(targetCents) ?? "";

  return `${cplStr} per lead · ${diffStr} ${direction} your ${targetStr} target`;
}
