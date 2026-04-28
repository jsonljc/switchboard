import { Inngest } from "inngest";

const inngestClient = new Inngest({ id: "switchboard" });

// Re-use the same StepTools shape defined in lead-retry.ts
export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface BackfillJobInput {
  id: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  productImages: string[];
  registryBackfilled?: boolean;
}

export interface BackfillStores {
  productStore: {
    findOrCreateForJob: (job: BackfillJobInput) => Promise<{ id: string }>;
  };
  creatorStore: {
    findOrCreateStockForDeployment: (deploymentId: string) => Promise<{ id: string }>;
  };
  jobStore: {
    markRegistryBackfilled: (
      jobId: string,
      input: { productIdentityId: string; creatorIdentityId: string },
    ) => Promise<{
      id: string;
      registryBackfilled: boolean;
      productIdentityId: string;
      creatorIdentityId: string;
    }>;
  };
}

export interface PcdRegistryBackfillDeps {
  fetchJobsBatch: (limit: number, orgId?: string) => Promise<BackfillJobInput[]>;
  stores: BackfillStores;
}

export async function backfillJobOnce(
  job: BackfillJobInput,
  stores: BackfillStores,
): Promise<{ id: string; registryBackfilled: boolean }> {
  if (job.registryBackfilled) {
    return { id: job.id, registryBackfilled: true };
  }
  const product = await stores.productStore.findOrCreateForJob(job);
  const creator = await stores.creatorStore.findOrCreateStockForDeployment(job.deploymentId);
  return stores.jobStore.markRegistryBackfilled(job.id, {
    productIdentityId: product.id,
    creatorIdentityId: creator.id,
  });
}

export async function executeBackfill(
  step: StepTools,
  deps: PcdRegistryBackfillDeps,
  options: { batchSize?: number; orgId?: string } = {},
): Promise<{ processed: number }> {
  const batchSize = options.batchSize ?? 50;
  let processed = 0;
  for (;;) {
    const batch = await step.run("fetch-batch", () =>
      deps.fetchJobsBatch(batchSize, options.orgId),
    );
    if (batch.length === 0) break;
    for (const job of batch) {
      await step.run(`backfill-${job.id}`, () => backfillJobOnce(job, deps.stores));
      processed += 1;
    }
  }
  return { processed };
}

export function createPcdRegistryBackfillCron(deps: PcdRegistryBackfillDeps) {
  return inngestClient.createFunction(
    {
      id: "pcd-registry-backfill",
      name: "PCD Registry Backfill",
      retries: 3,
      triggers: [{ event: "pcd/registry.backfill.requested" }],
    },
    async ({ step, event }) => {
      const orgId = (event as { data?: { orgId?: string } } | undefined)?.data?.orgId;
      return executeBackfill(step as unknown as StepTools, deps, { orgId });
    },
  );
}
