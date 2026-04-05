"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AgentFamilyCharacter } from "./agent-family-character";
import type { RoleFocus } from "@/components/character/operator-character";

const AGENT_FAMILIES: Array<{
  name: string;
  roleFocus: RoleFocus;
  status: "live" | "coming";
}> = [
  { name: "Sales", roleFocus: "leads", status: "live" },
  { name: "Creative", roleFocus: "default", status: "coming" },
  { name: "Trading", roleFocus: "default", status: "coming" },
  { name: "Finance", roleFocus: "default", status: "coming" },
];

export function HeroSection() {
  return (
    <section className="pt-28 pb-20 lg:pt-36 lg:pb-28" aria-label="Hero">
      <div className="page-width text-center">
        <h1
          className="font-display font-light tracking-tight text-foreground"
          style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)" }}
        >
          Hire AI agents that run your business.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
          Sales. Creative. Trading. Finance.
          <br />
          They start supervised. They earn your trust.
        </p>

        <div className="mt-12 flex flex-wrap items-end justify-center gap-4 sm:gap-6 lg:gap-10">
          {AGENT_FAMILIES.map((family, i) => (
            <div
              key={family.name}
              className="animate-fade-in-up"
              style={{ animationDelay: `${i * 200}ms`, animationFillMode: "both" }}
            >
              <AgentFamilyCharacter
                name={family.name}
                roleFocus={family.roleFocus}
                status={family.status}
              />
            </div>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/login">Get started</Link>
          </Button>
          <a
            href="#see-it-in-action"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            See it in action &darr;
          </a>
        </div>
      </div>
    </section>
  );
}
