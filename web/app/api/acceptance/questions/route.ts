import { bundledQuestionGroups } from "@/lib/acceptance-bundled";
import { requireApiSession } from "@/lib/auth-guard";
import { STANDALONE } from "@/lib/deployment";
import { noStore } from "@/lib/no-store";
import { proxyJson } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  // Standalone (Vercel, no Python service): serve the set bundled at build
  // time. Everywhere else, unchanged — proxy to FastAPI exactly as before.
  if (STANDALONE) return noStore(Response.json({ groups: bundledQuestionGroups() }));
  return noStore(await proxyJson("/api/acceptance/questions"));
}
