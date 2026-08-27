import { bundledResults } from "@/lib/acceptance-bundled";
import { STANDALONE } from "@/lib/deployment";
import { proxyJson } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  if (STANDALONE) return Response.json(bundledResults());
  return proxyJson("/api/acceptance/results");
}
