import type { DefaultSession } from "next-auth";

// Adds the signed-in user's id (the Entra `oid` claim, carried through
// authorize()'s return value in auth.ts) onto the session, mirroring every
// other auth.js provider's convention of exposing one on session.user.
declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
    } & DefaultSession["user"];
  }
}
