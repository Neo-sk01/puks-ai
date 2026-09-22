"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ClipboardCheck, Info, Menu, MessageSquare, X, type LucideIcon } from "lucide-react";
import type { AppConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AglLogo, PuksMark } from "./Brand";
import { SystemStatus } from "./SystemStatus";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
}

/** NEXT_PUBLIC_ACCEPTANCE_ONLY="1" is set on deploys that only ship the
 *  acceptance tool (no FastAPI chat backend behind them, see
 *  lib/deployment.ts) — the chat link would otherwise point at a page with
 *  nothing to talk to. */
const ACCEPTANCE_ONLY = process.env.NEXT_PUBLIC_ACCEPTANCE_ONLY === "1";

const NAV: NavItem[] = [
  ...(ACCEPTANCE_ONLY ? [] : [{ href: "/", label: "Chat", Icon: MessageSquare }]),
  { href: "/acceptance", label: "Acceptance", Icon: ClipboardCheck },
  { href: "/about", label: "About", Icon: Info },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarBody({ config, onNavigate }: { config: AppConfig | null; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex flex-col gap-4 px-1 pt-1">
        <AglLogo className="w-24" />
        <Link href={ACCEPTANCE_ONLY ? "/acceptance" : "/"} onClick={onNavigate} className="flex items-center gap-3 rounded-lg">
          <PuksMark className="size-10 text-xl" />
          <span>
            <span className="block font-display text-lg leading-none font-semibold tracking-tight">Puks AI</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">Speed WMS Intelligence</span>
          </span>
        </Link>
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-1">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-bay text-type before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                  : "text-muted-foreground hover:bg-bay/70 hover:text-type",
              )}
            >
              <Icon className={cn("size-4", active && "text-signal")} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        {config && <SystemStatus config={config} />}
        <ThemeToggle />
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          © Puks AI (Predictive Unified Knowledge System)
        </p>
      </div>
    </div>
  );
}

function MobileBar({ config }: { config: AppConfig | null }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-sidebar/85 px-4 backdrop-blur md:hidden">
      <PuksMark className="size-8 text-base" />
      <span className="font-display text-base font-semibold tracking-tight">Puks AI</span>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger
          aria-label="Open navigation"
          className="ml-auto grid size-9 place-items-center rounded-lg text-type transition-colors hover:bg-bay"
        >
          <Menu className="size-5" aria-hidden="true" />
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground shadow-lift outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close navigation"
              className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-bay hover:text-type"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
            <div className="h-full overflow-y-auto">
              <SidebarBody config={config} onNavigate={() => setOpen(false)} />
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </header>
  );
}

/** The frame every page sits in: navigation rail on desktop, top bar + drawer
 *  on phones. Pages that manage their own scrolling (the chat, whose composer
 *  must stay pinned) pass `scroll={false}`; everything else scrolls inside
 *  <main> so the sidebar never moves. */
export function AppShell({
  config,
  children,
  scroll = true,
}: {
  config: AppConfig | null;
  children: ReactNode;
  scroll?: boolean;
}) {
  return (
    <div className="app-canvas flex h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-rule bg-sidebar md:block">
        <SidebarBody config={config} />
      </aside>
      <MobileBar config={config} />
      <main
        id="main"
        className={cn(
          "relative min-h-0 min-w-0 flex-1",
          scroll ? "scroll-thin overflow-y-auto" : "flex flex-col overflow-hidden",
        )}
      >
        {children}
      </main>
    </div>
  );
}
