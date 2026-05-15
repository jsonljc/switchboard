"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHalt } from "@/components/layout/halt/halt-context";
import { useToast } from "@/components/ui/use-toast";
import { parseCommand } from "./parse-command";
import { toastVoice } from "./alex-toast-voice";
import type { ParsedAction, ThreadContext } from "@/components/cockpit/types";

const PER_ID_NL: Record<string, string> = {
  "pause-1h": "pause for 1h",
  "pause-3pm": "pause until 3pm",
  resume: "resume",
  halt: "halt",
};

const PER_ID_ROUTE: Record<string, string> = {
  "stop-founder": "/settings?focus=rules&founderRateEnabled=false",
  "raise-rule": "/settings?focus=rules&priceApprovalThreshold=99",
  "open-settings": "/settings",
  "open-rules": "/settings?focus=rules",
  "open-meta": "/settings?focus=channels",
};

// Thread-group command IDs whose labels carry literal `{contact}` template
// tokens. The palette filters them out when threadContext is undefined,
// which is always at the A.5 CockpitPage call site — so this dispatcher
// branch is unreachable in production today. The early-return is defensive:
// if a future call site invokes the dispatcher directly with one of these
// IDs and no threadContext, we no-op rather than render the literal
// "{contact}" placeholder in a toast.
const THREAD_GROUP_IDS = new Set(["fu-named", "reply-named", "hold-named"]);

export type AlexActionDispatcher = (action: ParsedAction, threadContext?: ThreadContext) => void;

export function useAlexActionDispatcher(): AlexActionDispatcher {
  const { setHalted } = useHalt();
  const router = useRouter();
  const { toast } = useToast();

  return useCallback<AlexActionDispatcher>(
    (action, threadContext) => {
      // Per-id command overrides resolve first (synthetic NL or route).
      if (action.kind === "command" && action.commandId) {
        const nl = PER_ID_NL[action.commandId];
        if (nl) {
          const synthetic = parseCommand(nl);
          handleByKind(synthetic, threadContext, setHalted, router, toast);
          return;
        }
        const route = PER_ID_ROUTE[action.commandId];
        if (route) {
          router.push(route);
          toast(toastVoice(action));
          return;
        }
        if (action.commandId === "brief-noon" || action.commandId === "brief-eod") {
          toast(toastVoice({ ...action, kind: "brief" }));
          return;
        }
        // Thread-group commands (fu-named/reply-named/hold-named) only fire
        // when threadContext is set; the palette filters them otherwise.
        // At A.5, threadContext is always undefined at the page call site,
        // so this branch is unreachable in production. The early-return
        // is defensive — toasting toastVoice(action) here would render
        // the literal `{contact}` placeholder in the label.
        if (THREAD_GROUP_IDS.has(action.commandId) && !threadContext) {
          return;
        }
        toast(toastVoice(action));
        return;
      }
      handleByKind(action, threadContext, setHalted, router, toast);
    },
    [setHalted, router, toast],
  );
}

function handleByKind(
  action: ParsedAction,
  threadContext: ThreadContext | undefined,
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
      toast(toastVoice(action));
      return;
    case "halt":
      setHalted(true);
      toast(toastVoice(action));
      return;
    case "rule":
      router.push("/settings?focus=rules");
      toast(toastVoice(action));
      return;
    case "handoff":
      if (threadContext) {
        router.push(`/contacts/${encodeURIComponent(threadContext.contactId)}?takeover=true`);
        toast(toastVoice(action));
      } else {
        toast({ title: "Open a thread first.", description: "Expand a row to take it over." });
      }
      return;
    case "context":
      if (threadContext) {
        router.push(`/contacts/${encodeURIComponent(threadContext.contactId)}?note=open`);
        toast(toastVoice(action));
      } else {
        toast({ title: "Open a thread first.", description: "Expand a row to add context." });
      }
      return;
    case "brief":
    case "followup":
    case "instruction":
      toast(toastVoice(action));
      return;
    case "command":
      // Unmatched commandId fallthrough — toast the generic.
      toast(toastVoice(action));
      return;
  }
}
