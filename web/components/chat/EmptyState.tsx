"use client";

import { BookOpen, Database, PackageSearch, RotateCcw, ShieldCheck, Truck, type LucideIcon } from "lucide-react";
import { PuksMark } from "@/components/shell/Brand";

interface Suggestion {
  category: string;
  prompt: string;
  Icon: LucideIcon;
}

/** Starter questions, each drawn from a topic that has a document in the
 *  corpus (DATA/Cleaned_Generative: Reverse Closed GRN, Cancel Shipped Order,
 *  the REE_DAT table schema, Resend Pegasus file). Whether the live model
 *  answers each well is a retrieval-quality matter, not something this list
 *  guarantees. */
const SUGGESTIONS: Suggestion[] = [
  { category: "Receiving", prompt: "How do I reverse a closed GRN?", Icon: PackageSearch },
  { category: "Outbound", prompt: "How do I cancel a shipped order?", Icon: Truck },
  { category: "Database", prompt: "Which table stores receipt headers, and what are its key columns?", Icon: Database },
  { category: "Integrations", prompt: "How do I resend a Pegasus file?", Icon: RotateCcw },
];

const PRINCIPLES: Array<[LucideIcon, string]> = [
  [BookOpen, "Answers come from AGL's documentation"],
  [ShieldCheck, "Read-only — never changes a system"],
];

export function EmptyState({ onPick, disabled }: { onPick: (prompt: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-10 px-4 py-10 md:px-6">
      <div className="animate-msg-in space-y-4 text-center">
        <PuksMark className="mx-auto size-16 text-3xl" />
        <div className="space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-balance md:text-4xl">
            How can I help with Speed WMS?
          </h2>
          <p className="mx-auto max-w-xl text-pretty text-muted-foreground">
            Ask about procedures, tables and support fixes. If the documentation doesn&apos;t
            cover it, Puks says so instead of guessing.
          </p>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map(({ category, prompt, Icon }, i) => (
          <li key={prompt} className="animate-msg-in" style={{ animationDelay: `${80 + i * 60}ms` }}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(prompt)}
              className="group flex h-full w-full items-start gap-3 rounded-2xl border border-rule bg-card p-4 text-left shadow-soft transition duration-200 hover:-translate-y-0.5 hover:border-signal/40 hover:shadow-lift disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-bay text-signal transition-colors group-hover:bg-brand group-hover:text-agl-blue">
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  {category}
                </span>
                <span className="mt-0.5 block text-[15px] leading-snug font-medium text-type">{prompt}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        {PRINCIPLES.map(([Icon, text]) => (
          <li key={text} className="flex items-center gap-2">
            <Icon className="size-3.5" aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
