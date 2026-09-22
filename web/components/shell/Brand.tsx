import Image from "next/image";
import { cn } from "@/lib/utils";

/** The Puks mark: an AGL Blue tile with a "P" and the charter's short yellow
 *  title rule beneath it. Sized entirely by the className the caller passes
 *  (`size-9 text-lg`, …) so the same mark is the sidebar logo, the assistant's
 *  avatar in the transcript and the hero on the welcome screen. */
export function PuksMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 flex-col items-center justify-center gap-[0.14em] rounded-[28%] bg-agl-blue font-display font-bold text-white shadow-soft ring-1 ring-black/5 dark:ring-white/15",
        className,
      )}
    >
      <span className="leading-none">P</span>
      <span className="h-[0.14em] w-[38%] rounded-full bg-brand" />
    </span>
  );
}

/** The client mark. The PNG is single-colour navy on transparent, so on the
 *  dark theme it is inverted to white rather than swapped for a second asset. */
export function AglLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/agl-logo.png"
      alt="AGL — Africa Global Logistics"
      width={428}
      height={235}
      priority
      className={cn("h-auto dark:brightness-0 dark:invert", className)}
    />
  );
}
