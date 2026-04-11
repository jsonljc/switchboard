import { describe, it, expect } from "vitest";
import { validateScanUrl, isPrivateIp } from "../url-validator.js";

describe("validateScanUrl", () => {
  it("accepts valid https URL", () => {
    expect(() => validateScanUrl("https://example.com")).not.toThrow();
  });

  it("accepts valid http URL", () => {
    expect(() => validateScanUrl("http://example.com")).not.toThrow();
  });

  it("rejects file:// scheme", () => {
    expect(() => validateScanUrl("file:///etc/passwd")).toThrow("Invalid URL scheme");
  });

  it("rejects ftp:// scheme", () => {
    expect(() => validateScanUrl("ftp://example.com")).toThrow("Invalid URL scheme");
  });

  it("rejects data: scheme", () => {
    expect(() => validateScanUrl("data:text/html,<h1>hi</h1>")).toThrow("Invalid URL scheme");
  });

  it("rejects URLs with IP addresses as hostnames", () => {
    expect(() => validateScanUrl("http://192.168.1.1")).toThrow("IP addresses not allowed");
  });

  it("rejects localhost", () => {
    expect(() => validateScanUrl("http://localhost:3000")).toThrow("IP addresses not allowed");
  });

  it("rejects URLs with auth credentials", () => {
    expect(() => validateScanUrl("https://user:pass@example.com")).toThrow(
      "URL must not contain credentials",
    );
  });

  it("rejects empty string", () => {
    expect(() => validateScanUrl("")).toThrow();
  });

  it("rejects malformed URL", () => {
    expect(() => validateScanUrl("not-a-url")).toThrow();
  });

  it("returns the sanitized URL", () => {
    const result = validateScanUrl("https://example.com/about?ref=123#section");
    expect(result).toBe("https://example.com/about?ref=123#section");
  });
});

describe("isPrivateIp", () => {
  it("identifies 127.x.x.x as private", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("127.0.0.2")).toBe(true);
  });

  it("identifies 10.x.x.x as private", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
  });

  it("identifies 192.168.x.x as private", () => {
    expect(isPrivateIp("192.168.1.1")).toBe(true);
  });

  it("identifies 172.16-31.x.x as private", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("identifies ::1 as private", () => {
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });
});
