import "server-only";
import { ConfidentialClientApplication, CryptoProvider } from "@azure/msal-node";

/**
 * Certificate-based confidential client for Microsoft Entra ID.
 *
 * NOT wired through next-auth's own MicrosoftEntraID provider — that
 * provider's `private_key_jwt` support only sets `alg`/`kid` on the client
 * assertion JWT (verified by reading node_modules/.../@auth/core/src/lib/
 * actions/callback/oauth/callback.ts), but Entra requires `alg: "PS256"`
 * plus an `x5t#S256` header (the certificate's SHA-256 thumbprint) — see
 * https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials.
 * next-auth gives no hook to add that header, so the built-in path cannot
 * produce an assertion Entra accepts.
 *
 * @azure/msal-node — Microsoft's own library — builds this assertion
 * correctly: passing `thumbprintSha256` is what selects the PS256 +
 * x5t#S256 code path (node_modules/.../@azure/msal-node/dist/client/
 * ClientAssertion.mjs, `createJwt()`). It owns the Entra handshake
 * (app/api/auth/entra/{signin,callback}/route.ts); next-auth (auth.ts)
 * only owns the resulting session cookie, via a Credentials provider that
 * trusts nothing it wasn't handed by that callback route — see
 * lib/entra-flow.ts for how that handoff is kept from being forgeable.
 */

const CLIENT_ID = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
const TENANT_ID = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
const CERT_THUMBPRINT = process.env.AUTH_MICROSOFT_ENTRA_ID_CERT_THUMBPRINT;
// Stored with literal "\n" (env files don't carry real newlines well) —
// the standard convention for a PEM value in an env var.
const CERT_PRIVATE_KEY = process.env.AUTH_MICROSOFT_ENTRA_ID_CERT_PRIVATE_KEY?.replace(/\\n/g, "\n");

export const AUTH_CONFIGURED = Boolean(
  process.env.AUTH_SECRET && CLIENT_ID && TENANT_ID && CERT_THUMBPRINT && CERT_PRIVATE_KEY,
);

export const ENTRA_TENANT_ID = TENANT_ID;
export const ENTRA_CLIENT_ID = CLIENT_ID;
export const ENTRA_AUTHORITY = TENANT_ID ? `https://login.microsoftonline.com/${TENANT_ID}` : undefined;
export const ENTRA_SCOPES = ["openid", "profile", "email"];

export const msalApp = AUTH_CONFIGURED
  ? new ConfidentialClientApplication({
      auth: {
        clientId: CLIENT_ID!,
        authority: ENTRA_AUTHORITY!,
        clientCertificate: {
          thumbprintSha256: CERT_THUMBPRINT!,
          privateKey: CERT_PRIVATE_KEY!,
        },
      },
    })
  : null;

/** PKCE pair generation — the one piece of the flow MSAL does hand us a
 *  tested helper for, so entra-flow.ts doesn't hand-roll RFC 7636 itself. */
export const cryptoProvider = new CryptoProvider();
