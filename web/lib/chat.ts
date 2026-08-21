import { parseSSE } from "./sse";
import { promptHistory } from "./history";
import type { ChatMessage, DonePayload, RetrievedPayload } from "./types";

export interface SendArgs {
  message: string;
  messages: ChatMessage[];
  topK: number;
  onRetrieved: (payload: RetrievedPayload) => void;
  onToken: (text: string) => void;
  onDone: (payload: DonePayload) => void;
  onError: (message: string) => void;
}

export async function sendMessage(args: SendArgs): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: args.message,
        history: promptHistory(args.messages),
        top_k: args.topK,
      }),
    });
  } catch (error) {
    args.onError((error as Error).message);
    return;
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    args.onError(body.detail ?? response.statusText);
    return;
  }

  for await (const event of parseSSE(response.body)) {
    if (event.event === "retrieved") args.onRetrieved(event.data);
    else if (event.event === "token") args.onToken(event.data.text);
    else if (event.event === "done") args.onDone(event.data);
    else if (event.event === "error") args.onError(event.data.message);
  }
}
