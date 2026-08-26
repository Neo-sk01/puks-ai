import { proxyJson } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.text();
  return proxyJson(`/api/acceptance/verdicts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}
