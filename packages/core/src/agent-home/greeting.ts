// ---------------------------------------------------------------------------
// Agent Home — Greeting Block Projection
//
// Projects variant + prose segments for the greeting block on agent home cards.
// Supports Alex (leads), Riley (ad sets), and Mira (drafts).
//
// Variant Logic:
//   - inboxCount=0 AND hoursSinceLastOperatorAction=null → "welcome"
//   - inboxCount=0 AND hoursSinceLastOperatorAction≠null → "quiet"
//   - inboxCount >= busyThreshold OR oldestOpenItemAgeHours >= busyAgeHoursThreshold → "busy"
//   - otherwise → "named-lead"
//
// Voice Profiles:
//   - Alex: warm, conversational ("Maya is the one I'd answer first")
//   - Riley: direct, numerical ("ad sets need your eye")
//   - Mira: draft-only, calm ("Ready to create. I'll bring you drafts to review.")
// ---------------------------------------------------------------------------

import type { AgentKey } from "@switchboard/schemas";
import type { AgentHomeKey } from "./agent-key.js";

// ──────────────────────────────────────────────────────────────────────────
// Public Types (Projection Interface)
// ──────────────────────────────────────────────────────────────────────────

export type GreetingVariant = "welcome" | "named-lead" | "quiet" | "busy";

export interface ProseSegment {
  kind: "text" | "accent";
  text: string;
}

export interface GreetingSignal {
  inboxCount: number;
  oldestOpenItemAgeHours: number | null;
  hoursSinceLastOperatorAction: number | null;
}

export interface TopItemMeta {
  name: string;
  ageLabel: string;
}

export interface DataFreshness {
  generatedAt: string;
  window: "today";
  dataSource: "live" | "fixture";
}

export interface GreetingProjection {
  variant: GreetingVariant;
  segments: readonly ProseSegment[];
  signal: GreetingSignal;
  freshness: DataFreshness;
}

export interface GreetingSignalStore {
  getSignal(orgId: string, agentKey: AgentKey): Promise<GreetingSignal>;
  getTopItem(orgId: string, agentKey: AgentKey): Promise<TopItemMeta | null>;
}

export interface ProjectGreetingInput {
  orgId: string;
  agentKey: AgentHomeKey;
  store: GreetingSignalStore;
}

// ──────────────────────────────────────────────────────────────────────────
// Internal Types (Config & Orchestration)
// ──────────────────────────────────────────────────────────────────────────

export interface GreetingAgentConfig {
  agentKey: AgentKey;
  busyThreshold: number;
  busyAgeHoursThreshold: number;
  countNoun: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Config Registry (Alex, Riley, Mira)
// ──────────────────────────────────────────────────────────────────────────

const AGENT_CONFIGS: Record<AgentHomeKey, GreetingAgentConfig> = {
  alex: {
    agentKey: "alex",
    busyThreshold: 5,
    busyAgeHoursThreshold: 24,
    countNoun: "leads",
  },
  riley: {
    agentKey: "riley",
    busyThreshold: 4,
    busyAgeHoursThreshold: 12,
    countNoun: "ad sets",
  },
  mira: {
    agentKey: "mira",
    busyThreshold: 3,
    busyAgeHoursThreshold: 24,
    countNoun: "drafts",
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Variant Computer
// ──────────────────────────────────────────────────────────────────────────

export function computeVariant(
  signal: GreetingSignal,
  config: GreetingAgentConfig,
): GreetingVariant {
  const { inboxCount, oldestOpenItemAgeHours, hoursSinceLastOperatorAction } = signal;
  const { busyThreshold, busyAgeHoursThreshold } = config;

  // Empty inbox cases
  if (inboxCount === 0) {
    return hoursSinceLastOperatorAction === null ? "welcome" : "quiet";
  }

  // Busy threshold checks
  if (
    inboxCount >= busyThreshold ||
    (oldestOpenItemAgeHours !== null && oldestOpenItemAgeHours >= busyAgeHoursThreshold)
  ) {
    return "busy";
  }

  // Default: named-lead
  return "named-lead";
}

// ──────────────────────────────────────────────────────────────────────────
// Prose Template Builder
// ──────────────────────────────────────────────────────────────────────────

export function buildSegments(
  variant: GreetingVariant,
  signal: GreetingSignal,
  config: GreetingAgentConfig,
  topItem: TopItemMeta | null,
): readonly ProseSegment[] {
  const { agentKey, countNoun } = config;
  const { inboxCount } = signal;

  if (variant === "welcome") {
    if (agentKey === "alex") {
      return [
        { kind: "text", text: "I'm here when you need me. I'll bring you leads worth your time." },
      ];
    } else if (agentKey === "riley") {
      return [{ kind: "text", text: "Ready to optimize. I'll flag what needs attention." }];
    } else if (agentKey === "mira") {
      return [
        {
          kind: "text",
          text: "Ready to create. I'll bring you drafts to review — never published without you.",
        },
      ];
    }
    // Unreachable at runtime for known AgentHomeKey values; defensive fallthrough
    throw new Error(`Unhandled agentKey for welcome: ${agentKey}`);
  }

  if (variant === "quiet") {
    if (agentKey === "alex") {
      return [{ kind: "text", text: "All clear for now. I'll ping you when something lands." }];
    } else if (agentKey === "riley") {
      return [{ kind: "text", text: "Nothing urgent right now. I'll alert you when I see drift." }];
    } else if (agentKey === "mira") {
      return [
        { kind: "text", text: "No drafts need you right now. I'll ping you when one's ready." },
      ];
    }
    // Unreachable at runtime for known AgentHomeKey values; defensive fallthrough
    throw new Error(`Unhandled agentKey for quiet: ${agentKey}`);
  }

  if (variant === "busy") {
    return [
      { kind: "text", text: "You've got " },
      { kind: "accent", text: `${inboxCount} ${countNoun}` },
    ];
  }

  if (variant === "named-lead") {
    if (topItem !== null) {
      if (agentKey === "alex") {
        return [
          { kind: "accent", text: topItem.name },
          { kind: "text", text: " is the one I'd answer first." },
        ];
      } else if (agentKey === "riley") {
        return [
          { kind: "accent", text: topItem.name },
          { kind: "text", text: " needs your eye first." },
        ];
      } else if (agentKey === "mira") {
        return [
          { kind: "accent", text: topItem.name },
          { kind: "text", text: " is ready for your review." },
        ];
      }
      // Unreachable at runtime for known AgentHomeKey values; defensive fallthrough
      throw new Error(`Unhandled agentKey for named-lead (topItem): ${agentKey}`);
    } else {
      // Fallback when topItem is null
      if (agentKey === "alex") {
        return [
          {
            kind: "text",
            text: "I've got a few leads lined up — ready when you are.",
          },
        ];
      } else if (agentKey === "riley") {
        return [
          {
            kind: "text",
            text: "A few items need review — let me know when you're ready.",
          },
        ];
      } else if (agentKey === "mira") {
        return [{ kind: "text", text: "A few drafts are ready for review — whenever you are." }];
      }
      // Unreachable at runtime for known AgentHomeKey values; defensive fallthrough
      throw new Error(`Unhandled agentKey for named-lead (no topItem): ${agentKey}`);
    }
  }

  // Exhaustiveness check (TypeScript will error if a variant is missed)
  const _exhaustive: never = variant;
  throw new Error(`Unhandled variant: ${_exhaustive}`);
}

// ──────────────────────────────────────────────────────────────────────────
// Projection Orchestrator
// ──────────────────────────────────────────────────────────────────────────

export async function projectGreeting(input: ProjectGreetingInput): Promise<GreetingProjection> {
  const { orgId, agentKey, store } = input;
  const config = AGENT_CONFIGS[agentKey];

  const [signal, topItem] = await Promise.all([
    store.getSignal(orgId, agentKey),
    store.getTopItem(orgId, agentKey),
  ]);

  const variant = computeVariant(signal, config);
  const segments = buildSegments(variant, signal, config, topItem);

  return {
    variant,
    segments,
    signal,
    freshness: {
      generatedAt: new Date().toISOString(),
      window: "today",
      dataSource: "live",
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// In-Memory Store (Test-Only)
// ──────────────────────────────────────────────────────────────────────────

export class InMemoryGreetingSignalStore implements GreetingSignalStore {
  private signals = new Map<string, GreetingSignal>();
  private topItems = new Map<string, TopItemMeta>();

  private key(orgId: string, agentKey: AgentKey): string {
    return `${orgId}:${agentKey}`;
  }

  setSignal(orgId: string, agentKey: AgentKey, signal: GreetingSignal): void {
    this.signals.set(this.key(orgId, agentKey), signal);
  }

  setTopItem(orgId: string, agentKey: AgentKey, topItem: TopItemMeta): void {
    this.topItems.set(this.key(orgId, agentKey), topItem);
  }

  async getSignal(orgId: string, agentKey: AgentKey): Promise<GreetingSignal> {
    const k = this.key(orgId, agentKey);
    const signal = this.signals.get(k);
    if (signal) return signal;

    // Default: zero signal
    return {
      inboxCount: 0,
      oldestOpenItemAgeHours: null,
      hoursSinceLastOperatorAction: null,
    };
  }

  async getTopItem(orgId: string, agentKey: AgentKey): Promise<TopItemMeta | null> {
    const k = this.key(orgId, agentKey);
    return this.topItems.get(k) ?? null;
  }
}
