import { computeWindowStart, type WinTimeWindow } from "./window.js";
import { formatTimeFolio } from "./time-folio.js";

export type WinSource = "recommendation" | "booking" | "conversion";
export type WinStatus = "acted" | "confirmed";

/**
 * Subset of @switchboard/schemas AgentKey that has agent-home pages in Slice B.
 * Mira (`launchTier: "day-thirty"`) is intentionally excluded — its agent home
 * ships in a future slice.
 */
export type AgentHomeKey = "alex" | "riley";

export interface ProseSegment {
  kind: "text" | "accent";
  text: string;
}

export interface WinTerminalRecord {
  id: string;
  agentKey: AgentHomeKey;
  status: WinStatus;
  intent: string;
  humanSummary: string;
  occurredAt: Date;
  undoableUntil: Date | null;
  targetEntities: unknown;
}

export interface WinsSignalStore {
  listResolvedForAgent(input: {
    orgId: string;
    agentKey: AgentHomeKey;
    statuses: readonly WinStatus[];
    resolvedSince: Date;
    limit: number;
  }): Promise<WinTerminalRecord[]>;
}

export interface WinViewModel {
  id: string;
  agentKey: AgentHomeKey;
  source: WinSource;
  occurredAt: string;
  timeFolio: string;
  proseSegments: readonly ProseSegment[];
  undo: {
    available: boolean;
    until: string | null;
    unavailableReason?: "expired" | "not-reversible" | "missing-permission";
  };
}

export interface DataFreshness {
  generatedAt: string;
  window: WinTimeWindow;
  dataSource: "live" | "fixture";
  isPartial?: boolean;
  unavailableSources?: readonly string[];
}

export interface WinsViewModel {
  wins: readonly WinViewModel[];
  hasMore: boolean;
  freshness: DataFreshness;
}

export interface WinsAgentConfig {
  agentKey: AgentHomeKey;
  ackPhrase: string;
}

const AGENT_VOICE_CONFIGS: Record<AgentHomeKey, WinsAgentConfig> = {
  alex: { agentKey: "alex", ackPhrase: "Sent." },
  riley: { agentKey: "riley", ackPhrase: "Adjusted." },
};

export interface ProjectWinsInput {
  orgId: string;
  agentKey: AgentHomeKey;
  window: WinTimeWindow;
  now: Date;
  timezone: string;
  store: WinsSignalStore;
}

const VISIBLE_LIMIT = 5;

export async function projectWins(input: ProjectWinsInput): Promise<WinsViewModel> {
  const { orgId, agentKey, window, now, timezone, store } = input;
  const resolvedSince = computeWindowStart(window, now, timezone);
  const rows = await store.listResolvedForAgent({
    orgId,
    agentKey,
    statuses: ["acted", "confirmed"],
    resolvedSince,
    limit: VISIBLE_LIMIT + 1,
  });

  const visible = rows.slice(0, VISIBLE_LIMIT);
  const config = AGENT_VOICE_CONFIGS[agentKey];

  return {
    wins: visible.map((row) => buildWinViewModel(row, config, now, timezone)),
    hasMore: rows.length > VISIBLE_LIMIT,
    freshness: {
      generatedAt: now.toISOString(),
      window,
      dataSource: "live",
    },
  };
}

function buildWinViewModel(
  row: WinTerminalRecord,
  config: WinsAgentConfig,
  now: Date,
  timezone: string,
): WinViewModel {
  return {
    id: row.id,
    agentKey: row.agentKey,
    source: "recommendation",
    occurredAt: row.occurredAt.toISOString(),
    timeFolio: formatTimeFolio(row.occurredAt, now, timezone),
    proseSegments: composeWinProse(row, config),
    undo: computeUndo(row, now),
  };
}

function computeUndo(row: WinTerminalRecord, now: Date): WinViewModel["undo"] {
  if (row.status === "acted") {
    return { available: false, until: null, unavailableReason: "not-reversible" };
  }
  // confirmed
  if (row.undoableUntil === null) {
    return { available: false, until: null, unavailableReason: "not-reversible" };
  }
  if (row.undoableUntil.getTime() <= now.getTime()) {
    return {
      available: false,
      until: row.undoableUntil.toISOString(),
      unavailableReason: "expired",
    };
  }
  return { available: true, until: row.undoableUntil.toISOString() };
}

function composeWinProse(row: WinTerminalRecord, config: WinsAgentConfig): readonly ProseSegment[] {
  const ack: ProseSegment = { kind: "accent", text: config.ackPhrase };
  // Branches are intentionally identical today; kept as a seam for per-agent
  // prose divergence in a later slice. Do not collapse.
  if (config.agentKey === "alex") {
    return [ack, { kind: "text", text: ` ${row.humanSummary}` }];
  }
  // riley
  return [ack, { kind: "text", text: ` ${row.humanSummary}` }];
}
