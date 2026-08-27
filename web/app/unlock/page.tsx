"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeNextPath } from "@/lib/safe-redirect";

/** Standalone page, not wrapped in the Sidebar shell — same reasoning as
 *  app/about/page.tsx: the Sidebar's props are all live chat state, and
 *  there's nothing to score or chat about before the access code is
 *  entered anyway. Tokens and fonts still apply — both are set globally in
 *  app/layout.tsx and app/globals.css.
 *
 *  Reads `next` off window.location directly (rather than the
 *  useSearchParams hook) so this page doesn't need a Suspense boundary —
 *  it's already fully client-rendered, and a plain full-page navigation on
 *  success is what we want anyway: it guarantees the freshly-set
 *  puks_access cookie is present on the very next request, which
 *  web/proxy.ts then re-checks. `next` is attacker-visible/rewritable
 *  query-string input, so it's validated with safeNextPath (lib/safe-
 *  redirect.ts) before use — otherwise this would be an open redirect on
 *  exactly the page testers are told to trust with a credential. */
export default function UnlockPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}) as { detail?: string })).detail;
        setError(detail ?? "Incorrect access code.");
        setSubmitting(false);
        return;
      }
      const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      window.location.href = next;
    } catch {
      setError("Could not reach the server. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 p-10">
      <div>
        <Image
          src="/agl-logo.png"
          alt="AGL — Africa Global Logistics"
          width={428}
          height={235}
          className="h-auto w-28"
        />
        <h1 className="mt-6 text-2xl font-semibold">Acceptance testing</h1>
        <div aria-hidden="true" className="mt-2 h-1 w-14 bg-brand" />
        <p className="mt-4 text-sm text-muted-foreground">
          This tool is shared with a single access code. Enter it to continue.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input
          type="password"
          autoFocus
          placeholder="Access code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={!!error}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={!code || submitting}>
          {submitting ? "Checking…" : "Continue"}
        </Button>
      </form>
    </main>
  );
}
