import { describe, it, expect, beforeEach } from "vitest";
import { ContactMutex, LoopDetector } from "../concurrency.js";

describe("ContactMutex", () => {
  let mutex: ContactMutex;

  beforeEach(() => {
    mutex = new ContactMutex({ timeoutMs: 1000 });
  });

  it("acquires lock for a contact", async () => {
    const release = await mutex.acquire("org-1", "contact-1");
    expect(release).toBeTypeOf("function");
    release();
  });

  it("queues second caller for same contact", async () => {
    const order: number[] = [];
    const release1 = await mutex.acquire("org-1", "contact-1");

    const promise2 = mutex.acquire("org-1", "contact-1").then((release) => {
      order.push(2);
      release();
    });

    order.push(1);
    release1();
    await promise2;

    expect(order).toEqual([1, 2]);
  });

  it("allows parallel locks for different contacts", async () => {
    const release1 = await mutex.acquire("org-1", "contact-1");
    const release2 = await mutex.acquire("org-1", "contact-2");
    expect(release1).toBeTypeOf("function");
    expect(release2).toBeTypeOf("function");
    release1();
    release2();
  });
});

describe("LoopDetector", () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector({ windowMs: 5000, maxRepeats: 3 });
  });

  it("returns false for first occurrence", () => {
    expect(detector.isLoop("org-1", "contact-1", "message.received", "hash-1")).toBe(false);
  });

  it("returns true when same event repeats beyond threshold", () => {
    detector.isLoop("org-1", "contact-1", "message.received", "hash-1");
    detector.isLoop("org-1", "contact-1", "message.received", "hash-1");
    expect(detector.isLoop("org-1", "contact-1", "message.received", "hash-1")).toBe(true);
  });

  it("returns false for different content hashes", () => {
    detector.isLoop("org-1", "contact-1", "message.received", "hash-1");
    detector.isLoop("org-1", "contact-1", "message.received", "hash-1");
    expect(detector.isLoop("org-1", "contact-1", "message.received", "hash-2")).toBe(false);
  });

  it("resets counter after window expires", async () => {
    const shortDetector = new LoopDetector({ windowMs: 50, maxRepeats: 2 });
    shortDetector.isLoop("org-1", "c1", "msg", "h1");
    await new Promise((r) => setTimeout(r, 60));
    expect(shortDetector.isLoop("org-1", "c1", "msg", "h1")).toBe(false);
  });
});
