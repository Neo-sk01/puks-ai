import type { AppConfig, ChatMessage } from "./types";

/**
 * The messages the server should fold into the prompt.
 *
 * PARITY TRAP. In APPLICATION(STREAMLIT)/APP.py the assistant reply was pushed
 * onto st.session_state.messages unconditionally, but memory.add_turn() sat
 * inside the `else` of `if result["refused"]`. Refused turns were therefore
 * visible in the transcript and invisible to the prompt.
 *
 * Reproduced here by walking complete user/assistant pairs and skipping any
 * pair whose answer was refused. Drop this and every refusal starts poisoning
 * later prompts with "I do not have enough information to answer this."
 */
export function promptHistory(messages: ChatMessage[]): { role: string; content: string }[] {
  const history: { role: string; content: string }[] = [];

  for (let i = 0; i < messages.length - 1; i++) {
    const question = messages[i];
    const reply = messages[i + 1];

    if (question.role !== "user" || reply.role !== "assistant") continue;
    i++; // consume the pair

    if (reply.refused) continue;

    history.push({ role: "user", content: question.content });
    history.push({ role: "assistant", content: reply.content });
  }

  return history;
}

/** Mirrors the server-side clamp; keeps the slider honest before the round trip. */
export function clampTopK(value: number, config: AppConfig): number {
  if (Number.isNaN(value)) return config.top_k_default;
  return Math.max(config.top_k_min, Math.min(config.top_k_max, value));
}
