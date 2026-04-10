"use client";

interface ProductionOutputProps {
  output: unknown;
}

export function ProductionOutput({ output }: ProductionOutputProps) {
  return (
    <div>
      <p className="text-[13px] text-muted-foreground mb-2">
        Production output (SP5 — placeholder)
      </p>
      <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
        {JSON.stringify(output, null, 2)}
      </pre>
    </div>
  );
}
