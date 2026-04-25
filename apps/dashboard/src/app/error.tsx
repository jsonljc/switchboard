"use client";

import { useEffect } from "react";

function classifyError(error: Error): {
  title: string;
  description: string;
  suggestion: string;
} {
  const msg = error.message.toLowerCase();

  if (msg.includes("fetch") || msg.includes("network") || msg.includes("econnrefused")) {
    return {
      title: "Cannot reach the server",
      description: "The API server may be down or your network connection was interrupted.",
      suggestion: "Check that the API server is running, then retry.",
    };
  }

  if (msg.includes("unauthorized") || msg.includes("401") || msg.includes("session")) {
    return {
      title: "Session expired",
      description: "Your login session has expired or is invalid.",
      suggestion: "Please log in again to continue.",
    };
  }

  if (msg.includes("forbidden") || msg.includes("403")) {
    return {
      title: "Access denied",
      description: "You do not have permission to view this page.",
      suggestion: "Contact the account owner if you believe this is an error.",
    };
  }

  if (msg.includes("not found") || msg.includes("404")) {
    return {
      title: "Page not found",
      description: "The resource you requested does not exist or has been removed.",
      suggestion: "Check the URL or navigate back to the dashboard.",
    };
  }

  if (msg.includes("timeout") || msg.includes("timed out")) {
    return {
      title: "Request timed out",
      description: "The server took too long to respond.",
      suggestion: "Try again in a few moments. If the issue persists, check server health.",
    };
  }

  return {
    title: "Unexpected error",
    description: error.message || "An unknown error occurred while loading this page.",
    suggestion: "Try refreshing the page. If the issue persists, contact support.",
  };
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  const classified = classifyError(error);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-xl font-semibold text-foreground">{classified.title}</h2>
        <p className="text-sm text-muted-foreground">{classified.description}</p>
        <p className="text-sm text-muted-foreground italic">{classified.suggestion}</p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60 font-mono">Ref: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
