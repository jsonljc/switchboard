import type { BatchSkillHandler } from "./batch-skill-handler.js";

interface InngestLike {
  createFunction(config: unknown, handler: unknown): unknown;
}

interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface BatchRuntime {
  getHandler(skillSlug: string): BatchSkillHandler | null;
}

export function createBatchExecutorFunction(inngestClient: InngestLike, runtime: BatchRuntime) {
  return inngestClient.createFunction(
    {
      id: "skill-runtime-batch-executor",
      triggers: [{ event: "skill-runtime/batch.requested" }],
      concurrency: { limit: 5 },
    },
    async ({
      event,
      step,
    }: {
      event: {
        data: {
          deploymentId: string;
          skillSlug: string;
          trigger: string;
          scheduleName?: string;
        };
      };
      step: StepTools;
    }) => {
      const handler = runtime.getHandler(event.data.skillSlug);
      if (!handler) {
        throw new Error(`No BatchSkillHandler registered for skill: ${event.data.skillSlug}`);
      }

      return step.run("execute-batch-skill", () =>
        handler.execute({
          deploymentId: event.data.deploymentId,
          orgId: "",
          trigger: event.data.trigger,
          scheduleName: event.data.scheduleName,
        }),
      );
    },
  );
}
