import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { AglLogo, PuksMark } from "@/components/shell/Brand";
import { AUTH_CONFIGURED, auth, signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/callback-url";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "That Microsoft account isn't part of AGL's organization, so access was denied.",
  Configuration: "Sign-in is misconfigured on this deploy. Contact an administrator.",
  Verification: "That sign-in link is no longer valid.",
  OAuthSignin: "Couldn't start the Microsoft sign-in flow. Try again.",
  OAuthCallback: "Microsoft's sign-in response couldn't be read. Try again.",
  OAuthCallbackError: "Microsoft's sign-in response couldn't be read. Try again.",
  Default: "Something went wrong signing in. Try again.",
};

function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function NotConfigured() {
  const required = [
    "AUTH_SECRET",
    "AUTH_MICROSOFT_ENTRA_ID_ID",
    "AUTH_MICROSOFT_ENTRA_ID_SECRET",
    "AUTH_MICROSOFT_ENTRA_ID_ISSUER",
  ];
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-hazard/15 text-hazard">
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-hazard">Sign-in is not configured</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This deploy has no Microsoft Entra ID application registered yet, so no one can sign in.
          </p>
        </div>
      </div>
      <dl className="mt-4 space-y-1 rounded-xl bg-bay p-3 font-mono text-xs text-muted-foreground">
        {required.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-muted-foreground">
        See <code className="font-mono text-type">web/.env.local.example</code> and the
        &ldquo;Authentication (SSO)&rdquo; section of{" "}
        <code className="font-mono text-type">web/README.md</code> for how to register the app in
        Entra and fill these in.
      </p>
    </div>
  );
}

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const errorParam = firstParam(params.error);
  const errorMessage = errorParam ? (ERROR_MESSAGES[errorParam] ?? ERROR_MESSAGES.Default) : null;

  // A signed-in visitor who lands here directly (a bookmark, the back
  // button) goes straight through rather than being shown a sign-in button
  // that would just re-confirm a session they already have.
  if (AUTH_CONFIGURED) {
    const session = await auth();
    if (session?.user) redirect(callbackUrl);
  }

  return (
    <div className="app-canvas flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <PuksMark className="size-14 text-2xl" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Puks AI</h1>
            <p className="mt-1 text-sm text-muted-foreground">Speed WMS Intelligence</p>
          </div>
        </div>

        <div className="rounded-2xl border border-rule bg-card p-6 shadow-lift">
          {AUTH_CONFIGURED ? (
            <>
              <h2 className="font-display text-lg font-semibold">Sign in required</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Puks is restricted to AGL staff. Sign in with your Microsoft account to continue.
              </p>
              {errorMessage && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-hazard/40 bg-hazard/10 p-3 text-sm text-hazard"
                >
                  {errorMessage}
                </p>
              )}
              <form
                action={async () => {
                  "use server";
                  await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
                }}
                className="mt-5"
              >
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-3 rounded-full border border-rule bg-background px-4 py-2.5 text-sm font-medium text-type shadow-soft transition hover:border-signal/50 hover:shadow-lift"
                >
                  <MicrosoftLogo className="size-4" />
                  Sign in with Microsoft
                </button>
              </form>
            </>
          ) : (
            <NotConfigured />
          )}
        </div>

        <p className="flex justify-center">
          <AglLogo className="w-16 opacity-70" />
        </p>
      </div>
    </div>
  );
}
