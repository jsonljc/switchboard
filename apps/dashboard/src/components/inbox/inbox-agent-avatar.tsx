import { AGENT_REGISTRY, type AgentKey } from "@switchboard/schemas";
import { SpriteChip } from "@/components/cockpit/sprite/sprite-chip";
import type { SpriteVariantKey, VariantBundle } from "@/components/cockpit/sprite/types";
import type { AccentTokens } from "@/components/cockpit/tokens";
import { ALEX_VARIANTS, DEFAULT_ALEX_VARIANT } from "@/lib/cockpit/alex-config";
import {
  RILEY_ACCENT,
  RILEY_VARIANTS,
  DEFAULT_RILEY_VARIANT,
} from "@/lib/cockpit/riley/riley-config";
import { ALEX_APPROVAL_ACCENT } from "@/components/cockpit/approval-card";

interface AgentSpriteConfig {
  /** Sprite bundle, or null for agents without a sprite (Mira → letter disc). */
  bundle: VariantBundle | null;
  variant: SpriteVariantKey;
  accent: Pick<AccentTokens, "soft" | "deep">;
}

/**
 * Mira has no cockpit sprite/accent config (day-thirty), so we derive a soft/deep
 * pair locally from her registry accent for the initial-disc fallback. Identity-only.
 */
const MIRA_ACCENT: Pick<AccentTokens, "soft" | "deep"> = {
  soft: "#E7E1F0",
  deep: "#4A3A66",
};

const AGENT_SPRITES: Record<AgentKey, AgentSpriteConfig> = {
  alex: { bundle: ALEX_VARIANTS, variant: DEFAULT_ALEX_VARIANT, accent: ALEX_APPROVAL_ACCENT },
  riley: { bundle: RILEY_VARIANTS, variant: DEFAULT_RILEY_VARIANT, accent: RILEY_ACCENT },
  mira: { bundle: null, variant: "__none__", accent: MIRA_ACCENT },
};

export interface InboxAgentAvatarProps {
  agentKey: AgentKey;
  /** Pixel size of the avatar chip. Defaults to 22 (matches the cockpit chip). */
  size?: number;
}

/**
 * Identity-only agent avatar for the inbox surface. Renders the agent's pixel
 * sprite via `SpriteChip`, falling back to an initial-disc (the agent's display
 * initial) when no sprite bundle exists (Mira) or a frame is missing. NEVER used
 * to color an action control — agent color is identity only.
 */
export function InboxAgentAvatar({ agentKey, size = 22 }: InboxAgentAvatarProps) {
  const config = AGENT_SPRITES[agentKey];
  const displayName = AGENT_REGISTRY[agentKey]?.displayName ?? agentKey;
  const fallbackLetter = displayName.charAt(0).toUpperCase();

  return (
    <SpriteChip
      bundle={config.bundle ?? {}}
      variant={config.variant}
      state="idle"
      size={size}
      accentSoft={config.accent.soft}
      fallbackDeep={config.accent.deep}
      fallbackLetter={fallbackLetter}
    />
  );
}
