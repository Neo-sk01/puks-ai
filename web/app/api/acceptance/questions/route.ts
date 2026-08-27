import { bundledQuestionGroups } from "@/lib/acceptance-bundled";
import { STANDALONE } from "@/lib/deployment";
import { proxyJson } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  // Standalone (Vercel, no Python service): serve the set bundled at build
  // time. Everywhere else, unchanged — proxy to FastAPI exactly as before.
  if (STANDALONE) return Response.json({ groups: bundledQuestionGroups() });
  return proxyJson("/api/acceptance/questions");
}
