import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { parseAndVerifySignedRequest } from "../meta-signed-request.js";

const SECRET = "test-app-secret";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeSignedRequest(payload: object, secret: string = SECRET): string {
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return `${base64url(sig)}.${payloadB64}`;
}

describe("parseAndVerifySignedRequest", () => {
  it("parses and verifies a well-formed signed_request with the correct secret", () => {
    const sr = makeSignedRequest({ user_id: "12345", algorithm: "HMAC-SHA256" });
    const result = parseAndVerifySignedRequest(sr, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.payload.user_id).toBe("12345");
  });

  it("rejects when signature is signed with a different secret", () => {
    const sr = makeSignedRequest({ user_id: "12345" }, "wrong-secret");
    const result = parseAndVerifySignedRequest(sr, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");
    expect(result.reason).toBe("invalid_signature");
  });

  it("rejects when the payload is tampered with after signing", () => {
    const sr = makeSignedRequest({ user_id: "12345" });
    const [sig] = sr.split(".");
    const tamperedPayload = base64url(Buffer.from(JSON.stringify({ user_id: "99999" })));
    const tampered = `${sig}.${tamperedPayload}`;
    const result = parseAndVerifySignedRequest(tampered, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects malformed input (missing dot separator)", () => {
    const result = parseAndVerifySignedRequest("not-a-signed-request", SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");
    expect(result.reason).toBe("malformed");
  });

  it("rejects empty input", () => {
    const result = parseAndVerifySignedRequest("", SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects when payload is not JSON", () => {
    const sig = base64url(
      createHmac("sha256", SECRET)
        .update(base64url(Buffer.from("not-json")))
        .digest(),
    );
    const sr = `${sig}.${base64url(Buffer.from("not-json"))}`;
    const result = parseAndVerifySignedRequest(sr, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects when payload lacks a user_id", () => {
    const sr = makeSignedRequest({ algorithm: "HMAC-SHA256" });
    const result = parseAndVerifySignedRequest(sr, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");
    expect(result.reason).toBe("missing_user_id");
  });

  it("rejects when secret is empty (fail-closed)", () => {
    const sr = makeSignedRequest({ user_id: "12345" });
    const result = parseAndVerifySignedRequest(sr, "");
    expect(result.ok).toBe(false);
  });
});
