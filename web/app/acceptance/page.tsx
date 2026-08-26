import { AcceptanceView } from "@/components/acceptance/AcceptanceView";
import { getAcceptanceQuestions, getAcceptanceResults, getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function AcceptancePage() {
  const [config, groups, { run, results }] = await Promise.all([
    getConfig(), getAcceptanceQuestions(), getAcceptanceResults(),
  ]);
  return <AcceptanceView config={config} groups={groups} run={run} results={results} />;
}
