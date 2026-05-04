"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

interface State {
  hasError: boolean;
}

export class AgentBlockBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AgentBlockBoundary]", error, info);
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        <div className="dc-resolved-line">
          <em>Couldn&apos;t load this block. </em>
          <button type="button" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
