import { getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getConfig();
  if (!config) return Response.json({ detail: "API unavailable" }, { status: 502 });
  return Response.json(config);
}
