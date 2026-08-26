import { proxyJson } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const tester = new URL(request.url).searchParams.get("tester") ?? "";
  return proxyJson(`/api/acceptance/verdicts?tester=${encodeURIComponent(tester)}`);
}
