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
      return (
        <>
          <header className="app-header">
            <div className="app-header-row">
              <span>Switchboard — temporarily unavailable</span>
            </div>
          </header>
          <main>
            <p className="empty-state">
              <em>Reload the page to try again.</em>
            </p>
          </main>
        </>
      );
    }
    return this.props.children;
  }
}
