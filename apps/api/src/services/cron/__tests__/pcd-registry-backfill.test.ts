import { describe, expect, it, vi } from "vitest";
import {
  backfillJobOnce,
  executeBackfill,
  type BackfillStores,
  type PcdRegistryBackfillDeps,
} from "../pcd-registry-backfill.js";

function makeStores() {
  return {
    productStore: {
      findOrCreateForJob: vi.fn().mockResolvedValue({ id: "prd_new" }),
    },
    creatorStore: {
      findOrCreateStockForDeployment: vi.fn().mockResolvedValue({ id: "cr_new" }),
    },
    jobStore: {
      markRegistryBackfilled: vi.fn().mockResolvedValue({
        id: "job_1",
        registryBackfilled: true,
        productIdentityId: "prd_new",
        creatorIdentityId: "cr_new",
      }),
    },
  };
}

function makeStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
  };
}

describe("backfillJobOnce", () => {
  it("creates registry rows and marks the job backfilled", async () => {
    const stores = makeStores();
    const result = await backfillJobOnce(
      {
        id: "job_1",
        organizationId: "org_1",
        deploymentId: "dep_1",
        productDescription: "Hydra Serum",
        productImages: [],
      },
      stores as unknown as BackfillStores,
    );
    expect(stores.productStore.findOrCreateForJob).toHaveBeenCalledOnce();
    expect(stores.creatorStore.findOrCreateStockForDeployment).toHaveBeenCalledWith("dep_1");
    expect(stores.jobStore.markRegistryBackfilled).toHaveBeenCalledWith("job_1", {
      productIdentityId: "prd_new",
      creatorIdentityId: "cr_new",
    });
    expect(result.registryBackfilled).toBe(true);
  });

  it("is a no-op when job is already backfilled", async () => {
    const stores = makeStores();
    const result = await backfillJobOnce(
      {
        id: "job_2",
        organizationId: "org_1",
        deploymentId: "dep_1",
        productDescription: "X",
        productImages: [],
        registryBackfilled: true,
      },
      stores as unknown as BackfillStores,
    );
    expect(stores.productStore.findOrCreateForJob).not.toHaveBeenCalled();
    expect(stores.jobStore.markRegistryBackfilled).not.toHaveBeenCalled();
    expect(result.registryBackfilled).toBe(true);
  });
});

describe("executeBackfill", () => {
  it("processes batches until none remain", async () => {
    const stores = makeStores();
    const fetchJobsBatch = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "j1",
          organizationId: "o1",
          deploymentId: "d1",
          productDescription: "p",
          productImages: [],
        },
        {
          id: "j2",
          organizationId: "o1",
          deploymentId: "d1",
          productDescription: "p",
          productImages: [],
        },
      ])
      .mockResolvedValueOnce([]);
    const deps: PcdRegistryBackfillDeps = {
      fetchJobsBatch,
      stores: stores as unknown as BackfillStores,
    };
    const result = await executeBackfill(makeStep() as never, deps, { batchSize: 50 });
    expect(result.processed).toBe(2);
    expect(fetchJobsBatch).toHaveBeenCalledTimes(2);
    expect(stores.jobStore.markRegistryBackfilled).toHaveBeenCalledTimes(2);
  });
});
