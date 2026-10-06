import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { NextResponse } from "next/server";
import { verifyEntraTicket } from "./lib/entra-flow";
import { AUTH_CONFIGURED, ENTRA_TENANT_ID } from "./lib/msal";

export { AUTH_CONFIGURED };

/**
 * SSO — Microsoft Entra ID, single tenant, certificate-authenticated.
 *
 * There is no Microsoft Entra ID *provider* configured here, deliberately.
 * The real Entra handshake — building the authorize URL, exchanging the
 * code, authenticating to Entra's token endpoint with the certificate
 * assertion — all happens in app/api/auth/entra/{signin,callback}/route.ts,
 * using @azure/msal-node (lib/msal.ts). next-auth's own OAuth provider
 * abstraction cannot produce the client assertion Entra requires for
 * certificate auth (PS256 + an x5t#S256 header); see lib/msal.ts's doc
 * comment for the full reasoning, verified against both libraries' source.
 *
 * What next-auth owns instead: the session cookie, via a single
 * Credentials provider that exists only to receive the already-verified
 * result of that callback route as a short-lived signed ticket
 * (lib/entra-flow.ts) — never raw claims, and never reachable with
 * anything an external caller could forge, since authorize() below
 * verifies the ticket's signature itself. Nothing in this file ever talks
 * to Microsoft directly.
 *
 * JWT session strategy: no database, so Proxy (proxy.ts, Next.js 16's
 * rename of Middleware) can decode the session from the request cookie
 * alone rather than making a lookup on every navigation.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Fail closed, not open: with the certificate unconfigured this list is
  // empty, so no one can ever complete a sign-in — every visitor lands on
  // /sign-in's "not configured" state (app/sign-in/page.tsx), the same
  // pattern NotReadyBanner.tsx uses for a misconfigured backend.
  providers: AUTH_CONFIGURED
    ? [
        Credentials({
          id: "entra-bridge",
          name: "Microsoft Entra ID",
          // Metadata only — this provider is never reached through
          // next-auth's own default sign-in form; app/sign-in/page.tsx
          // links straight to /api/auth/entra/signin instead.
          credentials: { ticket: { label: "Ticket", type: "text" } },
          async authorize(credentials) {
            const ticket = typeof credentials?.ticket === "string" ? credentials.ticket : null;
            if (!ticket || !ENTRA_TENANT_ID) return null;
            const claims = await verifyEntraTicket(process.env.AUTH_SECRET!, ticket, ENTRA_TENANT_ID);
            if (!claims) return null;
            return { id: claims.oid, name: claims.name, email: claims.email };
          },
        }),
      ]
    : [],
  session: { strategy: "jwt" },
  // Both point at the same branded page (app/sign-in/page.tsx), which reads
  // ?error= itself.
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    // Gate the whole app — this is what proxy.ts consults on every
    // request. Without this callback NextAuth's default is
    // `authorized: true`, i.e. nothing is protected.
    //
    // API routes get a JSON 401 instead of the default HTML redirect: a
    // `fetch()` call follows a 3xx transparently and would otherwise hand
    // the sign-in page's markup to code that expects JSON (every
    // acceptance route, lib/chat.ts's sendMessage). Page routes get the
    // default — NextAuth redirects to /sign-in with `callbackUrl` set to
    // where the visitor was headed, and (see node_modules/next-auth/lib/
    // index.js) skips that redirect when the request is already for
    // /sign-in, so this can't loop.
    authorized({ request, auth }) {
      if (auth?.user) return true;
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json({ detail: "Sign-in required" }, { status: 401 });
      }
      return false;
    },
    session({ session, token }) {
      // Narrowed, not `?? ""`: the callback's `session.user.id` is typed
      // `string` (not `string | undefined`) because the param type also
      // covers the database-session branch, where an id always exists —
      // this truthy check satisfies that without inventing an empty id.
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
