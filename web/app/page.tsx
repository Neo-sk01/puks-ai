import { redirect } from "next/navigation";
import { ChatView } from "@/components/ChatView";
import { requireSession } from "@/lib/auth-guard";
import { getConfig, getHealth } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await requireSession("/");
  // Acceptance-only deploys have no chat backend behind them — see
  // lib/deployment.ts and components/shell/AppShell.tsx, which drops the
  // nav link to this same effect.
  if (process.env.NEXT_PUBLIC_ACCEPTANCE_ONLY === "1") redirect("/acceptance");
  const [health, config] = await Promise.all([getHealth(), getConfig()]);
  return <ChatView health={health} config={config} user={session.user} />;
}
