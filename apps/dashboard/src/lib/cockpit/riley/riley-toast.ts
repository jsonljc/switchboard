import type { RileyApprovalView, RileyApprovalKind } from "@/components/cockpit/types";

export type RileyToastVerdict = "accept" | "decline";

interface ToastPayload {
  title: string;
  description?: string;
}

const FALLBACK: Record<RileyApprovalKind, { accept: string; decline: string }> = {
  pause: { accept: "Paused — standing by.", decline: "Holding — back to scanning." },
  scale: { accept: "Scaling — back to scanning.", decline: "Holding — back to scanning." },
  refresh_creative: {
    accept: "Creative refresh queued — back to scanning.",
    decline: "Holding the current creative.",
  },
  restructure: {
    accept: "Restructure plan opened.",
    decline: "Holding the current structure.",
  },
  shift_budget_to_source: {
    accept: "Shifting budget — back to scanning.",
    decline: "Holding the current split.",
  },
  switch_optimization_event: {
    accept: "Switched optimization event.",
    decline: "Holding the current event.",
  },
  harden_capi_attribution: {
    accept: "Opening Meta to harden attribution.",
    decline: "Holding the current CAPI configuration.",
  },
  hold: { accept: "Holding — watching.", decline: "Acknowledged — back to scanning." },
  add_creative: {
    accept: "Add-creative ask routed.",
    decline: "Holding off on adding creatives.",
  },
  review_budget: {
    accept: "Opening Meta to review budget.",
    decline: "Holding the current budget.",
  },
  signal_health_group: {
    accept: "Opening Events Manager.",
    decline: "Acknowledged — back to scanning the pixel.",
  },
};

export function rileyToast(args: {
  verdict: RileyToastVerdict;
  approval: RileyApprovalView;
}): ToastPayload {
  const { verdict, approval } = args;
  const engineCopy = verdict === "accept" ? approval.acceptToast : approval.declineToast;
  if (engineCopy && engineCopy.length > 0) {
    return { title: engineCopy };
  }
  const fallback = FALLBACK[approval.kind];
  return { title: verdict === "accept" ? fallback.accept : fallback.decline };
}
