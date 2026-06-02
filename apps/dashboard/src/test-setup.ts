import "@testing-library/jest-dom/vitest";

// Mock window.matchMedia for components checking prefers-reduced-motion
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock ResizeObserver for Radix UI components (e.g. Select, Switch) that use useSize
global.ResizeObserver = class ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  disconnect() {}
  observe(_target: Element, _options?: ResizeObserverOptions) {}
  unobserve(_target: Element) {}
};

// Mock IntersectionObserver for components using useScrollReveal
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;

// jsdom does not implement HTMLMediaElement play/pause — stub so feed/clip tests
// can assert play()/pause() calls without "Not implemented" errors.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: () => {},
});
