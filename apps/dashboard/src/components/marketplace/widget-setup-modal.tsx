"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check } from "lucide-react";

interface WidgetSetupModalProps {
  deploymentId: string;
  onClose: () => void;
  onConnected: () => void;
}

export function WidgetSetupModal({ deploymentId, onClose, onConnected }: WidgetSetupModalProps) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateToken() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/marketplace/connections/widget-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentId }),
      });
      if (!res.ok) throw new Error("Failed to generate widget token");
      const data = await res.json();
      setToken(data.connection.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setIsLoading(false);
    }
  }

  const embedSnippet = token
    ? `<script src="${window.location.origin}/widget.js" data-token="${token}"></script>`
    : "";

  function handleCopy() {
    navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Generate token on mount
  useEffect(() => {
    generateToken();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg p-6 max-w-lg w-full mx-4 space-y-4">
        <h3 className="font-display text-lg text-foreground">Add Widget to Your Website</h3>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating widget token...
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {token && (
          <>
            <p className="text-sm text-muted-foreground">
              Paste this snippet into your website&apos;s HTML, just before the closing{" "}
              <code className="text-xs bg-muted px-1 rounded">&lt;/body&gt;</code> tag:
            </p>
            <div className="relative">
              <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto">{embedSnippet}</pre>
              <Button
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {token && (
            <Button
              onClick={() => {
                onConnected();
                onClose();
              }}
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
