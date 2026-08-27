import { normaliseTester } from "@/lib/verdicts/shared";
import { getVerdictsStore, HttpError } from "@/lib/verdicts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tester = new URL(request.url).searchParams.get("tester") ?? "";

  // Mirrors api/acceptance.py's verdicts route: pure, no dependency on
  // where the data lives, so it runs identically in both modes and one hop
  // earlier than the FastAPI round trip it used to need in proxy mode.
  if (!normaliseTester(tester)) {
    return Response.json({ detail: "tester is required" }, { status: 400 });
  }

  try {
    const store = await getVerdictsStore();
    const verdicts = await store.forTester(tester);
    return Response.json({ verdicts });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ detail: error.detail }, { status: error.status });
    return Response.json({ detail: (error as Error).message }, { status: 502 });
  }
}
