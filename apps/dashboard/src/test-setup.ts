import "@testing-library/jest-dom/vitest";

// Mock IntersectionObserver for components using useScrollReveal
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;
