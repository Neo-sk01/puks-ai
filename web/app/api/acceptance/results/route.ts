import { bundledResults } from "@/lib/acceptance-bundled";
import { requireApiSession } from "@/lib/auth-guard";
import { STANDALONE } from "@/lib/deployment";
import { noStore } from "@/lib/no-store";
import { proxyJson } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  if (STANDALONE) return noStore(Response.json(bundledResults()));
  return noStore(await proxyJson("/api/acceptance/results"));
}
