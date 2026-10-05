import type { DefaultSession } from "next-auth";

// Augments next-auth's own types with the two fields auth.ts's callbacks
// add: the signed-in user's object id (as `id`, mirroring every other
// auth.js provider's convention) on the session, and the raw Entra `oid` /
// `tid` claims on the JWT in between.
declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    oid?: string;
    tid?: string;
  }
}
