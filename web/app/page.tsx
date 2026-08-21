import { ChatView } from "@/components/ChatView";
import { getConfig, getHealth } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [health, config] = await Promise.all([getHealth(), getConfig()]);
  return <ChatView health={health} config={config} />;
}
