// apps/dashboard/src/components/inbox/inbox-agent-avatar.tsx
import type { AgentKey } from "@switchboard/schemas";
import { PrintedPortraitAvatar } from "@/components/agent-avatar/printed-portrait-avatar";

export interface InboxAgentAvatarProps {
  agentKey: AgentKey;
  /** Pixel size of the avatar. Defaults to 22 (matches the cockpit chip). */
  size?: number;
}

/**
 * Identity-only agent avatar for the inbox surfaces. Thin adapter over the shared
 * `PrintedPortraitAvatar` (no live status here, so no pip). Kept as a named export
 * so its existing call sites and test mocks are untouched. NEVER colors an action.
 */
export function InboxAgentAvatar({ agentKey, size = 22 }: InboxAgentAvatarProps) {
  return <PrintedPortraitAvatar agentKey={agentKey} size={size} showPip={false} />;
}
