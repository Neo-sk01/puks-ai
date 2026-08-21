import { describe, expect, it } from "vitest";
import { clampTopK, promptHistory } from "./history";
import type { AppConfig, ChatMessage } from "./types";

const config = { top_k_min: 3, top_k_max: 10, top_k_default: 5 } as AppConfig;

const user = (content: string): ChatMessage => ({ role: "user", content });
const bot = (content: string, refused = false): ChatMessage => ({
  role: "assistant",
  content,
  refused,
});

describe("promptHistory", () => {
  it("keeps ordinary turns", () => {
    expect(promptHistory([user("q1"), bot("a1")])).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("drops a refused assistant turn AND the user turn that provoked it", () => {
    // Streamlit appended both to `messages` for display, but never called
    // memory.add_turn(), so neither reached the prompt.
    const history = promptHistory([
      user("q1"), bot("a1"),
      user("nonsense"), bot("I do not have enough information...", true),
      user("q2"), bot("a2"),
    ]);
    expect(history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
    expect(JSON.stringify(history)).not.toContain("nonsense");
  });

  it("drops the greeting, which has no user turn", () => {
    expect(promptHistory([bot("Welcome. I am Puks."), user("q"), bot("a")])).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
  });

  it("drops a trailing user turn that has no answer yet", () => {
    expect(promptHistory([user("q1"), bot("a1"), user("pending")])).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("returns empty for a fresh conversation", () => {
    expect(promptHistory([bot("Welcome.")])).toEqual([]);
  });

  it("strips the display-only fields", () => {
    const [turn] = promptHistory([
      user("q"),
      { role: "assistant", content: "a", retrieved: { chunks: [], confidence: 1, intent: {} as never } },
    ]);
    expect(Object.keys(turn)).toEqual(["role", "content"]);
  });
});

describe("clampTopK", () => {
  it("passes values in range", () => expect(clampTopK(7, config)).toBe(7));
  it("raises below-range values", () => expect(clampTopK(1, config)).toBe(3));
  it("lowers above-range values", () => expect(clampTopK(99, config)).toBe(10));
  it("falls back to the default for NaN", () => expect(clampTopK(NaN, config)).toBe(5));
});
