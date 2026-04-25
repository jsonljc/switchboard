"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, WifiOff, ShieldX, Clock } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function classifyError(error: Error): {
  icon: React.ReactNode;
  title: string;
  description: string;
  suggestion: string;
} {
  const msg = error.message.toLowerCase();

  if (msg.includes("fetch") || msg.includes("network") || msg.includes("econnrefused")) {
    return {
      icon: <WifiOff className="h-5 w-5" />,
      title: "Cannot reach the server",
      description: "The API server may be down or your network connection was interrupted.",
      suggestion: "Check that the API server is running, then retry.",
    };
  }

  if (msg.includes("unauthorized") || msg.includes("401") || msg.includes("session")) {
    return {
      icon: <ShieldX className="h-5 w-5" />,
      title: "Session expired",
      description: "Your login session has expired or is invalid.",
      suggestion: "Please refresh the page to log in again.",
    };
  }

  if (msg.includes("timeout") || msg.includes("timed out")) {
    return {
      icon: <Clock className="h-5 w-5" />,
      title: "Request timed out",
      description: "The server took too long to respond.",
      suggestion: "Try again in a few moments.",
    };
  }

  return {
    icon: <AlertTriangle className="h-5 w-5" />,
    title: "Something went wrong",
    description: error.message || "An unexpected error occurred.",
    suggestion: "Try refreshing the page. If the issue persists, contact support.",
  };
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const classified = this.state.error
        ? classifyError(this.state.error)
        : {
            icon: <AlertTriangle className="h-5 w-5" />,
            title: "Something went wrong",
            description: "An unexpected error occurred.",
            suggestion: "Try refreshing the page.",
          };

      return (
        <div className="flex items-center justify-center min-h-[50vh] p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                {classified.icon}
                {classified.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{classified.description}</p>
              <p className="text-sm text-muted-foreground italic">{classified.suggestion}</p>
              {process.env.NODE_ENV === "development" && this.state.error?.stack && (
                <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-32">
                  {this.state.error.stack}
                </pre>
              )}
              <Button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
