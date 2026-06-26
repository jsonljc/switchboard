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

  it("rejects the cloud-metadata hostname", () => {
    expect(() => validateScanUrl("http://metadata.google.internal/computeMetadata/v1/")).toThrow();
  });

  it("rejects private IPv6 literals (loopback, link-local, ULA)", () => {
    expect(() => validateScanUrl("http://[::1]/")).toThrow();
    expect(() => validateScanUrl("http://[fe80::1]/")).toThrow();
    expect(() => validateScanUrl("http://[fc00::1]/")).toThrow();
  });

  it("rejects IPv4-mapped IPv6 pointing at loopback", () => {
    expect(() => validateScanUrl("http://[::ffff:127.0.0.1]/")).toThrow();
  });

  it("rejects IPv4-compatible and NAT64-embedded IPv6 pointing at internal IPs", () => {
    expect(() => validateScanUrl("http://[::127.0.0.1]/")).toThrow(); // ::-compatible loopback
    expect(() => validateScanUrl("http://[::169.254.169.254]/")).toThrow(); // ::-compatible metadata
    expect(() => validateScanUrl("http://[64:ff9b::169.254.169.254]/")).toThrow(); // NAT64 metadata
  });

  it("allows a genuinely public IPv6 literal", () => {
    expect(() => validateScanUrl("http://[2606:4700:4700::1111]/")).not.toThrow();
  });

  it("rejects integer-encoded IPv4 (decimal, octal, hex) hostnames", () => {
    expect(() => validateScanUrl("http://2130706433/")).toThrow(); // 127.0.0.1 as decimal
    expect(() => validateScanUrl("http://0177.0.0.1/")).toThrow(); // octal first octet
    expect(() => validateScanUrl("http://0x7f.0.0.1/")).toThrow(); // hex first octet
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

  it("identifies link-local IPv6 (fe80::/10) as private", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
  });

  it("identifies IPv4-mapped IPv6 of a private address as private", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
  });

  it("identifies IPv4-compatible and NAT64-embedded IPv6 (hextet form) as private", () => {
    expect(isPrivateIp("::7f00:1")).toBe(true); // ::127.0.0.1 normalized
    expect(isPrivateIp("::a9fe:a9fe")).toBe(true); // ::169.254.169.254 normalized
    expect(isPrivateIp("64:ff9b::a9fe:a9fe")).toBe(true); // NAT64 169.254.169.254 normalized
  });

  it("identifies link-local / cloud-metadata IPv4 as private", () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("0.0.0.0")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});
