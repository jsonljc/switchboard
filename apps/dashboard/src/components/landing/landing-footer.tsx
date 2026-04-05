import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="bg-surface-raised py-6">
      <div className="page-width flex items-center justify-between text-sm text-muted-foreground">
        <span className="font-display font-medium text-foreground">Switchboard</span>
        <Link
          href="mailto:builders@switchboard.ai"
          className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-2 py-1"
        >
          Build agents for the marketplace &rarr;
        </Link>
        <span>&copy; {new Date().getFullYear()} Switchboard</span>
      </div>
    </footer>
  );
}
