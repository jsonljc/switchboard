"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useToast } from "@/components/ui/use-toast";
import { parseCommand } from "./parse-command";
import { toastVoice } from "./alex-toast-voice";
import type { ParsedAction } from "@/components/cockpit/types";

export interface UseRileyActionDispatcherOptions {
  /**
   * Force-opens the mission popover. Wired from the page's
   * `setMissionOpen(true)`. The page's existing `onOpenMission` prop on
   * `<Identity>` is a toggle; using the toggle here would close the
   * popover if the operator opened it from Identity first. Force-open is
   * the operator-correct semantics for the "Open targets" intent.
   */
  onShowMission: () => void;
}

export type RileyActionDispatcher = (action: ParsedAction) => void;

// Palette command-id → synthetic NL phrase. parseCommand projects the
// phrase into a ParsedAction whose `pause` arm carries the wall-clock
// detail (e.g. "until 3:23 PM"). Mirrors Alex's PER_ID_NL pattern.
const PER_ID_NL: Record<string, string> = {
  "pause-1h": "pause for 1h",
  resume: "resume",
};

// Palette command-id → route + inline toast title. Per-id routes so
// future Riley palette entries can declare their own settings deep
// links without a new switch arm.
const PER_ID_ROUTE: Record<string, { path: string; title: string }> = {
  "open-meta": { path: "/settings?focus=channels", title: "Opening Meta connection." },
  "open-rules": { path: "/settings?focus=rules", title: "Opening rules." },
};

/**
 * Single owner of toast firing on /riley. Both the command palette (via
 * { kind: "command", commandId }) and the live <Composer> (via parsed
 * actions from parseCommand) flow through this hook. The shared
 * <CommandPalette>, <Composer>, and <Topbar> MUST NOT import useToast
 * directly — double-toasts on dispatch are the failure mode this
 * boundary prevents.
 */
export function useRileyActionDispatcher(
  options: UseRileyActionDispatcherOptions,
): RileyActionDispatcher {
  const { setHalted } = useHalt();
  const router = useRouter();
  const { toast } = useToast();
  const { onShowMission } = options;

  return useCallback<RileyActionDispatcher>(
    (action) => {
      // Palette path — discriminated by kind === "command" + commandId.
      if (action.kind === "command" && action.commandId) {
        const nl = PER_ID_NL[action.commandId];
        if (nl) {
          handleParsedKind(parseCommand(nl), setHalted, router, toast);
          return;
        }
        const route = PER_ID_ROUTE[action.commandId];
        if (route) {
          router.push(route.path);
          toast({ title: route.title });
          return;
        }
        if (action.commandId === "open-targets") {
          onShowMission();
          toast({ title: "Opened targets." });
          return;
        }
        if (action.commandId === "brief-eod") {
          toast({
            title: "Noted — brief stub.",
            description: "I'll surface scheduled briefs when that ships.",
          });
          return;
        }
        if (action.commandId === "cpl-30") {
          toast({
            title: "Noted — CPL stub.",
            description: "I'll surface CPL trends when that ships.",
          });
          return;
        }
        // Unmatched commandId — defensive fallthrough to "not automated"
        // honesty toast. Mirrors the instruction-fold copy below.
        toast({
          title: "Noted.",
          description: `"${action.detail || action.label}" is not automated yet.`,
        });
        return;
      }
      // Composer path — ParsedAction from parseCommand.
      handleParsedKind(action, setHalted, router, toast);
    },
    [setHalted, router, toast, onShowMission],
  );
}

function handleParsedKind(
  action: ParsedAction,
  setHalted: (next: boolean) => void,
  router: ReturnType<typeof useRouter>,
  toast: ReturnType<typeof useToast>["toast"],
): void {
  switch (action.kind) {
    case "pause":
      setHalted(true);
      toast(toastVoice(action));
      return;
    case "resume":
      setHalted(false);
      // Riley-specific resume copy. toastVoice's Alex idiom ("picking up
      // where I left off") reads wrong on /riley's scan mental model.
      toast({ title: "Resumed — back to scanning." });
      return;
    case "halt":
      setHalted(true);
      toast(toastVoice(action));
      return;
    case "rule":
      router.push("/settings?focus=rules");
      toast(toastVoice(action));
      return;
    case "brief":
      toast({
        title: "Noted — brief stub.",
        description: "I'll surface scheduled briefs when that ships.",
      });
      return;
    case "followup":
    case "handoff":
    case "context":
    case "instruction":
      // Riley has no contact-thread surface; followup/handoff/context
      // fold into the same "not automated yet" honesty toast as
      // free-form ad-ops phrasing. "Acting on X" would overstate —
      // Riley does not mutate ads from composer text in v1.
      toast({
        title: "Noted.",
        description: `"${action.detail || action.label}" is not automated yet.`,
      });
      return;
    case "command":
      // Unreachable — the top-level palette discriminator handles this
      // kind. Defensive fallthrough avoids exhaustiveness errors.
      return;
  }
}
