import { describe, expect, it, vi } from "vitest";
import {
  backfillJobOnce,
  executeBackfill,
  createPcdRegistryBackfillCron,
  type BackfillStores,
  type PcdRegistryBackfillDeps,
} from "../pcd-registry-backfill.js";
import type { AsyncFailureContext } from "@switchboard/core";

// Hoist the spy so it's available when vi.mock factory runs.
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({
    createFunction: createFunctionSpy,
  })),
}));

function makeFailureContext(): AsyncFailureContext {
  return {
    auditLedger: {
      record: vi.fn().mockResolvedValue({}),
    } as unknown as AsyncFailureContext["auditLedger"],
    operatorAlerter: {
      alert: vi.fn().mockResolvedValue(undefined),
    } as unknown as AsyncFailureContext["operatorAlerter"],
    inngest: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

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
    expect(stores.jobStore.markRegistryBackfilled).toHaveBeenCalledWith("org_1", "job_1", {
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
      failure: makeFailureContext(),
      fetchJobsBatch,
      stores: stores as unknown as BackfillStores,
    };
    const result = await executeBackfill(makeStep() as never, deps, { batchSize: 50 });
    expect(result.processed).toBe(2);
    expect(fetchJobsBatch).toHaveBeenCalledTimes(2);
    expect(stores.jobStore.markRegistryBackfilled).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// onFailure wiring — createPcdRegistryBackfillCron (Class E)
// ---------------------------------------------------------------------------

function makeMinimalBackfillDeps(): PcdRegistryBackfillDeps {
  return {
    failure: makeFailureContext(),
    fetchJobsBatch: vi.fn().mockResolvedValue([]),
    stores: makeStores() as unknown as BackfillStores,
  };
}

describe("createPcdRegistryBackfillCron — onFailure wiring", () => {
  it("passes onFailure into createFunction config", () => {
    createFunctionSpy.mockClear();
    createPcdRegistryBackfillCron(makeMinimalBackfillDeps());

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });
});
