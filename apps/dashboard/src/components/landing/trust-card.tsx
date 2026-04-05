interface TrustCardProps {
  visual: React.ReactNode;
  text: string;
}

export function TrustCard({ visual, text }: TrustCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="mb-4">{visual}</div>
      <p className="text-sm text-foreground leading-relaxed">{text}</p>
    </div>
  );
}
