import { handlers } from "@/auth";

// NextAuth's own routes: /api/auth/signin, /api/auth/callback/*,
// /api/auth/session, /api/auth/signout, /api/auth/csrf. Deliberately the
// one path under /api left out of proxy.ts's gate — gating it too would
// make signing in impossible.
export const { GET, POST } = handlers;
