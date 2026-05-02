import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWelcomeBanner } from "../use-welcome-banner";

describe("useWelcomeBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("starts dismissed=false when localStorage is empty", () => {
    const { result } = renderHook(() => useWelcomeBanner());
    expect(result.current.dismissed).toBe(false);
  });

  it("starts dismissed=true when localStorage has '1'", () => {
    window.localStorage.setItem("sb_welcome_dismissed", "1");
    const { result } = renderHook(() => useWelcomeBanner());
    expect(result.current.dismissed).toBe(true);
  });

  it("dismiss persists to localStorage", () => {
    const { result } = renderHook(() => useWelcomeBanner());
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);
    expect(window.localStorage.getItem("sb_welcome_dismissed")).toBe("1");
  });

  it("tour('queue') scrolls to section[aria-label=Queue] and flashes for 1000ms", () => {
    const queueSection = document.createElement("section");
    queueSection.setAttribute("aria-label", "Queue");
    queueSection.scrollIntoView = vi.fn();
    document.body.appendChild(queueSection);

    const { result } = renderHook(() => useWelcomeBanner());
    act(() => result.current.tour("queue"));

    expect(queueSection.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(queueSection.classList.contains("is-flashing")).toBe(true);

    act(() => vi.advanceTimersByTime(1000));
    expect(queueSection.classList.contains("is-flashing")).toBe(false);
  });

  it("tour('agents') targets .zone3", () => {
    const zone3 = document.createElement("section");
    zone3.className = "zone3";
    zone3.scrollIntoView = vi.fn();
    document.body.appendChild(zone3);

    const { result } = renderHook(() => useWelcomeBanner());
    act(() => result.current.tour("agents"));

    expect(zone3.scrollIntoView).toHaveBeenCalled();
    expect(zone3.classList.contains("is-flashing")).toBe(true);
  });

  it("tour('activity') targets .zone4", () => {
    const zone4 = document.createElement("section");
    zone4.className = "zone4";
    zone4.scrollIntoView = vi.fn();
    document.body.appendChild(zone4);

    const { result } = renderHook(() => useWelcomeBanner());
    act(() => result.current.tour("activity"));

    expect(zone4.scrollIntoView).toHaveBeenCalled();
    expect(zone4.classList.contains("is-flashing")).toBe(true);
  });

  it("tour() is a no-op if the target element is not in the DOM", () => {
    const { result } = renderHook(() => useWelcomeBanner());
    expect(() => act(() => result.current.tour("queue"))).not.toThrow();
  });
});
