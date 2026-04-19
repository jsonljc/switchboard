// packages/core/src/creative-pipeline/mode-dispatcher.ts
import { inngestClient } from "./inngest-client.js";

interface DispatchEventData {
  jobId: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
  mode?: string;
}

interface DispatchStepTools {
  sendEvent: (id: string, event: { name: string; data: Record<string, unknown> }) => Promise<void>;
}

export async function executeModeDispatch(
  eventData: DispatchEventData,
  step: DispatchStepTools,
): Promise<void> {
  const mode = eventData.mode ?? "polished";

  if (mode === "ugc") {
    await step.sendEvent("dispatch-ugc", {
      name: "creative-pipeline/ugc.submitted",
      data: {
        ...eventData,
        mode: "ugc",
        pipelineVersion: "ugc_v2",
        dispatchedAt: new Date(),
      },
    });
  } else {
    await step.sendEvent("dispatch-polished", {
      name: "creative-pipeline/polished.submitted",
      data: {
        ...eventData,
        mode: "polished",
        dispatchedAt: new Date(),
      },
    });
  }
}

export function createModeDispatcher() {
  return inngestClient.createFunction(
    {
      id: "creative-mode-dispatcher",
      name: "Creative Pipeline Mode Dispatcher",
      retries: 3,
      triggers: [{ event: "creative-pipeline/job.submitted" }],
    },
    async ({ event, step }: { event: { data: DispatchEventData }; step: DispatchStepTools }) => {
      await executeModeDispatch(event.data, step);
    },
  );
}
