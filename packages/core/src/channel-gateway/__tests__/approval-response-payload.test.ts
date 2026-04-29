import { describe, it, expect } from "vitest";
import { parseApprovalResponsePayload } from "../approval-response-payload.js";

describe("parseApprovalResponsePayload", () => {
  it("returns payload for a valid approve JSON", () => {
    const text = JSON.stringify({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });
    expect(parseApprovalResponsePayload(text)).toEqual({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "hash123",
    });
  });

  it("returns payload for a valid reject JSON", () => {
    const text = JSON.stringify({
      action: "reject",
      approvalId: "appr_2",
      bindingHash: "hash456",
    });
    expect(parseApprovalResponsePayload(text)).toEqual({
      action: "reject",
      approvalId: "appr_2",
      bindingHash: "hash456",
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseApprovalResponsePayload("not json {")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(parseApprovalResponsePayload("hello there")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseApprovalResponsePayload("")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseApprovalResponsePayload(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseApprovalResponsePayload(undefined)).toBeNull();
  });

  it("returns null for JSON arrays", () => {
    expect(parseApprovalResponsePayload(JSON.stringify(["approve", "appr_1", "h"]))).toBeNull();
  });

  it("returns null for JSON strings", () => {
    expect(parseApprovalResponsePayload(JSON.stringify("approve"))).toBeNull();
  });

  it("returns null for JSON numbers", () => {
    expect(parseApprovalResponsePayload(JSON.stringify(42))).toBeNull();
  });

  it("returns null for JSON null", () => {
    expect(parseApprovalResponsePayload(JSON.stringify(null))).toBeNull();
  });

  it("returns null when action is missing", () => {
    const text = JSON.stringify({ approvalId: "appr_1", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null for unknown action 'deny'", () => {
    const text = JSON.stringify({ action: "deny", approvalId: "appr_1", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null for unknown action 'patch'", () => {
    const text = JSON.stringify({ action: "patch", approvalId: "appr_1", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null for unknown action 'approved'", () => {
    const text = JSON.stringify({ action: "approved", approvalId: "appr_1", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when approvalId is missing", () => {
    const text = JSON.stringify({ action: "approve", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when approvalId is empty", () => {
    const text = JSON.stringify({ action: "approve", approvalId: "", bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when approvalId is not a string", () => {
    const text = JSON.stringify({ action: "approve", approvalId: 123, bindingHash: "h" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when bindingHash is missing", () => {
    const text = JSON.stringify({ action: "approve", approvalId: "appr_1" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when bindingHash is empty", () => {
    const text = JSON.stringify({ action: "approve", approvalId: "appr_1", bindingHash: "" });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when bindingHash is not a string", () => {
    const text = JSON.stringify({ action: "approve", approvalId: "appr_1", bindingHash: 0 });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });

  it("returns null when an extra field is present (strict shape)", () => {
    const text = JSON.stringify({
      action: "approve",
      approvalId: "appr_1",
      bindingHash: "h",
      extra: "nope",
    });
    expect(parseApprovalResponsePayload(text)).toBeNull();
  });
});
