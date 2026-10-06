This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Authentication (SSO)

The whole app — chat, About, Acceptance, and every `/api/*` route except
`/api/auth/*` itself — requires sign-in via **Microsoft Entra ID**, scoped to
AGL's own tenant and authenticated with a **certificate**, not a client
secret. With no credentials configured, every page shows a "sign-in is not
configured" screen instead of silently letting everyone in (see
`lib/msal.ts`'s `AUTH_CONFIGURED` check) — there is no way to run this app
with authentication accidentally disabled.

### How it's wired

Sign-in does **not** go through next-auth's own Microsoft Entra ID provider.
That provider's certificate support only sets `alg`/`kid` on the client
assertion it sends Entra, but Entra requires `alg: "PS256"` plus an
`x5t#S256` header (the certificate's SHA-256 thumbprint) — see
[Microsoft's certificate-credentials docs](https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials)
and `lib/msal.ts`'s doc comment, which traces this through both libraries'
actual source. There's no supported hook to add that header through
next-auth's provider config, so sign-in is wired through
[`@azure/msal-node`](https://www.npmjs.com/package/@azure/msal-node) —
Microsoft's own library — directly instead:

- `lib/msal.ts` — builds the certificate-authenticated `ConfidentialClientApplication`.
- `app/api/auth/entra/signin/route.ts` — leg 1: builds the Microsoft
  authorize URL (state, nonce, PKCE) and redirects there. Linked from
  `app/sign-in/page.tsx`'s "Sign in with Microsoft" button.
- `app/api/auth/entra/callback/route.ts` — leg 2: exchanges the code for
  tokens (this is the request that actually uses the certificate
  assertion), re-checks the tenant and audience, and hands the verified
  result to next-auth.
- `lib/entra-flow.ts` — the two short-lived signed tokens that make the
  above safe: one carries state/nonce/PKCE across the two legs, the other
  is a single-use "ticket" handing the verified identity to next-auth's
  Credentials provider — needed because that provider's own callback route
  is otherwise reachable directly, and must be able to tell a real result
  from a forged POST.
- `auth.ts` — NextAuth (Auth.js v5) configuration. Owns only the session
  cookie: one Credentials provider that trusts a ticket's signature, JWT
  sessions (no database), and the `authorized` callback that decides who
  gets through.
- `proxy.ts` — Next.js 16's rename of Middleware. Re-exports `auth` directly,
  so every request is checked before it reaches a page. This is an
  **optimistic** check (cookie only, no network call) — see the comment in
  the file and [Next's own auth guide](https://nextjs.org/docs/app/guides/authentication#optimistic-checks-with-proxy-optional).
- `lib/auth-guard.ts` — the non-optimistic check. Every page and every
  route handler calls `requireSession()` / `requireApiSession()` itself,
  rather than trusting Proxy alone — the same Data Access Layer pattern
  Next's guide recommends.
- `app/sign-in/page.tsx` — the branded sign-in screen (and the
  "not configured" screen, when the env vars below are missing).

### Setting it up

You'll need an app registered in **Microsoft Entra ID** (Azure AD) in AGL's
tenant, with a certificate rather than a client secret:

1. In the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID**
   → **App registrations** → **New registration**.
   - Supported account types: **this organizational directory only**
     (single tenant) — this is what restricts sign-in to AGL staff.
   - Redirect URI (type **Web**): `https://<your-deploy-domain>/api/auth/entra/callback`
     (for local dev: `http://localhost:3000/api/auth/entra/callback`).
2. From the registration's **Overview** page, copy the **Application
   (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets** → **Certificates** tab → **Upload
   certificate** → upload the public certificate (`.cer`/`.pem`) your
   PKI/IT process issued. (Not the "Client secrets" tab — that's the
   simpler, secret-based path this app doesn't use.)
4. From the `.pfx` you were given, extract the private key and the
   certificate's SHA-256 thumbprint:

   ```bash
   openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem
   # key.pem has "Bag Attributes" lines before the real PEM block — keep
   # only this part:
   sed -n '/-----BEGIN PRIVATE KEY-----/,/-----END PRIVATE KEY-----/p' key.pem

   openssl pkcs12 -in cert.pfx -clcerts -nokeys -out cert.pem
   openssl x509 -in cert.pem -noout -fingerprint -sha256   # then strip the colons
   ```

5. Copy `.env.local.example` to `.env.local` and fill in:

   ```bash
   AUTH_SECRET=                                   # openssl rand -base64 32
   AUTH_MICROSOFT_ENTRA_ID_ID=                    # Application (client) ID
   AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=             # Directory (tenant) ID
   AUTH_MICROSOFT_ENTRA_ID_CERT_THUMBPRINT=       # hex, no colons
   AUTH_MICROSOFT_ENTRA_ID_CERT_PRIVATE_KEY=      # the PEM block, newlines as \n
   ```

6. On a non-Vercel deploy (Azure Container Apps, Docker, …), also set
   `AUTH_TRUST_HOST=true` — Vercel sets this automatically.

A directory **guest** account (a non-AGL person explicitly invited into
AGL's tenant) can sign in too — that's a B2B guest, which Entra counts as a
tenant member. Narrowing further (specific users, specific app roles) is an
Entra **Enterprise application → Properties → "Assignment required"**
setting, not something this app's code decides.

### Local development without a real Entra app

Until the five variables above are set, the app is fully usable for UI
work in **every other respect** — `PUKS_MOCK=1` still serves fixture
answers — but every page shows the "sign-in is not configured" screen
rather than its real content, because sign-in fails closed by design. There
is currently no bypass flag; register a (free, personal-tenant-is-fine for
local testing) Entra app and certificate if you need to exercise the
signed-in experience without AGL's own tenant.

## Notes

- `shadcn` belongs in `package.json`'s `dependencies`, not `devDependencies` — `app/globals.css` does `@import "shadcn/tailwind.css"`, which resolves through the package's export map at build time. Moving it to devDependencies breaks the CSS build in a production install (`--omit=dev` / `pnpm install --prod`).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
