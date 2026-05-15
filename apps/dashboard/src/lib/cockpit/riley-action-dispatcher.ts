"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useToast } from "@/components/ui/use-toast";
import { parseCommand } from "./parse-command";
import { toastVoice } from "./alex-toast-voice";
import type { RileyCommand } from "./riley/riley-config";

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

export type RileyActionDispatcher = (command: RileyCommand) => void;

/**
 * Single owner of the toast call for `/riley` palette actions. Mirrors
 * `useAlexActionDispatcher` (alex-action-dispatcher.ts). The shared
 * `<CommandPalette>` and `<Topbar>` MUST NOT import `useToast` directly;
 * double-toasts on dispatch are the failure mode this boundary prevents.
 */
export function useRileyActionDispatcher(
  options: UseRileyActionDispatcherOptions,
): RileyActionDispatcher {
  const { setHalted } = useHalt();
  const router = useRouter();
  const { toast } = useToast();
  const { onShowMission } = options;

  return useCallback<RileyActionDispatcher>(
    (command) => {
      switch (command.id) {
        case "open-meta":
          router.push("/settings?focus=channels");
          toast({ title: "Opening Meta connection." });
          return;
        case "open-rules":
          router.push("/settings?focus=rules");
          toast({ title: "Opening rules." });
          return;
        case "open-targets":
          onShowMission();
          toast({ title: "Opened targets." });
          return;
        case "pause-1h": {
          // Reuse Alex's parser + voice helper so Riley's pause toast carries
          // the same wall-clock projection (e.g. "until 3:23 PM"). The brand
          // line "Paused — standing by." is identical across both agents.
          const synthetic = parseCommand("pause for 1h");
          setHalted(true);
          toast(toastVoice(synthetic));
          return;
        }
        case "resume":
          setHalted(false);
          toast({ title: "Resumed — back to scanning." });
          return;
        case "brief-eod":
          toast({
            title: "Noted — brief stub.",
            description: "I'll surface scheduled briefs when that ships.",
          });
          return;
        case "cpl-30":
          toast({
            title: "Noted — CPL stub.",
            description: "I'll surface CPL trends when that ships.",
          });
          return;
      }
    },
    [setHalted, router, toast, onShowMission],
  );
}
