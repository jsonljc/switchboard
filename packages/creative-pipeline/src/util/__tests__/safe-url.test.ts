import { describe, it, expect } from "vitest";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  isSafeUrl,
  readBodyWithLimit,
  SsrfRejectedError,
  type SafeUrlPolicy,
} from "../safe-url.js";

const ALLOWLIST_POLICY: SafeUrlPolicy = {
  allowedSchemes: ["https:"],
  allowedHostsRegex: [/\.amazonaws\.com$/i, /\.cloudfront\.net$/i],
  rejectPrivateIPs: true,
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
};

describe("isSafeUrl", () => {
  describe("scheme rejection", () => {
    it("rejects http:// URLs", () => {
      const r = isSafeUrl("http://bucket.s3.amazonaws.com/clip.mp4", ALLOWLIST_POLICY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/scheme-not-allowed/);
    });

    it("rejects file:// URLs", () => {
      const r = isSafeUrl("file:///etc/passwd", ALLOWLIST_POLICY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/scheme-not-allowed/);
    });

    it("rejects ftp:// URLs", () => {
      const r = isSafeUrl("ftp://bucket.s3.amazonaws.com/clip.mp4", ALLOWLIST_POLICY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/scheme-not-allowed/);
    });

    it("rejects unparseable URLs", () => {
      const r = isSafeUrl("not a url", ALLOWLIST_POLICY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("url-parse-failed");
    });
  });

  describe("private IP rejection", () => {
    const cases: Array<[string, RegExp]> = [
      ["https://192.168.1.1/", /private-ipv4/],
      ["https://10.0.0.5/", /private-ipv4/],
      ["https://172.16.0.1/", /private-ipv4/],
      ["https://172.31.255.255/", /private-ipv4/],
      ["https://127.0.0.1/", /private-ipv4/],
      ["https://169.254.169.254/latest/meta-data/", /private-ipv4/],
      ["https://0.0.0.0/", /private-ipv4/],
      ["https://localhost/", /private-host/],
      ["https://app.localhost/", /private-host/],
      ["https://[::1]/", /private-ipv6/],
      ["https://[fc00::1]/", /private-ipv6/],
      ["https://[fd12:3456::1]/", /private-ipv6/],
      ["https://[fe80::1]/", /private-ipv6/],
    ];

    for (const [url, expected] of cases) {
      it(`rejects ${url}`, () => {
        const r = isSafeUrl(url, ALLOWLIST_POLICY);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(expected);
      });
    }

    it("does not reject 172.15.x.x (outside the /12)", () => {
      // 172.15.x.x is public; only 172.16-172.31 is private. Hostname is not
      // allowlisted, so it should fail with allowlist reason — not private-ip.
      const r = isSafeUrl("https://172.15.0.1/", ALLOWLIST_POLICY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/host-not-allowlisted/);
    });
  });

  describe("host allowlist", () => {
    it("rejects non-allowlisted hosts", () => {
      const r = isSafeUrl("https://evil.example.com/clip.mp4", ALLOWLIST_POLICY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/host-not-allowlisted/);
    });

    it("accepts allowlisted S3 host", () => {
      const r = isSafeUrl(
        "https://my-bucket.s3.us-east-1.amazonaws.com/clip.mp4",
        ALLOWLIST_POLICY,
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.url.hostname).toBe("my-bucket.s3.us-east-1.amazonaws.com");
    });

    it("accepts allowlisted CloudFront host", () => {
      const r = isSafeUrl("https://d123.cloudfront.net/clip.mp4", ALLOWLIST_POLICY);
      expect(r.ok).toBe(true);
    });

    it("rejects substring-bypass attempts (suffix anchor)", () => {
      // The allowlist is suffix-anchored (`$`). A host that *contains* the
      // suffix elsewhere must not pass.
      const r = isSafeUrl("https://amazonaws.com.evil.example/clip.mp4", ALLOWLIST_POLICY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/host-not-allowlisted/);
    });
  });
});

describe("readBodyWithLimit", () => {
  it("aborts streaming when total bytes exceed cap", async () => {
    const big = new Uint8Array(1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Enqueue 4 chunks of 1KB; cap is 2KB so this must throw.
        controller.enqueue(big);
        controller.enqueue(big);
        controller.enqueue(big);
        controller.enqueue(big);
        controller.close();
      },
    });
    const response = new Response(stream);

    await expect(readBodyWithLimit(response, 2048)).rejects.toBeInstanceOf(SsrfRejectedError);
  });

  it("returns the buffer when under the cap", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const response = new Response(data);
    const buf = await readBodyWithLimit(response, 1024);
    expect(buf.byteLength).toBe(5);
    expect(Array.from(buf)).toEqual([1, 2, 3, 4, 5]);
  });
});
