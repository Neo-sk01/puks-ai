"use client";

import type { Session } from "next-auth";
import { LogOut } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOutAction } from "@/lib/actions/auth";

type User = NonNullable<Session["user"]>;

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** Who's signed in, and the one way out. Lives at the foot of the sidebar,
 *  below SystemStatus — the model stack is "what this app is backed by",
 *  this is "who's using it", so they stay visually distinct rather than
 *  merged into one block. */
export function UserMenu({ user }: { user: User }) {
  const label = user.name || user.email || "Signed in";

  return (
    <Popover>
      <PopoverTrigger className="flex w-full items-center gap-2.5 rounded-xl border border-rule bg-card px-2.5 py-2 text-left shadow-soft transition-colors hover:border-signal/40">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-agl-blue text-xs font-semibold text-white dark:bg-brand dark:text-agl-blue"
        >
          {initials(user.name, user.email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-type">{label}</span>
          {user.email && user.name && (
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-56 p-1.5">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium text-type">{label}</p>
          {user.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-type transition-colors hover:bg-bay"
          >
            <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
            Sign out
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
