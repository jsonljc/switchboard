# Durable Rendered-Asset Storage (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the polished creative pipeline's assembled MP4 + thumbnail to S3-compatible object storage at render time and write the durable public URL to `CreativeJob.durableAssetUrl`, so a completed+kept creative becomes publishable (closing the `CREATIVE_ASSET_NOT_DURABLE` gap left by #830).

**Architecture:** A narrow `AssetStorageClient` interface is owned by `creative-pipeline` (Layer 2); the concrete `S3CreativeAssetStorage` (using `@aws-sdk/client-s3`) lives in `apps/api` (Layer 5) and is injected from the `inngest.ts` composition root down through `createCreativeJobRunner` → `executeCreativePipeline` → `runStage` → `runVideoProducer`. The producer uploads at the assembly seam and returns the durable URL; the runner persists it via a new `setDurableAsset` store method. Public-read objects under unguessable keys; the stored value is a directly-fetchable `https://` URL, so #830's plain-`fetch` consumer is untouched.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), pnpm + Turborepo, Vitest, Zod, Prisma, `@aws-sdk/client-s3` (S3-compatible; Cloudflare R2 by default).

**Spec:** `docs/superpowers/specs/2026-06-03-creative-durable-asset-storage-design.md`

---

## File Structure

| File                                                                           | Responsibility                                                                                       | Task |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---- |
| `packages/schemas/src/creative-job.ts`                                         | add optional `durableAssetUrl` to `VideoProducerOutput`                                              | 1    |
| `packages/schemas/src/__tests__/creative-job.test.ts`                          | parse test for the new field                                                                         | 1    |
| `packages/creative-pipeline/src/stages/video-producer.ts`                      | `AssetStorageClient` iface; `assetStorage` dep; `jobId` input; upload seam; return `durableAssetUrl` | 2    |
| `packages/creative-pipeline/src/stages/__tests__/video-producer.test.ts`       | upload / degrade / fail-loud tests                                                                   | 2    |
| `packages/creative-pipeline/src/index.ts`                                      | export `AssetStorageClient`                                                                          | 2    |
| `packages/creative-pipeline/src/stages/run-stage.ts`                           | thread `assetStorage` + `jobId` into producer deps                                                   | 3    |
| `packages/creative-pipeline/src/stages/__tests__/run-stage-production.test.ts` | forwarding test                                                                                      | 3    |
| `packages/creative-pipeline/src/creative-job-runner.ts`                        | `JobStore.setDurableAsset`; thread `assetStorage`; persist at completion                             | 4    |
| `packages/creative-pipeline/src/__tests__/creative-job-runner.test.ts`         | persist / no-persist tests; call-site fix                                                            | 4    |
| `packages/db/src/stores/prisma-creative-job-store.ts`                          | `setDurableAsset` method                                                                             | 5    |
| `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts`           | store method tests                                                                                   | 5    |
| `apps/api/src/lib/creative-asset-storage.ts`                                   | `S3CreativeAssetStorage` + `buildCreativeAssetStorage`                                               | 6    |
| `apps/api/src/lib/__tests__/creative-asset-storage.test.ts`                    | upload + factory tests                                                                               | 6    |
| `apps/api/package.json`                                                        | add `@aws-sdk/client-s3`                                                                             | 0/6  |
| `apps/api/src/bootstrap/inngest.ts`                                            | construct + inject `assetStorage`                                                                    | 7    |
| `apps/api/src/services/__tests__/creative-publish-preconditions.test.ts`       | loop-closing regression lock                                                                         | 8    |
| `.env.example`, `scripts/env-allowlist.local-readiness.json`, `render.yaml`    | `CREATIVE_ASSET_*` config                                                                            | 9    |

---

## Task 0: Setup — build the workspace + add the storage SDK

**Files:**

- Modify: `apps/api/package.json` (via `pnpm add`)

- [ ] **Step 1: Confirm branch + clean tree**

Run: `git -C /Users/jasonli/switchboard/.claude/worktrees/creative-durable-asset-storage branch --show-current && git -C /Users/jasonli/switchboard/.claude/worktrees/creative-durable-asset-storage status --short`
Expected: branch `feat/creative-durable-asset-storage`; only the spec/plan docs as changes (already committed).

- [ ] **Step 2: Generate Prisma client + build all packages** (so cross-package value imports resolve in tests; Postgres is NOT required for generate/build)

Run: `cd /Users/jasonli/switchboard/.claude/worktrees/creative-durable-asset-storage && pnpm db:generate && pnpm build`
Expected: build succeeds for all packages (turbo will cache subsequent runs).

- [ ] **Step 3: Add the S3-compatible SDK to apps/api** (resolves a real version + updates the lockfile)

Run: `cd /Users/jasonli/switchboard/.claude/worktrees/creative-durable-asset-storage && pnpm --filter @switchboard/api add @aws-sdk/client-s3`
Expected: `apps/api/package.json` gains `@aws-sdk/client-s3` and `pnpm-lock.yaml` updates.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "build(api): add @aws-sdk/client-s3 for durable creative-asset storage"
```

---

## Task 1: Schema — add `durableAssetUrl` to `VideoProducerOutput`

**Files:**

- Modify: `packages/schemas/src/creative-job.ts:160-170` (inside the `VideoProducerOutput` object, after `errors`)
- Test: `packages/schemas/src/__tests__/creative-job.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/schemas/src/__tests__/creative-job.test.ts` (ensure `VideoProducerOutput` is imported at the top — it is exported from `../creative-job.js`; add it to the existing import if missing):

```ts
describe("VideoProducerOutput.durableAssetUrl", () => {
  it("accepts an optional durableAssetUrl", () => {
    const parsed = VideoProducerOutput.parse({
      tier: "pro",
      clips: [],
      durableAssetUrl: "https://cdn.example.com/creative-assets/job_1/u.mp4",
    });
    expect(parsed.durableAssetUrl).toBe("https://cdn.example.com/creative-assets/job_1/u.mp4");
  });

  it("treats durableAssetUrl as optional", () => {
    const parsed = VideoProducerOutput.parse({ tier: "basic", clips: [] });
    expect(parsed.durableAssetUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- creative-job`
Expected: FAIL — the first test fails because `VideoProducerOutput` strips the unknown `durableAssetUrl` (parsed value is `undefined`).

- [ ] **Step 3: Add the field**

In `packages/schemas/src/creative-job.ts`, inside `VideoProducerOutput = z.object({ ... })`, add after the `errors` field (around line 169, before the closing `})`):

```ts
  durableAssetUrl: z.string().optional(),
```

- [ ] **Step 4: Run test to verify it passes + rebuild schemas for downstream typecheck**

Run: `pnpm --filter @switchboard/schemas test -- creative-job && pnpm --filter @switchboard/schemas build`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/creative-job.ts packages/schemas/src/__tests__/creative-job.test.ts
git commit -m "feat(schemas): add optional durableAssetUrl to VideoProducerOutput"
```

---

## Task 2: Producer — `AssetStorageClient`, upload seam, `jobId`

**Files:**

- Modify: `packages/creative-pipeline/src/stages/video-producer.ts`
- Modify: `packages/creative-pipeline/src/index.ts`
- Test: `packages/creative-pipeline/src/stages/__tests__/video-producer.test.ts`

- [ ] **Step 1: Write the failing tests + give existing tests a `jobId`**

In `packages/creative-pipeline/src/stages/__tests__/video-producer.test.ts`, add `jobId: "job_1",` to the input object of all four existing `runVideoProducer({ ... }, deps)` calls (the calls currently passing `{ storyboard, scripts, tier, platforms, productDescription }`). Then append these three tests inside `describe("runVideoProducer", () => { ... })`:

```ts
it("uploads the assembled video + thumbnail and sets durableAssetUrl (pro tier)", async () => {
  const deps = makeMockDeps();
  const upload = vi
    .fn()
    .mockResolvedValueOnce({ url: "https://cdn.example.com/creative-assets/job_1/u.mp4" })
    .mockResolvedValueOnce({ url: "https://cdn.example.com/creative-assets/job_1/u-thumb.jpg" });
  deps.assetStorage = { upload };

  const result = await runVideoProducer(
    {
      jobId: "job_1",
      storyboard,
      scripts,
      tier: "pro",
      platforms: ["meta"],
      productDescription: "A widget",
    },
    deps,
  );

  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload).toHaveBeenNthCalledWith(1, expect.objectContaining({ contentType: "video/mp4" }));
  expect(upload).toHaveBeenNthCalledWith(2, expect.objectContaining({ contentType: "image/jpeg" }));
  expect(result.assembledVideos?.[0]?.videoUrl).toBe(
    "https://cdn.example.com/creative-assets/job_1/u.mp4",
  );
  expect(result.assembledVideos?.[0]?.thumbnailUrl).toBe(
    "https://cdn.example.com/creative-assets/job_1/u-thumb.jpg",
  );
  expect(result.durableAssetUrl).toBe("https://cdn.example.com/creative-assets/job_1/u.mp4");
});

it("leaves assembled URLs local and durableAssetUrl undefined when no assetStorage", async () => {
  const deps = makeMockDeps();
  const result = await runVideoProducer(
    {
      jobId: "job_1",
      storyboard,
      scripts,
      tier: "pro",
      platforms: ["meta"],
      productDescription: "A widget",
    },
    deps,
  );
  expect(result.durableAssetUrl).toBeUndefined();
  expect(result.assembledVideos?.[0]?.videoUrl).toBe("https://r2.example.com/assembled.mp4");
});

it("propagates storage upload errors (fail loud, no fake success)", async () => {
  const deps = makeMockDeps();
  deps.assetStorage = { upload: vi.fn().mockRejectedValue(new Error("S3 unavailable")) };
  await expect(
    runVideoProducer(
      {
        jobId: "job_1",
        storyboard,
        scripts,
        tier: "pro",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    ),
  ).rejects.toThrow("S3 unavailable");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/creative-pipeline test -- video-producer`
Expected: FAIL — the upload test fails (`result.durableAssetUrl` is `undefined`, `upload` never called).

- [ ] **Step 3: Implement the interface, deps field, jobId, and upload seam**

In `packages/creative-pipeline/src/stages/video-producer.ts`:

(a) Add the import at the top of the file:

```ts
import { randomUUID } from "node:crypto";
```

(b) Add the interface immediately after the `AssemblerLike` interface (after line 48):

```ts
export interface AssetStorageClient {
  upload(params: { localPath: string; key: string; contentType: string }): Promise<{ url: string }>;
}
```

(c) Add the field to `VideoProducerDeps` (after `videoAssembler?`):

```ts
  assetStorage?: AssetStorageClient;
```

(d) Add `jobId` to `VideoProducerInput` (as the first field):

```ts
interface VideoProducerInput {
  jobId: string;
  storyboard: StoryboardOutput;
  scripts: ScriptWriterOutput;
  tier: "basic" | "pro" | "premium";
  platforms: string[];
  productDescription: string;
}
```

(e) Declare `durableAssetUrl` just before the assembly block (immediately before `if (clips.length > 0 && deps.videoAssembler) {`):

```ts
let durableAssetUrl: string | undefined;
```

(f) Replace the `if (assembled) { assembledVideos.push({...}); }` block with this upload-then-push block:

```ts
if (assembled) {
  let videoUrl = assembled.videoUrl;
  let thumbnailUrl = assembled.thumbnailUrl;

  if (deps.assetStorage) {
    const baseKey = `creative-assets/${input.jobId}/${randomUUID()}`;
    const uploadedVideo = await deps.assetStorage.upload({
      localPath: assembled.videoUrl,
      key: `${baseKey}.mp4`,
      contentType: "video/mp4",
    });
    const uploadedThumb = await deps.assetStorage.upload({
      localPath: assembled.thumbnailUrl,
      key: `${baseKey}-thumb.jpg`,
      contentType: "image/jpeg",
    });
    videoUrl = uploadedVideo.url;
    thumbnailUrl = uploadedThumb.url;
    durableAssetUrl = uploadedVideo.url;
  }

  assembledVideos.push({
    videoUrl,
    thumbnailUrl,
    format: aspectRatio,
    duration: assembled.duration,
    platform,
    hasVoiceover: !!voiceover,
    hasCaptions: !!voiceover?.captionsUrl,
    hasBackgroundMusic: false,
  });
}
```

(g) Add `durableAssetUrl` to the final `return` object (after the `voiceover` spread):

```ts
return {
  tier: input.tier,
  clips,
  ...(assembledVideos.length > 0 ? { assembledVideos } : {}),
  ...(voiceover ? { voiceover } : {}),
  ...(durableAssetUrl ? { durableAssetUrl } : {}),
  ...(errors.length > 0 ? { errors } : {}),
};
```

- [ ] **Step 4: Export the interface from the package index**

In `packages/creative-pipeline/src/index.ts`, add (e.g. after line 5):

```ts
export type { AssetStorageClient } from "./stages/video-producer.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/creative-pipeline test -- video-producer`
Expected: PASS (all 7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/stages/video-producer.ts packages/creative-pipeline/src/stages/__tests__/video-producer.test.ts packages/creative-pipeline/src/index.ts
git commit -m "feat(creative-pipeline): upload assembled creative to durable storage at the assembly seam"
```

---

## Task 3: Thread `assetStorage` + `jobId` through `runStage`

**Files:**

- Modify: `packages/creative-pipeline/src/stages/run-stage.ts`
- Test: `packages/creative-pipeline/src/stages/__tests__/run-stage-production.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/creative-pipeline/src/stages/__tests__/run-stage-production.test.ts`, extract the existing `const input: StageInput = { ... }` from the test into a module-scope `const baseProductionInput: StageInput = { ... }` (the same object), have the existing test use it, then append this test:

```ts
it("forwards assetStorage + jobId to runVideoProducer for production", async () => {
  const { runVideoProducer } = await import("../video-producer.js");
  const mockProducer = runVideoProducer as ReturnType<typeof vi.fn>;
  mockProducer.mockClear();

  const assetStorage = { upload: vi.fn() };
  await runStage("production", { ...baseProductionInput, assetStorage });

  expect(mockProducer).toHaveBeenCalledWith(
    expect.objectContaining({ jobId: "job-1" }),
    expect.objectContaining({ assetStorage }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/creative-pipeline test -- run-stage-production`
Expected: FAIL — `runVideoProducer` is called without `assetStorage` (and `StageInput` has no `assetStorage` field).

- [ ] **Step 3: Implement the threading**

In `packages/creative-pipeline/src/stages/run-stage.ts`:

(a) Extend the type import from `./video-producer.js`:

```ts
import type { VideoProducerDeps, AssetStorageClient } from "./video-producer.js";
```

(b) Add the field to `StageInput` (after `productionTier?`):

```ts
  assetStorage?: AssetStorageClient;
```

(c) In the `case "production":` block, set the dep and pass `jobId`. Replace the `const deps: VideoProducerDeps = { ... };` construction and the `return runVideoProducer(...)` with:

```ts
const deps: VideoProducerDeps = {
  klingClient,
  optimizePrompt: createPromptOptimizer(input.apiKey),
};
if (input.assetStorage) {
  deps.assetStorage = input.assetStorage;
}

if (tier === "pro") {
  deps.elevenLabsClient = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  });
  deps.whisperClient = new WhisperClient({
    apiKey: input.apiKey,
  });
  deps.videoAssembler = new VideoAssembler();
}

return runVideoProducer(
  {
    jobId: input.jobId,
    storyboard,
    scripts,
    tier,
    platforms: input.brief.platforms,
    productDescription: input.brief.productDescription,
  },
  deps,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/creative-pipeline test -- run-stage-production`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/stages/run-stage.ts packages/creative-pipeline/src/stages/__tests__/run-stage-production.test.ts
git commit -m "feat(creative-pipeline): thread assetStorage and jobId through runStage to the producer"
```

---

## Task 4: Runner — `setDurableAsset` on `JobStore` + persist at completion

**Files:**

- Modify: `packages/creative-pipeline/src/creative-job-runner.ts`
- Test: `packages/creative-pipeline/src/__tests__/creative-job-runner.test.ts`

- [ ] **Step 1: Write the failing tests + fix the call site + extend the mock store**

In `packages/creative-pipeline/src/__tests__/creative-job-runner.test.ts`:

(a) Add `setDurableAsset: vi.fn(),` to BOTH mock stores — inside `createMockJobStore()` (after `stop: vi.fn(),`) and inside the `mockJobStore` object literal in the `"createCreativeJobRunner — onFailure wiring"` describe (after `stop: vi.fn()`).

(b) Fix the onFailure-wiring call site so `onFailure` stays in the last slot (a new `assetStorage` param precedes it). Change:

```ts
createCreativeJobRunner(mockJobStore as never, llmConf, undefined, onFailure);
```

to:

```ts
createCreativeJobRunner(mockJobStore as never, llmConf, undefined, undefined, onFailure);
```

(c) Append these two tests inside `describe("executeCreativePipeline", () => { ... })`:

```ts
it("persists durableAssetUrl after production when the output carries one", async () => {
  const { runStage } = await import("../stages/run-stage.js");
  const mockRunStage = runStage as ReturnType<typeof vi.fn>;
  mockRunStage.mockImplementation((stage: string) =>
    stage === "production"
      ? { durableAssetUrl: "https://cdn.example.com/creative-assets/job_1/u.mp4" }
      : { placeholder: true },
  );

  await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

  expect(jobStore.setDurableAsset).toHaveBeenCalledTimes(1);
  expect(jobStore.setDurableAsset).toHaveBeenCalledWith(
    "org_1",
    "job_1",
    "https://cdn.example.com/creative-assets/job_1/u.mp4",
  );

  mockRunStage.mockReset();
  mockRunStage.mockResolvedValue({ placeholder: true });
});

it("does not persist durableAssetUrl when production output lacks one", async () => {
  await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);
  expect(jobStore.setDurableAsset).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/creative-pipeline test -- creative-job-runner`
Expected: FAIL — `jobStore.setDurableAsset` is never called (the runner doesn't persist it yet).

- [ ] **Step 3: Implement the runner changes**

In `packages/creative-pipeline/src/creative-job-runner.ts`:

(a) Extend the schemas import and add the `AssetStorageClient` import:

```ts
import type { CreativeJob, VideoProducerOutput } from "@switchboard/schemas";
import type { AssetStorageClient } from "./stages/video-producer.js";
```

(b) Add `setDurableAsset` to the `JobStore` interface (after `stop`):

```ts
  setDurableAsset(organizationId: string, id: string, url: string): Promise<CreativeJob>;
```

(c) Add an `assetStorage?` param to `executeCreativePipeline` (after `imageConfig?`):

```ts
export async function executeCreativePipeline(
  eventData: JobEventData,
  step: StepTools,
  jobStore: JobStore,
  llmConfig: LLMConfig,
  imageConfig?: ImageConfig,
  assetStorage?: AssetStorageClient,
): Promise<void> {
```

(d) Pass `assetStorage` into the `runStage` call's `StageInput` (add `assetStorage,` after `productionTier: job.productionTier ?? "basic",`).

(e) Persist the durable URL: immediately after the `save-${stage}` `step.run(...)` and BEFORE `if (nextStage === "complete") break;`, insert:

```ts
// Once production has assembled + uploaded, persist the durable URL so the
// creative.job.publish precondition (assertPublishable) can find it.
if (stage === "production") {
  const durableAssetUrl = (output as VideoProducerOutput).durableAssetUrl;
  if (durableAssetUrl) {
    await step.run("save-durable-asset", () =>
      jobStore.setDurableAsset(eventData.organizationId, job.id, durableAssetUrl),
    );
  }
}
```

(f) Add an `assetStorage?` param to `createCreativeJobRunner` (between `imageConfig?` and `onFailure?`) and forward it:

```ts
export function createCreativeJobRunner(
  jobStore: JobStore,
  llmConfig: LLMConfig,
  imageConfig?: ImageConfig,
  assetStorage?: AssetStorageClient,
  onFailure?: (arg: unknown) => Promise<void>,
) {
  return inngestClient.createFunction(
    {
      id: "creative-job-runner",
      name: "Creative Pipeline Job Runner",
      retries: 3,
      triggers: [{ event: "creative-pipeline/polished.submitted" }],
      ...(onFailure ? { onFailure } : {}),
    },
    async ({ event, step }: { event: { data: JobEventData }; step: StepTools }) => {
      await executeCreativePipeline(
        event.data,
        step,
        jobStore,
        llmConfig,
        imageConfig,
        assetStorage,
      );
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/creative-pipeline test -- creative-job-runner`
Expected: PASS (existing step-count tests still pass because the default `runStage` mock returns no `durableAssetUrl`, so no extra `save-durable-asset` step runs).

- [ ] **Step 5: Rebuild creative-pipeline (consumed cross-package by apps/api) + commit**

Run: `pnpm --filter @switchboard/creative-pipeline build`
Expected: build succeeds.

```bash
git add packages/creative-pipeline/src/creative-job-runner.ts packages/creative-pipeline/src/__tests__/creative-job-runner.test.ts
git commit -m "feat(creative-pipeline): persist durableAssetUrl after production via injected store"
```

---

## Task 5: DB store — `setDurableAsset`

**Files:**

- Modify: `packages/db/src/stores/prisma-creative-job-store.ts` (add method after `updatePublishFields`, ~line 172)
- Test: `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts`, inside the top-level `describe("PrismaCreativeJobStore", ...)` (e.g. after the `updatePublishFields` describe):

```ts
describe("setDurableAsset", () => {
  it("org-scopes the updateMany with durableAssetUrl and returns the refreshed row", async () => {
    const url = "https://cdn.example.com/creative-assets/cj_1/u.mp4";
    prisma.creativeJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.creativeJob.findFirstOrThrow.mockResolvedValue({ id: "cj_1", durableAssetUrl: url });

    const result = await store.setDurableAsset("org_1", "cj_1", url);

    expect(prisma.creativeJob.updateMany).toHaveBeenCalledWith({
      where: { id: "cj_1", organizationId: "org_1" },
      data: { durableAssetUrl: url },
    });
    expect(prisma.creativeJob.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: "cj_1", organizationId: "org_1" },
    });
    expect((result as { durableAssetUrl?: string }).durableAssetUrl).toBe(url);
  });

  it("throws StaleVersionError when count=0 (cross-org / missing)", async () => {
    prisma.creativeJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(store.setDurableAsset("org_other", "cj_1", "https://x")).rejects.toThrow(
      StaleVersionError,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- prisma-creative-job-store`
Expected: FAIL — `store.setDurableAsset` is not a function.

- [ ] **Step 3: Implement the method**

In `packages/db/src/stores/prisma-creative-job-store.ts`, add after `updatePublishFields` (after line 172):

```ts
  /**
   * Persist the durable assembled-creative URL (PR A producer write). Org-scoped
   * updateMany (doctrine #12); count===0 ⇒ missing/cross-org ⇒ throw. Consumed by
   * the creative.job.publish precondition (assertPublishable).
   */
  async setDurableAsset(organizationId: string, id: string, url: string): Promise<CreativeJob> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { durableAssetUrl: url },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- prisma-creative-job-store`
Expected: PASS.

- [ ] **Step 5: Rebuild db + commit**

Run: `pnpm --filter @switchboard/db build`
Expected: build succeeds.

```bash
git add packages/db/src/stores/prisma-creative-job-store.ts packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts
git commit -m "feat(db): add setDurableAsset to PrismaCreativeJobStore"
```

---

## Task 6: apps/api — `S3CreativeAssetStorage` + `buildCreativeAssetStorage`

**Files:**

- Create: `apps/api/src/lib/creative-asset-storage.ts`
- Test: `apps/api/src/lib/__tests__/creative-asset-storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/__tests__/creative-asset-storage.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { S3CreativeAssetStorage, buildCreativeAssetStorage } from "../creative-asset-storage.js";

describe("S3CreativeAssetStorage.upload", () => {
  it("PUTs the file bytes with content-type and returns the public URL", async () => {
    const send = vi.fn().mockResolvedValue({});
    const fakeClient = { send } as unknown as S3Client;
    const storage = new S3CreativeAssetStorage(
      {
        bucket: "creatives",
        region: "auto",
        accessKeyId: "k",
        secretAccessKey: "s",
        publicBaseUrl: "https://cdn.example.com/",
        endpoint: "https://acct.r2.cloudflarestorage.com",
      },
      fakeClient,
    );

    const path = join(tmpdir(), `sb-test-${randomUUID()}.mp4`);
    await writeFile(path, Buffer.from("FAKEMP4BYTES"));
    try {
      const { url } = await storage.upload({
        localPath: path,
        key: "creative-assets/job_1/abc.mp4",
        contentType: "video/mp4",
      });

      expect(url).toBe("https://cdn.example.com/creative-assets/job_1/abc.mp4");
      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(command.input).toMatchObject({
        Bucket: "creatives",
        Key: "creative-assets/job_1/abc.mp4",
        ContentType: "video/mp4",
      });
      expect(Buffer.isBuffer(command.input.Body)).toBe(true);
      expect((command.input.Body as Buffer).toString()).toBe("FAKEMP4BYTES");
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("buildCreativeAssetStorage", () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
  });

  it("returns undefined and warns when required env is missing", () => {
    delete process.env["CREATIVE_ASSET_BUCKET"];
    delete process.env["CREATIVE_ASSET_ACCESS_KEY_ID"];
    delete process.env["CREATIVE_ASSET_SECRET_ACCESS_KEY"];
    delete process.env["CREATIVE_ASSET_PUBLIC_BASE_URL"];

    const warn = vi.fn();
    const result = buildCreativeAssetStorage({ warn });

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns a storage instance when required env is present", () => {
    process.env["CREATIVE_ASSET_BUCKET"] = "creatives";
    process.env["CREATIVE_ASSET_ACCESS_KEY_ID"] = "k";
    process.env["CREATIVE_ASSET_SECRET_ACCESS_KEY"] = "s";
    process.env["CREATIVE_ASSET_PUBLIC_BASE_URL"] = "https://cdn.example.com";
    process.env["CREATIVE_ASSET_S3_ENDPOINT"] = "https://acct.r2.cloudflarestorage.com";

    const result = buildCreativeAssetStorage({ warn: vi.fn() });
    expect(result).toBeInstanceOf(S3CreativeAssetStorage);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/api test -- creative-asset-storage`
Expected: FAIL — module `../creative-asset-storage.js` does not exist.

- [ ] **Step 3: Implement the module**

Create `apps/api/src/lib/creative-asset-storage.ts`:

```ts
import { readFile } from "node:fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { AssetStorageClient } from "@switchboard/creative-pipeline";

export interface CreativeAssetStorageConfig {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

/**
 * S3-compatible durable storage for assembled creatives (Cloudflare R2 by
 * default; works against AWS S3/MinIO by changing env only). Objects are stored
 * under unguessable keys in a bucket configured for public read at
 * `publicBaseUrl`; the returned URL is directly fetchable by the publish handler.
 */
export class S3CreativeAssetStorage implements AssetStorageClient {
  private readonly client: S3Client;

  constructor(
    private readonly config: CreativeAssetStorageConfig,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  async upload(params: {
    localPath: string;
    key: string;
    contentType: string;
  }): Promise<{ url: string }> {
    const body = await readFile(params.localPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: params.key,
        Body: body,
        ContentType: params.contentType,
      }),
    );
    const base = this.config.publicBaseUrl.replace(/\/+$/, "");
    return { url: `${base}/${params.key}` };
  }
}

interface LoggerLike {
  warn(msg: string): void;
}

/**
 * Build the storage client from CREATIVE_ASSET_* env. Returns undefined (with a
 * warning) when unconfigured — rendering still works but creatives are not
 * durable, so creative.job.publish fails loud CREATIVE_ASSET_NOT_DURABLE.
 */
export function buildCreativeAssetStorage(log: LoggerLike): S3CreativeAssetStorage | undefined {
  const bucket = process.env["CREATIVE_ASSET_BUCKET"];
  const accessKeyId = process.env["CREATIVE_ASSET_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["CREATIVE_ASSET_SECRET_ACCESS_KEY"];
  const publicBaseUrl = process.env["CREATIVE_ASSET_PUBLIC_BASE_URL"];
  const endpoint = process.env["CREATIVE_ASSET_S3_ENDPOINT"];
  const region = process.env["CREATIVE_ASSET_REGION"] ?? "auto";

  if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    log.warn(
      "Creative asset storage not configured (CREATIVE_ASSET_* missing) — rendered creatives will not be durable; creative.job.publish will fail loud CREATIVE_ASSET_NOT_DURABLE.",
    );
    return undefined;
  }

  return new S3CreativeAssetStorage({
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    region,
    ...(endpoint ? { endpoint } : {}),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api test -- creative-asset-storage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/creative-asset-storage.ts apps/api/src/lib/__tests__/creative-asset-storage.test.ts
git commit -m "feat(api): add S3CreativeAssetStorage + buildCreativeAssetStorage (R2-default)"
```

---

## Task 7: Inject `assetStorage` at the composition root

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts` (construct near line 168; inject into the `createCreativeJobRunner(...)` call ~line 768)

- [ ] **Step 1: Sync lower-layer builds** (so apps/api resolves the new creative-pipeline runner signature + db method at runtime/typecheck)

Run: `cd /Users/jasonli/switchboard/.claude/worktrees/creative-durable-asset-storage && pnpm build`
Expected: build succeeds (turbo rebuilds creative-pipeline + db).

- [ ] **Step 2: Add the import + construct the client**

In `apps/api/src/bootstrap/inngest.ts`:

(a) Add the import alongside the other `../lib/...` imports near the top:

```ts
import { buildCreativeAssetStorage } from "../lib/creative-asset-storage.js";
```

(b) After the existing `const klingClient = ...` line (line 168), add (note: NOT named `assetStore` — that is the unrelated `PrismaAssetRecordStore` on line 166):

```ts
const assetStorage = buildCreativeAssetStorage(app.log);
```

- [ ] **Step 3: Inject into the polished runner**

Change the `createCreativeJobRunner(...)` call (line 768) to pass `assetStorage` between the image-config arg and the `onFailure` handler:

```ts
      createCreativeJobRunner(
        jobStore,
        { apiKey },
        openaiApiKey ? { openaiApiKey } : undefined,
        assetStorage,
        makeOnFailureHandler(
          {
            functionId: "creative-job-runner",
            eventDomain: "creative.polished",
            riskCategory: "medium",
            alert: false,
          },
          asyncFailure,
        ) as (arg: unknown) => Promise<void>,
      ),
```

- [ ] **Step 4: Verify typecheck + the api suite (catch any bootstrap test that constructs the runner)**

Run: `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/api test`
Expected: PASS. If a bootstrap/inngest test asserts the `createCreativeJobRunner` arity/args, update it to include the `assetStorage` slot (the runner now takes `(jobStore, llmConfig, imageConfig?, assetStorage?, onFailure?)`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/inngest.ts
git commit -m "feat(api): inject durable asset storage into the polished creative runner"
```

---

## Task 8: Loop-closing regression lock (precondition accepts the storage URL)

**Files:**

- Test: `apps/api/src/services/__tests__/creative-publish-preconditions.test.ts`

- [ ] **Step 1: Add the regression test**

Append inside `describe("assertPublishable", () => { ... })` in `apps/api/src/services/__tests__/creative-publish-preconditions.test.ts`:

```ts
it("loop-closing: accepts a PR-A storage URL and surfaces the exact value to the handler", async () => {
  const url = "https://cdn.example.com/creative-assets/job_1/abc.mp4";
  const r = await assertPublishable(
    deps({ job: { ...KEPT_JOB, durableAssetUrl: url } }),
    "org_1",
    "j1",
  );
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.durableAssetUrl).toBe(url);
  }
});
```

- [ ] **Step 2: Run test to verify it passes** (this asserts the contract #830 already honors — no production change; it locks that the producer's URL shape is consumable end-to-end)

Run: `pnpm --filter @switchboard/api test -- creative-publish-preconditions`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/__tests__/creative-publish-preconditions.test.ts
git commit -m "test(api): lock that assertPublishable accepts the PR-A durable asset URL"
```

---

## Task 9: Env + infra config (`CREATIVE_ASSET_*`)

**Files:**

- Modify: `.env.example` (after `CREATIVE_PIPELINE_ALLOWED_HOSTS=`, line 257)
- Modify: `scripts/env-allowlist.local-readiness.json` (`required_in_env_example`, after `"CORS_ORIGIN"`)
- Modify: `render.yaml` (api service `envVars`, after `CREATIVE_PIPELINE_ALLOWED_HOSTS`, line 122)

- [ ] **Step 1: Add to `.env.example`**

Insert after line 257 (`CREATIVE_PIPELINE_ALLOWED_HOSTS=`):

```
# Creative Pipeline — Durable asset storage (S3-compatible; Cloudflare R2 by default)
# Where the polished pipeline's assembled MP4 + thumbnail are uploaded so a
# completed+kept creative is publishable (CreativeJob.durableAssetUrl). If unset,
# rendering still works but assets are not durable and creative.job.publish fails
# loud CREATIVE_ASSET_NOT_DURABLE. The bucket MUST be configured for public read
# at CREATIVE_ASSET_PUBLIC_BASE_URL (objects use unguessable keys). For AWS S3,
# leave CREATIVE_ASSET_S3_ENDPOINT blank and set CREATIVE_ASSET_REGION; for R2,
# set the S3 endpoint and keep region "auto".
CREATIVE_ASSET_BUCKET=
CREATIVE_ASSET_S3_ENDPOINT=
CREATIVE_ASSET_REGION=auto
CREATIVE_ASSET_ACCESS_KEY_ID=
CREATIVE_ASSET_SECRET_ACCESS_KEY=
CREATIVE_ASSET_PUBLIC_BASE_URL=
```

- [ ] **Step 2: Add to the env allowlist (alphabetical)**

In `scripts/env-allowlist.local-readiness.json`, replace the line `    "CORS_ORIGIN",` with:

```json
    "CORS_ORIGIN",
    "CREATIVE_ASSET_ACCESS_KEY_ID",
    "CREATIVE_ASSET_BUCKET",
    "CREATIVE_ASSET_PUBLIC_BASE_URL",
    "CREATIVE_ASSET_REGION",
    "CREATIVE_ASSET_S3_ENDPOINT",
    "CREATIVE_ASSET_SECRET_ACCESS_KEY",
```

- [ ] **Step 3: Add to `render.yaml`** (api service)

Insert after the `CREATIVE_PIPELINE_ALLOWED_HOSTS` block (after line 122, before the `CORS_ORIGIN` comment):

```yaml
# Creative-pipeline durable asset storage (S3-compatible; R2 by default).
# Absent => rendered creatives are not durable and creative.job.publish
# fails loud CREATIVE_ASSET_NOT_DURABLE. Bucket must be public-read at
# CREATIVE_ASSET_PUBLIC_BASE_URL (objects use unguessable keys).
- key: CREATIVE_ASSET_BUCKET
  sync: false
- key: CREATIVE_ASSET_S3_ENDPOINT
  sync: false
- key: CREATIVE_ASSET_REGION
  sync: false
- key: CREATIVE_ASSET_ACCESS_KEY_ID
  sync: false
- key: CREATIVE_ASSET_SECRET_ACCESS_KEY
  sync: false
- key: CREATIVE_ASSET_PUBLIC_BASE_URL
  sync: false
```

- [ ] **Step 4: Verify env completeness (the CI gate)**

Run: `cd /Users/jasonli/switchboard/.claude/worktrees/creative-durable-asset-storage && pnpm exec tsx scripts/check-env-completeness.ts`
Expected: PASS (no uncategorized / missing-from-example). If the script name differs, run `pnpm run` to find the env-completeness script (it is wired into CI lint+test).

- [ ] **Step 5: Commit**

```bash
git add .env.example scripts/env-allowlist.local-readiness.json render.yaml
git commit -m "chore(env): add CREATIVE_ASSET_* durable storage config + allowlist"
```

---

## Task 10: Full verification + open PR

**Files:** none (gates + PR)

- [ ] **Step 1: Build + typecheck the whole workspace**

Run: `cd /Users/jasonli/switchboard/.claude/worktrees/creative-durable-asset-storage && pnpm build && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 2: Lint + format**

Run: `pnpm lint && pnpm format:check`
Expected: PASS. If `format:check` fails, run `pnpm format` and re-stage.

- [ ] **Step 3: Run the touched package suites**

Run: `pnpm --filter @switchboard/schemas --filter @switchboard/creative-pipeline --filter @switchboard/db --filter @switchboard/api test`
Expected: all PASS.

- [ ] **Step 4: Dependency-cruiser (layer gate) + route-ingress check**

Run: `pnpm exec depcruise packages apps --config .dependency-cruiser.cjs 2>&1 | tail -5`
Expected: no `creative-pipeline-only-schemas` or circular violations (the SDK lives only in `apps/api`).

Run: `pnpm exec tsx .agent/tools/check-routes.ts --mode=error` (if its deps are missing, run `pnpm install --ignore-workspace` inside `.agent/tools` first)
Expected: PASS (PR A adds no routes).

- [ ] **Step 5: Push the branch**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/creative-durable-asset-storage
git push -u origin feat/creative-durable-asset-storage
```

- [ ] **Step 6: Open the PR (do NOT merge)**

```bash
gh pr create --base main --head feat/creative-durable-asset-storage \
  --title "feat(creative): durable rendered-asset storage — populate CreativeJob.durableAssetUrl (PR A)" \
  --body "$(cat <<'BODY'
## What

PR A of the Mira creative-loop go-live sequence (first of the three blockers in the PR-B spec §11). Producer-only: persist the polished pipeline's assembled MP4 + thumbnail to S3-compatible object storage (Cloudflare R2 by default) and write the durable public URL to `CreativeJob.durableAssetUrl`, so a completed + human-kept creative becomes publishable — closing the `CREATIVE_ASSET_NOT_DURABLE` gap that #830's publish seam left fail-loud.

## How

- `AssetStorageClient` interface owned by `creative-pipeline` (L2); concrete `S3CreativeAssetStorage` (`@aws-sdk/client-s3`) in `apps/api` (L5), injected from `inngest.ts` through the runner — no SDK in L2, no dependency-cruiser violation.
- Upload happens at the assembly seam in `runVideoProducer`; the durable URL is returned and persisted by `executeCreativePipeline` via a new `setDurableAsset` store method at production completion.
- Public-read object + stable URL (unguessable keys) → robust through Meta's review window; #830's plain-`fetch` consumer untouched.
- Fail-loud: unconfigured (dev/test) → degrade to null (publish stays loud-blocked) with a startup warn; configured-but-upload-fails → propagate (Inngest retry + onFailure).

## Out of scope (logged)

The two intermediate-artifact R2 TODOs (voiceover MP3, SRT — baked into the MP4 by FFmpeg), the UGC pipeline, and per-creative attribution. **Ops prerequisite:** the bucket must be public-read at `CREATIVE_ASSET_PUBLIC_BASE_URL`. Real backend validated against a live R2/S3 bucket before pilot (mocked in CI).

## Test

TDD throughout: producer upload/degrade/fail-loud, runner persist/no-persist, store method, S3 client + factory, and a loop-closing lock that `assertPublishable` accepts the produced URL shape.

Spec: `docs/superpowers/specs/2026-06-03-creative-durable-asset-storage-design.md`
Plan: `docs/superpowers/plans/2026-06-03-creative-durable-asset-storage.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 7: Confirm CI is green, then STOP for review (do NOT merge)**

Run: `gh pr checks --watch`
Expected: all checks green. Report the PR URL and hand off for review.

---

## Self-Review

**Spec coverage:**

- §4.1 `AssetStorageClient` interface → Task 2. §4.2 `S3CreativeAssetStorage` + `buildCreativeAssetStorage` → Task 6. §4.3 upload seam + key naming → Task 2. §4.4 output field → Task 1. §4.5 runner persists → Task 4. §4.6 store method → Task 5. §4.7 composition root → Task 7. §4.8 env → Task 9. Failure model (§3.5/§6) → Tasks 2 (fail-loud), 6 (degrade+warn). Test plan §7.1–§7.7 → Tasks 6, 2, 2, 4, 5, 8 respectively. Layering (§9) → SDK only in apps/api (Task 6), verified Task 10 dep-cruiser. No migration (column exists) → confirmed, no Prisma change.
- ✅ All spec sections map to a task.

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to". Every code step shows the full code. ✅

**Type consistency:** `AssetStorageClient.upload({ localPath, key, contentType }) → { url }` is identical in Task 2 (def), Task 3 (StageInput type), Task 6 (impl), and the mocks. `setDurableAsset(organizationId, id, url): Promise<CreativeJob>` matches in Task 4 (JobStore iface) and Task 5 (impl). Field name `assetStorage` is consistent across producer deps, `StageInput`, runner params, and the `inngest.ts` variable (distinct from `assetStore` = `PrismaAssetRecordStore`). `createCreativeJobRunner(jobStore, llmConfig, imageConfig?, assetStorage?, onFailure?)` — the new `assetStorage` slot is reflected in the Task 4 call-site fix and the Task 7 injection. ✅
