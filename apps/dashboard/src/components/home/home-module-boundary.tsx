"use client";

import React from "react";

interface HomeModuleBoundaryProps {
  children: React.ReactNode;
  /** Quiet inline fallback rendered when the child module throws. */
  fallback?: React.ReactNode;
}

interface HomeModuleBoundaryState {
  hasError: boolean;
}

const defaultFallback = (
  <p
    style={{
      fontFamily: "var(--mono)",
      fontSize: "11px",
      color: "var(--ink-3)",
      padding: "12px 4px",
    }}
  >
    This section is unavailable.
  </p>
);

/**
 * HomeModuleBoundary — per-module error boundary for the Home screen.
 *
 * Wraps a single Home module so a render-throw in one section shows a quiet
 * inline fallback while all sibling modules continue to render.
 *
 * Uses a minimal fallback (a muted line) rather than a full-screen error card —
 * Home is editorial, not a hard-error surface.
 */
export class HomeModuleBoundary extends React.Component<
  HomeModuleBoundaryProps,
  HomeModuleBoundaryState
> {
  constructor(props: HomeModuleBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): HomeModuleBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[HomeModuleBoundary] module render error", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? defaultFallback;
    }
    return this.props.children;
  }
}
