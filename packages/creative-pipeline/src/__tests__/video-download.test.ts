// The durable-upload download seam (slice-3 spec 3.3f): SSRF-gated,
// redirect-refusing, temp-cleaning. Security-sensitive (it fetches an
// attacker-influenceable provider URL), so its gates are pinned directly.
import { describe, it, expect, vi } from "vitest";
import { existsSync } from "fs";
import { dirname } from "path";
import { downloadVideoToTmp } from "../ugc/video-download.js";
import { SsrfRejectedError, type SafeUrlPolicy } from "../util/safe-url.js";

const allowAll: SafeUrlPolicy = {
  allowedSchemes: ["https:"],
  allowedHostsRegex: [/.*/],
  rejectPrivateIPs: true,
  maxResponseBytes: 1024,
};

const denyAll: SafeUrlPolicy = {
  ...allowAll,
  allowedHostsRegex: [/^never-matches\.example$/],
};

describe("downloadVideoToTmp", () => {
  it("rejects a non-allowlisted URL before any fetch", async () => {
    const fetchSpy = vi.fn();
    await expect(
      downloadVideoToTmp("https://evil.example/clip.mp4", denyAll, fetchSpy as never),
    ).rejects.toThrow(SsrfRejectedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses redirects (allowlist bypass) and writes the body to a cleanable tmp file", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const result = await downloadVideoToTmp(
      "https://cdn.example.com/clip.mp4",
      allowAll,
      fetchSpy as never,
    );
    expect(fetchSpy).toHaveBeenCalledWith(expect.anything(), { redirect: "error" });
    expect(existsSync(result.localPath)).toBe(true);

    result.cleanup();
    expect(existsSync(dirname(result.localPath))).toBe(false);
    // cleanup is best-effort idempotent
    expect(() => result.cleanup()).not.toThrow();
  });

  it("throws on a non-ok response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      downloadVideoToTmp("https://cdn.example.com/clip.mp4", allowAll, fetchSpy as never),
    ).rejects.toThrow("403");
  });
});
