// SSRF-gated one-shot video download for the durable-asset upload (slice-3
// spec 3.3f). The frame extractor cleans its own temp dir inside the
// evaluator, so the final asset's durable upload performs its own gated
// download: one fetch per spec, only for the asset that survives QA.
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import {
  defaultSafeUrlPolicy,
  isSafeUrl,
  readBodyWithLimit,
  SsrfRejectedError,
  type SafeUrlPolicy,
} from "../util/safe-url.js";

export interface DownloadedVideo {
  localPath: string;
  /** Best-effort temp cleanup; never throws. */
  cleanup: () => void;
}

export async function downloadVideoToTmp(
  videoUrl: string,
  policy: SafeUrlPolicy = defaultSafeUrlPolicy(),
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedVideo> {
  const verdict = isSafeUrl(videoUrl, policy);
  if (!verdict.ok) {
    throw new SsrfRejectedError(videoUrl, verdict.reason);
  }
  // redirect:"error": following a redirect would bypass the allowlist check
  // (same posture as the frame extractor).
  const res = await fetchImpl(verdict.url, { redirect: "error" });
  if (!res.ok) throw new Error(`Failed to download video for durable upload: ${res.status}`);
  const buffer = await readBodyWithLimit(res, policy.maxResponseBytes);

  const workDir = join(tmpdir(), `switchboard-durable-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });
  const localPath = join(workDir, "video.mp4");
  writeFileSync(localPath, buffer);

  return {
    localPath,
    cleanup: () => {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup only
      }
    },
  };
}
