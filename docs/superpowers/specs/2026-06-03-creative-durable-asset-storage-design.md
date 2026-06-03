# PR A — Durable rendered-asset storage (populate `CreativeJob.durableAssetUrl`)

> Status: **approved design**, ready for implementation plan.
> Date: 2026-06-03. Branch base: `origin/main` @ `f7dc170f`.
> This is **PR A** of the Mira creative-loop go-live sequence and the **first**
> of the three go-live blockers named in the PR-B spec (§11 of
> `2026-06-02-mira-publish-paused-ad-design.md`). It is a **producer-only** slice:
> it makes the polished pipeline's assembled creative durable and writes its URL to
> the `CreativeJob.durableAssetUrl` contract field that PR B (#830) already consumes.

## 1. Context

The governed `creative.job.publish` seam shipped in **#830** (intent
`creative.job.publish`, `MetaAdsClient.createAdCreative`/`createAd`, the
`metaVideoId/metaCampaignId/metaAdSetId/metaCreativeId/metaAdId/metaPublishStatus/durableAssetUrl`
columns, and `assertPublishable`). It is **intentionally inert in prod**: the
pre-flight `assertPublishable` returns the loud, typed failure
`CREATIVE_ASSET_NOT_DURABLE` because **nothing populates `durableAssetUrl`**.

### What grounding revealed (verified against `origin/main` @ `f7dc170f`, not assumed)

1. **The consumer side is fully wired and waiting.**
   - `CreativeJob.durableAssetUrl String?` exists (`packages/db/prisma/schema.prisma:1356`),
     added by migration `20260603000000_creative_job_meta_publish`. **No new migration is
     needed in PR A** — the column already exists; PR A only writes to it.
   - `assertPublishable` fails loud `CREATIVE_ASSET_NOT_DURABLE` when `!job.durableAssetUrl`
     (`apps/api/src/services/creative-publish-preconditions.ts:67-72`) and returns the URL in
     its `PublishContext` on success (`:105`). It accepts **any non-empty string** — so a
     well-formed `https://…` URL closes the loop.
   - The publish handler fetches the URL via an injected
     `fetchAsset(url) => Promise<{ buffer; type }>` whose **real implementation is a plain
     `fetch(url)`** (`apps/api/src/bootstrap/contained-workflows.ts:271-279`), inferring
     `image`/`video` from the response `Content-Type`. It therefore needs a **directly
     GET-able URL** (no SDK, no auth), and the `Content-Type` must be set correctly on the
     stored object.

2. **The producer side is empty.** Publishable creatives come from the **polished**
   pipeline (`assertPublishable` requires `currentStage === "complete"` and
   `reviewDecision === "kept"` — both polished-mode columns). Its final MP4 is assembled by
   `VideoAssembler.assemble()` to a **local temp path**
   `/tmp/switchboard-<ts>-assembled.mp4` chosen at
   `packages/creative-pipeline/src/stages/video-producer.ts:223`, with a `-thumb.jpg`
   thumbnail; both are returned as local-path `videoUrl`/`thumbnailUrl`
   (`video-producer.ts:244-255`) and vanish when the Inngest function exits. **No store
   method writes `durableAssetUrl`** today (`updateStage` writes only
   `currentStage`/`stageOutputs`; `updatePublishFields` covers only the `meta*` columns).

3. **No object storage exists.** No S3/R2/blob client, SDK, or bucket config anywhere
   (`render.yaml` = api + chat + redis + postgres only). The only concrete backend signal is
   the SSRF allowlist default in `.env.example:251` (`\.amazonaws\.com$,\.cloudfront\.net$`,
   with an S3 virtual-host example); prose/audit docs say "R2". Both are S3-API-compatible.

### What is solid

- **The DI seam.** The polished runner is built at the composition root
  (`apps/api/src/bootstrap/inngest.ts:768` — `createCreativeJobRunner(jobStore, { apiKey },
imageConfig?, onFailure?)`); the `jobStore` is already injected from there. This is the
  seam through which a storage client is injected (mirroring the prompt's required pattern).
- **The structural-DI convention.** The pipeline receives external clients as narrow
  `*Like` interfaces in a `deps` object (`VideoProducerDeps`, `video-producer.ts:50-56`).
- **The store-write pattern.** `PrismaCreativeJobStore` writes are org-scoped `updateMany`
  - `count===0 ⇒ throw StaleVersionError` (`updateProductionTier`,
    `prisma-creative-job-store.ts:131-143` — the exact template for the new method).

## 2. Goal & non-goals

**Goal.** At render time, persist the polished pipeline's final assembled MP4 **and**
thumbnail to durable object storage, and write the durable, server-fetchable video URL to
`CreativeJob.durableAssetUrl`, so that a **completed + human-kept** creative becomes
publishable — i.e. `assertPublishable` flips from `CREATIVE_ASSET_NOT_DURABLE` to `ok`,
closing the generate→publish loop opened by #830. Storage is a **non-governed storage
step** (no spend, not claim-bearing); the governed/claim-gated moment remains publish (#830).

**Non-goals (this PR):**

- The publish seam itself (#830, shipped).
- The two named **intermediate-artifact** "upload to R2" TODOs — voiceover MP3
  (`elevenlabs-client.ts:53`) and SRT captions (`video-producer.ts:161`). FFmpeg already
  bakes both into the final MP4, so they are not needed for publish; **deferred** as logged
  follow-ups (§8).
- Durable storage for the **UGC** pipeline (`ugc/`): it generates clips and persists
  `AssetRecord` metadata — it does not assemble a final MP4 and is not on the publish path.
- **Private/presigned** access (decision below: public-read object + stable URL).
- Per-creative attribution (P3), operator UI, Page-id setter (PR C), async/dead-letter
  hardening (PR-B §11) — all out of scope.

## 3. Decisions (locked)

1. **Backend / SDK.** Adopt **one S3-compatible SDK — `@aws-sdk/client-s3`** — added to
   **`apps/api`** (Layer 5). Default-target **Cloudflare R2** via a configurable `endpoint`
   (honors the documented "R2" intent + zero egress for video); the identical code targets
   AWS S3 / MinIO by changing env only. No SDK in any `@switchboard/*` package.

2. **Access model = public-read object + stable URL.** The assembled object is stored under
   an **unguessable key** (`creative-assets/<jobId>/<uuid>.mp4`; `jobId` is a cuid2, plus a
   random UUID) in a bucket configured for **public read** at a CDN/custom-domain base URL.
   The stored `durableAssetUrl` is the **permanent** `"<CREATIVE_ASSET_PUBLIC_BASE_URL>/<key>"`.
   Rationale: it never expires (robust through Meta's multi-day review window + parked human
   approval), it works with #830's existing plain-`fetch` consumer **unchanged** (PR A stays
   producer-only, zero blast radius into the just-shipped publish wiring), and rendered ad
   creatives are public-destined anyway. The unguessable key is the disclosure mitigation.
   (Rejected: stored long-TTL presigned URL — expires before a long park; private
   key + server-side fetch — would require changing #830's `fetchAsset`.)

3. **Injection (per layering).** A small interface **`AssetStorageClient` is owned by
   `creative-pipeline`** (L2); the concrete **`S3CreativeAssetStorage` lives in `apps/api`**
   (L5) and is **injected from `inngest.ts`** down through the runner. This satisfies the
   dependency-cruiser rule `creative-pipeline-only-schemas`
   (`.dependency-cruiser.cjs:24-33`) — the pipeline imports no SDK, no db, no app.

4. **Write path.** A new `setDurableAsset(orgId, id, url)` on the job store (interface in
   `creative-pipeline`'s `JobStore`, impl in `PrismaCreativeJobStore` using the org-scoped
   `updateMany` + `count===0` guard). The runner calls it at production→complete with the
   assembled video's durable URL.

5. **Failure model (branch dev/prod by config presence — no `NODE_ENV` gate).**
   - **Not configured** (no storage env; dev/test/CI): the storage client is `undefined`;
     the producer skips upload and leaves `durableAssetUrl` null → publish later fails loud
     `CREATIVE_ASSET_NOT_DURABLE` (acceptable, by design). A **startup `warn`** is emitted so
     the degrade is visible, never silent-looking-successful.
   - **Configured but upload fails**: the error **propagates** (no catch) → the Inngest step
     fails → retried (`retries: 3`) → `onFailure` alert. The creative does **not** fake-succeed
     with a `/tmp` URL.

## 4. Components

### 4.1 `AssetStorageClient` interface (`packages/creative-pipeline`, L2)

A narrow structural interface, exported from the package index (mirrors the `*Like`
convention, but exported because `apps/api` implements it):

```ts
export interface AssetStorageClient {
  // Reads bytes from a local path produced by assembly and stores them durably.
  // Returns the stable, public, directly-fetchable URL to persist as durableAssetUrl.
  upload(params: { localPath: string; key: string; contentType: string }): Promise<{ url: string }>;
}
```

Added as an optional field **`assetStorage?: AssetStorageClient`** to `VideoProducerDeps`
(`video-producer.ts:50-56`) and `StageInput` (`run-stage.ts:21-36`). The field is named
`assetStorage` (not `assetStore`) **throughout pipeline and app** to stay distinct from the
unrelated `PrismaAssetRecordStore` (`inngest.ts:166`) and the UGC `assetStore` record-store
field — one consistent name end to end.

### 4.2 `S3CreativeAssetStorage` + `buildCreativeAssetStorage` (`apps/api/src/lib/creative-asset-storage.ts`, L5)

```ts
export class S3CreativeAssetStorage implements AssetStorageClient {
  constructor(
    cfg: { bucket; endpoint?; region; accessKeyId; secretAccessKey; publicBaseUrl },
    client?: S3Client,
  ) {
    /* client injectable for tests */
  }
  async upload({ localPath, key, contentType }) {
    const body = await readFile(localPath);
    await this.client.send(
      new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { url: `${publicBaseUrl.replace(/\/$/, "")}/${key}` };
  }
}
```

- **No per-object ACL** (R2 rejects ACLs): public read is a bucket-level configuration at
  `CREATIVE_ASSET_PUBLIC_BASE_URL`, documented for ops. Backend-agnostic.
- `ContentType` is set so the publish handler's `Content-Type`-based `image`/`video`
  inference works (`"video/mp4"` for the MP4, `"image/jpeg"` for the thumbnail).
- The `S3Client` is **constructor-injectable** so unit tests run with a mock `send` (no network).

`buildCreativeAssetStorage(log)` reads `CREATIVE_ASSET_*` env; returns `undefined` (with a
`log.warn`) unless `bucket`, `accessKeyId`, `secretAccessKey`, `publicBaseUrl` are all
present; `endpoint` optional (R2), `region` defaults to `"auto"`.

### 4.3 Upload seam (`video-producer.ts`, the assembled-block at 244-255)

Add `jobId: string` to `VideoProducerInput` (passed from `run-stage.ts` `StageInput.jobId`).
In the `if (assembled)` block, when `deps.assetStorage` is present:

1. `key = "creative-assets/" + input.jobId + "/" + randomUUID()`; upload
   `assembled.videoUrl` (`<key>.mp4`, `video/mp4`) and `assembled.thumbnailUrl`
   (`<key>-thumb.jpg`, `image/jpeg`).
2. Use the returned durable URLs in the pushed `assembledVideos` entry (so the persisted
   `stageOutputs.production` carries durable, not `/tmp`, URLs).
3. Set a local `durableAssetUrl` = the durable **video** URL.

In practice the polished pipeline produces exactly **one** assembled video (single
`platforms[0]` + aspect ratio), so this is one MP4 + one thumbnail. When `deps.assetStorage`
is absent, behavior is unchanged (local paths, no `durableAssetUrl`).

### 4.4 Output field (`packages/schemas/src/creative-job.ts`, L1)

Add an **optional** `durableAssetUrl: z.string().optional()` to `VideoProducerOutput`
(`:129-171`). Additive and backward-compatible; lets the runner read the durable URL typed.

### 4.5 Runner persists the column (`creative-job-runner.ts`)

`JobStore` (`:19-28`) gains
`setDurableAsset(organizationId: string, id: string, url: string): Promise<CreativeJob>`.
`executeCreativePipeline` threads an `assetStorage?: AssetStorageClient` param (from
`createCreativeJobRunner`) into the `runStage` `StageInput`. After the production stage's
`save-<stage>` step, when `stage === "production"` and the output carries `durableAssetUrl`,
a `save-durable-asset` step calls `jobStore.setDurableAsset(org, jobId, url)`.

### 4.6 Store method (`packages/db/src/stores/prisma-creative-job-store.ts`, L4)

```ts
async setDurableAsset(organizationId, id, url): Promise<CreativeJob> {
  const result = await this.prisma.creativeJob.updateMany({
    where: { id, organizationId }, data: { durableAssetUrl: url },
  });
  if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  return (await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } })) as unknown as CreativeJob;
}
```

### 4.7 Composition root (`apps/api/src/bootstrap/inngest.ts`)

Construct `const assetStorage = buildCreativeAssetStorage(app.log);` near line 168 (**named
`assetStorage`, not `assetStore`** — line 166's `assetStore` is the unrelated
`PrismaAssetRecordStore`), and pass it into `createCreativeJobRunner(jobStore, { apiKey },
imageConfig, assetStorage, onFailure)` (new optional param before `onFailure`).

### 4.8 Env / config

New `CREATIVE_ASSET_*` vars added to **`.env.example`**, the `required_in_env_example` array
in **`scripts/env-allowlist.local-readiness.json`** (alphabetized; `check-env-completeness.ts`
fails otherwise), and **`render.yaml`** (`sync: false` for the two secrets):

| var                                | purpose                                               | secret  |
| ---------------------------------- | ----------------------------------------------------- | ------- |
| `CREATIVE_ASSET_BUCKET`            | bucket name                                           | no      |
| `CREATIVE_ASSET_S3_ENDPOINT`       | S3-compatible endpoint (R2 URL; empty for native AWS) | no      |
| `CREATIVE_ASSET_REGION`            | region (default `auto`)                               | no      |
| `CREATIVE_ASSET_ACCESS_KEY_ID`     | access key                                            | **yes** |
| `CREATIVE_ASSET_SECRET_ACCESS_KEY` | secret key                                            | **yes** |
| `CREATIVE_ASSET_PUBLIC_BASE_URL`   | public base URL used to build `durableAssetUrl`       | no      |

## 5. End-to-end flow

1. Polished pipeline runs; the `production` stage assembles the MP4 + thumbnail to `/tmp`.
2. If `assetStore` is injected, the producer uploads both, rewrites the `assembledVideos`
   entry to durable URLs, and returns `durableAssetUrl` (the durable video URL) in the
   production output.
3. The runner persists `stageOutputs` (now durable) and, at production→complete, calls
   `setDurableAsset(org, jobId, durableAssetUrl)`.
4. Later, an operator keeps the creative and triggers publish (#830). `assertPublishable`
   now finds a non-null `durableAssetUrl` → returns `ok`; the handler's `fetchAsset(url)`
   GETs the public URL → Buffer → `MetaAdsClient.uploadCreativeAsset`. **Loop closed.**

## 6. Failure modes

| condition                         | behavior                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage env absent (dev/test/CI)  | injected `assetStorage` is undefined → no upload, `durableAssetUrl` null, creative still completes; startup `warn`; publish later fails loud `CREATIVE_ASSET_NOT_DURABLE` |
| storage configured, upload throws | error propagates → Inngest step fails → retried → `onFailure` alert; **no** fake `/tmp` success                                                                           |
| basic tier (no assembly)          | no assembled video, no upload — unchanged (not publishable)                                                                                                               |

## 7. Test plan (TDD, real behavior — mock the storage client; no live backend)

1. **`S3CreativeAssetStorage` unit** (apps/api): with a mock `S3Client`, `upload({localPath,
key, contentType})` reads the file, sends `PutObjectCommand` with the right
   `Bucket/Key/Body/ContentType`, and returns `{ url: "<base>/<key>" }` (well-formed https).
2. **`buildCreativeAssetStorage`** (apps/api): returns `undefined` when required env is
   absent; returns a configured instance when present. No network.
3. **Producer upload seam** (creative-pipeline): with a mock `assetStorage`, after
   `assemble()` the producer uploads video + thumbnail, the returned `assembledVideos[0].
videoUrl/thumbnailUrl` are the durable URLs, and `output.durableAssetUrl` is the durable
   video URL. With **no** `assetStorage`, no upload occurs and `durableAssetUrl` is undefined.
4. **Upload-failure is loud** (creative-pipeline): when `assetStorage.upload` rejects, the
   producer propagates (does not swallow / fake-succeed).
5. **Runner persists** (creative-pipeline): when the production output carries
   `durableAssetUrl`, `executeCreativePipeline` calls `jobStore.setDurableAsset(org, jobId,
url)`; when absent, it does not.
6. **Store method** (db): `setDurableAsset` issues the org-scoped `updateMany` with
   `{ durableAssetUrl }` and throws `StaleVersionError` on `count===0` (mock-Prisma, mirror
   `prisma-creative-job-store.test.ts`).
7. **Loop-closing** (apps/api): `assertPublishable` on a complete + kept job with
   `durableAssetUrl=null` → `CREATIVE_ASSET_NOT_DURABLE`; the same job with `durableAssetUrl`
   = a `"<base>/<key>"` URL → `ok` (returns the URL); and `fetchAsset(thatUrl)` performs a
   GET of it (mock `fetch`). Proves PR A unblocks #830.

## 8. Open risks & deferred (logged, not silently dropped)

- **Public bucket is an ops prerequisite.** The bucket must be configured for public read at
  `CREATIVE_ASSET_PUBLIC_BASE_URL`. Documented in `.env.example`.
- **Intermediate-artifact TODOs deferred.** Voiceover MP3 (`elevenlabs-client.ts:53`) and SRT
  (`video-producer.ts:161`) remain `/tmp`/in-memory — baked into the MP4 by FFmpeg, not
  needed for publish. Left as TODOs (could reuse `AssetStorageClient` later).
- **Real backend unexercised in CI** (mocked). Validate against a real R2/S3 bucket before
  pilot (parallels PR-B's "validate Meta wire format" deferral).
- **SSRF allowlist not implicated.** The publish-path `fetchAsset` is a plain `fetch` with no
  SSRF gate, so the public base-URL host needs no `CREATIVE_PIPELINE_ALLOWED_HOSTS` entry.
- **Single assembled format.** `durableAssetUrl` is the one assembled video; a future
  multi-format pipeline would pick the Meta-appropriate aspect ratio.

## 9. Files touched

| layer                | path                                                                        | change                                                                                             |
| -------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| L1 schemas           | `packages/schemas/src/creative-job.ts`                                      | optional `durableAssetUrl` on `VideoProducerOutput`                                                |
| L2 creative-pipeline | `src/stages/video-producer.ts` (+ test)                                     | `AssetStorageClient` iface; `assetStore` dep; upload seam; `jobId` input; output `durableAssetUrl` |
| L2 creative-pipeline | `src/stages/run-stage.ts`                                                   | `assetStore`/`jobId` threading into `VideoProducerDeps`                                            |
| L2 creative-pipeline | `src/creative-job-runner.ts` (+ test)                                       | `assetStorage` param; `JobStore.setDurableAsset`; persist at completion                            |
| L2 creative-pipeline | `src/index.ts`                                                              | export `AssetStorageClient`                                                                        |
| L4 db                | `packages/db/src/stores/prisma-creative-job-store.ts` (+ test)              | `setDurableAsset`                                                                                  |
| L5 api               | `apps/api/src/lib/creative-asset-storage.ts` (+ test)                       | `S3CreativeAssetStorage`, `buildCreativeAssetStorage`                                              |
| L5 api               | `apps/api/src/bootstrap/inngest.ts`                                         | construct `assetStorage`, inject into runner                                                       |
| L5 api               | `apps/api/src/services/creative-publish-preconditions.test.ts`              | loop-closing assertion                                                                             |
| config               | `.env.example`, `scripts/env-allowlist.local-readiness.json`, `render.yaml` | `CREATIVE_ASSET_*`                                                                                 |
| deps                 | `apps/api/package.json`                                                     | `@aws-sdk/client-s3`                                                                               |

Layering respected: SDK in `apps/api` (L5); `creative-pipeline` (L2) owns only the
`AssetStorageClient` interface and imports no SDK/db/app. **No Prisma migration** (the
`durableAssetUrl` column already exists from #830).

## 10. Conventions / gates

ESM `.js` import extensions; no `any`; no `console.log` (use `app.log`/`console.warn`);
prettier (`pnpm format:check`); co-located `*.test.ts`; Conventional Commits (lowercase
subject first word); files < 600 lines. Before done: `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, package suites (`@switchboard/schemas`, `@switchboard/creative-pipeline`,
`@switchboard/db`, `@switchboard/api`), the route-ingress check, and dependency-cruiser
(verify no layer/circular violation). New env vars → allowlist + `.env.example` + `render.yaml`.
