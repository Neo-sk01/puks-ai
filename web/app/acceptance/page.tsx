import { AcceptanceView } from "@/components/acceptance/AcceptanceView";
import { requireSession } from "@/lib/auth-guard";
import { getAcceptanceQuestions, getAcceptanceResults, getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function AcceptancePage() {
  const session = await requireSession("/acceptance");
  const [config, groups, { run, results }] = await Promise.all([
    getConfig(), getAcceptanceQuestions(), getAcceptanceResults(),
  ]);
  return <AcceptanceView config={config} user={session.user} groups={groups} run={run} results={results} />;
}
