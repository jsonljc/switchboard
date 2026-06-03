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
      expect(Buffer.isBuffer(command.input["Body"])).toBe(true);
      expect((command.input["Body"] as Buffer).toString()).toBe("FAKEMP4BYTES");
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
