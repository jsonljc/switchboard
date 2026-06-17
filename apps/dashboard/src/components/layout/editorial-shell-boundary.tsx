"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

interface State {
  hasError: boolean;
}

export class EditorialShellBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[EditorialShellBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      // Content-slot fallback. The boundary is mounted INSIDE the editorial
      // shell's <main>, wrapping only the page content, so the header + nav stay
      // mounted around it — the fallback must NOT render its own header/main
      // (that would nest landmarks). It is an in-place recovery message scoped to
      // the content area. role="alert" announces the failure to assistive tech.
      return (
        <div className="empty-state" role="alert">
          <p>Switchboard is temporarily unavailable.</p>
          <p>Reload the page to try again.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
