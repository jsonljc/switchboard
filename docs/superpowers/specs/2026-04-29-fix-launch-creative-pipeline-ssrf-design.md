# Fix Launch — Creative Pipeline SSRF

**Date:** 2026-04-29
**Status:** Design
**Severity:** HIGH
**Source:** Pre-launch security audit, finding OW-1 (`.audit/12-pre-launch-security-audit.md`)

## Problem

`packages/creative-pipeline/src/stages/video-assembler.ts:136-152` (`downloadClips`) takes `clip.videoUrl` from upstream pipeline input and calls `fetch(clip.videoUrl)` if the URL starts with `"http"`. There is no allowlist or scheme/host validation. A malicious or compromised pipeline input can cause the chat server to make HTTP requests against arbitrary destinations — including private/internal IPs (cloud metadata service, Kubernetes API, internal Postgres/Redis admin ports, etc.).

PR #285 set the pattern by hardening WhatsApp-test against URL-injection (CodeQL `js/request-forgery`); this spec applies the same pattern to the creative-pipeline.

## Goal

`downloadClips` (and any other outbound `fetch` call in the creative-pipeline that uses input-supplied URLs) validates the URL before fetching: scheme must be `https://`, host must not resolve to a private/internal IP, and host must be on an allowlist of known media providers (S3, signed-URL hosts, configured CDNs).

## Approach

### 1. URL validator helper

Create `packages/creative-pipeline/src/util/safe-url.ts`:
```ts
export interface SafeUrlPolicy {
  allowedSchemes: ("https:")[];
  allowedHostsRegex: RegExp[]; // e.g. /\.amazonaws\.com$/, /\.cloudfront\.net$/
  rejectPrivateIPs: boolean;
  maxResponseBytes: number;
}

export function isSafeUrl(rawUrl: string, policy: SafeUrlPolicy): { ok: true; url: URL } | { ok: false; reason: string };
```

Implementation rules:
- Parse with `new URL(rawUrl)`; reject if parse throws.
- Reject if `url.protocol !== "https:"` (or any other scheme not in `allowedSchemes`).
- Reject if `url.hostname` is an IP address that lies in `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, or `fc00::/7`. Use a small CIDR check (no extra deps).
- Reject if `url.hostname` does not match any regex in `allowedHostsRegex`.
- Return the parsed URL on success.

Default policy:
- Schemes: `["https:"]`.
- Allowed hosts: load from env `CREATIVE_PIPELINE_ALLOWED_HOSTS` (comma-separated regex patterns) with a sensible default for the deployment's known media bucket.
- `rejectPrivateIPs: true`.
- `maxResponseBytes: 200 * 1024 * 1024` (200 MB cap).

### 2. Apply to `downloadClips`

In `packages/creative-pipeline/src/stages/video-assembler.ts:136-152`:
- Replace `if (clip.videoUrl.startsWith("http"))` with a call to `isSafeUrl(clip.videoUrl, defaultPolicy)`.
- On rejection: throw a structured error (`SsrfRejectedError` or similar) and let the pipeline mark the job as failed with the rejection reason.
- On accept: proceed with `fetch(safeUrl.url, ...)`. Wrap the fetch with a streaming size guard: read the response body in chunks and abort if the byte total exceeds `policy.maxResponseBytes`. (`fetch` does not natively support this; implement via `response.body.getReader()`.)

### 3. Sweep for other input-controlled fetches in creative-pipeline

Run `rg "fetch\(" packages/creative-pipeline/src/ --type ts -n` and apply the same validator to any other call that takes a URL from job input. The audit only flagged `downloadClips`; the sweep is verification.

### 4. Tests

- `packages/creative-pipeline/src/util/__tests__/safe-url.test.ts`:
  - Reject `http://`, `file://`, `ftp://`.
  - Reject `https://192.168.1.1/...`, `https://169.254.169.254/latest/meta-data/`, `https://localhost/...`.
  - Reject hostnames not in the allowlist.
  - Accept allowlisted hosts.
- `packages/creative-pipeline/src/stages/__tests__/video-assembler-ssrf.test.ts`:
  - `downloadClips` rejects a URL pointing at `169.254.169.254` with a structured error.
  - `downloadClips` rejects a non-HTTPS URL.
  - `downloadClips` accepts an allowlisted S3 URL (mocked fetch).

## Acceptance criteria

- `packages/creative-pipeline/src/util/safe-url.ts` exists with the validator and tests pass.
- `downloadClips` uses the validator and rejects all unsafe URLs.
- Response size guard in place; oversized downloads are aborted.
- Allowlist configurable via env var; documented in `.env.example`.
- New tests pass; existing creative-pipeline tests continue to pass.
- `pnpm test --filter @switchboard/creative-pipeline` and `pnpm typecheck` green.

## Out of scope

- SSRF sweeps in other packages (e.g., `apps/api/src/routes/marketplace.ts` Telegram bot setup uses Telegram-specific URLs and is not user-input-controlled — verify but no separate spec needed).
- DNS rebinding protection — beyond scope at this stage; revisit pre-SOC2.
- Outbound proxy enforcement — infrastructure work; out of scope.

## Verification

- `pnpm test --filter @switchboard/creative-pipeline` passes including new tests.
- Manual: with a dev creative-pipeline job, supply `clip.videoUrl = "http://169.254.169.254/latest/meta-data/"`; confirm pipeline fails with SSRF rejection.
- Audit report's Verification Ledger updated: OW-1 marked "shipped" with PR link.
