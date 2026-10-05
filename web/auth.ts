import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { NextResponse } from "next/server";

/**
 * SSO — Microsoft Entra ID, single tenant.
 *
 * `issuer` is tenant-scoped (https://login.microsoftonline.com/<tenant-id>/v2.0),
 * which is what restricts sign-in to AGL's own directory: Microsoft rejects
 * the request at login.microsoftonline.com for any account outside that
 * tenant (including personal Microsoft accounts) before this app ever sees
 * it. That is the authoritative enforcement point — nothing here re-checks
 * the tenant. A directory guest account *does* pass, by design: B2B guests
 * are members of the tenant. Narrowing further (e.g. only specific guests,
 * or only specific app roles) is an Entra "Enterprise application" access
 * setting, not application code.
 *
 * JWT session strategy, deliberately: no database adapter, so Proxy (the
 * Next.js 16 rename of Middleware) can decode the session from the request
 * cookie alone rather than making a lookup on every navigation.
 */
export const AUTH_CONFIGURED = Boolean(
  process.env.AUTH_SECRET &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Fail closed, not open: with the provider unconfigured this list is
  // empty, so no one can ever complete a sign-in. The alternative —
  // constructing MicrosoftEntraID() with blank credentials — throws deep
  // inside @auth/core with a message that doesn't say what to fix. An empty
  // provider list instead leaves every visitor on the /sign-in page (see
  // app/sign-in/page.tsx), which reads AUTH_CONFIGURED itself and explains
  // what an operator still needs to set, the same pattern NotReadyBanner.tsx
  // uses for a misconfigured backend.
  providers: AUTH_CONFIGURED
    ? [
        MicrosoftEntraID({
          clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
          clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
          issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
        }),
      ]
    : [],
  session: { strategy: "jwt" },
  // Both point at the same branded page (app/sign-in/page.tsx), which reads
  // ?error= itself. Needed explicitly: AccessDenied (the error a
  // non-AGL-tenant account gets, since `issuer` is tenant-scoped) defaults
  // to `kind: "error"`, which without this falls back to next-auth's own
  // generic, unbranded /api/auth/error page rather than ours.
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    // Gate the whole app — this is what proxy.ts (Next.js 16's rename of
    // Middleware, re-exporting `auth` directly) consults on every request.
    // Without this callback NextAuth's default is `authorized: true`, i.e.
    // nothing is protected.
    //
    // API routes get a JSON 401 instead of the default HTML redirect: a
    // `fetch()` call follows a 3xx transparently and would otherwise hand
    // the sign-in page's markup to code that expects JSON (every acceptance
    // route, lib/chat.ts's sendMessage). Page routes get the default —
    // NextAuth redirects to /sign-in with `callbackUrl` set to where the
    // visitor was headed, and (see node_modules/next-auth/lib/index.js)
    // skips that redirect when the request is already for /sign-in, so this
    // can't loop.
    authorized({ request, auth }) {
      if (auth?.user) return true;
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ detail: "Sign-in required" }, { status: 401 });
      }
      return false;
    },
    // Carries the profile's object id and tenant onto the session, so
    // UserMenu.tsx can show who's signed in without a second round trip,
    // and so a future authorization decision (e.g. role-gating a page) has
    // something stable to check beyond name/email.
    jwt({ token, profile }) {
      if (profile) {
        token.oid = (profile as { oid?: string }).oid;
        token.tid = (profile as { tid?: string }).tid;
      }
      return token;
    },
    session({ session, token }) {
      // Casts, not a bare `token.oid`: @auth/core's own JWT type
      // (node_modules/.../@auth/core/jwt.d.ts) extends
      // `Record<string, unknown>`, and `next-auth/jwt` only re-exports it
      // rather than declaring it — module augmentation on a re-exporting
      // module doesn't merge into the original interface, so
      // types/next-auth.d.ts's `oid`/`tid` additions are visible on
      // `import type { JWT } from "next-auth/jwt"` but not on the `token`
      // this callback is actually handed. Known at runtime to be
      // `string | undefined` either way (Entra's `oid`/`sub` claims).
      //
      // Narrowed id, not `?? ""`: the callback's `session.user.id` is typed
      // `string` (not `string | undefined`) because the param type also
      // covers the database-session branch, where an id always exists —
      // this truthy check satisfies that without inventing an empty id.
      const id = (token.oid as string | undefined) ?? (token.sub as string | undefined);
      if (session.user && id) session.user.id = id;
      return session;
    },
  },
});
