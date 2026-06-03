"use client";

import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { resolveQueryState } from "@/components/query-states";
import { useHalt } from "@/components/layout/halt/halt-context";
import { agentDisplay, type PanelAgentKey } from "./lib/agent-display";
import { selectKeyResult, coreSetupIncomplete } from "./lib/key-result-state";
import { labelForHeroKind } from "./lib/agent-display";
import type {
  MissionAggregatorResponse,
  MissionSetupRow,
  MissionChannel,
} from "@/lib/cockpit/mission-types";
import styles from "./agent-panel.module.css";

export interface KeyResultProps {
  agentKey: Exclude<PanelAgentKey, "mira">;
  /**
   * Called when the user taps the activation CTA (core setup incomplete).
   * Wired by the host to navigate to /settings/channels. Navigation only.
   */
  onActivate?: () => void;
}

/**
 * Slot ②: Key result hero — shows the cumulative "since you hired" figure
 * (window=all) with week fallback, activation when core setup is incomplete,
 * and the paused composition when halted. Read-only; mutates nothing.
 *
 * Precedence (from selectKeyResult):
 *   paused → activation → proof (lifetime then week fallback) → error
 */
export function KeyResult({ agentKey, onActivate }: KeyResultProps) {
  const all = useAgentMetrics(agentKey, "all");
  const week = useAgentMetrics(agentKey, "week");
  const mission = useAgentMission(agentKey);
  const { halted } = useHalt();

  // Guard: on cold mount the hooks are still fetching. Without this check,
  // selectKeyResult would return { kind: "error" } and flash "Couldn't load
  // this week's number" before any response arrives — violating the
  // three-states-never-collapse invariant (loading ≠ error).
  //
  // These hooks are `enabled: !!keys`, so during keys-pending isLoading is
  // false while data/error are still undefined/null. A plain `isLoading` gate
  // is skipped then. Derive "still pending" from {data, error} via
  // resolveQueryState so keys-pending (no data, no real error yet) also counts
  // as loading; only proceed to selectKeyResult once each hook has resolved
  // data or a real error. We use the resolver here, NOT the <QueryStates>
  // component, on purpose: the post-loading states below (paused / activation /
  // proof / error) are domain-specific, not a generic empty/data split. Do not
  // "finish the migration" by wrapping this slot in <QueryStates>.
  const stillPending =
    resolveQueryState({ data: all.data, error: all.isError ? all.error : null }).status ===
      "loading" ||
    resolveQueryState({ data: week.data, error: week.isError ? week.error : null }).status ===
      "loading" ||
    resolveQueryState({ data: mission.data, error: mission.isError ? mission.error : null })
      .status === "loading";
  if (stillPending) {
    return (
      <div className={styles.heroCard} data-kind="loading" aria-busy="true">
        <div className={styles.heroSkeleton} />
      </div>
    );
  }

  const result = selectKeyResult({
    agentKey,
    halted,
    mission: mission.data,
    all: { data: all.data, isError: all.isError },
    week: { data: week.data, isError: week.isError },
  });

  // ── Paused ────────────────────────────────────────────────────────────────
  if (result.kind === "paused") {
    const heroValue = result.hero?.value;
    const heroKind = result.hero?.kind;
    const missionData = mission.data;
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
    const missionData = mission.data;
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
        {/* One amber action CTA — routes out to /settings/channels via onActivate */}
        <button type="button" className={styles.heroActivationCta} onClick={onActivate}>
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
  const { hero, scope, roi } = result;
  const isZero = hero.value === 0;
  const missionDataForProof = mission.data;

  // Riley's ROI proof = server-computed cost-per-booked comparator (single source of
  // truth; the read-model owns the CAC math). Show only when a real value AND target
  // exist — never gate on roi.degraded (Riley marks all ROI degraded), and never render
  // a blank "— · target" line.
  const hasRoiProof = !!roi && roi.comparator.value !== "—" && roi.comparator.target !== "—";
  const rileyRoiLine =
    agentKey === "riley" && hero.kind === "ad-leads" && hasRoiProof
      ? `${roi.comparator.value} · ${roi.comparator.target}`
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
      {/* ROI comparator — neutral ink only, never green/red */}
      {rileyRoiLine && <p className={styles.heroComp}>{rileyRoiLine}</p>}
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
// CORE_SETUP_KEY is the setup-row key (used for setup[] filtering).
// CORE_CHANNEL_KIND is the MissionChannelKind value (used for channel[] filtering).
// "meta" is a setup-row key, not a MissionChannelKind; the channel enum uses "meta-ads".
const CORE_SETUP_KEY: Record<"alex" | "riley", string> = { alex: "inbox", riley: "meta" };
const CORE_CHANNEL_KIND: Record<"alex" | "riley", string> = { alex: "inbox", riley: "meta-ads" };

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

  // 1. Check setup rows first (non-primary, non-core, incomplete)
  const coreSetupKey = CORE_SETUP_KEY[agentKey];
  const incompleteSetup = missionData.setup.find(
    (s: MissionSetupRow) => s.key !== coreSetupKey && !s.primary && !s.done,
  );
  if (incompleteSetup) {
    return nonCoreSetupNudgeCopy(incompleteSetup.key, displayName);
  }

  // 2. Check channels — exclude the core MissionChannelKind for this agent
  // ("meta-ads" for Riley, "inbox" for Alex).
  const coreChannelKind = CORE_CHANNEL_KIND[agentKey];
  const incompleteChannel = missionData.mission.channels.find(
    (ch: MissionChannel) => ch.kind !== coreChannelKind && ch.status === "off",
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
  _agentKey: "alex" | "riley",
  displayName: string,
): string {
  // Only MissionChannelKind values the producers actually emit can reach here.
  // Riley emits [meta-ads] only (core); Alex emits [meta-ads, inbox-kind, calendar].
  // The calendar channel is the most realistic non-core channel off for Alex.
  if (kind === "calendar") {
    return `Connect your calendar so ${displayName} can book consults.`;
  }
  return `Finish setup to get more from ${displayName}.`;
}
