import { requireApiSession } from "@/lib/auth-guard";
import { getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorized = await requireApiSession();
  if (unauthorized) return unauthorized;

  const config = await getConfig();
  if (!config) return Response.json({ detail: "API unavailable" }, { status: 502 });
  return Response.json(config);
}
