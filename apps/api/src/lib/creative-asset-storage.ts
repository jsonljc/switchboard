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
 * default; works against AWS S3 / MinIO by changing env only). Objects are
 * stored under unguessable keys in a bucket configured for public read at
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
 * Build the durable-storage client from CREATIVE_ASSET_* env. Returns undefined
 * (with a warning) when unconfigured — rendering still works but creatives are
 * not durable, so creative.job.publish fails loud CREATIVE_ASSET_NOT_DURABLE.
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
